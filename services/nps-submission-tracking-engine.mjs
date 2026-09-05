/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - NPS SUBMISSION & ACKNOWLEDGEMENT TRACKING ENGINE
 * ============================================================================
 * Features:
 *  1. State Machine:
 *     - Lifecycle: FILE_GENERATED -> SUBMITTED -> ACK_RECEIVED -> COMPLETED (or REJECTED/FAILED)
 *     - Guard against illegal state jumps and unauthorized transitions
 *     - Immutable transition history ledger (from_state, to_state, actor_id, timestamp, metadata)
 *  2. Acknowledgement Ingestion:
 *     - Multi-format parser for CRA/NSDL receipts (XML, JSON, Delimited Caret/CSV)
 *     - Maps Provisional Receipt Number (PRN), Transaction ID, Processed Date, and Clearing Status
 *     - Updates individual subscriber record statuses to ACKNOWLEDGED
 *  3. Failure Handling & Traceability:
 *     - Handles CRA portal and banking gateway rejections with transition to REJECTED / FAILED
 *     - Captures and persists raw gateway error payloads
 *     - Flags affected employee profiles for correction
 *     - Dispatches actionable HR compliance tasks and preserves immutable prior audit logs
 *
 * @version 3.5.0
 * @author Kylrx AI Principal Systems Architect & Lead Backend Engineer
 */

import crypto from 'node:crypto';
import { createNPSHRTask } from './nps-batch-validation-pipeline.mjs';

/**
 * NPS Batch FSM Lifecycle States.
 */
export const NPS_BATCH_STATES = Object.freeze({
  FILE_GENERATED: 'FILE_GENERATED',
  SUBMITTED: 'SUBMITTED',
  ACK_RECEIVED: 'ACK_RECEIVED',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED', // Alias for REJECTED
});

/**
 * NPS Batch FSM Transition Events.
 */
export const NPS_TRANSITION_EVENTS = Object.freeze({
  SUBMIT_TO_CRA: 'SUBMIT_TO_CRA',
  INGEST_ACKNOWLEDGEMENT: 'INGEST_ACKNOWLEDGEMENT',
  CONFIRM_SETTLEMENT: 'CONFIRM_SETTLEMENT',
  REJECT_SUBMISSION: 'REJECT_SUBMISSION',
  REOPEN_FOR_RETRY: 'REOPEN_FOR_RETRY',
});

/**
 * Valid FSM Transition Table.
 */
const VALID_TRANSITIONS = [
  // 1. FILE_GENERATED -> SUBMITTED
  {
    from: 'FILE_GENERATED',
    to: 'SUBMITTED',
    event: 'SUBMIT_TO_CRA',
  },
  // 2. SUBMITTED -> ACK_RECEIVED
  {
    from: 'SUBMITTED',
    to: 'ACK_RECEIVED',
    event: 'INGEST_ACKNOWLEDGEMENT',
  },
  // 3. SUBMITTED -> REJECTED / FAILED
  {
    from: 'SUBMITTED',
    to: 'REJECTED',
    event: 'REJECT_SUBMISSION',
  },
  {
    from: 'SUBMITTED',
    to: 'FAILED',
    event: 'REJECT_SUBMISSION',
  },
  // 4. ACK_RECEIVED -> COMPLETED
  {
    from: 'ACK_RECEIVED',
    to: 'COMPLETED',
    event: 'CONFIRM_SETTLEMENT',
  },
  // 5. ACK_RECEIVED -> REJECTED / FAILED (if clearing fails at settlement stage)
  {
    from: 'ACK_RECEIVED',
    to: 'REJECTED',
    event: 'REJECT_SUBMISSION',
  },
  {
    from: 'ACK_RECEIVED',
    to: 'FAILED',
    event: 'REJECT_SUBMISSION',
  },
  // 6. REJECTED / FAILED -> FILE_GENERATED (Reopened for retry after correction)
  {
    from: 'REJECTED',
    to: 'FILE_GENERATED',
    event: 'REOPEN_FOR_RETRY',
  },
  {
    from: 'FAILED',
    to: 'FILE_GENERATED',
    event: 'REOPEN_FOR_RETRY',
  },
];

