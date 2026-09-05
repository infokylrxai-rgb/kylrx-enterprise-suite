/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - AUTHORIZATION, VALIDATION GUARD & SECURITY ENGINE
 * ============================================================================
 * Architecture Layer: Pre-state-change validation gatekeepers, Maker-Checker
 *                     separation of duties, UI payload & log serialization
 *                     masking, and cryptographically signed export jobs.
 *
 * Enforces:
 *   Criteria 2: Validation Gatekeeper (Prevents transition to APPROVED or
 *               FILE_GENERATED when unresolved records with severity === 'BLOCK'
 *               exist; rejects with 422 Unprocessable Entity + blocking_count).
 *   Criteria 3: Maker-Checker Segregation (Compares requesting user ID with
 *               batch's created_by / submitted_by / maker_id; rejects self-
 *               approval with 403 Forbidden and logs an authorization failure).
 *   Criteria 12: Data Masking & Security (Serialization interceptors masking
 *                bank accounts as ••••••••1234, PRAN, and tax IDs across UI
 *                payloads & logs; raw values accessible strictly during
 *                privileged, cryptographically signed export jobs).
 *
 * @version 3.0.0
 * @author Kylrx AI Lead Systems Architect
 */

import crypto from 'node:crypto';

// Default cryptographic signing key for privileged export jobs
const DEFAULT_EXPORT_SIGNING_SECRET = process.env.KYLRX_EXPORT_SIGNING_KEY || 'kylrx-enterprise-hmac-sha256-export-secret-key-2026';

/* ============================================================================
 * 1. CUSTOM ARCHITECTURAL ERROR CLASSES
 * ============================================================================
 */

export class ValidationGatekeeperError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ValidationGatekeeperError';
    this.statusCode = 422;
    this.status = 422;
    this.code = 'UNRESOLVED_BLOCKING_ISSUES';
    this.details = details;
  }
}

export class MakerCheckerViolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MakerCheckerViolationError';
    this.statusCode = 403;
    this.status = 403;
    this.code = 'FORBIDDEN_SELF_APPROVAL';
    this.details = details;
  }
}

export class PrivilegedSecurityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PrivilegedSecurityError';
    this.statusCode = 403;
    this.status = 403;
    this.code = 'PRIVILEGED_EXPORT_UNAUTHORIZED';
    this.details = details;
  }
}

/* ============================================================================
 * 2. CRITERIA 2: PRE-STATE-CHANGE VALIDATION GATEKEEPER
 * ============================================================================
 */

export class ValidationGatekeeper {
  /**
   * Targets requiring zero unresolved BLOCK issues.
   */
  static RESTRICTED_TARGET_STATES = new Set([
    'APPROVED',
    'CHECKER_APPROVED',
    'FILE_GENERATED',
    'BANK_FILE_GENERATED',
  ]);

  /**
   * Evaluates whether a batch has unresolved BLOCK validation issues.
   *
   * @param {Object} params
   * @param {Object} params.batch
   * @param {string} params.targetState
   * @param {Array}  [params.validationIssues=[]]
   * @returns {Object} evaluation summary
   */
  static evaluate({ batch, targetState, validationIssues = [] }) {
    if (!batch) {
      throw new Error('Payment batch is required for validation gatekeeper evaluation.');
    }

    const stateUpper = String(targetState || '').toUpperCase();
    const isRestrictedTarget = ValidationGatekeeper.RESTRICTED_TARGET_STATES.has(stateUpper);

    // Identify unresolved BLOCK / BLOCKING issues
    const unresolvedBlockingIssues = (validationIssues || []).filter((issue) => {
      const isResolved = issue.resolved === true || Boolean(issue.resolved_at);
      const sev = String(issue.severity || '').toUpperCase();
      const isBlocking = sev === 'BLOCK' || sev === 'BLOCKING' || sev === 'ERROR';
      return !isResolved && isBlocking;
    });

    const blockingCount = unresolvedBlockingIssues.length;
    const allowed = !isRestrictedTarget || blockingCount === 0;

    return {
      allowed,
      target_state: stateUpper,
      batch_id: batch.batch_id || batch.id,
      blocking_count: blockingCount,
      unresolved_count: blockingCount,
      blocking_issues: unresolvedBlockingIssues,
      message: allowed
        ? `Batch '${batch.batch_id}' cleared validation gate for transition to '${stateUpper}'.`
        : `Pre-state-change validation blocked: Batch '${batch.batch_id}' cannot transition to '${stateUpper}' because ${blockingCount} unresolved BLOCK issue(s) exist.`,
    };
  }

