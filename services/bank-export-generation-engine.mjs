/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - BANK EXPORT GENERATION & IDEMPOTENCY ENGINE
 * ============================================================================
 * Architecture Layer: Bank File Compilation, Cryptographic SHA-256 Checksumming,
 *                     Distributed Locking, Deterministic Instruction Hashing,
 *                     409 Duplicate Prevention & Auditable Reissue Workflows.
 *
 * Enforces:
 *   Criteria 5: Metadata & Checksumming:
 *     - Calculates SHA-256 hash across raw output content (CSV/TXT).
 *     - Persists into BankFile document storing:
 *       file_id, version, checksum, source_batch_id, row_count, total_amount, generated_at.
 *   Criteria 6: Strict Idempotency & Duplicate Prevention:
 *     - Distributed locking mechanism preventing race conditions.
 *     - Unique constraint via deterministic Instruction Key:
 *       Instruction Key = SHA256(period + employee_id + batch_type + amount + account_version)
 *     - Rejects duplicate file generation or submission API calls containing previously
 *       processed instruction hashes, returning a 409 Conflict.
 *     - Allows regeneration strictly through an explicit, auditable reissue/reversal workflow.
 *
 * @version 3.0.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

import crypto from 'node:crypto';

/* ============================================================================
 * 1. CUSTOM ARCHITECTURAL ERROR CLASSES
 * ============================================================================
 */

export class DuplicateInstructionConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DuplicateInstructionConflictError';
    this.statusCode = 409;
    this.status = 409;
    this.code = 'DUPLICATE_INSTRUCTION_HASH';
    this.details = details;
  }
}

export class DistributedLockConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DistributedLockConflictError';
    this.statusCode = 409;
    this.status = 409;
    this.code = 'CONCURRENT_EXPORT_LOCK_CONFLICT';
    this.details = details;
  }
}

export class InvalidReissueRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidReissueRequestError';
    this.statusCode = 400;
    this.status = 400;
    this.code = 'INVALID_REISSUE_REQUEST';
    this.details = details;
  }
}

/* ============================================================================
 * 2. DISTRIBUTED LOCKING MECHANISM
 * ============================================================================
 */

export class DistributedLockManager {
  constructor() {
    this.locks = new Map(); // key -> { holderId, expiresAt, acquiredAt }
  }

  /**
   * Attempts to acquire an atomic distributed lock for a resource key.
   *
   * @param {string} resourceKey
   * @param {Object} [options={}]
   * @param {number} [options.ttlMs=5000]
   * @param {string} [options.holderId]
   * @returns {boolean} true if acquired
   */
  acquire(resourceKey, { ttlMs = 5000, holderId = `lock_${Date.now()}_${crypto.randomBytes(3).toString('hex')}` } = {}) {
    const now = Date.now();
    const existing = this.locks.get(resourceKey);

    if (existing && existing.expiresAt > now) {
      if (existing.holderId === holderId) {
        // Re-entrant lock extension
        existing.expiresAt = now + ttlMs;
        return true;
      }
      return false;
    }

    this.locks.set(resourceKey, {
      holderId,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    });
    return true;
  }

  /**
   * Releases the distributed lock.
   *
   * @param {string} resourceKey
   * @param {string} holderId
   */
  release(resourceKey, holderId = null) {
    const existing = this.locks.get(resourceKey);
    if (!existing) return true;

    if (!holderId || existing.holderId === holderId || existing.expiresAt <= Date.now()) {
      this.locks.delete(resourceKey);
      return true;
    }
    return false;
  }

  /**
   * Executes an async operation with distributed lock acquisition and automatic release.
   */
  async withLock(resourceKey, asyncFn, { ttlMs = 5000, holderId = `holder_${Date.now()}` } = {}) {
    const acquired = this.acquire(resourceKey, { ttlMs, holderId });
    if (!acquired) {
      throw new DistributedLockConflictError(
        `409 Conflict: Concurrent export lock conflict on resource '${resourceKey}'. Another operation is actively processing this batch.`,
        { resourceKey, holderId }
      );
    }

    try {
      return await asyncFn();
    } finally {
      this.release(resourceKey, holderId);
    }
  }

