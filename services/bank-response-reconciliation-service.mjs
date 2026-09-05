/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - BANK RESPONSE RECONCILIATION SERVICE
 * ============================================================================
 * Module: Bank Settlement Response Ingestion (CSV / XML / TXT), 1:1 Transaction
 *         Matching Engine, Settlement Verification (Anti-Assumption Guard),
 *         Reconciliation Discrepancies Queue, and Parent Batch RECONCILING Lock.
 *
 * Implements Criterion 7:
 *  1. 1:1 Matching Engine:
 *     - Ingests bank response files in CSV, XML, or TXT formats.
 *     - Matches each row against internal instructions using txn_id or unique
 *       payment references.
 *     - Enforces strict 1:1 bijection (detects and flags fan-in collisions).
 *  2. Settlement Verification (Anti-Assumption Guard):
 *     - Updates matched records with clearing status (PAID / FAILED), settlement
 *       timestamp, and trace references (bank_ref / UTR).
 *     - Anti-Assumption Guard: Never set status to PAID without positive bank
 *       confirmation (status=PAID/SUCCESS, non-blank UTR, delta=0).
 *  3. Reconciliation Discrepancies & Exception Queue:
 *     - If a row fails to match, reports an amount discrepancy (Δ ≠ 0), or flags
 *       a duplicate bank reference, it is isolated in a reconciliation_exceptions queue.
 *     - Every exception carries a mandatory signed difference_amount (Δ).
 *     - Leaves the parent batch in RECONCILING status until manual finance desk resolution.
 *  4. Manual Finance Desk Resolution Workflow:
 *     - Explicit resolveException workflow allowing finance desk analysts to action
 *       exceptions (ACCEPT_DIFFERENCE, MARK_FAILED_FOR_RETRY, MANUAL_MATCH, FORCE_SETTLE, WAIVE).
 *     - Re-evaluates parent batch and advances to PAID only after all exceptions are resolved.
 *
 * @version 1.0.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

import crypto from 'node:crypto';

export const DiscrepancyType = Object.freeze({
  UNMATCHED_ROW: 'UNMATCHED_ROW',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  DUPLICATE_BANK_REF: 'DUPLICATE_BANK_REF',
  DUPLICATE_TXN_ID: 'DUPLICATE_TXN_ID',
  FAN_IN_COLLISION: 'FAN_IN_COLLISION',
  MISSING_IDENTIFIER: 'MISSING_IDENTIFIER',
  AMBIGUOUS_CONFIRMATION: 'AMBIGUOUS_CONFIRMATION',
});

export const ExceptionStatus = Object.freeze({
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED: 'RESOLVED',
  WAIVED: 'WAIVED',
});

export const BatchReconciliationLifecycle = Object.freeze({
  RECONCILING: 'RECONCILING',
  PAID: 'PAID',
  SETTLED: 'SETTLED',
  PARTIALLY_SETTLED: 'PARTIALLY_SETTLED',
  FAILED: 'FAILED',
});

const POSITIVE_BANK_STATUSES = new Set(['PAID', 'SUCCESS', 'SETTLED', 'CREDITED', 'CLEARED']);
const NEGATIVE_BANK_STATUSES = new Set(['FAILED', 'REJECTED', 'RETURNED', 'REVERSED', 'BOUNCED']);

/**
 * In-memory Historic Ledger & Exception Store
 */
export class ReconciliationExceptionStore {
  constructor() {
    /** @type {Map<string, object>} */
    this.exceptions = new Map();
    /** @type {Set<string>} */
    this.historicUtrs = new Set();
    /** @type {Set<string>} */
    this.historicTxnIds = new Set();
  }

  saveException(entry) {
    this.exceptions.set(entry.exception_id, { ...entry });
    return entry;
  }

  getException(exceptionId) {
    return this.exceptions.get(exceptionId) || null;
  }

  listExceptionsByBatch(batchId) {
    return Array.from(this.exceptions.values()).filter((e) => e.batch_id === batchId);
  }

  listOpenExceptionsByBatch(batchId) {
    return Array.from(this.exceptions.values()).filter(
      (e) => e.batch_id === batchId && e.status === ExceptionStatus.OPEN
    );
  }

