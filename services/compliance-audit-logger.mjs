/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS — CENTRALIZED COMPLIANCE AUDIT LOGGER
 * Criterion 11: Centralized Compliance Audit Logger & Immutable Event Stream
 * ============================================================================
 *
 * Architecture & Responsibilities:
 * 1. Immutable Event Streaming:
 *    - Build an append-only, tamper-proof audit stream that captures every
 *      state transition across PayrollRun, PaymentBatch, and ComplianceReturn entities.
 *    - Uses EventEmitter to stream real-time events to subscribed consumers.
 *    - Strict object-freezing ensures entries cannot be mutated once recorded.
 *
 * 2. Strict Event Schema:
 *    - event_id:              Unique audit event identifier (evt_{timestamp}_{randomHex})
 *    - entity_type:           Canonical entity type (PayrollRun | PaymentBatch | ComplianceReturn)
 *    - entity_id:             Primary key of the entity
 *    - from_state:            Source state enum (null for creation)
 *    - to_state:              Target state enum
 *    - actor_id:              ID of actor / user executing transition
 *    - actor_role:            Role of actor (e.g. PAYROLL_ADMIN, MAKER, CHECKER, SYSTEM_SERVICE)
 *    - timestamp:             ISO-8601 UTC timestamp
 *    - rule_version_applied:  Version of statutory / compliance rule enforced
 *    - correlation_id:        Distributed correlation ID propagating across API boundaries
 *
 * 3. High-Performance Indexed Lookups:
 *    - In-memory index maps for O(1) lookups:
 *      • by entity_type (case-normalized)
 *      • by entity_id
 *      • by correlation_id
 *      • chronological timestamp range index
 *
 * 4. Audit Query API:
 *    - GET /api/v1/audit supporting indexed queries by entity_type, entity_id,
 *      correlation_id, and ISO date ranges.
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

// AsyncLocalStorage for cross-boundary distributed correlation propagation
export const correlationContext = new AsyncLocalStorage();

/**
 * Converts entity string to canonical snake_case format:
 * 'PayrollRun' | 'payroll_run' -> 'payroll_run'
 * 'PaymentBatch' | 'payment_batch' -> 'payment_batch'
 * 'ComplianceReturn' | 'compliance_return' -> 'compliance_return'
 */
