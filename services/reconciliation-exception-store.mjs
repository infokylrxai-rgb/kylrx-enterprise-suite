/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS — RECONCILIATION EXCEPTION STORE
 * ============================================================================
 * Module: Exception Queue Persistence + Finance Operations Desk Review Items
 *
 * Responsibilities:
 *  1. Persist ExceptionQueueEntry records with mandatory difference_amount.
 *  2. Persist FinanceOpsReviewItem records with action_required instructions.
 *  3. Expose query helpers used by the ReconciliationEngine and REST routes.
 *  4. Provide both In-Memory (test) and Firestore (production) implementations
 *     through the same interface contract.
 *
 * Design Rules:
 *  • Every enqueued exception MUST carry a numeric difference_amount (may be 0).
 *  • An ExceptionQueueEntry and its linked FinanceOpsReviewItem are created
 *    atomically — one entry implies one review item.
 *  • Only OPEN exceptions count toward batch auto-closure blocking.
 *  • Resolved / Waived exceptions are retained for the immutable audit trail.
 *
 * @version 1.0.0
 * @author  Kylrx AI Lead Backend Architecture Team
 */

import crypto from 'node:crypto';

// ─── Exception Queue Status ───────────────────────────────────────────────────
export const ExceptionQueueStatus = Object.freeze({
  OPEN:      'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED:  'RESOLVED',
  WAIVED:    'WAIVED',
});

// ─── Finance Ops Review Item Status ──────────────────────────────────────────
export const ReviewItemStatus = Object.freeze({
  PENDING:  'PENDING',
  ASSIGNED: 'ASSIGNED',
  ACTIONED: 'ACTIONED',
  CLOSED:   'CLOSED',
});

// ─── Priority mapping by exception type ──────────────────────────────────────
const EXCEPTION_PRIORITY = {
  AMOUNT_MISMATCH:        'HIGH',
  MISSING_IDENTIFIER:     'HIGH',
  ORPHANED_ROW:           'CRITICAL',
  DUPLICATE_EXTERNAL_REF: 'CRITICAL',
  PARTIAL_SETTLEMENT:     'MEDIUM',
};

// ─── Action guidance by exception type ───────────────────────────────────────
const ACTION_GUIDANCE = {
  AMOUNT_MISMATCH:
    'Reconcile the difference between the instructed amount and the cleared amount. ' +
    'Obtain the bank debit advice and verify applicable bank charges. ' +
    'If under-paid, raise a supplementary payment instruction for the delta. ' +
    'If over-paid, initiate a refund recovery workflow.',

  MISSING_IDENTIFIER:
    'Obtain the bank settlement confirmation advice for this transaction. ' +
    'Retrieve the missing UTR / TxnId from the bank portal and manually bind ' +
    'it to the affected payment instruction. Re-run the reconciliation pass ' +
    'once the identifier is populated.',

  ORPHANED_ROW:
    'Verify whether the bank reference belongs to a payout from a different ' +
    'batch or a prior payroll cycle. Cross-check the employee master register ' +
    'and confirm whether the instruction was ever submitted. If funds were ' +
    'credited to an unregistered beneficiary, initiate a fund recall request.',

  DUPLICATE_EXTERNAL_REF:
    'Investigate the bank settlement ledger to confirm whether funds were ' +
    'debited once or twice against this UTR / TxnId. If a double-debit ' +
    'occurred, file an immediate dispute with the bank. Update the UTR ledger ' +
    'and remove the duplicate entry from the pending settlement queue.',

  PARTIAL_SETTLEMENT:
    'Confirm the unsettled balance with the bank operations team. ' +
    'Raise a supplementary payment instruction for the outstanding difference ' +
    'amount and attach the original batch reference. Monitor re-settlement ' +
    'confirmation within the next clearing cycle.',
};

/* ============================================================================
 * IN-MEMORY STORE (used in unit tests and local development)
 * ============================================================================ */

export class InMemoryReconciliationStore {
  constructor() {
    /** @type {Map<string, object>} exception_id → ExceptionQueueEntry */
    this._exceptions = new Map();
    /** @type {Map<string, object>} review_item_id → FinanceOpsReviewItem */
    this._reviewItems = new Map();
    /** @type {Map<string, object>} reconciliation_run_id → ReconciliationRunManifest */
    this._runs = new Map();
    /** @type {Map<string, object>} batch document store */
    this._batches = new Map();
    /** @type {Map<string, string[]>} record_ids per batch */
    this._records = new Map();
    /** @type {Set<string>} historic UTR ledger */
    this._utrLedger = new Set();
    /** @type {Set<string>} historic TxnId ledger */
    this._txnIdLedger = new Set();
  }