  updateException(exceptionId, updates) {
    const existing = this.exceptions.get(exceptionId);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.exceptions.set(exceptionId, updated);
    return updated;
  }

  registerConfirmedUtr(utr) {
    if (utr && String(utr).trim().length > 0) {
      this.historicUtrs.add(String(utr).trim());
    }
  }

  registerConfirmedTxnId(txnId) {
    if (txnId && String(txnId).trim().length > 0) {
      this.historicTxnIds.add(String(txnId).trim());
    }
  }

  hasUtr(utr) {
    return this.historicUtrs.has(String(utr || '').trim());
  }

  hasTxnId(txnId) {
    return this.historicTxnIds.has(String(txnId || '').trim());
  }

  clear() {
    this.exceptions.clear();
    this.historicUtrs.clear();
    this.historicTxnIds.clear();
  }
}

/**
 * Bank Response Ingestion & Transaction Reconciliation Service
 */
export class BankResponseReconciliationService {
  constructor(options = {}) {
    this.tolerance = typeof options.tolerance === 'number' ? options.tolerance : 0.01;
    this.store = options.store || new ReconciliationExceptionStore();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. PRIMARY INGESTION & RECONCILIATION PIPELINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ingest a bank settlement response file, apply 1:1 matching, verify settlement,
   * isolate discrepancies into reconciliation_exceptions queue, and maintain RECONCILING state.
   *
   * @param {object} params
   * @param {object} params.batch - PaymentBatch document
   * @param {string} params.fileContent - Raw file content (CSV, XML, TXT)
   * @param {string} [params.fileFormat='CSV'] - 'CSV' | 'XML' | 'TXT' | 'JSON'
   * @param {string} [params.fileName='bank_settlement']
   * @param {string} [params.operatorId='RECONCILIATION_SERVICE']
   * @returns {Promise<object>} Reconciliation outcome manifest
   */
  async ingestAndReconcile({
    batch,
    fileContent,
    fileFormat = 'CSV',
    fileName = 'bank_settlement',
    operatorId = 'RECONCILIATION_SERVICE',
  }) {
    if (!batch || !batch.batch_id) {
      throw new Error('[BankResponseReconciliationService] A valid PaymentBatch with batch_id is required.');
    }
    if (!fileContent || String(fileContent).trim().length === 0) {
      throw new Error('[BankResponseReconciliationService] Bank response file content is empty.');
    }

    // Step 1: Initialise batch in RECONCILING status
    batch.status = BatchReconciliationLifecycle.RECONCILING;
    batch.reconciliation_started_at = new Date().toISOString();

    // Step 2: Parse raw bank response feed
    const parsedRows = this.parseBankFeed(fileContent, fileFormat);
    if (!parsedRows || parsedRows.length === 0) {
      throw new Error(`[BankResponseReconciliationService] No parseable settlement rows found in '${fileName}'.`);
    }

    // Step 3: Build 1:1 lookup index over internal instructions
    const instructions = batch.records || batch.instructions || [];
    const instructionLookup = new Map(); // key -> instruction
    const claimedInstructions = new Map(); // instruction_id -> bankRow (detect fan-in collision)

    for (const instruction of instructions) {
      const keys = this._extractInstructionKeys(instruction);
      for (const key of keys) {
        instructionLookup.set(key, instruction);
      }
    }

    // Tracking state for this specific file run
    const seenRunUtrs = new Set();
    const seenRunTxnIds = new Set();

    let matchedCount = 0;
    let unmatchedCount = 0;
    let settledCount = 0;
    let failedCount = 0;
    let totalSettledAmount = 0;
    let totalFailedAmount = 0;

    const runExceptions = [];
    const processedPairs = [];

    // Step 4: 1:1 Matching & Verification Iteration
    for (const row of parsedRows) {
      const {
        txn_id,
        bank_ref,
        employee_id,
        cleared_amount,
        raw_status,
        normalised_status,
        failure_reason,
        settlement_timestamp,
        bank_confirmation_present,
      } = row;

      // ── 1:1 Matching Engine: Locate instruction ──
      const matchedInstruction = this._findInstruction(row, instructionLookup);

      if (!matchedInstruction) {
        // Discrepancy 1: Unmatched Bank Row (Orphaned)
        unmatchedCount++;
        const exc = this._createDiscrepancy({
          batchId: batch.batch_id,
          discrepancyType: DiscrepancyType.UNMATCHED_ROW,
          txnId: txn_id,
          bankRef: bank_ref,
          employeeId: employee_id,
          instructionId: null,
          instructedAmount: null,
          clearedAmount: cleared_amount,
          differenceAmount: cleared_amount, // entire amount is unaccounted for
          reason: `Bank settlement row (txn_id: '${txn_id || 'N/A'}', UTR: '${bank_ref || 'N/A'}', emp: '${employee_id || 'N/A'}') could not be matched to any payment instruction in batch '${batch.batch_id}'.`,
          affectedField: 'txn_id',
          sourceRow: row,
        });
        runExceptions.push(exc);
        this.store.saveException(exc);
        continue;
      }

      // Instruction found: Check for Fan-In Collision (1:1 Bijection rule)
      matchedCount++;
      const instructionId = matchedInstruction.record_id || matchedInstruction.id || matchedInstruction.employee_id;

      if (claimedInstructions.has(instructionId)) {
        // Discrepancy 4: Multiple bank rows claiming the same internal instruction
        const previousRow = claimedInstructions.get(instructionId);
        const exc = this._createDiscrepancy({
          batchId: batch.batch_id,
          discrepancyType: DiscrepancyType.FAN_IN_COLLISION,
          txnId: txn_id,
          bankRef: bank_ref,
          employeeId: matchedInstruction.employee_id,
          instructionId,
          instructedAmount: Number(matchedInstruction.amount ?? matchedInstruction.net_payable_amount ?? 0),
          clearedAmount: cleared_amount,
          differenceAmount: cleared_amount,
          reason: `1:1 Matching violation: Multiple bank response rows (previous txn_id: '${previousRow.txn_id}', current txn_id: '${txn_id}') mapped to instruction '${instructionId}'.`,
          affectedField: 'txn_id',
          sourceRow: row,
        });
        runExceptions.push(exc);
        this.store.saveException(exc);
        continue;
      }

      claimedInstructions.set(instructionId, row);

      const instructedAmount = Number(
        matchedInstruction.amount ??
        matchedInstruction.net_payable_amount ??
        matchedInstruction.net ??
        0
      );

      // ── Discrepancy 2: Amount Mismatch Guard (Δ ≠ 0) ──
      const delta = Math.round((cleared_amount - instructedAmount) * 100) / 100;
      let hasAmountMismatch = false;

      // Only check amount mismatch if cleared_amount > 0 and status was not explicitly a zero-credit return
      if (cleared_amount > 0 && Math.abs(delta) > this.tolerance) {
        hasAmountMismatch = true;
        const exc = this._createDiscrepancy({
          batchId: batch.batch_id,
          discrepancyType: DiscrepancyType.AMOUNT_MISMATCH,
          txnId: txn_id,
          bankRef: bank_ref,
          employeeId: matchedInstruction.employee_id,
          instructionId,
          instructedAmount,
          clearedAmount: cleared_amount,
          differenceAmount: delta, // mandatory signed Δ (cleared - instructed)
          reason: `Cleared bank amount (₹${cleared_amount.toFixed(2)}) differs from instructed amount (₹${instructedAmount.toFixed(2)}) by Δ = ₹${delta.toFixed(2)}.`,
          affectedField: 'cleared_amount',
          sourceRow: row,
        });
        runExceptions.push(exc);
        this.store.saveException(exc);
      }

      // ── Discrepancy 3: Duplicate Bank Reference Guard ──
      let hasDuplicateBankRef = false;
      if (bank_ref && bank_ref.trim().length > 0) {
        const cleanRef = bank_ref.trim();
        if (seenRunUtrs.has(cleanRef) || this.store.hasUtr(cleanRef)) {
          hasDuplicateBankRef = true;
          const exc = this._createDiscrepancy({
            batchId: batch.batch_id,
            discrepancyType: DiscrepancyType.DUPLICATE_BANK_REF,
            txnId: txn_id,
            bankRef: cleanRef,
            employeeId: matchedInstruction.employee_id,
            instructionId,
            instructedAmount,
            clearedAmount: cleared_amount,
            differenceAmount: cleared_amount,
            reason: `Duplicate bank reference (UTR: '${cleanRef}') detected! This reference was already processed in this batch or in a prior settlement run.`,
            affectedField: 'bank_ref',
            sourceRow: row,
          });
          runExceptions.push(exc);
          this.store.saveException(exc);
        } else {
          seenRunUtrs.add(cleanRef);
        }
      }

      // Check duplicate txn_id
      if (txn_id && txn_id.trim().length > 0) {
        const cleanTxnId = txn_id.trim();
        if (seenRunTxnIds.has(cleanTxnId) || this.store.hasTxnId(cleanTxnId)) {
          const exc = this._createDiscrepancy({
            batchId: batch.batch_id,
            discrepancyType: DiscrepancyType.DUPLICATE_TXN_ID,
            txnId: cleanTxnId,
            bankRef: bank_ref,
            employeeId: matchedInstruction.employee_id,
            instructionId,
            instructedAmount,
            clearedAmount: cleared_amount,
            differenceAmount: cleared_amount,
            reason: `Duplicate bank transaction ID ('${cleanTxnId}') detected!`,
            affectedField: 'txn_id',
            sourceRow: row,
          });
          runExceptions.push(exc);
          this.store.saveException(exc);
        } else {
          seenRunTxnIds.add(cleanTxnId);
        }
      }

      // ── Settlement Verification: Anti-Assumption Guard ──
      const hasAnyDiscrepancy = hasAmountMismatch || hasDuplicateBankRef;

      if (hasAnyDiscrepancy) {
        // Discrepancy exists: Anti-Assumption Guard strictly prevents status = PAID
        this._applyInstructionDiscrepancy(matchedInstruction, row, runExceptions[runExceptions.length - 1].reason);
        processedPairs.push({ instruction: matchedInstruction, row, result: 'EXCEPTION' });
        continue;
      }

      // No discrepancy on this record: evaluate bank status
      const isPositiveStatus = POSITIVE_BANK_STATUSES.has(normalised_status);
      const isNegativeStatus = NEGATIVE_BANK_STATUSES.has(normalised_status);
      const hasValidUtr = Boolean(bank_ref && bank_ref.trim().length > 0);

      if (isPositiveStatus && bank_confirmation_present && hasValidUtr) {
        // Clean Positive Bank Confirmation: Safe to set PAID
        this._applyInstructionPaid(matchedInstruction, row);
        settledCount++;
        totalSettledAmount += instructedAmount;

        // Register UTR & TxnId in persistent ledger
        this.store.registerConfirmedUtr(bank_ref);
        if (txn_id) this.store.registerConfirmedTxnId(txn_id);

        processedPairs.push({ instruction: matchedInstruction, row, result: 'PAID' });
      } else if (isNegativeStatus || failure_reason) {
        // Explicit Bank Rejection: Update record to FAILED
        this._applyInstructionFailed(matchedInstruction, row);
        failedCount++;
        totalFailedAmount += instructedAmount;
        processedPairs.push({ instruction: matchedInstruction, row, result: 'FAILED' });
      } else {
        // Ambiguous Confirmation: Anti-Assumption Guard blocks PAID and logs discrepancy
        const exc = this._createDiscrepancy({
          batchId: batch.batch_id,
          discrepancyType: DiscrepancyType.AMBIGUOUS_CONFIRMATION,
          txnId: txn_id,
          bankRef: bank_ref,
          employeeId: matchedInstruction.employee_id,
          instructionId,
          instructedAmount,
          clearedAmount: cleared_amount,
          differenceAmount: 0,
          reason: `Ambiguous bank confirmation: Status '${raw_status}' without confirmed UTR trace reference. Anti-Assumption Guard prevents setting status to PAID.`,
          affectedField: 'bank_ref',
          sourceRow: row,
        });
        runExceptions.push(exc);
        this.store.saveException(exc);
        this._applyInstructionDiscrepancy(matchedInstruction, row, exc.reason);
        processedPairs.push({ instruction: matchedInstruction, row, result: 'EXCEPTION' });
      }
    }

    // Step 5: Check Open Exceptions & Enforce Parent Batch Lifecycle Lock
    const openExceptions = this.store.listOpenExceptionsByBatch(batch.batch_id);
    const hasOpenExceptions = openExceptions.length > 0;

    if (hasOpenExceptions) {
      // MANDATORY CRITERION 7 RULE:
      // "isolate it in a reconciliation_exceptions queue and leave the parent batch in RECONCILING status until manual finance desk resolution."
      batch.status = BatchReconciliationLifecycle.RECONCILING;
      batch.auto_closure_blocked = true;
      batch.reconciliation_block_reason = `Parent batch retained in RECONCILING status: ${openExceptions.length} open discrepancy exception(s) require manual finance desk resolution.`;
    } else {
      // All instructions processed with zero open exceptions
      const totalInstructed = instructions.length;
      if (settledCount === totalInstructed && failedCount === 0) {
        batch.status = BatchReconciliationLifecycle.PAID;
      } else if (settledCount > 0 && failedCount > 0) {
        batch.status = BatchReconciliationLifecycle.PARTIALLY_SETTLED;
      } else if (failedCount === totalInstructed && settledCount === 0) {
        batch.status = BatchReconciliationLifecycle.FAILED;
      } else {
        // If not all instructions received settlement rows yet, remain in RECONCILING
        batch.status = BatchReconciliationLifecycle.RECONCILING;
      }
      batch.auto_closure_blocked = false;
      batch.reconciliation_block_reason = null;
    }

    batch.reconciliation_summary = {
      total_instructions: instructions.length,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      settled_count: settledCount,
      failed_count: failedCount,
      open_exception_count: openExceptions.length,
      total_settled_amount: Math.round(totalSettledAmount * 100) / 100,
      total_failed_amount: Math.round(totalFailedAmount * 100) / 100,
      reconciled_at: new Date().toISOString(),
      reconciled_by: operatorId,
    };

    // Attach open exceptions to batch document for inspection
    batch.reconciliation_exceptions = openExceptions;

    return {
      batch_id: batch.batch_id,
      status: batch.status,
      total_instructions: instructions.length,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      settled_count: settledCount,
      failed_count: failedCount,
      open_exception_count: openExceptions.length,
      auto_closure_blocked: batch.auto_closure_blocked,
      reconciliation_exceptions: openExceptions,
      reconciled_at: batch.reconciliation_summary.reconciled_at,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. MANUAL FINANCE DESK RESOLUTION WORKFLOW
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Allows the manual finance desk to review and resolve open reconciliation exceptions.
   * Upon resolution of all exceptions, the parent batch is unlocked and re-evaluated.
   *
   * @param {object} params
   * @param {object} params.batch - Parent PaymentBatch document
   * @param {string} params.exceptionId - Target exception ID
   * @param {string} params.action - 'ACCEPT_DIFFERENCE' | 'MARK_FAILED_FOR_RETRY' | 'MANUAL_MATCH' | 'FORCE_SETTLE' | 'WAIVE'
   * @param {string} params.resolvedBy - User ID of finance analyst
   * @param {string} params.notes - Audit resolution rationale
   * @param {string} [params.overrideInstructionId] - Required for MANUAL_MATCH
   * @returns {Promise<object>} Resolution result and updated batch status
   */
  async resolveException({
    batch,
    exceptionId,
    action,
    resolvedBy,
    notes,
    overrideInstructionId = null,
  }) {
    if (!exceptionId || !resolvedBy || !action) {
      throw new Error('[BankResponseReconciliationService] exceptionId, action, and resolvedBy are mandatory for manual resolution.');
    }

    const exception = this.store.getException(exceptionId);
    if (!exception) {
      throw new Error(`[BankResponseReconciliationService] Reconciliation exception '${exceptionId}' not found.`);
    }

    if (exception.status === ExceptionStatus.RESOLVED) {
      throw new Error(`[BankResponseReconciliationService] Exception '${exceptionId}' is already resolved.`);
    }

    const now = new Date().toISOString();
    const instructions = batch?.records || batch?.instructions || [];

    // Apply manual action to corresponding instruction if applicable
    let targetInstruction = null;
    const targetId = exception.instruction_id || overrideInstructionId;
    if (targetId && instructions.length > 0) {
      targetInstruction = instructions.find(
        (i) => (i.record_id || i.id || i.employee_id) === targetId
      );
    }

    switch (action) {
      case 'ACCEPT_DIFFERENCE':
      case 'FORCE_SETTLE':
        if (targetInstruction) {
          targetInstruction.status = 'PAID';
          targetInstruction.bank_utr = exception.bank_ref || targetInstruction.bank_utr || `MANUAL_UTR_${Date.now()}`;
          targetInstruction.settled_at = now;
          targetInstruction.manual_resolution_action = action;
          targetInstruction.manual_resolution_by = resolvedBy;
          targetInstruction.manual_resolution_notes = notes;
        }
        break;

      case 'MARK_FAILED_FOR_RETRY':
        if (targetInstruction) {
          targetInstruction.status = 'FAILED';
          targetInstruction.settlement_error = notes || 'Marked failed by finance desk for reprocessing';
          targetInstruction.manual_resolution_action = action;
          targetInstruction.manual_resolution_by = resolvedBy;
        }
        break;

      case 'MANUAL_MATCH':
        if (!overrideInstructionId) {
          throw new Error('MANUAL_MATCH requires overrideInstructionId.');
        }
        if (targetInstruction) {
          targetInstruction.status = 'PAID';
          targetInstruction.bank_utr = exception.bank_ref || `MANUAL_UTR_${Date.now()}`;
          targetInstruction.settled_at = now;
          targetInstruction.manual_matched_from = exception.txn_id;
        }
        break;

      case 'WAIVE':
        // Waive exception without changing instruction state
        break;

      default:
        throw new Error(`[BankResponseReconciliationService] Unsupported resolution action: '${action}'.`);
    }

    // Update exception status in store
    const updatedException = this.store.updateException(exceptionId, {
      status: action === 'WAIVE' ? ExceptionStatus.WAIVED : ExceptionStatus.RESOLVED,
      resolved_by: resolvedBy,
      resolved_at: now,
      resolution_action: action,
      resolution_notes: notes,
    });

    // Re-evaluate parent batch status
    let remainingOpenExceptions = 0;
    if (batch) {
      const openExceptions = this.store.listOpenExceptionsByBatch(batch.batch_id);
      remainingOpenExceptions = openExceptions.length;

      if (remainingOpenExceptions === 0) {
        // All exceptions resolved! Evaluate final batch status
        const total = instructions.length;
        const paidCount = instructions.filter((i) => i.status === 'PAID').length;
        const failedCount = instructions.filter((i) => i.status === 'FAILED').length;

        if (paidCount === total && total > 0) {
          batch.status = BatchReconciliationLifecycle.PAID;
        } else if (paidCount > 0 && failedCount > 0) {
          batch.status = BatchReconciliationLifecycle.PARTIALLY_SETTLED;
        } else if (failedCount === total && total > 0) {
          batch.status = BatchReconciliationLifecycle.FAILED;
        } else {
          batch.status = BatchReconciliationLifecycle.PAID;
        }
        batch.auto_closure_blocked = false;
        batch.reconciliation_block_reason = null;
      } else {
        // Still has open exceptions: MUST remain in RECONCILING
        batch.status = BatchReconciliationLifecycle.RECONCILING;
        batch.auto_closure_blocked = true;
      }

      batch.reconciliation_exceptions = this.store.listExceptionsByBatch(batch.batch_id);
    }

    return {
      exception_id: exceptionId,
      status: updatedException.status,
      action,
      resolved_by: resolvedBy,
      resolved_at: now,
      notes,
      batch_id: batch?.batch_id || exception.batch_id,
      batch_status: batch?.status || 'RECONCILING',
      remaining_open_exceptions: remainingOpenExceptions,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. MULTI-FORMAT FEED PARSING (CSV, XML, TXT, JSON)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parse multi-format bank settlement feed into normalized BankResponseRow objects.
   * @param {string|Array} feed
   * @param {string} format - 'CSV' | 'XML' | 'TXT' | 'JSON'
   * @returns {Array<object>}
   */
  parseBankFeed(feed, format = 'CSV') {
    if (Array.isArray(feed)) {
      return feed.map((r) => this._normalizeRow(r));
    }

    const fmt = String(format || 'CSV').toUpperCase();
    const content = String(feed || '').trim();

    if (fmt === 'JSON') {
      try {
        const parsed = JSON.parse(content);
        const list = Array.isArray(parsed) ? parsed : (parsed.records || parsed.transactions || parsed.rows || []);
        return list.map((r) => this._normalizeRow(r));
      } catch (err) {
        throw new Error(`Failed to parse JSON bank response feed: ${err.message}`);
      }
    }

    if (fmt === 'XML') {
      return this._parseXmlFeed(content);
    }

    if (fmt === 'TXT') {
      return this._parseDelimitedTxt(content);
    }

    // Default CSV
    return this._parseCsv(content);
  }

  _parseCsv(csvContent) {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = this._splitCsvLine(line);
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = cols[idx] !== undefined ? cols[idx].trim().replace(/^["']|["']$/g, '') : '';
      });

      rows.push(this._normalizeRow(rowObj));
    }

    return rows;
  }

  _splitCsvLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cur);
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur);
    return result;
  }

  _parseDelimitedTxt(txtContent) {
    const lines = txtContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    // Detect delimiter: pipe, tab, or caret
    const firstLine = lines[0];
    let delimiter = '|';
    if (firstLine.includes('\t')) delimiter = '\t';
    else if (firstLine.includes('^')) delimiter = '^';
    else if (firstLine.includes('|')) delimiter = '|';

    const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(delimiter).map((p) => p.trim());
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = parts[idx] !== undefined ? parts[idx] : '';
      });
      rows.push(this._normalizeRow(rowObj));
    }

    return rows;
  }

  _parseXmlFeed(xmlContent) {
    const rows = [];
    // Match either <Txn>...</Txn>, <Record>...</Record>, or <Transaction>...</Transaction>
    const itemRegex = /<(?:Txn|Record|Transaction|StmtEntry)>([\s\S]*?)<\/(?:Txn|Record|Transaction|StmtEntry)>/gi;
    let match;

    while ((match = itemRegex.exec(xmlContent)) !== null) {
      const block = match[1];
      const getTag = (tag) => {
        const tagRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
        const m = tagRegex.exec(block);
        return m ? m[1].trim() : '';
      };

      const rowObj = {
        txn_id: getTag('TxnId') || getTag('PaymentRef') || getTag('Ref') || getTag('InstructionId'),
        bank_ref: getTag('UTR') || getTag('BankRef') || getTag('RefNum') || getTag('UtrNumber'),
        employee_id: getTag('EmpId') || getTag('EmployeeId') || getTag('BeneficiaryId'),
        amount: getTag('Amt') || getTag('Amount') || getTag('ClearedAmount'),
        status: getTag('Status') || getTag('ClearingStatus'),
        failure_reason: getTag('Reason') || getTag('FailureReason') || getTag('ErrorCode'),
        settlement_timestamp: getTag('SettlementDate') || getTag('ValueDate') || getTag('Timestamp'),
      };

      rows.push(this._normalizeRow(rowObj));
    }

    return rows;
  }

  _normalizeRow(raw) {
    const txn_id = String(
      raw.txn_id ||
      raw.transaction_id ||
      raw.payment_reference ||
      raw.instruction_id ||
      raw.ref ||
      raw.record_id ||
      ''
    ).trim();

    const bank_ref = String(
      raw.bank_ref ||
      raw.utr ||
      raw.utr_number ||
      raw.bank_reference ||
      raw.rrn ||
      ''
    ).trim();

    const employee_id = String(
      raw.employee_id ||
      raw.emp_id ||
      raw.beneficiary_id ||
      raw.id ||
      ''
    ).trim();

    const cleared_amount = Number(
      raw.cleared_amount ??
      raw.amount ??
      raw.settled_amount ??
      raw.paid_amount ??
      0
    );

    const raw_status = String(raw.status || raw.raw_status || raw.clearing_status || '').toUpperCase().trim();
    const failure_reason = raw.failure_reason || raw.error_code || raw.reason || null;
    const settlement_timestamp = raw.settlement_timestamp || raw.settled_at || raw.value_date || new Date().toISOString();

    let normalised_status = 'PENDING';
    if (POSITIVE_BANK_STATUSES.has(raw_status)) {
      normalised_status = 'PAID';
    } else if (NEGATIVE_BANK_STATUSES.has(raw_status) || failure_reason) {
      normalised_status = 'FAILED';
    }

    const bank_confirmation_present = (normalised_status === 'PAID') && (bank_ref.length > 0);

    return {
      txn_id,
      bank_ref,
      employee_id,
      cleared_amount: Number.isFinite(cleared_amount) ? cleared_amount : 0,
      raw_status,
      normalised_status,
      failure_reason,
      settlement_timestamp,
      bank_confirmation_present,
      raw_row: raw,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  _extractInstructionKeys(instruction) {
    const keys = new Set();
    const addIfValid = (val) => {
      if (val && String(val).trim().length > 0) {
        keys.add(String(val).trim());
      }
    };

    addIfValid(instruction.payment_reference);
    addIfValid(instruction.instruction_id);
    addIfValid(instruction.record_id);
    addIfValid(instruction.txn_id);
    addIfValid(instruction.ref);

    return Array.from(keys);
  }

  _findInstruction(row, lookup) {
    if (row.txn_id && lookup.has(row.txn_id)) {
      return lookup.get(row.txn_id);
    }
    return null;
  }

  _createDiscrepancy({
    batchId,
    discrepancyType,
    txnId,
    bankRef,
    employeeId,
    instructionId,
    instructedAmount,
    clearedAmount,
    differenceAmount,
    reason,
    affectedField,
    sourceRow,
  }) {
    return {
      exception_id: `EXC_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      batch_id: batchId,
      discrepancy_type: discrepancyType,
      txn_id: txnId || null,
      bank_ref: bankRef || null,
      employee_id: employeeId || null,
      instruction_id: instructionId || null,
      instructed_amount: instructedAmount !== null ? Number(instructedAmount) : null,
      cleared_amount: clearedAmount !== null ? Number(clearedAmount) : null,
      difference_amount: Math.round(Number(differenceAmount || 0) * 100) / 100,
      reason,
      affected_field: affectedField || null,
      status: ExceptionStatus.OPEN,
      source_row: sourceRow ? { ...sourceRow } : null,
      created_at: new Date().toISOString(),
    };
  }

  _applyInstructionPaid(instruction, row) {
    instruction.status = 'PAID';
    instruction.bank_utr = row.bank_ref;
    instruction.settled_at = row.settlement_timestamp;
    instruction.settlement_error = null;
    if (instruction._raw) {
      instruction._raw.status = 'PAID';
      instruction._raw.bank_utr = row.bank_ref;
      instruction._raw.settled_at = row.settlement_timestamp;
      instruction._raw.settlement_error = null;
    }
  }

  _applyInstructionFailed(instruction, row) {
    instruction.status = 'FAILED';
    instruction.bank_utr = row.bank_ref || null;
    instruction.settled_at = row.settlement_timestamp;
    instruction.settlement_error = row.failure_reason || 'Rejected by clearing bank';
    if (instruction._raw) {
      instruction._raw.status = 'FAILED';
      instruction._raw.bank_utr = row.bank_ref || null;
      instruction._raw.settled_at = row.settlement_timestamp;
      instruction._raw.settlement_error = row.failure_reason || 'Rejected by clearing bank';
    }
  }

  _applyInstructionDiscrepancy(instruction, row, reason) {
    // Under no circumstances set status to PAID
    instruction.status = 'EXCEPTION';
    instruction.settlement_error = reason;
    if (row.bank_ref) instruction.bank_utr = row.bank_ref;
    if (instruction._raw) {
      instruction._raw.status = 'EXCEPTION';
      instruction._raw.settlement_error = reason;
      if (row.bank_ref) instruction._raw.bank_utr = row.bank_ref;
    }
  }
}
