/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - IDEMPOTENCY & UNIQUENESS ENFORCEMENT ENGINE
 * ============================================================================
 * Module: Deterministic Key Generation, Double-Disbursement Prevention,
 *         API-Level Pre-Execution Middleware, 409 Conflict Guardrails,
 *         and Cryptographically Signed Reissue/Reversal Workflow.
 *
 * Deterministic Key Formula:
 *   Instruction Hash = SHA256(period + employee_id + batch_type + amount + bank_account_version)
 *
 * Capabilities:
 *  1. Deterministic hashing attaches immutable instruction_key and instruction_id to every payment row.
 *  2. API-Level Pre-Execution Guardrails for file generation and submission endpoints:
 *     - Intercepts and immediately aborts requests containing any SUBMITTED or SUCCESSFUL instructions with 409 Conflict.
 *  3. Cryptographically Signed Reissue & Reversal Flow:
 *     - Verifies administrator cryptographic signatures before creating a new, auditable instruction record.
 *
 * @version 2.0.0
 * @author Kylrx AI Principal Backend Engineering Team
 */

import crypto from 'node:crypto';

export class IdempotencyConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.statusCode = 409;
    this.status = 409;
    this.details = details;
  }
}

export class UnauthorizedReissueError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UnauthorizedReissueError';
    this.statusCode = 403;
    this.status = 403;
    this.details = details;
  }
}

export class InvalidSignatureError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidSignatureError';
    this.statusCode = 401;
    this.status = 401;
    this.details = details;
  }
}

/**
 * Computes Cryptographic SHA-256 Digest
 */