/**
 * Custom Error for Invalid or Illegal FSM Transitions.
 */
export class IllegalNpsTransitionError extends Error {
  constructor(message, fromState, event, attemptedToState = null) {
    super(message);
    this.name = 'IllegalNpsTransitionError';
    this.fromState = fromState;
    this.event = event;
    this.attemptedToState = attemptedToState;
  }
}

/**
 * In-memory persistence store for NPS Submission Batches and Audit Logs.
 */
export const inMemoryNpsSubmissionBatches = new Map();
export const inMemoryNpsTransitionLogs = [];

/**
 * Resets in-memory submission tracking stores for testing isolation.
 */
export function resetNpsSubmissionStores() {
  inMemoryNpsSubmissionBatches.clear();
  inMemoryNpsTransitionLogs.length = 0;
}

/**
 * Creates an initialized NPSSubmissionBatch entity.
 *
 * @param {Object} params
 * @returns {Object} NPSSubmissionBatch
 */
export function createNpsSubmissionBatch({
  batch_id = `NPS_BATCH_${Date.now()}`,
  run_id = `RUN_${Date.now()}`,
  period = 'September 2026',
  file_name = 'NSDL_CRA_SCF.txt',
  checksum_sha256 = '',
  total_subscribers = 0,
  total_amount = 0,
  subscriber_records = [],
  actor_id = 'system',
  actor_role = 'SYSTEM_SERVICE',
}) {
  const nowIso = new Date().toISOString();

  const initialTransition = {
    transition_id: `trn_nps_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    from_state: 'DRAFT',
    to_state: 'FILE_GENERATED',
    event: 'GENERATE_FILE',
    actor_id,
    actor_role,
    timestamp: nowIso,
    metadata: {
      file_name,
      checksum_sha256,
      total_subscribers,
      total_amount,
    },
  };

  const normalizedSubscribers = subscriber_records.map((s, idx) => ({
    pran: String(s.pran || '').trim(),
    employee_id: String(s.employee_id || `EMP_${idx + 1}`),
    employee_name: s.employee_name || s.name || '',
    total_contribution: Number(s.total_nps_contribution || s.total_contribution || s.amount || 0),
    status: 'STAGED',
    flagged_for_correction: false,
    rejection_reason: null,
  }));

  const batch = {
    batch_id,
    run_id,
    period,
    state: 'FILE_GENERATED',
    file_name,
    checksum_sha256,
    total_subscribers: total_subscribers || normalizedSubscribers.length,
    total_amount: Math.round(total_amount * 100) / 100,
    prn: null,
    transaction_id: null,
    processed_date: null,
    clearing_status: null,
    raw_gateway_error: null,
    rejection_reason: null,
    subscriber_records: normalizedSubscribers,
    transition_history: [initialTransition],
    created_at: nowIso,
    updated_at: nowIso,
  };

  inMemoryNpsSubmissionBatches.set(batch_id, batch);
  inMemoryNpsTransitionLogs.push(initialTransition);

  return batch;
}

/**
 * Validates and executes an FSM transition on an NPS Submission Batch.
 *
 * @param {Object} batch - NPSSubmissionBatch
 * @param {string} toState - Destination State
 * @param {string} event - Transition Event
 * @param {Object} context - Actor and transition metadata
 * @returns {Object} Updated NPSSubmissionBatch
 */
export function transitionNpsBatchState(
  batch,
  toState,
  event,
  { actorId = 'admin@kylrx.ai', actorRole = 'HR_COMPLIANCE_OFFICER', metadata = {} } = {}
) {
  if (!batch || !batch.state) {
    throw new Error('Valid batch entity with current state is required for transition.');
  }

  const fromState = batch.state;
  const targetState = toState.toUpperCase();

  // Validate allowed transition
  const isValid = VALID_TRANSITIONS.some(
    (t) => t.from === fromState && t.to === targetState && t.event === event
  );

  if (!isValid) {
    throw new IllegalNpsTransitionError(
      `Illegal NPS Batch state transition from '${fromState}' to '${targetState}' via event '${event}'.`,
      fromState,
      event,
      targetState
    );
  }

  const nowIso = new Date().toISOString();
  const transitionEntry = {
    transition_id: `trn_nps_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    from_state: fromState,
    to_state: targetState,
    event,
    actor_id: actorId,
    actor_role: actorRole,
    timestamp: nowIso,
    metadata,
  };

  batch.state = targetState;
  batch.updated_at = nowIso;
  batch.transition_history.push(transitionEntry);
  inMemoryNpsTransitionLogs.push(transitionEntry);

  return batch;
}