  /**
   * Enforces that the batch can transition to targetState. Throws 422 if violated.
   *
   * @param {Object} params
   * @throws {ValidationGatekeeperError} 422 Unprocessable Entity
   */
  static assertCanTransition({ batch, targetState, validationIssues = [] }) {
    const evaluation = ValidationGatekeeper.evaluate({ batch, targetState, validationIssues });

    if (!evaluation.allowed) {
      throw new ValidationGatekeeperError(
        evaluation.message,
        {
          batch_id: evaluation.batch_id,
          target_state: evaluation.target_state,
          blocking_count: evaluation.blocking_count,
          unresolved_count: evaluation.unresolved_count,
          blocking_issues: evaluation.blocking_issues,
        }
      );
    }

    return evaluation;
  }

  /**
   * Express middleware interceptor for pre-state-change routes.
   *
   * @param {Object} options
   * @param {string} options.targetState e.g. 'APPROVED' or 'FILE_GENERATED'
   * @param {Function} [options.getBatch] async (req) => batch
   * @param {Function} [options.getIssues] async (req, batch) => issues[]
   */
  static middleware({ targetState, getBatch, getIssues }) {
    return async (req, res, next) => {
      try {
        const batch = getBatch ? await getBatch(req) : req.batch;
        const issues = getIssues ? await getIssues(req, batch) : req.validationIssues || [];
        ValidationGatekeeper.assertCanTransition({
          batch,
          targetState,
          validationIssues: issues,
        });
        next();
      } catch (err) {
        if (err instanceof ValidationGatekeeperError) {
          return res.status(422).json({
            success: false,
            error: {
              code: err.code,
              message: err.message,
              blocking_count: err.details.blocking_count,
              unresolved_count: err.details.unresolved_count,
              details: err.details,
              timestamp: new Date().toISOString(),
            },
          });
        }
        next(err);
      }
    };
  }
}

/* ============================================================================
 * 3. CRITERIA 3: MAKER-CHECKER SEGREGATION (SEPARATION OF DUTIES)
 * ============================================================================
 */

export class MakerCheckerGuard {
  /**
   * Internal audit trail buffer for security & authorization failure events.
   */
  static authorizationFailureEvents = [];

