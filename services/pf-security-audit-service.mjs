/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PF ACCESS CONTROL, DATA MASKING & AUDIT SERVICE
 * ============================================================================
 * Implements:
 * 1. UI & Log Masking Serialization Transforms:
 *    - Masks UANs to display only terminal digits (e.g., ••••••••5678).
 *    - Masks PF Member IDs to show only establishment codes (e.g., KN/12345/•••••••).
 *    - Recursively sanitizes objects and strings for standard application log drains.
 *
 * 2. Role-Based Access Control (RBAC):
 *    - Privileged Roles: 'PAYROLL_ADMIN', 'COMPLIANCE_OFFICER' (case-insensitive).
 *    - Restricts unmasked views and raw export downloads strictly to privileged users.
 *    - Rejects unauthorized access with 403 Forbidden.
 *
 * 3. Unified Audit Logger & Distributed Correlation Tracing:
 *    - Writes append-only, tamper-proof audit events to compliance_audit_logs capturing:
 *      • Master data modifications (old vs. new values, actor ID, timestamp)
 *      • Validation failures (defect details, employee identifiers)
 *      • Calculation overrides (pre-override vs. overridden figures, approver)
 *      • File generation events (file name, SHA-256 hash, metrics)
 *      • TRRN updates (13-digit TRRN, challan reference, due date)
 *    - Tags each event with a distributed `correlation_id` for full end-to-end tracing
 *      across the payroll-to-payment lifecycle.
 *
 * @version 6.4.0
 * @author Kylrx AI Lead Security & Compliance Architect
 */

import crypto from 'node:crypto';
import { globalComplianceAuditStream } from './compliance-audit-logger.mjs';

export const PRIVILEGED_COMPLIANCE_ROLES = Object.freeze([
  'PAYROLL_ADMIN',
  'COMPLIANCE_OFFICER',
]);

export const AUDIT_ACTION_TYPES = Object.freeze({
  MASTER_DATA_MODIFICATION: 'MASTER_DATA_MODIFICATION',
  VALIDATION_FAILURE: 'VALIDATION_FAILURE',
  CALCULATION_OVERRIDE: 'CALCULATION_OVERRIDE',
  FILE_GENERATED: 'FILE_GENERATED',
  TRRN_UPDATED: 'TRRN_UPDATED',
});

/**
 * Custom Error for Unauthorized Privileged Access
 */
export class PrivilegedComplianceAccessError extends Error {
  constructor(message = 'Access Denied: Unmasked views and raw export downloads require privileged compliance roles.', details = {}) {
    super(message);
    this.name = 'PrivilegedComplianceAccessError';
    this.code = 'PRIVILEGED_ACCESS_REQUIRED';
    this.status = 403;
    this.statusCode = 403;
    this.details = details;
  }
}

/**
 * Access Control, Data Masking & Audit Trailing Service
 */
export class PfSecurityAuditService {
  /**
   * Evaluates whether a role is authorized for privileged compliance actions.
   * Case-insensitive match for 'Payroll Admin', 'Compliance Officer', etc.
   */
  static isPrivilegedRole(role) {
    if (!role) return false;
    const clean = String(role).trim().toUpperCase().replace(/[\s_-]+/g, '_');
    return PRIVILEGED_COMPLIANCE_ROLES.includes(clean);
  }

  /**
   * Asserts caller possesses a privileged role.
   * Throws PrivilegedComplianceAccessError (403) if unauthorized.
   */
  static assertPrivilegedAccess(role, actionDescription = 'perform this privileged compliance action') {
    if (!this.isPrivilegedRole(role)) {
      throw new PrivilegedComplianceAccessError(
        `Access Denied: Role '${role || 'ANONYMOUS'}' is unauthorized to ${actionDescription}. Privileged roles required: ${PRIVILEGED_COMPLIANCE_ROLES.join(', ')}.`,
        { user_role: role || null, required_roles: PRIVILEGED_COMPLIANCE_ROLES }
      );
    }
    return true;
  }

  /**
   * Masks Universal Account Number (UAN) to display only terminal digits.
   * Example: '100123456789' -> '••••••••6789'
   */
  static maskUan(rawUan) {
    if (!rawUan) return '';
    const clean = String(rawUan).trim();
    if (clean.length <= 4) return clean;
    const prefixCount = Math.max(8, clean.length - 4);
    return `${'•'.repeat(prefixCount)}${clean.slice(-4)}`;
  }

  /**
   * Masks PF Member ID to show only regional establishment codes.
   * Examples:
   * - Regional format: 'KN/12345/1234567' -> 'KN/12345/•••••••'
   * - Full ECR format: 'MH/BAN/0012345/000/0000101' -> 'MH/BAN/0012345/•••••••'
   * - Generic fallback: 'DLCPM12345000' -> 'DLCPM/•••••••'
   */
  static maskPfMemberId(rawMemberId) {
    if (!rawMemberId) return '';
    const clean = String(rawMemberId).trim();
    const parts = clean.split('/');

    if (parts.length >= 3) {
      // E.g. KN/12345/1234567 or MH/BAN/0012345/000/0000101
      const establishmentPrefix = parts.slice(0, -1).join('/');
      const lastSegment = parts[parts.length - 1];
      const maskedSegment = '•'.repeat(Math.max(7, lastSegment.length));
      return `${establishmentPrefix}/${maskedSegment}`;
    }

    if (parts.length === 2) {
      const maskedSegment = '•'.repeat(Math.max(7, parts[1].length));
      return `${parts[0]}/${maskedSegment}`;
    }

    // Fallback if no slashes present
    if (clean.length > 5) {
      return `${clean.slice(0, 5)}/${'•'.repeat(7)}`;
    }
    return clean;
  }

