'use strict';

/**
 * An organisation's own payment gateway: view, connect, test and disconnect.
 *
 * Each tenant runs payroll through their own Cashfree account, so these handlers never
 * read credentials from the environment and never return a stored secret to a browser.
 * The organisation always comes from the caller's token, never from the request body -
 * otherwise an admin of one tenant could read or overwrite another tenant's gateway.
 */

const {
  saveCredentials, loadCredentials, getStatus, clearCredentials, PayoutCredentialError
} = require('../services/payroll/orgPayoutCredentials');
const { CashfreePayoutProvider } = require('../services/payroll/cashfreePayoutProvider');
const { isVaultConfigured } = require('../utils/secretVault');
const logger = require('../utils/logger');

/** Maps a thrown error onto an honest status code instead of a blanket 500. */
function fail(res, err, fallbackMessage) {
  const status = err instanceof PayoutCredentialError ? err.statusCode : 500;
  if (status >= 500) logger.error(`[PAYOUT-ACCOUNT] ${err && err.message}`);
  return res.status(status).json({
    success: false,
    error: status >= 500 ? fallbackMessage : err.message,
    code: (err && err.code) || undefined
  });
}

function requireOrg(req, res) {
  const orgId = req.user && req.user.orgId;
  if (!orgId) {
    res.status(400).json({ success: false, error: 'No organization on your account.' });
    return null;
  }
  return orgId;
}

/** GET - what is connected. Safe for the browser: a masked hint, never the secret. */
exports.getPayoutAccount = async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  try {
    const status = await getStatus(orgId);
    return res.json({ success: true, vaultReady: isVaultConfigured(), ...status });
  } catch (err) {
    return fail(res, err, 'Could not read the payment account settings.');
  }
};

/**
 * POST /test - a read-only check against Cashfree before anything is saved.
 *
 * Takes credentials from the body so an administrator can verify a key BEFORE storing
 * it; with no body it tests whatever is already connected. verifyConnectivity issues a
 * GET only, so this can never move money however it is called.
 */
exports.testPayoutAccount = async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  try {
    const body = req.body || {};
    let clientId = body.clientId && String(body.clientId).trim();
    let clientSecret = body.clientSecret && String(body.clientSecret).trim();
    let environment = body.environment && String(body.environment).toUpperCase();

    if (!clientId || !clientSecret) {
      const stored = await loadCredentials(orgId);
      if (!stored) {
        return res.status(400).json({
          success: false,
          error: 'Enter a Client ID and Client Secret to test, or connect an account first.'
        });
      }
      ({ clientId, clientSecret, environment } = stored);
    }

    const provider = new CashfreePayoutProvider({
      clientId, clientSecret,
      environment: environment || 'PRODUCTION'
    });

    const result = await provider.verifyConnectivity();
    if (result.ok) {
      return res.json({ success: true, connected: true, message: 'Cashfree accepted these credentials.' });
    }

    // A failed test is an expected outcome, not a server error: report it as one.
    return res.status(200).json({
      success: true,
      connected: false,
      status: result.status,
      message: result.status === 401 || result.status === 403
        ? 'Cashfree rejected these credentials. Check the Client ID and Secret, and that this server\'s IP address is allow-listed in your Cashfree account.'
        : `Cashfree could not be reached: ${result.message}`
    });
  } catch (err) {
    return fail(res, err, 'Could not test the payment account.');
  }
};

/** POST - connect or replace the organisation's gateway credentials. */
exports.savePayoutAccount = async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  try {
    const status = await saveCredentials(orgId, req.body || {}, {
      uid: req.user && req.user.uid,
      email: req.user && req.user.email
    });
    logger.info(`[PAYOUT-ACCOUNT] ${orgId} connected a payout account (by ${(req.user && req.user.email) || 'unknown'})`);
    return res.json({ success: true, message: 'Payment account connected.', ...status });
  } catch (err) {
    return fail(res, err, 'Could not save the payment account.');
  }
};

/** DELETE - disconnect. Payroll disbursement stops until an account is connected again. */
exports.deletePayoutAccount = async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  try {
    await clearCredentials(orgId);
    logger.info(`[PAYOUT-ACCOUNT] ${orgId} disconnected its payout account (by ${(req.user && req.user.email) || 'unknown'})`);
    return res.json({ success: true, connected: false, message: 'Payment account disconnected.' });
  } catch (err) {
    return fail(res, err, 'Could not disconnect the payment account.');
  }
};
