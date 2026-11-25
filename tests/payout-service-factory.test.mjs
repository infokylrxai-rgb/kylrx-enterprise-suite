/**
 * The question this file exists to answer: once an organisation has saved its own Client
 * ID and Secret, does a payout actually go out on THEIR gateway, or does it still go out
 * on Kylrx's?
 *
 * It is answered without any Cashfree account, real or sandbox, by inspecting which
 * credentials the gateway was constructed with. What must hold: an organisation with
 * credentials uses its own, an organisation without them is refused rather than quietly
 * charged to the platform, and two organisations never share one gateway instance.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.KYLRX_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
// The platform's own keys. Nothing a tenant does should ever reach these.
process.env.CASHFREE_CLIENT_ID = 'KYLRX_PLATFORM_CLIENT';
process.env.CASHFREE_CLIENT_SECRET = 'kylrx-platform-secret-not-real-00';

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

// --- Gateway stand-in: records the credentials it was handed --------------------------
const BUILT = [];
const cf = require.resolve('../services/payroll/cashfreePayoutProvider');
require.cache[cf] = { id: cf, filename: cf, loaded: true, exports: {
  CashfreePayoutProvider: class {
    constructor(opts = {}) {
      this.clientId = opts.clientId || process.env.CASHFREE_CLIENT_ID || '';
      this.clientSecret = opts.clientSecret || process.env.CASHFREE_CLIENT_SECRET || '';
      this.webhookSecret = opts.webhookSecret || this.clientSecret;
      this.environment = opts.environment;
      BUILT.push({ clientId: this.clientId, clientSecret: this.clientSecret, environment: this.environment });
    }
    isConfigured() { return Boolean(this.clientId && this.clientSecret); }
    async verifyConnectivity() { return { ok: true, status: 200, message: null }; }
  },
  CashfreeApiError: class extends Error {},
  BASE_URLS: {}, ENDPOINTS: { v1: {}, v2: {} }
}};

const factory = require('../services/payroll/payoutServiceFactory.js');
const creds = require('../services/payroll/orgPayoutCredentials.js');

const BOSCO = { clientId: 'BOSCO_OWN_CLIENT', clientSecret: 'bosco-own-secret-not-real-0001', environment: 'PRODUCTION' };
const ACME  = { clientId: 'ACME_OWN_CLIENT',  clientSecret: 'acme-own-secret-not-real-0002',  environment: 'TEST' };

beforeEach(() => {
  STORE.clear(); BUILT.length = 0; factory.invalidate();
  delete process.env.KYLRX_ALLOW_SHARED_PAYOUT_ACCOUNT;
});

describe('payout runs on the organisation\'s own gateway', () => {
  /** The headline question. */
  it('uses the organisation\'s credentials, not Kylrx\'s, once they are connected', async () => {
    await creds.saveCredentials('org_bosco', BOSCO);
    await factory.getServiceForOrg('org_bosco');

    assert.equal(BUILT.length, 1);
    assert.equal(BUILT[0].clientId, 'BOSCO_OWN_CLIENT');
    assert.equal(BUILT[0].clientSecret, 'bosco-own-secret-not-real-0001');
    assert.notEqual(BUILT[0].clientId, process.env.CASHFREE_CLIENT_ID, 'must not be the platform account');
    assert.notEqual(BUILT[0].clientSecret, process.env.CASHFREE_CLIENT_SECRET);
  });

  it('carries the organisation\'s environment, so a TEST account cannot move real money', async () => {
    await creds.saveCredentials('org_acme', ACME);
    await factory.getServiceForOrg('org_acme');
    assert.equal(BUILT[0].environment, 'TEST');
  });

  /** The failure mode that must never be silent. */
  it('refuses an organisation with no account connected, rather than using Kylrx\'s', async () => {
    await assert.rejects(
      () => factory.getServiceForOrg('org_unconnected'),
      (err) => {
        assert.equal(err.code, 'payout_account_not_connected');
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /Connect your Cashfree account/);
        return true;
      }
    );
    assert.equal(BUILT.length, 0, 'no gateway may be constructed at all');
  });

  it('two organisations never share a gateway', async () => {
    await creds.saveCredentials('org_bosco', BOSCO);
    await creds.saveCredentials('org_acme', ACME);

    const a = await factory.getServiceForOrg('org_bosco');
    const b = await factory.getServiceForOrg('org_acme');

    assert.notEqual(a, b, 'different service instances');
    assert.equal(a.provider.clientId, 'BOSCO_OWN_CLIENT');
    assert.equal(b.provider.clientId, 'ACME_OWN_CLIENT');
  });

  it('a disconnected organisation stops being able to disburse', async () => {
    await creds.saveCredentials('org_bosco', BOSCO);
    await factory.getServiceForOrg('org_bosco');

    await creds.clearCredentials('org_bosco');
    factory.invalidate('org_bosco');

    await assert.rejects(() => factory.getServiceForOrg('org_bosco'), /No payment account is connected/);
  });

  it('picks up replaced credentials once the cache is invalidated', async () => {
    await creds.saveCredentials('org_bosco', BOSCO);
    await factory.getServiceForOrg('org_bosco');

    await creds.saveCredentials('org_bosco', { ...BOSCO, clientId: 'BOSCO_ROTATED_CLIENT' });
    factory.invalidate('org_bosco');
    await factory.getServiceForOrg('org_bosco');

    assert.equal(BUILT[BUILT.length - 1].clientId, 'BOSCO_ROTATED_CLIENT');
  });

  it('caches per organisation so a payroll run does not re-decrypt on every call', async () => {
    await creds.saveCredentials('org_bosco', BOSCO);
    const first = await factory.getServiceForOrg('org_bosco');
    const second = await factory.getServiceForOrg('org_bosco');
    assert.equal(first, second);
    assert.equal(BUILT.length, 1, 'built once, reused');
  });

  it('requires an organisation', async () => {
    await assert.rejects(() => factory.getServiceForOrg(''), /organization is required/i);
  });

  /** The escape hatch is off unless deliberately set, and it is the only way to share. */
  describe('the shared-account escape hatch', () => {
    it('is off by default', () => {
      assert.equal(factory.sharedAccountAllowed(), false);
    });

    it('only falls back to the platform account when explicitly enabled', async () => {
      process.env.KYLRX_ALLOW_SHARED_PAYOUT_ACCOUNT = 'true';
      await factory.getServiceForOrg('org_unconnected');
      assert.equal(BUILT.length, 1);
      assert.equal(BUILT[0].clientId, 'KYLRX_PLATFORM_CLIENT', 'the platform account, logged as a warning');
    });

    it('is not enabled by a value that merely looks truthy', async () => {
      for (const v of ['1', 'yes', 'TRUE ', 'on']) {
        process.env.KYLRX_ALLOW_SHARED_PAYOUT_ACCOUNT = v;
        if (v.trim().toLowerCase() === 'true') continue;
        await assert.rejects(() => factory.getServiceForOrg('org_unconnected'), /No payment account is connected/);
      }
    });

    it('never applies to an organisation that HAS its own account', async () => {
      process.env.KYLRX_ALLOW_SHARED_PAYOUT_ACCOUNT = 'true';
      await creds.saveCredentials('org_bosco', BOSCO);
      await factory.getServiceForOrg('org_bosco');
      assert.equal(BUILT[0].clientId, 'BOSCO_OWN_CLIENT', 'own account always wins over the fallback');
    });
  });
});