  async saveReconciliationRun(manifest) {
    this._runs.set(manifest.reconciliation_run_id, { ...manifest });
  }

  async saveExceptionQueueEntry(entry) {
    this._exceptions.set(entry.exception_id, { ...entry });
  }

  async saveExceptionQueueEntries(entries) {
    for (const entry of entries) {
      await this.saveExceptionQueueEntry(entry);
    }
  }

  async saveFinanceOpsReviewItem(item) {
    this._reviewItems.set(item.review_item_id, { ...item });
  }

  async saveFinanceOpsReviewItems(items) {
    for (const item of items) {
      await this.saveFinanceOpsReviewItem(item);
    }
  }

  async savePaymentBatch(batch) {
    this._batches.set(batch.batch_id, { ...batch });
  }

  async savePaymentInstructions(instructions) {
    for (const inst of instructions) {
      const batchId = inst.batch_id || inst._raw?.batch_id;
      if (batchId) {
        let list = this._records.get(batchId) || [];
        const idx = list.findIndex(
          (i) => (i.record_id || i.employee_id) === (inst.record_id || inst.employee_id)
        );
        if (idx >= 0) list[idx] = { ...inst };
        else list.push({ ...inst });
        this._records.set(batchId, list);
      }
    }
  }

  async listOpenExceptionsByBatch(batchId) {
    return Array.from(this._exceptions.values()).filter(
      (e) => e.batch_id === batchId && e.status === ExceptionQueueStatus.OPEN
    );
  }

  async listAllExceptionsByBatch(batchId) {
    return Array.from(this._exceptions.values()).filter((e) => e.batch_id === batchId);
  }

  async listPendingReviewItems(batchId = null) {
    return Array.from(this._reviewItems.values()).filter((item) => {
      const statusMatch = item.status === ReviewItemStatus.PENDING || item.status === ReviewItemStatus.ASSIGNED;
      return batchId ? (item.batch_id === batchId && statusMatch) : statusMatch;
    });
  }

  async getReconciliationRun(runId) {
    return this._runs.get(runId) || null;
  }

  async getExceptionById(exceptionId) {
    return this._exceptions.get(exceptionId) || null;
  }

  async resolveException(exceptionId, resolvedBy, notes) {
    const entry = this._exceptions.get(exceptionId);
    if (!entry) throw new Error(`ExceptionQueueEntry '${exceptionId}' not found.`);
    const updated = {
      ...entry,
      status: ExceptionQueueStatus.RESOLVED,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes || 'Resolved',
      updated_at: new Date().toISOString(),
    };
    this._exceptions.set(exceptionId, updated);

    // Close the linked review item
    if (entry.finance_ops_review_item_id) {
      const item = this._reviewItems.get(entry.finance_ops_review_item_id);
      if (item) {
        this._reviewItems.set(entry.finance_ops_review_item_id, {
          ...item,
          status: ReviewItemStatus.CLOSED,
          actioned_by: resolvedBy,
          actioned_at: new Date().toISOString(),
          action_notes: notes || 'Resolved via exception resolution endpoint',
          updated_at: new Date().toISOString(),
        });
      }
    }

    return updated;
  }

  async getHistoricUtrLedger() {
    return new Set(this._utrLedger);
  }

  async getHistoricTxnIdLedger() {
    return new Set(this._txnIdLedger);
  }

  async appendToUtrLedger(_, utrs) {
    for (const u of utrs) this._utrLedger.add(u);
  }

  async appendToTxnIdLedger(_, txnIds) {
    for (const t of txnIds) this._txnIdLedger.add(t);
  }

  /** Summary stats for a batch */
  async getExceptionSummary(batchId) {
    const all = await this.listAllExceptionsByBatch(batchId);
    const open = all.filter((e) => e.status === ExceptionQueueStatus.OPEN);

    const byType = {};
    for (const entry of all) {
      byType[entry.exception_type] = (byType[entry.exception_type] || 0) + 1;
    }

    const totalDifference = all.reduce((sum, e) => sum + Math.abs(e.difference_amount || 0), 0);

    return {
      batch_id: batchId,
      total_exceptions: all.length,
      open_exceptions: open.length,
      resolved_exceptions: all.filter((e) => e.status === ExceptionQueueStatus.RESOLVED).length,
      waived_exceptions: all.filter((e) => e.status === ExceptionQueueStatus.WAIVED).length,
      breakdown_by_type: byType,
      total_difference_amount: Math.round(totalDifference * 100) / 100,
      batch_auto_closure_blocked: open.length > 0,
    };
  }
}

/* ============================================================================
 * EXCEPTION QUEUE ENTRY FACTORY
 * ============================================================================ */

