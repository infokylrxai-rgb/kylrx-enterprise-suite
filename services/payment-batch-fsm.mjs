/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYMENT BATCH FINITE STATE MACHINE (FSM)
 * ============================================================================
 * Transition-Controlled Finite State Machine (FSM) for PaymentBatch Entities.
 *
 * Strict Lifecycle Rails:
 *   DRAFT -> VALIDATING -> VALIDATED -> PENDING_APPROVAL -> APPROVED ->
 *   FILE_GENERATED -> SUBMITTED -> RECONCILING -> PAID (or FAILED)
 *
 * Architectural Guarantees:
 *   1. Rejection of illegal state transitions and unauthorized step jumps.
 *   2. Immutable appending to batch_transition_history subcollection/table:
 *      (from_state, to_state, actor_id, actor_role, timestamp, metadata).
 *   3. Enforced retry/re-open rules: failure remediation creates a dedicated
 *      REOPENED_FOR_RETRY transition event rather than overwriting past history.
 *   4. Segregation of Duties (4-Eyes Rule) on approval transitions.
 *
 * @version 1.0.0
 * @author Kylrx AI Senior Backend Systems Team
 */

import crypto from 'node:crypto';

export const PaymentBatchState = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATING: 'VALIDATING',
  VALIDATED: 'VALIDATED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  FILE_GENERATED: 'FILE_GENERATED',
  SUBMITTED: 'SUBMITTED',
  RECONCILING: 'RECONCILING',
  PAID: 'PAID',
  FAILED: 'FAILED',
});

export const BatchTransitionEvent = Object.freeze({
  START_VALIDATION: 'START_VALIDATION',
  VALIDATION_PASSED: 'VALIDATION_PASSED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CANCEL_VALIDATION: 'CANCEL_VALIDATION',
  SUBMIT_FOR_APPROVAL: 'SUBMIT_FOR_APPROVAL',
  RECALL_FOR_EDIT: 'RECALL_FOR_EDIT',
  APPROVE_BATCH: 'APPROVE_BATCH',
  REJECT_BATCH: 'REJECT_BATCH',
  GENERATE_FILE: 'GENERATE_FILE',
  TRANSMIT_TO_BANK: 'TRANSMIT_TO_BANK',
  BANK_TRANSMISSION_FAILED: 'BANK_TRANSMISSION_FAILED',
  START_RECONCILIATION: 'START_RECONCILIATION',
  SETTLEMENT_COMPLETED: 'SETTLEMENT_COMPLETED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  REOPENED_FOR_RETRY: 'REOPENED_FOR_RETRY',
});

export const ActorRole = Object.freeze({
  PAYROLL_MAKER: 'PAYROLL_MAKER',
  PAYROLL_CHECKER: 'PAYROLL_CHECKER',
  HR_ADMIN: 'HR_ADMIN',
  FINANCE_HEAD: 'FINANCE_HEAD',
  SYSTEM_SERVICE: 'SYSTEM_SERVICE',
  BANK_INTEGRATION_GATEWAY: 'BANK_INTEGRATION_GATEWAY',
});

// Custom Error Hierarchies for Strict Diagnostic Trapping
export class IllegalStateTransitionError extends Error {
  constructor(message, fromState, event, attemptedToState = null) {
    super(message);
    this.name = 'IllegalStateTransitionError';
    this.fromState = fromState;
    this.event = event;
    this.attemptedToState = attemptedToState;
  }
}

export class UnauthorizedTransitionError extends Error {
  constructor(message, actorId, actorRole, requiredRoles = []) {
    super(message);
    this.name = 'UnauthorizedTransitionError';
    this.actorId = actorId;
    this.actorRole = actorRole;
    this.requiredRoles = requiredRoles;
  }
}

export class PreconditionFailedError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'PreconditionFailedError';
    this.context = context;
  }
}

/**
 * Valid FSM Transition Table with Role Authorization & Precondition Guards
 */
