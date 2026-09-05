/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL DISBURSEMENT MICROSERVICES & ROUTE CONTRACTS
 * ============================================================================
 * Dedicated microservice boundaries, controllers, typed request/response envelopes,
 * and OpenAPI 3.0 route specifications matching the Kylrx AI Payroll Disbursement architecture.
 *
 * Microservices & Endpoints:
 *  1. PayrollService:
 *     - POST /payroll/runs/:id/finalize
 *     - GET  /payroll/runs/:id
 *  2. PaymentBatchService:
 *     - POST /payment-batches
 *     - GET  /payment-batches/:id
 *  3. ValidationService:
 *     - POST /payment-batches/:id/validate
 *     - GET  /payment-batches/:id/issues
 *  4. ApprovalService:
 *     - POST /payment-batches/:id/submit-approval
 *     - POST /payment-batches/:id/approve
 *  5. FileService:
 *     - POST /payment-batches/:id/generate-file
 *  6. BankIntegrationService:
 *     - POST /bank-submissions
 *     - POST /bank-responses/import
 *  7. ComplianceEngine:
 *     - POST /compliance/:scheme/calculate
 *     - POST /compliance/:scheme/generate
 *  8. AuditService:
 *     - GET  /audit?entity_type=...&entity_id=...
 *
 * @version 4.0.0
 * @author Kylrx AI Principal Backend Architect
 */

import crypto from 'node:crypto';
import express from 'express';
import { EightPointValidationGateService } from './eight-point-validation-gate.mjs';
import { executePayrollNpsEngine } from './payroll-triggered-nps-engine.mjs';
import { generateNsdlCraScfFile } from './nsdl-cra-scf-generation-service.mjs';
import { generateEsicMonthlyCsv, computeGratuityLedger } from './statutory-compliance-generators.mjs';
import { generateMonthlyEsicReturnAndChallan } from './esic-return-challan-service.mjs';
import { executeGratuityValidationPipeline } from './gratuity-validation-pipeline.mjs';
import {
  PayrollFreezeGuard,
  BatchStateIsolationManager,
  PayrollFrozenError,
  UnfinalizedRunError,
  BatchStateIsolationError,
  BATCH_DOMAIN_TYPES,
  DOMAIN_LEDGER_REGISTRY,
  freezeStore,
  resetFreezeStore,
} from './payroll-freeze-immutability.mjs';

import {
  ValidationGatekeeper,
  ValidationGatekeeperError,
  MakerCheckerGuard,
  MakerCheckerViolationError,
  DataMaskingService,
  PrivilegedExportSecurityService,
  PrivilegedSecurityError,
  uiPayloadMaskingInterceptor,
} from './authorization-guard-masking.mjs';

import {
  BankExportGenerationEngine,
  bankFileStore,
  computeInstructionKey,
  DistributedLockManager,
  globalLockManager,
  InstructionExecutionStore,
  globalInstructionExecutionStore,
  DuplicateInstructionConflictError,
  DistributedLockConflictError,
  InvalidReissueRequestError,
} from './bank-export-generation-engine.mjs';

import {
  BankResponseReconciliationService,
  ReconciliationExceptionStore,
  DiscrepancyType,
  ExceptionStatus,
  BatchReconciliationLifecycle,
} from './bank-response-reconciliation-service.mjs';

import {
  EsicMultiStagePipeline,
  GratuityRuleEngine,
  NpsValidationAndExportEngine,
} from './statutory-workflows-orchestrator.mjs';

import {
  ComplianceAuditStream,
  globalComplianceAuditStream,
  correlationPropagationMiddleware,
  normalizeEntityType,
  resolveDefaultRuleVersion,
  resolveDefaultActorRole,
} from './compliance-audit-logger.mjs';

import {
  EsicAutomationEngine,
  EmployeeEsicProfileStore,
  globalEsicAutomationEngine,
} from './esic-automation-engine.mjs';

import {
  GratuityAutomationEngine,
  EmployeeGratuityProfileStore,
  globalGratuityAutomationEngine,
} from './gratuity-automation-engine.mjs';

import {
  CorporateNpsAutomationEngine,
  EmployeeNpsProfileStore,
  globalCorporateNpsAutomationEngine,
} from './corporate-nps-automation-engine.mjs';

export const globalReconciliationStore = new ReconciliationExceptionStore();
export const reconciliationService = new BankResponseReconciliationService({
  store: globalReconciliationStore,
  tolerance: 0.01,
});

export {
  PayrollFreezeGuard,
  BatchStateIsolationManager,
  PayrollFrozenError,
  UnfinalizedRunError,
  BatchStateIsolationError,
  BATCH_DOMAIN_TYPES,
  DOMAIN_LEDGER_REGISTRY,
  freezeStore,
  resetFreezeStore,
  ValidationGatekeeper,
  ValidationGatekeeperError,
  MakerCheckerGuard,
  MakerCheckerViolationError,
  DataMaskingService,
  PrivilegedExportSecurityService,
  PrivilegedSecurityError,
  uiPayloadMaskingInterceptor,
  BankExportGenerationEngine,
  bankFileStore,
  computeInstructionKey,
  DistributedLockManager,
  globalLockManager,
  InstructionExecutionStore,
  globalInstructionExecutionStore,
  DuplicateInstructionConflictError,
  DistributedLockConflictError,
  InvalidReissueRequestError,
  BankResponseReconciliationService,
  ReconciliationExceptionStore,
  DiscrepancyType,
  ExceptionStatus,
  BatchReconciliationLifecycle,
  EsicMultiStagePipeline,
  GratuityRuleEngine,
  NpsValidationAndExportEngine,
  ComplianceAuditStream,
  globalComplianceAuditStream,
  correlationPropagationMiddleware,
  normalizeEntityType,
  resolveDefaultRuleVersion,
  resolveDefaultActorRole,
  EsicAutomationEngine,
  EmployeeEsicProfileStore,
  globalEsicAutomationEngine,
  GratuityAutomationEngine,
  EmployeeGratuityProfileStore,
  globalGratuityAutomationEngine,
  CorporateNpsAutomationEngine,
  EmployeeNpsProfileStore,
  globalCorporateNpsAutomationEngine,
};

/**
 * In-Memory Data Stores for Microservice Boundaries.
 */
export const store = {
  payrollRuns: new Map(),
  payrollRunSnapshots: freezeStore.snapshotsByRunId,
  paymentBatches: new Map(),
  validationIssuesByBatch: new Map(),
  disbursementFiles: new Map(),
  bankFiles: bankFileStore,
  reconciliationExceptions: globalReconciliationStore.exceptions,
  bankSubmissions: new Map(),
  /** General-purpose audit log — all events across all microservices. */
  auditLogs: [],
  /**
   * Dedicated state-transition ledger — append-only, immutable entries.
   * Each entry matches the canonical contract:
   *   { entity, entity_id, from, to, actor_id, timestamp, correlation_id, … }
   */
  stateTransitionLogs: [],
  eventBusListeners: new Map(),
};

/**
 * Resets all microservice stores for clean test isolation.
 */
export function resetDisbursementMicroserviceStores() {
  store.payrollRuns.clear();
  store.paymentBatches.clear();
  store.validationIssuesByBatch.clear();
  store.disbursementFiles.clear();
  store.bankSubmissions.clear();
  store.auditLogs.length = 0;
  store.stateTransitionLogs.length = 0;
  store.eventBusListeners.clear();
  resetFreezeStore();
  bankFileStore.clear();
  globalInstructionExecutionStore.clear();
  globalLockManager.clear();
  globalReconciliationStore.clear();
  globalComplianceAuditStream.clear();
}

/**
 * Constructs a standardized Success API Envelope.
 *
 * @param {any} data
 * @param {Object} [meta={}]
 * @returns {Object} ApiSuccessEnvelope
 */
export function successEnvelope(data, meta = {}) {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      request_id: meta.request_id || `req_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      version: '4.0.0',
      immutable: meta.immutable !== undefined ? meta.immutable : false,
      ...meta,
    },
  };
}

/**
 * Constructs a standardized Error API Envelope.
 *
 * @param {string} code
 * @param {string} message
 * @param {any} [details=null]
 * @param {string} [requestId]
 * @returns {Object} ApiErrorEnvelope
 */
export function errorEnvelope(code, message, details = null, requestId = null) {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      request_id: requestId || `req_err_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    },
  };
}

/**
 * Appends an immutable general audit log entry.
 * Used for non-state-transition events (file generation, bank submission, etc.).
 */