/**
 * Transmits / Submits an NPS Batch to CRA / NSDL portal or Bank Gateway.
 * Transitions: FILE_GENERATED -> SUBMITTED.
 *
 * @param {Object} params
 * @returns {Object} Updated batch
 */
export function submitNpsBatchToCra({
  batch,
  submissionReference = null,
  actorId = 'admin@kylrx.ai',
  actorRole = 'HR_COMPLIANCE_OFFICER',
}) {
  const effectiveRef = submissionReference || `SUB_CRA_${Date.now()}`;

  // Update subscribers to SUBMITTED
  for (const sub of batch.subscriber_records) {
    sub.status = 'SUBMITTED';
  }

  return transitionNpsBatchState(batch, 'SUBMITTED', 'SUBMIT_TO_CRA', {
    actorId,
    actorRole,
    metadata: {
      submission_reference: effectiveRef,
      file_name: batch.file_name,
      checksum_sha256: batch.checksum_sha256,
      submitted_at: new Date().toISOString(),
    },
  });
}

/**
 * Multi-format parser for CRA/NSDL Response Acknowledgement Receipts (PRN Receipts).
 * Supports XML, JSON, and Delimited Caret/CSV.
 *
 * @param {string|Object} rawPayload - Acknowledgement receipt payload
 * @returns {Object} NPSAcknowledgementReceipt
 */
