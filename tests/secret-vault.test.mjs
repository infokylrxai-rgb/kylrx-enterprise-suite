/**
 * Every organisation connects their own payment gateway, so their credentials live on
 * their Firestore document rather than in Render's environment. A payout secret moves
 * money, so what must hold is: it is never stored readable, a ciphertext from one tenant
 * cannot be used by another, tampering fails loudly, and a wrong key fails loudly rather
 * than returning something plausible.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vault = require('../utils/secretVault.js');

// Two distinct 32-byte keys.
const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');
const envA = { KYLRX_ENCRYPTION_KEY: KEY_A };
const envB = { KYLRX_ENCRYPTION_KEY: KEY_B };

const SECRET = 'cfsk_ma_prod_8f2b91c4e77a4d13b6social05e2a9';

describe('secret vault', () => {
  it('round-trips a secret for the organisation it was encrypted for', () => {
    const blob = vault.encryptSecret(SECRET, 'org_bosco', envA);
    assert.equal(vault.decryptSecret(blob, 'org_bosco', envA), SECRET);
  });

  it('never stores the secret readable', () => {
    const blob = vault.encryptSecret(SECRET, 'org_bosco', envA);
    assert.ok(!blob.includes(SECRET), 'ciphertext must not contain the plaintext');
    assert.ok(!blob.includes('cfsk_ma_prod'), 'not even a recognisable prefix');
    assert.ok(vault.isEncrypted(blob));
  });

  it('produces a different ciphertext every time, so equal secrets are not detectable', () => {
    const a = vault.encryptSecret(SECRET, 'org_bosco', envA);
    const b = vault.encryptSecret(SECRET, 'org_bosco', envA);
    assert.notEqual(a, b, 'a fresh nonce each time');
    assert.equal(vault.decryptSecret(b, 'org_bosco', envA), SECRET);
  });

  /**
   * The tenant-isolation property. Copying Bosco's stored secret onto another
   * organisation's document must not give that organisation Bosco's gateway.
   */
  it('refuses a ciphertext belonging to another organisation', () => {
    const blob = vault.encryptSecret(SECRET, 'org_bosco', envA);
    assert.throws(() => vault.decryptSecret(blob, 'org_acme', envA), /Could not decrypt/);
  });

  it('refuses a ciphertext when the key is wrong', () => {
    const blob = vault.encryptSecret(SECRET, 'org_bosco', envA);
    assert.throws(() => vault.decryptSecret(blob, 'org_bosco', envB), /Could not decrypt/);
  });

  it('detects tampering rather than returning altered plaintext', () => {
    const blob = vault.encryptSecret(SECRET, 'org_bosco', envA);
    const parts = blob.split(':');
    const data = Buffer.from(parts[3], 'base64');
    data[0] = data[0] ^ 0xff;                       // flip a bit of the ciphertext
    parts[3] = data.toString('base64');
    assert.throws(() => vault.decryptSecret(parts.join(':'), 'org_bosco', envA), /Could not decrypt/);
  });

  it('gives the same message whatever went wrong, so it leaks no hints', () => {
    const blob = vault.encryptSecret(SECRET, 'org_bosco', envA);
    const wrongOrg = (() => { try { vault.decryptSecret(blob, 'org_acme', envA); } catch (e) { return e.message; } })();
    const wrongKey = (() => { try { vault.decryptSecret(blob, 'org_bosco', envB); } catch (e) { return e.message; } })();
    assert.equal(wrongOrg, wrongKey);
  });

  it('will not encrypt without an organisation to bind to', () => {
    assert.throws(() => vault.encryptSecret(SECRET, '', envA), /orgId is required/);
  });

  it('rejects a key that is not exactly 32 bytes instead of reshaping it', () => {
    for (const bad of ['short', Buffer.alloc(16, 1).toString('base64'), Buffer.alloc(64, 1).toString('base64')]) {
      assert.throws(() => vault.encryptSecret(SECRET, 'org_bosco', { KYLRX_ENCRYPTION_KEY: bad }), /32 bytes/);
    }
  });

  it('says plainly when no key is configured', () => {
    assert.throws(() => vault.encryptSecret(SECRET, 'org_bosco', {}), /KYLRX_ENCRYPTION_KEY is not set/);
    assert.equal(vault.isVaultConfigured({}), false);
    assert.equal(vault.isVaultConfigured(envA), true);
  });

  it('accepts a hex key as well as base64', () => {
    const hexEnv = { KYLRX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('hex') };
    const blob = vault.encryptSecret(SECRET, 'org_bosco', hexEnv);
    assert.equal(vault.decryptSecret(blob, 'org_bosco', hexEnv), SECRET);
  });

  it('rejects a malformed stored value rather than guessing', () => {
    for (const bad of ['', 'not-a-blob', 'v1:only:three', 'v2:a:b:c']) {
      assert.throws(() => vault.decryptSecret(bad, 'org_bosco', envA));
    }
  });

  it('masks a secret for display without revealing it', () => {
    const masked = vault.maskSecret(SECRET);
    assert.ok(masked.endsWith(SECRET.slice(-4)));
    assert.ok(!masked.includes('cfsk'));
    assert.equal(vault.maskSecret(''), '');
  });

  it('handles unicode and long secrets', () => {
    for (const s of ['pässwörd-ünïcode-✓', 'x'.repeat(4096)]) {
      const blob = vault.encryptSecret(s, 'org_bosco', envA);
      assert.equal(vault.decryptSecret(blob, 'org_bosco', envA), s);
    }
  });
});
