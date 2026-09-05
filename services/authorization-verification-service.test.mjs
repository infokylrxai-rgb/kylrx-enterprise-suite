import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UserRole,
  BatchAction,
  AuthorizationVerificationService,
  ForbiddenError,
  ApprovalGateViolationError,
  InvalidStateActionError,
} from './authorization-verification-service.mjs';

test('🛡️ KYLRX AI AUTHORIZATION & VERIFICATION SERVICE TEST SUITE', async (t) => {

  await t.test('1. Role Boundary Enforcement: Payroll Admin, Approver, Operator matrix', () => {
    const adminUser = { user_id: 'ADMIN_NANDAN', role: UserRole.PAYROLL_ADMIN };
    const checkerUser = { user_id: 'CHECKER_ABHISHEK', role: UserRole.CHECKER };
    const operatorUser = { user_id: 'OPERATOR_ROHIT', role: UserRole.AUTHORIZED_OPERATOR };

    // ✅ Payroll Admin permissions
    assert.doesNotThrow(() => AuthorizationVerificationService.verifyRolePermission(adminUser, BatchAction.VALIDATE));
    assert.doesNotThrow(() => AuthorizationVerificationService.verifyRolePermission(adminUser, BatchAction.GENERATE_FILE));
    assert.doesNotThrow(() => AuthorizationVerificationService.verifyRolePermission(adminUser, BatchAction.RETRY_FAILED));

    // ❌ Payroll Admin cannot Approve or Submit
    assert.throws(
      () => AuthorizationVerificationService.verifyRolePermission(adminUser, BatchAction.APPROVE),
      (err) => {
        assert(err instanceof ForbiddenError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /not authorized to execute action 'APPROVE'/);
        return true;
      }
    );
    assert.throws(
      () => AuthorizationVerificationService.verifyRolePermission(adminUser, BatchAction.SUBMIT),
      (err) => err instanceof ForbiddenError && err.statusCode === 403
    );

    // ✅ Checker permissions
    assert.doesNotThrow(() => AuthorizationVerificationService.verifyRolePermission(checkerUser, BatchAction.APPROVE));
    assert.doesNotThrow(() => AuthorizationVerificationService.verifyRolePermission(checkerUser, BatchAction.REJECT));

    // ❌ Checker cannot Generate File or Submit
    assert.throws(
      () => AuthorizationVerificationService.verifyRolePermission(checkerUser, BatchAction.GENERATE_FILE),
      (err) => err instanceof ForbiddenError && err.statusCode === 403
    );
    assert.throws(
      () => AuthorizationVerificationService.verifyRolePermission(checkerUser, BatchAction.SUBMIT),
      (err) => err instanceof ForbiddenError && err.statusCode === 403
    );

    // ✅ Operator permissions
    assert.doesNotThrow(() => AuthorizationVerificationService.verifyRolePermission(operatorUser, BatchAction.SUBMIT));

    // ❌ Operator cannot Validate or Approve
    assert.throws(
      () => AuthorizationVerificationService.verifyRolePermission(operatorUser, BatchAction.VALIDATE),
      (err) => err instanceof ForbiddenError && err.statusCode === 403
    );
    assert.throws(
      () => AuthorizationVerificationService.verifyRolePermission(operatorUser, BatchAction.APPROVE),
      (err) => err instanceof ForbiddenError && err.statusCode === 403
    );
  });

  await t.test('2. Maker-Checker Security Constraint: Programmatic 403 Forbidden Self-Approval Rejection', () => {
    const makerId = 'ADMIN_NANDAN';
    const batch = {
      batch_id: 'BATCH-SAL-2026-09',
      maker_id: makerId,
      status: 'PENDING_APPROVAL',
      payroll_run_id: 'PR-2026-09',
    };

    const selfApproverUser = {
      user_id: makerId, // Same ID as maker_id!
      role: UserRole.CHECKER,
    };

    const independentCheckerUser = {
      user_id: 'CHECKER_ABHISHEK',
      role: UserRole.CHECKER,
    };

    const validPayrollRun = { run_id: 'PR-2026-09', status: 'CLOSED' };

    // ❌ Maker attempts to self-approve -> 403 Forbidden
    assert.throws(
      () => {
        AuthorizationVerificationService.processApprovalRequest({
          batch,
          requestingUser: selfApproverUser,
          payrollRun: validPayrollRun,
          validationIssues: [],
          action: BatchAction.APPROVE,
        });
      },
      (err) => {
        assert(err instanceof ForbiddenError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Maker-Checker Security Violation/);
        assert.equal(err.details.maker_id, makerId);
        assert.equal(err.details.checker_id, makerId);
        return true;
      }
    );

    // ✅ Independent checker approves successfully
    const result = AuthorizationVerificationService.processApprovalRequest({
      batch,
      requestingUser: independentCheckerUser,
      payrollRun: validPayrollRun,
      validationIssues: [],
      action: BatchAction.APPROVE,
    });

    assert.equal(result.authorized, true);
    assert.equal(result.checker_id, 'CHECKER_ABHISHEK');
  });

  await t.test('3. Blocking Rule Enforcement: Unresolved BLOCKING Validation Issues Reject Approval', () => {
    const batch = {
      batch_id: 'BATCH-SAL-001',
      maker_id: 'MAKER_1',
      status: 'PENDING_APPROVAL',
      payroll_run_id: 'PR-001',
    };
    const checker = { user_id: 'CHECKER_1', role: UserRole.CHECKER };
    const payrollRun = { run_id: 'PR-001', status: 'CLOSED' };

    // Unresolved BLOCKING issues present
    const blockingIssues = [
      { id: 'ISS_01', code: 'GATE_04_IFSC_REGEX', severity: 'BLOCKING', resolved: false },
      { id: 'ISS_02', code: 'GATE_03_ACCOUNT_FORMAT', severity: 'BLOCKING', resolved_at: null },
      { id: 'ISS_03', code: 'GATE_WARN_BENEFIT', severity: 'WARNING', resolved: false },
    ];

    assert.throws(
      () => {
        AuthorizationVerificationService.processApprovalRequest({
          batch,
          requestingUser: checker,
          payrollRun,
          validationIssues: blockingIssues,
          action: BatchAction.APPROVE,
        });
      },
      (err) => {
        assert(err instanceof ApprovalGateViolationError);
        assert.equal(err.statusCode, 422);
        assert.match(err.message, /2 unresolved BLOCKING validation issue/);
        assert.equal(err.details.unresolved_count, 2);
        return true;
      }
    );

    // Once blocking issues are marked resolved, approval passes
    const resolvedIssues = [
      { id: 'ISS_01', code: 'GATE_04_IFSC_REGEX', severity: 'BLOCKING', resolved: true, resolved_at: '2026-09-04T12:00:00Z' },
      { id: 'ISS_02', code: 'GATE_03_ACCOUNT_FORMAT', severity: 'BLOCKING', resolved: true, resolved_at: '2026-09-04T12:05:00Z' },
      { id: 'ISS_03', code: 'GATE_WARN_BENEFIT', severity: 'WARNING', resolved: false },
    ];

    const approvalResult = AuthorizationVerificationService.processApprovalRequest({
      batch,
      requestingUser: checker,
      payrollRun,
      validationIssues: resolvedIssues,
      action: BatchAction.APPROVE,
    });

    assert.equal(approvalResult.authorized, true);
  });

  await t.test('4. Blocking Rule Enforcement: Upstream PayrollRun Must Be Closed and Frozen', () => {
    const batch = {
      batch_id: 'BATCH-SAL-002',
      maker_id: 'MAKER_1',
      status: 'PENDING_APPROVAL',
      payroll_run_id: 'PR-002',
    };
    const checker = { user_id: 'CHECKER_1', role: UserRole.CHECKER };

    // ❌ Open / Calculating PayrollRun rejects approval
    const unclosedRuns = [
      { run_id: 'PR-002', status: 'CALCULATING' },
      { run_id: 'PR-002', status: 'DRAFT' },
      { run_id: 'PR-002', status: 'PENDING' },
      { run_id: 'PR-002', status: 'PROCESSING' },
    ];

    for (const openRun of unclosedRuns) {
      assert.throws(
        () => {
          AuthorizationVerificationService.processApprovalRequest({
            batch,
            requestingUser: checker,
            payrollRun: openRun,
            validationIssues: [],
            action: BatchAction.APPROVE,
          });
        },
        (err) => {
          assert(err instanceof ApprovalGateViolationError);
          assert.equal(err.statusCode, 422);
          assert.match(err.message, /must be completely closed, approved, and frozen/);
          return true;
        }
      );
    }

    // ✅ Closed / Frozen / Locked PayrollRun passes
    const validClosedRuns = [
      { run_id: 'PR-002', status: 'CLOSED' },
      { run_id: 'PR-002', status: 'FROZEN' },
      { run_id: 'PR-002', status: 'LOCKED' },
      { run_id: 'PR-002', status: 'APPROVED' },
      { run_id: 'PR-002', status: 'COMPLETED' },
      { run_id: 'PR-002', status: 'REVIEW', is_frozen: true },
    ];

    for (const closedRun of validClosedRuns) {
      const res = AuthorizationVerificationService.processApprovalRequest({
        batch,
        requestingUser: checker,
        payrollRun: closedRun,
        validationIssues: [],
        action: BatchAction.APPROVE,
      });
      assert.equal(res.authorized, true);
    }
  });

  await t.test('5. Downstream Action State Invariants (Generate File, Submit, Retry)', () => {
    const admin = { user_id: 'ADMIN_NANDAN', role: UserRole.PAYROLL_ADMIN };
    const operator = { user_id: 'OPERATOR_ROHIT', role: UserRole.AUTHORIZED_OPERATOR };

    // ❌ Cannot generate file before approval
    assert.throws(
      () => {
        AuthorizationVerificationService.processFileGenerationRequest({
          batch: { batch_id: 'B1', status: 'PENDING_APPROVAL' },
          requestingUser: admin,
          checksum: 'abc123sha256',
        });
      },
      (err) => err instanceof InvalidStateActionError && err.statusCode === 400
    );

    // ✅ Generate file on APPROVED batch
    const fileRes = AuthorizationVerificationService.processFileGenerationRequest({
      batch: { batch_id: 'B1', status: 'APPROVED' },
      requestingUser: admin,
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    assert.equal(fileRes.authorized, true);

    // ❌ Cannot submit batch that has not generated banking file
    assert.throws(
      () => {
        AuthorizationVerificationService.processSubmissionRequest({
          batch: { batch_id: 'B1', status: 'APPROVED' },
          requestingUser: operator,
        });
      },
      (err) => err instanceof InvalidStateActionError && err.statusCode === 400
    );

    // ✅ Submit on FILE_GENERATED batch
    const subRes = AuthorizationVerificationService.processSubmissionRequest({
      batch: { batch_id: 'B1', status: 'FILE_GENERATED' },
      requestingUser: operator,
      transmissionChannel: 'HDFC_CORPORATE_PORTAL',
    });
    assert.equal(subRes.authorized, true);

    // ❌ Cannot retry a batch unless it is in FAILED state
    assert.throws(
      () => {
        AuthorizationVerificationService.processRetryRequest({
          batch: { batch_id: 'B1', status: 'PAID' },
          requestingUser: admin,
          reason: 'Try again',
        });
      },
      (err) => err instanceof InvalidStateActionError && err.statusCode === 400
    );

    // ✅ Retry on FAILED batch
    const retryRes = AuthorizationVerificationService.processRetryRequest({
      batch: { batch_id: 'B1', status: 'FAILED' },
      requestingUser: admin,
      reason: 'IFSC bank codes updated in employee master registry',
    });
    assert.equal(retryRes.authorized, true);
  });

});
