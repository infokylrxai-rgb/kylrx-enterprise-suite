'use strict';

/**
 * Encryption for per-tenant secrets held in Firestore - today an organisation's own
 * payment-gateway credentials.
 *
 * Why this exists: with every organisation connecting their own Cashfree account, the
 * credentials cannot live in Render's environment (one value for the whole app) and have
 * to sit on the organisation's own document. A payout secret moves money, so storing it
 * readable would mean anyone who can read the database - a leaked service account, a gap
 * in the rules, an operator - could disburse that company's funds. It is encrypted before
 * it is written and decrypted only in memory, for the moment a payout needs it.
 *
 * Scheme: AES-256-GCM. The organisation id is passed as additional authenticated data, so
 * a ciphertext copied from one organisation's document onto another's fails to decrypt
 * instead of quietly working. GCM also authenticates, so tampering is detected rather than
 * producing silent rubbish.
 *
 * The key lives in KYLRX_ENCRYPTION_KEY: 32 bytes, base64 or hex. It never changes as
 * tenants are added, and it must be backed up outside Render - losing it makes every
 * stored secret unreadable and every organisation has to reconnect.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;          // 96-bit nonce, the size GCM is specified for
const VERSION = 'v1';         // lets the format change later without guessing

class SecretVaultError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SecretVaultError';
    this.code = code || 'vault_error';
  }
}

/**
 * Reads the master key. Accepts base64 or hex so it can be generated with either tool,
 * but insists on exactly 32 bytes rather than padding or truncating a wrong-sized one -
 * a silently reshaped key would encrypt data nobody can ever get back.
 */
function loadKey(env = process.env) {
  const raw = (env.KYLRX_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new SecretVaultError(
      'KYLRX_ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      'key_missing'
    );
  }

  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    try {
      const decoded = Buffer.from(raw, 'base64');
      // Buffer.from(..., 'base64') silently ignores junk, so check it round-trips.
      if (decoded.length === KEY_BYTES && decoded.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')) {
        key = decoded;
      }
    } catch (_) { /* fall through to the length error below */ }
  }

  if (!key || key.length !== KEY_BYTES) {
    throw new SecretVaultError(
      `KYLRX_ENCRYPTION_KEY must be exactly ${KEY_BYTES} bytes, base64 or hex encoded.`,
      'key_invalid'
    );
  }
  return key;
}

/** True when a usable key is configured. Lets callers show a clear setup message. */
function isVaultConfigured(env = process.env) {
  try { loadKey(env); return true; } catch (_) { return false; }
}

/**
 * Encrypts a secret for one organisation.
 * @param {string} plaintext  the secret, e.g. a Cashfree client secret
 * @param {string} orgId      bound into the ciphertext; decryption must present the same id
 * @returns {string} "v1:<iv>:<tag>:<ciphertext>", all base64
 */
function encryptSecret(plaintext, orgId, env = process.env) {
  if (typeof plaintext !== 'string' || plaintext === '') {
    throw new SecretVaultError('Nothing to encrypt: expected a non-empty string.', 'empty_plaintext');
  }
  if (!orgId) {
    throw new SecretVaultError('An orgId is required: it binds the ciphertext to one tenant.', 'org_required');
  }

  const key = loadKey(env);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(String(orgId), 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Decrypts a secret. Throws if the blob was tampered with, if the key is wrong, or if it
 * belongs to a different organisation - never returns partial or wrong plaintext.
 */
function decryptSecret(blob, orgId, env = process.env) {
  if (typeof blob !== 'string' || !blob) {
    throw new SecretVaultError('Nothing to decrypt: expected a stored secret string.', 'empty_ciphertext');
  }
  if (!orgId) {
    throw new SecretVaultError('An orgId is required to decrypt a tenant secret.', 'org_required');
  }

  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretVaultError('Stored secret is not in the expected format.', 'format_invalid');
  }

  const key = loadKey(env);
  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(Buffer.from(String(orgId), 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) {
    // Deliberately one message for every failure: distinguishing "wrong key" from "wrong
    // tenant" from "tampered" would tell an attacker which part they got right.
    throw new SecretVaultError(
      'Could not decrypt the stored secret. The encryption key may have changed, or the value may belong to another organization.',
      'decrypt_failed'
    );
  }
}

/** True when a value looks like something this module produced. */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(VERSION + ':') && value.split(':').length === 4;
}

/**
 * A display form, e.g. "••••••3f9c". For showing an operator that a secret is stored
 * without ever sending the secret itself back to a browser.
 */
function maskSecret(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) return '';
  const tail = plaintext.slice(-4);
  return '•'.repeat(Math.min(Math.max(plaintext.length - 4, 4), 12)) + tail;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  isVaultConfigured,
  maskSecret,
  SecretVaultError,
  _loadKey: loadKey
};
