/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS — RECONCILIATION DOMAIN SCHEMA
 * ============================================================================
 * Type definitions for:
 *  - Normalised incoming bank clearing rows (multi-format ingestion)
 *  - Transaction mapper resolution results (1:1 enforcement)
 *  - Six reconciliation exception guard types
 *  - Persisted exception queue entries (with mandatory Δ calculation)
 *  - Finance Operations desk review items
 *  - Full reconciliation run manifest
 *
 * Design Constraints:
 *  • A record may NEVER transition to PAID via mapper output alone.
 *    Only ReconciliationEngine.applyPaidStatus() may write status = PAID,
 *    and only after ALL six guards pass with bank_confirmation_present = true.
 *  • Every ExceptionQueueEntry MUST carry a numeric difference_amount.
 *    A value of 0 is valid (e.g. for MISSING_IDENTIFIER where Δ is undefined
 *    by nature), but the field is always present and explicitly typed.
 *
 * @version 1.0.0
 * @author  Kylrx AI Lead Backend Architecture Team
 */

/* ============================================================================
 * 1. INCOMING BANK CLEARING ROW (Normalised)
 * ============================================================================ */

/**
 * Normalised representation of a single row from an ingested bank response
 * file (CSV / XML / JSON / TXT). All parsers must produce this shape.
 */
export interface BankClearingRow {
  /** Bank-assigned transaction identifier (primary match key). May be blank → guard triggers. */
  txn_id: string;
  /** Unique Transaction Reference (UTR) / RRN assigned by the clearing network. May be blank. */
  bank_ref: string;
  /** Employee identifier from the bank file. Used as secondary match key. */
  employee_id: string;
  /** Amount cleared / credited by the bank. Must be a finite positive number. */
  cleared_amount: number;
  /** Raw status string as emitted by the bank (e.g. "PAID", "SUCCESS", "FAILED", "RETURNED"). */
  raw_status: string;
  /** Normalised status: PAID | FAILED */
  normalised_status: 'PAID' | 'FAILED';
  /** Failure / return reason from the bank, if any. */
  failure_reason: string | null;
  /** Bank-reported error code. */
  error_code: string | null;
  /** Settlement or value date in ISO 8601. Defaults to ingestion timestamp if absent. */
  settlement_timestamp: string;
  /**
   * True only when normalised_status === 'PAID' AND bank_ref is non-blank.
   * Used by the Anti-Assumption Guard to gate PAID status writes.
   */
  bank_confirmation_present: boolean;
}

/* ============================================================================
 * 2. EXCEPTION TYPE CATALOGUE
 * ============================================================================ */

/**
 * All possible reasons why a bank clearing row or payment instruction triggers
 * a reconciliation exception and enters the exception queue.
 */
export enum ReconciliationExceptionType {
  /**
   * GUARD-1 — The cleared paid_amount differs from the instructed_amount by
   * more than the configured tolerance (Δ ≠ 0).
   * difference_amount = cleared_amount − instructed_amount
   */
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',

  /**
   * GUARD-2 — txn_id is blank / missing, OR bank_ref (UTR) is blank / missing.
   * difference_amount = 0 (amount unknown; identifier itself is the problem).
   */
  MISSING_IDENTIFIER = 'MISSING_IDENTIFIER',

  /**
   * GUARD-3 — The bank response references an employee_id that has no master
   * record, OR an instruction_id that was never registered in the batch.
   * difference_amount = cleared_amount (full amount is unattributable).
   */
  ORPHANED_ROW = 'ORPHANED_ROW',

  /**
   * GUARD-4 — The same txn_id or bank_ref (UTR) has been seen in either the
   * current ingestion batch or the historic UTR/TxnId ledger.
   * difference_amount = cleared_amount (risk of double-credit).
   */
  DUPLICATE_EXTERNAL_REF = 'DUPLICATE_EXTERNAL_REF',

  /**
   * GUARD-5 — cleared_amount > 0 but cleared_amount < instructed_amount − tolerance.
   * Signals a partial bank disbursement; unsettled balance must be re-queued.
   * difference_amount = instructed_amount − cleared_amount (unsettled balance).
   */
  PARTIAL_SETTLEMENT = 'PARTIAL_SETTLEMENT',
}

/* ============================================================================
 * 3. TRANSACTION MAPPER TYPES
 * ============================================================================ */