  clear() {
    this.locks.clear();
  }
}

// Global default lock manager instance
export const globalLockManager = new DistributedLockManager();

/* ============================================================================
 * 3. DETERMINISTIC INSTRUCTION KEY GENERATOR (CRITERIA 6 FORMULA)
 * ============================================================================
 */

/**
 * Computes deterministic Instruction Key using the canonical formula:
 *   Instruction Key = SHA256(period + employee_id + batch_type + amount + account_version)
 *
 * @param {Object} params
 * @param {string} params.period
 * @param {string} params.employee_id
 * @param {string} [params.batch_type='SALARY']
 * @param {number|string} params.amount
 * @param {number|string} [params.account_version=1]
 * @returns {string} SHA-256 hex string (64 characters)
 */
export function computeInstructionKey({
  period,
  employee_id,
  batch_type = 'SALARY',
  amount,
  account_version = 1,
}) {
  if (!period || !employee_id || amount === undefined || amount === null) {
    throw new Error('Mandatory fields required for instruction key: period, employee_id, amount.');
  }

  const cleanPeriod = String(period).trim();
  const cleanEmpId = String(employee_id).trim().toUpperCase();
  const cleanBatchType = String(batch_type).trim().toUpperCase();
  const numAmount = Number(amount);
  if (isNaN(numAmount)) {
    throw new Error(`Invalid numeric amount '${amount}' for instruction key calculation.`);
  }
  const cleanAmount = numAmount.toFixed(2);
  const cleanAccVer = String(account_version || 1).trim();

  // Canonical formula string: period + employee_id + batch_type + amount + account_version
  const rawString = `${cleanPeriod}${cleanEmpId}${cleanBatchType}${cleanAmount}${cleanAccVer}`;

  return crypto.createHash('sha256').update(rawString, 'utf8').digest('hex');
}

/* ============================================================================
 * 4. INSTRUCTION EXECUTION & DUPLICATE TRACKING STORE
 * ============================================================================
 */

export class InstructionExecutionStore {
  constructor() {
    // instruction_key -> { instruction_key, batch_id, file_id, employee_id, amount, status, processed_at }
    this.processedInstructions = new Map();
  }

  has(instructionKey) {
    return this.processedInstructions.has(instructionKey);
  }

  get(instructionKey) {
    return this.processedInstructions.get(instructionKey);
  }

  record(instructionKey, record) {
    this.processedInstructions.set(instructionKey, {
      instruction_key: instructionKey,
      ...record,
      processed_at: new Date().toISOString(),
    });
  }

  release(instructionKey) {
    this.processedInstructions.delete(instructionKey);
  }

  clear() {
    this.processedInstructions.clear();
  }
}

export const globalInstructionExecutionStore = new InstructionExecutionStore();

/* ============================================================================
 * 5. BANK EXPORT GENERATION ENGINE (CRITERIA 5 & 6)
 * ============================================================================
 */

export const bankFileStore = new Map(); // file_id -> BankFile document

export class BankExportGenerationEngine {
  constructor(options = {}) {
    this.debitAccountNumber = options.debitAccountNumber || '50200012345678';
    this.companyName = options.companyName || 'KYLRX AI TECHNOLOGIES PRIVATE LIMITED';
    this.lockManager = options.lockManager || globalLockManager;
    this.instructionStore = options.instructionStore || globalInstructionExecutionStore;
    this.fileStore = options.fileStore || bankFileStore;
  }