  /**
   * Programmatically asserts separation of duties.
   * Compares requesting user ID against batch's created_by / submitted_by / maker_id.
   * If maker_id === checker_id:
   *   1. Logs an authorization failure event with full forensic metadata.
   *   2. Rejects the approval request with 403 Forbidden.
   *
   * @param {Object} params
   * @param {Object} params.batch
   * @param {string} params.requestingUserId Checker attempting approval
   * @param {Function} [params.auditLogger] Optional external audit logger
   * @throws {MakerCheckerViolationError} 403 Forbidden
   */
  static assertSeparationOfDuties({ batch, requestingUserId, auditLogger = null }) {
    if (!batch) {
      throw new Error('Payment batch is required for Maker-Checker segregation verification.');
    }

    const checkerId = String(requestingUserId || '').trim();
    if (!checkerId) {
      throw new MakerCheckerViolationError('Missing checker identity for approval request.', {
        batch_id: batch.batch_id,
      });
    }

    // Identify maker identities from all potential canonical fields
    const makerId = String(batch.maker_id || '').trim();
    const createdBy = String(batch.created_by || '').trim();
    const submittedBy = String(batch.submitted_by || '').trim();

    const isSelfApproval =
      (makerId && makerId.toLowerCase() === checkerId.toLowerCase()) ||
      (createdBy && createdBy.toLowerCase() === checkerId.toLowerCase()) ||
      (submittedBy && submittedBy.toLowerCase() === checkerId.toLowerCase());

    if (isSelfApproval) {
      const conflictField = (makerId && makerId.toLowerCase() === checkerId.toLowerCase())
        ? 'maker_id'
        : (submittedBy && submittedBy.toLowerCase() === checkerId.toLowerCase())
          ? 'submitted_by'
          : 'created_by';

      const conflictValue = batch[conflictField];

      const failureEvent = Object.freeze({
        event_id: `auth_fail_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        event: 'AUTHORIZATION_FAILURE',
        violation_type: 'MAKER_CHECKER_SELF_APPROVAL_PROHIBITED',
        entity_type: 'PAYMENT_BATCH',
        entity_id: batch.batch_id,
        batch_id: batch.batch_id,
        actor_id: checkerId,
        maker_id: conflictValue,
        checker_id: checkerId,
        conflict_field: conflictField,
        timestamp: new Date().toISOString(),
        message: `Maker-Checker Segregation Violation: User '${checkerId}' is the ${conflictField} of batch '${batch.batch_id}' and cannot approve their own batch.`,
      });

      // 1. Log to internal buffer
      MakerCheckerGuard.authorizationFailureEvents.push(failureEvent);

      // 2. Log to external audit logger if provided
      if (typeof auditLogger === 'function') {
        try {
          auditLogger({
            entityType: 'PAYMENT_BATCH',
            entityId: batch.batch_id,
            event: 'AUTHORIZATION_FAILURE',
            actorId: checkerId,
            actorRole: 'PAYROLL_CHECKER',
            metadata: failureEvent,
          });
        } catch (logErr) {
          // Keep failure logged internally even if external logger throws
          console.error('[MakerCheckerGuard] External audit logger error:', logErr);
        }
      }

      // 3. Reject with 403 Forbidden
      throw new MakerCheckerViolationError(failureEvent.message, {
        batch_id: batch.batch_id,
        maker_id: conflictValue,
        checker_id: checkerId,
        conflict_field: conflictField,
        event_id: failureEvent.event_id,
      });
    }

    return {
      authorized: true,
      batch_id: batch.batch_id,
      checker_id: checkerId,
      maker_id: makerId || createdBy || submittedBy,
      evaluated_at: new Date().toISOString(),
    };
  }

  /**
   * Express middleware for Maker-Checker segregation on approval routes.
   */
  static middleware({ getBatch, getCheckerId, auditLogger }) {
    return async (req, res, next) => {
      try {
        const batch = getBatch ? await getBatch(req) : req.batch;
        const checkerId = getCheckerId
          ? await getCheckerId(req)
          : (req.user?.user_id || req.body?.checker_id || req.headers['x-user-id']);

        MakerCheckerGuard.assertSeparationOfDuties({
          batch,
          requestingUserId: checkerId,
          auditLogger,
        });

        next();
      } catch (err) {
        if (err instanceof MakerCheckerViolationError) {
          return res.status(403).json({
            success: false,
            error: {
              code: err.code,
              message: err.message,
              details: err.details,
              timestamp: new Date().toISOString(),
            },
          });
        }
        next(err);
      }
    };
  }
}

/* ============================================================================
 * 4. CRITERIA 12: DATA MASKING & PRIVILEGED CRYPTOGRAPHIC EXPORT SECURITY
 * ============================================================================
 */

export class DataMaskingService {
  /**
   * Masks a bank account number, displaying only the terminal 4 digits with bullet symbols.
   * Example: '50100456789012' -> '••••••••9012'
   *
   * @param {string} rawAccount
   * @param {string} [maskChar='•']
   * @param {number} [visibleEndChars=4]
   * @returns {string}
   */
  static maskBankAccount(rawAccount, maskChar = '•', visibleEndChars = 4) {
    if (!rawAccount) return '';
    const clean = String(rawAccount).trim();
    if (clean.length <= visibleEndChars) return clean;
    // Standard 8 bullet prefix as requested or dynamic length
    const prefixCount = Math.max(8, clean.length - visibleEndChars);
    return `${maskChar.repeat(prefixCount)}${clean.slice(-visibleEndChars)}`;
  }

  /**
   * Masks Permanent Retirement Account Number (PRAN) (12 digits).
   * Displays only the terminal 4 digits.
   * Example: '110012345678' -> '••••••••5678'
   *
   * @param {string} rawPran
   * @returns {string}
   */
  static maskPran(rawPran) {
    if (!rawPran) return '';
    const clean = String(rawPran).trim();
    if (clean.length <= 4) return clean;
    return `••••••••${clean.slice(-4)}`;
  }

  /**
   * Obscures Permanent Account Number (PAN) / Tax ID.
   * Example: 'ABCDE1234F' -> '•••••1234F' or 'ABCDE••••F'
   * Canonical enterprise display: '•••••1234F'
   *
   * @param {string} rawTaxId
   * @returns {string}
   */
  static maskTaxId(rawTaxId) {
    if (!rawTaxId) return '';
    const clean = String(rawTaxId).trim().toUpperCase();
    if (clean.length <= 4) return clean;
    if (clean.length === 10) {
      // 10-character Indian PAN: 5 letters, 4 numbers, 1 letter
      return `•••••${clean.slice(5)}`;
    }
    // Generic Tax ID
    const prefix = '•'.repeat(Math.max(4, clean.length - 4));
    return `${prefix}${clean.slice(-4)}`;
  }

  /**
   * Masks Aadhaar number (12 digits).
   * Example: '123456789012' -> '••••••••9012'
   */
  static maskAadhaar(rawAadhaar) {
    if (!rawAadhaar) return '';
    const clean = String(rawAadhaar).trim();
    if (clean.length <= 4) return clean;
    return `••••••••${clean.slice(-4)}`;
  }

  /**
   * Masks Universal Account Number (UAN) (12 digits).
   * Example: '100123456789' -> '••••••••6789'
   */
  static maskUan(rawUan) {
    if (!rawUan) return '';
    const clean = String(rawUan).trim();
    if (clean.length <= 4) return clean;
    return `••••••••${clean.slice(-4)}`;
  }

  /**
   * Masks ESIC Insurance Person (IP) Number (10 digits).
   * Example: '3100123456' -> '••••••3456'
   */
  static maskEsicIp(rawIp) {
    if (!rawIp) return '';
    const clean = String(rawIp).trim();
    if (clean.length <= 4) return clean;
    return `••••••${clean.slice(-4)}`;
  }

  /**
   * Masks nominee details for UI presentation.
   * Example: [{ name: 'Priya Kalyan', relation: 'Spouse', share_percentage: 60 }]
   *       -> [{ name: 'P•••• K••••', relation: 'Spouse', share_percentage: 60 }]
   */
  static maskNomineeDetails(nominees = []) {
    if (!nominees) return [];
    if (!Array.isArray(nominees)) {
      if (typeof nominees === 'object') {
        return DataMaskingService.maskSingleNominee(nominees);
      }
      return nominees;
    }
    return nominees.map((n) => DataMaskingService.maskSingleNominee(n));
  }

  static maskSingleNominee(nominee) {
    if (!nominee || typeof nominee !== 'object') return nominee;
    const name = String(nominee.name || nominee.nominee_name || '').trim();
    let maskedName = name;
    if (name) {
      const parts = name.split(/\s+/);
      maskedName = parts.map((part) => {
        if (part.length <= 1) return part;
        return part[0] + '•'.repeat(Math.max(3, part.length - 1));
      }).join(' ');
    }

    return {
      ...DataMaskingService.maskSensitivePayload(nominee),
      name: maskedName,
      nominee_name: maskedName,
    };
  }

  /**
   * Recursively traverses any data structure (objects, arrays, primitives)
   * and masks all sensitive identifiers before UI payload delivery.
   *
   * @param {any} data
   * @returns {any} masked copy
   */
  static maskSensitivePayload(data) {
    if (data === null || data === undefined) return data;

    if (Array.isArray(data)) {
      return data.map((item) => DataMaskingService.maskSensitivePayload(item));
    }

    if (typeof data === 'object') {
      const cloned = {};
      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();

        // 1. Bank Account fields
        if (
          lowerKey === 'account_number' ||
          lowerKey === 'accountnumber' ||
          lowerKey === 'bank_account' ||
          lowerKey === 'bankaccount' ||
          lowerKey === 'debit_account_number' ||
          lowerKey === 'debitaccountnumber' ||
          lowerKey === 'account_no' ||
          lowerKey === 'accountno'
        ) {
          cloned[key] = DataMaskingService.maskBankAccount(value);
          // Preserve or stamp account_number_masked
          cloned.account_number_masked = DataMaskingService.maskBankAccount(value);
          continue;
        }

        // 2. PRAN fields
        if (lowerKey === 'pran' || lowerKey === 'pran_number' || lowerKey === 'prannumber') {
          cloned[key] = DataMaskingService.maskPran(value);
          continue;
        }

        // 3. Tax ID / PAN / TAN fields
        if (
          lowerKey === 'pan' ||
          lowerKey === 'pan_number' ||
          lowerKey === 'pannumber' ||
          lowerKey === 'tax_id' ||
          lowerKey === 'taxid' ||
          lowerKey === 'tan' ||
          lowerKey === 'tan_number'
        ) {
          cloned[key] = DataMaskingService.maskTaxId(value);
          continue;
        }

        // 4. Aadhaar fields
        if (lowerKey === 'aadhaar' || lowerKey === 'aadhaar_number' || lowerKey === 'aadhaarnumber') {
          cloned[key] = DataMaskingService.maskAadhaar(value);
          continue;
        }

        // 5. UAN fields
        if (lowerKey === 'uan' || lowerKey === 'uan_number' || lowerKey === 'uannumber') {
          cloned[key] = DataMaskingService.maskUan(value);
          continue;
        }

        // 6. ESIC IP / Number fields
        if (
          lowerKey === 'esic_ip' ||
          lowerKey === 'esic_ip_number' ||
          lowerKey === 'ip_number' ||
          lowerKey === 'ip_no' ||
          lowerKey === 'esic_number' ||
          lowerKey === 'esic_no' ||
          lowerKey === 'esicno'
        ) {
          cloned[key] = DataMaskingService.maskEsicIp(value);
          continue;
        }

        // 7. Nominee details fields
        if (lowerKey === 'nominee_details' || lowerKey === 'nominees') {
          cloned[key] = DataMaskingService.maskNomineeDetails(value);
          continue;
        }

        // Recurse for nested objects
        cloned[key] = DataMaskingService.maskSensitivePayload(value);
      }
      return cloned;
    }

    return data;
  }

  /**
   * Sanitizes application log outputs, ensuring raw sensitive values never leak
   * into stdout, console logs, or audit metadata.
   *
   * @param {any} messageOrObj
   * @returns {any}
   */
  static maskLogOutput(messageOrObj) {
    if (typeof messageOrObj === 'string') {
      let sanitized = messageOrObj;
      // Mask 9-18 digit account numbers
      sanitized = sanitized.replace(/\b(\d{5,14})(\d{4})\b/g, '••••••••$2');
      // Mask PAN format (5 letters, 4 digits, 1 letter)
      sanitized = sanitized.replace(/\b([A-Z]{5})(\d{4}[A-Z])\b/g, '•••••$2');
      return sanitized;
    }
    return DataMaskingService.maskSensitivePayload(messageOrObj);
  }
}

/* ============================================================================
 * 5. PRIVILEGED CRYPTOGRAPHIC EXPORT SECURITY SERVICE
 * ============================================================================
 */

export class PrivilegedExportSecurityService {
  /**
   * Generates a tamper-proof cryptographically signed export authorization token.
   * Uses HMAC-SHA256 over canonical job parameters.
   *
   * @param {Object} params
   * @param {string} params.exportJobId
   * @param {string} params.batchId
   * @param {string} params.authorizedBy
   * @param {string} [params.authorizedRole='PAYROLL_ADMIN']
   * @param {string} [params.purpose='BANK_CLEARING_FILE']
   * @param {number} [params.ttlSeconds=300] Default 5 minutes
   * @param {string} [params.secret]
   * @returns {Object} signed manifest + token
   */
  static generateExportAuthorizationToken({
    exportJobId = `EXP_JOB_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    batchId,
    authorizedBy,
    authorizedRole = 'PAYROLL_ADMIN',
    purpose = 'BANK_CLEARING_FILE',
    ttlSeconds = 300,
    secret = DEFAULT_EXPORT_SIGNING_SECRET,
  }) {
    if (!batchId || !authorizedBy) {
      throw new Error('batchId and authorizedBy are required to generate export signature.');
    }

    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const payload = {
      export_job_id: exportJobId,
      batch_id: batchId,
      authorized_by: authorizedBy,
      authorized_role: authorizedRole,
      purpose,
      created_at: createdAt,
      expires_at: expiresAt,
    };

    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadJson, 'utf8').toString('base64url');

    const signature = crypto
      .createHmac('sha256', secret)
      .update(payloadBase64, 'utf8')
      .digest('hex');

    const token = `KYLRX_EXP_SIG.${payloadBase64}.${signature}`;

    return {
      token,
      signature,
      manifest: {
        ...payload,
        signature,
        is_verified: true,
      },
    };
  }

  /**
   * Cryptographically verifies an export authorization token.
   *
   * @param {string} token
   * @param {string} [expectedBatchId]
   * @param {string} [secret]
   * @returns {Object} verified manifest
   * @throws {PrivilegedSecurityError} 403 Forbidden if invalid or expired
   */
  static verifyExportAuthorizationToken(token, expectedBatchId = null, secret = DEFAULT_EXPORT_SIGNING_SECRET) {
    if (!token || typeof token !== 'string') {
      throw new PrivilegedSecurityError('Access Denied: Missing cryptographic export authorization token.');
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'KYLRX_EXP_SIG') {
      throw new PrivilegedSecurityError('Access Denied: Malformed or unverified export signature format.');
    }

    const [, payloadBase64, providedSignature] = parts;

    // Verify HMAC
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadBase64, 'utf8')
      .digest('hex');

    const isValidSig = crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    if (!isValidSig) {
      throw new PrivilegedSecurityError('Access Denied: Cryptographic export signature verification failed. Tampering detected.');
    }

    // Parse payload
    let manifest;
    try {
      const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8');
      manifest = JSON.parse(payloadJson);
    } catch {
      throw new PrivilegedSecurityError('Access Denied: Invalid export token payload encoding.');
    }

    // Check expiry
    const now = Date.now();
    const expiry = new Date(manifest.expires_at).getTime();
    if (isNaN(expiry) || now > expiry) {
      throw new PrivilegedSecurityError(
        `Access Denied: Cryptographic export authorization token has expired at ${manifest.expires_at}.`
      );
    }

    // Check batch ID match if expectedBatchId provided
    if (expectedBatchId && manifest.batch_id !== expectedBatchId) {
      throw new PrivilegedSecurityError(
        `Access Denied: Export authorization token is bound to batch '${manifest.batch_id}', but access to '${expectedBatchId}' was requested.`
      );
    }

    return {
      verified: true,
      manifest,
    };
  }

