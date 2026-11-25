/**
 * The settings endpoints an organisation uses to connect its own payment gateway.
 *
 * What must hold: the organisation always comes from the caller's token and never from
 * the request, a stored secret is never returned to a browser, the test button cannot
 * move money, and a gateway Cashfree rejected is reported as a failed test rather than
 * saved or disguised as a server fault.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.KYLRX_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');

const require = createRequire(import.meta.url);

// --- Firestore stand-in ---------------------------------------------------------------
const STORE = new Map();
const makeDoc = (path) => ({
  async set(data, opts) { STORE.set(path, opts && opts.merge ? { ...(STORE.get(path) || {}), ...data } : data); },
  async get() { const d = STORE.get(path); return { exists: Boolean(d), data: () => d }; },
  async delete() { STORE.delete(path); }
});
const mockDb = { collection: (c1) => ({ doc: (d1) => ({ collection: (c2) => ({ doc: (d2) => makeDoc(`${c1}/${d1}/${c2}/${d2}`) }) }) }) };

const fb = require.resolve('../config/firebase');
require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: { db: mockDb, admin: { apps: [{}] } } };

// --- Cashfree stand-in: records what it was constructed with, never leaves the machine --
const CALLS = [];
let nextResult = { ok: true, status: 200, message: null };
const cf = require.resolve('../services/payroll/cashfreePayoutProvider');
require.cache[cf] = { id: cf, filename: cf, loaded: true, exports: {
  CashfreePayoutProvider: class {
    constructor(opts) { this.opts = opts; CALLS.push(opts); }
    async verifyConnectivity() { return nextResult; }
  },
  CashfreeApiError: class extends Error {}
}};

const ctrl = require('../controllers/payoutAccountController.js');
const creds = require('../services/payroll/orgPayoutCredentials.js');

const SECRET = 'not-a-real-secret-sample-value-03';
const GOOD = { clientId: 'CF_BOSCO_CLIENT_01', clientSecret: SECRET, environment: 'PRODUCTION' };

function mockRes() {
  return { statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
const call = async (handler, { user = { orgId: 'org_bosco', uid: 'u1', email: 'admin@bosco.example' }, body = {} } = {}) => {
  const res = mockRes();
  await handler({ user, body }, res);
  return res;
};

beforeEach(() => { STORE.clear(); CALLS.length = 0; nextResult = { ok: true, status: 200, message: null }; });

describe('payout account endpoints', () => {
  it('reports nothing connected for a new organisation', async () => {
    const res = await call(ctrl.getPayoutAccount);
    assert.equal(res.body.success, true);
    assert.equal(res.body.connected, false);
    assert.equal(res.body.clientId, null);
  });

  it('connects an account and reports it without revealing the secret', async () => {
    const saved = await call(ctrl.savePayoutAccount, { body: GOOD });
    assert.equal(saved.statusCode, 200);
    assert.ok(!JSON.stringify(saved.body).includes(SECRET), 'the save response must not echo the secret');

    const res = await call(ctrl.getPayoutAccount);
    assert.equal(res.body.connected, true);
    assert.equal(res.body.clientId, 'CF_BOSCO_CLIENT_01');
    assert.ok(!JSON.stringify(res.body).includes(SECRET), 'the status must not carry the secret');
    assert.ok(res.body.secretHint.endsWith(SECRET.slice(-4)));
    assert.equal(res.body.updatedByEmail, 'admin@bosco.example');
  });

  /** The tenant boundary: the organisation comes from the token, never from the body. */
  it('ignores an orgId supplied in the request body', async () => {
    await call(ctrl.savePayoutAccount, {
      user: { orgId: 'org_bosco', uid: 'u1', email: 'a@b.c' },
      body: { ...GOOD, orgId: 'org_acme', organizationId: 'org_acme' }
    });
    assert.ok(STORE.has('organizations/org_bosco/secure/payout'), 'written to the caller\'s own tenant');
    assert.equal(STORE.has('organizations/org_acme/secure/payout'), false, 'never to the one named in the body');
  });

  it('refuses a caller with no organisation', async () => {
    const res = await call(ctrl.savePayoutAccount, { user: { uid: 'u1' }, body: GOOD });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /No organization/);
  });

  it('tests credentials before they are saved, and saves nothing', async () => {
    const res = await call(ctrl.testPayoutAccount, { body: GOOD });
    assert.equal(res.body.connected, true);
    assert.equal(CALLS.length, 1);
    assert.equal(CALLS[0].clientId, 'CF_BOSCO_CLIENT_01');
    assert.equal(STORE.size, 0, 'a test must not store anything');
  });

  it('tests the stored account when no credentials are supplied', async () => {
    await call(ctrl.savePayoutAccount, { body: GOOD });
    const res = await call(ctrl.testPayoutAccount, { body: {} });
    assert.equal(res.body.connected, true);
    assert.equal(CALLS[0].clientSecret, SECRET, 'decrypted the stored secret to test it');
  });

  it('asks for credentials when there is nothing to test', async () => {
    const res = await call(ctrl.testPayoutAccount, { body: {} });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Client ID and Client Secret/);
  });

  /** A rejected key is an expected answer, not a 500 - and the message must be actionable. */
  it('reports rejected credentials as a failed test, not a server error', async () => {
    nextResult = { ok: false, status: 401, message: 'authentication Failed' };
    const res = await call(ctrl.testPayoutAccount, { body: GOOD });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connected, false);
    assert.match(res.body.message, /IP address is allow-listed/);
  });

  it('reports an unreachable gateway distinctly from a rejected key', async () => {
    nextResult = { ok: false, status: 503, message: 'service unavailable' };
    const res = await call(ctrl.testPayoutAccount, { body: GOOD });
    assert.equal(res.body.connected, false);
    assert.match(res.body.message, /could not be reached/);
  });

  it('rejects a bad client id with 400, not 500', async () => {
    const res = await call(ctrl.savePayoutAccount, { body: { clientId: 'x', clientSecret: SECRET } });
    assert.equal(res.statusCode, 400);
    assert.equal(STORE.size, 0);
  });

  it('disconnects and then reports nothing connected', async () => {
    await call(ctrl.savePayoutAccount, { body: GOOD });
    const del = await call(ctrl.deletePayoutAccount);
    assert.equal(del.body.connected, false);
    assert.equal(await creds.loadCredentials('org_bosco'), null);
  });

  it('replacing credentials leaves no trace of the previous secret', async () => {
    await call(ctrl.savePayoutAccount, { body: GOOD });
    await call(ctrl.savePayoutAccount, { body: { ...GOOD, clientSecret: 'not-a-real-secret-replacement-04' } });
    assert.ok(!JSON.stringify(STORE.get('organizations/org_bosco/secure/payout')).includes(SECRET));
  });
});
