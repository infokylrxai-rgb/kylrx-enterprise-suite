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
 *  - PayrollDisbursementService (Decentro Fabric Staging, Maker-Checker, Webhooks)
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
 * Triggers Decentro Fabric payout execution.
 * Requires batch to be APPROVED.
 */
async function executeDisbursementBatch(req, res) {
  try {
    const { batchId } = req.params;
    const result = await disbursementService.executeDecentroPayoutBatch(batchId, req.body);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof MakerCheckerViolationError || error.name === 'MakerCheckerViolationError') {
      return res.status(403).json({
        success: false,
        error: '403_UNAPPROVED_DISBURSEMENT_BLOCKED',
        message: error.message
      });
    }
    console.error('[PAYROLL_CTRL] Execute Decentro payout error:', error);
    return res.status(502).json({ success: false, error: error.message });
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
 * POST /api/payroll/disburse/webhook/decentro
 * Decentro Fabric Asynchronous Webhook Listener.
 * Idempotently reconciles payment status in Firestore.
 */
async function handleDecentroWebhook(req, res) {
  try {
    const payload = req.body;
    const result = await disbursementService.handleDecentroWebhook(payload);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[PAYROLL_CTRL] Decentro webhook handling error:', error);
    return res.status(400).json({ success: false, error: error.message });
  }
}

module.exports = {
  documentService,
  disbursementService,
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
  handleDecentroWebhook
};
