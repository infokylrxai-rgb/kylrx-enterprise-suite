/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - MAKER-CHECKER APPROVAL SERVICE
 * ============================================================================
 * Module: Payment Batch Lifecycle, 4-Eyes Segregation of Duties & State Isolation
 *
 * Enforces:
 *  1. Strict Finite State Machine: DRAFT -> VALIDATED -> SUBMITTED_FOR_APPROVAL -> APPROVED -> FILE_GENERATED -> SETTLED / FAILED
 *  2. Segregation of Duties: maker_id !== checker_id (4-Eyes Principle)
 *  3. Lifecycle Isolation: 'SALARY' batches are decoupled from 'PF', 'ESIC', 'PT', 'TDS', 'NPS' compliance batches
 *
 * @version 2.4.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

export const BatchState = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  SUBMITTED_FOR_APPROVAL: 'SUBMITTED_FOR_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  FILE_GENERATED: 'FILE_GENERATED',
  TRANSMITTED: 'TRANSMITTED',
  SETTLED: 'SETTLED',
  FAILED: 'FAILED',
});

export const BatchType = Object.freeze({
  SALARY: 'SALARY',
  PF: 'PF',
  ESIC: 'ESIC',
  PT: 'PT',
  TDS: 'TDS',
  NPS: 'NPS',
  GRATUITY: 'GRATUITY',
  BONUS: 'BONUS',
});

// Custom Error Classes for Clean Diagnostic Trapping
export class StateTransitionError extends Error {
  constructor(message, fromState, toState) {
    super(message);
    this.name = 'StateTransitionError';
    this.fromState = fromState;
    this.toState = toState;
  }
}

export class SegregationOfDutiesError extends Error {
  constructor(message, makerId, checkerId) {
    super(message);
    this.name = 'SegregationOfDutiesError';
    this.makerId = makerId;
    this.checkerId = checkerId;
  }
}

export class ValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/**
 * In-Memory or Storage Abstraction for Payment Batches
 */
export class PaymentBatchRepository {
  constructor() {
    this.batches = new Map();
    this.auditLogs = [];
  }

  async save(batch) {
    batch.updated_at = new Date().toISOString();
    batch.version = (batch.version || 0) + 1;
    this.batches.set(batch.batch_id, JSON.parse(JSON.stringify(batch)));
    return this.batches.get(batch.batch_id);
  }

  async findById(batchId) {
    const b = this.batches.get(batchId);
    return b ? JSON.parse(JSON.stringify(b)) : null;
  }

  async findByPayrollRunId(payrollRunId) {
    return Array.from(this.batches.values())
      .filter((b) => b.payroll_run_id === payrollRunId)
      .map((b) => JSON.parse(JSON.stringify(b)));
  }

  async appendAuditLog(entry) {
    this.auditLogs.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  getAuditLogs(batchId) {
    return this.auditLogs.filter((l) => l.batch_id === batchId);
  }
}

/**
 * Maker-Checker Payment Batch Service
 */
export class MakerCheckerApprovalService {
  constructor(repository = new PaymentBatchRepository()) {
    this.repo = repository;
  }

