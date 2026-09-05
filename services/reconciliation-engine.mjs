/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS — RECONCILIATION ENGINE
 * ============================================================================
 * Module: Bank Transaction Mapper + 6-Guard Reconciliation Interceptor
 *
 * Guard Catalogue (in execution order):
 * ─────────────────────────────────────────────────────────────────────────────
 * GUARD-0  Anti-Assumption Guard (pre-flight)
 *          Confirms status=PAID is not written from mapper output or file
 *          ingestion alone. PAID is written ONLY inside applyPaidStatus().
 *
 * GUARD-1  Amount Mismatch
 *          |cleared_amount - instructed_amount| > tolerance  →  EXCEPTION
 *          difference_amount = cleared_amount − instructed_amount
 *
 * GUARD-2  Missing / Invalid Identifier
 *          blank txn_id  OR  blank bank_ref (UTR)           →  EXCEPTION
 *          difference_amount = 0
 *
 * GUARD-3  Orphaned Row (from mapper)
 *          no matching instruction found                     →  EXCEPTION
 *          difference_amount = cleared_amount (fully unattributable)
 *
 * GUARD-4  Duplicate External Reference
 *          same txn_id or UTR already in run or ledger       →  EXCEPTION
 *          difference_amount = cleared_amount (risk of double-credit)
 *
 * GUARD-5  Partial Settlement
 *          0 < cleared_amount < instructed_amount − tolerance →  EXCEPTION
 *          difference_amount = instructed_amount − cleared_amount (gap)
 *
 * Batch Auto-Closure Prevention:
 *  If any OPEN exception exists after all guards run, the batch status is set
 *  to 'RECONCILIATION_EXCEPTION' and auto_closure_blocked = true.
 *  The batch may NOT advance to SETTLED / PAID until ALL exceptions are cleared.
 *
 * @version 1.0.0
 * @author  Kylrx AI Lead Backend Architecture Team
 */

import crypto from 'node:crypto';
import { TransactionMapper, MatchStrategy } from './transaction-mapper.mjs';
import {
  buildExceptionQueueEntry,
  InMemoryReconciliationStore,
  ExceptionQueueStatus,
} from './reconciliation-exception-store.mjs';

// ─── Exception type codes ────────────────────────────────────────────────────
export const ReconciliationExceptionType = Object.freeze({
  AMOUNT_MISMATCH:        'AMOUNT_MISMATCH',
  MISSING_IDENTIFIER:     'MISSING_IDENTIFIER',
  ORPHANED_ROW:           'ORPHANED_ROW',
  DUPLICATE_EXTERNAL_REF: 'DUPLICATE_EXTERNAL_REF',
  PARTIAL_SETTLEMENT:     'PARTIAL_SETTLEMENT',
});

// ─── Batch states introduced by this engine ──────────────────────────────────
export const BatchReconciliationState = Object.freeze({
  RECONCILING:             'RECONCILING',
  RECONCILIATION_EXCEPTION: 'RECONCILIATION_EXCEPTION',  // Blocked — open exceptions exist
  SETTLED:                 'SETTLED',                    // 100% clean
  PARTIALLY_SETTLED:       'PARTIALLY_SETTLED',          // Mix of PAID + FAILED (no exceptions)
  FAILED:                  'FAILED',                     // All lines failed (no exceptions)
});

// ─── Valid bank statuses that may trigger the PAID gate ──────────────────────
const BANK_SUCCESS_STATUSES = new Set(['PAID', 'SUCCESS', 'CREDITED', 'SETTLED']);

/* ============================================================================
 * RECONCILIATION ENGINE
 * ============================================================================ */

