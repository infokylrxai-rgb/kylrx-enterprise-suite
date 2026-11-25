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
const disbursementService = new PayrollDisbursementService();

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

    const result = await disbursementService.approveDisbursementBatch(batchId, checkerId, notes);
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
    const result = await disbursementService.executeCashfreePayoutBatch(batchId, req.body);
    return res.status(200).json(result);
  } catch (error) {
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
    const result = await disbursementService.reconcilePendingTransfers(batchId);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[PAYROLL_CTRL] Reconcile error:', error);
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
    const batch = await disbursementService.getBatch(batchId);
    if (!batch) {
      return res.status(404).json({ success: false, error: `Batch ${batchId} not found.` });
    }
    return res.status(200).json({ success: true, batch });
  } catch (error) {
    console.error('[PAYROLL_CTRL] Batch status error:', error);
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
  const p = disbursementService.provider;
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

    const result = await disbursementService.handleCashfreeWebhook({ rawBody, signature, timestamp, payload });
    return res.status(200).json(result);
  } catch (error) {
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