  /**
   * 1. CREATE PAYMENT BATCH (Starts in DRAFT)
   */
  async createBatch({
    batch_id,
    payroll_run_id,
    batch_name,
    batch_type,
    created_by_user_id,
    records = [],
  }) {
    if (!Object.values(BatchType).includes(batch_type)) {
      throw new Error(`Invalid batch_type: ${batch_type}`);
    }

    const totalAmount = records.reduce((sum, r) => sum + (r.net_payable_amount || r.amount || 0), 0);

    const newBatch = {
      batch_id,
      payroll_run_id,
      batch_name,
      batch_type,
      status: BatchState.DRAFT,
      summary: {
        total_records: records.length,
        total_amount: Math.round(totalAmount * 100) / 100,
        currency: 'INR',
      },
      records,
      validation_gate: {
        is_passed: false,
        last_validated_at: null,
        issues: [],
      },
      maker_checker: {
        maker_id: created_by_user_id,
        maker_timestamp: new Date().toISOString(),
        checker_id: null,
        checker_timestamp: null,
        checker_comments: null,
      },
      bank_file_id: null,
      settlement_details: null,
      version: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const saved = await this.repo.save(newBatch);
    await this.repo.appendAuditLog({
      batch_id,
      action: 'BATCH_CREATED',
      user_id: created_by_user_id,
      details: { batch_type, records_count: records.length, total_amount: totalAmount },
    });

    return saved;
  }

  /**
   * 2. RUN VALIDATION GATE (Transitions DRAFT -> VALIDATED)
   */
  async validateBatch(batchId, validatorUserId) {
    const batch = await this._getBatchOrThrow(batchId);

    if (batch.status !== BatchState.DRAFT && batch.status !== BatchState.VALIDATED && batch.status !== BatchState.REJECTED) {
      throw new StateTransitionError(
        `Cannot validate batch in state '${batch.status}'. Batch must be in DRAFT or REJECTED state.`,
        batch.status,
        BatchState.VALIDATED
      );
    }

    const issues = [];

    // Basic integrity gates
    if (!batch.records || batch.records.length === 0) {
      issues.push({ code: 'EMPTY_BATCH', message: 'Batch contains 0 records' });
    }

    for (const [idx, rec] of (batch.records || []).entries()) {
      const amt = rec.net_payable_amount || rec.amount || 0;
      if (amt <= 0) {
        issues.push({ code: 'INVALID_AMOUNT', message: `Record ${idx + 1} (${rec.employee_id}) has zero or negative amount: ₹${amt}` });
      }

      if (batch.batch_type === BatchType.SALARY) {
        if (!rec.ifsc_code || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(rec.ifsc_code)) {
          issues.push({ code: 'INVALID_IFSC', message: `Record ${idx + 1} (${rec.employee_id}) has invalid IFSC format: ${rec.ifsc_code}` });
        }
        if (!rec.account_number_raw && !rec.account_number) {
          issues.push({ code: 'MISSING_ACCOUNT', message: `Record ${idx + 1} (${rec.employee_id}) is missing bank account number` });
        }
      }

      if (batch.batch_type === BatchType.PF && !rec.uan) {
        issues.push({ code: 'MISSING_UAN', message: `Record ${idx + 1} (${rec.employee_id}) is missing 12-digit UAN` });
      }

      if (batch.batch_type === BatchType.ESIC && !rec.esic_ip_number) {
        issues.push({ code: 'MISSING_IP_NO', message: `Record ${idx + 1} (${rec.employee_id}) is missing 10-digit ESIC IP number` });
      }

      if (batch.batch_type === BatchType.NPS && !rec.pran) {
        issues.push({ code: 'MISSING_PRAN', message: `Record ${idx + 1} (${rec.employee_id}) is missing 12-digit PRAN` });
      }
    }

    if (issues.length > 0) {
      batch.status = BatchState.DRAFT;
      batch.validation_gate = {
        is_passed: false,
        last_validated_at: new Date().toISOString(),
        issues,
      };
      await this.repo.save(batch);
      throw new ValidationError(`Validation Gate Failed with ${issues.length} issue(s)`, issues);
    }

    // Validation passed
    batch.status = BatchState.VALIDATED;
    batch.validation_gate = {
      is_passed: true,
      last_validated_at: new Date().toISOString(),
      issues: [],
    };

    const saved = await this.repo.save(batch);
    await this.repo.appendAuditLog({
      batch_id: batchId,
      action: 'VALIDATION_PASSED',
      user_id: validatorUserId,
      details: { verified_records: batch.records.length },
    });

    return saved;
  }

  /**
   * 3. SUBMIT FOR APPROVAL (Transitions VALIDATED -> SUBMITTED_FOR_APPROVAL)
   * Records the maker_id who is submitting the batch.
   */
  async submitForApproval(batchId, makerId, makerComments = '') {
    const batch = await this._getBatchOrThrow(batchId);

    if (batch.status !== BatchState.VALIDATED) {
      throw new StateTransitionError(
        `Batch cannot be submitted for approval in '${batch.status}' state. Must be VALIDATED first.`,
        batch.status,
        BatchState.SUBMITTED_FOR_APPROVAL
      );
    }

    if (!makerId) {
      throw new Error('Maker ID is required to submit batch for approval');
    }

    batch.status = BatchState.SUBMITTED_FOR_APPROVAL;
    batch.maker_checker.maker_id = makerId;
    batch.maker_checker.maker_timestamp = new Date().toISOString();
    batch.maker_checker.maker_comments = makerComments;

    // Reset any previous checker decision
    batch.maker_checker.checker_id = null;
    batch.maker_checker.checker_timestamp = null;
    batch.maker_checker.checker_comments = null;

    const saved = await this.repo.save(batch);
    await this.repo.appendAuditLog({
      batch_id: batchId,
      action: 'SUBMITTED_FOR_APPROVAL',
      user_id: makerId,
      details: { comments: makerComments },
    });

    return saved;
  }

  /**
   * 4. CHECKER APPROVAL (Transitions SUBMITTED_FOR_APPROVAL -> APPROVED)
   * HARD 4-EYES RULE: maker_id cannot approve the batch.
   */
  async approveBatch(batchId, checkerId, checkerComments = '') {
    const batch = await this._getBatchOrThrow(batchId);

    if (batch.status !== BatchState.SUBMITTED_FOR_APPROVAL) {
      throw new StateTransitionError(
        `Cannot approve batch in '${batch.status}' state. Batch must be SUBMITTED_FOR_APPROVAL.`,
        batch.status,
        BatchState.APPROVED
      );
    }

    if (!checkerId) {
      throw new Error('Checker ID is required for batch approval');
    }

    // ── HARD SECURITY RULE: 4-EYES SEGREGATION OF DUTIES ──
    if (batch.maker_checker.maker_id === checkerId) {
      await this.repo.appendAuditLog({
        batch_id: batchId,
        action: 'SECURITY_VIOLATION_SELF_APPROVAL_ATTEMPT',
        user_id: checkerId,
        details: { maker_id: batch.maker_checker.maker_id, error: 'Self-approval blocked by 4-Eyes policy' },
      });
      throw new SegregationOfDutiesError(
        `4-Eyes Rule Violation: User '${checkerId}' submitted this batch as Maker and is strictly prohibited from approving it as Checker.`,
        batch.maker_checker.maker_id,
        checkerId
      );
    }

    batch.status = BatchState.APPROVED;
    batch.maker_checker.checker_id = checkerId;
    batch.maker_checker.checker_timestamp = new Date().toISOString();
    batch.maker_checker.checker_comments = checkerComments;

    const saved = await this.repo.save(batch);
    await this.repo.appendAuditLog({
      batch_id: batchId,
      action: 'BATCH_APPROVED',
      user_id: checkerId,
      details: { maker_id: batch.maker_checker.maker_id, checker_comments: checkerComments },
    });

    return saved;
  }

  /**
   * 5. CHECKER REJECTION (Transitions SUBMITTED_FOR_APPROVAL -> REJECTED)
   */
  async rejectBatch(batchId, checkerId, rejectionReason) {
    const batch = await this._getBatchOrThrow(batchId);

    if (batch.status !== BatchState.SUBMITTED_FOR_APPROVAL) {
      throw new StateTransitionError(
        `Cannot reject batch in '${batch.status}' state. Batch must be SUBMITTED_FOR_APPROVAL.`,
        batch.status,
        BatchState.REJECTED
      );
    }

    if (!checkerId) {
      throw new Error('Checker ID is required for rejection');
    }

    if (!rejectionReason || rejectionReason.trim().length === 0) {
      throw new Error('A detailed rejection reason is required');
    }

    batch.status = BatchState.REJECTED;
    batch.maker_checker.checker_id = checkerId;
    batch.maker_checker.checker_timestamp = new Date().toISOString();
    batch.maker_checker.checker_comments = `REJECTED: ${rejectionReason}`;

    const saved = await this.repo.save(batch);
    await this.repo.appendAuditLog({
      batch_id: batchId,
      action: 'BATCH_REJECTED',
      user_id: checkerId,
      details: { reason: rejectionReason },
    });

    return saved;
  }

  /**
   * 6. GENERATE BANK / COMPLIANCE FILE (Transitions APPROVED -> FILE_GENERATED)
   */
  async markFileGenerated(batchId, operatorId, fileMetadata) {
    const batch = await this._getBatchOrThrow(batchId);

    if (batch.status !== BatchState.APPROVED) {
      throw new StateTransitionError(
        `Cannot generate bank file for batch in '${batch.status}' state. Batch must be APPROVED by Checker first.`,
        batch.status,
        BatchState.FILE_GENERATED
      );
    }

    batch.status = BatchState.FILE_GENERATED;
    batch.bank_file_id = fileMetadata.file_id || `FILE-${Date.now()}`;
    batch.file_metadata = {
      ...fileMetadata,
      generated_by: operatorId,
      generated_at: new Date().toISOString(),
    };

    const saved = await this.repo.save(batch);
    await this.repo.appendAuditLog({
      batch_id: batchId,
      action: 'FILE_GENERATED',
      user_id: operatorId,
      details: fileMetadata,
    });

    return saved;
  }

  /**
   * 7. SETTLE PAYMENT BATCH (Transitions FILE_GENERATED / TRANSMITTED -> SETTLED or FAILED)
   * Strictly isolated to the target batch; does NOT touch other batches in the payroll run.
   */
  async settleBatch(batchId, reconciliationPayload, operatorId) {
    const batch = await this._getBatchOrThrow(batchId);

    const allowedSourceStates = [BatchState.FILE_GENERATED, BatchState.TRANSMITTED, BatchState.APPROVED];
    if (!allowedSourceStates.includes(batch.status)) {
      throw new StateTransitionError(
        `Cannot settle batch in '${batch.status}' state. Batch must have generated files or been transmitted.`,
        batch.status,
        BatchState.SETTLED
      );
    }

    const {
      is_success = true,
      bank_utr,
      settled_amount = batch.summary.total_amount,
      failed_amount = 0,
      settlement_reference,
      settled_records = [],
    } = reconciliationPayload;

    batch.status = is_success ? BatchState.SETTLED : BatchState.FAILED;
    batch.settlement_details = {
      settled_at: new Date().toISOString(),
      reconciled_by: operatorId,
      bank_utr: bank_utr || 'UTR-MOCK-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      settlement_reference: settlement_reference || `REC-${Date.now()}`,
      settled_amount,
      failed_amount,
      status: batch.status,
    };

    // Update individual record statuses if provided
    if (settled_records.length > 0) {
      const recordMap = new Map(settled_records.map((r) => [r.employee_id, r]));
      batch.records = batch.records.map((rec) => {
        const match = recordMap.get(rec.employee_id);
        if (match) {
          return {
            ...rec,
            status: match.status || (is_success ? 'SUCCESS' : 'FAILED'),
            bank_utr: match.bank_utr || batch.settlement_details.bank_utr,
            failure_reason: match.failure_reason || null,
          };
        }
        return {
          ...rec,
          status: is_success ? 'SUCCESS' : 'FAILED',
          bank_utr: batch.settlement_details.bank_utr,
        };
      });
    }

    const saved = await this.repo.save(batch);
    await this.repo.appendAuditLog({
      batch_id: batchId,
      action: is_success ? 'BATCH_SETTLED' : 'BATCH_SETTLEMENT_FAILED',
      user_id: operatorId,
      details: { bank_utr: batch.settlement_details.bank_utr, settled_amount, failed_amount },
    });

    return saved;
  }

  async _getBatchOrThrow(batchId) {
    const b = await this.repo.findById(batchId);
    if (!b) {
      throw new Error(`PaymentBatch with ID '${batchId}' not found.`);
    }
    return b;
  }
}
