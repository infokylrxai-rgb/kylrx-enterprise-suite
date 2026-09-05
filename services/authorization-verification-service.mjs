/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - AUTHORIZATION & VERIFICATION SERVICE
 * ============================================================================
 * Module: Role Boundary Enforcement, 4-Eyes Maker-Checker Security, and
 *         Pre-Approval Verification Gates.
 *
 * Enforces:
 *  1. Strict Role Boundaries:
 *     - Payroll Admin / Payroll Engine: Validate, Generate File (post-approval), Retry Failed
 *     - Checker / Authorized Approver: Approve, Reject
 *     - Authorized Operator / Direct Integration: Submit (Transmit to Bank)
 *  2. Maker-Checker 403 Forbidden Self-Approval Protection:
 *     - Prevents requesting checker_id === submitting maker_id.
 *  3. Blocking Rule Enforcement for Approvals:
 *     - Rejects approval if any unresolved 'BLOCKING' ValidationIssue records exist.
 *     - Rejects approval if the upstream PayrollRun is not completely closed and frozen.
 *
 * @version 1.0.0
 * @author Kylrx AI Senior Backend Systems Team
 */

export const UserRole = Object.freeze({
  PAYROLL_ADMIN: 'PAYROLL_ADMIN',
  PAYROLL_ENGINE: 'PAYROLL_ENGINE',
  CHECKER: 'CHECKER',
  AUTHORIZED_APPROVER: 'AUTHORIZED_APPROVER',
  FINANCE_HEAD: 'FINANCE_HEAD',
  AUTHORIZED_OPERATOR: 'AUTHORIZED_OPERATOR',
  DIRECT_INTEGRATION: 'DIRECT_INTEGRATION',
  SYSTEM_SERVICE: 'SYSTEM_SERVICE',
});

export const BatchAction = Object.freeze({
  VALIDATE: 'VALIDATE',
  GENERATE_FILE: 'GENERATE_FILE',
  RETRY_FAILED: 'RETRY_FAILED',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  SUBMIT: 'SUBMIT',
});

// Explicit Permission Mapping
const ROLE_ACTION_PERMISSIONS = {
  [UserRole.PAYROLL_ADMIN]: [BatchAction.VALIDATE, BatchAction.GENERATE_FILE, BatchAction.RETRY_FAILED],
  [UserRole.PAYROLL_ENGINE]: [BatchAction.VALIDATE, BatchAction.GENERATE_FILE, BatchAction.RETRY_FAILED],
  [UserRole.CHECKER]: [BatchAction.APPROVE, BatchAction.REJECT],
  [UserRole.AUTHORIZED_APPROVER]: [BatchAction.APPROVE, BatchAction.REJECT],
  [UserRole.FINANCE_HEAD]: [BatchAction.APPROVE, BatchAction.REJECT],
  [UserRole.AUTHORIZED_OPERATOR]: [BatchAction.SUBMIT],
  [UserRole.DIRECT_INTEGRATION]: [BatchAction.SUBMIT],
  [UserRole.SYSTEM_SERVICE]: [BatchAction.VALIDATE, BatchAction.GENERATE_FILE, BatchAction.SUBMIT, BatchAction.RETRY_FAILED],
};

// Recognized Closed/Frozen Upstream Payroll Run States
const CLOSED_PAYROLL_RUN_STATUSES = new Set(['CLOSED', 'FROZEN', 'LOCKED', 'APPROVED', 'COMPLETED']);

// Custom Error Classes
export class ForbiddenError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
    this.status = 403;
    this.details = details;
  }
}

export class ApprovalGateViolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApprovalGateViolationError';
    this.statusCode = 422;
    this.status = 422;
    this.details = details;
  }
}

export class InvalidStateActionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidStateActionError';
    this.statusCode = 400;
    this.status = 400;
    this.details = details;
  }
}

/**
 * Authorization and Verification Service Engine
 */
export class AuthorizationVerificationService {
  /**
   * 1. Enforce Role Boundaries for a Given Action
   */
  static verifyRolePermission(user, action) {
    if (!user || !user.user_id || !user.role) {
      throw new ForbiddenError('403 Forbidden: Requesting user is not authenticated or lacks a defined role.', {
        user,
        action,
      });
    }

    const permittedActions = ROLE_ACTION_PERMISSIONS[user.role] || [];
    if (!permittedActions.includes(action)) {
      throw new ForbiddenError(
        `403 Forbidden: User '${user.user_id}' with role '${user.role}' is not authorized to execute action '${action}'. Permitted roles for this action: ${AuthorizationVerificationService.getPermittedRolesForAction(action).join(', ')}`,
        {
          user_id: user.user_id,
          role: user.role,
          action,
          permittedRoles: AuthorizationVerificationService.getPermittedRolesForAction(action),
        }
      );
    }

    return true;
  }

