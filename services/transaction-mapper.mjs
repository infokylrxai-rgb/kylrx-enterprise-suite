/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS — TRANSACTION MAPPER
 * ============================================================================
 * Module: 1:1 Payment Instruction ↔ Bank Clearing Row Resolution Engine
 *
 * Architectural Guarantees:
 *  1. STRICT 1:1 RESOLUTION RULE
 *     Every bank clearing row must resolve to EXACTLY ONE internal payment
 *     instruction. Many-to-one (fan-in) and one-to-many (fan-out) mappings
 *     are illegal and produce exception entries.
 *
 *  2. ANTI-ASSUMPTION GUARD — STATUS NEVER WRITTEN HERE
 *     The mapper establishes the link between bank row and instruction only.
 *     It NEVER writes status = 'PAID'. Status transitions are the exclusive
 *     responsibility of ReconciliationEngine.applyPaidStatus(), which may
 *     only execute after all six guards pass.
 *
 *  3. COLLISION DETECTION
 *     If two bank rows resolve to the same instruction (fan-in), the second
 *     match is flagged as DUPLICATE_INSTRUCTION_CLAIM before the guards run.
 *
 * @version 1.0.0
 * @author  Kylrx AI Lead Backend Architecture Team
 */

import crypto from 'node:crypto';

// ─── Exception type constants (mirrors reconciliation-schema.ts enum) ─────────
export const MapperExceptionCode = Object.freeze({
  ORPHANED_ROW: 'ORPHANED_ROW',
  DUPLICATE_INSTRUCTION_CLAIM: 'DUPLICATE_INSTRUCTION_CLAIM',
});

// ─── Match strategies ─────────────────────────────────────────────────────────
export const MatchStrategy = Object.freeze({
  PAYMENT_REFERENCE: 'PAYMENT_REFERENCE',
  EMPLOYEE_ID: 'EMPLOYEE_ID',
  UNMATCHED: 'UNMATCHED',
});

// ─── Record pre-flight warnings ───────────────────────────────────────────────
export const InstructionIndexWarning = Object.freeze({
  DUPLICATE_PAYMENT_REFERENCE: 'DUPLICATE_PAYMENT_REFERENCE',
  DUPLICATE_EMPLOYEE_ID: 'DUPLICATE_EMPLOYEE_ID',
});

/**
 * Builds the in-memory resolution index from a batch's instruction records,
 * performs fan-out collision pre-flight checks, and exposes mapBankResponseFeed
 * which produces a TransactionMapperResult without ever touching instruction.status.
 */