const TRANSITION_TABLE = [
  // 1. DRAFT -> VALIDATING
  {
    from: PaymentBatchState.DRAFT,
    event: BatchTransitionEvent.START_VALIDATION,
    to: PaymentBatchState.VALIDATING,
    allowedRoles: [ActorRole.PAYROLL_MAKER, ActorRole.HR_ADMIN, ActorRole.SYSTEM_SERVICE],
    guard: (batch) => {
      if (!batch.record_count || batch.record_count <= 0) {
        throw new PreconditionFailedError('Cannot validate batch with 0 records', { batch_id: batch.batch_id });
      }
    },
  },

  // 2. VALIDATING -> VALIDATED
  {
    from: PaymentBatchState.VALIDATING,
    event: BatchTransitionEvent.VALIDATION_PASSED,
    to: PaymentBatchState.VALIDATED,
    allowedRoles: [ActorRole.SYSTEM_SERVICE, ActorRole.HR_ADMIN],
    guard: (batch, ctx) => {
      if (ctx.metadata?.blocking_issues_count > 0) {
        throw new PreconditionFailedError('Validation cannot pass when blocking issues remain', ctx.metadata);
      }
    },
  },

  // 3. VALIDATING -> FAILED
  {
    from: PaymentBatchState.VALIDATING,
    event: BatchTransitionEvent.VALIDATION_FAILED,
    to: PaymentBatchState.FAILED,
    allowedRoles: [ActorRole.SYSTEM_SERVICE, ActorRole.HR_ADMIN],
  },

  // 4. VALIDATING -> DRAFT (Cancel Validation)
  {
    from: PaymentBatchState.VALIDATING,
    event: BatchTransitionEvent.CANCEL_VALIDATION,
    to: PaymentBatchState.DRAFT,
    allowedRoles: [ActorRole.PAYROLL_MAKER, ActorRole.HR_ADMIN, ActorRole.SYSTEM_SERVICE],
  },

  // 5. VALIDATED -> PENDING_APPROVAL
  {
    from: PaymentBatchState.VALIDATED,
    event: BatchTransitionEvent.SUBMIT_FOR_APPROVAL,
    to: PaymentBatchState.PENDING_APPROVAL,
    allowedRoles: [ActorRole.PAYROLL_MAKER, ActorRole.HR_ADMIN],
    guard: (batch, ctx) => {
      if (!batch.maker_id && !ctx.actor_id) {
        throw new PreconditionFailedError('Batch submission requires an identified Maker ID', { batch_id: batch.batch_id });
      }
    },
  },

  // 6. VALIDATED -> DRAFT (Recall for edits)
  {
    from: PaymentBatchState.VALIDATED,
    event: BatchTransitionEvent.RECALL_FOR_EDIT,
    to: PaymentBatchState.DRAFT,
    allowedRoles: [ActorRole.PAYROLL_MAKER, ActorRole.HR_ADMIN],
  },

  // 7. PENDING_APPROVAL -> APPROVED (4-Eyes Check)
  {
    from: PaymentBatchState.PENDING_APPROVAL,
    event: BatchTransitionEvent.APPROVE_BATCH,
    to: PaymentBatchState.APPROVED,
    allowedRoles: [ActorRole.PAYROLL_CHECKER, ActorRole.FINANCE_HEAD],
    guard: (batch, ctx) => {
      // Enforce 4-Eyes Segregation of Duties: Maker cannot approve their own batch
      if (batch.maker_id && batch.maker_id === ctx.actor_id) {
        throw new UnauthorizedTransitionError(
          `Segregation of Duties Violation: Maker '${batch.maker_id}' cannot approve their own batch. 4-Eyes check required.`,
          ctx.actor_id,
          ctx.actor_role,
          [ActorRole.PAYROLL_CHECKER, ActorRole.FINANCE_HEAD]
        );
      }
    },
  },

  // 8. PENDING_APPROVAL -> FAILED (Checker Rejection)
  {
    from: PaymentBatchState.PENDING_APPROVAL,
    event: BatchTransitionEvent.REJECT_BATCH,
    to: PaymentBatchState.FAILED,
    allowedRoles: [ActorRole.PAYROLL_CHECKER, ActorRole.FINANCE_HEAD],
  },

  // 9. PENDING_APPROVAL -> DRAFT (Recall for rework)
  {
    from: PaymentBatchState.PENDING_APPROVAL,
    event: BatchTransitionEvent.RECALL_FOR_EDIT,
    to: PaymentBatchState.DRAFT,
    allowedRoles: [ActorRole.PAYROLL_MAKER, ActorRole.HR_ADMIN],
  },

  // 10. APPROVED -> FILE_GENERATED
  {
    from: PaymentBatchState.APPROVED,
    event: BatchTransitionEvent.GENERATE_FILE,
    to: PaymentBatchState.FILE_GENERATED,
    allowedRoles: [ActorRole.PAYROLL_MAKER, ActorRole.PAYROLL_CHECKER, ActorRole.HR_ADMIN, ActorRole.FINANCE_HEAD, ActorRole.SYSTEM_SERVICE],
    guard: (batch, ctx) => {
      if (!ctx.metadata?.checksum && !batch.checksum) {
        throw new PreconditionFailedError('Generating bank file requires a cryptographic SHA-256 checksum in metadata', { batch_id: batch.batch_id });
      }
    },
  },

  // 11. FILE_GENERATED -> SUBMITTED
  {
    from: PaymentBatchState.FILE_GENERATED,
    event: BatchTransitionEvent.TRANSMIT_TO_BANK,
    to: PaymentBatchState.SUBMITTED,
    allowedRoles: [ActorRole.PAYROLL_CHECKER, ActorRole.FINANCE_HEAD, ActorRole.BANK_INTEGRATION_GATEWAY, ActorRole.SYSTEM_SERVICE],
  },

  // 12. SUBMITTED -> RECONCILING
  {
    from: PaymentBatchState.SUBMITTED,
    event: BatchTransitionEvent.START_RECONCILIATION,
    to: PaymentBatchState.RECONCILING,
    allowedRoles: [ActorRole.BANK_INTEGRATION_GATEWAY, ActorRole.FINANCE_HEAD, ActorRole.SYSTEM_SERVICE, ActorRole.HR_ADMIN],
  },

  // 13. SUBMITTED -> FAILED (Bank transmission dropped / rejected)
  {
    from: PaymentBatchState.SUBMITTED,
    event: BatchTransitionEvent.BANK_TRANSMISSION_FAILED,
    to: PaymentBatchState.FAILED,
    allowedRoles: [ActorRole.BANK_INTEGRATION_GATEWAY, ActorRole.SYSTEM_SERVICE, ActorRole.FINANCE_HEAD],
  },

  // 14. RECONCILING -> PAID (Terminal Success)
  {
    from: PaymentBatchState.RECONCILING,
    event: BatchTransitionEvent.SETTLEMENT_COMPLETED,
    to: PaymentBatchState.PAID,
    allowedRoles: [ActorRole.BANK_INTEGRATION_GATEWAY, ActorRole.SYSTEM_SERVICE, ActorRole.FINANCE_HEAD],
  },

  // 15. RECONCILING -> FAILED (Settlement dropped / reconciliation rejection)
  {
    from: PaymentBatchState.RECONCILING,
    event: BatchTransitionEvent.RECONCILIATION_FAILED,
    to: PaymentBatchState.FAILED,
    allowedRoles: [ActorRole.BANK_INTEGRATION_GATEWAY, ActorRole.SYSTEM_SERVICE, ActorRole.FINANCE_HEAD],
  },

  // 16. FAILED -> DRAFT (REOPENED_FOR_RETRY Rule)
  {
    from: PaymentBatchState.FAILED,
    event: BatchTransitionEvent.REOPENED_FOR_RETRY,
    to: PaymentBatchState.DRAFT,
    allowedRoles: [ActorRole.PAYROLL_MAKER, ActorRole.HR_ADMIN, ActorRole.FINANCE_HEAD],
    guard: (batch, ctx) => {
      if (ctx.target_retry_state && ctx.target_retry_state !== PaymentBatchState.DRAFT && ctx.target_retry_state !== PaymentBatchState.VALIDATING) {
        throw new PreconditionFailedError(`Invalid target_retry_state: ${ctx.target_retry_state}. Must be DRAFT or VALIDATING.`, ctx);
      }
    },
  },
];

