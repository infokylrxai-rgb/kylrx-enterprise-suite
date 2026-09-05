/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PF & EPFO ECR COMPLIANCE ROUTER
 * ============================================================================
 * REST API endpoints for Section 4:
 *   - POST /calculate: Trigger PF & ECR calculation on payroll records
 *   - GET  /template: Download employee PF master CSV / XLS template
 *   - POST /upload-master: Bulk ingestion of PF master profiles
 *   - GET  /exceptions: Query exceptions (missing/invalid UAN, PF Member ID)
 *   - POST /exceptions/:id/resolve: Inline remediation of UAN / Member ID
 *   - GET  /export/:batch_id: Download official EPFO ECR #~# text file
 *   - GET  /execution-logs/:batch_id: Query calculation audit logs
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Compliance Architect
 */

import express from 'express';
import {
  globalPfEcrAutomationEngine,
  EPFO_STATUTORY_RULE_VERSION,
  UAN_12_DIGIT_REGEX,
  PF_MEMBER_ID_REGEX,
} from '../services/pf-ecr-automation-engine.mjs';

import {
  globalEcrFileGenerator,
  ECR_RULE_VERSION,
  getEcrComplianceReturns,
  getEcrComplianceReturnById,
} from '../services/ecr-formatting-file-generator.mjs';

import {
  globalPfChallanReconciliationEngine,
  PF_PROCESS_STAGES,
  PF_STEPPER_RULE_VERSION,
} from '../services/pf-challan-reconciliation-service.mjs';

import {
  globalPfBulkIngestionService,
  clearPfProfileStores,
} from '../services/pf-bulk-ingestion-service.mjs';

import {
  globalEcrSubmissionLifecycleService,
  getSubmissionTrackingById,
  getSubmissionTrackingByRunId,
} from '../services/ecr-submission-lifecycle-service.mjs';

import {
  globalPfReconciliationAlertService,
  getOperationalAlerts,
  getEmployeeLedgersByBatch,
} from '../services/pf-reconciliation-alert-service.mjs';

import {
  globalPfSecurityAuditService,
  PfSecurityAuditService,
  PrivilegedComplianceAccessError,
  AUDIT_ACTION_TYPES,
} from '../services/pf-security-audit-service.mjs';

const router = express.Router();

/**
 * POST /calculate
 * Triggers PF & ECR calculation for a payroll run
 */
router.post('/calculate', async (req, res) => {
  try {
    const payload = req.body || {};
    const records = payload.employees || payload.payroll_records || payload.records || [];
    const runId = payload.payroll_run_id || payload.run_id || `RUN_${Date.now()}`;
    const period = payload.period || payload.wage_period || '2026-09';
    const batchId = payload.batch_id || `BATCH_PF_${runId}`;

    const result = globalPfEcrAutomationEngine.calculatePfBatch({
      batch_id: batchId,
      run_id: runId,
      period,
      payroll_records: records,
      policy_configuration: payload.policy_configuration || {},
    });

    return res.status(200).json({
      success: true,
      data: result,
      rule_version: EPFO_STATUTORY_RULE_VERSION,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'PF_CALCULATION_ERROR',
        message: err.message,
      },
    });
  }
});

/**
 * GET /template
 * Download standard PF Master Profile template
 */