/**
 * Builds a validated ExceptionQueueEntry from raw guard output.
 * difference_amount is ALWAYS calculated and present.
 */
export function buildExceptionQueueEntry({
  reconciliationRunId,
  batchId,
  exceptionType,
  bankRow,
  instruction,
  differenceAmount,
  reason,
  affectedField = null,
}) {
  const now = new Date().toISOString();
  const exceptionId = `EXC-${exceptionType.substring(0, 4)}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
  const reviewItemId = `FIN-${exceptionType.substring(0, 4)}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

  // Validate difference_amount is always a finite number
  const safeDiff = typeof differenceAmount === 'number' && isFinite(differenceAmount)
    ? Math.round(differenceAmount * 100) / 100
    : 0;

  const priority = EXCEPTION_PRIORITY[exceptionType] || 'MEDIUM';

  const instructedAmount = instruction
    ? Number(instruction.instructed_amount ?? instruction.net_payable_amount ?? 0)
    : null;
  const clearedAmount = bankRow ? Number(bankRow.cleared_amount ?? 0) : null;

  /** @type {ExceptionQueueEntry} */
  const entry = {
    exception_id: exceptionId,
    reconciliation_run_id: reconciliationRunId,
    batch_id: batchId,
    exception_type: exceptionType,

    txn_id:          bankRow?.txn_id          || null,
    bank_ref:        bankRow?.bank_ref         || null,
    employee_id:     instruction?.employee_id  || bankRow?.employee_id || null,
    employee_name:   instruction?.employee_name || null,
    instruction_id:  instruction?.record_id    || null,

    instructed_amount: instructedAmount,
    cleared_amount:    clearedAmount,
    difference_amount: safeDiff,

    reason,
    affected_field:      affectedField,
    source_bank_row:     bankRow || null,

    status:   ExceptionQueueStatus.OPEN,
    priority,

    assigned_to:           null,
    resolved_by:           null,
    resolved_at:           null,
    resolution_notes:      null,
    waiver_justification:  null,

    finance_ops_review_item_id: reviewItemId,

    created_at: now,
    updated_at: now,
  };

  // Build the linked Finance Ops review item
  const diffDirection =
    safeDiff > 0  ? 'OVER_PAID' :
    safeDiff < 0  ? 'UNDER_PAID' :
                    'NOT_APPLICABLE';

  /** @type {FinanceOpsReviewItem} */
  const reviewItem = {
    review_item_id: reviewItemId,
    exception_id:   exceptionId,
    reconciliation_run_id: reconciliationRunId,
    batch_id:       batchId,

    category:    exceptionType,
    priority,
    title:       _buildReviewTitle(exceptionType, entry),
    description: reason,
    action_required: ACTION_GUIDANCE[exceptionType] ||
                     'Contact Finance Head for manual review and resolution.',

    context: {
      employee_id:        entry.employee_id,
      employee_name:      entry.employee_name,
      batch_id:           batchId,
      txn_id:             entry.txn_id,
      bank_ref:           entry.bank_ref,
      instructed_amount:  instructedAmount,
      cleared_amount:     clearedAmount,
      difference_amount:  Math.abs(safeDiff),
      difference_direction: diffDirection,
      failure_reason: bankRow?.failure_reason || null,
    },

    status:       ReviewItemStatus.PENDING,
    assigned_to:  null,
    assigned_at:  null,
    actioned_by:  null,
    actioned_at:  null,
    action_notes: null,

    exception_queue_entry_id: exceptionId,

    created_at: now,
    updated_at: now,
  };

  return { entry, reviewItem };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _buildReviewTitle(type, entry) {
  const emp = entry.employee_name
    ? `${entry.employee_name} (${entry.employee_id || 'N/A'})`
    : (entry.employee_id || 'Unknown');

  switch (type) {
    case 'AMOUNT_MISMATCH':
      return `Amount Mismatch — ${emp} | Δ ₹${Math.abs(entry.difference_amount).toFixed(2)}`;
    case 'MISSING_IDENTIFIER':
      return `Missing ${entry.affected_field || 'Identifier'} — ${emp} | TxnId/UTR absent`;
    case 'ORPHANED_ROW':
      return `Orphaned Bank Row — txn_id: ${entry.txn_id || 'N/A'} | No matching instruction`;
    case 'DUPLICATE_EXTERNAL_REF':
      return `Duplicate ${entry.affected_field || 'Reference'} — ${entry.bank_ref || entry.txn_id} | Risk of double-credit`;
    case 'PARTIAL_SETTLEMENT':
      return `Partial Settlement — ${emp} | Unsettled ₹${Math.abs(entry.difference_amount).toFixed(2)}`;
    default:
      return `Reconciliation Exception — ${type} | ${emp}`;
  }
}