/** Match strategy used to bind a clearing row to a payment instruction. */
export type MatchStrategy =
  | 'PAYMENT_REFERENCE'   // Matched via payment_reference / txn_id (primary)
  | 'EMPLOYEE_ID'         // Matched via employee_id (secondary fallback)
  | 'UNMATCHED';          // No instruction found → ORPHANED_ROW candidate

/**
 * Result of mapping a single BankClearingRow to an internal PaymentDisbursementRecord.
 * The mapper NEVER writes status = PAID; it only establishes the link.
 */
export interface MappedPair {
  bank_row: BankClearingRow;
  /** The internal instruction record. Null if UNMATCHED. */
  instruction: PaymentInstruction | null;
  match_strategy: MatchStrategy;
  /** The key that produced the match (e.g. the actual txn_id value). */
  match_key: string | null;
}

/**
 * Lightweight shape of a payment instruction as the mapper sees it.
 * Deliberately minimal to decouple from the full PaymentDisbursementRecord.
 */
export interface PaymentInstruction {
  record_id: string;
  batch_id: string;
  employee_id: string;
  employee_name: string;
  payment_reference: string;
  instructed_amount: number;
  /** Current lifecycle status. Must NOT be PAID before bank confirmation. */
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXCEPTION' | 'PARTIAL' | string;
  ifsc_code: string;
  account_number_masked: string;
  bank_name?: string;
}

/**
 * Full output of TransactionMapper.mapBankResponseFeed().
 */
export interface TransactionMapperResult {
  batch_id: string;
  total_bank_rows: number;
  matched_count: number;
  unmatched_count: number;
  /** All rows that resolved to exactly one instruction. */
  matched_pairs: MappedPair[];
  /** Rows for which no matching instruction was found (ORPHANED_ROW candidates). */
  unmatched_rows: BankClearingRow[];
  mapped_at: string;
}

/* ============================================================================
 * 4. EXCEPTION QUEUE ENTRY
 * ============================================================================ */

/** Operational lifecycle of a single exception queue entry. */
export type ExceptionQueueStatus =
  | 'OPEN'                // Awaiting Finance Ops action
  | 'IN_REVIEW'           // Assigned and being investigated
  | 'RESOLVED'            // Root cause confirmed, corrective action taken
  | 'WAIVED';             // Intentionally waived with documented justification

/**
 * A single row in the Exception Queue.
 * Persisted to Firestore: /reconciliation_exceptions/{exception_id}
 *
 * MANDATORY: difference_amount is ALWAYS present. Its meaning is
 * defined per ReconciliationExceptionType (see enum docs above).
 */
export interface ExceptionQueueEntry {
  exception_id: string;
  reconciliation_run_id: string;
  batch_id: string;
  exception_type: ReconciliationExceptionType;

  /** Identifiers from the bank clearing row */
  txn_id: string | null;
  bank_ref: string | null;
  employee_id: string | null;
  employee_name: string | null;
  instruction_id: string | null;

  /** Financial figures */
  instructed_amount: number | null;
  cleared_amount: number | null;
  /**
   * Signed difference: cleared_amount − instructed_amount.
   * Negative → under-payment / partial settlement.
   * Positive → over-payment.
   * Zero → non-amount exception (e.g. MISSING_IDENTIFIER).
   */
  difference_amount: number;

  /** Human-readable summary of the exception cause. */
  reason: string;
  /** Field that triggered the guard (e.g. 'txn_id', 'bank_ref', 'cleared_amount'). */
  affected_field: string | null;
  /** Raw bank clearing row that triggered this exception. */
  source_bank_row: BankClearingRow | null;

  /** Operational state */
  status: ExceptionQueueStatus;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  /** Resolution tracking */
  assigned_to: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  waiver_justification: string | null;

  /** Linked Finance Ops review item */
  finance_ops_review_item_id: string | null;

  created_at: string;
  updated_at: string;
}

/* ============================================================================
 * 5. FINANCE OPERATIONS DESK REVIEW ITEM
 * ============================================================================ */

/**
 * An actionable task dispatched to the Finance Operations desk when a
 * reconciliation exception cannot be auto-resolved.
 * Persisted to Firestore: /finance_ops_review_items/{review_item_id}
 */
export interface FinanceOpsReviewItem {
  review_item_id: string;
  exception_id: string;
  reconciliation_run_id: string;
  batch_id: string;

  /** Category label for the Finance Ops dashboard */
  category: ReconciliationExceptionType;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;