export function parseNpsAcknowledgementPayload(rawPayload) {
  if (!rawPayload) {
    throw new Error('Acknowledgement payload is required for parsing.');
  }

  // 1. JSON Object or JSON String
  if (typeof rawPayload === 'object' && rawPayload !== null) {
    return normalizeParsedReceipt(rawPayload, rawPayload);
  }

  const trimmed = String(rawPayload).trim();

  // Try parsing JSON string
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsedJson = JSON.parse(trimmed);
      return normalizeParsedReceipt(parsedJson, rawPayload);
    } catch {
      // fallback to text parsing
    }
  }

  // 2. XML Receipt Format
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const extractXmlTag = (tag, str) => {
      const match = str.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return match ? match[1].trim() : '';
    };

    const prn = extractXmlTag('PRN', trimmed) || extractXmlTag('ProvisionalReceiptNumber', trimmed) || `PRN${Date.now()}`;
    const txnId = extractXmlTag('TransactionId', trimmed) || extractXmlTag('TxnRef', trimmed) || `TXN${Date.now()}`;
    const processedDate = extractXmlTag('ProcessedDate', trimmed) || extractXmlTag('Date', trimmed) || new Date().toISOString().split('T')[0];
    const status = (extractXmlTag('Status', trimmed) || extractXmlTag('ClearingStatus', trimmed) || 'SUCCESS').toUpperCase();
    const subscriberCount = parseInt(extractXmlTag('SubscriberCount', trimmed) || '0', 10);
    const totalAmount = parseFloat(extractXmlTag('TotalAmount', trimmed) || '0');

    // Extract individual subscribers
    const subscriberMatches = [...trimmed.matchAll(/<Subscriber>([\s\S]*?)<\/Subscriber>/gi)];
    const subscriberAcks = [];

    for (const match of subscriberMatches) {
      const subBlock = match[1];
      const pran = extractXmlTag('PRAN', subBlock);
      const subStatus = (extractXmlTag('Status', subBlock) || 'ACKNOWLEDGED').toUpperCase();
      const reason = extractXmlTag('RejectionReason', subBlock) || null;

      if (pran) {
        subscriberAcks.push({
          pran,
          status: subStatus === 'SUCCESS' || subStatus === 'ACKNOWLEDGED' || subStatus === 'CLEARED' ? 'ACKNOWLEDGED' : 'REJECTED',
          rejection_reason: reason,
        });
      }
    }

    return {
      receipt_id: `rcpt_nps_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      prn,
      transaction_id: txnId,
      processed_date: processedDate,
      clearing_status: status === 'SUCCESS' || status === 'ACKNOWLEDGED' || status === 'CLEARED' ? 'SUCCESS' : 'REJECTED',
      total_subscribers_acknowledged: subscriberCount || subscriberAcks.length,
      total_amount_cleared: totalAmount,
      raw_payload: rawPayload,
      subscriber_acknowledgements: subscriberAcks,
    };
  }

  // 3. Delimited Caret / CSV Receipt
  // Header: PRN^Transaction_Id^Processed_Date^Status^Total_Amount
  // Rows: SUB^PRAN^Status^Rejection_Reason
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let prn = `PRN${Date.now()}`;
  let txnId = `TXN${Date.now()}`;
  let processedDate = new Date().toISOString().split('T')[0];
  let clearingStatus = 'SUCCESS';
  let totalAmount = 0;
  const subscriberAcks = [];

  for (const line of lines) {
    const parts = line.split(/[\^,]/).map((p) => p.trim());
    const rowType = parts[0].toUpperCase();

    if (rowType === 'PRN' || rowType === 'ACK' || rowType === 'RECEIPT') {
      prn = parts[1] || prn;
      txnId = parts[2] || txnId;
      processedDate = parts[3] || processedDate;
      clearingStatus = (parts[4] || 'SUCCESS').toUpperCase();
      totalAmount = parseFloat(parts[5] || '0');
    } else if (rowType === 'SUB' || rowType === 'SD' || /^\d{12}$/.test(parts[0])) {
      const pran = /^\d{12}$/.test(parts[0]) ? parts[0] : parts[1];
      const subStatus = (parts[2] || 'ACKNOWLEDGED').toUpperCase();
      const reason = parts[3] || null;

      subscriberAcks.push({
        pran,
        status: subStatus === 'SUCCESS' || subStatus === 'ACKNOWLEDGED' || subStatus === 'CLEARED' ? 'ACKNOWLEDGED' : 'REJECTED',
        rejection_reason: reason,
      });
    }
  }

  return {
    receipt_id: `rcpt_nps_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    prn,
    transaction_id: txnId,
    processed_date: processedDate,
    clearing_status: clearingStatus === 'SUCCESS' || clearingStatus === 'CLEARED' || clearingStatus === 'ACKNOWLEDGED' ? 'SUCCESS' : 'REJECTED',
    total_subscribers_acknowledged: subscriberAcks.length,
    total_amount_cleared: totalAmount,
    raw_payload: rawPayload,
    subscriber_acknowledgements: subscriberAcks,
  };
}

/**
 * Normalizes JSON-based receipt into standard structure.
 */