  static getPermittedRolesForAction(action) {
    return Object.entries(ROLE_ACTION_PERMISSIONS)
      .filter(([_, actions]) => actions.includes(action))
      .map(([role]) => role);
  }

  /**
   * 2. Maker-Checker 403 Forbidden Self-Approval Security Check
   */
  static assertMakerCheckerSecurity(batch, requestingChecker) {
    if (!batch) {
      throw new InvalidStateActionError('Payment batch is required for Maker-Checker verification.');
    }

    if (!requestingChecker || !requestingChecker.user_id) {
      throw new ForbiddenError('403 Forbidden: Missing checker credentials.');
    }

    // Programmatically prevent self-approval
    if (batch.maker_id && String(batch.maker_id).trim().toLowerCase() === String(requestingChecker.user_id).trim().toLowerCase()) {
      throw new ForbiddenError(
        `403 Forbidden: Maker-Checker Security Violation. Admin '${requestingChecker.user_id}' submitted this batch to PENDING_APPROVAL and cannot self-approve. An independent authorized checker is required.`,
        {
          maker_id: batch.maker_id,
          checker_id: requestingChecker.user_id,
          batch_id: batch.batch_id,
        }
      );
    }

    return true;
  }

  /**
   * 3. Blocking Rule Enforcement for Batch Approval
   *  - Rejects if any unresolved ValidationIssue records have severity: 'BLOCKING'
   *  - Rejects if upstream PayrollRun status is not completely closed and frozen
   */
  static verifyApprovalPreconditions({ batch, payrollRun, validationIssues = [] }) {
    if (!batch) {
      throw new InvalidStateActionError('Payment batch is required for approval gate verification.');
    }

    // 3A. Enforce Validation Issues Gate (0 unresolved BLOCKING issues allowed)
    const unresolvedBlockingIssues = validationIssues.filter((issue) => {
      const isResolved = issue.resolved === true || Boolean(issue.resolved_at);
      const isBlocking = String(issue.severity || '').toUpperCase() === 'BLOCKING' || String(issue.severity || '').toUpperCase() === 'ERROR';
      return !isResolved && isBlocking;
    });

    if (unresolvedBlockingIssues.length > 0) {
      const errorCodes = unresolvedBlockingIssues.map((i) => i.code || i.gateCode || i.issue_code || 'BLOCKING_ISSUE');
      throw new ApprovalGateViolationError(
        `Approval Blocked: Cannot approve batch '${batch.batch_id}'. ${unresolvedBlockingIssues.length} unresolved BLOCKING validation issue(s) detected: [${errorCodes.join(', ')}]. All blocking errors must be remediated in employee records before approval.`,
        {
          batch_id: batch.batch_id,
          unresolved_count: unresolvedBlockingIssues.length,
          issues: unresolvedBlockingIssues,
        }
      );
    }

    // 3B. Enforce Upstream Payroll Run Closure & Freezing Gate
    if (!payrollRun) {
      throw new ApprovalGateViolationError(
        `Approval Blocked: Upstream PayrollRun metadata is missing for batch '${batch.batch_id}'. Verification requires an authoritative PayrollRun record.`,
        { batch_id: batch.batch_id, payroll_run_id: batch.payroll_run_id }
      );
    }

    const runStatus = String(payrollRun.status || '').toUpperCase();
    if (!CLOSED_PAYROLL_RUN_STATUSES.has(runStatus) && payrollRun.is_frozen !== true && payrollRun.locked !== true) {
      throw new ApprovalGateViolationError(
        `Approval Blocked: Upstream PayrollRun '${payrollRun.run_id || payrollRun.id || batch.payroll_run_id}' is in status '${payrollRun.status}'. The payroll calculation must be completely closed, approved, and frozen before approving disbursements.`,
        {
          batch_id: batch.batch_id,
          payroll_run_id: payrollRun.run_id || payrollRun.id,
          current_payroll_run_status: payrollRun.status,
          required_statuses: Array.from(CLOSED_PAYROLL_RUN_STATUSES),
        }
      );
    }

    return true;
  }