/**
 * In-Memory & Database-Ready Immutable Transition History Subcollection Repository
 */
export class BatchTransitionHistoryRepository {
  constructor() {
    this.historyStore = new Map(); // batch_id -> Array of immutable records
  }

  /**
   * Appends an immutable audit record to the subcollection
   */
  async append(record) {
    const batchId = record.batch_id;
    if (!this.historyStore.has(batchId)) {
      this.historyStore.set(batchId, []);
    }

    const currentRecords = this.historyStore.get(batchId);
    const sequenceNumber = currentRecords.length + 1;

    const immutableEntry = Object.freeze({
      transition_id: record.transition_id || `TRN-${crypto.randomUUID()}`,
      batch_id: batchId,
      from_state: record.from_state,
      to_state: record.to_state,
      event: record.event,
      actor_id: record.actor_id,
      actor_role: record.actor_role,
      timestamp: record.timestamp || new Date().toISOString(),
      sequence_number: sequenceNumber,
      metadata: Object.freeze(JSON.parse(JSON.stringify(record.metadata || {}))),
    });

    currentRecords.push(immutableEntry);
    return JSON.parse(JSON.stringify(immutableEntry));
  }

  /**
   * Retrieves full chronological immutable transition history for a batch
   */
  async getHistory(batchId) {
    const list = this.historyStore.get(batchId) || [];
    return JSON.parse(JSON.stringify(list));
  }