export function recordAuditLog({ entityType, entityId, event, actorId, actorRole, metadata = {} }) {
  const sanitizedMetadata = DataMaskingService.maskLogOutput(metadata);
  const logEntry = Object.freeze({
    log_id:     `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    entity_type: entityType,
    entity_id:   entityId,
    event,
    actor_id:    actorId || 'system',
    actor_role:  actorRole || 'SYSTEM_SERVICE',
    timestamp:   new Date().toISOString(),
    metadata:    Object.freeze({ ...sanitizedMetadata }),
  });
  store.auditLogs.push(logEntry);
  return logEntry;
}

/**
 * Records a canonical state-transition event log entry satisfying Criterion 11.
 *
 * Appends to the centralized append-only immutable stream (ComplianceAuditStream),
 * and mirrors into store.stateTransitionLogs and store.auditLogs.
 *
 * @param {Object} params
 * @param {string} [params.entity]               - Entity type (e.g. 'payroll_run' | 'payment_batch' | 'compliance_return')
 * @param {string} [params.entity_type]          - PascalCase entity type
 * @param {string} [params.entityId]             - Primary key
 * @param {string} [params.entity_id]            - Primary key
 * @param {string} [params.from]                 - Source state (null for creation)
 * @param {string} [params.from_state]           - Source state
 * @param {string} [params.to]                   - Destination state
 * @param {string} [params.to_state]             - Destination state
 * @param {string} [params.actorId]              - Actor ID
 * @param {string} [params.actor_id]             - Actor ID
 * @param {string} [params.actorRole]            - Actor role
 * @param {string} [params.actor_role]           - Actor role
 * @param {string} [params.ruleVersionApplied]   - Rule version applied
 * @param {string} [params.rule_version_applied] - Rule version applied
 * @param {string} [params.correlationId]        - Distributed correlation ID
 * @param {string} [params.correlation_id]       - Distributed correlation ID
 * @param {Object} [params.metadata]             - Additional context
 * @returns {Object} Deep-frozen, immutable ComplianceAuditEvent
 */
export function recordStateTransition({
  entity,
  entity_type,
  entityId,
  entity_id,
  from,
  from_state,
  to,
  to_state,
  actorId,
  actor_id,
  actorRole,
  actor_role,
  ruleVersionApplied,
  rule_version_applied,
  correlationId,
  correlation_id,
  timestamp,
  metadata = {},
}) {
  const auditEvent = globalComplianceAuditStream.appendEvent({
    entity_type: entity_type || entity,
    entity_id: entity_id || entityId,
    from_state: from_state !== undefined ? from_state : from,
    to_state: to_state !== undefined ? to_state : to,
    actor_id: actor_id || actorId,
    actor_role: actor_role || actorRole || metadata?.actor_role,
    rule_version_applied: rule_version_applied || ruleVersionApplied || metadata?.rule_version_applied,
    correlation_id: correlation_id || correlationId,
    timestamp,
    metadata,
  });

  // Append to store.stateTransitionLogs for backward compatibility
  store.stateTransitionLogs.push(auditEvent);

  // Mirror into the general audit log so unified queries still work
  store.auditLogs.push(Object.freeze({
    log_id:      `aud_st_${auditEvent.event_id}`,
    entity_type: auditEvent.entity_type.toUpperCase(),
    entity_id:   auditEvent.entity_id,
    event:       `STATE_TRANSITION:${auditEvent.from_state || 'CREATED'}→${auditEvent.to_state}`,
    actor_id:    auditEvent.actor_id,
    actor_role:  auditEvent.actor_role,
    timestamp:   auditEvent.timestamp,
    metadata:    Object.freeze({
      from: auditEvent.from_state,
      to: auditEvent.to_state,
      correlation_id: auditEvent.correlation_id,
      rule_version_applied: auditEvent.rule_version_applied,
      ...metadata,
    }),
  }));

  return auditEvent;
}

// ============================================================================
// 1. PAYROLL SERVICE & CONTROLLER (CRITERIA 1: PAYROLL FREEZE)
// ============================================================================
export class PayrollService {
  static async finalizeRun(runId, payload = {}) {
    const run = store.payrollRuns.get(runId);
    if (!run) {
      const error = new Error(`Payroll run with ID '${runId}' not found.`);
      error.statusCode = 404;
      error.code = 'PAYROLL_RUN_NOT_FOUND';
      throw error;
    }

    if (run.status === 'FINALIZED' || run.is_immutable) {
      const error = new Error(`Payroll run '${runId}' is already FINALIZED and immutable.`);
      error.statusCode = 409;
      error.code = 'PAYROLL_RUN_ALREADY_FINALIZED';
      throw error;
    }

    const prevStatus = run.status || 'DRAFT';
    const adminId = payload.admin_id || 'payroll_admin@kylrx.ai';

    // ── Criteria 1: Create versioned, read-only frozen snapshot ─────────────
    const snapshot = PayrollFreezeGuard.snapshotPayrollRun(run, payload);

    // ── State-transition log (canonical contract shape) ────────────────────
    recordStateTransition({
      entity:        'payroll_run',
      entityId:      runId,
      from:          prevStatus,
      to:            'FINALIZED',
      actorId:       adminId,
      correlationId: payload.correlation_id,
      metadata:      {
        snapshot_id:     snapshot.snapshot_id,
        period:          run.period,
        gross_payroll:   snapshot.totals.total_gross_earnings,
        net_payable:     snapshot.totals.total_net_payable,
        total_employees: snapshot.totals.total_headcount,
        checksum:        snapshot.checksum_sha256,
      },
    });

    // ── General audit log (event narrative) ───────────────────────────────
    recordAuditLog({
      entityType: 'PAYROLL_RUN',
      entityId:   runId,
      event:      'PAYROLL_FINALIZED',
      actorId:    adminId,
      actorRole:  'PAYROLL_ADMIN',
      metadata:   {
        snapshot_id:     snapshot.snapshot_id,
        period:          run.period,
        gross_payroll:   snapshot.totals.total_gross_earnings,
        net_payable:     snapshot.totals.total_net_payable,
        total_employees: snapshot.totals.total_headcount,
        checksum:        snapshot.checksum_sha256,
      },
    });

    // Notify registered event listeners
    const listeners = store.eventBusListeners.get('PAYROLL_FINALIZED') || [];
    for (const listener of listeners) {
      try {
        await listener({ run_id: runId, run, snapshot });
      } catch (e) {
        console.error(`[EVENT_BUS] Error in PAYROLL_FINALIZED listener:`, e);
      }
    }

    return {
      run_id: run.run_id,
      snapshot_id: snapshot.snapshot_id,
      version: snapshot.version,
      period: run.period,
      status: run.status,
      total_employees: snapshot.totals.total_headcount,
      gross_payroll: snapshot.totals.total_gross_earnings,
      total_deductions: snapshot.totals.total_employee_deductions,
      net_payable: snapshot.totals.total_net_payable,
      finalized_at: run.finalized_at,
      finalized_by: run.finalized_by,
      checksum_sha256: snapshot.checksum_sha256,
      is_immutable: true,
      is_frozen: true,
    };
  }

  static async getRun(runId) {
    const run = store.payrollRuns.get(runId);
    if (!run) {
      const error = new Error(`Payroll run with ID '${runId}' not found.`);
      error.statusCode = 404;
      error.code = 'PAYROLL_RUN_NOT_FOUND';
      throw error;
    }
    return run;
  }

  /**
   * Criteria 1 Immutability Guard: Rejects any attempt to mutate a finalized run.
   */
  static async updateRun(runId, patch = {}) {
    const run = store.payrollRuns.get(runId);
    if (!run) {
      const error = new Error(`Payroll run with ID '${runId}' not found.`);
      error.statusCode = 404;
      error.code = 'PAYROLL_RUN_NOT_FOUND';
      throw error;
    }

    // Strict immutability check
    PayrollFreezeGuard.assertRunMutable(run, 'UPDATE_RUN');

    Object.assign(run, patch);
    return run;
  }

  /**
   * Retrieves the versioned, read-only frozen snapshot.
   */
  static async getSnapshot(runId) {
    return PayrollFreezeGuard.getFrozenSnapshot(runId);
  }
}

// ============================================================================
// 2. PAYMENT BATCH SERVICE & CONTROLLER (CRITERIA 4: BATCH STATE ISOLATION)
// ============================================================================
export class PaymentBatchService {
  static async createBatch(payload) {
    if (!payload.run_id) {
      const error = new Error('run_id is required to create a payment batch.');
      error.statusCode = 400;
      error.code = 'MISSING_RUN_ID';
      throw error;
    }

    const run = store.payrollRuns.get(payload.run_id);
    if (!run) {
      const error = new Error(`Associated payroll run '${payload.run_id}' not found.`);
      error.statusCode = 404;
      error.code = 'PAYROLL_RUN_NOT_FOUND';
      throw error;
    }

    // ── Criteria 1: Downstream payment calculation reads strictly from frozen snapshot ──
    let snapshot = store.payrollRunSnapshots.get(payload.run_id);
    if (!snapshot && run.status === 'FINALIZED') {
      snapshot = PayrollFreezeGuard.snapshotPayrollRun(run);
    }

    if (payload.require_freeze && !snapshot) {
      throw new UnfinalizedRunError(
        `Cannot create payment batch: Payroll run '${payload.run_id}' is in state '${run.status || 'DRAFT'}'. ` +
        `A finalized and frozen snapshot is strictly required for downstream payment calculations.`,
        payload.run_id
      );
    }

    // ── Criteria 4: Isolated domain batch creation with unique IDs, schedule dates, & ledgers ──
    const batchType = (payload.batch_type || 'SALARY').toUpperCase();
    const makerId = payload.maker_id || 'maker@kylrx.ai';
    const batchId = `BATCH_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const scheduledDate = payload.scheduled_date || payload.scheduled_payment_date ||
      BatchStateIsolationManager.calculateDefaultPaymentDate(run.period || '2026-08', batchType);

    const defaultLedger = DOMAIN_LEDGER_REGISTRY[batchType] || DOMAIN_LEDGER_REGISTRY.SALARY;
    const ledgerReferences = {
      general_ledger_code: payload.ledger_references?.general_ledger_code || defaultLedger.general_ledger_code,
      liability_account: payload.ledger_references?.liability_account || defaultLedger.liability_account,
      contra_account: payload.ledger_references?.contra_account || defaultLedger.contra_account,
      cost_center: payload.ledger_references?.cost_center || defaultLedger.cost_center,
      journal_voucher_ref: payload.ledger_references?.journal_voucher_ref || `${defaultLedger.journal_voucher_ref}-${run.period || '2026-08'}`,
    };

    // Source employee list: strictly from frozen snapshot if available, else run.employees
    const employeeSource = snapshot ? snapshot.employees : (run.employees || []);

    const records = employeeSource.map((emp, idx) => {
      const gross = Number(emp.gross_earnings ?? emp.gross ?? 0);
      const deductions = Number(emp.total_deductions ?? emp.deductions ?? 0);
      const net = Number(emp.net_payable ?? emp.net_salary ?? emp.net ?? (gross - deductions) ?? 0);
      const ref = emp.payment_reference || emp.client_ref || `REF_${batchId.slice(-6)}_${idx + 1}`;

      return {
        employee_id: emp.employee_id || `EMP_${idx + 1}`,
        employee_name: emp.employee_name || emp.name || `Employee ${idx + 1}`,
        account_number: String(emp.bank_account_number || emp.account_number || emp.bank_account || `50100${String(idx + 1).padStart(7, '0')}`),
        ifsc_code: String(emp.ifsc_code || emp.ifsc || 'HDFC0001234'),
        gross_earnings: gross,
        total_deductions: deductions,
        net_payable: net,
        net_payable_amount: net,
        amount: net,
        payment_reference: ref,
        status: 'STAGED',
        clearing_status: 'PENDING',
      };
    });

    const totalAmount = records.reduce((sum, r) => sum + r.net_payable, 0);

    const batch = {
      batch_id: batchId,
      run_id: payload.run_id,
      snapshot_id: snapshot ? snapshot.snapshot_id : null,
      batch_type: batchType,
      state: 'DRAFT',
      status: 'DRAFT',
      scheduled_payment_date: scheduledDate,
      ledger_references: ledgerReferences,
      debit_account_number: payload.debit_account_number || '50200012345678',
      maker_id: makerId,
      checker_id: null,
      total_records: records.length,
      total_amount: Math.round(totalAmount * 100) / 100,
      summary: {
        total_amount: Math.round(totalAmount * 100) / 100,
        record_count: records.length,
      },
      records,
      is_settled: false,
      settled_at: null,
      bank_ref: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    store.paymentBatches.set(batchId, batch);
    freezeStore.isolatedBatches.set(batchId, batch);

    // ── State-transition log (creation → DRAFT) ────────────────────────────
    recordStateTransition({
      entity:        'payment_batch',
      entityId:      batch.batch_id,
      from:          null,
      to:            'DRAFT',
      actorId:       makerId,
      correlationId: payload.correlation_id,
      metadata:      {
        run_id: payload.run_id,
        snapshot_id: batch.snapshot_id,
        batch_type: batch.batch_type,
        total_amount: batch.total_amount,
        records_count: batch.records.length,
        scheduled_payment_date: batch.scheduled_payment_date,
        ledger_references: batch.ledger_references,
      },
    });

    recordAuditLog({
      entityType: 'PAYMENT_BATCH',
      entityId:   batch.batch_id,
      event:      'BATCH_CREATED',
      actorId:    makerId,
      actorRole:  'PAYROLL_MAKER',
      metadata:   {
        run_id: payload.run_id,
        snapshot_id: batch.snapshot_id,
        batch_type: batch.batch_type,
        total_amount: batch.total_amount,
        records_count: batch.records.length,
        scheduled_payment_date: batch.scheduled_payment_date,
        ledger_references: batch.ledger_references,
      },
    });

    return batch;
  }

  /**
   * Criteria 4: Independent Batch Settlement Engine.
   * Settles a specific batch without cascading to or updating any other batch.
   */
  static async settleBatch(batchId, payload = {}) {
    const result = BatchStateIsolationManager.settleBatchIndependently(batchId, payload);
    const updatedBatch = freezeStore.isolatedBatches.get(batchId);
    if (updatedBatch) {
      store.paymentBatches.set(batchId, updatedBatch);
    }
    return result;
  }

  static async getBatch(batchId) {
    const batch = store.paymentBatches.get(batchId);
    if (!batch) {
      const error = new Error(`Payment batch with ID '${batchId}' not found.`);
      error.statusCode = 404;
      error.code = 'PAYMENT_BATCH_NOT_FOUND';
      throw error;
    }
    return batch;
  }
}

// ============================================================================
// 3. VALIDATION SERVICE & CONTROLLER
// ============================================================================

/**
 * Normalises a raw gate issue (EightPointValidationGateService shape) into the
 * standardised slim envelope required by the API contract:
 *   { code, employee_id, field, severity, message }
 *
 * Severity mapping:
 *   BLOCKING  → 'BLOCK'
 *   WARNING   → 'WARN'
 *   (others)  → 'INFO'
 */
function _normaliseIssue(raw) {
  const severityMap = { BLOCKING: 'BLOCK', WARNING: 'WARN' };
  return {
    code: raw.code || raw.issue_id || 'UNKNOWN',
    employee_id: raw.employee_id || 'SYSTEM',
    field: raw.field || null,
    severity: severityMap[raw.severity] || raw.severity || 'INFO',
    message: raw.message || 'No detail provided.',
  };
}

export class ValidationService {
  /**
   * POST /payment-batches/:id/validate
   *
   * Runs the 8-point deterministic gate across all batch records and returns the
   * standardised response envelope:
   *
   *  {
   *    batch_id:        string,
   *    status:          'BLOCKED' | 'VALIDATED',
   *    issues:          Array<{ code, employee_id, field, severity, message }>,
   *    blocking_count:  number
   *  }
   *
   * Side-effects:
   *  - Persists normalised issues to store.validationIssuesByBatch for ApprovalService guard.
   *  - Transitions batch.state → 'VALIDATED' | 'VALIDATION_FAILED'.
   *  - Writes an immutable audit log entry.
   */
  static async validateBatch(batchId, options = {}) {
    const batch = await PaymentBatchService.getBatch(batchId);

    const gateService = new EightPointValidationGateService();
    const gateResult = gateService.evaluate(batch, batch.records, {
      // Default isApproved true so callers that haven't yet set state=APPROVED
      // can still run structural validation without a gate-01 false-positive.
      isApproved: options.isApproved !== undefined ? options.isApproved : true,
      debitAccountNumber: batch.debit_account_number,
      ...options,
    });

    // ── Normalise to the contract-required slim shape ──────────────────────
    const rawIssues = gateResult.all_issues || [];
    const normalisedIssues = rawIssues.map(_normaliseIssue);

    const blockingCount = normalisedIssues.filter((i) => i.severity === 'BLOCK').length;
    const isBlocked = blockingCount > 0;
    const status = isBlocked ? 'BLOCKED' : 'VALIDATED';

    // ── Persist normalised issues (ApprovalService guard will read this) ───
    store.validationIssuesByBatch.set(batchId, normalisedIssues);

    // ── FSM transition ─────────────────────────────────────────────────────
    const prevBatchState = batch.state || 'DRAFT';
    const nextBatchState = isBlocked ? 'VALIDATION_FAILED' : 'VALIDATED';
    batch.state          = nextBatchState;
    batch.updated_at     = new Date().toISOString();

    // ── Freeze a validated amounts snapshot for the drift guard ────────────
    // Captured only on a clean (non-blocked) validation cycle so that the snapshot
    // always reflects the totals that were signed-off as structurally sound.
    if (!isBlocked) {
      batch.validated_amounts_snapshot = {
        total_amount:    batch.total_amount,
        record_count:    batch.records.length,
        // SHA-256 over the per-record net-payable amounts for O(1) drift comparison.
        amounts_hash:    crypto
          .createHash('sha256')
          .update(JSON.stringify(batch.records.map((r) => ({ id: r.employee_id, amt: r.net_payable }))))
          .digest('hex'),
        snapshotted_at:  new Date().toISOString(),
      };
    }

    // ── State-transition log ───────────────────────────────────────────────
    recordStateTransition({
      entity:    'payment_batch',
      entityId:  batchId,
      from:      prevBatchState,
      to:        nextBatchState,
      actorId:   'system_validator',
      metadata:  { status, blocking_count: blockingCount, total_issues: normalisedIssues.length },
    });

    // ── Immutable audit trail ───────────────────────────────────────────────
    recordAuditLog({
      entityType: 'PAYMENT_BATCH',
      entityId:   batchId,
      event:      'VALIDATION_PERFORMED',
      actorId:    'system_validator',
      actorRole:  'SYSTEM_SERVICE',
      metadata:   { status, blocking_count: blockingCount, total_issues: normalisedIssues.length },
    });

    // ── Exact contract envelope ─────────────────────────────────────────────
    return {
      batch_id:       batchId,
      status,
      issues:         normalisedIssues,
      blocking_count: blockingCount,
    };
  }

  /**
   * GET /payment-batches/:id/issues
   *
   * Returns the persisted normalised issue list for a batch.
   */
  static async getIssues(batchId) {
    await PaymentBatchService.getBatch(batchId);
    const issues = store.validationIssuesByBatch.get(batchId) || [];
    const blockingCount = issues.filter((i) => i.severity === 'BLOCK').length;
    return {
      batch_id:       batchId,
      issues_count:   issues.length,
      blocking_count: blockingCount,
      issues,
    };
  }
}

// ============================================================================
// 4. APPROVAL SERVICE & CONTROLLER (MAKER-CHECKER)
// ============================================================================
export class ApprovalService {
  /**
   * POST /payment-batches/:id/submit-approval
   *
   * Preconditions (all must hold, in order):
   *   1. Batch must be in the strict 'VALIDATED' state — any other state yields 400.
   *   2. Zero BLOCK-severity validation issues in store — yields 422 if violated.
   *
   * Side-effects:
   *   - Persists maker_id onto batch.maker_id (canonical identity for the SoD check).
   *   - Copies validated_amounts_snapshot → batch.approval_amounts_snapshot to freeze
   *     the amount baseline that the checker will compare against at approval time.
   *   - Transitions batch.state → 'PENDING_APPROVAL'.
   *   - Writes an immutable audit log entry.
   */
  static async submitApproval(batchId, payload = {}) {
    const batch = await PaymentBatchService.getBatch(batchId);

    // ── Pre-condition 1: Strictly VALIDATED ───────────────────────────────
    // Only a batch that has passed a clean (zero-block) validation cycle may
    // enter the maker-checker pipeline. DRAFT, VALIDATION_FAILED, and any
    // post-approval state are all rejected here to prevent bypassing validation.
    if (batch.state !== 'VALIDATED') {
      const error = new Error(
        `Cannot submit batch '${batchId}' for approval: batch is in state '${batch.state}'. ` +
        `Only batches in the 'VALIDATED' state (zero blocking issues) may be submitted.`
      );
      error.statusCode = 400;
      error.code       = 'INVALID_SUBMISSION_STATE';
      error.details    = { batch_id: batchId, current_state: batch.state, required_state: 'VALIDATED' };
      throw error;
    }

    // ── Pre-condition 2: Zero BLOCK-severity validation issues ─────────────
    // Acts as a defence-in-depth guard: if the store still holds BLOCK issues
    // (e.g. from a prior failed run that was not re-validated), reject here.
    const storedIssues  = store.validationIssuesByBatch.get(batchId) || [];
    const blockingCount = storedIssues.filter((i) => i.severity === 'BLOCK').length;

    if (blockingCount > 0) {
      const error = new Error(
        `Disbursement approval blocked: ${blockingCount} unresolved BLOCK-severity validation issue(s) ` +
        `exist on batch '${batchId}'. Resolve all BLOCK issues and re-validate before re-submitting.`
      );
      error.statusCode = 422;
      error.code       = 'APPROVAL_BLOCKED_BY_VALIDATION';
      error.details    = {
        batch_id:        batchId,
        blocking_count:  blockingCount,
        blocking_issues: storedIssues.filter((i) => i.severity === 'BLOCK'),
      };
      throw error;
    }

    // ── Persist maker identity (canonical for SoD check in approveBatch) ──
    const makerId = payload.maker_id || batch.maker_id || 'maker@kylrx.ai';
    batch.maker_id = makerId;

    // ── Freeze approval amounts baseline for drift detection ──────────────
    // At submit time we copy the validated_amounts_snapshot (written by
    // ValidationService) into batch.approval_amounts_snapshot.  If the
    // snapshot is missing (e.g. in legacy data), we compute it now.
    if (batch.validated_amounts_snapshot) {
      batch.approval_amounts_snapshot = { ...batch.validated_amounts_snapshot };
    } else {
      batch.approval_amounts_snapshot = {
        total_amount:   batch.total_amount,
        record_count:   batch.records.length,
        amounts_hash:   crypto
          .createHash('sha256')
          .update(JSON.stringify(batch.records.map((r) => ({ id: r.employee_id, amt: r.net_payable }))))
          .digest('hex'),
        snapshotted_at: new Date().toISOString(),
      };
    }

    // ── FSM transition: VALIDATED → PENDING_APPROVAL ───────────────────────
    const prevApprovalState = batch.state;
    batch.state      = 'PENDING_APPROVAL';
    batch.updated_at = new Date().toISOString();

    recordStateTransition({
      entity:        'payment_batch',
      entityId:      batchId,
      from:          prevApprovalState,
      to:            'PENDING_APPROVAL',
      actorId:       makerId,
      correlationId: payload.correlation_id,
      metadata:      { comments: payload.comments },
    });

    recordAuditLog({
      entityType: 'PAYMENT_BATCH',
      entityId:   batchId,
      event:      'SUBMITTED_FOR_APPROVAL',
      actorId:    makerId,
      actorRole:  'PAYROLL_MAKER',
      metadata:   {
        comments:                 payload.comments,
        approval_amounts_snapshot: batch.approval_amounts_snapshot,
      },
    });

    return {
      batch_id:                  batchId,
      state:                     batch.state,
      maker_id:                  batch.maker_id,
      checker_id:                null,
      approval_timestamp:        batch.updated_at,
      approval_amounts_snapshot: batch.approval_amounts_snapshot,
    };
  }

  /**
   * POST /payment-batches/:id/approve
   *
   * Preconditions (all must hold, in order):
   *   1. Batch must be in 'PENDING_APPROVAL' state.
   *   2. Strict Segregation of Duties: checker_id must differ from batch.maker_id (403).
   *   3. Amount-drift guard: current batch totals must match the frozen
   *      approval_amounts_snapshot captured at submit time (409).
   *
   * Side-effects:
   *   - Transitions batch.state → 'APPROVED' (or 'REJECTED' for REJECT decisions).
   *   - Writes batch.approved_snapshot with a content SHA-256 over all records.
   *   - Writes an immutable audit log entry.
   */
  static async approveBatch(batchId, payload = {}) {
    const batch = await PaymentBatchService.getBatch(batchId);

    // ── Pre-condition 1: Must be PENDING_APPROVAL ──────────────────────────
    if (batch.state !== 'PENDING_APPROVAL') {
      const error = new Error(
        `Batch '${batchId}' is not in PENDING_APPROVAL state (current: '${batch.state}').`
      );
      error.statusCode = 400;
      error.code       = 'BATCH_NOT_PENDING_APPROVAL';
      throw error;
    }

    const checkerId = payload.checker_id || 'checker@kylrx.ai';

    // ── Pre-condition 2: Segregation of Duties (Criteria 3) ───────────────
    // The checker (approver) MUST be a different identity from the maker/creator/submitter.
    // Self-approval is categorically prohibited and logs an authorization failure event.
    try {
      MakerCheckerGuard.assertSeparationOfDuties({
        batch,
        requestingUserId: checkerId,
        auditLogger: recordAuditLog,
      });
    } catch (err) {
      if (err instanceof MakerCheckerViolationError) {
        const error = new Error(err.message);
        error.statusCode = 403;
        error.code       = 'SELF_APPROVAL_PROHIBITED';
        error.details    = err.details;
        throw error;
      }
      throw err;
    }

    // ── Pre-condition 2B: Validation Gatekeeper (Criteria 2) ───────────────
    // Prevent transitioning to APPROVED while unresolved records exist in ValidationIssue where severity === 'BLOCK'.
    // Reject violations with a 422 Unprocessable Entity including the blocking error count.
    const storedIssues = store.validationIssuesByBatch.get(batchId) || [];
    ValidationGatekeeper.assertCanTransition({
      batch,
      targetState: 'APPROVED',
      validationIssues: storedIssues,
    });

    // ── Pre-condition 3: Amount-drift detection ────────────────────────────
    // Recompute current totals and compare against the snapshot frozen at
    // submit time to guarantee that no payment record was mutated between
    // validation, submission, and final approval.
    const snapshot = batch.approval_amounts_snapshot;
    if (snapshot) {
      const currentTotalAmount = batch.records.reduce((sum, r) => sum + (r.net_payable || 0), 0);
      const currentAmountsHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(batch.records.map((r) => ({ id: r.employee_id, amt: r.net_payable }))))
        .digest('hex');

      const totalDrifted = Math.abs(currentTotalAmount - snapshot.total_amount) > 0.001;
      const hashDrifted  = currentAmountsHash !== snapshot.amounts_hash;

      if (totalDrifted || hashDrifted) {
        const error = new Error(
          `Amount-drift detected on batch '${batchId}': underlying payment amounts have changed ` +
          `since validation was performed. Re-validate the batch before re-submitting for approval.`
        );
        error.statusCode = 409;
        error.code       = 'AMOUNT_DRIFT_DETECTED';
        error.details    = {
          batch_id:            batchId,
          snapshot_total:      snapshot.total_amount,
          current_total:       Math.round(currentTotalAmount * 100) / 100,
          snapshot_hash:       snapshot.amounts_hash,
          current_hash:        currentAmountsHash,
          snapshot_taken_at:   snapshot.snapshotted_at,
        };
        throw error;
      }
    }

    const decision = payload.decision || 'APPROVE';
    const nowIso   = new Date().toISOString();

    // ── REJECT path ────────────────────────────────────────────────────────
    if (decision === 'REJECT') {
      recordStateTransition({
        entity:        'payment_batch',
        entityId:      batchId,
        from:          'PENDING_APPROVAL',
        to:            'REJECTED',
        actorId:       checkerId,
        correlationId: payload.correlation_id,
        metadata:      { comments: payload.comments, maker_id: batch.maker_id },
      });

      batch.state      = 'REJECTED';
      batch.checker_id = checkerId;
      batch.updated_at = nowIso;

      recordAuditLog({
        entityType: 'PAYMENT_BATCH',
        entityId:   batchId,
        event:      'BATCH_REJECTED',
        actorId:    checkerId,
        actorRole:  'PAYROLL_CHECKER',
        metadata:   { comments: payload.comments },
      });

      return {
        batch_id:           batchId,
        state:              batch.state,
        maker_id:           batch.maker_id,
        checker_id:         checkerId,
        approval_timestamp: nowIso,
      };
    }

    // ── APPROVE path ───────────────────────────────────────────────────────
    recordStateTransition({
      entity:        'payment_batch',
      entityId:      batchId,
      from:          'PENDING_APPROVAL',
      to:            'APPROVED',
      actorId:       checkerId,
      correlationId: payload.correlation_id,
      metadata:      { comments: payload.comments, maker_id: batch.maker_id },
    });

    batch.state      = 'APPROVED';
    batch.checker_id = checkerId;
    batch.updated_at = nowIso;
    batch.approved_snapshot = {
      total_amount:  batch.total_amount,
      record_count:  batch.total_records,
      // Full-record SHA-256 for downstream file-generation drift guard
      checksum:      crypto.createHash('sha256').update(JSON.stringify(batch.records)).digest('hex'),
      approved_at:   nowIso,
      checker_id:    checkerId,
    };

    recordAuditLog({
      entityType: 'PAYMENT_BATCH',
      entityId:   batchId,
      event:      'BATCH_APPROVED',
      actorId:    checkerId,
      actorRole:  'PAYROLL_CHECKER',
      metadata:   { approved_snapshot: batch.approved_snapshot, comments: payload.comments },
    });

    return {
      batch_id:           batchId,
      state:              batch.state,
      maker_id:           batch.maker_id,
      checker_id:         checkerId,
      approval_timestamp: nowIso,
      approved_snapshot:  batch.approved_snapshot,
    };
  }
}

// ============================================================================
// 5. FILE SERVICE & CONTROLLER
// ============================================================================

/**
 * NEFT threshold (RBI): transactions >= 2,00,000 INR should use RTGS.
 * Below this threshold the instruction is classified as NEFT.
 */
const RTGS_THRESHOLD_INR = 200000;

/**
 * Builds a NEFT/RTGS-formatted salary disbursement CSV.
 * Each row carries a `Payment Mode` column (NEFT | RTGS) based on the
 * individual net-payable amount vs the RBI RTGS threshold.
 *
 * Format:
 *   Seq No | Txn ID | Employee ID | Employee Name | Account Number
 *         | IFSC | Net Payable | Payment Mode | Payment Reference
 */
function _buildSalaryDisbursementCsv(batch) {
  const header = [
    'Seq No', 'Txn ID', 'Employee ID', 'Employee Name',
    'Account Number', 'IFSC Code', 'Net Payable (INR)',
    'Payment Mode', 'Payment Reference',
  ].join(',');

  const lines = batch.records.map((r, idx) => {
    const mode = r.net_payable >= RTGS_THRESHOLD_INR ? 'RTGS' : 'NEFT';
    // Stamp a stable txn_id onto the record so it can be matched at reconciliation.
    if (!r.txn_id) {
      r.txn_id = `TXN_${batch.batch_id.slice(-6)}_${String(idx + 1).padStart(4, '0')}`;
    }
    return [
      idx + 1,
      r.txn_id,
      r.employee_id,
      `"${(r.employee_name || 'Unknown').replace(/"/g, '""')}"`,
      r.account_number,
      r.ifsc_code,
      r.net_payable.toFixed(2),
      mode,
      r.payment_reference,
    ].join(',');
  });

  return [header, ...lines].join('\r\n');
}

/**
 * Builds a statutory return CSV for non-SALARY batch types.
 * Covers EPF, ESIC, NPS, GRATUITY, TDS statutory heads.
 * Returns a two-section CSV: a header section and a detail section.
 */
function _buildStatutoryReturnCsv(batch) {
  const batchType = (batch.batch_type || 'STATUTORY').toUpperCase();
  const periodLabel = batch.period || new Date().toISOString().slice(0, 7);

  // Section 1 — metadata header
  const metaLines = [
    `# KYLRX STATUTORY RETURN — ${batchType}`,
    `# Batch ID: ${batch.batch_id}`,
    `# Period: ${periodLabel}`,
    `# Generated At: ${new Date().toISOString()}`,
    `# Total Records: ${batch.records.length}`,
    `# Total Liability (INR): ${batch.total_amount.toFixed(2)}`,
    '#',
  ];

  // Section 2 — detail rows (field set varies by statutory head)
  let detailHeader;
  let detailLines;

  switch (batchType) {
    case 'EPF':
    case 'PF': {
      detailHeader = 'Seq No,UAN,Employee ID,Employee Name,Gross Wages,EPF Wages,EPS Wages,EE EPF,ER EPF,ER EPS,EDLI';
      detailLines = batch.records.map((r, i) => [
        i + 1,
        r.uan || '',
        r.employee_id,
        `"${(r.employee_name || '').replace(/"/g, '""')}"`,
        (r.gross_earnings  || 0).toFixed(2),
        (r.epf_wages       || r.gross_earnings || 0).toFixed(2),
        (r.eps_wages       || r.gross_earnings || 0).toFixed(2),
        (r.ee_epf          || 0).toFixed(2),
        (r.er_epf          || 0).toFixed(2),
        (r.er_eps          || 0).toFixed(2),
        (r.edli            || 0).toFixed(2),
      ].join(','));
      break;
    }
    case 'ESIC': {
      detailHeader = 'Seq No,IP Number,Employee ID,Employee Name,Gross Wages,Days Worked,EE ESIC,ER ESIC,Challan Amount';
      detailLines = batch.records.map((r, i) => [
        i + 1,
        r.ip_number || '',
        r.employee_id,
        `"${(r.employee_name || '').replace(/"/g, '""')}"`,
        (r.gross_earnings  || 0).toFixed(2),
        r.days_worked      || 0,
        (r.ee_esic         || 0).toFixed(2),
        (r.er_esic         || 0).toFixed(2),
        (r.net_payable     || 0).toFixed(2),
      ].join(','));
      break;
    }
    case 'NPS': {
      detailHeader = 'Seq No,PRAN,Employee ID,Employee Name,EE Contribution,ER Contribution,Total Contribution';
      detailLines = batch.records.map((r, i) => [
        i + 1,
        r.pran || '',
        r.employee_id,
        `"${(r.employee_name || '').replace(/"/g, '""')}"`,
        (r.ee_nps          || 0).toFixed(2),
        (r.er_nps          || 0).toFixed(2),
        (r.net_payable     || 0).toFixed(2),
      ].join(','));
      break;
    }
    case 'GRATUITY': {
      detailHeader = 'Seq No,Employee ID,Employee Name,Date of Joining,Date of Separation,Gratuity Amount';
      detailLines = batch.records.map((r, i) => [
        i + 1,
        r.employee_id,
        `"${(r.employee_name || '').replace(/"/g, '""')}"`,
        r.date_of_joining      || '',
        r.date_of_separation   || '',
        (r.net_payable         || 0).toFixed(2),
      ].join(','));
      break;
    }
    case 'TDS': {
      detailHeader = 'Seq No,PAN,Employee ID,Employee Name,Taxable Income,TDS Deducted,Section';
      detailLines = batch.records.map((r, i) => [
        i + 1,
        r.pan || '',
        r.employee_id,
        `"${(r.employee_name || '').replace(/"/g, '""')}"`,
        (r.taxable_income   || 0).toFixed(2),
        (r.net_payable      || 0).toFixed(2),
        r.tds_section       || '192',
      ].join(','));
      break;
    }
    default: {
      // Generic statutory fallback
      detailHeader = 'Seq No,Employee ID,Employee Name,Net Payable (INR),Reference';
      detailLines = batch.records.map((r, i) => [
        i + 1,
        r.employee_id,
        `"${(r.employee_name || '').replace(/"/g, '""')}"`,
        (r.net_payable || 0).toFixed(2),
        r.payment_reference || '',
      ].join(','));
    }
  }

  return [...metaLines, detailHeader, ...detailLines].join('\r\n');
}

export class FileService {
  /**
   * POST /payment-batches/:id/generate-file
   *
   * Preconditions (in order):
   *   1. Batch must be strictly in 'APPROVED' state (412 PRECONDITION_NOT_MET).
   *   2. Zero BLOCK-severity issues must remain in the validation store
   *      (422 APPROVAL_BLOCKED_BY_VALIDATION — defence-in-depth).
   *   3. Full-record SHA-256 must match approved_snapshot.checksum
   *      (409 FINANCIAL_DRIFT_DETECTED).
   *
   * Format routing:
   *   - batch_type === 'SALARY'   → NEFT/RTGS salary disbursement CSV
   *                                 (NEFT < 2,00,000 INR; RTGS ≥ 2,00,000 INR per record)
   *   - batch_type === 'STATUTORY'→ scheme-specific statutory return CSV
   *     (EPF / ESIC / NPS / GRATUITY / TDS recognised; generic fallback)
   *
   * Side-effects:
   *   - Stamps txn_id on each salary record for downstream reconciliation.
   *   - Persists file metadata (incl. raw content) to store.disbursementFiles.
   *   - Transitions batch.state → 'FILE_GENERATED'.
   *   - Writes an immutable audit log entry.
   */
  static async generateFile(batchId, payload = {}) {
    const batch = await PaymentBatchService.getBatch(batchId);

    // ── Pre-condition 1: Strictly APPROVED ───────────────────────────────────
    if (batch.state !== 'APPROVED') {
      const error = new Error(
        `Pre-condition failed: File generation requires batch state strictly 'APPROVED'. ` +
        `Current state: '${batch.state}'.`
      );
      error.statusCode = 412;
      error.code       = 'PRECONDITION_NOT_MET';
      error.details    = { batch_id: batchId, current_state: batch.state, required_state: 'APPROVED' };
      throw error;
    }

    // ── Pre-condition 2: Validation Gatekeeper (Criteria 2) ─────────────────
    // Prevent transitioning to FILE_GENERATED while unresolved records exist in ValidationIssue where severity === 'BLOCK'.
    // Reject violations with a 422 Unprocessable Entity including the blocking error count.
    const storedIssues = store.validationIssuesByBatch.get(batchId) || [];
    try {
      ValidationGatekeeper.assertCanTransition({
        batch,
        targetState: 'FILE_GENERATED',
        validationIssues: storedIssues,
      });
    } catch (err) {
      if (err instanceof ValidationGatekeeperError) {
        const error = new Error(err.message);
        error.statusCode = 422;
        error.code       = 'APPROVAL_BLOCKED_BY_VALIDATION';
        error.details    = err.details;
        throw error;
      }
      throw err;
    }

    // ── Pre-condition 3: Financial drift detection ────────────────────────────
    // Re-hash all records and compare against the checksum frozen at approval.
    // Any post-approval mutation is treated as a financial integrity violation.
    const currentChecksum = crypto.createHash('sha256').update(JSON.stringify(batch.records)).digest('hex');
    if (batch.approved_snapshot && batch.approved_snapshot.checksum !== currentChecksum) {
      const error = new Error(
        `Financial Drift Detected on batch '${batchId}': one or more payment records were ` +
        `modified after checker approval. The batch must be re-validated and re-approved.`
      );
      error.statusCode = 409;
      error.code       = 'FINANCIAL_DRIFT_DETECTED';
      error.details    = {
        batch_id:        batchId,
        approved_hash:   batch.approved_snapshot.checksum,
        current_hash:    currentChecksum,
      };
      throw error;
    }

    // ── Pre-condition 4: Strict Idempotency & Duplicate Prevention (Criteria 6) ─
    // Unique constraint: Instruction Key = SHA256(period + employee_id + batch_type + amount + account_version)
    // Rejects duplicate file generation with 409 Conflict if instruction hashes were previously processed.
    const period = batch.period || batch.payroll_cycle_month || '2026-08';
    const batchType = (batch.batch_type || 'SALARY').toUpperCase();
    const computedInstructionKeys = (batch.records || []).map((r) => {
      const empId = r.employee_id || r.id;
      const amount = Number(r.net_payable ?? r.amount ?? 0);
      const accVer = r.bank_account_version || r.account_version || 1;
      const key = computeInstructionKey({
        period,
        employee_id: empId,
        batch_type: batchType,
        amount,
        account_version: accVer,
      });
      return {
        employee_id: empId,
        amount,
        account_version: accVer,
        instruction_key: key,
      };
    });

    const duplicates = [];
    for (const item of computedInstructionKeys) {
      if (globalInstructionExecutionStore.has(item.instruction_key)) {
        const prev = globalInstructionExecutionStore.get(item.instruction_key);
        duplicates.push({
          employee_id: item.employee_id,
          instruction_key: item.instruction_key,
          amount: item.amount,
          previously_processed_in_batch: prev.batch_id,
          previously_processed_in_file: prev.file_id,
        });
      }
    }

    if (duplicates.length > 0) {
      const error = new DuplicateInstructionConflictError(
        `409 Conflict: Duplicate file generation rejected! ${duplicates.length} instruction hash(es) have already been processed in prior disbursement exports. Double-disbursement is strictly prohibited.`,
        {
          source_batch_id: batchId,
          duplicate_count: duplicates.length,
          duplicates,
        }
      );
      throw error;
    }

    // ── Format routing ────────────────────────────────────────────────────────
    const isSalary    = batchType === 'SALARY';
    const mimeType    = 'text/csv';

    const fileId   = `FILE_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso   = new Date().toISOString();

    let fileContent;
    let formatCode;
    let fileName;

    if (isSalary) {
      // ── SALARY path: NEFT/RTGS CSV ──────────────────────────────────────
      fileContent = _buildSalaryDisbursementCsv(batch);
      formatCode  = 'NEFT_RTGS_SALARY_CSV';
      fileName    = `SALARY_DISBURSEMENT_${batch.batch_id}_${Date.now()}.csv`;
    } else {
      // ── STATUTORY path: scheme-specific return CSV ───────────────────────
      fileContent = _buildStatutoryReturnCsv(batch);
      formatCode  = `STATUTORY_${batchType}_RETURN_CSV`;
      fileName    = `STATUTORY_${batchType}_RETURN_${batch.batch_id}_${Date.now()}.csv`;
    }

    const checksumSha256   = crypto.createHash('sha256').update(fileContent, 'utf8').digest('hex');
    const fileSizeBytes    = Buffer.byteLength(fileContent, 'utf8');

    // ── Determine per-record payment modes for the summary (SALARY only) ─────
    let neftCount = 0;
    let rtgsCount = 0;
    if (isSalary) {
      for (const r of batch.records) {
        if (r.net_payable >= RTGS_THRESHOLD_INR) rtgsCount++;
        else neftCount++;
      }
    }

    // Criteria 5: Versioned BankFile document with required fields
    const bankFileDoc = {
      file_id:          fileId,
      version:          1,
      checksum:         checksumSha256,
      source_batch_id:  batchId,
      row_count:        batch.records.length,
      total_amount:     Math.round(batch.total_amount * 100) / 100,
      generated_at:     nowIso,
      file_name:        fileName,
      format:           isSalary ? 'CSV' : 'CSV',
      content:          fileContent,
      download_url:     `/api/v1/files/${fileId}/download`,
      is_locked:        true,
      reissued_from_file_id: null,
      reissue_reason:   null,
    };

    const fileMeta = {
      ...bankFileDoc,
      batch_id:         batchId,
      batch_type:       batchType,
      format_code:      formatCode,
      mime_type:        mimeType,
      file_size_bytes:  fileSizeBytes,
      checksum_sha256:  checksumSha256,
      total_records:    batch.records.length,
      ...(isSalary ? { neft_count: neftCount, rtgs_count: rtgsCount } : {}),
    };

    store.disbursementFiles.set(fileId, fileMeta);
    bankFileStore.set(fileId, bankFileDoc);

    // Commit instruction hashes to prevent double disbursement
    for (const item of computedInstructionKeys) {
      globalInstructionExecutionStore.record(item.instruction_key, {
        batch_id: batchId,
        file_id: fileId,
        employee_id: item.employee_id,
        amount: item.amount,
        status: 'SUBMITTED',
      });
    }

    // ── State-transition log ───────────────────────────────────────────────
    recordStateTransition({
      entity:        'payment_batch',
      entityId:      batchId,
      from:          'APPROVED',
      to:            'FILE_GENERATED',
      actorId:       payload.actor_id || 'file_engine',
      correlationId: payload.correlation_id,
      metadata:      { file_id: fileId, format_code: formatCode, checksum_sha256: checksumSha256 },
    });

    batch.state      = 'FILE_GENERATED';
    batch.file_id    = fileId;
    batch.updated_at = nowIso;

    recordAuditLog({
      entityType: 'PAYMENT_BATCH',
      entityId:   batchId,
      event:      'DISBURSEMENT_FILE_GENERATED',
      actorId:    payload.actor_id || 'file_engine',
      actorRole:  'SYSTEM_SERVICE',
      metadata:   {
        file_id:         fileId,
        file_name:       fileName,
        format_code:     formatCode,
        checksum_sha256: checksumSha256,
        file_size_bytes: fileSizeBytes,
        ...(isSalary ? { neft_count: neftCount, rtgs_count: rtgsCount } : {}),
      },
    });

    return fileMeta;
  }

  /**
   * Explicit, Auditable Reissue / Reversal Workflow (Criteria 6).
   * Regenerates a disbursement file with incremented version counter and full audit trail.
   */
  static async reissueFile(batchId, payload = {}) {
    const batch = await PaymentBatchService.getBatch(batchId);
    const engine = new BankExportGenerationEngine({
      instructionStore: globalInstructionExecutionStore,
      fileStore: bankFileStore,
      lockManager: globalLockManager,
    });

    const previousFileId = batch.file_id || payload.previous_file_id;
    const reason = payload.reason;
    const reissuedBy = payload.reissued_by;

    const reissuedBankFile = await engine.reissueBankFile({
      batch,
      previousFileId,
      reason,
      reissuedBy,
      signature: payload.signature,
      format: payload.format || 'CSV',
      auditLogger: recordAuditLog,
    });

    // Mirror to store.disbursementFiles
    store.disbursementFiles.set(reissuedBankFile.file_id, reissuedBankFile);
    batch.file_id = reissuedBankFile.file_id;

    recordStateTransition({
      entity:        'payment_batch',
      entityId:      batchId,
      from:          batch.state || 'FILE_GENERATED',
      to:            'FILE_GENERATED',
      actorId:       reissuedBy,
      correlationId: payload.correlation_id,
      metadata: {
        file_id:     reissuedBankFile.file_id,
        version:     reissuedBankFile.version,
        reason,
        checksum:    reissuedBankFile.checksum,
      },
    });

    return reissuedBankFile;
  }
}

// ============================================================================
// 6. BANK INTEGRATION SERVICE & CONTROLLER
// ============================================================================
export class BankIntegrationService {
  /**
   * POST /bank-submissions
   *
   * Preconditions (in order):
   *   1. Batch must be in 'FILE_GENERATED' state (400 INVALID_TRANSMISSION_STATE).
   *   2. The disbursement file checksum stored at file generation time must match
   *      a freshly computed hash of the file content (409 FILE_CHECKSUM_MISMATCH).
   *
   * Side-effects:
   *   - Records submission metadata in store.bankSubmissions.
   *   - Transitions batch.state → 'SUBMITTED'.
   *   - Links batch.submission_id for downstream reconciliation.
   *   - Writes an immutable audit log entry.
   */
  static async submitToBank(payload = {}) {
    const { batch_id, gateway_code = 'HDFC_ENET', actor_id = 'bank_admin@kylrx.ai' } = payload;
    const batch = await PaymentBatchService.getBatch(batch_id);

    // ── Pre-condition 1: Must be FILE_GENERATED ───────────────────────────────
    if (batch.state !== 'FILE_GENERATED') {
      const error = new Error(
        `Cannot submit batch '${batch_id}' to bank gateway: batch is in state '${batch.state}'. ` +
        `Only batches in 'FILE_GENERATED' state may be transmitted.`
      );
      error.statusCode = 400;
      error.code       = 'INVALID_TRANSMISSION_STATE';
      error.details    = { batch_id, current_state: batch.state, required_state: 'FILE_GENERATED' };
      throw error;
    }

    // ── Pre-condition 2: Verify disbursement file checksum ────────────────────
    // Re-read the file from the store and recompute its SHA-256 to ensure the
    // persisted artefact was not tampered with between generation and submission.
    const fileRecord = batch.file_id ? store.disbursementFiles.get(batch.file_id) : null;
    if (fileRecord) {
      const recomputedChecksum = crypto
        .createHash('sha256')
        .update(fileRecord.content, 'utf8')
        .digest('hex');

      if (recomputedChecksum !== fileRecord.checksum_sha256) {
        const error = new Error(
          `File checksum mismatch for batch '${batch_id}': the disbursement file was modified ` +
          `after generation. Re-generate the file before submitting.`
        );
        error.statusCode = 409;
        error.code       = 'FILE_CHECKSUM_MISMATCH';
        error.details    = {
          batch_id,
          file_id:            fileRecord.file_id,
          stored_checksum:    fileRecord.checksum_sha256,
          recomputed_checksum: recomputedChecksum,
        };
        throw error;
      }
    }

    const submissionId = `SUB_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const ackRef       = `ACK_BNK_${gateway_code}_${Date.now()}`;
    const nowIso       = new Date().toISOString();

    const submission = {
      submission_id:             submissionId,
      batch_id,
      file_id:                   batch.file_id || null,
      gateway_code,
      status:                    'SUBMITTED',
      file_checksum_verified:    !!fileRecord,
      acknowledgement_reference: ackRef,
      gateway_timestamp:         nowIso,
    };

    store.bankSubmissions.set(submissionId, submission);

    // ── State-transition log ───────────────────────────────────────────────
    recordStateTransition({
      entity:        'payment_batch',
      entityId:      batch_id,
      from:          'FILE_GENERATED',
      to:            'SUBMITTED',
      actorId:       actor_id,
      correlationId: payload.correlation_id,
      metadata:      { submission_id: submissionId, gateway_code, ack_ref: ackRef },
    });

    batch.state         = 'SUBMITTED';
    batch.submission_id = submissionId;
    batch.updated_at    = nowIso;

    recordAuditLog({
      entityType: 'PAYMENT_BATCH',
      entityId:   batch_id,
      event:      'BANK_SUBMISSION_TRANSMITTED',
      actorId:    actor_id,
      actorRole:  'BANK_INTEGRATION_GATEWAY',
      metadata:   {
        submission_id:          submissionId,
        gateway_code,
        ack_ref:                ackRef,
        file_checksum_verified: !!fileRecord,
      },
    });

    return submission;
  }

  /**
   * POST /bank-responses/import
   *
   * Parses the external bank clearing response and reconciles each payment
   * instruction in batch.records by matching txn_id → clearing status.
   *
   * raw_payload shapes accepted:
   *   a) Batch-level shorthand  : { status: 'SUCCESS' | 'REJECTED' }
   *      All records inherit the batch-level status.
   *   b) Per-transaction detail : { transactions: [{ txn_id, status, reason }] }
   *      Each record is individually reconciled; any txn without a matching
   *      bank row is left as 'UNMATCHED' and counted separately.
   *   c) Mixed (batch + overrides):
   *      batch-level status used as default, individual rows override.
   *
   * Side-effects:
   *   - Sets r.clearing_status ('PAID' | 'FAILED' | 'UNMATCHED') and
   *     r.clearing_reason on every record in batch.records.
   *   - Writes batch.reconciliation_ledger with per-record summaries.
   *   - Transitions batch.state → 'PAID' | 'PARTIALLY_PAID' | 'FAILED'.
   *   - Writes an immutable audit log entry.
   */
  static async importBankResponse(payload = {}) {
    const { batch_id, raw_payload = {}, gateway_code = 'HDFC_ENET' } = payload;

    const importId = `IMP_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const nowIso   = new Date().toISOString();

    let batch = null;
    if (batch_id) {
      batch = await PaymentBatchService.getBatch(batch_id);
    }

    // ── Parse clearing instructions from raw_payload ──────────────────────────
    // Build a txn_id → { status, reason } lookup from the bank's response rows.
    const txnStatusMap = new Map();

    // Per-transaction rows take highest precedence
    if (Array.isArray(raw_payload.transactions)) {
      for (const txn of raw_payload.transactions) {
        if (txn.txn_id) {
          txnStatusMap.set(String(txn.txn_id), {
            status: String(txn.status || 'FAILED').toUpperCase(),
            reason: txn.reason || txn.failure_reason || null,
            bank_ref: txn.bank_ref || txn.utr || null,
          });
        }
      }
    }

    // Batch-level shorthand — used as fallback for records not in txnStatusMap
    const batchLevelRaw    = typeof raw_payload.status === 'string'
      ? raw_payload.status.toUpperCase()
      : null;
    const batchLevelStatus = batchLevelRaw === 'SUCCESS'  ? 'PAID'
      : batchLevelRaw === 'REJECTED' ? 'FAILED'
      : null;  // null means: do not override per-record rows

    // ── Reconcile each batch record ───────────────────────────────────────────
    let paidCount      = 0;
    let failedCount    = 0;
    let unmatchedCount = 0;
    const ledgerEntries = [];

    if (batch) {
      for (const record of batch.records) {
        const txnId = record.txn_id || null;

        let clearingStatus;
        let clearingReason = null;
        let bankRef        = null;

        if (txnId && txnStatusMap.has(txnId)) {
          // Per-transaction match — highest fidelity
          const mapped    = txnStatusMap.get(txnId);
          clearingStatus  = mapped.status === 'SUCCESS' ? 'PAID' : mapped.status;
          clearingReason  = mapped.reason;
          bankRef         = mapped.bank_ref;
        } else if (batchLevelStatus) {
          // Batch-level fallback (applies when no per-txn rows present)
          clearingStatus = batchLevelStatus;
        } else {
          // No match at all
          clearingStatus = 'UNMATCHED';
        }

        // Normalise to canonical values
        if (clearingStatus === 'SUCCESS') clearingStatus = 'PAID';

        record.clearing_status = clearingStatus;
        record.clearing_reason = clearingReason;
        record.bank_ref        = bankRef;
        record.cleared_at      = nowIso;

        // Tally counters
        if (clearingStatus === 'PAID')      paidCount++;
        else if (clearingStatus === 'FAILED') failedCount++;
        else                                  unmatchedCount++;

        ledgerEntries.push({
          employee_id:     record.employee_id,
          txn_id:          txnId,
          amount:          record.net_payable,
          clearing_status: clearingStatus,
          clearing_reason: clearingReason,
          bank_ref:        bankRef,
          cleared_at:      nowIso,
        });
      }

      // ── Persist reconciliation ledger ──────────────────────────────────────
      batch.reconciliation_ledger = {
        import_id:       importId,
        gateway_code,
        paid_count:      paidCount,
        failed_count:    failedCount,
        unmatched_count: unmatchedCount,
        total_count:     batch.records.length,
        entries:         ledgerEntries,
        reconciled_at:   nowIso,
      };

      // ── FSM transition based on clearing outcome ────────────────────────────
      let finalBatchState;
      if (failedCount === 0 && unmatchedCount === 0) {
        finalBatchState = 'PAID';           // all records cleared
      } else if (paidCount === 0) {
        finalBatchState = 'FAILED';         // every record failed / unmatched
      } else {
        finalBatchState = 'PARTIALLY_PAID'; // mixed outcome
      }

      // ── State-transition log ─────────────────────────────────────────────
      recordStateTransition({
        entity:    'payment_batch',
        entityId:  batch_id,
        from:      'SUBMITTED',
        to:        finalBatchState,
        actorId:   'gateway_listener',
        metadata:  { import_id: importId, gateway_code, paid_count: paidCount, failed_count: failedCount, unmatched_count: unmatchedCount },
      });

      batch.state           = finalBatchState;
      batch.clearing_status = finalBatchState;
      batch.updated_at      = nowIso;
    }

    // Derive a top-level clearing_status for the response envelope
    const overallClearing = (batch && paidCount > 0 && failedCount === 0 && unmatchedCount === 0)
      ? 'SUCCESS'
      : (batch && paidCount === 0)
        ? 'FAILED'
        : 'PARTIAL';

    // Fall back to simple payload-level evaluation when no batch is loaded
    const legacySuccess = !batch && batchLevelRaw === 'SUCCESS';

    recordAuditLog({
      entityType: 'PAYMENT_BATCH',
      entityId:   batch_id || 'UNKNOWN',
      event:      paidCount > 0 ? 'BANK_RECONCILIATION_SUCCESS' : 'BANK_RECONCILIATION_FAILED',
      actorId:    'gateway_listener',
      actorRole:  'BANK_INTEGRATION_GATEWAY',
      metadata:   {
        import_id:    importId,
        gateway_code,
        paid_count:   paidCount,
        failed_count: failedCount,
        status:       overallClearing,
      },
    });

    return {
      import_id:          importId,
      batch_id:           batch_id || 'UNKNOWN',
      clearing_status:    batch ? overallClearing : (legacySuccess ? 'SUCCESS' : 'FAILED'),
      acknowledged_count: paidCount || (legacySuccess ? 1 : 0),
      rejected_count:     failedCount,
      unmatched_count:    unmatchedCount,
      total_count:        batch ? batch.records.length : 1,
      reconciliation_ledger: batch ? batch.reconciliation_ledger : null,
      processed_at:       nowIso,
    };
  }

  /**
   * Criterion 7: Bank Response Ingestion and Transaction Reconciliation
   */
  static async reconcileBankResponse(payload = {}) {
    const {
      batch_id,
      file_content,
      file_format = 'CSV',
      file_name = 'bank_settlement',
      operator_id = 'finance_analyst@kylrx.ai',
    } = payload;

    if (!batch_id) {
      const error = new Error('batch_id is required for bank response reconciliation.');
      error.statusCode = 400;
      error.code = 'INVALID_RECONCILIATION_REQUEST';
      throw error;
    }

    const batch = await PaymentBatchService.getBatch(batch_id);
    const prevStatus = batch.state || batch.status || 'SUBMITTED';

    const result = await reconciliationService.ingestAndReconcile({
      batch,
      fileContent: file_content,
      fileFormat: file_format,
      fileName: file_name,
      operatorId: operator_id,
    });

    batch.state = batch.status; // Keep both state and status in sync

    recordStateTransition({
      entity: 'payment_batch',
      entityId: batch_id,
      from: prevStatus,
      to: batch.status,
      actorId: operator_id,
      metadata: {
        reconciliation_summary: batch.reconciliation_summary,
        open_exceptions: result.open_exception_count,
        auto_closure_blocked: batch.auto_closure_blocked,
      },
    });

    recordAuditLog({
      entityType: 'PAYMENT_BATCH',
      entityId: batch_id,
      event: 'BANK_RECONCILIATION_PROCESSED',
      actorId: operator_id,
      actorRole: 'RECONCILIATION_ENGINE',
      metadata: {
        status: batch.status,
        open_exceptions: result.open_exception_count,
        auto_closure_blocked: batch.auto_closure_blocked,
        settled_count: result.settled_count,
      },
    });

    return result;
  }

  static async resolveReconciliationException(payload = {}) {
    const {
      batch_id,
      exception_id,
      action,
      resolved_by = 'finance_desk@kylrx.ai',
      notes,
      override_instruction_id = null,
    } = payload;

    if (!exception_id || !action || !notes) {
      const error = new Error('exception_id, action, and notes are required for manual resolution.');
      error.statusCode = 400;
      error.code = 'INVALID_RESOLUTION_REQUEST';
      throw error;
    }

    let batch = null;
    if (batch_id) {
      batch = await PaymentBatchService.getBatch(batch_id);
    }

    const prevStatus = batch?.state || batch?.status;

    const result = await reconciliationService.resolveException({
      batch,
      exceptionId: exception_id,
      action,
      resolvedBy: resolved_by,
      notes,
      overrideInstructionId: override_instruction_id,
    });

    if (batch) {
      batch.state = batch.status;
      if (prevStatus !== batch.status) {
        recordStateTransition({
          entity: 'payment_batch',
          entityId: batch.batch_id,
          from: prevStatus,
          to: batch.status,
          actorId: resolved_by,
          metadata: {
            resolved_exception_id: exception_id,
            action,
            notes,
          },
        });
      }
    }

    recordAuditLog({
      entityType: 'RECONCILIATION_EXCEPTION',
      entityId: exception_id,
      event: 'RECONCILIATION_EXCEPTION_RESOLVED',
      actorId: resolved_by,
      actorRole: 'FINANCE_DESK',
      metadata: {
        batch_id: batch?.batch_id,
        action,
        notes,
        new_batch_status: batch?.status,
      },
    });

    return result;
  }
}

// ============================================================================
// 7. COMPLIANCE ENGINE & CONTROLLER
// ============================================================================
export class ComplianceEngineService {
  static async calculateCompliance(scheme, payload = {}) {
    const upperScheme = String(scheme).toUpperCase();
    const period = payload.period || 'September 2026';
    const candidates = payload.candidates || [];

    switch (upperScheme) {
      case 'NPS': {
        const npsResult = executePayrollNpsEngine({
          run_id: payload.run_id || `RUN_NPS_${Date.now()}`,
          period,
          employee_profiles: candidates,
          earnings_by_employee: payload.earnings || {},
        });
        return {
          scheme: 'NPS',
          period,
          total_candidates: npsResult.total_candidates,
          total_liability: npsResult.total_nps_liability,
          summary: {
            eligible_count: npsResult.eligible_count,
            blocked_count: npsResult.blocked_count,
            employer_contributions: npsResult.total_employer_contributions,
            employee_deductions: npsResult.total_employee_deductions,
          },
          generated_at: new Date().toISOString(),
        };
      }
      case 'ESIC': {
        const esicResult = generateEsicMonthlyCsv({
          employerCode: payload.employer_code || '31000123450000999',
          wageMonth: period,
          records: candidates,
        });
        return {
          scheme: 'ESIC',
          period,
          total_candidates: esicResult.summary.total_covered_ips,
          total_liability: esicResult.summary.total_challan_liability,
          summary: esicResult.summary,
          generated_at: new Date().toISOString(),
        };
      }
      case 'GRATUITY': {
        const gratResult = computeGratuityLedger({
          organizationId: payload.org_id || 'ORG_01',
          periodMonth: period,
          employees: candidates,
        });
        return {
          scheme: 'GRATUITY',
          period,
          total_candidates: gratResult.summary.total_headcount,
          total_liability: gratResult.summary.total_vested_balance_sheet_liability,
          summary: gratResult.summary,
          generated_at: new Date().toISOString(),
        };
      }
      default: {
        const error = new Error(`Unsupported statutory scheme '${scheme}'. Supported: ESIC, NPS, GRATUITY, PF.`);
        error.statusCode = 400;
        error.code = 'UNSUPPORTED_STATUTORY_SCHEME';
        throw error;
      }
    }
  }

  static async generateComplianceFile(scheme, payload = {}) {
    const upperScheme = String(scheme).toUpperCase();
    const period = payload.period || 'September 2026';
    const records = payload.records || [];

    switch (upperScheme) {
      case 'NPS': {
        const scfResult = generateNsdlCraScfFile({
          corporateRegistrationNumber: payload.corporate_registration_number || 'CHO12345',
          paoOrPopSpCode: payload.pao_code || 'POP00987',
          period,
          records,
          sourceRunId: payload.run_id || 'RUN_NPS_GEN',
        });
        return {
          scheme: 'NPS',
          period,
          file_name: scfResult.file_name,
          checksum_sha256: scfResult.checksum_sha256,
          total_candidates: scfResult.summary.total_subscribers,
          total_liability: scfResult.summary.total_nps_remittance,
          summary: scfResult.summary,
          generated_at: new Date().toISOString(),
        };
      }
      case 'ESIC': {
        const esicResult = generateEsicMonthlyCsv({
          employerCode: payload.employer_code || '31000123450000999',
          wageMonth: period,
          records,
        });
        return {
          scheme: 'ESIC',
          period,
          file_name: esicResult.file_name,
          checksum_sha256: esicResult.checksum_sha256,
          total_candidates: esicResult.summary.total_covered_ips,
          total_liability: esicResult.summary.total_challan_liability,
          summary: esicResult.summary,
          generated_at: new Date().toISOString(),
        };
      }
      default: {
        const error = new Error(`Unsupported compliance generator scheme '${scheme}'.`);
        error.statusCode = 400;
        error.code = 'UNSUPPORTED_SCHEME_GENERATOR';
        throw error;
      }
    }
  }

  /**
   * Criterion 8: ESIC Multi-Stage Pipeline
   */
  static async runEsicPipeline(payload = {}) {
    const pipeline = new EsicMultiStagePipeline({
      customPolicyRegistry: payload.custom_policy_registry,
    });
    return await pipeline.runPipeline({
      run_id: payload.run_id || `RUN_ESIC_${Date.now()}`,
      period: payload.period || '2026-09',
      payroll_records: payload.payroll_records || payload.candidates || [],
      employee_profiles: payload.employee_profiles || [],
      employer_code: payload.employer_code || '31000123450000999',
    });
  }

  /**
   * Criterion 9: Gratuity Rule Engine with Traceable Execution Receipt
   */
  static async calculateGratuityWithReceipt(payload = {}) {
    const engine = new GratuityRuleEngine({
      policies: payload.policies,
    });
    return engine.calculateWithTraceableReceipt({
      employee_id: payload.employee_id,
      date_of_joining: payload.date_of_joining,
      date_of_exit: payload.date_of_exit,
      exit_reason: payload.exit_reason || 'RESIGNATION',
      last_drawn_basic: payload.last_drawn_basic,
      last_drawn_da: payload.last_drawn_da || 0,
      nominees: payload.nominees || [],
      policy_override: payload.policy_override,
    });
  }

  /**
   * Criterion 10: NPS Validation & Export Engine
   */
  static async validateAndExportNpsScf(payload = {}) {
    const engine = new NpsValidationAndExportEngine({
      policies: payload.policies,
    });
    return engine.validateAndCompileScf({
      source_run_id: payload.source_run_id || payload.run_id || `RUN_NPS_${Date.now()}`,
      period: payload.period || 'September 2026',
      month_year: payload.month_year,
      records: payload.records || payload.candidates || [],
      corporate_registration_number: payload.corporate_registration_number || 'CHO12345',
      pao_or_pop_sp_code: payload.pao_or_pop_sp_code || 'POP00987',
      entity_name: payload.entity_name || 'KYLRX ENTERPRISE AI HRMS',
      admin_user: payload.admin_user || 'admin@kylrx.ai',
      options: payload.options || {},
    });
  }
}

// ============================================================================
// 8. AUDIT SERVICE & CONTROLLER (CRITERION 11 CENTRALIZED AUDIT LOGGER)
// ============================================================================
export class AuditService {
  /**
   * Criterion 11: High-Performance Indexed Query on Centralized Compliance Audit Stream
   * Supports lookups by entity_type, entity_id, correlation_id, and ISO date ranges.
   */
  static async queryComplianceAuditStream(filter = {}) {
    return globalComplianceAuditStream.queryEvents(filter);
  }

  /**
   * GET /audit
   *
   * Queries the general audit log with optional filters, returning a
   * chronological event timeline (oldest-first, newest-last).
   *
   * Query parameters:
   *   entity_type  {string}  - Exact match on entity_type  (e.g. PAYMENT_BATCH)
   *   entity_id    {string}  - Exact match on entity_id
   *   actor_id     {string}  - Exact match on actor_id
   *   event_type   {string}  - Exact match on event field
   *   from_date    {string}  - ISO-8601 start timestamp (inclusive)
   *   to_date      {string}  - ISO-8601 end timestamp   (inclusive)
   *   limit        {number}  - Max entries per page (default 50, max 500)
   *   offset       {number}  - Pagination offset (default 0)
   */
  static async queryAuditLogs(filter = {}) {
    let logs = [...store.auditLogs];

    // ── Field filters ─────────────────────────────────────────────────────
    if (filter.entity_type) {
      const et = String(filter.entity_type).toUpperCase();
      logs = logs.filter((l) => l.entity_type === et);
    }
    if (filter.entity_id) {
      logs = logs.filter((l) => l.entity_id === filter.entity_id);
    }
    if (filter.actor_id) {
      logs = logs.filter((l) => l.actor_id === filter.actor_id);
    }
    if (filter.event_type) {
      logs = logs.filter((l) => l.event === filter.event_type);
    }

    // ── Date-range filters ────────────────────────────────────────────────
    if (filter.from_date) {
      const from = new Date(filter.from_date).getTime();
      if (!isNaN(from)) {
        logs = logs.filter((l) => new Date(l.timestamp).getTime() >= from);
      }
    }
    if (filter.to_date) {
      const to = new Date(filter.to_date).getTime();
      if (!isNaN(to)) {
        logs = logs.filter((l) => new Date(l.timestamp).getTime() <= to);
      }
    }

    // ── Chronological sort (oldest first — timeline view) ─────────────────
    logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const total  = logs.length;
    const limit  = Math.min(filter.limit  ? parseInt(filter.limit,  10) : 50, 500);
    const offset = filter.offset ? parseInt(filter.offset, 10) : 0;

    const page = logs.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      count:    page.length,
      timeline: page,
    };
  }

  /**
   * GET /audit/state-transitions
   *
   * Queries the dedicated, immutable state-transition ledger.
   * Returns a chronological timeline of all FSM state changes across
   * payroll_runs, payment_batches, and compliance_returns.
   *
   * Query parameters: entity, entity_id, from_state, to_state,
   *                   actor_id, from_date, to_date, limit, offset.
   */
  static async queryStateTransitions(filter = {}) {
    let logs = [...store.stateTransitionLogs];

    // ── Field filters ─────────────────────────────────────────────────────
    if (filter.entity) {
      const ent = String(filter.entity).toLowerCase();
      logs = logs.filter((l) => l.entity === ent);
    }
    if (filter.entity_id) {
      logs = logs.filter((l) => l.entity_id === filter.entity_id);
    }
    if (filter.actor_id) {
      logs = logs.filter((l) => l.actor_id === filter.actor_id);
    }
    if (filter.from_state) {
      logs = logs.filter((l) => l.from === filter.from_state);
    }
    if (filter.to_state) {
      logs = logs.filter((l) => l.to === filter.to_state);
    }

    // ── Date-range filters ────────────────────────────────────────────────
    if (filter.from_date) {
      const from = new Date(filter.from_date).getTime();
      if (!isNaN(from)) {
        logs = logs.filter((l) => new Date(l.timestamp).getTime() >= from);
      }
    }
    if (filter.to_date) {
      const to = new Date(filter.to_date).getTime();
      if (!isNaN(to)) {
        logs = logs.filter((l) => new Date(l.timestamp).getTime() <= to);
      }
    }

    // ── Chronological sort ────────────────────────────────────────────────
    logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const total  = logs.length;
    const limit  = Math.min(filter.limit  ? parseInt(filter.limit,  10) : 50, 500);
    const offset = filter.offset ? parseInt(filter.offset, 10) : 0;

    const page = logs.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      count:    page.length,
      timeline: page,
    };
  }
}

// ============================================================================
// 9. EXPRESS ROUTER BUILDER WITH OPENAPI ENVELOPE CONTRACTS
// ============================================================================
export function createDisbursementApiRouter() {
  const router = express.Router();
  router.use(express.json());

  // Criterion 11: Distributed Correlation Propagation Middleware
  router.use(correlationPropagationMiddleware);

  // Criteria 12: Transparent UI payload serialization interceptor
  router.use(uiPayloadMaskingInterceptor);

  // Helper async wrapper
  const asyncHandler = (fn) => async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      const code = err.code || 'INTERNAL_SERVER_ERROR';
      return res.status(statusCode).json(errorEnvelope(code, err.message, err.details || null));
    }
  };

  // 1. PayrollService Routes
  router.post('/payroll/runs/:id/finalize', asyncHandler(async (req, res) => {
    const result = await PayrollService.finalizeRun(req.params.id, req.body);
    return res.status(200).json(successEnvelope(result, { immutable: true }));
  }));

  router.get('/payroll/runs/:id/snapshot', asyncHandler(async (req, res) => {
    const result = await PayrollService.getSnapshot(req.params.id);
    return res.status(200).json(successEnvelope(result, { immutable: true }));
  }));

  router.patch('/payroll/runs/:id', asyncHandler(async (req, res) => {
    const result = await PayrollService.updateRun(req.params.id, req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  router.get('/payroll/runs/:id', asyncHandler(async (req, res) => {
    const result = await PayrollService.getRun(req.params.id);
    return res.status(200).json(successEnvelope(result, { immutable: result.status === 'FINALIZED' }));
  }));

  // 2. PaymentBatchService Routes
  router.post('/payment-batches', asyncHandler(async (req, res) => {
    const result = await PaymentBatchService.createBatch(req.body);
    return res.status(201).json(successEnvelope(result));
  }));

  router.post('/payment-batches/:id/settle', asyncHandler(async (req, res) => {
    const result = await PaymentBatchService.settleBatch(req.params.id, req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  router.get('/payment-batches/:id', asyncHandler(async (req, res) => {
    const result = await PaymentBatchService.getBatch(req.params.id);
    return res.status(200).json(successEnvelope(result));
  }));

  // 3. ValidationService Routes
  router.post('/payment-batches/:id/validate', asyncHandler(async (req, res) => {
    const result = await ValidationService.validateBatch(req.params.id);
    return res.status(200).json(successEnvelope(result));
  }));

  router.get('/payment-batches/:id/issues', asyncHandler(async (req, res) => {
    const result = await ValidationService.getIssues(req.params.id);
    return res.status(200).json(successEnvelope(result));
  }));

  // 4. ApprovalService Routes
  router.post('/payment-batches/:id/submit-approval', asyncHandler(async (req, res) => {
    const result = await ApprovalService.submitApproval(req.params.id, req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  router.post('/payment-batches/:id/approve', asyncHandler(async (req, res) => {
    const result = await ApprovalService.approveBatch(req.params.id, req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  // 5. FileService Routes
  router.post('/payment-batches/:id/generate-file', asyncHandler(async (req, res) => {
    const result = await FileService.generateFile(req.params.id, req.body);
    return res.status(201).json(successEnvelope(result));
  }));

  router.post('/payment-batches/:id/reissue-file', asyncHandler(async (req, res) => {
    const result = await FileService.reissueFile(req.params.id, req.body);
    return res.status(201).json(successEnvelope(result));
  }));

  // 5B. Privileged Cryptographic Export Routes (Criteria 12)
  router.post('/payment-batches/:id/export-token', asyncHandler(async (req, res) => {
    const { authorized_by = 'PAYROLL_ADMIN', purpose = 'BANK_CLEARING_FILE', ttl_seconds = 300 } = req.body || {};
    const tokenData = PrivilegedExportSecurityService.generateExportAuthorizationToken({
      batchId: req.params.id,
      authorizedBy: authorized_by,
      purpose,
      ttlSeconds: ttl_seconds,
    });
    return res.status(200).json(successEnvelope(tokenData));
  }));

  router.post('/payment-batches/:id/privileged-export', asyncHandler(async (req, res) => {
    const batch = await PaymentBatchService.getBatch(req.params.id);
    const authToken = req.headers['x-kylrx-export-signature'] || req.headers['x-export-authorization'] || req.body?.authorization_token;
    const privilegedBatch = PrivilegedExportSecurityService.getPrivilegedRawBatch({
      batch,
      authToken,
    });
    return res.status(200).json(successEnvelope(privilegedBatch, { privileged: true }));
  }));

  // 6. BankIntegrationService Routes
  router.post('/bank-submissions', asyncHandler(async (req, res) => {
    const result = await BankIntegrationService.submitToBank(req.body);
    return res.status(202).json(successEnvelope(result));
  }));

  router.post('/bank-responses/import', asyncHandler(async (req, res) => {
    const result = await BankIntegrationService.importBankResponse(req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  // 6B. Criterion 7: Bank Response Reconciliation & Discrepancy Queue Routes
  router.post('/payment-batches/:id/reconcile-bank-response', asyncHandler(async (req, res) => {
    const payload = {
      batch_id: req.params.id,
      file_content: req.body?.file_content || req.body?.content || '',
      file_format: req.body?.file_format || req.body?.format || 'CSV',
      file_name: req.body?.file_name || 'bank_settlement',
      operator_id: req.body?.operator_id || req.headers['x-actor-id'] || 'finance_analyst@kylrx.ai',
    };
    const result = await BankIntegrationService.reconcileBankResponse(payload);
    return res.status(200).json(successEnvelope(result));
  }));

  router.get('/payment-batches/:id/reconciliation-exceptions', asyncHandler(async (req, res) => {
    const exceptions = globalReconciliationStore.listExceptionsByBatch(req.params.id);
    return res.status(200).json(successEnvelope({
      batch_id: req.params.id,
      exceptions,
      open_count: exceptions.filter(e => e.status === 'OPEN').length,
    }));
  }));

  router.post('/payment-batches/:id/resolve-exception', asyncHandler(async (req, res) => {
    const payload = {
      batch_id: req.params.id,
      exception_id: req.body?.exception_id,
      action: req.body?.action,
      resolved_by: req.body?.resolved_by || req.headers['x-actor-id'] || 'finance_desk@kylrx.ai',
      notes: req.body?.notes,
      override_instruction_id: req.body?.override_instruction_id,
    };
    const result = await BankIntegrationService.resolveReconciliationException(payload);
    return res.status(200).json(successEnvelope(result));
  }));

  // 7. ComplianceEngine Routes
  router.post('/compliance/:scheme/calculate', asyncHandler(async (req, res) => {
    const result = await ComplianceEngineService.calculateCompliance(req.params.scheme, req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  router.post('/compliance/:scheme/generate', asyncHandler(async (req, res) => {
    const result = await ComplianceEngineService.generateComplianceFile(req.params.scheme, req.body);
    return res.status(201).json(successEnvelope(result));
  }));

  // 7B. Criteria 8, 9, 10 Modular Statutory Workflow Routes
  router.post('/compliance/esic/pipeline', asyncHandler(async (req, res) => {
    const result = await ComplianceEngineService.runEsicPipeline(req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  router.post('/compliance/gratuity/calculate-with-receipt', asyncHandler(async (req, res) => {
    const result = await ComplianceEngineService.calculateGratuityWithReceipt(req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  router.post('/compliance/nps/validate-and-export', asyncHandler(async (req, res) => {
    const result = await ComplianceEngineService.validateAndExportNpsScf(req.body);
    if (!result.all_data_checks_passed) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'NPS_PRE_EXPORT_VALIDATION_FAILED',
          message: result.error,
          rejected_count: result.rejected_count,
          validation_issues: result.validation_issues,
        },
      });
    }
    return res.status(200).json(successEnvelope(result));
  }));

  // 7C. Column 1: Full ESIC Automation Engine & Visual Compliance Stepper Routes

  /**
   * POST /api/v1/esic/upload-master
   * Bulk upload master profiles from Excel (ESIC_Employee_Master.xlsx)
   */
  router.post('/api/v1/esic/upload-master', asyncHandler(async (req, res) => {
    const inputData = req.body.file_content || req.body.rows || req.body.data || req.body;
    const result = globalEsicAutomationEngine.profileStore.ingestExcelMaster(inputData, {
      file_name: req.body.file_name || 'ESIC_Employee_Master.xlsx',
      batch_id: req.body.batch_id,
    });
    return res.status(200).json(successEnvelope(result));
  }));

  /**
   * GET /api/v1/esic/profiles
   * Query all active master ESIC profiles
   */
  router.get('/api/v1/esic/profiles', asyncHandler(async (req, res) => {
    const period = req.query.period || '2026-09';
    const profiles = globalEsicAutomationEngine.profileStore.findActiveProfiles(period);
    return res.status(200).json(successEnvelope({
      period,
      total_count: profiles.length,
      profiles,
    }));
  }));

  /**
   * POST /api/v1/esic/trigger
   * Trigger monthly ESIC calculation upon Payroll Finalized
   */
  router.post('/api/v1/esic/trigger', asyncHandler(async (req, res) => {
    const result = await globalEsicAutomationEngine.onPayrollFinalized(req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  /**
   * GET /api/v1/esic/stepper/:batch_id
   * Fetch current 7-stage visual stepper progress
   */
  router.get('/api/v1/esic/stepper/:batch_id', asyncHandler(async (req, res) => {
    const stepperState = globalEsicAutomationEngine.getStepperState(req.params.batch_id);
    if (!stepperState) {
      return res.status(404).json({
        success: false,
        error: { code: 'ESIC_STEPPER_NOT_FOUND', message: `Stepper state not found for batch ${req.params.batch_id}` },
      });
    }
    return res.status(200).json(successEnvelope(stepperState));
  }));

  /**
   * POST /api/v1/esic/stepper/:batch_id/advance
   * Advance batch through the visual compliance stepper
   */
  router.post('/api/v1/esic/stepper/:batch_id/advance', asyncHandler(async (req, res) => {
    const { target_stage, actor, notes, force } = req.body;
    try {
      const updatedState = globalEsicAutomationEngine.advanceStepperStage(req.params.batch_id, target_stage, {
        actor,
        notes,
        force,
      });
      return res.status(200).json(successEnvelope(updatedState));
    } catch (err) {
      if (err.code === 'UNRESOLVED_ESIC_EXCEPTIONS') {
        return res.status(422).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
            unresolved_blocking_count: err.unresolved_count,
            exceptions: err.exceptions,
          },
        });
      }
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STEPPER_TRANSITION', message: err.message },
      });
    }
  }));

  /**
   * GET /api/v1/esic/exceptions
   * Query ESIC_Exceptions table
   */
  router.get('/api/v1/esic/exceptions', asyncHandler(async (req, res) => {
    const batchId = req.query.batch_id;
    let exceptions = [];
    if (batchId) {
      exceptions = globalEsicAutomationEngine.esicExceptions.get(batchId) || [];
    } else {
      for (const list of globalEsicAutomationEngine.esicExceptions.values()) {
        exceptions.push(...list);
      }
    }
    return res.status(200).json(successEnvelope({
      total_count: exceptions.length,
      exceptions,
    }));
  }));

  /**
   * POST /api/v1/esic/exceptions/:exception_id/resolve
   * Resolve an ESIC compliance exception
   */
  router.post('/api/v1/esic/exceptions/:exception_id/resolve', asyncHandler(async (req, res) => {
    const result = globalEsicAutomationEngine.resolveException(req.params.exception_id, req.body);
    if (!result.success) {
      return res.status(404).json({ success: false, error: { message: result.error } });
    }
    return res.status(200).json(successEnvelope(result));
  }));

  /**
   * GET /api/v1/esic/tasks
   * Query HR Remediation tasks
   */
  router.get('/api/v1/esic/tasks', asyncHandler(async (req, res) => {
    const batchId = req.query.batch_id;
    let tasks = [];
    if (batchId) {
      tasks = globalEsicAutomationEngine.hrTasks.get(batchId) || [];
    } else {
      for (const list of globalEsicAutomationEngine.hrTasks.values()) {
        tasks.push(...list);
      }
    }
    return res.status(200).json(successEnvelope({
      total_count: tasks.length,
      tasks,
    }));
  }));

  /**
   * GET /api/v1/esic/alerts
   * Query HR statutory alerts
   */
  router.get('/api/v1/esic/alerts', asyncHandler(async (req, res) => {
    const batchId = req.query.batch_id;
    let alerts = [];
    if (batchId) {
      alerts = globalEsicAutomationEngine.hrAlerts.get(batchId) || [];
    } else {
      for (const list of globalEsicAutomationEngine.hrAlerts.values()) {
        alerts.push(...list);
      }
    }
    return res.status(200).json(successEnvelope({
      total_count: alerts.length,
      alerts,
    }));
  }));

  /**
   * GET /api/v1/esic/export/:batch_id
   * Retrieve official ESIC_CONTRIBUTION_MONTH_YEAR.txt / .xls export
   */
  router.get('/api/v1/esic/export/:batch_id', asyncHandler(async (req, res) => {
    const batchId = req.params.batch_id;
    let exportFiles = globalEsicAutomationEngine.exportFiles.get(batchId);
    if (!exportFiles) {
      try {
        exportFiles = globalEsicAutomationEngine.generateExportFiles(batchId);
      } catch (err) {
        return res.status(404).json({
          success: false,
          error: { code: 'EXPORT_NOT_FOUND', message: err.message },
        });
      }
    }

    const format = (req.query.format || 'json').toLowerCase();
    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exportFiles.txt.file_name}"`);
      return res.status(200).send(exportFiles.txt.content);
    }
    if (format === 'xls') {
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exportFiles.xls.file_name}"`);
      return res.status(200).send(exportFiles.xls.content);
    }

    return res.status(200).json(successEnvelope(exportFiles));
  }));

  // 7D. Column 2: Statutory Gratuity Provisioning & Settlement Engine Routes

  /**
   * POST /api/v1/gratuity/profiles
   * Upsert employee master gratuity profile
   */
  router.post('/api/v1/gratuity/profiles', asyncHandler(async (req, res) => {
    const profile = globalGratuityAutomationEngine.profileStore.upsertProfile(req.body);
    return res.status(200).json(successEnvelope(profile));
  }));

  /**
   * GET /api/v1/gratuity/profiles
   * Query all gratuity master profiles
   */
  router.get('/api/v1/gratuity/profiles', asyncHandler(async (req, res) => {
    const profiles = globalGratuityAutomationEngine.profileStore.getAllProfiles();
    return res.status(200).json(successEnvelope({
      total_count: profiles.length,
      profiles,
    }));
  }));

  /**
   * POST /api/v1/gratuity/trigger
   * Trigger gratuity provisioning & settlement on exit or payroll run
   */
  router.post('/api/v1/gratuity/trigger', asyncHandler(async (req, res) => {
    const result = await globalGratuityAutomationEngine.triggerProvisioningAndSettlement(req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  /**
   * GET /api/v1/gratuity/stepper/:batch_id
   * Fetch current 7-stage workflow stepper state
   */
  router.get('/api/v1/gratuity/stepper/:batch_id', asyncHandler(async (req, res) => {
    const stepperState = globalGratuityAutomationEngine.getStepperState(req.params.batch_id);
    if (!stepperState) {
      return res.status(404).json({
        success: false,
        error: { code: 'GRATUITY_STEPPER_NOT_FOUND', message: `Stepper state not found for batch ${req.params.batch_id}` },
      });
    }
    return res.status(200).json(successEnvelope(stepperState));
  }));

  /**
   * POST /api/v1/gratuity/stepper/:batch_id/advance
   * Advance workflow stage
   */
  router.post('/api/v1/gratuity/stepper/:batch_id/advance', asyncHandler(async (req, res) => {
    const { target_stage, actor, notes, force } = req.body;
    try {
      const updatedState = globalGratuityAutomationEngine.advanceWorkflow(req.params.batch_id, target_stage, {
        actor,
        notes,
        force,
      });
      return res.status(200).json(successEnvelope(updatedState));
    } catch (err) {
      const status = err.statusCode || (err.code === 'UNAPPROVED_GRATUITY_BATCH' ? 422 : 400);
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'INVALID_WORKFLOW_TRANSITION', message: err.message },
      });
    }
  }));

  /**
   * POST /api/v1/gratuity/stepper/:batch_id/approve
   * 4-Eyes Maker-Checker HR Approval Gate
   */
  router.post('/api/v1/gratuity/stepper/:batch_id/approve', asyncHandler(async (req, res) => {
    const { checker_id, notes } = req.body;
    try {
      const approvedState = globalGratuityAutomationEngine.approveGratuityBatch(req.params.batch_id, checker_id, notes);
      return res.status(200).json(successEnvelope(approvedState));
    } catch (err) {
      const status = err.statusCode || (err.code === 'MAKER_CHECKER_VIOLATION' ? 403 : 400);
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'APPROVAL_FAILED', message: err.message },
      });
    }
  }));

  /**
   * GET /api/v1/gratuity/statement/:batch_id
   * Download Gratuity_Statement_MONTH_YEAR.xlsx / .csv
   */
  router.get('/api/v1/gratuity/statement/:batch_id', asyncHandler(async (req, res) => {
    const batchId = req.params.batch_id;
    let exportFiles = globalGratuityAutomationEngine.statementFiles.get(batchId);
    if (!exportFiles) {
      try {
        exportFiles = globalGratuityAutomationEngine.generateGratuityStatement(batchId);
      } catch (err) {
        return res.status(404).json({
          success: false,
          error: { code: 'STATEMENT_NOT_FOUND', message: err.message },
        });
      }
    }

    const format = (req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exportFiles.csv.file_name}"`);
      return res.status(200).send(exportFiles.csv.content);
    }
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${exportFiles.xlsx.file_name}"`);
      return res.status(200).send(exportFiles.xlsx.content);
    }

    return res.status(200).json(successEnvelope(exportFiles));
  }));

  /**
   * GET /api/v1/gratuity/tasks
   * Query HR tasks for gratuity review
   */
  router.get('/api/v1/gratuity/tasks', asyncHandler(async (req, res) => {
    const batchId = req.query.batch_id;
    let tasks = [];
    if (batchId) {
      tasks = globalGratuityAutomationEngine.hrTasks.get(batchId) || [];
    } else {
      for (const list of globalGratuityAutomationEngine.hrTasks.values()) {
        tasks.push(...list);
      }
    }
    return res.status(200).json(successEnvelope({
      total_count: tasks.length,
      tasks,
    }));
  }));

  /**
   * GET /api/v1/gratuity/alerts
   * Query compliance alerts for gratuity
   */
  router.get('/api/v1/gratuity/alerts', asyncHandler(async (req, res) => {
    const batchId = req.query.batch_id;
    let alerts = [];
    if (batchId) {
      alerts = globalGratuityAutomationEngine.hrAlerts.get(batchId) || [];
    } else {
      for (const list of globalGratuityAutomationEngine.hrAlerts.values()) {
        alerts.push(...list);
      }
    }
    return res.status(200).json(successEnvelope({
      total_count: alerts.length,
      alerts,
    }));
  }));

  // 7E. Column 3: Corporate NPS Automation Service Routes

  /**
   * POST /api/v1/nps/profiles
   * Upsert employee master NPS profile
   */
  router.post('/api/v1/nps/profiles', asyncHandler(async (req, res) => {
    const profile = globalCorporateNpsAutomationEngine.profileStore.upsertProfile(req.body);
    return res.status(200).json(successEnvelope(profile));
  }));

  /**
   * GET /api/v1/nps/profiles
   * Query all NPS master profiles
   */
  router.get('/api/v1/nps/profiles', asyncHandler(async (req, res) => {
    const profiles = globalCorporateNpsAutomationEngine.profileStore.getAllProfiles();
    return res.status(200).json(successEnvelope({
      total_count: profiles.length,
      profiles,
    }));
  }));

  /**
   * POST /api/v1/nps/trigger
   * Trigger Corporate NPS calculation & validation on monthly Payroll Finalized
   */
  router.post('/api/v1/nps/trigger', asyncHandler(async (req, res) => {
    const result = await globalCorporateNpsAutomationEngine.handlePayrollFinalized(req.body);
    return res.status(200).json(successEnvelope(result));
  }));

  /**
   * GET /api/v1/nps/stepper/:batch_id
   * Fetch current 7-stage visual workflow stepper state
   */
  router.get('/api/v1/nps/stepper/:batch_id', asyncHandler(async (req, res) => {
    const stepperState = globalCorporateNpsAutomationEngine.getStepperState(req.params.batch_id);
    if (!stepperState) {
      return res.status(404).json({
        success: false,
        error: { code: 'NPS_STEPPER_NOT_FOUND', message: `NPS Stepper state not found for batch ${req.params.batch_id}` },
      });
    }
    return res.status(200).json(successEnvelope(stepperState));
  }));

  /**
   * POST /api/v1/nps/stepper/:batch_id/advance
   * Advance 7-stage workflow lifecycle stage
   */
  router.post('/api/v1/nps/stepper/:batch_id/advance', asyncHandler(async (req, res) => {
    const { target_stage, actor, notes, force } = req.body;
    try {
      const updatedState = globalCorporateNpsAutomationEngine.advanceLifecycle(req.params.batch_id, target_stage, {
        actor,
        notes,
        force,
      });
      return res.status(200).json(successEnvelope(updatedState));
    } catch (err) {
      const status = err.statusCode || (err.code === 'NPS_BLOCKING_DEFECTS' ? 422 : 400);
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'INVALID_WORKFLOW_TRANSITION', message: err.message },
      });
    }
  }));

  /**
   * POST /api/v1/nps/stepper/:batch_id/acknowledge
   * Record NSDL acknowledgement receipt (PRN / Ack No)
   */
  router.post('/api/v1/nps/stepper/:batch_id/acknowledge', asyncHandler(async (req, res) => {
    const { acknowledgement_number, prn, received_at, recorded_by, notes } = req.body;
    try {
      const ackState = globalCorporateNpsAutomationEngine.recordNsdlAcknowledgement(req.params.batch_id, {
        acknowledgement_number: acknowledgement_number || prn,
        prn: prn || acknowledgement_number,
        received_at,
        recorded_by,
        notes,
      });
      return res.status(200).json(successEnvelope(ackState));
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: { code: err.code || 'ACKNOWLEDGEMENT_FAILED', message: err.message },
      });
    }
  }));

  /**
   * GET /api/v1/nps/export/:batch_id
   * Retrieve official NSDL upload file NPS_Contribution_MONTH_YEAR.txt
   */
  router.get('/api/v1/nps/export/:batch_id', asyncHandler(async (req, res) => {
    const batchId = req.params.batch_id;
    let exportFile = globalCorporateNpsAutomationEngine.exportFiles.get(batchId);
    if (!exportFile) {
      try {
        exportFile = globalCorporateNpsAutomationEngine.generateNsdlExportFile(batchId);
      } catch (err) {
        return res.status(404).json({
          success: false,
          error: { code: 'NPS_EXPORT_NOT_FOUND', message: err.message },
        });
      }
    }

    const format = (req.query.format || 'txt').toLowerCase();
    if (format === 'json') {
      return res.status(200).json(successEnvelope(exportFile));
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFile.manifest.file_name}"`);
    return res.status(200).send(exportFile.txt);
  }));

  /**
   * GET /api/v1/nps/exceptions
   * Query NPS validation exceptions
   */
  router.get('/api/v1/nps/exceptions', asyncHandler(async (req, res) => {
    const batchId = req.query.batch_id;
    let issues = [];
    if (batchId) {
      issues = globalCorporateNpsAutomationEngine.validationIssues.get(batchId) || [];
    } else {
      for (const list of globalCorporateNpsAutomationEngine.validationIssues.values()) {
        issues.push(...list);
      }
    }
    return res.status(200).json(successEnvelope({
      total_count: issues.length,
      issues,
    }));
  }));

  /**
   * POST /api/v1/nps/exceptions/:id/resolve
   * Resolve an NPS validation defect
   */
  router.post('/api/v1/nps/exceptions/:id/resolve', asyncHandler(async (req, res) => {
    const result = globalCorporateNpsAutomationEngine.resolveValidationIssue(req.params.id, req.body);
    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: { code: 'NPS_ISSUE_NOT_FOUND', message: result.error },
      });
    }
    return res.status(200).json(successEnvelope(result));
  }));

  /**
   * GET /api/v1/nps/tasks
   * Query HR tasks for NPS review
   */
  router.get('/api/v1/nps/tasks', asyncHandler(async (req, res) => {
    const batchId = req.query.batch_id;
    let tasks = [];
    if (batchId) {
      tasks = globalCorporateNpsAutomationEngine.hrTasks.get(batchId) || [];
    } else {
      for (const list of globalCorporateNpsAutomationEngine.hrTasks.values()) {
        tasks.push(...list);
      }
    }
    return res.status(200).json(successEnvelope({
      total_count: tasks.length,
      tasks,
    }));
  }));

  /**
   * GET /api/v1/nps/alerts
   * Query HR compliance alerts for NPS
   */
  router.get('/api/v1/nps/alerts', asyncHandler(async (req, res) => {
    const batchId = req.query.batch_id;
    let alerts = [];
    if (batchId) {
      alerts = globalCorporateNpsAutomationEngine.hrAlerts.get(batchId) || [];
    } else {
      for (const list of globalCorporateNpsAutomationEngine.hrAlerts.values()) {
        alerts.push(...list);
      }
    }
    return res.status(200).json(successEnvelope({
      total_count: alerts.length,
      alerts,
    }));
  }));

  // 8. AuditService Routes (Criterion 11: Centralized Compliance Audit Logger)

  /**
   * GET /api/v1/audit
   * Criterion 11 Centralized Audit Query API
   * Supports indexed lookups by: entity_type, entity_id, correlation_id, and ISO date ranges.
   */
  router.get('/api/v1/audit', asyncHandler(async (req, res) => {
    const result = await AuditService.queryComplianceAuditStream(req.query);
    return res.status(200).json(successEnvelope(result));
  }));

  /**
   * GET /audit
   * Query the general audit log & compliance stream.
   * Filters: entity_type, entity_id, correlation_id, actor_id, event_type, from_date, to_date, limit, offset
   */
  router.get('/audit', asyncHandler(async (req, res) => {
    if (req.query.correlation_id || req.query.entity_type) {
      const result = await AuditService.queryComplianceAuditStream(req.query);
      return res.status(200).json(successEnvelope(result));
    }
    const result = await AuditService.queryAuditLogs(req.query);
    return res.status(200).json(successEnvelope(result));
  }));

  /**
   * GET /audit/state-transitions
   * Query the immutable state-transition ledger (canonical contract shape).
   * Filters: entity, entity_id, actor_id, from_state, to_state, from_date, to_date, limit, offset
   */
  router.get('/audit/state-transitions', asyncHandler(async (req, res) => {
    const result = await AuditService.queryStateTransitions(req.query);
    return res.status(200).json(successEnvelope(result));
  }));

  return router;
}

export const createPayrollDisbursementApiRouter = createDisbursementApiRouter;