  /**
   * Retrieves raw unmasked batch data ONLY if privileged, cryptographically signed
   * authorization is verified.
   *
   * @param {Object} params
   * @param {Object} params.batch Raw batch from data store
   * @param {string} params.authToken Cryptographically signed token
   * @param {string} [params.secret]
   * @returns {Object} privileged unmasked batch
   */
  static getPrivilegedRawBatch({ batch, authToken, secret = DEFAULT_EXPORT_SIGNING_SECRET }) {
    if (!batch) {
      throw new Error('Payment batch is required for privileged export.');
    }

    // Enforce cryptographic verification
    const verification = PrivilegedExportSecurityService.verifyExportAuthorizationToken(
      authToken,
      batch.batch_id,
      secret
    );

    // Deep clone to return genuine raw values to the signed export worker
    return {
      ...JSON.parse(JSON.stringify(batch)),
      privileged_export_manifest: verification.manifest,
      raw_values_authorized: true,
    };
  }
}

/* ============================================================================
 * 6. EXPRESS INTERCEPTORS & SERIALIZERS (CRITERIA 12)
 * ============================================================================
 */

/**
 * Express response interceptor middleware:
 * Transparently masks all sensitive identifiers in JSON/object responses
 * for general UI/client consumers, unless a valid cryptographically signed
 * export token is presented in headers.
 */
export function uiPayloadMaskingInterceptor(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    // Check for privileged cryptographic export signature header
    const exportAuthHeader = req.headers['x-kylrx-export-signature'] || req.headers['x-export-authorization'];

    let isPrivilegedExport = false;
    if (exportAuthHeader) {
      try {
        PrivilegedExportSecurityService.verifyExportAuthorizationToken(exportAuthHeader);
        isPrivilegedExport = true;
      } catch {
        isPrivilegedExport = false;
      }
    }

    // If privileged export job, deliver raw data unmasked
    if (isPrivilegedExport) {
      return originalJson(body);
    }

    // Otherwise, recursively mask all sensitive identifiers for UI / client payload
    const maskedBody = DataMaskingService.maskSensitivePayload(body);
    return originalJson(maskedBody);
  };

  next();
}
