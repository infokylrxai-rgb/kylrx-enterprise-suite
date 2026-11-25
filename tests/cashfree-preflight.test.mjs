/**
 * The disbursement preflight is the money-safe production readiness check: after switching to
 * production Cashfree keys, it reports which environment the server is actually using and whether
 * the keys authenticate and the server IP is allow-listed, using read-only calls only. These tests
 * cover the handler's branches against a fake provider, so no network or money is involved.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);

/**
 * The preflight now reports on the gateway the CALLER'S organisation would pay from, not
 * a single server-wide one, so the factory is stubbed rather than a shared service. An
 * organisation with nothing connected is a distinct outcome, covered at the end.
 */
let nextProvider = null;
let notConnected = false;
const factoryPath = require.resolve('../services/payroll/payoutServiceFactory');
require.cache[factoryPath] = { id: factoryPath, filename: factoryPath, loaded: true, exports: {
  async getServiceForOrg(orgId) {
    if (!orgId) { const e = new Error('An organization is required to run a disbursement.'); e.statusCode = 400; throw e; }
    if (notConnected) {
      const e = new Error('No payment account is connected for this organization. Connect your Cashfree account under Payment Account before running a disbursement.');
      e.code = 'payout_account_not_connected'; e.statusCode = 409;
      throw e;
    }
    return { provider: nextProvider };
  },
  invalidate() {},
  sharedAccountAllowed: () => false,
  PayoutAccountNotConnectedError: class extends Error {}
}};

const ctrl = require('../controllers/payroll-controller.js');

function mockRes() {
  return { body: null, statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}

async function run(fakeProvider) {
  nextProvider = fakeProvider;
  notConnected = false;
  const res = mockRes();
  await ctrl.getDisbursementPreflight({ user: { orgId: 'org_bosco' } }, res);
  return res.body.cashfree;
}

const PROD = { environment: 'production', apiVersion: 'v2', baseUrl: 'https://api.cashfree.com/payout' };

describe('cashfree disbursement preflight', () => {
  it('reports production env, balance and a whitelisted IP when all is well', async () => {
    const r = await run({ ...PROD, async getBalance() { return { availableBalance: 125000 }; } });
    assert.equal(r.environment, 'production');
    assert.equal(r.isProduction, true);
    assert.equal(r.baseUrlHost, 'api.cashfree.com');
    assert.equal(r.authenticated, true);
    assert.equal(r.ipWhitelisted, true);
    assert.equal(r.availableBalance, 125000);
  });

  it('flags an IP that is not allow-listed', async () => {
    const err = new Error('IP not whitelisted');
    err.details = { response: { message: 'IP not whitelisted' } };
    const r = await run({ ...PROD, async getBalance() { throw err; } });
    assert.equal(r.authenticated, false);
    assert.equal(r.ipWhitelisted, false);
    assert.match(r.error, /IP not whitelisted/);
  });

  it('falls back to a read-only connectivity probe when the fund source is not configured', async () => {
    const nc = new Error('BALANCE_NOT_CONFIGURED'); nc.notConfigured = true;
    const r = await run({ ...PROD,
      async getBalance() { throw nc; },
      async verifyConnectivity() { return { ok: true, status: 200, message: null }; } });
    assert.equal(r.authenticated, true);
    assert.equal(r.ipWhitelisted, true);
    assert.match(r.fundSource, /not configured/);
  });

  it('surfaces an auth failure found by the fallback probe', async () => {
    const nc = new Error('BALANCE_NOT_CONFIGURED'); nc.notConfigured = true;
    const r = await run({ ...PROD,
      async getBalance() { throw nc; },
      async verifyConnectivity() { return { ok: false, status: 401, message: 'authentication Failed' }; } });
    assert.equal(r.authenticated, false);
    assert.match(r.error, /authentication Failed/i);
  });

  it('still reports sandbox when the environment was not flipped', async () => {
    const r = await run({ environment: 'sandbox', apiVersion: 'v2',
      baseUrl: 'https://payout-gamma.cashfree.com/payout',
      async getBalance() { return { availableBalance: 0 }; } });
    assert.equal(r.isProduction, false);
    assert.equal(r.environment, 'sandbox');
    assert.equal(r.baseUrlHost, 'payout-gamma.cashfree.com');
  });

  /**
   * A preflight against the platform's own gateway would report "ready" for an
   * organisation that has connected nothing - the most misleading answer available.
   */
  it('reports 409 for an organisation with no payment account, never a false ready', async () => {
    notConnected = true;
    const res = mockRes();
    await ctrl.getDisbursementPreflight({ user: { orgId: 'org_unconnected' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.connected, false);
    assert.equal(res.body.code, 'payout_account_not_connected');
    assert.equal(res.body.cashfree, undefined, 'no gateway report at all');
  });

  it('refuses a caller with no organisation', async () => {
    notConnected = false;
    const res = mockRes();
    await ctrl.getDisbursementPreflight({ user: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });
});