export function computeSha256(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

/**
 * Generates HMAC-SHA256 Cryptographic Signature for Admin Reissue Authorization
 */
export function signReissueAuthorization(payload, secretKey = 'KYLRX_SECURE_ADMIN_KEY_2026') {
  const canonicalString = typeof payload === 'string' ? payload : JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHmac('sha256', String(secretKey)).update(canonicalString).digest('hex');
}

/**
 * Verifies Cryptographic Signature for Admin Reissue Authorization
 */
export function verifyReissueAuthorization(payload, signature, secretKey = 'KYLRX_SECURE_ADMIN_KEY_2026') {
  if (!signature || typeof signature !== 'string') return false;
  const expected = signReissueAuthorization(payload, secretKey);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * 1. Deterministic Key Generator
 * Formula: SHA256(period + employee_id + batch_type + amount + bank_account_version)
 */
export function generateDeterministicInstructionKey({
  period,
  employee_id,
  batch_type = 'SALARY',
  amount,
  bank_account_version = 1,
  reissue_sequence = 0,
}) {
  if (!period || !employee_id || amount === undefined || amount === null) {
    throw new Error('Mandatory fields required for instruction key generation: period, employee_id, amount.');
  }

  const cleanPeriod = String(period).trim();
  const cleanEmpId = String(employee_id).trim().toUpperCase();
  const cleanBatchType = String(batch_type).trim().toUpperCase();
  const numAmount = Number(amount);
  if (isNaN(numAmount)) {
    throw new Error(`Invalid amount '${amount}' for instruction key generation.`);
  }
  const cleanAmount = numAmount.toFixed(2);
  const cleanAccVer = String(bank_account_version || 1).trim();
  const cleanReissueSeq = Number(reissue_sequence || 0);

  // Exact canonical composition string
  const rawComposition = `${cleanPeriod}::${cleanEmpId}::${cleanBatchType}::${cleanAmount}::${cleanAccVer}${cleanReissueSeq > 0 ? `::REISSUE_${cleanReissueSeq}` : ''}`;
  const instructionKey = computeSha256(rawComposition);
  const instructionId = `INS-${instructionKey.substring(0, 16).toUpperCase()}`;

  return {
    instruction_key: instructionKey,
    instruction_id: instructionId,
    raw_composition: rawComposition,
    period: cleanPeriod,
    employee_id: cleanEmpId,
    batch_type: cleanBatchType,
    amount: cleanAmount,
    bank_account_version: cleanAccVer,
    reissue_sequence: cleanReissueSeq,
  };
}

/**
 * In-Memory & Database-Ready Instruction Ledger Store
 */
export class InstructionExecutionLedger {
  constructor() {
    this.executedInstructions = new Map(); // instruction_id -> record
    this.reissueAuditLogs = [];
  }

  async registerExecution(record) {
    const cloned = JSON.parse(JSON.stringify(record));
    this.executedInstructions.set(record.instruction_id, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  async findByInstructionId(instructionId) {
    const r = this.executedInstructions.get(instructionId);
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  async findByInstructionKey(instructionKey) {
    for (const r of this.executedInstructions.values()) {
      if (r.instruction_key === instructionKey) {
        return JSON.parse(JSON.stringify(r));
      }
    }
    return null;
  }

  async updateInstructionStatus(instructionId, newStatus, metadata = {}) {
    const r = this.executedInstructions.get(instructionId);
    if (!r) throw new Error(`Instruction '${instructionId}' not found.`);
    r.status = newStatus;
    r.updated_at = new Date().toISOString();
    r.metadata = { ...r.metadata, ...metadata };
    return JSON.parse(JSON.stringify(r));
  }

  async appendReissueLog(logEntry) {
    const immutableEntry = Object.freeze({
      log_id: `LOG-REISSUE-${crypto.randomUUID()}`,
      ...logEntry,
      timestamp: new Date().toISOString(),
    });
    this.reissueAuditLogs.push(immutableEntry);
    return JSON.parse(JSON.stringify(immutableEntry));
  }

  async getReissueLogs(originalInstructionId = null) {
    if (!originalInstructionId) return JSON.parse(JSON.stringify(this.reissueAuditLogs));
    return JSON.parse(JSON.stringify(this.reissueAuditLogs.filter((l) => l.original_instruction_id === originalInstructionId)));
  }
}

/**
 * Idempotency & Uniqueness Enforcement Engine
 */
export class IdempotencyUniquenessEngine {
  constructor(options = {}) {
    this.ledger = options.ledger || new InstructionExecutionLedger();
    this.signingSecret = options.signingSecret || 'KYLRX_SECURE_ADMIN_KEY_2026';
  }

  /**
   * 1. Stamp Batch Records with Deterministic Instruction Keys
   */
  stampBatchInstructions(batch, records = []) {
    const period = batch.period || 'September 2026';
    const batchType = batch.batch_type || 'SALARY';

    return records.map((rec) => {
      const empId = rec.employee_id || rec.id || rec.emp_id;
      const amount = rec.net_payable_amount ?? rec.netSalary ?? rec.net ?? rec.amount ?? 0;
      const accVer = rec.bank_account_version || rec.account_version || 1;
      const reissueSeq = rec.reissue_sequence || 0;

      const { instruction_key, instruction_id, raw_composition } = generateDeterministicInstructionKey({
        period,
        employee_id: empId,
        batch_type: batchType,
        amount,
        bank_account_version: accVer,
        reissue_sequence: reissueSeq,
      });

      return {
        ...rec,
        instruction_id,
        instruction_key,
        instruction_raw_composition: raw_composition,
        bank_account_version: accVer,
        reissue_sequence: reissueSeq,
      };
    });
  }

  /**
   * 2. Submission & Export Protection Gate (Throws 409 Conflict on Duplicate Execution)
   * Aborts immediately if any instruction_id has already been marked as SUCCESSFUL, SETTLED, SUBMITTED, or EXECUTED.
   */
  async verifyAndGuardInstructions(instructions = [], { batch_id = 'BATCH', channel = 'BANK_TRANSMISSION' } = {}) {
    const duplicates = [];
    const activeStatuses = ['SUBMITTED', 'SUCCESSFUL', 'SETTLED', 'EXECUTED', 'COMMITTED', 'PROCESSING'];

    for (const inst of instructions) {
      const instId = inst.instruction_id;
      const instKey = inst.instruction_key;

      if (!instId || !instKey) {
        throw new Error('Instruction missing deterministic instruction_id or instruction_key.');
      }

      // Check against ledger
      const existing = (await this.ledger.findByInstructionId(instId)) || (await this.ledger.findByInstructionKey(instKey));
      if (existing) {
        // If existing is already active/submitted/settled and not reversed -> Conflict!
        if (activeStatuses.includes(existing.status)) {
          duplicates.push({
            instruction_id: instId,
            instruction_key: instKey,
            employee_id: inst.employee_id || existing.employee_id,
            amount: inst.net_payable_amount || inst.amount || existing.amount,
            original_submission_timestamp: existing.executed_at || existing.submitted_at || existing.created_at,
            original_batch_id: existing.batch_id,
            status: existing.status,
          });
        }
      }
    }

    if (duplicates.length > 0) {
      const duplicateIds = duplicates.map((d) => d.instruction_id).join(', ');
      throw new IdempotencyConflictError(
        `409 Conflict: Double-Disbursement Protection Triggered! The following instruction ID(s) have already been executed/submitted in past disbursement runs: [${duplicateIds}]. Duplicate payment submission blocked.`,
        {
          duplicate_count: duplicates.length,
          duplicates,
          batch_id,
          channel,
        }
      );
    }

    return {
      allowed: true,
      instruction_count: instructions.length,
      verified_at: new Date().toISOString(),
    };
  }

  /**
   * 3. Commit Instruction Executions into Immutable Ledger
   */
  async commitInstructions(instructions = [], { batch_id, executed_by, channel = 'BANK_EXPORT' }) {
    // First run verification guard
    await this.verifyAndGuardInstructions(instructions, { batch_id, channel });

    const now = new Date().toISOString();
    const registered = [];

    for (const inst of instructions) {
      const record = {
        instruction_id: inst.instruction_id,
        instruction_key: inst.instruction_key,
        batch_id,
        employee_id: inst.employee_id || inst.id,
        amount: Number(inst.net_payable_amount ?? inst.amount ?? 0),
        status: 'SUBMITTED',
        executed_by: executed_by || 'SYSTEM',
        executed_at: now,
        channel,
        reissue_sequence: inst.reissue_sequence || 0,
        metadata: {
          period: inst.period,
          account_number: inst.account_number,
          ifsc: inst.ifsc || inst.ifsc_code,
        },
      };

      const saved = await this.ledger.registerExecution(record);
      registered.push(saved);
    }

    return registered;
  }

  /**
   * 4. Controlled Reissue & Reversal Workflow with Cryptographic Signature Verification
   * Requires privileged administrator authorization (PAYROLL_ADMIN or FINANCE_HEAD)
   * AND valid cryptographic signature of the reissue command.
   */
  async executeControlledReissue({
    original_instruction_id,
    requestingUser,
    reason,
    signature,
    new_amount = null,
    new_bank_account_version = null,
    new_period = null,
  }) {
    // A. Role Authorization Gate
    const authorizedRoles = ['PAYROLL_ADMIN', 'FINANCE_HEAD'];
    if (!requestingUser || !authorizedRoles.includes(requestingUser.role)) {
      throw new UnauthorizedReissueError(
        `403 Forbidden: User '${requestingUser?.user_id || 'UNKNOWN'}' with role '${requestingUser?.role || 'NONE'}' is unauthorized to execute instruction reissues. Required roles: [${authorizedRoles.join(', ')}].`,
        { user_id: requestingUser?.user_id, role: requestingUser?.role, requiredRoles: authorizedRoles }
      );
    }

    if (!reason || !reason.trim()) {
      throw new Error('A mandatory audited reason must be supplied for controlled payment reissue.');
    }

    // B. Cryptographic Signature Verification Gate
    if (!signature) {
      throw new InvalidSignatureError('Cryptographic administrator signature is required for controlled reissue/reversal.', {
        instruction_id: original_instruction_id,
        user_id: requestingUser.user_id,
      });
    }

    const verificationPayload = {
      action: 'REISSUE_OR_REVERSAL',
      instruction_id: original_instruction_id,
      authorized_by: requestingUser.user_id,
      reason: reason.trim(),
    };

    const isValidSignature = verifyReissueAuthorization(verificationPayload, signature, this.signingSecret);
    if (!isValidSignature) {
      throw new InvalidSignatureError('Cryptographic signature verification failed for administrator reissue command.', {
        instruction_id: original_instruction_id,
        user_id: requestingUser.user_id,
      });
    }

    // C. Locate Original Instruction
    const original = await this.ledger.findByInstructionId(original_instruction_id);
    if (!original) {
      throw new Error(`Original instruction '${original_instruction_id}' not found in execution ledger.`);
    }

    // D. Transition Original Instruction to REVERSED
    await this.ledger.updateInstructionStatus(original_instruction_id, 'REVERSED', {
      reversed_by: requestingUser.user_id,
      reversal_reason: reason,
      signature,
      reversed_at: new Date().toISOString(),
    });

    // E. Compute Next Reissue Sequence and Fresh Deterministic Keys
    const nextReissueSeq = (original.reissue_sequence || 0) + 1;
    const finalAmount = new_amount !== null ? new_amount : original.amount;
    const finalAccVer = new_bank_account_version !== null ? new_bank_account_version : (original.metadata?.bank_account_version || 1);
    const finalPeriod = new_period || original.metadata?.period || 'September 2026';

    const newKeyGen = generateDeterministicInstructionKey({
      period: finalPeriod,
      employee_id: original.employee_id,
      batch_type: original.batch_type || 'SALARY',
      amount: finalAmount,
      bank_account_version: finalAccVer,
      reissue_sequence: nextReissueSeq,
    });

    // F. Register Reissued Instruction Record
    const now = new Date().toISOString();
    const reissuedRecord = {
      instruction_id: newKeyGen.instruction_id,
      instruction_key: newKeyGen.instruction_key,
      batch_id: `REISSUE-${original.batch_id}`,
      employee_id: original.employee_id,
      amount: Number(finalAmount),
      status: 'INITIALIZED',
      executed_by: requestingUser.user_id,
      executed_at: now,
      channel: original.channel || 'BANK_REISSUE_QUEUE',
      reissue_sequence: nextReissueSeq,
      original_instruction_id: original_instruction_id,
      signature,
      metadata: {
        ...original.metadata,
        reissue_reason: reason,
        bank_account_version: finalAccVer,
      },
    };

    await this.ledger.registerExecution(reissuedRecord);

    // G. Append Immutable Reissue Audit Log
    const reissueLog = await this.ledger.appendReissueLog({
      original_instruction_id,
      new_instruction_id: newKeyGen.instruction_id,
      original_instruction_key: original.instruction_key,
      new_instruction_key: newKeyGen.instruction_key,
      employee_id: original.employee_id,
      authorized_by: requestingUser.user_id,
      authorized_role: requestingUser.role,
      reason,
      signature,
      reissue_sequence: nextReissueSeq,
      amount: finalAmount,
    });

    return {
      success: true,
      action: 'CONTROLLED_REISSUE',
      original_instruction_id,
      original_status: 'REVERSED',
      reissued_instruction: reissuedRecord,
      reissue_audit_log: reissueLog,
    };
  }

  /**
   * 5. Pre-Execution Express Middleware for File Generation & Submission Endpoints
   */
  createIdempotencyGuardMiddleware({ channel = 'API_ENDPOINT' } = {}) {
    return async (req, res, next) => {
      try {
        const batchId = req.params.batchId || req.body.batch_id || 'BATCH_DISBURSEMENT';
        let records = req.body.records || [];

        // Stamp incoming records if not already stamped
        const stampedRecords = this.stampBatchInstructions({
          period: req.body.period || 'September 2026',
          batch_type: req.body.batch_type || 'SALARY',
        }, records);

        // Verify against double-disbursement guard
        await this.verifyAndGuardInstructions(stampedRecords, { batch_id: batchId, channel });
        req.stampedInstructions = stampedRecords;
        next();
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return res.status(409).json({
            success: false,
            error: '409_CONFLICT_DOUBLE_DISBURSEMENT_BLOCKED',
            message: error.message,
            details: error.details,
          });
        }
        return res.status(500).json({
          success: false,
          error: 'IDEMPOTENCY_VERIFICATION_ERROR',
          message: error.message,
        });
      }
    };
  }
}