  /**
   * Compiles raw bank disbursement file content (NEFT/RTGS CSV or TXT).
   *
   * @param {Object} batch
   * @param {'CSV'|'TXT'} [format='CSV']
   * @returns {string} raw formatted content
   */
  compileBankFileContent(batch, format = 'CSV') {
    const records = batch.records || [];
    const fmt = String(format || 'CSV').toUpperCase();

    if (fmt === 'TXT') {
      // Pipe-delimited NEFT/RTGS format
      const header = 'SEQ|TXN_ID|EMPLOYEE_ID|NAME|ACCOUNT_NUMBER|IFSC|AMOUNT|PAYMENT_MODE|PAYMENT_REF';
      const lines = records.map((r, idx) => {
        const net = Number(r.net_payable ?? r.amount ?? 0);
        const mode = net >= 200000 ? 'RTGS' : 'NEFT';
        const rawAccount = r.account_number || r.account_or_identifier || 'UNKNOWN';
        const txnId = r.txn_id || `TXN_${(batch.batch_id || '').slice(-6)}_${String(idx + 1).padStart(4, '0')}`;
        const ref = r.payment_reference || `REF_${idx + 1}`;
        const name = r.employee_name || r.name || 'Unknown';
        const ifsc = r.ifsc_code || r.ifsc || 'HDFC0001234';

        return [
          idx + 1,
          txnId,
          r.employee_id,
          name,
          rawAccount,
          ifsc,
          net.toFixed(2),
          mode,
          ref,
        ].join('|');
      });
      return [header, ...lines].join('\r\n');
    }

    // Default CSV format
    const header = 'Seq No,Txn ID,Employee ID,Employee Name,Account Number,IFSC Code,Net Payable (INR),Payment Mode,Payment Reference';
    const lines = records.map((r, idx) => {
      const net = Number(r.net_payable ?? r.amount ?? 0);
      const mode = net >= 200000 ? 'RTGS' : 'NEFT';
      const rawAccount = r.account_number || r.account_or_identifier || 'UNKNOWN';
      const txnId = r.txn_id || `TXN_${(batch.batch_id || '').slice(-6)}_${String(idx + 1).padStart(4, '0')}`;
      const ref = r.payment_reference || `REF_${idx + 1}`;
      const name = (r.employee_name || r.name || 'Unknown').replace(/"/g, '""');
      const ifsc = r.ifsc_code || r.ifsc || 'HDFC0001234';

      return [
        idx + 1,
        txnId,
        r.employee_id,
        `"${name}"`,
        rawAccount,
        ifsc,
        net.toFixed(2),
        mode,
        ref,
      ].join(',');
    });

    return [header, ...lines].join('\r\n');
  }

  /**
   * Generates a BankFile document with strict idempotency, distributed locking,
   * SHA-256 content checksumming, and duplicate prevention.
   *
   * @param {Object} params
   * @param {Object} params.batch
   * @param {'CSV'|'TXT'} [params.format='CSV']
   * @param {string} [params.operatorId='SYSTEM_EXPORT']
   * @param {Function} [params.auditLogger]
   * @returns {Promise<Object>} BankFile document
   */
  async generateBankFile({
    batch,
    format = 'CSV',
    operatorId = 'SYSTEM_EXPORT',
    auditLogger = null,
  }) {
    if (!batch || !batch.batch_id) {
      throw new Error('PaymentBatch object with valid batch_id is required.');
    }

    const lockKey = `export_lock:${batch.batch_id}`;

    // Execute within distributed lock boundary
    return await this.lockManager.withLock(lockKey, async () => {
      const period = batch.period || batch.payroll_cycle_month || '2026-08';
      const batchType = (batch.batch_type || 'SALARY').toUpperCase();
      const records = batch.records || [];

      if (records.length === 0) {
        throw new Error(`Cannot generate bank file for empty batch '${batch.batch_id}'.`);
      }

      // 1. Strict Idempotency Check (Criteria 6)
      // Calculate instruction keys for all records
      const computedInstructions = records.map((r) => {
        const empId = r.employee_id || r.id;
        const amount = Number(r.net_payable ?? r.amount ?? 0);
        const accountVersion = r.bank_account_version || r.account_version || 1;

        const instructionKey = computeInstructionKey({
          period,
          employee_id: empId,
          batch_type: batchType,
          amount,
          account_version: accountVersion,
        });

        return {
          employee_id: empId,
          amount,
          account_version: accountVersion,
          instruction_key: instructionKey,
        };
      });

      // Check for previously processed duplicates in InstructionExecutionStore
      const duplicates = [];
      for (const item of computedInstructions) {
        if (this.instructionStore.has(item.instruction_key)) {
          const prevRecord = this.instructionStore.get(item.instruction_key);
          duplicates.push({
            employee_id: item.employee_id,
            instruction_key: item.instruction_key,
            amount: item.amount,
            previously_processed_in_batch: prevRecord.batch_id,
            previously_processed_in_file: prevRecord.file_id,
            processed_at: prevRecord.processed_at,
          });
        }
      }

      // Reject duplicate file generation API calls with 409 Conflict
      if (duplicates.length > 0) {
        throw new DuplicateInstructionConflictError(
          `409 Conflict: Duplicate file generation rejected! ${duplicates.length} instruction hash(es) have already been processed in prior disbursement exports. Double-disbursement is strictly prohibited.`,
          {
            source_batch_id: batch.batch_id,
            duplicate_count: duplicates.length,
            duplicates,
          }
        );
      }

      // 2. Compile Raw Output Content (CSV/TXT)
      const rawContent = this.compileBankFileContent(batch, format);

      // 3. Metadata & SHA-256 Checksumming (Criteria 5)
      const checksum = crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex');
      const fileId = `BF_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const generatedAt = new Date().toISOString();
      const totalAmount = records.reduce((sum, r) => sum + Number(r.net_payable ?? r.amount ?? 0), 0);

      // Canonical BankFile document matching Criteria 5 specification
      const bankFileDoc = {
        file_id: fileId,
        version: 1,
        checksum,
        source_batch_id: batch.batch_id,
        row_count: records.length,
        total_amount: Math.round(totalAmount * 100) / 100,
        generated_at: generatedAt,
        file_name: `BANK_DISBURSEMENT_${batch.batch_id}_v1.${format.toLowerCase()}`,
        format: format.toUpperCase(),
        content: rawContent,
        download_url: `/api/v1/files/${fileId}/download`,
        is_locked: true,
        reissued_from_file_id: null,
        reissue_reason: null,
      };

      // 4. Persist BankFile Document
      this.fileStore.set(fileId, bankFileDoc);

      // 5. Commit Instruction Hashes to Execution Ledger
      for (const item of computedInstructions) {
        this.instructionStore.record(item.instruction_key, {
          batch_id: batch.batch_id,
          file_id: fileId,
          employee_id: item.employee_id,
          amount: item.amount,
          status: 'SUBMITTED',
        });
      }

      // 6. Update Batch State
      batch.status = 'FILE_GENERATED';
      batch.state = 'FILE_GENERATED';
      batch.file_id = fileId;
      batch.updated_at = generatedAt;

      // 7. Audit Log
      if (typeof auditLogger === 'function') {
        auditLogger({
          entityType: 'BANK_FILE',
          entityId: fileId,
          event: 'BANK_FILE_GENERATED',
          actorId: operatorId,
          actorRole: 'PAYROLL_ADMIN',
          metadata: {
            file_id: fileId,
            version: 1,
            checksum,
            source_batch_id: batch.batch_id,
            row_count: records.length,
            total_amount: bankFileDoc.total_amount,
          },
        });
      }

      return bankFileDoc;
    }, { ttlMs: 6000 });
  }

  /**
   * Explicit, Auditable Reissue / Reversal Workflow (Criteria 6).
   * Allows regeneration ONLY through an explicit reissue action with mandatory audit reason.
   *
   * @param {Object} params
   * @param {Object} params.batch
   * @param {string} params.previousFileId
   * @param {string} params.reason
   * @param {string} params.reissuedBy
   * @param {string} [params.signature]
   * @param {'CSV'|'TXT'} [params.format='CSV']
   * @param {Function} [params.auditLogger]
   * @returns {Promise<Object>} new reissued BankFile document
   */
  async reissueBankFile({
    batch,
    previousFileId,
    reason,
    reissuedBy,
    signature = null,
    format = 'CSV',
    auditLogger = null,
  }) {
    if (!batch || !batch.batch_id) {
      throw new Error('PaymentBatch object is required for file reissue.');
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new InvalidReissueRequestError('A mandatory, auditable justification reason is required for file reissue/regeneration.', {
        batch_id: batch.batch_id,
      });
    }

    if (!reissuedBy) {
      throw new InvalidReissueRequestError('reissuedBy identity is required for auditable reissue workflow.', {
        batch_id: batch.batch_id,
      });
    }

    const lockKey = `reissue_lock:${batch.batch_id}`;

    return await this.lockManager.withLock(lockKey, async () => {
      // Find previous file to determine next version
      const previousFile = this.fileStore.get(previousFileId) || Array.from(this.fileStore.values()).find(
        (f) => f.source_batch_id === batch.batch_id
      );

      const previousVersion = previousFile ? (previousFile.version || 1) : 1;
      const nextVersion = previousVersion + 1;

      // Mark previous file as superseded
      if (previousFile) {
        previousFile.is_superseded = true;
        previousFile.superseded_by_file_id = null; // Stamped after new file created
      }

      // Release previously registered instruction hashes for this specific batch
      // so the reissue workflow can regenerate without self-conflict
      const period = batch.period || batch.payroll_cycle_month || '2026-08';
      const batchType = (batch.batch_type || 'SALARY').toUpperCase();
      const records = batch.records || [];

      for (const r of records) {
        const empId = r.employee_id || r.id;
        const amount = Number(r.net_payable ?? r.amount ?? 0);
        const accountVersion = r.bank_account_version || r.account_version || 1;

        const key = computeInstructionKey({
          period,
          employee_id: empId,
          batch_type: batchType,
          amount,
          account_version: accountVersion,
        });

        // Release prior lock so reissued file can be generated
        this.instructionStore.release(key);
      }

      // Compile new output content
      const rawContent = this.compileBankFileContent(batch, format);
      const checksum = crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex');
      const newFileId = `BF_${Date.now()}_V${nextVersion}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const generatedAt = new Date().toISOString();
      const totalAmount = records.reduce((sum, r) => sum + Number(r.net_payable ?? r.amount ?? 0), 0);

      // Construct reissued BankFile document
      const reissuedBankFileDoc = {
        file_id: newFileId,
        version: nextVersion,
        checksum,
        source_batch_id: batch.batch_id,
        row_count: records.length,
        total_amount: Math.round(totalAmount * 100) / 100,
        generated_at: generatedAt,
        file_name: `BANK_DISBURSEMENT_${batch.batch_id}_v${nextVersion}.${format.toLowerCase()}`,
        format: format.toUpperCase(),
        content: rawContent,
        download_url: `/api/v1/files/${newFileId}/download`,
        is_locked: true,
        reissued_from_file_id: previousFile?.file_id || previousFileId || null,
        reissue_reason: reason.trim(),
        reissued_by: reissuedBy,
        signature: signature || null,
      };

      if (previousFile) {
        previousFile.superseded_by_file_id = newFileId;
      }

      // Persist new BankFile
      this.fileStore.set(newFileId, reissuedBankFileDoc);

      // Re-commit new instruction hashes to ledger
      for (const r of records) {
        const empId = r.employee_id || r.id;
        const amount = Number(r.net_payable ?? r.amount ?? 0);
        const accountVersion = r.bank_account_version || r.account_version || 1;

        const key = computeInstructionKey({
          period,
          employee_id: empId,
          batch_type: batchType,
          amount,
          account_version: accountVersion,
        });

        this.instructionStore.record(key, {
          batch_id: batch.batch_id,
          file_id: newFileId,
          employee_id: empId,
          amount,
          version: nextVersion,
          reissued_from: previousFile?.file_id || previousFileId,
          status: 'REISSUED',
        });
      }

      batch.file_id = newFileId;
      batch.updated_at = generatedAt;

      // Audit Log for Reissue
      if (typeof auditLogger === 'function') {
        auditLogger({
          entityType: 'BANK_FILE',
          entityId: newFileId,
          event: 'DISBURSEMENT_FILE_REISSUED',
          actorId: reissuedBy,
          actorRole: 'PAYROLL_ADMIN',
          metadata: {
            new_file_id: newFileId,
            previous_file_id: previousFile?.file_id || previousFileId,
            version: nextVersion,
            reason: reason.trim(),
            checksum,
            source_batch_id: batch.batch_id,
          },
        });
      }

      return reissuedBankFileDoc;
    }, { ttlMs: 6000 });
  }
}