export class ReconciliationEngine {
  /**
   * @param {object} options
   * @param {number} [options.tolerance=0.01]      - Amount comparison tolerance (₹)
   * @param {object} [options.store]                - Storage repository (InMemoryReconciliationStore or Firestore adapter)
   * @param {object} [options.mapper]               - TransactionMapper instance (injectable for testing)
   * @param {boolean} [options.verbose=false]       - Emit debug log lines
   */
  constructor(options = {}) {
    this.tolerance = typeof options.tolerance === 'number' ? options.tolerance : 0.01;
    this.store     = options.store  || new InMemoryReconciliationStore();
    this.mapper    = options.mapper || new TransactionMapper({ verbose: options.verbose });
    this.verbose   = options.verbose || false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC: PRIMARY INGESTION ENTRYPOINT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ingest a bank response file and run the full 6-guard reconciliation pipeline.
   *
   * @param {object} params
   * @param {object}   params.batch          - PaymentBatch object (mutated in place)
   * @param {string}   params.fileContent    - Raw file content string
   * @param {string}   [params.fileFormat]   - 'CSV' | 'JSON' | 'XML' | 'TXT' (default CSV)
   * @param {string}   [params.fileName]     - Original file name (for manifest)
   * @param {string}   [params.operatorId]   - User/system ID triggering this run
   * @param {string}   [params.organizationId]
   * @returns {Promise<object>}              - ReconciliationRunManifest + detail arrays
   */
  async ingestBankFile({
    batch,
    fileContent,
    fileFormat = 'CSV',
    fileName = 'bank_response',
    operatorId = 'RECONCILIATION_ENGINE',
    organizationId = batch?.organization_id || 'UNKNOWN_ORG',
  }) {
    if (!batch?.batch_id) {
      throw new Error('[ReconciliationEngine] A valid PaymentBatch with batch_id is required.');
    }
    if (!fileContent || String(fileContent).trim().length === 0) {
      throw new Error('[ReconciliationEngine] Bank response file content is empty.');
    }

    // ── Step 0: Mark batch as RECONCILING (no PAID writes during ingestion) ─
    batch.status = BatchReconciliationState.RECONCILING;
    batch.reconciliation_started_at = new Date().toISOString();

    const reconciliationRunId = `RUN-${Date.now()}-${crypto.randomUUID().substring(0, 6).toUpperCase()}`;
    this._log(`[ReconciliationEngine] Starting run ${reconciliationRunId} for batch ${batch.batch_id}`);

    // ── Step 1: Parse the bank response file ─────────────────────────────────
    const bankRows = this._parseFeed(fileContent, fileFormat);
    if (bankRows.length === 0) {
      throw new Error(`[ReconciliationEngine] No parseable rows found in '${fileName}'.`);
    }
    this._log(`[ReconciliationEngine] Parsed ${bankRows.length} bank clearing rows.`);

    // ── Step 2: Build instruction index via TransactionMapper ─────────────────
    const instructions = batch.records || [];
    const { byRef, byEmpId, warnings: indexWarnings } = this.mapper.buildInstructionIndex(instructions);

    // ── Step 3: 1:1 resolution mapping ───────────────────────────────────────
    const mappingResult = this.mapper.mapBankResponseFeed(
      batch.batch_id, bankRows, byRef, byEmpId
    );

    // ── Step 4: Load historic ledgers for cross-batch duplicate detection ────
    const historicUtrs   = await this.store.getHistoricUtrLedger(organizationId);
    const historicTxnIds = await this.store.getHistoricTxnIdLedger(organizationId);

    // ── Step 5: Run all 6 guards on matched pairs ─────────────────────────────
    const runState = {
      seenUtrs:   new Set(),   // UTRs seen in this ingestion run
      seenTxnIds: new Set(),   // TxnIds seen in this ingestion run
      historicUtrs,
      historicTxnIds,
    };

    const allExceptionEntries = [];
    const allReviewItems      = [];
    const cleanMatches        = [];  // pairs that cleared all guards
    const settledInstructions = [];  // instructions that received PAID status
    const failedInstructions  = [];  // instructions that are FAILED (bank reject)

    // ── Guard-3 (Orphaned Row) entries from mapper ────────────────────────────
    for (const orphanRow of mappingResult.unmatched_rows) {
      const { entry, reviewItem } = buildExceptionQueueEntry({
        reconciliationRunId,
        batchId: batch.batch_id,
        exceptionType: ReconciliationExceptionType.ORPHANED_ROW,
        bankRow: orphanRow,
        instruction: null,
        differenceAmount: orphanRow.cleared_amount || 0,
        reason:
          `Bank clearing row (txn_id: '${orphanRow.txn_id || 'N/A'}', ` +
          `employee_id: '${orphanRow.employee_id || 'N/A'}', ` +
          `bank_ref: '${orphanRow.bank_ref || 'N/A'}') does not match any registered ` +
          `payment instruction in batch '${batch.batch_id}'. ` +
          `Verify employee master records and instruction IDs.`,
        affectedField: null,
      });
      allExceptionEntries.push(entry);
      allReviewItems.push(reviewItem);
    }

    // ── Guards 0–2, 4, 5 on matched pairs ────────────────────────────────────
    for (const pair of mappingResult.matched_pairs) {
      const { bank_row: row, instruction, has_fan_in_collision } = pair;

      const pairExceptions = [];

      // ── GUARD-2: Missing / Invalid Identifier ────────────────────────────
      const missingGuardExc = this._guardMissingIdentifier(
        row, instruction, reconciliationRunId, batch.batch_id
      );
      if (missingGuardExc) pairExceptions.push(...missingGuardExc);

      // ── GUARD-4: Duplicate External Reference ───────────────────────────
      const dupExc = this._guardDuplicateExternalRef(
        row, instruction, reconciliationRunId, batch.batch_id, runState
      );
      if (dupExc) pairExceptions.push(...dupExc);

      // ── GUARD-1: Amount Mismatch ─────────────────────────────────────────
      const instructedAmt = Number(instruction.instructed_amount ?? 0);
      const clearedAmt    = Number(row.cleared_amount ?? 0);
      const delta         = clearedAmt - instructedAmt;

      const amountExc = this._guardAmountMismatch(
        row, instruction, reconciliationRunId, batch.batch_id,
        instructedAmt, clearedAmt, delta
      );
      if (amountExc) pairExceptions.push(amountExc);

      // ── GUARD-5: Partial Settlement ──────────────────────────────────────
      // Only check when no full amount mismatch was raised (to avoid double-counting)
      if (!amountExc) {
        const partialExc = this._guardPartialSettlement(
          row, instruction, reconciliationRunId, batch.batch_id,
          instructedAmt, clearedAmt
        );
        if (partialExc) pairExceptions.push(partialExc);
      }

      // ── Fan-in collision (from mapper) ───────────────────────────────────
      if (has_fan_in_collision) {
        const { entry, reviewItem } = buildExceptionQueueEntry({
          reconciliationRunId,
          batchId: batch.batch_id,
          exceptionType: ReconciliationExceptionType.DUPLICATE_EXTERNAL_REF,
          bankRow: row,
          instruction,
          differenceAmount: clearedAmt,
          reason:
            `Fan-in collision: bank row (txn_id: '${row.txn_id}') maps to instruction ` +
            `'${instruction.record_id}' (${instruction.employee_id}), but this instruction ` +
            `was already claimed by another bank row in this run. ` +
            `The 1:1 resolution rule is violated.`,
          affectedField: 'instruction_id',
        });
        pairExceptions.push({ entry, reviewItem });
      }

      // ── Outcome determination ────────────────────────────────────────────
      if (pairExceptions.length > 0) {
        // This pair has at least one exception — persist all and mark instruction EXCEPTION
        for (const exc of pairExceptions) {
          allExceptionEntries.push(exc.entry);
          allReviewItems.push(exc.reviewItem);
        }
        // Mark the raw instruction record as EXCEPTION (NOT PAID)
        this._markInstructionException(instruction, row, pairExceptions[0].entry.reason);

      } else {
        // All guards passed — check if bank explicitly confirmed success
        // ── GUARD-0: Anti-Assumption Guard (PAID state gate) ───────────────
        if (row.bank_confirmation_present && BANK_SUCCESS_STATUSES.has(row.normalised_status)) {
          // ONLY safe path to PAID status
          this._applyPaidStatus(instruction, row);
          settledInstructions.push(instruction);
          cleanMatches.push(pair);
        } else if (row.normalised_status === 'FAILED' || !row.bank_confirmation_present) {
          // Bank returned this as a failure
          this._markInstructionFailed(instruction, row);
          failedInstructions.push(instruction);
          cleanMatches.push(pair);
        } else {
          // Status unknown — leave as PENDING, do not touch
          cleanMatches.push(pair);
        }
      }

      // ── Register new UTR/TxnId in ledgers (only for non-duplicate) ───────
      if (!dupExc || dupExc.length === 0) {
        if (row.bank_ref  && row.bank_ref.trim())  runState.seenUtrs.add(row.bank_ref.trim());
        if (row.txn_id    && row.txn_id.trim())    runState.seenTxnIds.add(row.txn_id.trim());
      }
    }

    // ── Step 6: Batch auto-closure determination ──────────────────────────────
    const openExceptionCount = allExceptionEntries.filter(
      (e) => e.status === ExceptionQueueStatus.OPEN
    ).length;

    const batchOutcome = this._determineBatchClosure(
      batch, instructions, settledInstructions, failedInstructions, openExceptionCount
    );

    // ── Step 7: Persist all artefacts ────────────────────────────────────────
    if (allExceptionEntries.length > 0) {
      await this.store.saveExceptionQueueEntries(allExceptionEntries);
    }
    if (allReviewItems.length > 0) {
      await this.store.saveFinanceOpsReviewItems(allReviewItems);
    }

    // Append newly seen UTRs and TxnIds to the persistent ledger
    if (runState.seenUtrs.size > 0) {
      await this.store.appendToUtrLedger(organizationId, Array.from(runState.seenUtrs));
    }
    if (runState.seenTxnIds.size > 0) {
      await this.store.appendToTxnIdLedger(organizationId, Array.from(runState.seenTxnIds));
    }

    // Persist updated instructions
    const allTouchedInstructions = [...settledInstructions, ...failedInstructions];
    if (allTouchedInstructions.length > 0) {
      await this.store.savePaymentInstructions(allTouchedInstructions.map((i) => i._raw || i));
    }

    // Persist batch state
    await this.store.savePaymentBatch(batch);

    // ── Step 8: Build run manifest ────────────────────────────────────────────
    const exceptionSummary = this._buildExceptionSummary(allExceptionEntries);
    const totalInstructedAmt = instructions.reduce(
      (s, r) => s + Number(r.net_payable_amount ?? r.amount ?? 0), 0
    );
    const totalClearedAmt = bankRows.reduce((s, r) => s + Number(r.cleared_amount ?? 0), 0);
    const totalSettledAmt = settledInstructions.reduce(
      (s, i) => s + Number(i.instructed_amount ?? 0), 0
    );
    const totalExcAmt = allExceptionEntries.reduce(
      (s, e) => s + Math.abs(e.difference_amount || 0), 0
    );
    const totalPartialGap = allExceptionEntries
      .filter((e) => e.exception_type === ReconciliationExceptionType.PARTIAL_SETTLEMENT)
      .reduce((s, e) => s + Math.abs(e.difference_amount || 0), 0);

    const manifest = {
      reconciliation_run_id:     reconciliationRunId,
      batch_id:                  batch.batch_id,
      organization_id:           organizationId,
      uploaded_file_name:        fileName,
      file_format:               fileFormat,

      total_bank_rows_parsed:    bankRows.length,
      matched_count:             mappingResult.matched_count,
      unmatched_count:           mappingResult.unmatched_count,
      clean_matches_count:       cleanMatches.length,
      exception_count:           allExceptionEntries.length,

      total_instructed_amount:       Math.round(totalInstructedAmt * 100) / 100,
      total_cleared_amount:          Math.round(totalClearedAmt   * 100) / 100,
      total_settled_amount:          Math.round(totalSettledAmt   * 100) / 100,
      total_exception_amount:        Math.round(totalExcAmt       * 100) / 100,
      total_partial_settlement_gap:  Math.round(totalPartialGap   * 100) / 100,

      exception_summary: exceptionSummary,

      batch_auto_closure_blocked: batchOutcome.auto_closure_blocked,
      closure_block_reasons:      batchOutcome.closure_block_reasons,
      resulting_batch_status:     batch.status,

      exception_queue_entry_ids:  allExceptionEntries.map((e) => e.exception_id),
      finance_ops_review_item_ids: allReviewItems.map((r) => r.review_item_id),

      index_warnings:   indexWarnings,
      mapper_exceptions: mappingResult.mapper_exceptions,

      reconciled_by:  operatorId,
      reconciled_at:  new Date().toISOString(),
    };

    await this.store.saveReconciliationRun(manifest);

    this._log(
      `[ReconciliationEngine] Run ${reconciliationRunId} complete. ` +
      `Status: ${batch.status}. Exceptions: ${allExceptionEntries.length}. ` +
      `Auto-closure blocked: ${batchOutcome.auto_closure_blocked}.`
    );

    return {
      reconciliation_run_id:  reconciliationRunId,
      manifest,
      batch,
      settled_instructions:   settledInstructions,
      failed_instructions:    failedInstructions,
      exception_queue_entries: allExceptionEntries,
      finance_ops_review_items: allReviewItems,
      unmatched_rows:          mappingResult.unmatched_rows,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GUARD IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GUARD-1: Amount Mismatch
   * Full mismatch: |delta| > tolerance AND cleared_amount !== 0
   * (Partial settlement is GUARD-5 below)
   */
  _guardAmountMismatch(row, instruction, runId, batchId, instructedAmt, clearedAmt, delta) {
    const absDelta = Math.abs(delta);

    // Only raise a full mismatch if amount is non-zero and not a partial (under-payment)
    // Partial settlement is handled separately in GUARD-5
    if (clearedAmt === 0) return null;  // zero-amount → likely a bank reject, handled as FAILED
    if (absDelta <= this.tolerance) return null;

    // Is it a partial (under-payment)? GUARD-5 will handle this.
    if (delta < 0 && clearedAmt > 0) return null;

    // OVER-payment or exact non-zero mismatch that isn't partial
    const { entry, reviewItem } = buildExceptionQueueEntry({
      reconciliationRunId: runId,
      batchId,
      exceptionType: ReconciliationExceptionType.AMOUNT_MISMATCH,
      bankRow: row,
      instruction,
      differenceAmount: Math.round(delta * 100) / 100,
      reason:
        `Amount mismatch for employee ${instruction.employee_id} ` +
        `(${instruction.employee_name || 'N/A'}). ` +
        `Instructed: ₹${instructedAmt.toFixed(2)}, Cleared: ₹${clearedAmt.toFixed(2)}, ` +
        `Δ = ₹${delta.toFixed(2)}. ` +
        `The cleared paid_amount does not equal the instructed_amount (Δ ≠ 0).`,
      affectedField: 'cleared_amount',
    });
    return { entry, reviewItem };
  }

  /**
   * GUARD-2: Missing / Invalid Identifier
   * Returns an array of exceptions (one per missing field, up to 2).
   */
  _guardMissingIdentifier(row, instruction, runId, batchId) {
    const exceptions = [];

    const txnIdBlank  = !row.txn_id  || String(row.txn_id).trim()  === '';
    const bankRefBlank = !row.bank_ref || String(row.bank_ref).trim() === '';

    if (txnIdBlank) {
      const { entry, reviewItem } = buildExceptionQueueEntry({
        reconciliationRunId: runId,
        batchId,
        exceptionType: ReconciliationExceptionType.MISSING_IDENTIFIER,
        bankRow: row,
        instruction,
        differenceAmount: 0,
        reason:
          `Missing txn_id for employee ${instruction?.employee_id || 'N/A'}. ` +
          `Bank clearing row does not carry a transaction identifier. ` +
          `Cannot establish deterministic 1:1 linkage without txn_id.`,
        affectedField: 'txn_id',
      });
      exceptions.push({ entry, reviewItem });
    }

    if (bankRefBlank) {
      const { entry, reviewItem } = buildExceptionQueueEntry({
        reconciliationRunId: runId,
        batchId,
        exceptionType: ReconciliationExceptionType.MISSING_IDENTIFIER,
        bankRow: row,
        instruction,
        differenceAmount: 0,
        reason:
          `Missing or blank bank_ref (UTR) for employee ${instruction?.employee_id || 'N/A'}. ` +
          `A valid UTR is required as proof of clearing network settlement. ` +
          `Status cannot be advanced to PAID without a UTR.`,
        affectedField: 'bank_ref',
      });
      exceptions.push({ entry, reviewItem });
    }

    return exceptions.length > 0 ? exceptions : null;
  }

  /**
   * GUARD-4: Duplicate External Reference
   * Checks both within-run and against the historic ledger.
   * Returns an array of exceptions (one per duplicate field, up to 2).
   */
  _guardDuplicateExternalRef(row, instruction, runId, batchId, runState) {
    const exceptions = [];

    const utr   = String(row.bank_ref  || '').trim();
    const txnId = String(row.txn_id    || '').trim();

    // UTR duplicate check
    if (utr && (runState.seenUtrs.has(utr) || runState.historicUtrs.has(utr))) {
      const { entry, reviewItem } = buildExceptionQueueEntry({
        reconciliationRunId: runId,
        batchId,
        exceptionType: ReconciliationExceptionType.DUPLICATE_EXTERNAL_REF,
        bankRow: row,
        instruction,
        differenceAmount: Number(row.cleared_amount ?? 0),
        reason:
          `Duplicate bank_ref (UTR) '${utr}' detected for employee ` +
          `${instruction?.employee_id || 'N/A'}. ` +
          `This UTR has already been registered in this run or in the historic UTR ledger. ` +
          `Risk of double-credit. Immediate investigation required.`,
        affectedField: 'bank_ref',
      });
      exceptions.push({ entry, reviewItem });
    }

    // TxnId duplicate check
    if (txnId && (runState.seenTxnIds.has(txnId) || runState.historicTxnIds.has(txnId))) {
      const { entry, reviewItem } = buildExceptionQueueEntry({
        reconciliationRunId: runId,
        batchId,
        exceptionType: ReconciliationExceptionType.DUPLICATE_EXTERNAL_REF,
        bankRow: row,
        instruction,
        differenceAmount: Number(row.cleared_amount ?? 0),
        reason:
          `Duplicate txn_id '${txnId}' detected for employee ` +
          `${instruction?.employee_id || 'N/A'}. ` +
          `This Transaction ID has already been seen in this run or prior settlements. ` +
          `Possible duplicate bank file submission.`,
        affectedField: 'txn_id',
      });
      exceptions.push({ entry, reviewItem });
    }

    return exceptions.length > 0 ? exceptions : null;
  }

  /**
   * GUARD-5: Partial Settlement
   * Triggered when: cleared_amount > 0 AND cleared_amount < instructed_amount − tolerance
   * difference_amount = instructed_amount − cleared_amount (the unsettled gap)
   */
  _guardPartialSettlement(row, instruction, runId, batchId, instructedAmt, clearedAmt) {
    if (clearedAmt <= 0) return null;
    const gap = instructedAmt - clearedAmt;
    if (gap <= this.tolerance) return null;  // within tolerance — not partial

    const { entry, reviewItem } = buildExceptionQueueEntry({
      reconciliationRunId: runId,
      batchId,
      exceptionType: ReconciliationExceptionType.PARTIAL_SETTLEMENT,
      bankRow: row,
      instruction,
      differenceAmount: Math.round(-gap * 100) / 100,  // negative = under-paid
      reason:
        `Partial settlement detected for employee ${instruction.employee_id} ` +
        `(${instruction.employee_name || 'N/A'}). ` +
        `Instructed: ₹${instructedAmt.toFixed(2)}, ` +
        `Cleared: ₹${clearedAmt.toFixed(2)}, ` +
        `Unsettled balance: ₹${gap.toFixed(2)}. ` +
        `A supplementary payment instruction must be raised for the outstanding amount.`,
      affectedField: 'cleared_amount',
    });
    return { entry, reviewItem };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAID STATUS GATE — ANTI-ASSUMPTION GUARD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The ONLY function in the system authorised to write status = 'PAID'
   * on a payment instruction.
   *
   * PRECONDITIONS (all must be true):
   *  1. row.bank_confirmation_present === true
   *  2. row.normalised_status is in BANK_SUCCESS_STATUSES
   *  3. row.bank_ref is non-blank (UTR present)
   *  4. All six guards passed (caller responsibility — this is called only from clean paths)
   */
  _applyPaidStatus(instruction, row) {
    // Guard-0 assertion: never called without explicit confirmation
    if (!row.bank_confirmation_present) {
      throw new Error(
        `[ReconciliationEngine] ANTI-ASSUMPTION GUARD VIOLATION: attempted to set ` +
        `PAID status on instruction '${instruction.record_id || instruction.employee_id}' ` +
        `without bank_confirmation_present=true. This is a programming error.`
      );
    }
    if (!row.bank_ref || !row.bank_ref.trim()) {
      throw new Error(
        `[ReconciliationEngine] ANTI-ASSUMPTION GUARD VIOLATION: attempted to set ` +
        `PAID status without a valid UTR (bank_ref). Instruction: ` +
        `'${instruction.record_id || instruction.employee_id}'.`
      );
    }

    // Safe to write PAID
    if (instruction._raw) {
      instruction._raw.status     = 'PAID';
      instruction._raw.bank_utr   = row.bank_ref.trim();
      instruction._raw.settled_at = row.settlement_timestamp || new Date().toISOString();
      instruction._raw.failure_reason = null;
    }
    instruction.status     = 'PAID';
    instruction.bank_utr   = row.bank_ref.trim();
    instruction.settled_at = row.settlement_timestamp || new Date().toISOString();
  }

  _markInstructionFailed(instruction, row) {
    if (instruction._raw) {
      instruction._raw.status         = 'FAILED';
      instruction._raw.failure_reason = row.failure_reason || 'Rejected by clearing bank';
      instruction._raw.bank_utr       = row.bank_ref || null;
    }
    instruction.status         = 'FAILED';
    instruction.failure_reason = row.failure_reason || 'Rejected by clearing bank';
    instruction.bank_utr       = row.bank_ref || null;
  }

  _markInstructionException(instruction, row, reason) {
    if (instruction._raw) {
      instruction._raw.status         = 'EXCEPTION';
      instruction._raw.failure_reason = reason;
    }
    instruction.status         = 'EXCEPTION';
    instruction.failure_reason = reason;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH AUTO-CLOSURE DETERMINATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Determines and writes the final batch state.
   * Auto-closure is blocked whenever any open exception exists.
   */
  _determineBatchClosure(batch, allInstructions, settledInstructions, failedInstructions, openExceptionCount) {
    const closureBlockReasons = [];
    let auto_closure_blocked = false;

    if (openExceptionCount > 0) {
      // Collect unique exception types from batch
      auto_closure_blocked = true;
      batch.status = BatchReconciliationState.RECONCILIATION_EXCEPTION;
      batch.auto_closure_blocked = true;
      batch.closure_block_reason =
        `Batch cannot be closed: ${openExceptionCount} open reconciliation exception(s) must be resolved first.`;

      // We can't enumerate types here without the exception list, but the caller attaches it
      closureBlockReasons.push('OPEN_EXCEPTIONS_EXIST');
    } else {
      // No open exceptions — determine clean final state
      const totalCount   = allInstructions.length;
      const settledCount = settledInstructions.length;
      const failedCount  = failedInstructions.length;

      if (settledCount === totalCount && failedCount === 0) {
        batch.status = BatchReconciliationState.SETTLED;
      } else if (settledCount > 0 && failedCount > 0) {
        batch.status = BatchReconciliationState.PARTIALLY_SETTLED;
      } else if (failedCount === totalCount && settledCount === 0) {
        batch.status = BatchReconciliationState.FAILED;
      } else {
        // Partial response — not all instructions processed yet
        batch.status = BatchReconciliationState.RECONCILING;
      }
      batch.auto_closure_blocked = false;
      batch.closure_block_reason = null;
    }

    batch.reconciliation_completed_at = new Date().toISOString();

    return { auto_closure_blocked, closure_block_reasons: closureBlockReasons };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FEED PARSERS
  // ═══════════════════════════════════════════════════════════════════════════

  _parseFeed(content, format) {
    const fmt = String(format || 'CSV').toUpperCase();
    if (typeof content !== 'string') content = JSON.stringify(content);

    if (fmt === 'JSON') return this._parseJson(content);
    if (fmt === 'XML')  return this._parseXml(content);
    if (fmt === 'TXT')  return this._parseTxt(content);
    return this._parseCsv(content);
  }

  /**
   * Produces normalised BankClearingRow objects from CSV content.
   * Supports flexible column header aliases.
   */
  _parseCsv(csvContent) {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0]
      .split(',')
      .map((h) => h.replace(/["\r]/g, '').trim().toLowerCase().replace(/[\s\-]+/g, '_'));

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = this._splitCsvLine(lines[i]);
      const raw = {};
      headers.forEach((h, idx) => { raw[h] = (cells[idx] || '').replace(/^"|"$/g, '').trim(); });
      rows.push(this._normaliseClearingRow(raw));
    }
    return rows;
  }

  _parseJson(jsonContent) {
    try {
      const parsed = JSON.parse(jsonContent);
      const arr = Array.isArray(parsed) ? parsed : (parsed.records || parsed.transactions || []);
      return arr.map((raw) => this._normaliseClearingRow(raw));
    } catch {
      return [];
    }
  }

  _parseXml(xmlContent) {
    const rows = [];
    const txMatches = xmlContent.match(/<(?:Transaction|Record|NtfctnAcctItem)>([\s\S]*?)<\/(?:Transaction|Record|NtfctnAcctItem)>/gi) || [];
    for (const tx of txMatches) {
      const getTag = (tag) => {
        const m = tx.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return m ? m[1].trim() : '';
      };
      rows.push(this._normaliseClearingRow({
        txn_id:        getTag('TxnId') || getTag('EndToEndId') || getTag('Reference'),
        bank_ref:      getTag('BankRef') || getTag('UTR') || getTag('AcctServicerRef'),
        employee_id:   getTag('EmployeeId') || getTag('EmpId') || getTag('BeneficiaryId'),
        amount:        getTag('Amount') || getTag('Amt') || '0',
        status:        getTag('Status') || getTag('TxnStatus') || '',
        failure_reason: getTag('FailureReason') || getTag('RsnDesc') || '',
        error_code:    getTag('ErrorCode') || '',
        timestamp:     getTag('SettlementDate') || getTag('Timestamp') || '',
      }));
    }
    return rows;
  }

  _parseTxt(txtContent) {
    const lines = txtContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const rows = [];
    for (const line of lines) {
      if (/^(HEADER|TRAILER|H\|)/.test(line.trim())) continue;
      const delimiter = line.includes('\t') ? '\t' : (line.includes('^') ? '^' : '|');
      const parts = line.split(delimiter).map((p) => p.trim());
      const offset = (parts[0] || '').toUpperCase() === 'DETAIL' ? 1 : 0;
      if (parts.length >= 4 + offset) {
        rows.push(this._normaliseClearingRow({
          txn_id:        parts[offset + 0],
          bank_ref:      parts[offset + 1],
          employee_id:   parts[offset + 2],
          amount:        parts[offset + 3],
          status:        parts[offset + 4] || 'PAID',
          failure_reason: parts[offset + 5] || '',
        }));
      }
    }
    return rows;
  }

  /**
   * Converts any raw row object (from any parser) into a normalised
   * BankClearingRow with computed bank_confirmation_present flag.
   */
  _normaliseClearingRow(raw) {
    const txnId   = String(raw.txn_id || raw.transaction_id || raw.payment_reference || raw.ref || '').trim();
    const bankRef = String(raw.bank_ref || raw.utr || raw.utr_number || raw.rrn || '').trim();
    const empId   = String(raw.employee_id || raw.emp_id || raw.beneficiary_id || '').trim();
    const amount  = parseFloat(String(raw.amount || raw.cleared_amount || raw.settled_amount || 0));
    const rawStatus = String(raw.status || raw.txn_status || raw.transaction_status || '').toUpperCase();

    const normalisedStatus = BANK_SUCCESS_STATUSES.has(rawStatus) ? 'PAID' : 'FAILED';

    // bank_confirmation_present requires: status = PAID/SUCCESS AND bank_ref is non-blank
    const bank_confirmation_present = normalisedStatus === 'PAID' && bankRef.length > 0;

    return {
      txn_id:                  txnId,
      bank_ref:                bankRef,
      employee_id:             empId,
      cleared_amount:          isNaN(amount) ? 0 : amount,
      raw_status:              rawStatus,
      normalised_status:       normalisedStatus,
      failure_reason:          raw.failure_reason || raw.return_reason || raw.error_desc || null,
      error_code:              raw.error_code || raw.failure_code || null,
      settlement_timestamp:    raw.timestamp || raw.payment_date || raw.settled_at || new Date().toISOString(),
      bank_confirmation_present,
    };
  }

  _splitCsvLine(line) {
    const cells = [];
    let inQuote = false;
    let current = '';
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') { inQuote = !inQuote; }
      else if (char === ',' && !inQuote) { cells.push(current.trim()); current = ''; }
      else { current += char; }
    }
    cells.push(current.trim());
    return cells;
  }

  _buildExceptionSummary(entries) {
    const summary = {
      amount_mismatch_count:        0,
      missing_identifier_count:     0,
      orphaned_row_count:           0,
      duplicate_external_ref_count: 0,
      partial_settlement_count:     0,
    };
    for (const e of entries) {
      switch (e.exception_type) {
        case ReconciliationExceptionType.AMOUNT_MISMATCH:        summary.amount_mismatch_count++;        break;
        case ReconciliationExceptionType.MISSING_IDENTIFIER:     summary.missing_identifier_count++;     break;
        case ReconciliationExceptionType.ORPHANED_ROW:           summary.orphaned_row_count++;           break;
        case ReconciliationExceptionType.DUPLICATE_EXTERNAL_REF: summary.duplicate_external_ref_count++; break;
        case ReconciliationExceptionType.PARTIAL_SETTLEMENT:     summary.partial_settlement_count++;     break;
      }
    }
    return summary;
  }

  _log(msg) {
    if (this.verbose) console.log(msg);
  }
}