  /**
   * 4. Complete End-to-End Approval Request Verification and Execution
   */
  static processApprovalRequest({
    batch,
    requestingUser,
    payrollRun,
    validationIssues = [],
    action = BatchAction.APPROVE,
    metadata = {},
  }) {
    // A. Role enforcement (Checker / Authorized Approver / Finance Head)
    AuthorizationVerificationService.verifyRolePermission(requestingUser, action);

    // B. State verification
    if (batch.status !== 'PENDING_APPROVAL') {
      throw new InvalidStateActionError(
        `Invalid Action: Batch '${batch.batch_id}' is currently in state '${batch.status}'. Approvals are only permitted on batches in 'PENDING_APPROVAL'.`,
        { batch_id: batch.batch_id, current_status: batch.status }
      );
    }

    // C. Maker-Checker 403 Forbidden check
    AuthorizationVerificationService.assertMakerCheckerSecurity(batch, requestingUser);

    // D. Precondition gates (unresolved blocking issues & closed payroll run)
    if (action === BatchAction.APPROVE) {
      AuthorizationVerificationService.verifyApprovalPreconditions({
        batch,
        payrollRun,
        validationIssues,
      });
    }

    return {
      authorized: true,
      action,
      batch_id: batch.batch_id,
      checker_id: requestingUser.user_id,
      checker_role: requestingUser.role,
      approved_at: new Date().toISOString(),
      metadata,
    };
  }

  /**
   * 5. File Generation Verification (Post-Approval Gate)
   */
  static processFileGenerationRequest({ batch, requestingUser, checksum, metadata = {} }) {
    AuthorizationVerificationService.verifyRolePermission(requestingUser, BatchAction.GENERATE_FILE);

    if (batch.status !== 'APPROVED') {
      throw new InvalidStateActionError(
        `Invalid Action: Batch '${batch.batch_id}' is in state '${batch.status}'. File generation is strictly prohibited prior to checker approval (state must be 'APPROVED').`,
        { batch_id: batch.batch_id, current_status: batch.status }
      );
    }

    if (!checksum) {
      throw new InvalidStateActionError('File generation requires a verified cryptographic SHA-256 checksum.');
    }

    return {
      authorized: true,
      action: BatchAction.GENERATE_FILE,
      batch_id: batch.batch_id,
      generated_by: requestingUser.user_id,
      checksum,
      metadata,
    };
  }

  /**
   * 6. Submission Verification (Operator / Direct Gateway)
   */
  static processSubmissionRequest({ batch, requestingUser, transmissionChannel = 'BANK_HOST_TO_HOST', metadata = {} }) {
    AuthorizationVerificationService.verifyRolePermission(requestingUser, BatchAction.SUBMIT);

    if (batch.status !== 'FILE_GENERATED') {
      throw new InvalidStateActionError(
        `Invalid Action: Batch '${batch.batch_id}' is in state '${batch.status}'. Submission to clearing bank requires a generated and checksum-locked banking file (state must be 'FILE_GENERATED').`,
        { batch_id: batch.batch_id, current_status: batch.status }
      );
    }

    return {
      authorized: true,
      action: BatchAction.SUBMIT,
      batch_id: batch.batch_id,
      submitted_by: requestingUser.user_id,
      transmissionChannel,
      metadata,
    };
  }

  /**
   * 7. Retry Failed Batch Verification
   */
  static processRetryRequest({ batch, requestingUser, reason, metadata = {} }) {
    AuthorizationVerificationService.verifyRolePermission(requestingUser, BatchAction.RETRY_FAILED);

    if (batch.status !== 'FAILED') {
      throw new InvalidStateActionError(
        `Invalid Action: Batch '${batch.batch_id}' is in state '${batch.status}'. Retry/Re-open action is only applicable to 'FAILED' batches.`,
        { batch_id: batch.batch_id, current_status: batch.status }
      );
    }

    if (!reason || !reason.trim()) {
      throw new InvalidStateActionError('A remediation reason is required when re-opening a failed batch.');
    }

    return {
      authorized: true,
      action: BatchAction.RETRY_FAILED,
      batch_id: batch.batch_id,
      reopened_by: requestingUser.user_id,
      reason,
      metadata,
    };
  }
}
