import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ExceptionResolutionService,
  TransactionalDatabaseStore,
  createResolveIssueHandler,
  ResolutionValidationError,
} from './exception-resolution-service.mjs';
import { DeterministicValidationPipeline, ErrorCatalog, ErrorSeverity } from './deterministic-validation-pipeline.mjs';

test('🔧 KYLRX AI EXCEPTION RESOLUTION & DYNAMIC RE-VALIDATION ENGINE TEST SUITE', async (t) => {
  const makeSampleBatch = (status = 'FAILED') => ({
    batch_id: 'BATCH-SEP2026-001',
    batch_type: 'SALARY',
    status: status,
    validation_status: status === 'VALIDATED' ? 'VALIDATED' : 'VALIDATION_FAILED',
    can_generate_bank_file: status === 'VALIDATED',
    is_blocked: status !== 'VALIDATED',
    total_net_payable: 125000,
    records: [
      {
        employee_id: 'EMP101',
        employee_name: 'Aditi Rao',
        gross_salary: 50000,
        deductions: 5000,
        net_payable_amount: 45000,
        employer_contributions: 6000,
        ifsc_code: 'INVALID_IFSC_123', // Faulty IFSC
        account_number: '123456789012',
        bank_account_version: 1,
        is_pf_covered: true,
        uan: '100123456789',
      },
      {
        employee_id: 'EMP102',
        employee_name: 'Vikram Mehta',
        gross_salary: 80000,
        deductions: 0,
        net_payable_amount: 80000,
        employer_contributions: 9600,
        ifsc_code: 'HDFC0001234',
        account_number: '987654321098',
        bank_account_version: 1,
        is_pf_covered: true,
        uan: '100987654321',
      },
    ],
  });

  const makeSampleEmployees = () => [
    {
      employee_id: 'EMP101',
      name: 'Aditi Rao',
      ifsc_code: 'INVALID_IFSC_123',
      account_number: '123456789012',
      bank_account_version: 1,
      salary: 50000,
    },
    {
      employee_id: 'EMP102',
      name: 'Vikram Mehta',
      ifsc_code: 'HDFC0001234',
      account_number: '987654321098',
      bank_account_version: 1,
      salary: 80000,
    },
  ];

  await t.test('1. Issue Ingestion: Correctly persists failed checks with resolved_at: null and standardized schema', async () => {
    const store = new TransactionalDatabaseStore();
    const service = new ExceptionResolutionService({ store });

    const rawFailedChecks = [
      {
        code: 'EMP021',
        severity: 'BLOCKING',
        field: 'ifsc_code',
        employee_id: 'EMP101',
        employee_name: 'Aditi Rao',
        message: "Invalid IFSC 'INVALID_IFSC_123'. Must match /^[A-Z]{4}0[A-Z0-9]{6}$/.",
        suggested_fix: 'Update employee bank master record with a valid 11-character alphanumeric IFSC code.',
      },
    ];

    const ingested = await service.ingestValidationIssues('BATCH-SEP2026-001', rawFailedChecks);

    assert.equal(ingested.length, 1);
    assert.ok(ingested[0].issue_id.startsWith('ISS-EMP021-'));
    assert.equal(ingested[0].batch_id, 'BATCH-SEP2026-001');
    assert.equal(ingested[0].code, 'EMP021');
    assert.equal(ingested[0].severity, ErrorSeverity.BLOCK);
    assert.equal(ingested[0].field, 'ifsc_code');
    assert.equal(ingested[0].employee_id, 'EMP101');
    assert.equal(ingested[0].resolved, false);
    assert.equal(ingested[0].resolved_at, null);
    assert.equal(ingested[0].resolved_by, null);

    // Verify retrieval from store
    const storedIssues = await store.validationIssues.get('BATCH-SEP2026-001');
    assert.ok(storedIssues.has(ingested[0].issue_id));
  });

  await t.test('2. Atomic Re-evaluation: Accepts issue_id, field, updated_value, admin_id, increments version, marks resolved, runs 9-step pipeline, and advances to VALIDATED', async () => {
    const store = new TransactionalDatabaseStore();
    const batch = makeSampleBatch('FAILED');
    const employees = makeSampleEmployees();

    store.setBatch(batch);
    employees.forEach((e) => store.setEmployee(e));

    const service = new ExceptionResolutionService({ store });

    // Ingest issue
    const [issue] = await service.ingestValidationIssues(batch.batch_id, [
      {
        code: 'EMP021',
        severity: 'BLOCK',
        field: 'ifsc_code',
        employee_id: 'EMP101',
        employee_name: 'Aditi Rao',
        message: 'Invalid IFSC',
      },
    ]);

    // Execute remediation API call using issue_id, field, updated_value, admin_id
    const result = await service.resolveIssueAndRevalidate({
      batchId: batch.batch_id,
      issueId: issue.issue_id,
      field: 'ifsc_code',
      updatedValue: 'ICIC0000047',
      adminId: 'ADMIN_PRIYA_SHARMA',
      resolutionNotes: 'Updated to valid ICICI branch IFSC code.',
      payrollSourceLedger: { total_net: 125000 },
    });

    assert.equal(result.success, true);
    assert.equal(result.batch_status, 'VALIDATED');
    assert.equal(result.can_generate_bank_file, true);
    assert.equal(result.is_blocked, false);
    assert.equal(result.unresolved_blocking_count, 0);

    // Verify employee master record bank_account_version incremented (1 -> 2)
    assert.equal(result.bank_account_version, 2);
    assert.equal(result.updated_employee.bank_account_version, 2);
    assert.equal(result.updated_employee.ifsc_code, 'ICIC0000047');

    // Verify ValidationIssue resolution details
    assert.equal(result.resolved_issue.resolved, true);
    assert.ok(result.resolved_issue.resolved_at);
    assert.equal(result.resolved_issue.resolved_by, 'ADMIN_PRIYA_SHARMA');
    assert.equal(result.resolved_issue.previous_bank_account_version, 1);
    assert.equal(result.resolved_issue.new_bank_account_version, 2);

    // Verify 9-step pipeline execution trace
    assert.equal(result.execution_trace.length, 9);
    assert.equal(result.execution_trace[0].name, 'LOAD_IMMUTABLE_PAYROLL_RESULT');
    assert.equal(result.execution_trace[8].name, 'TRANSITION_BATCH_STATE');

    // Verify recomputed totals
    assert.equal(result.recomputed_totals.total_net, 125000);
    assert.equal(result.recomputed_totals.record_count, 2);
  });

  await t.test('3. Editable State Check: Aborts with 422 if batch is already in non-editable state (e.g. APPROVED)', async () => {
    const store = new TransactionalDatabaseStore();
    const batch = makeSampleBatch('APPROVED'); // Already approved -> non-editable
    const employees = makeSampleEmployees();

    store.setBatch(batch);
    employees.forEach((e) => store.setEmployee(e));

    const service = new ExceptionResolutionService({ store });

    const [issue] = await service.ingestValidationIssues(batch.batch_id, [
      {
        code: 'EMP021',
        severity: 'BLOCK',
        field: 'ifsc_code',
        employee_id: 'EMP101',
        message: 'Invalid IFSC',
      },
    ]);

    await assert.rejects(
      async () => {
        await service.resolveIssueAndRevalidate({
          batchId: batch.batch_id,
          issueId: issue.issue_id,
          field: 'ifsc_code',
          updatedValue: 'HDFC0001234',
          adminId: 'ADMIN_01',
        });
      },
      (err) => {
        assert.ok(err instanceof ResolutionValidationError);
        assert.equal(err.statusCode, 422);
        assert.ok(err.message.includes("Cannot remediate batch 'BATCH-SEP2026-001' in state 'APPROVED'"));
        return true;
      }
    );
  });

  await t.test('4. Partial Resolution: Resolving 1 of 2 blocking issues keeps batch in FAILED state until all blocking issues clear', async () => {
    const store = new TransactionalDatabaseStore();
    const batch = makeSampleBatch('DRAFT');
    batch.records[1].net_payable_amount = -500;
    batch.total_net_payable = 44500;

    const employees = makeSampleEmployees();
    store.setBatch(batch);
    employees.forEach((e) => store.setEmployee(e));

    const service = new ExceptionResolutionService({ store });

    const [issue1, issue2] = await service.ingestValidationIssues(batch.batch_id, [
      {
        code: 'EMP021',
        severity: 'BLOCK',
        field: 'ifsc_code',
        employee_id: 'EMP101',
        message: 'Invalid IFSC',
      },
      {
        code: 'EMP052',
        severity: 'BLOCK',
        field: 'net_payable_amount',
        employee_id: 'EMP102',
        message: 'Negative net pay',
      },
    ]);

    // Resolve only issue 1 (EMP101 IFSC)
    const result = await service.resolveIssueAndRevalidate({
      batchId: batch.batch_id,
      issueId: issue1.issue_id,
      field: 'ifsc_code',
      updatedValue: 'SBIN0001234',
      adminId: 'HR_LEAD_01',
    });

    assert.equal(result.success, true);
    assert.equal(result.resolved_issue.resolved, true);
    assert.equal(result.bank_account_version, 2);

    // Batch must REMAIN FAILED because EMP102 still has a blocking issue (EMP052)
    assert.equal(result.batch_status, 'FAILED');
    assert.equal(result.can_generate_bank_file, false);
    assert.equal(result.is_blocked, true);
    assert.equal(result.unresolved_blocking_count, 1);
    assert.equal(result.remaining_blocking_issues[0].code, 'EMP052');
  });

  await t.test('5. Atomic Transaction Rollback: Database mutations completely discard on transaction failure', async () => {
    const store = new TransactionalDatabaseStore();
    const batch = makeSampleBatch('FAILED');
    const employees = makeSampleEmployees();

    store.setBatch(batch);
    employees.forEach((e) => store.setEmployee(e));

    const service = new ExceptionResolutionService({ store });

    const [issue] = await service.ingestValidationIssues(batch.batch_id, [
      {
        code: 'EMP021',
        severity: 'BLOCK',
        field: 'ifsc_code',
        employee_id: 'EMP101',
        message: 'Invalid IFSC',
      },
    ]);

    // Attempt remediation with missing update value / empty fields
    await assert.rejects(
      async () => {
        await service.resolveIssueAndRevalidate({
          batchId: batch.batch_id,
          issueId: issue.issue_id,
          field: null,
          updatedValue: null,
          adminId: 'ADMIN_USER',
        });
      },
      (err) => {
        assert.ok(err instanceof ResolutionValidationError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    // Verify employee in store was NOT modified (bank_account_version still 1, ifsc unchanged)
    const empInStore = await store.employees.get('EMP101');
    assert.equal(empInStore.bank_account_version, 1);
    assert.equal(empInStore.ifsc_code, 'INVALID_IFSC_123');

    // Verify issue was NOT marked resolved
    const issueInStore = store.validationIssues.get(batch.batch_id).get(issue.issue_id);
    assert.equal(issueInStore.resolved, false);
    assert.equal(issueInStore.resolved_at, null);
  });

  await t.test('6. Remediation API Express Controller Integration: Responds with 200 OK for { issue_id, field, updated_value, admin_id }', async () => {
    const store = new TransactionalDatabaseStore();
    const batch = makeSampleBatch('VALIDATING');
    batch.records[0].ifsc_code = 'HDFC0001234';
    batch.records[0].account_number = '123'; // Initial faulty account number
    const employees = makeSampleEmployees();
    employees[0].ifsc_code = 'HDFC0001234';
    employees[0].account_number = '123';

    store.setBatch(batch);
    employees.forEach((e) => store.setEmployee(e));

    const service = new ExceptionResolutionService({ store });

    const [issue] = await service.ingestValidationIssues(batch.batch_id, [
      {
        code: 'EMP037',
        severity: 'BLOCK',
        field: 'account_number',
        employee_id: 'EMP101',
        message: 'Invalid Account Number',
      },
    ]);

    const handler = createResolveIssueHandler(service);

    const createMockRes = () => {
      const res = {};
      res.statusCode = 200;
      res.body = null;
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (data) => {
        res.body = data;
        return res;
      };
      return res;
    };

    // Valid Request with issue_id, field, updated_value, admin_id -> 200 OK
    const validReq = {
      params: { batchId: batch.batch_id },
      body: {
        issue_id: issue.issue_id,
        field: 'account_number',
        updated_value: '12345678901234',
        admin_id: 'SUPER_ADMIN_KAVYA',
        notes: 'Updated valid bank account number',
      },
    };
    const validRes = createMockRes();
    await handler(validReq, validRes);
    assert.equal(validRes.statusCode, 200);
    assert.equal(validRes.body.success, true);
    assert.equal(validRes.body.batch_status, 'VALIDATED');
    assert.equal(validRes.body.bank_account_version, 2);
    assert.equal(validRes.body.can_generate_bank_file, true);
  });
});