router.get('/template', (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  const headers = [
    'employee_id',
    'employee_name',
    'uan',
    'pf_member_id',
    'pf_applicable',
    'eps_applicable',
    'vpf_percentage',
    'vpf_amount',
    'date_of_joining',
    'date_of_exit',
  ];

  const sampleRows = [
    'EMP001,Rajesh Kumar,100123456789,MH/BAN/0012345/000/0000101,true,true,0,0,2021-04-01,',
    'EMP002,Priya Sharma,100123456790,MH/BAN/0012345/000/0000102,true,true,5,0,2022-06-15,',
    'EMP003,Amit Verma,100123456791,MH/BAN/0012345/000/0000103,true,false,0,2000,2023-01-10,',
  ];

  const csvContent = [headers.join(','), ...sampleRows].join('\r\n');

  if (format === 'xls' || format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', 'attachment; filename="Employee_PF_Master_Template.xls"');
    const tableRows = sampleRows.map((r) => `<tr>${r.split(',').map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    const htmlTable = `<html><body><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
    return res.send(htmlTable);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="Employee_PF_Master_Template.csv"');
  return res.send(csvContent);
});

/**
 * POST /upload-master
 * Transactional ingestion of Employee_PF_Master.xlsx / CSV with row-level validations
 */
router.post('/upload-master', (req, res) => {
  try {
    const payload = req.body || {};
    const input = Array.isArray(payload) ? payload : payload.records || payload.data || payload.file || payload;
    const fileName = payload.file_name || payload.filename || 'Employee_PF_Master.xlsx';
    const batchId = payload.batch_id || `BATCH_PF_UPLOAD_${Date.now()}`;

    const result = globalPfBulkIngestionService.ingestMasterFile(input, {
      file_name: fileName,
      batch_id: batchId,
    });

    // Also sync committed profiles to pf automation engine profile store
    for (const prof of result.committed_profiles) {
      globalPfEcrAutomationEngine.profileStore.upsertProfile(prof);
    }

    return res.status(200).json({
      success: true,
      count: result.committed_rows_count,
      message: `Ingested ${result.committed_rows_count} PF master profiles successfully (${result.rejected_rows_count} rejected).`,
      data: result,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'PF_MASTER_UPLOAD_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * GET /profiles
 * Query committed Employee PF profiles (masked for non-privileged users)
 */
router.get('/profiles', (req, res) => {
  const userRole = req.headers['x-user-role'] || req.query.user_role || req.query.role || req.user?.role || 'PAYROLL_ADMIN';
  const rawProfiles = globalPfBulkIngestionService.getProfiles(req.query);
  const profiles = PfSecurityAuditService.serializePfProfiles(rawProfiles, userRole);
  return res.status(200).json({
    success: true,
    data: {
      total_count: profiles.length,
      is_masked: !PfSecurityAuditService.isPrivilegedRole(userRole),
      user_role: userRole,
      profiles,
    },
  });
});

/**
 * GET /profiles/:id
 * Retrieve single Employee PF profile by employee_id (masked for non-privileged users)
 */
router.get('/profiles/:id', (req, res) => {
  const userRole = req.headers['x-user-role'] || req.query.user_role || req.query.role || req.user?.role || 'PAYROLL_ADMIN';
  const profile = globalPfBulkIngestionService.getProfileById(req.params.id);
  if (!profile) {
    return res.status(404).json({
      success: false,
      error: { code: 'PROFILE_NOT_FOUND', message: `PF profile for employee ${req.params.id} not found.` },
    });
  }
  const serialized = PfSecurityAuditService.serializePfProfile(profile, userRole);
  return res.status(200).json({
    success: true,
    data: serialized,
  });
});

/**
 * GET /rejections/:batch_id
 * Retrieve staging rejection logs for an ingestion batch
 */
router.get('/rejections/:batch_id', (req, res) => {
  const logs = globalPfBulkIngestionService.getRejectionsByBatch(req.params.batch_id);
  return res.status(200).json({
    success: true,
    data: {
      batch_id: req.params.batch_id,
      rejection_count: logs.length,
      rejections: logs,
    },
  });
});

/**
 * GET /exceptions
 * Query open or resolved PF exceptions
 */
router.get('/exceptions', (req, res) => {
  const batchId = req.query.batch_id;
  let allExceptions = [];

  if (batchId && globalPfEcrAutomationEngine.pfExceptions.has(batchId)) {
    allExceptions = globalPfEcrAutomationEngine.pfExceptions.get(batchId);
  } else {
    for (const list of globalPfEcrAutomationEngine.pfExceptions.values()) {
      allExceptions.push(...list);
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      total_count: allExceptions.length,
      exceptions: allExceptions,
    },
  });
});

/**
 * POST /exceptions/:id/resolve
 * Inline remediation of UAN or PF Member ID
 */
router.post('/exceptions/:id/resolve', (req, res) => {
  const exceptionId = req.params.id;
  const { corrected_value, field = 'uan', resolved_by = 'compliance_officer' } = req.body || {};

  let matchedException = null;
  let targetBatchId = null;

  for (const [bId, list] of globalPfEcrAutomationEngine.pfExceptions.entries()) {
    const found = list.find((e) => e.exception_id === exceptionId);
    if (found) {
      matchedException = found;
      targetBatchId = bId;
      break;
    }
  }

  if (!matchedException) {
    return res.status(404).json({
      success: false,
      error: { code: 'EXCEPTION_NOT_FOUND', message: `Exception ${exceptionId} not found.` },
    });
  }

  // Syntax validation
  if (field === 'uan' && !UAN_12_DIGIT_REGEX.test(corrected_value)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_UAN_FORMAT', message: 'UAN must be exactly 12 numeric digits.' },
    });
  }

  if (field === 'pf_member_id' && !PF_MEMBER_ID_REGEX.test(corrected_value)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_MEMBER_ID_FORMAT', message: 'PF Member ID must be standard alphanumeric.' },
    });
  }

  // Update profile
  const profile = globalPfEcrAutomationEngine.profileStore.getProfile(matchedException.employee_id) || {};
  profile[field] = corrected_value;
  globalPfEcrAutomationEngine.profileStore.upsertProfile({
    ...profile,
    employee_id: matchedException.employee_id,
  });

  matchedException.resolved = true;
  matchedException.resolved_at = new Date().toISOString();
  matchedException.resolved_by = resolved_by;
  matchedException.corrected_value = corrected_value;

  return res.status(200).json({
    success: true,
    message: `Resolved ${field.toUpperCase()} for ${matchedException.employee_name}.`,
    data: matchedException,
  });
});

/**
 * GET /export/:batch_id
 * Download official #~# delimited EPFO ECR text file
 * Restricted strictly to privileged compliance roles (PAYROLL_ADMIN, COMPLIANCE_OFFICER)
 */
router.get('/export/:batch_id', (req, res) => {
  const userRole = req.headers['x-user-role'] || req.query.user_role || req.query.role || req.user?.role || 'EMPLOYEE';

  try {
    PfSecurityAuditService.assertPrivilegedAccess(userRole, 'download raw ECR export file');
  } catch (accessErr) {
    return res.status(403).json({
      success: false,
      error: {
        code: accessErr.code || 'ACCESS_DENIED',
        message: accessErr.message,
        details: accessErr.details,
      },
    });
  }

  const batchId = req.params.batch_id;
  let exportFile = globalPfEcrAutomationEngine.exportFiles.get(batchId);

  if (!exportFile) {
    try {
      exportFile = globalPfEcrAutomationEngine.generateEcrExport(batchId);
    } catch (err) {
      return res.status(404).json({
        success: false,
        error: { code: 'EXPORT_NOT_FOUND', message: err.message },
      });
    }
  }

  const format = String(req.query.format || 'txt').toLowerCase();
  if (format === 'json') {
    return res.status(200).json({
      success: true,
      data: exportFile.manifest,
    });
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFile.manifest.file_name}"`);
  return res.send(exportFile.txt);
});

/**
 * GET /execution-logs/:batch_id
 * Retrieve calculation audit logs
 */
router.get('/execution-logs/:batch_id', (req, res) => {
  const batchId = req.params.batch_id;
  const logs = globalPfEcrAutomationEngine.executionLogs.get(batchId) || [];

  return res.status(200).json({
    success: true,
    data: {
      batch_id: batchId,
      rule_version: EPFO_STATUTORY_RULE_VERSION,
      total_logs: logs.length,
      logs,
    },
  });
});

/**
 * POST /generate-ecr
 * Section 5: Field Mapping Engine & Delimiter (#~#) File Generator
 * Generates official ECR .txt file, computes SHA-256, and persists ComplianceReturn
 */
router.post('/generate-ecr', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await globalEcrFileGenerator.generateEcrReturn(payload);

    return res.status(200).json({
      success: true,
      data: result,
      rule_version: ECR_RULE_VERSION,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'ECR_GENERATION_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * GET /compliance-returns
 * Query stored EPF_ECR ComplianceReturns
 */
router.get('/compliance-returns', (req, res) => {
  const returns = getEcrComplianceReturns(req.query);
  return res.status(200).json({
    success: true,
    data: {
      total_count: returns.length,
      returns,
    },
  });
});

/**
 * GET /compliance-returns/:id
 * Retrieve a single EPF_ECR ComplianceReturn by ID
 */
router.get('/compliance-returns/:id', (req, res) => {
  const ret = getEcrComplianceReturnById(req.params.id);
  if (!ret) {
    return res.status(404).json({
      success: false,
      error: { code: 'RETURN_NOT_FOUND', message: `ComplianceReturn ${req.params.id} not found.` },
    });
  }

  return res.status(200).json({
    success: true,
    data: ret,
  });
});

/**
 * ============================================================================
 * SECTION 6: PROCESS FLOW STEPPER & CHALLAN RECONCILIATION ENDPOINTS
 * ============================================================================
 */

/**
 * GET /stepper/:batch_id
 * Retrieve process flow stepper status and transition history
 */
router.get('/stepper/:batch_id', (req, res) => {
  const batchId = req.params.batch_id;
  const stepper = globalPfChallanReconciliationEngine.getOrCreateStepper(batchId, {
    period: req.query.period || '2026-09',
  });

  return res.status(200).json({
    success: true,
    data: stepper.toJSON(),
    rule_version: PF_STEPPER_RULE_VERSION,
  });
});

/**
 * POST /stepper/:batch_id/advance
 * Advance stepper to target stage
 */
router.post('/stepper/:batch_id/advance', (req, res) => {
  try {
    const batchId = req.params.batch_id;
    const { target_stage, actor, comment, details } = req.body || {};

    const stepper = globalPfChallanReconciliationEngine.getOrCreateStepper(batchId);
    stepper.advance(target_stage, {
      actor: actor || 'COMPLIANCE_LEAD',
      comment,
      details,
    });

    return res.status(200).json({
      success: true,
      message: `Advanced to ${target_stage}`,
      data: stepper.toJSON(),
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      error: {
        code: err.code || 'STEPPER_ADVANCE_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * POST /challan/trrn
 * Ingest official TRRN, generation date, statutory due date, and summary figures
 */
router.post('/challan/trrn', (req, res) => {
  try {
    const payload = req.body || {};
    const batchId = payload.batch_id || payload.batchId || `BATCH_PF_${Date.now()}`;

    const result = globalPfChallanReconciliationEngine.ingestTrrn(batchId, payload);
    return res.status(200).json({
      success: true,
      message: 'TRRN and Challan Summary figures ingested successfully. Stepper advanced to CHALLAN_GENERATED.',
      data: result.data,
      stepper: result.stepper,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      error: {
        code: err.code || 'TRRN_INGESTION_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * POST /challan/reconcile-payment
 * Ingest payment confirmation receipt, verify TRRN, cleared amount, bank UTR
 */
router.post('/challan/reconcile-payment', (req, res) => {
  try {
    const payload = req.body || {};
    const batchId = payload.batch_id || payload.batchId;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_BATCH_ID', message: 'batch_id is required for payment reconciliation.' },
      });
    }

    const result = globalPfChallanReconciliationEngine.reconcilePayment(batchId, payload);
    return res.status(200).json({
      success: true,
      message: result.message,
      data: result.challan,
      stepper: result.stepper,
      audit_event: result.audit_event,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      error: {
        code: err.code || 'RECONCILIATION_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * GET /challan/:batch_id
 * Retrieve challan & reconciliation details for a batch
 */
router.get('/challan/:batch_id', (req, res) => {
  const challan = globalPfChallanReconciliationEngine.getChallan(req.params.batch_id);
  if (!challan) {
    return res.status(404).json({
      success: false,
      error: { code: 'CHALLAN_NOT_FOUND', message: `Challan for batch ${req.params.batch_id} not found.` },
    });
  }

  const stepper = globalPfChallanReconciliationEngine.getStepper(req.params.batch_id);

  return res.status(200).json({
    success: true,
    data: challan,
    stepper: stepper ? stepper.toJSON() : null,
  });
});

/**
 * GET /challans
 * List all challans
 */
router.get('/challans', (req, res) => {
  const challans = globalPfChallanReconciliationEngine.getAllChallans();
  return res.status(200).json({
    success: true,
    data: {
      total_count: challans.length,
      challans,
    },
  });
});

/**
 * POST /generate-ecr-lifecycle
 * Ingest validated records, order deterministically, hash with SHA-256,
 * and persist metadata into ComplianceReturn.
 */
router.post('/generate-ecr-lifecycle', (req, res) => {
  try {
    const payload = req.body || {};
    const result = globalEcrSubmissionLifecycleService.generateDeterministicEcrReturn(payload);
    return res.status(200).json({
      success: true,
      message: `Generated deterministic ECR file '${result.file_name}' with SHA-256 hash ${result.file_hash}`,
      data: result,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'ECR_LIFECYCLE_GENERATION_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * POST /submit-ecr
 * Idempotent portal upload and submission tracking pipeline.
 * Replaying with identical payroll_run_id and file_hash returns existing record.
 */
router.post('/submit-ecr', (req, res) => {
  try {
    const payload = req.body || {};
    const result = globalEcrSubmissionLifecycleService.submitEcrToPortal(payload);
    return res.status(200).json({
      success: true,
      is_idempotent_replay: result.is_idempotent_replay,
      message: result.message,
      tracking_id: result.tracking_id,
      data: result.tracking_record,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'ECR_SUBMISSION_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * POST /trrn-response
 * Ingest and store EPFO response containing 13-digit TRRN, Challan Reference, and due date.
 */
router.post('/trrn-response', (req, res) => {
  try {
    const payload = req.body || {};
    const result = globalEcrSubmissionLifecycleService.ingestTrrnResponse(payload);
    return res.status(200).json({
      success: true,
      message: result.message,
      data: result.trrn_details,
      tracking_record: result.tracking_record,
      compliance_return: result.compliance_return,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'TRRN_INGESTION_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * GET /submission/:tracking_id
 * Retrieve submission tracking record and audit status
 */
router.get('/submission/:tracking_id', (req, res) => {
  const record = getSubmissionTrackingById(req.params.tracking_id);
  if (!record) {
    return res.status(404).json({
      success: false,
      error: { code: 'SUBMISSION_NOT_FOUND', message: `Submission tracking record ${req.params.tracking_id} not found.` },
    });
  }
  return res.status(200).json({
    success: true,
    data: record,
  });
});

/**
 * POST /reconcile-clearing
 * Ingest final bank/EPFO clearing statement and reconcile total amounts,
 * account breakdown, and employee lines with discrepancy interception.
 */
router.post('/reconcile-clearing', (req, res) => {
  try {
    const payload = req.body || {};
    const result = globalPfReconciliationAlertService.reconcileClearingStatement(payload);
    const statusCode = result.success ? 200 : 422;
    return res.status(statusCode).json({
      success: result.success,
      status: result.status,
      is_settled: result.is_settled,
      message: result.message,
      data: result,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'CLEARING_RECONCILIATION_FAILED',
        message: err.message,
      },
    });
  }
});

/**
 * GET /alerts
 * Query operational HR alerts (filterable by priority, alert_type, batch_id)
 */
router.get('/alerts', (req, res) => {
  const alerts = getOperationalAlerts(req.query);
  return res.status(200).json({
    success: true,
    data: {
      total_count: alerts.length,
      alerts,
    },
  });
});

/**
 * POST /alerts
 * Dispatch an operational HR compliance alert
 */
router.post('/alerts', (req, res) => {
  try {
    const payload = req.body || {};
    const alert = globalPfReconciliationAlertService.dispatchAlert(payload);
    return res.status(200).json({
      success: true,
      message: `Alert '${alert.alert_id}' dispatched successfully.`,
      data: alert,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: { code: 'ALERT_DISPATCH_FAILED', message: err.message },
    });
  }
});

/**
 * POST /check-overdue
 * Scan for unpaid challans approaching or past the 15th statutory due date
 */
router.post('/check-overdue', (req, res) => {
  try {
    const currentDate = req.body.current_date || new Date();
    const result = globalPfReconciliationAlertService.checkOverdueChallans(currentDate, req.body);
    return res.status(200).json({
      success: true,
      message: `Overdue scan complete: ${result.alerts_count} alert(s) dispatched.`,
      data: result,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: { code: 'OVERDUE_CHECK_FAILED', message: err.message },
    });
  }
});

/**
 * GET /ledgers/:batch_id
 * Retrieve employee payment ledgers for a batch
 */
router.get('/ledgers/:batch_id', (req, res) => {
  const ledgers = getEmployeeLedgersByBatch(req.params.batch_id);
  return res.status(200).json({
    success: true,
    data: {
      batch_id: req.params.batch_id,
      total_count: ledgers.length,
      ledgers,
    },
  });
});

/**
 * POST /audit/record
 * Append-only compliance audit logger endpoint
 */
router.post('/audit/record', (req, res) => {
  try {
    const payload = req.body || {};
    const actorRole = req.headers['x-user-role'] || req.query.role || req.user?.role;
    const actorId = req.headers['x-user-id'] || req.body?.actor_id || 'system_service';

    const event = globalPfSecurityAuditService.recordAuditEvent({
      ...payload,
      actor_id: actorId,
      actor_role: payload.actor_role || actorRole,
    });

    return res.status(200).json({
      success: true,
      data: event,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: { code: 'AUDIT_RECORDING_FAILED', message: err.message },
    });
  }
});

/**
 * GET /audit/trace/:correlation_id
 * Distributed lifecycle trace lookup by correlation ID
 */
router.get('/audit/trace/:correlation_id', (req, res) => {
  const correlationId = req.params.correlation_id;
  const events = globalPfSecurityAuditService.traceAuditTrailByCorrelationId(correlationId);
  return res.status(200).json({
    success: true,
    data: {
      correlation_id: correlationId,
      event_count: events.length,
      events,
    },
  });
});

/**
 * GET /audit/events
 * Query compliance audit events with filtering and pagination
 */
router.get('/audit/events', (req, res) => {
  const result = globalPfSecurityAuditService.getAuditEvents(req.query);
  return res.status(200).json({
    success: true,
    data: result,
  });
});

export default router;