export class TransactionMapper {
  /**
   * @param {object}   options
   * @param {number}   [options.verbose=false] - Emit debug messages to console
   */
  constructor(options = {}) {
    this.verbose = options.verbose || false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Builds the instruction lookup index from raw batch records and validates
   * for any pre-flight collisions (duplicate payment_reference / employee_id).
   *
   * @param {object[]} records - Raw PaymentDisbursementRecord array from the batch.
   * @returns {{ byRef: Map, byEmpId: Map, warnings: object[] }}
   */
  buildInstructionIndex(records = []) {
    /** @type {Map<string, object>} payment_reference → instruction */
    const byRef = new Map();
    /** @type {Map<string, object>} employee_id → instruction */
    const byEmpId = new Map();
    const warnings = [];

    for (const rec of records) {
      // Normalise to a consistent internal shape
      const instruction = this._normaliseInstruction(rec);

      // Index by payment_reference (primary key)
      const ref = instruction.payment_reference;
      if (ref) {
        if (byRef.has(ref)) {
          warnings.push({
            warning_id: `WRN-DUPREF-${crypto.randomUUID().substring(0, 8).toUpperCase()}`,
            code: InstructionIndexWarning.DUPLICATE_PAYMENT_REFERENCE,
            key: ref,
            message: `Duplicate payment_reference '${ref}' found in batch instructions. ` +
                     `Only the first occurrence will be used for matching.`,
          });
        } else {
          byRef.set(ref, instruction);
        }
      }

      // Index by employee_id (secondary fallback)
      const empId = instruction.employee_id;
      if (empId) {
        if (byEmpId.has(empId)) {
          warnings.push({
            warning_id: `WRN-DUPEMPID-${crypto.randomUUID().substring(0, 8).toUpperCase()}`,
            code: InstructionIndexWarning.DUPLICATE_EMPLOYEE_ID,
            key: empId,
            message: `Duplicate employee_id '${empId}' in batch instructions. ` +
                     `Secondary key index will point to the first occurrence only.`,
          });
        } else {
          byEmpId.set(empId, instruction);
        }
      }
    }

    this._log(`[TransactionMapper] Index built — refs: ${byRef.size}, empIds: ${byEmpId.size}, warnings: ${warnings.length}`);
    return { byRef, byEmpId, warnings };
  }

  /**
   * Maps an array of normalised BankClearingRows to internal instructions.
   *
   * Resolution Priority:
   *   1. txn_id → payment_reference index  (PAYMENT_REFERENCE match)
   *   2. employee_id → employee_id index   (EMPLOYEE_ID fallback)
   *   3. No match found                    (UNMATCHED → ORPHANED_ROW guard)
   *
   * Anti-Assumption Guarantee:
   *   This method does NOT modify instruction.status at any point.
   *
   * @param {string}   batchId
   * @param {object[]} bankRows    - Normalised BankClearingRow objects.
   * @param {Map}      byRef       - From buildInstructionIndex().
   * @param {Map}      byEmpId     - From buildInstructionIndex().
   * @returns {object}             - TransactionMapperResult
   */
  mapBankResponseFeed(batchId, bankRows = [], byRef, byEmpId) {
    const matchedPairs = [];
    const unmatchedRows = [];
    const mapperExceptions = [];

    // Track which instruction IDs have already been claimed in this run
    // to detect fan-in (two bank rows → same instruction) collisions.
    const claimedInstructionIds = new Map(); // instructionId → first bankRow.txn_id

    for (const row of bankRows) {
      const { instruction, matchStrategy, matchKey } =
        this._resolveInstruction(row, byRef, byEmpId);

      if (!instruction) {
        // UNMATCHED — no instruction found for this bank row
        unmatchedRows.push(row);
        mapperExceptions.push(this._buildOrphanedRowException(row, batchId));
        continue;
      }

      // 1:1 Collision check — fan-in guard
      const instId = instruction.record_id || instruction.employee_id;
      if (claimedInstructionIds.has(instId)) {
        mapperExceptions.push(this._buildDuplicateClaimException(
          row, instruction, claimedInstructionIds.get(instId), batchId
        ));
        // Still add to matched pairs with a collision flag so guards can process it
        matchedPairs.push({
          bank_row: row,
          instruction,
          match_strategy: matchStrategy,
          match_key: matchKey,
          has_fan_in_collision: true,
        });
        continue;
      }

      claimedInstructionIds.set(instId, row.txn_id || row.bank_ref || 'UNKNOWN');

      matchedPairs.push({
        bank_row: row,
        instruction,
        match_strategy: matchStrategy,
        match_key: matchKey,
        has_fan_in_collision: false,
      });
    }

    const result = {
      batch_id: batchId,
      total_bank_rows: bankRows.length,
      matched_count: matchedPairs.length,
      unmatched_count: unmatchedRows.length,
      matched_pairs: matchedPairs,
      unmatched_rows: unmatchedRows,
      mapper_exceptions: mapperExceptions,
      mapped_at: new Date().toISOString(),
    };

    this._log(
      `[TransactionMapper] Mapping complete — matched: ${result.matched_count}, ` +
      `unmatched: ${result.unmatched_count}, mapper_exceptions: ${mapperExceptions.length}`
    );

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolves a single bank clearing row to an internal instruction.
   * Priority: payment_reference (txn_id) → employee_id.
   * Returns null if no match.
   */
  _resolveInstruction(row, byRef, byEmpId) {
    const txnId = String(row.txn_id || '').trim();
    const empId = String(row.employee_id || '').trim();

    // Primary: txn_id → payment_reference
    if (txnId && byRef.has(txnId)) {
      return {
        instruction: byRef.get(txnId),
        matchStrategy: MatchStrategy.PAYMENT_REFERENCE,
        matchKey: txnId,
      };
    }

    // Secondary: employee_id
    if (empId && byEmpId.has(empId)) {
      return {
        instruction: byEmpId.get(empId),
        matchStrategy: MatchStrategy.EMPLOYEE_ID,
        matchKey: empId,
      };
    }

    return { instruction: null, matchStrategy: MatchStrategy.UNMATCHED, matchKey: null };
  }

  /**
   * Normalises a raw batch record into the PaymentInstruction shape
   * expected by the mapper and reconciliation engine.
   */
  _normaliseInstruction(rec) {
    return {
      record_id:            rec.record_id    || rec.id    || '',
      batch_id:             rec.batch_id     || '',
      employee_id:          String(rec.employee_id || rec.emp_id || rec.id || '').trim(),
      employee_name:        rec.employee_name || rec.name || '',
      payment_reference:    String(rec.payment_reference || rec.ref || rec.txn_id || '').trim(),
      instructed_amount:    Number(rec.net_payable_amount ?? rec.net ?? rec.amount ?? 0),
      status:               rec.status || 'PENDING',
      ifsc_code:            rec.ifsc_code || rec.ifsc || '',
      account_number_masked: rec.account_number_masked || rec.accountNumberMasked || '',
      bank_name:            rec.bank_name || rec.bankName || '',
      // Carry through original so engine can mutate it
      _raw: rec,
    };
  }

  _buildOrphanedRowException(row, batchId) {
    return {
      exception_id: `EXC-ORPHAN-${crypto.randomUUID().substring(0, 8).toUpperCase()}`,
      code: MapperExceptionCode.ORPHANED_ROW,
      batch_id: batchId,
      txn_id: row.txn_id || null,
      bank_ref: row.bank_ref || null,
      employee_id: row.employee_id || null,
      cleared_amount: row.cleared_amount,
      reason: `Bank clearing row (txn_id: '${row.txn_id || 'N/A'}', ` +
              `employee_id: '${row.employee_id || 'N/A'}', ` +
              `bank_ref: '${row.bank_ref || 'N/A'}') ` +
              `could not be mapped to any registered payment instruction in batch '${batchId}'. ` +
              `Verify employee registration and instruction_id validity.`,
      created_at: new Date().toISOString(),
    };
  }

  _buildDuplicateClaimException(row, instruction, firstClaimKey, batchId) {
    return {
      exception_id: `EXC-FANIN-${crypto.randomUUID().substring(0, 8).toUpperCase()}`,
      code: MapperExceptionCode.DUPLICATE_INSTRUCTION_CLAIM,
      batch_id: batchId,
      txn_id: row.txn_id || null,
      bank_ref: row.bank_ref || null,
      employee_id: instruction.employee_id,
      instruction_id: instruction.record_id,
      cleared_amount: row.cleared_amount,
      first_claim_txn_id: firstClaimKey,
      reason: `Fan-in collision: bank row (txn_id: '${row.txn_id || 'N/A'}') resolves to ` +
              `instruction '${instruction.record_id}' (employee: '${instruction.employee_id}'), ` +
              `but this instruction was already claimed by txn_id: '${firstClaimKey}'. ` +
              `The 1:1 resolution rule is violated. Investigate duplicate bank submission.`,
      created_at: new Date().toISOString(),
    };
  }

  _log(msg) {
    if (this.verbose) console.log(msg);
  }
}
