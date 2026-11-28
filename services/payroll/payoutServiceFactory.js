'use strict';

/**
 * Builds a disbursement service bound to ONE organisation's own payment gateway.
 *
 * Why this exists: the controller used to hold a single PayrollDisbursementService,
 * constructed once at startup from the server environment. Every tenant shared it, so
 * every tenant's payroll was paid from the same Cashfree balance - one company's funds
 * could settle another company's salaries, and reconciliation was guesswork.
 *
 * Each organisation now connects its own account. This factory loads that organisation's
 * credentials and constructs a service around them.
 *
 * It refuses rather than falling back. An organisation with no account connected gets a
 * clear error, and there is no longer any server-wide credential it could be served
 * instead: a silent fallback is precisely how a payroll run would be charged to the
 * wrong company.
 */

const { PayrollDisbursementService } = require('./payrollDisbursementService');
const { loadCredentials } = require('./orgPayoutCredentials');

class PayoutAccountNotConnectedError extends Error {
  constructor(orgId) {
    super('No payment account is connected for this organization. Connect your Cashfree account under Payment Account before running a disbursement.');
    this.name = 'PayoutAccountNotConnectedError';
    this.statusCode = 409;
    this.code = 'payout_account_not_connected';
    this.orgId = orgId;
  }
}

/**
 * Services are cached per organisation so a payroll run does not re-read and re-decrypt
 * on every call. Short-lived on purpose: credentials changed in the settings page take
 * effect within the TTL without a restart.
 */
const CACHE_TTL_MS = Number(process.env.PAYOUT_SERVICE_CACHE_MS || 60000);
const cache = new Map();   // orgId -> { service, clientId, expiresAt }

/**
 * @param {string} orgId
 * @param {object} [overrides] passed through to the service (tests inject a fake provider)
 * @returns {Promise<PayrollDisbursementService>} bound to that organisation's gateway
 * @throws {PayoutAccountNotConnectedError} when that organisation has connected nothing
 */
async function getServiceForOrg(orgId, overrides = {}) {
  if (!orgId) {
    const err = new Error('An organization is required to run a disbursement.');
    err.statusCode = 400;
    throw err;
  }

  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > Date.now() && !Object.keys(overrides).length) return hit.service;

  const creds = await loadCredentials(orgId);
  if (!creds) throw new PayoutAccountNotConnectedError(orgId);

  const service = new PayrollDisbursementService({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    webhookSecret: creds.webhookSecret,
    environment: creds.environment,
    ...overrides
  });

  if (!Object.keys(overrides).length) {
    cache.set(orgId, { service, clientId: creds.clientId, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return service;
}

/** Drop a cached service - called when credentials are saved or disconnected. */
function invalidate(orgId) {
  if (orgId) cache.delete(orgId); else cache.clear();
}

module.exports = { getServiceForOrg, invalidate, PayoutAccountNotConnectedError };