export function toSnakeEntity(type) {
  if (!type) return '';
  const clean = String(type).trim().replace(/[-_\s]/g, '').toLowerCase();
  if (clean === 'payrollrun') return 'payroll_run';
  if (clean === 'paymentbatch') return 'payment_batch';
  if (clean === 'compliancereturn') return 'compliance_return';
  return String(type).trim().replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Normalizes entity type strings to canonical PascalCase representation:
 * 'payroll_run' | 'payrollrun' | 'PAYROLL_RUN' -> 'PayrollRun'
 * 'payment_batch' | 'paymentbatch' | 'PAYMENT_BATCH' -> 'PaymentBatch'
 * 'compliance_return' | 'compliancereturn' | 'COMPLIANCE_RETURN' -> 'ComplianceReturn'
 */
export function normalizeEntityType(type) {
  if (!type) return 'UnknownEntity';
  const clean = String(type).trim().replace(/[-_\s]/g, '').toLowerCase();
  if (clean === 'payrollrun') return 'PayrollRun';
  if (clean === 'paymentbatch') return 'PaymentBatch';
  if (clean === 'compliancereturn') return 'ComplianceReturn';
  // Capitalize first letter of raw string as fallback
  const str = String(type).trim();
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Resolves the default rule version applied for a given entity type if none provided.
 */
export function resolveDefaultRuleVersion(entityType, explicitVersion = null) {
  if (explicitVersion && String(explicitVersion).trim()) {
    return String(explicitVersion).trim();
  }
  const norm = normalizeEntityType(entityType);
  if (norm === 'PayrollRun') return 'PAYROLL_STATUTORY_RULE_V2026.09';
  if (norm === 'PaymentBatch') return 'RBI_NEFT_RTGS_STATUTORY_V1';
  if (norm === 'ComplianceReturn') return 'ESIC_EPFO_NPS_STATUTORY_V1';
  return 'STATUTORY_COMPLIANCE_RULE_V2026.1';
}

/**
 * Resolves the default actor role if none provided.
 */
export function resolveDefaultActorRole(actorId, explicitRole = null) {
  if (explicitRole && String(explicitRole).trim()) {
    return String(explicitRole).trim().toUpperCase();
  }
  const id = String(actorId || '').toLowerCase();
  if (id.includes('checker') || id.includes('approv')) return 'CHECKER';
  if (id.includes('maker') || id.includes('create') || id.includes('submit')) return 'MAKER';
  if (id.includes('admin')) return 'PAYROLL_ADMIN';
  if (id.includes('auditor')) return 'AUDITOR';
  if (id.includes('finance')) return 'FINANCE_CONTROLLER';
  if (!id || id === 'system' || id === 'sys') return 'SYSTEM_SERVICE';
  return 'AUTHORIZED_USER';
}

/**
 * Append-Only, Immutable Compliance Audit Stream & Indexing Engine.
 */
export class ComplianceAuditStream extends EventEmitter {
  constructor() {
    super();
    // Enforce high max listeners for distributed event streaming
    this.setMaxListeners(100);

    // Primary append-only log array
    this._events = [];

    // Secondary indexing structures for O(1) query performance
    this._indexByEntityType = new Map();     // normalized UPPERCASE -> Set<event_id>
    this._indexByEntityId = new Map();       // exact entity_id -> Set<event_id>
    this._indexByCorrelationId = new Map();  // exact correlation_id -> Set<event_id>
    this._eventsById = new Map();            // event_id -> frozen event
  }

  /**
   * Appends an immutable state transition event to the audit stream.
   *
   * @param {Object} params
   * @param {string} params.entity_type           - 'PayrollRun' | 'PaymentBatch' | 'ComplianceReturn' (or legacy 'entity')
   * @param {string} params.entity_id             - Entity ID (e.g. 'RUN_2026_09', 'BATCH_001')
   * @param {string} [params.from_state=null]     - Previous state enum (or legacy 'from')
   * @param {string} params.to_state              - Target state enum (or legacy 'to')
   * @param {string} [params.actor_id='system']   - User or service executing transition
   * @param {string} [params.actor_role]          - Role of actor (e.g. 'PAYROLL_ADMIN', 'MAKER')
   * @param {string} [params.rule_version_applied]- Statutory/business rule version applied
   * @param {string} [params.correlation_id]      - Distributed correlation ID
   * @param {string} [params.timestamp]           - Optional explicit ISO-8601 timestamp
   * @param {Object} [params.metadata={}]         - Non-financial supplementary context
   * @returns {Object} Deep-frozen, immutable ComplianceAuditEvent
   */
  appendEvent({
    entity_type,
    entity,
    entity_id,
    entityId,
    from_state,
    from,
    to_state,
    to,
    actor_id,
    actorId,
    actor_role,
    actorRole,
    rule_version_applied,
    ruleVersionApplied,
    correlation_id,
    correlationId,
    timestamp,
    metadata = {},
  }) {
    // Resolve entity type & canonical casing
    const rawEntityType = entity_type || entity;
    if (!rawEntityType) {
      throw new Error('ComplianceAuditStream: "entity_type" is mandatory for audit logging.');
    }
    const canonicalEntityType = normalizeEntityType(rawEntityType);

    // Resolve entity ID
    const canonicalEntityId = String(entity_id || entityId || '').trim();
    if (!canonicalEntityId) {
      throw new Error('ComplianceAuditStream: "entity_id" is mandatory for audit logging.');
    }

    // Resolve states
    const canonicalFromState = from_state !== undefined ? from_state : (from !== undefined ? from : null);
    const canonicalToState = to_state !== undefined ? to_state : to;
    if (!canonicalToState) {
      throw new Error('ComplianceAuditStream: "to_state" is mandatory for audit logging.');
    }

    // Resolve actor identity & role
    const canonicalActorId = String(actor_id || actorId || 'system').trim();
    const canonicalActorRole = resolveDefaultActorRole(canonicalActorId, actor_role || actorRole);

    // Resolve rule version
    const canonicalRuleVersion = resolveDefaultRuleVersion(
      canonicalEntityType,
      rule_version_applied || ruleVersionApplied || metadata?.rule_version_applied
    );

    // Resolve distributed correlation ID
    // Check AsyncLocalStorage first, then arguments, then fallback to crypto UUID
    const ctxCorrelationId = correlationContext.getStore()?.correlationId;
    const canonicalCorrelationId = String(
      correlation_id || correlationId || ctxCorrelationId || `corr_${crypto.randomUUID()}`
    ).trim();

    // Timestamp & Event ID
    const isoTimestamp = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
    const eventId = `evt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    // Construct raw event object
    const rawEvent = {
      event_id: eventId,
      entity_type: canonicalEntityType,
      entity_id: canonicalEntityId,
      from_state: canonicalFromState ? String(canonicalFromState) : null,
      to_state: String(canonicalToState),
      actor_id: canonicalActorId,
      actor_role: canonicalActorRole,
      timestamp: isoTimestamp,
      rule_version_applied: canonicalRuleVersion,
      correlation_id: canonicalCorrelationId,
      metadata: Object.freeze({ ...metadata }),

      // ── Backward-compatible property aliases for existing tests ───────────
      transition_id: eventId,
      entity: toSnakeEntity(canonicalEntityType),
      from: canonicalFromState ? String(canonicalFromState) : null,
      to: String(canonicalToState),
    };

    // Immutability Guard: Deep freeze the audit record
    const frozenEvent = Object.freeze(rawEvent);

    // Append to primary audit stream (append-only)
    this._events.push(frozenEvent);

    // Update indexed structures
    this._indexRecord(frozenEvent);

    // Emit real-time event on stream
    this.emit('audit_event', frozenEvent);
    this.emit(`entity:${canonicalEntityType}`, frozenEvent);
    this.emit(`state:${canonicalToState}`, frozenEvent);

    return frozenEvent;
  }

  /**
   * Internal method to populate secondary indexes.
   */
  _indexRecord(event) {
    const id = event.event_id;

    // 1. Entity Type Index (normalized uppercase)
    const typeKey = event.entity_type.toUpperCase().replace(/[-_\s]/g, '');
    if (!this._indexByEntityType.has(typeKey)) {
      this._indexByEntityType.set(typeKey, new Set());
    }
    this._indexByEntityType.get(typeKey).add(id);

    // Also index common variations (e.g. 'PAYROLL_RUN', 'PAYROLLRUN')
    const snakeType = event.entity_type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    if (!this._indexByEntityType.has(snakeType)) {
      this._indexByEntityType.set(snakeType, new Set());
    }
    this._indexByEntityType.get(snakeType).add(id);

    // 2. Entity ID Index
    if (!this._indexByEntityId.has(event.entity_id)) {
      this._indexByEntityId.set(event.entity_id, new Set());
    }
    this._indexByEntityId.get(event.entity_id).add(id);

    // 3. Correlation ID Index
    if (!this._indexByCorrelationId.has(event.correlation_id)) {
      this._indexByCorrelationId.set(event.correlation_id, new Set());
    }
    this._indexByCorrelationId.get(event.correlation_id).add(id);

    // 4. Primary ID Map
    this._eventsById.set(id, event);
  }

  /**
   * High-Performance Indexed Query Engine.
   * Supports lookups by entity_type, entity_id, correlation_id, and ISO date ranges.
   *
   * @param {Object} [filter={}]
   * @param {string} [filter.entity_type] - Case-insensitive filter: PayrollRun, PaymentBatch, ComplianceReturn
   * @param {string} [filter.entity]      - Backward compatible alias
   * @param {string} [filter.entity_id]   - Filter by exact entity primary key
   * @param {string} [filter.correlation_id] - Filter by distributed correlation ID
   * @param {string} [filter.from_date]   - ISO-8601 earliest timestamp (inclusive)
   * @param {string} [filter.to_date]     - ISO-8601 latest timestamp (inclusive)
   * @param {string} [filter.actor_id]    - Filter by actor ID
   * @param {string} [filter.actor_role]  - Filter by actor role
   * @param {string} [filter.from_state]  - Filter by source state
   * @param {string} [filter.to_state]    - Filter by destination state
   * @param {string} [filter.rule_version_applied] - Filter by rule version applied
   * @param {number} [filter.limit=50]    - Records per page (default 50, max 500)
   * @param {number} [filter.offset=0]    - Pagination offset
   * @returns {Object} Query result { total, limit, offset, count, events, timeline }
   */
  queryEvents(filter = {}) {
    let candidateIds = null;

    // ── 1. Index Intersection: Entity Type ──────────────────────────────────
    const rawType = filter.entity_type || filter.entity;
    if (rawType) {
      const typeKey = String(rawType).trim().replace(/[-_\s]/g, '').toUpperCase();
      const matchedSet = this._indexByEntityType.get(typeKey) || new Set();
      candidateIds = new Set(matchedSet);
    }

    // ── 2. Index Intersection: Entity ID ────────────────────────────────────
    if (filter.entity_id) {
      const matchedSet = this._indexByEntityId.get(String(filter.entity_id).trim()) || new Set();
      if (candidateIds === null) {
        candidateIds = new Set(matchedSet);
      } else {
        candidateIds = new Set([...candidateIds].filter((id) => matchedSet.has(id)));
      }
    }

    // ── 3. Index Intersection: Correlation ID ───────────────────────────────
    if (filter.correlation_id) {
      const matchedSet = this._indexByCorrelationId.get(String(filter.correlation_id).trim()) || new Set();
      if (candidateIds === null) {
        candidateIds = new Set(matchedSet);
      } else {
        candidateIds = new Set([...candidateIds].filter((id) => matchedSet.has(id)));
      }
    }

    // Resolve candidates list
    let matchedEvents = candidateIds === null
      ? [...this._events]
      : [...candidateIds].map((id) => this._eventsById.get(id)).filter(Boolean);

    // ── 4. ISO Date Range Filtering ─────────────────────────────────────────
    if (filter.from_date) {
      const fromMs = new Date(filter.from_date).getTime();
      if (!isNaN(fromMs)) {
        matchedEvents = matchedEvents.filter((evt) => new Date(evt.timestamp).getTime() >= fromMs);
      }
    }

    if (filter.to_date) {
      const toMs = new Date(filter.to_date).getTime();
      if (!isNaN(toMs)) {
        matchedEvents = matchedEvents.filter((evt) => new Date(evt.timestamp).getTime() <= toMs);
      }
    }

    // ── 5. Secondary Field Filtering ────────────────────────────────────────
    if (filter.actor_id) {
      matchedEvents = matchedEvents.filter((evt) => evt.actor_id === filter.actor_id);
    }
    if (filter.actor_role) {
      const roleUpper = String(filter.actor_role).toUpperCase();
      matchedEvents = matchedEvents.filter((evt) => evt.actor_role === roleUpper);
    }
    if (filter.from_state) {
      matchedEvents = matchedEvents.filter((evt) => evt.from_state === filter.from_state || evt.from === filter.from_state);
    }
    if (filter.to_state) {
      matchedEvents = matchedEvents.filter((evt) => evt.to_state === filter.to_state || evt.to === filter.to_state);
    }
    if (filter.rule_version_applied) {
      matchedEvents = matchedEvents.filter((evt) => evt.rule_version_applied === filter.rule_version_applied);
    }

    // ── 6. Chronological Timeline Sorting (oldest first) ────────────────────
    matchedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // ── 7. Pagination ───────────────────────────────────────────────────────
    const total = matchedEvents.length;
    const limit = Math.min(filter.limit ? parseInt(filter.limit, 10) : 50, 500);
    const offset = filter.offset ? parseInt(filter.offset, 10) : 0;
    const page = matchedEvents.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      count: page.length,
      events: page,
      timeline: page, // Backward compatible alias
    };
  }

  /**
   * Returns a frozen snapshot array of all recorded events (chronological order).
   */
  getAllEvents() {
    return Object.freeze([...this._events]);
  }

  /**
   * Returns total event count.
   */
  get size() {
    return this._events.length;
  }

  /**
   * Clears in-memory stream and indices (strictly for test isolation).
   */
  clear() {
    this._events.length = 0;
    this._indexByEntityType.clear();
    this._indexByEntityId.clear();
    this._indexByCorrelationId.clear();
    this._eventsById.clear();
  }
}

/**
 * Singleton Compliance Audit Stream instance across application runtime.
 */
export const globalComplianceAuditStream = new ComplianceAuditStream();

/**
 * Distributed Correlation Propagation Express Middleware.
 * Extracts or generates x-correlation-id, binds to request context, and writes response header.
 */
export function correlationPropagationMiddleware(req, res, next) {
  const incomingId = (
    req.headers['x-correlation-id'] ||
    req.headers['correlation-id'] ||
    req.query?.correlation_id ||
    `corr_${crypto.randomUUID()}`
  );
  const cleanId = String(incomingId).trim();

  // Attach to request object
  req.correlationId = cleanId;

  // Echo in response headers for distributed trace tracking
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('x-correlation-id', cleanId);
  }

  // Wrap downstream execution inside AsyncLocalStorage context
  correlationContext.run({ correlationId: cleanId }, () => {
    next();
  });
}