  /** Specific action instructions for the Finance Ops analyst */
  action_required: string;
  /** Supporting data for decision-making */
  context: {
    employee_id: string | null;
    employee_name: string | null;
    batch_id: string;
    txn_id: string | null;
    bank_ref: string | null;
    instructed_amount: number | null;
    cleared_amount: number | null;
    /** Absolute value of the difference to surface in the UI */
    difference_amount: number;
    difference_direction: 'OVER_PAID' | 'UNDER_PAID' | 'NOT_APPLICABLE';
    failure_reason: string | null;
  };

  /** Workflow state */
  status: 'PENDING' | 'ASSIGNED' | 'ACTIONED' | 'CLOSED';
  assigned_to: string | null;
  assigned_at: string | null;
  actioned_by: string | null;
  actioned_at: string | null;
  action_notes: string | null;

  /** Link back to exception queue */
  exception_queue_entry_id: string;

  created_at: string;
  updated_at: string;
}

/* ============================================================================
 * 6. RECONCILIATION RUN MANIFEST
 * ============================================================================ */

/**
 * Complete result document for a single reconciliation run.
 * Persisted to Firestore: /reconciliation_runs/{reconciliation_run_id}
 */
export interface ReconciliationRunManifest {
  reconciliation_run_id: string;
  batch_id: string;
  organization_id: string;
  uploaded_file_name: string;
  file_format: 'CSV' | 'JSON' | 'XML' | 'TXT';

  /** Counts */
  total_bank_rows_parsed: number;
  matched_count: number;
  unmatched_count: number;
  clean_matches_count: number;  // rows that passed all 6 guards
  exception_count: number;

  /** Financial summary */
  total_instructed_amount: number;
  total_cleared_amount: number;
  total_settled_amount: number;         // sum of PAID records
  total_exception_amount: number;       // sum of |difference_amount| across exceptions
  total_partial_settlement_gap: number; // sum of PARTIAL_SETTLEMENT difference_amounts

  /** Guard-level exception breakdown */
  exception_summary: {
    amount_mismatch_count: number;
    missing_identifier_count: number;
    orphaned_row_count: number;
    duplicate_external_ref_count: number;
    partial_settlement_count: number;
  };

  /**
   * Whether the batch was blocked from auto-closure.
   * True whenever exception_count > 0.
   */
  batch_auto_closure_blocked: boolean;
  closure_block_reasons: ReconciliationExceptionType[];

  /** Final batch status after this run */
  resulting_batch_status: string;

  /** IDs of all exception queue entries created in this run */
  exception_queue_entry_ids: string[];
  /** IDs of all Finance Ops review items created in this run */
  finance_ops_review_item_ids: string[];

  reconciled_by: string;
  reconciled_at: string;
}

/* ============================================================================
 * 7. STORAGE REPOSITORY CONTRACT
 * ============================================================================ */

/**
 * Port interface for the storage adapter passed into ReconciliationEngine.
 * Implementations can be in-memory (tests) or Firestore (production).
 */
export interface ReconciliationStorageRepository {
  /** Save the full run manifest */
  saveReconciliationRun(manifest: ReconciliationRunManifest): Promise<void>;
  /** Persist a single exception queue entry */
  saveExceptionQueueEntry(entry: ExceptionQueueEntry): Promise<void>;
  /** Batch persist multiple exception queue entries */
  saveExceptionQueueEntries(entries: ExceptionQueueEntry[]): Promise<void>;
  /** Persist a single Finance Ops review item */
  saveFinanceOpsReviewItem(item: FinanceOpsReviewItem): Promise<void>;
  /** Batch persist multiple Finance Ops review items */
  saveFinanceOpsReviewItems(items: FinanceOpsReviewItem[]): Promise<void>;
  /** Update the payment batch document (status, auto_closure_blocked, etc.) */
  savePaymentBatch(batch: object): Promise<void>;
  /** Update individual payment instruction records */
  savePaymentInstructions(instructions: object[]): Promise<void>;
  /** Retrieve all open exception queue entries for a batch */
  listOpenExceptionsByBatch(batchId: string): Promise<ExceptionQueueEntry[]>;
  /** Retrieve the historic UTR ledger (for cross-batch duplicate detection) */
  getHistoricUtrLedger(organizationId: string): Promise<Set<string>>;
  /** Retrieve the historic TxnId ledger */
  getHistoricTxnIdLedger(organizationId: string): Promise<Set<string>>;
  /** Append newly confirmed UTRs to the persistent ledger */
  appendToUtrLedger(organizationId: string, utrs: string[]): Promise<void>;
  /** Append newly confirmed TxnIds to the persistent ledger */
  appendToTxnIdLedger(organizationId: string, txnIds: string[]): Promise<void>;
}
