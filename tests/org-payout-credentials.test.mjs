/**
 * Every organisation connects their own payment gateway, so credentials are stored per
 * tenant instead of in the server environment. What must hold: the secret is never
 * written readable, it is never returned to a browser, one tenant's stored value is
 * useless to another, and an organisation with no account connected resolves to nothing
 * rather than quietly falling back to someone else's gateway.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.KYLRX_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const require = createRequire(import.meta.url);

// --- a Firestore stand-in that records exactly what was written to disk ---------------
const STORE = new Map();   // "organizations/<org>/secure/payout" -> data

function makeDoc(path) {
  return {
    async set(data, opts) {
      STORE.set(path, opts && opts.merge ? Object.assign({}, STORE.get(path) || {}, data) : data);
    },
    async get() {
      const d = STORE.get(path);
      return { exists: Boolean(d), data: () => d };
    },
    async delete() { STORE.delete(path); }
  };
}
const mockDb = {
  collection(c1) {
    return { doc: (d1) => ({
      collection: (c2) => ({ doc: (d2) => makeDoc(`${c1}/${d1}/${c2}/${d2}`) })
    })};
  }
};

const fb = require.resolve('../config/firebase');
require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: { db: mockDb, admin: { apps: [{}] } } };

const creds = require('../services/payroll/orgPayoutCredentials.js');
const vault = require('../utils/secretVault.js');

const SECRET = 'cfsk_ma_prod_1a2b3c4d5e6f7g8h9i0j';
const INPUT = { clientId: 'CF_CLIENT_BOSCO_001', clientSecret: SECRET, environment: 'PRODUCTION' };

beforeEach(() => STORE.clear());

describe('per-organisation payout credentials', () => {
  it('saves and loads an organisation\'s own gateway credentials', async () => {
    await creds.saveCredentials('org_bosco', INPUT, { uid: 'u1', email: 'admin@bosco.example' });
    const loaded = await creds.loadCredentials('org_bosco');
    assert.equal(loaded.clientId, 'CF_CLIENT_BOSCO_001');
    assert.equal(loaded.clientSecret, SECRET);
    assert.equal(loaded.environment, 'PRODUCTION');
  });

  it('never writes the secret readable', async () => {
    await creds.saveCredentials('org_bosco', INPUT);
    const raw = JSON.stringify(STORE.get('organizations/org_bosco/secure/payout'));
    assert.ok(!raw.includes(SECRET), 'the stored document must not contain the plaintext');
    assert.ok(!raw.includes('cfsk_ma_prod'), 'not even a recognisable prefix');
  });

  it('stores it where no client can read it', async () => {
    await creds.saveCredentials('org_bosco', INPUT);
    // firestore.rules denies organizations/{orgId}/secure/{docId} to every client; the
    // parent organisation document is readable by any member of the tenant, so the
    // credential must not sit on it.
    assert.ok(STORE.has('organizations/org_bosco/secure/payout'));
    assert.equal(STORE.has('organizations/org_bosco'), false);
  });

  it('the browser-facing status carries no secret', async () => {
    await creds.saveCredentials('org_bosco', INPUT, { email: 'admin@bosco.example' });
    const status = await creds.getStatus('org_bosco');
    const raw = JSON.stringify(status);
    assert.ok(!raw.includes(SECRET));
    assert.equal(status.connected, true);
    assert.equal(status.clientId, 'CF_CLIENT_BOSCO_001');
    assert.ok(status.secretHint.endsWith(SECRET.slice(-4)), 'a hint, not the secret');
    assert.equal(status.updatedByEmail, 'admin@bosco.example');
  });

  /** The isolation property: a stored value lifted onto another tenant is useless. */
  it('one organisation\'s stored secret cannot be used by another', async () => {
    await creds.saveCredentials('org_bosco', INPUT);
    const stolen = STORE.get('organizations/org_bosco/secure/payout');
    STORE.set('organizations/org_acme/secure/payout', { ...stolen });
    await assert.rejects(() => creds.loadCredentials('org_acme'), /Could not decrypt/);
  });

  /** The one that prevents a shared-balance accident. */
  it('an organisation with no account connected resolves to null, never a fallback', async () => {
    assert.equal(await creds.loadCredentials('org_never_connected'), null);
    const status = await creds.getStatus('org_never_connected');
    assert.equal(status.connected, false);
    assert.equal(status.clientId, null);
  });

  it('disconnecting removes the stored credentials outright', async () => {
    await creds.saveCredentials('org_bosco', INPUT);
    await creds.clearCredentials('org_bosco');
    assert.equal(STORE.has('organizations/org_bosco/secure/payout'), false);
    assert.equal(await creds.loadCredentials('org_bosco'), null);
  });

  it('replacing credentials does not leave the old secret behind', async () => {
    await creds.saveCredentials('org_bosco', INPUT);
    await creds.saveCredentials('org_bosco', { ...INPUT, clientSecret: 'cfsk_ma_prod_REPLACEMENT_999' });
    const raw = JSON.stringify(STORE.get('organizations/org_bosco/secure/payout'));
    assert.ok(!raw.includes(SECRET), 'the superseded secret must not survive the overwrite');
    const loaded = await creds.loadCredentials('org_bosco');
    assert.equal(loaded.clientSecret, 'cfsk_ma_prod_REPLACEMENT_999');
  });

  it('falls back to the client secret for webhook signing only when none was given', async () => {
    await creds.saveCredentials('org_bosco', INPUT);
    assert.equal((await creds.loadCredentials('org_bosco')).webhookSecret, SECRET);

    await creds.saveCredentials('org_acme', { ...INPUT, webhookSecret: 'whsec_separate_value_123' });
    assert.equal((await creds.loadCredentials('org_acme')).webhookSecret, 'whsec_separate_value_123');
  });

  it('rejects obviously wrong input rather than storing it', async () => {
    await assert.rejects(() => creds.saveCredentials('org_bosco', { clientId: 'x', clientSecret: SECRET }), /Client ID/);
    await assert.rejects(() => creds.saveCredentials('org_bosco', { clientId: 'CF_CLIENT_1', clientSecret: 'nope' }), /Client Secret/);
    await assert.rejects(() => creds.saveCredentials('org_bosco', { ...INPUT, environment: 'STAGING' }), /TEST or PRODUCTION/);
    assert.equal(STORE.size, 0, 'nothing written on a rejected save');
  });

  it('requires an organisation', async () => {
    await assert.rejects(() => creds.saveCredentials('', INPUT), /organization is required/i);
    await assert.rejects(() => creds.loadCredentials(''), /organization is required/i);
  });

  it('is stored with the vault, not in some other encoding', async () => {
    await creds.saveCredentials('org_bosco', INPUT);
    const stored = STORE.get('organizations/org_bosco/secure/payout');
    assert.ok(vault.isEncrypted(stored.clientSecretEnc));
    assert.equal(vault.decryptSecret(stored.clientSecretEnc, 'org_bosco'), SECRET);
  });
});