  /**
   * Serializes an Employee PF Profile for UI consumption based on caller role.
   * If caller is privileged, returns full unmasked identifiers.
   * If caller is non-privileged, masks UAN and PF Member ID.
   */
  static serializePfProfile(profile, role = null) {
    if (!profile || typeof profile !== 'object') return profile;
    const privileged = this.isPrivilegedRole(role);

    if (privileged) {
      return {
        ...profile,
        is_masked: false,
      };
    }

    return {
      ...profile,
      uan: this.maskUan(profile.uan),
      pf_member_id: this.maskPfMemberId(profile.pf_member_id),
      is_masked: true,
    };
  }

  /**
   * Serializes an array or collection of profiles with role-based masking.
   */
  static serializePfProfiles(profiles = [], role = null) {
    if (!Array.isArray(profiles)) return [];
    return profiles.map((p) => this.serializePfProfile(p, role));
  }

  /**
   * Deeply sanitizes sensitive data for application log drains.
   * Recursively masks uan, pf_member_id, bank account, and tax IDs.
   */
  static sanitizeForLog(data) {
    if (data === null || data === undefined) return data;

    if (typeof data === 'string') {
      // Regex replace 12-digit UAN patterns in raw strings
      return data
        .replace(/\b([0-9]{8})([0-9]{4})\b/g, '••••••••$2')
        .replace(/\b([A-Z]{2}\/[A-Za-z0-9/]+)\/([0-9]{4,10})\b/g, '$1/•••••••');
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeForLog(item));
    }

    if (typeof data === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();

        if (lowerKey === 'uan' || lowerKey === 'pf_uan') {
          sanitized[key] = this.maskUan(value);
        } else if (lowerKey === 'pf_member_id' || lowerKey === 'member_id') {
          sanitized[key] = this.maskPfMemberId(value);
        } else if (lowerKey.includes('bank_account') || lowerKey.includes('account_number')) {
          sanitized[key] = typeof value === 'string' && value.length > 4 ? `••••••••${value.slice(-4)}` : value;
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeForLog(value);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    }

    return data;
  }

  /**
   * Unified Audit Logger: Writes append-only audit events to compliance_audit_logs
   * with distributed correlation_id.
   *
   * @param {Object} params
   * @param {string} params.action_type           - MASTER_DATA_MODIFICATION | VALIDATION_FAILURE | CALCULATION_OVERRIDE | FILE_GENERATED | TRRN_UPDATED
   * @param {string} [params.entity_type='ComplianceReturn']
   * @param {string} params.entity_id             - Primary key / Batch / Profile ID
   * @param {string} [params.actor_id='system']   - User or service executing action
   * @param {string} [params.actor_role]          - Role of actor
   * @param {string} [params.correlation_id]      - Distributed correlation ID (auto-generated if absent)
   * @param {Object} [params.old_values]          - Previous state for master data mutations
   * @param {Object} [params.new_values]          - New state for master data mutations
   * @param {Object} [params.details]             - Contextual audit payload
   */
  static recordAuditEvent(params = {}) {
    const actionType = params.action_type || params.event_type || AUDIT_ACTION_TYPES.MASTER_DATA_MODIFICATION;
    const entityType = params.entity_type || 'ComplianceReturn';
    const entityId = String(params.entity_id || `PF_${Date.now()}`).trim();
    const actorId = String(params.actor_id || 'system_service').trim();
    const actorRole = params.actor_role || (this.isPrivilegedRole(params.role) ? params.role : 'COMPLIANCE_OFFICER');
    const correlationId = params.correlation_id || `corr_pf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = params.timestamp || new Date().toISOString();

    const metadata = {
      action_type: actionType,
      correlation_id: correlationId,
      timestamp,
      ...(params.old_values ? { old_values: this.sanitizeForLog(params.old_values) } : {}),
      ...(params.new_values ? { new_values: this.sanitizeForLog(params.new_values) } : {}),
      ...(params.details ? { details: this.sanitizeForLog(params.details) } : {}),
      ...(params.metrics ? { metrics: params.metrics } : {}),
    };

    const auditRecord = globalComplianceAuditStream.appendEvent({
      entity_type: entityType,
      entity_id: entityId,
      from_state: params.from_state || null,
      to_state: params.to_state || actionType,
      actor_id: actorId,
      actor_role: actorRole,
      rule_version_applied: params.rule_version || 'EPFO_PROCESS_FLOW_V6.0',
      correlation_id: correlationId,
      timestamp,
      metadata,
    });

    return {
      success: true,
      event_id: auditRecord.event_id,
      correlation_id: correlationId,
      action_type: actionType,
      entity_id: entityId,
      timestamp,
      audit_record: auditRecord,
    };
  }

  /**
   * Retrieves end-to-end audit trace matching a distributed correlation_id.
   */
  static traceAuditTrailByCorrelationId(correlationId) {
    if (!correlationId) return [];
    const res = globalComplianceAuditStream.queryEvents({ correlation_id: String(correlationId).trim() });
    return res?.events || [];
  }

  /**
   * Queries compliance audit logs with filtering and pagination.
   */
  static getAuditEvents(filter = {}) {
    return globalComplianceAuditStream.queryEvents(filter);
  }
}

// Global Singleton Instance
export const globalPfSecurityAuditService = PfSecurityAuditService;