  /**
   * Counts total transition events recorded for a batch
   */
  async count(batchId) {
    const list = this.historyStore.get(batchId) || [];
    return list.length;
  }
}

/**
 * In-Memory & Database-Ready Payment Batch Entity Repository
 */
export class PaymentBatchEntityRepository {
  constructor() {
    this.batches = new Map();
  }

  async save(batch) {
    const cloned = JSON.parse(JSON.stringify(batch));
    this.batches.set(batch.batch_id, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  async findById(batchId) {
    const b = this.batches.get(batchId);
    return b ? JSON.parse(JSON.stringify(b)) : null;
  }

  async list() {
    return Array.from(this.batches.values()).map((b) => JSON.parse(JSON.stringify(b)));
  }
}

/**
 * Dedicated Transition Runner for PaymentBatch Entities
 */
export class PaymentBatchTransitionRunner {
  constructor({
    batchRepository = new PaymentBatchEntityRepository(),
    historyRepository = new BatchTransitionHistoryRepository(),
  } = {}) {
    this.batchRepo = batchRepository;
    this.historyRepo = historyRepository;
  }

  /**
   * Initializes a brand new payment batch in DRAFT state and records genesis transition
   */
  async createBatch({
    batch_id,
    payroll_run_id,
    batch_name,
    batch_type = 'SALARY',
    maker_id,
    total_amount = 0,
    record_count = 0,
    actor_role = ActorRole.PAYROLL_MAKER,
    metadata = {},
  }) {
    if (!batch_id || !payroll_run_id || !batch_name || !maker_id) {
      throw new PreconditionFailedError('Missing mandatory batch initialization fields (batch_id, payroll_run_id, batch_name, maker_id)');
    }

    const now = new Date().toISOString();
    const batch = {
      batch_id,
      payroll_run_id,
      batch_name,
      batch_type,
      status: PaymentBatchState.DRAFT,
      maker_id,
      checker_id: null,
      total_amount: Number(total_amount),
      record_count: Number(record_count),
      retry_count: 0,
      checksum: null,
      file_url: null,
      created_at: now,
      updated_at: now,
      version: 1,
    };

    await this.batchRepo.save(batch);

    // Record Genesis Transition in Immutable History
    const genesisRecord = await this.historyRepo.append({
      batch_id,
      from_state: null,
      to_state: PaymentBatchState.DRAFT,
      event: 'INITIALIZE_BATCH',
      actor_id: maker_id,
      actor_role,
      timestamp: now,
      metadata: {
        genesis: true,
        batch_name,
        batch_type,
        total_amount,
        record_count,
        ...metadata,
      },
    });

    return { batch, transition_record: genesisRecord };
  }

  /**
   * Primary Transition Execution Engine
   * Enforces legal transitions, role permissions, preconditions, and records immutable history.
   */
  async transition(batchId, event, context = {}) {
    const {
      actor_id,
      actor_role,
      reason = '',
      metadata = {},
      target_retry_state = null,
    } = context;

    if (!actor_id || !actor_role) {
      throw new UnauthorizedTransitionError('Transition execution requires both actor_id and actor_role', actor_id, actor_role);
    }

    const batch = await this.batchRepo.findById(batchId);
    if (!batch) {
      throw new Error(`PaymentBatch with ID '${batchId}' does not exist.`);
    }

    const fromState = batch.status;

    // Locate legal rule in TRANSITION_TABLE
    const rule = TRANSITION_TABLE.find(
      (r) => r.from === fromState && r.event === event
    );

    if (!rule) {
      throw new IllegalStateTransitionError(
        `Illegal State Transition: Cannot fire event '${event}' on batch '${batchId}' currently in state '${fromState}'. Illegal step skip or invalid event.`,
        fromState,
        event
      );
    }

    // Role-based Authorization Gate
    if (rule.allowedRoles && !rule.allowedRoles.includes(actor_role)) {
      throw new UnauthorizedTransitionError(
        `Actor '${actor_id}' with role '${actor_role}' is not authorized to execute event '${event}' on state '${fromState}'. Required roles: [${rule.allowedRoles.join(', ')}]`,
        actor_id,
        actor_role,
        rule.allowedRoles
      );
    }

    // Determine target state (supports dynamic retry target if configured)
    let toState = rule.to;
    if (event === BatchTransitionEvent.REOPENED_FOR_RETRY && target_retry_state) {
      toState = target_retry_state;
    }

    // Precondition Guard Execution
    if (typeof rule.guard === 'function') {
      rule.guard(batch, { actor_id, actor_role, reason, metadata, target_retry_state });
    }

    // State Mutation & Metadata Updates
    const timestamp = new Date().toISOString();
    batch.status = toState;
    batch.updated_at = timestamp;
    batch.version = (batch.version || 1) + 1;

    if (event === BatchTransitionEvent.APPROVE_BATCH) {
      batch.checker_id = actor_id;
    }

    if (event === BatchTransitionEvent.GENERATE_FILE && metadata.checksum) {
      batch.checksum = metadata.checksum;
      if (metadata.file_url) batch.file_url = metadata.file_url;
    }

    if (event === BatchTransitionEvent.REOPENED_FOR_RETRY) {
      batch.retry_count = (batch.retry_count || 0) + 1;
    }

    // Save Updated Batch Entity
    await this.batchRepo.save(batch);

    // Append Immutable Audit History Record
    const transitionRecord = await this.historyRepo.append({
      batch_id: batchId,
      from_state: fromState,
      to_state: toState,
      event,
      actor_id,
      actor_role,
      timestamp,
      metadata: {
        reason,
        version: batch.version,
        retry_count: batch.retry_count,
        ...metadata,
      },
    });

    return {
      batch,
      transition_record: transitionRecord,
    };
  }

  // ── EXPRESSIVE LIFECYCLE SHORTCUT METHODS ──

  async startValidation(batchId, { actor_id, actor_role = ActorRole.PAYROLL_MAKER, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.START_VALIDATION, {
      actor_id,
      actor_role,
      metadata,
    });
  }

  async markValidationPassed(batchId, { actor_id = 'VALIDATION_ENGINE', actor_role = ActorRole.SYSTEM_SERVICE, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.VALIDATION_PASSED, {
      actor_id,
      actor_role,
      metadata: { blocking_issues_count: 0, ...metadata },
    });
  }

  async markValidationFailed(batchId, { actor_id = 'VALIDATION_ENGINE', actor_role = ActorRole.SYSTEM_SERVICE, reason, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.VALIDATION_FAILED, {
      actor_id,
      actor_role,
      reason,
      metadata,
    });
  }

  async submitForApproval(batchId, { actor_id, actor_role = ActorRole.PAYROLL_MAKER, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.SUBMIT_FOR_APPROVAL, {
      actor_id,
      actor_role,
      metadata,
    });
  }

  async approveBatch(batchId, { checker_id, actor_role = ActorRole.PAYROLL_CHECKER, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.APPROVE_BATCH, {
      actor_id: checker_id,
      actor_role,
      metadata,
    });
  }

  async rejectBatch(batchId, { checker_id, actor_role = ActorRole.PAYROLL_CHECKER, reason, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.REJECT_BATCH, {
      actor_id: checker_id,
      actor_role,
      reason,
      metadata,
    });
  }

  async generateFile(batchId, { actor_id, checksum, file_url, actor_role = ActorRole.PAYROLL_MAKER, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.GENERATE_FILE, {
      actor_id,
      actor_role,
      metadata: { checksum, file_url, ...metadata },
    });
  }

  async transmitToBank(batchId, { actor_id, actor_role = ActorRole.PAYROLL_CHECKER, channel = 'HDFC_CORPORATE_NETBANKING', metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.TRANSMIT_TO_BANK, {
      actor_id,
      actor_role,
      metadata: { transmission_channel: channel, ...metadata },
    });
  }

  async startReconciliation(batchId, { actor_id = 'BANK_FEED_GATEWAY', actor_role = ActorRole.BANK_INTEGRATION_GATEWAY, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.START_RECONCILIATION, {
      actor_id,
      actor_role,
      metadata,
    });
  }

  async markPaid(batchId, { actor_id = 'RECONCILIATION_ENGINE', actor_role = ActorRole.SYSTEM_SERVICE, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.SETTLEMENT_COMPLETED, {
      actor_id,
      actor_role,
      metadata,
    });
  }

  async markFailed(batchId, { actor_id = 'RECONCILIATION_ENGINE', actor_role = ActorRole.SYSTEM_SERVICE, reason, metadata = {} }) {
    return this.transition(batchId, BatchTransitionEvent.RECONCILIATION_FAILED, {
      actor_id,
      actor_role,
      reason,
      metadata,
    });
  }

  /**
   * Enforced Retry / Re-open Rule:
   * Transitions a FAILED batch back to DRAFT or VALIDATING by creating a new auditable
   * REOPENED_FOR_RETRY transition record without overwriting past history.
   */
  async reopenForRetry(batchId, {
    actor_id,
    actor_role = ActorRole.PAYROLL_MAKER,
    target_state = PaymentBatchState.DRAFT,
    reason = 'Batch failure resolved for reprocessing',
    remediated_issues = [],
    metadata = {},
  }) {
    return this.transition(batchId, BatchTransitionEvent.REOPENED_FOR_RETRY, {
      actor_id,
      actor_role,
      reason,
      target_retry_state: target_state,
      metadata: {
        remediation_reason: reason,
        remediated_issues,
        ...metadata,
      },
    });
  }

  /**
   * Fetches the entire immutable audit trail from the subcollection
   */
  async getTransitionHistory(batchId) {
    return this.historyRepo.getHistory(batchId);
  }
}