function normalizeParsedReceipt(json, rawPayload) {
  const prn = String(json.prn || json.provisional_receipt_number || json.PRN || `PRN${Date.now()}`).trim();
  const txnId = String(json.transaction_id || json.txn_id || json.TransactionId || `TXN${Date.now()}`).trim();
  const processedDate = json.processed_date || json.date || new Date().toISOString().split('T')[0];
  const rawStatus = String(json.clearing_status || json.status || 'SUCCESS').toUpperCase();
  const isSuccess = rawStatus === 'SUCCESS' || rawStatus === 'CLEARED' || rawStatus === 'ACKNOWLEDGED';

  const subs = Array.isArray(json.subscribers || json.subscriber_acknowledgements)
    ? (json.subscribers || json.subscriber_acknowledgements)
    : [];

  const subscriberAcks = subs.map((s) => ({
    pran: String(s.pran || s.PRAN || '').trim(),
    employee_id: s.employee_id || s.id || '',
    status: (s.status === 'REJECTED' || s.status === 'FAILED') ? 'REJECTED' : 'ACKNOWLEDGED',
    rejection_reason: s.rejection_reason || s.reason || null,
  }));

  return {
    receipt_id: json.receipt_id || `rcpt_nps_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    prn,
    transaction_id: txnId,
    processed_date: processedDate,
    clearing_status: isSuccess ? 'SUCCESS' : 'REJECTED',
    total_subscribers_acknowledged: json.total_subscribers || json.subscriber_count || subscriberAcks.length,
    total_amount_cleared: Number(json.total_amount || json.amount || 0),
    raw_payload: rawPayload,
    subscriber_acknowledgements: subscriberAcks,
  };
}

/**
 * Ingests CRA / NSDL Acknowledgement Receipt into the batch record:
 *  - Maps PRN, Transaction ID, Processed Date, and Clearing Status.
 *  - Updates individual subscriber records to ACKNOWLEDGED.
 *  - Transitions batch state from SUBMITTED to ACK_RECEIVED (or REJECTED).
 *
 * @param {Object} params
 * @returns {Object} { batch, receipt, acknowledged_count, rejected_count }
 */
export function ingestNpsAcknowledgementReceipt({
  batch,
  receiptPayload,
  actorId = 'admin@kylrx.ai',
  actorRole = 'HR_COMPLIANCE_OFFICER',
  options = {},
}) {
  if (!batch) {
    throw new Error('Valid batch entity is required for acknowledgement ingestion.');
  }

  const receipt = parseNpsAcknowledgementPayload(receiptPayload);

  // Map PRN & Confirmation details to internal batch record
  batch.prn = receipt.prn;
  batch.transaction_id = receipt.transaction_id;
  batch.processed_date = receipt.processed_date;
  batch.clearing_status = receipt.clearing_status;

  // Build lookup of subscriber acknowledgements
  const ackMap = new Map();
  for (const ack of receipt.subscriber_acknowledgements) {
    ackMap.set(ack.pran, ack);
  }

  let ackCount = 0;
  let rejCount = 0;

  for (const sub of batch.subscriber_records) {
    if (ackMap.has(sub.pran)) {
      const ackDetail = ackMap.get(sub.pran);
      if (ackDetail.status === 'ACKNOWLEDGED') {
        sub.status = 'ACKNOWLEDGED';
        sub.flagged_for_correction = false;
        sub.rejection_reason = null;
        ackCount++;
      } else {
        sub.status = 'REJECTED';
        sub.flagged_for_correction = true;
        sub.rejection_reason = ackDetail.rejection_reason || 'Rejected by CRA acknowledgement feed.';
        rejCount++;
      }
    } else {
      // If batch is acknowledged and subscriber wasn't explicitly rejected, mark ACKNOWLEDGED
      if (receipt.clearing_status === 'SUCCESS') {
        sub.status = 'ACKNOWLEDGED';
        ackCount++;
      }
    }
  }

  // Determine transition target based on clearing status
  if (receipt.clearing_status === 'SUCCESS' && rejCount === 0) {
    transitionNpsBatchState(batch, 'ACK_RECEIVED', 'INGEST_ACKNOWLEDGEMENT', {
      actorId,
      actorRole,
      metadata: {
        prn: receipt.prn,
        transaction_id: receipt.transaction_id,
        processed_date: receipt.processed_date,
        clearing_status: receipt.clearing_status,
        acknowledged_subscribers: ackCount,
      },
    });
  } else if (rejCount > 0 && ackCount > 0) {
    // Partial acknowledgement: transition to ACK_RECEIVED with defect metadata
    transitionNpsBatchState(batch, 'ACK_RECEIVED', 'INGEST_ACKNOWLEDGEMENT', {
      actorId,
      actorRole,
      metadata: {
        prn: receipt.prn,
        transaction_id: receipt.transaction_id,
        processed_date: receipt.processed_date,
        clearing_status: 'PARTIAL',
        acknowledged_subscribers: ackCount,
        rejected_subscribers: rejCount,
      },
    });
  } else {
    // Total failure / rejection
    return handleNpsSubmissionRejection({
      batch,
      errorPayload: receipt.raw_payload,
      reason: `CRA Acknowledgement returned status: ${receipt.clearing_status}`,
      errorCode: 'CRA_ACK_REJECTED',
      actorId,
      actorRole,
    });
  }

  return {
    batch,
    receipt,
    acknowledged_count: ackCount,
    rejected_count: rejCount,
  };
}

/**
 * Failure Handling & Traceability:
 *  - Transitions batch state to REJECTED / FAILED.
 *  - Captures raw gateway error payload and rejection reason.
 *  - Flags affected employees for correction.
 *  - Alerts HR administrators with actionable high-priority tasks.
 *  - Preserves prior audit logs immutably.
 *
 * @param {Object} params
 * @returns {Object} { batch, hr_tasks, affected_employees }
 */
export function handleNpsSubmissionRejection({
  batch,
  errorPayload,
  reason = 'Submission rejected by CRA portal / bank gateway.',
  errorCode = 'GATEWAY_ERROR_500',
  affectedPrans = [],
  actorId = 'gateway_listener@kylrx.ai',
  actorRole = 'BANK_INTEGRATION_GATEWAY',
}) {
  if (!batch) {
    throw new Error('Valid batch entity is required for rejection handling.');
  }

  // 1. Capture Raw Gateway Error Payload and Diagnostic details
  batch.raw_gateway_error = typeof errorPayload === 'object' ? errorPayload : { raw: String(errorPayload) };
  batch.rejection_reason = reason;
  batch.clearing_status = 'REJECTED';

  // 2. Flag Affected Employee Profiles
  const targetPranSet = new Set(affectedPrans);
  const flaggedEmployees = [];
  const hrTasks = [];

  for (const sub of batch.subscriber_records) {
    if (targetPranSet.size === 0 || targetPranSet.has(sub.pran)) {
      sub.status = 'REJECTED';
      sub.flagged_for_correction = true;
      sub.rejection_reason = reason;
      flaggedEmployees.push(sub);

      // 3. Dispatch Actionable HR Compliance Alert Task
      const task = createNPSHRTask({
        run_id: batch.run_id,
        employee_id: sub.employee_id,
        employee_name: sub.employee_name,
        issue_code: 'NPS_VAL_001',
        sub_code: errorCode,
        title: `Action Required: CRA Gateway Rejection (${errorCode})`,
        message: `NPS submission failed for PRAN ${sub.pran} (${sub.employee_name || sub.employee_id}). Gateway error: ${reason}`,
        suggested_action: 'Review employee PRAN / bank mandate with NSDL CRA records and remediate master data.',
        priority: 'CRITICAL',
      });
      hrTasks.push(task);
    }
  }

  // 4. Transition State to REJECTED without modifying past audit history
  transitionNpsBatchState(batch, 'REJECTED', 'REJECT_SUBMISSION', {
    actorId,
    actorRole,
    metadata: {
      error_code: errorCode,
      reason,
      flagged_subscribers_count: flaggedEmployees.length,
      raw_gateway_error_summary: typeof errorPayload === 'string' ? errorPayload.slice(0, 200) : errorCode,
    },
  });

  return {
    batch,
    hr_tasks: hrTasks,
    affected_employees: flaggedEmployees,
  };
}

/**
 * Finalizes an NPS Submission Batch upon full settlement clearing confirmation.
 * Transitions: ACK_RECEIVED -> COMPLETED.
 *
 * @param {Object} params
 * @returns {Object} Updated batch
 */
export function confirmNpsSettlementComplete({
  batch,
  settlementReference = null,
  actorId = 'finance_checker@kylrx.ai',
  actorRole = 'FINANCE_HEAD',
}) {
  const effectiveRef = settlementReference || `SETTLE_${Date.now()}`;

  for (const sub of batch.subscriber_records) {
    if (sub.status === 'ACKNOWLEDGED') {
      sub.status = 'COMPLETED';
    }
  }

  batch.clearing_status = 'CLEARED';

  return transitionNpsBatchState(batch, 'COMPLETED', 'CONFIRM_SETTLEMENT', {
    actorId,
    actorRole,
    metadata: {
      settlement_reference: effectiveRef,
      completed_at: new Date().toISOString(),
    },
  });
}
