'use strict';

/**
 * Each organisation connects their own payment gateway, so their credentials are stored
 * per tenant rather than in the server environment.
 *
 * Where they live: organizations/{orgId}/secure/payout - a subcollection the Firestore
 * rules deny to every client. The organisation document itself is readable by every
 * member of that organisation (firestore.rules: allow read if isSameTenant), so a secret
 * kept there would be fetchable by any employee. Encrypted or not, there is no reason to
 * hand it out; only the Admin SDK, which bypasses rules, can reach this path.
 *
 * The client secret is encrypted with utils/secretVault, bound to the organisation id, so
 * a stored value copied onto another tenant's document cannot be decrypted.
 */

const { db } = require('../../config/firebase');
const { encryptSecret, decryptSecret, isVaultConfigured, maskSecret } = require('../../utils/secretVault');

const SECURE_DOC = 'payout';
const SECURE_COLLECTION = 'secure';

class PayoutCredentialError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'PayoutCredentialError';
    this.statusCode = statusCode || 400;
    this.code = code || 'credential_error';
  }
}

/** Checked at the top of every entry point, so the caller never sees a lower-level error. */
function requireOrg(orgId) {
  if (!orgId) throw new PayoutCredentialError('An organization is required.', 400, 'org_required');
}

function docRef(orgId) {
  requireOrg(orgId);
  if (!db || typeof db.collection !== 'function') {
    throw new PayoutCredentialError('Database is not available.', 503, 'db_unavailable');
  }
  return db.collection('organizations').doc(orgId).collection(SECURE_COLLECTION).doc(SECURE_DOC);
}

/** Cashfree client ids are opaque; reject only what is obviously not a credential. */
function validateInput({ clientId, clientSecret, environment }) {
  const errors = [];
  if (!clientId || String(clientId).trim().length < 6) errors.push('Client ID looks too short.');
  if (!clientSecret || String(clientSecret).trim().length < 10) errors.push('Client Secret looks too short.');
  if (environment && !['TEST', 'PRODUCTION'].includes(String(environment).toUpperCase())) {
    errors.push("Environment must be TEST or PRODUCTION.");
  }
  if (errors.length) throw new PayoutCredentialError(errors.join(' '), 400, 'invalid_input');
}

/**
 * Stores an organisation's gateway credentials. The secret is encrypted before it is
 * written and is never readable again through any client-facing path.
 *
 * @param {string} orgId
 * @param {{clientId:string, clientSecret:string, webhookSecret?:string, environment?:string}} input
 * @param {{uid?:string, email?:string}} actor  who connected it, for the audit trail
 */
async function saveCredentials(orgId, input = {}, actor = {}) {
  requireOrg(orgId);
  if (!isVaultConfigured()) {
    throw new PayoutCredentialError(
      'Server is not configured to store payment credentials securely (KYLRX_ENCRYPTION_KEY is missing).',
      503, 'vault_unconfigured'
    );
  }
  validateInput(input);

  const clientId = String(input.clientId).trim();
  const clientSecret = String(input.clientSecret).trim();
  const webhookSecret = input.webhookSecret ? String(input.webhookSecret).trim() : '';
  const environment = String(input.environment || 'PRODUCTION').toUpperCase();

  const record = {
    provider: 'cashfree',
    environment,
    clientId,
    clientSecretEnc: encryptSecret(clientSecret, orgId),
    // Cashfree signs callbacks with the client secret unless a separate webhook secret is
    // configured; store one only when given, so the fallback stays explicit.
    webhookSecretEnc: webhookSecret ? encryptSecret(webhookSecret, orgId) : null,
    secretHint: maskSecret(clientSecret),
    connected: true,
    updatedAt: new Date().toISOString(),
    updatedByUid: actor.uid || null,
    updatedByEmail: actor.email || null
  };

  await docRef(orgId).set(record, { merge: false });
  return getStatus(orgId);
}

/**
 * Loads and decrypts the credentials for a payout run. Server-side only - the result
 * holds live secrets and must never be returned to a browser.
 *
 * @returns {Promise<null|{provider,environment,clientId,clientSecret,webhookSecret}>}
 *          null when the organisation has not connected an account.
 */
async function loadCredentials(orgId) {
  const snap = await docRef(orgId).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  if (!data.connected || !data.clientId || !data.clientSecretEnc) return null;

  // A decryption failure is surfaced, never swallowed: silently falling back to another
  // account is exactly how one tenant's payroll would be paid from another's balance.
  const clientSecret = decryptSecret(data.clientSecretEnc, orgId);
  const webhookSecret = data.webhookSecretEnc ? decryptSecret(data.webhookSecretEnc, orgId) : clientSecret;

  return {
    provider: data.provider || 'cashfree',
    environment: data.environment || 'PRODUCTION',
    clientId: data.clientId,
    clientSecret,
    webhookSecret
  };
}

/** A browser-safe summary: enough to show what is connected, never the secret itself. */
async function getStatus(orgId) {
  const snap = await docRef(orgId).get();
  if (!snap.exists) {
    return { connected: false, provider: null, environment: null, clientId: null, secretHint: null, updatedAt: null };
  }
  const d = snap.data() || {};
  return {
    connected: Boolean(d.connected),
    provider: d.provider || null,
    environment: d.environment || null,
    clientId: d.clientId || null,
    secretHint: d.secretHint || null,
    hasSeparateWebhookSecret: Boolean(d.webhookSecretEnc),
    updatedAt: d.updatedAt || null,
    updatedByEmail: d.updatedByEmail || null
  };
}

/** Disconnects the account. The document is removed outright, not just flagged. */
async function clearCredentials(orgId) {
  await docRef(orgId).delete();
  return { connected: false };
}

module.exports = {
  saveCredentials,
  loadCredentials,
  getStatus,
  clearCredentials,
  PayoutCredentialError
};
