/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PAYROLL CONTROLLER
 * ============================================================================
 * Strict Separation of Concerns (PRD Section 4):
 * Separates Document Operations (/api/payroll/documents/*)
 * from Fund Disbursement Operations (/api/payroll/disburse/*).
 *
 * Integrated with:
 *  - PayrollDocumentService (Document generation, Excel/PDF registers, Archival)
 *  - PayrollDisbursementService (Cashfree Payouts, Maker-Checker, Signed Webhooks)
 * ============================================================================
 */

const { PayrollDocumentService } = require('../services/payroll/payrollDocumentService');
const { PayrollDisbursementService, MakerCheckerViolationError } = require('../services/payroll/payrollDisbursementService');

// Instantiate singleton services
const documentService = new PayrollDocumentService();
// Kept for the paths that do not touch a gateway: batch creation, approval and reads all
// work on Firestore only. Anything that actually moves money goes through
// getServiceForOrg instead, which binds to that organisation's own Cashfree account.
const disbursementService = new PayrollDisbursementService();
const { getServiceForOrg } = require('../services/payroll/payoutServiceFactory');
const { resolveOrgFromWebhook } = require('../services/payroll/webhookOrgResolver');
// Used only to read cashfree_transfer_index when resolving which tenant a callback is
// for. Tolerant of an unconfigured Admin SDK: the resolver treats a missing db as
// "cannot resolve", which the webhook handler answers with a retryable 503.
let webhookDb = null;
try { ({ db: webhookDb } = require('../config/firebase')); } catch (_) { webhookDb = null; }

// ============================================================================
// 1. PAYROLL DOCUMENT MANAGEMENT CONTROLLERS (/api/payroll/documents/*)
// ============================================================================

/**
 * POST /api/payroll/documents/generate-payslip
 * Generates single employee payslip document record.
 */
async function generatePayslip(req, res) {
  try {
    const { employee, period, metadata } = req.body;
    if (!employee) {
      return res.status(400).json({ success: false, error: 'Employee object is required.' });
    }

    const result = await documentService.generatePayslipDocument(
      employee,
      period || 'September 2026',
      { ...metadata, adminId: req.user?.id || req.body.adminId || 'SUPER_ADMIN' }
    );

    return res.status(201).json(result);
  } catch (error) {
    console.error('[PAYROLL_CTRL] Payslip generation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/payroll/documents/generate-batch
 * Batch Document Generation with safe 400-operation chunking.
 */
async function generateBatch(req, res) {
  try {
    const { employees, period } = req.body;
    const result = await documentService.generateMonthlyBatch(
      employees || [],
      period || 'September 2026',
      { adminId: req.user?.id || req.body.adminId || 'SUPER_ADMIN' }
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error('[PAYROLL_CTRL] Batch generation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/payroll/documents/export-register-excel
 * Customer-Templated SheetJS Excel Export (.xlsx).
 */
async function exportRegisterExcel(req, res) {
  try {
    const { records, period } = req.body;
    const targetPeriod = period || 'September 2026';
    const excelData = documentService.generatePayrollRegisterExcel(records || [], targetPeriod);

    res.setHeader('Content-Type', excelData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${excelData.fileName}"`);
    return res.status(200).send(excelData.buffer);
  } catch (error) {
    console.error('[PAYROLL_CTRL] Excel export error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/payroll/documents/export-register-pdf
 * Customer-Templated PDF Export (.pdf).
 */
async function exportRegisterPdf(req, res) {
  try {
    const { employeeDoc } = req.body;
    if (!employeeDoc) {
      return res.status(400).json({ success: false, error: 'Employee document data is required.' });
    }

    const pdfData = documentService.generatePayslipPdf(employeeDoc);
    res.setHeader('Content-Type', pdfData.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${pdfData.fileName}"`);
    return res.status(200).send(pdfData.buffer);
  } catch (error) {
    console.error('[PAYROLL_CTRL] PDF export error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/payroll/documents/vault
 * Retrieves archived documents.
 */
async function getVaultDocuments(req, res) {
  try {
    const { employeeId, period, limit } = req.query;
    const result = await documentService.getVaultDocuments({ employeeId, period, limit: Number(limit) || 50 });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[PAYROLL_CTRL] Vault fetch error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// ============================================================================
// 2. PAYROLL DISBURSEMENT CONTROLLERS (/api/payroll/disburse/*)
// ============================================================================

/**
 * POST /api/payroll/disburse/create-batch
 * Initiates payout batch in PENDING_APPROVAL state (Maker step).
 */
async function createDisbursementBatch(req, res) {
  try {
    const { batchId, period, payoutChannel, employees } = req.body;
    const makerId = req.user?.id || req.body.makerId;

    if (!makerId) {
      return res.status(400).json({
        success: false,
        error: 'makerId is required for 4-Eyes Maker-Checker authorization governance.'
      });
    }

    const batch = await disbursementService.createDisbursementBatch({
      batchId,
      period: period || 'September 2026',
      makerId,
      orgId: req.user?.orgId || null,
      payoutChannel: payoutChannel || 'IMPS',
      employees: employees || []
    });

    return res.status(201).json({
      success: true,
      message: 'Disbursement batch created and pending 4-Eyes checker approval.',
      batch
    });
  } catch (error) {
    console.error('[PAYROLL_CTRL] Create disbursement batch error:', error);
    return res.status(400).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/payroll/disburse/batch/:batchId/approve
 * 4-Eyes Maker-Checker Authorization (Checker step).
 * Blocks if checkerId === makerId.
 */
async function approveDisbursementBatch(req, res) {
  try {
    const { batchId } = req.params;
    const checkerId = req.user?.id || req.body.checkerId;
    const notes = req.body.notes || 'Approved by Super Admin Checker';

    if (!checkerId) {
      return res.status(400).json({
        success: false,
        error: 'checkerId is required for 4-Eyes Maker-Checker authorization.'
      });
    }

    const result = await disbursementService.approveDisbursementBatch(batchId, checkerId, notes, req.user?.orgId || null);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof MakerCheckerViolationError || error.name === 'MakerCheckerViolationError') {
      return res.status(403).json({
        success: false,
        error: '403_MAKER_CHECKER_VIOLATION',
        message: error.message,
        details: error.details
      });
    }
    console.error('[PAYROLL_CTRL] Batch approval error:', error);
    // A refusal carries its own status: a batch belonging to another organisation is reported
    // as 404, and returning 500 for it would both misreport a client error as a server fault
    // and set monitoring alight on every probe.
    if (error.name === 'PayoutValidationError') {
      return res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/payroll/disburse/batch/:batchId/execute
 * Triggers Cashfree Payouts execution (idempotent per employee).
 * Requires batch to be APPROVED.
 */
async function executeDisbursementBatch(req, res) {
  try {
    const { batchId } = req.params;
    // orgId comes from the verified token, never the body, so it cannot be spoofed to reach
    // another tenant's batch.
    const orgId = req.user?.orgId || null;
    // The money leaves THIS organisation's own gateway. getServiceForOrg refuses when none
    // is connected rather than falling back to the platform account, so one company's
    // payroll can never be charged to another's balance.
    const service = await getServiceForOrg(orgId);
    const result = await service.executeCashfreePayoutBatch(batchId, { ...req.body, orgId });
    return res.status(200).json(result);
  } catch (error) {
    if (error.code === 'payout_account_not_connected') {
      return res.status(409).json({ success: false, error: error.message, code: error.code });
    }
    if (error instanceof MakerCheckerViolationError || error.name === 'MakerCheckerViolationError') {
      return res.status(403).json({
        success: false,
        error: '403_UNAPPROVED_DISBURSEMENT_BLOCKED',
        message: error.message
      });
    }
    // Business rejections (no payable records, insufficient balance) are not gateway faults.
    if (error.name === 'PayoutValidationError') {
      return res.status(error.statusCode || 400).json({ success: false, error: error.message, details: error.details });
    }
    console.error('[PAYROLL_CTRL] Execute Cashfree payout error:', error);
    return res.status(502).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/payroll/disburse/batch/:batchId/reconcile
 * Polling fallback: pulls authoritative status from Cashfree for anything still PENDING,
 * so a dropped webhook can never strand a payout.
 */
async function reconcileDisbursementBatch(req, res) {
  try {
    const { batchId } = req.params;
    const orgId = req.user?.orgId || null;
    // Reconciliation reads transfer status from the gateway, so it has to ask the same
    // account the transfers were dispatched from - the platform's keys would report
    // nothing, or worse, another tenant's transfers.
    const service = await getServiceForOrg(orgId);
    const result = await service.reconcilePendingTransfers(batchId, orgId);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error.code === 'payout_account_not_connected') {
      return res.status(409).json({ success: false, error: error.message, code: error.code });
    }
    console.error('[PAYROLL_CTRL] Reconcile error:', error);
    // A refusal carries its own status: a batch belonging to another organisation is reported
    // as 404, and returning 500 for it would both misreport a client error as a server fault
    // and set monitoring alight on every probe.
    if (error.name === 'PayoutValidationError') {
      return res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/payroll/disburse/batch/:batchId/status
 * Inquires batch and item payment status.
 */
async function getDisbursementBatchStatus(req, res) {
  try {
    const { batchId } = req.params;
    const batch = await disbursementService.getBatch(batchId, req.user?.orgId || null);
    if (!batch) {
      return res.status(404).json({ success: false, error: `Batch ${batchId} not found.` });
    }
    return res.status(200).json({ success: true, batch });
  } catch (error) {
    console.error('[PAYROLL_CTRL] Batch status error:', error);
    // A refusal carries its own status: a batch belonging to another organisation is reported
    // as 404, and returning 500 for it would both misreport a client error as a server fault
    // and set monitoring alight on every probe.
    if (error.name === 'PayoutValidationError') {
      return res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/payroll/disburse/webhook/cashfree
 * Cashfree Payouts asynchronous webhook listener.
 * Signature-verified, then idempotently reconciles payment status in Firestore.
 *
 * The route mounts a raw body parser so the HMAC is computed over the EXACT bytes
 * Cashfree signed — re-serialised JSON would not match.
 */
/**
 * GET /api/payroll/disburse/outbound-ip  (admin only)
 *
 * Cashfree Payouts uses an IP allow-list as its second factor, so payouts fail with
 * "IP not whitelisted" until the address this server egresses from is allowed. A PaaS
 * publishes a RANGE (Render shows /24 blocks) while Cashfree accepts individual
 * addresses, so the range alone is not enough - and 74.220.52.0 is a network address,
 * not a host, so entering the block without its suffix allow-lists nothing.
 *
 * This reports the address an outbound call actually leaves from, which is the value to
 * paste into the gateway. It is also the first thing to re-check if payouts start
 * failing after a platform migration or a region change.
 */
async function getOutboundIp(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    if (!r.ok) throw new Error('lookup service returned HTTP ' + r.status);
    const { ip } = await r.json();
    return res.json({
      success: true,
      outboundIp: ip,
      note: 'Allow-list this exact address in Cashfree > Payouts > Developers > Two-Factor Authentication. A PaaS can egress from more than one address, so re-check if payouts fail later.'
    });
  } catch (error) {
    return res.status(502).json({ success: false, error: 'Could not determine the outbound IP: ' + error.message });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/payroll/disburse/preflight  (admin only)
 *
 * Money-safe production readiness check. Reports which Cashfree environment the server is
 * actually using and whether the credentials authenticate and the server's IP is allow-listed -
 * using read-only calls (balance, or a transfer listing), so it moves and changes nothing. The
 * single most important thing to run after switching to production keys, before funding or any
 * real payout.
 */
async function getDisbursementPreflight(req, res) {
  // Report on the gateway this organisation would actually pay from, not the platform's.
  // A preflight against the wrong account is worse than none: it would report "ready"
  // while the organisation has nothing connected.
  let service;
  try {
    service = await getServiceForOrg(req.user?.orgId || null);
  } catch (err) {
    if (err.code === 'payout_account_not_connected') {
      return res.status(409).json({ success: false, error: err.message, code: err.code, connected: false });
    }
    return res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
  const p = service.provider;
  let host = '';
  try { host = new URL(p.baseUrl).host; } catch (_) { host = String(p.baseUrl || ''); }
  const out = {
    environment: p.environment,
    apiVersion: p.apiVersion,
    baseUrlHost: host,
    isProduction: p.environment === 'production'
  };
  try {
    const { availableBalance } = await p.getBalance();
    out.authenticated = true;
    out.ipWhitelisted = true;
    out.availableBalance = availableBalance;
  } catch (err) {
    const msg = (err.details && err.details.response && err.details.response.message) || err.message || '';
    if (err.notConfigured) {
      const c = await p.verifyConnectivity();
      out.authenticated = c.ok;
      out.ipWhitelisted = c.ok ? true : (/ip/i.test(c.message) ? false : null);
      out.fundSource = 'not configured — set CASHFREE_PAYMENT_INSTRUMENT_ID to enable the balance guard';
      if (!c.ok) out.error = c.message;
    } else {
      out.authenticated = false;
      out.ipWhitelisted = /ip.*(whitelist|allow)/i.test(msg) ? false : null;
      out.error = msg;
    }
  }
  return res.json({ success: true, cashfree: out });
}

async function handleCashfreeWebhook(req, res) {
  try {
    const signature = req.get('x-webhook-signature') || req.get('x-cf-signature');
    const timestamp = req.get('x-webhook-timestamp') || req.get('x-cf-timestamp');
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.rawBody || null);
    const payload = rawBody ? undefined : req.body;

    // Every tenant pays from its own gateway, so there is no longer one secret this
    // callback could be verified against. Cashfree posts all tenants to the same URL, so
    // the organisation has to be worked out from the transfer id BEFORE the signature can
    // be checked. The resolver reads only that id and trusts the index this server wrote
    // at dispatch, never anything else in the unverified body.
    let parsed = payload;
    if (parsed === undefined) {
      try { parsed = JSON.parse(rawBody || '{}'); } catch (_) { parsed = {}; }
    }
    const { transferId, orgId, lookupFailed } = await resolveOrgFromWebhook(webhookDb, parsed);

    // Cashfree registers a webhook URL by pinging it and requiring a 2xx. That ping names
    // no transfer and carries no signature; answering anything else makes Cashfree report
    // the URL as unreachable. It cannot change anything, so acknowledge and discard.
    if (!transferId && !signature) {
      return res.status(200).json({ success: true, probe: true, matched: false, message: 'Webhook endpoint reachable; no transfer in payload.' });
    }

    if (lookupFailed) {
      // Honest 503: Cashfree retries these, where a 4xx would make it give up on a real
      // callback and strand the payout as PENDING until someone reconciles by hand.
      return res.status(503).json({ success: false, error: 'Could not resolve the organization for this transfer; please retry.' });
    }

    // An unknown transfer id resolves to no organisation, so there is no secret to verify
    // against. Refusing here is the point: falling back to the platform's secret would let
    // a forged callback for an invented transfer be accepted.
    if (!orgId) {
      return res.status(401).json({ success: false, error: 'Cashfree webhook rejected: unrecognised transfer.' });
    }

    const service = await getServiceForOrg(orgId);
    const result = await service.handleCashfreeWebhook({ rawBody, signature, timestamp, payload });
    return res.status(200).json(result);
  } catch (error) {
    if (error.code === 'payout_account_not_connected') {
      // The transfer exists but that tenant has since disconnected: retryable, not forged.
      return res.status(503).json({ success: false, error: error.message, code: error.code });
    }
    // 401 for a rejected signature so forged callbacks are visible in logs/monitoring.
    const status = error.name === 'PayoutValidationError' ? (error.statusCode || 400) : 400;
    console.error('[PAYROLL_CTRL] Cashfree webhook handling error:', error.message);
    return res.status(status).json({ success: false, error: error.message });
  }
}

module.exports = {
  documentService,
  disbursementService,
  getOutboundIp,
  getDisbursementPreflight,
  // Document Controllers
  generatePayslip,
  generateBatch,
  exportRegisterExcel,
  exportRegisterPdf,
  getVaultDocuments,
  // Disbursement Controllers
  createDisbursementBatch,
  approveDisbursementBatch,
  executeDisbursementBatch,
  getDisbursementBatchStatus,
  handleCashfreeWebhook,
  reconcileDisbursementBatch
};
