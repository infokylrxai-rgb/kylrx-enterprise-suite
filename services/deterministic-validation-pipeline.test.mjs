import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeterministicValidationPipeline,
  ErrorCatalog,
  ErrorSeverity,
  ValidationIssueRepository,
} from './deterministic-validation-pipeline.mjs';

test('⚙️ KYLRX AI DETERMINISTIC VALIDATION PIPELINE TEST SUITE (9-STEP SEQUENTIAL PIPELINE)', async (t) => {

  await t.test('1. 100% Clean Records: All 9 Sequential Steps Execute & Batch Status Advances to VALIDATED', async () => {
    const pipeline = new DeterministicValidationPipeline();
    const batch = {
      batch_id: 'BATCH-CLEAN-001',
      status: 'DRAFT',
      records: [
        {
          employee_id: 'EMP001',
          employee_name: 'Abhishek Rai',
          account_number: '50100492819200',
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 50000,
          gross_salary: 60000,
          deductions: 10000,
          employer_contributions: 7000,
          email: 'abhishek@kylrx.ai',
          uan: '100112233445',
          is_pf_covered: true,
          is_esic_covered: false,
        },
        {
          employee_id: 'EMP002',
          employee_name: 'Rohit Kumar',
          account_number: '50100492819201',
          ifsc_code: 'HDFC0001234',
          net_payable_amount: 40000,
          gross_salary: 45000,
          deductions: 5000,
          employer_contributions: 5500,
          email: 'rohit@kylrx.ai',
          uan: '100112233446',
          is_pf_covered: true,
          is_esic_covered: false,
        },
      ],
    };

    const sourceLedger = { total_net: 90000, total_gross: 105000 };

    const result = await pipeline.execute({
      batch,
      payrollSourceLedger: sourceLedger,
    });

    assert.equal(result.status, 'VALIDATED');
    assert.equal(batch.status, 'VALIDATED');
    assert.equal(result.can_generate_bank_file, true);
    assert.equal(result.is_blocked, false);
    assert.equal(result.blocking_issues.length, 0);
    assert.equal(result.warning_issues.length, 0);
    assert.equal(result.execution_trace.length, 9);
    assert.equal(result.execution_trace[0].name, 'LOAD_IMMUTABLE_PAYROLL_RESULT');
    assert.equal(result.execution_trace[8].name, 'TRANSITION_BATCH_STATE');
    assert.equal(result.validation_summary.calculated_aggregates.total_net, 90000);
  });

  await t.test('2. Error Catalog: EMP021 (Invalid IFSC) & EMP037 (Invalid Account Number) Trigger BLOCK Severity', async () => {
    const pipeline = new DeterministicValidationPipeline();
    const batch = {
      batch_id: 'BATCH-STRUCTURAL-FAIL',
      status: 'DRAFT',
      records: [
        {
          employee_id: 'EMP021',
          employee_name: 'Invalid IFSC Staff',
          account_number: '50100492819200',
          ifsc_code: 'INVALID_IFSC_123', // ❌ EMP021
          net_payable_amount: 50000,
          email: 'emp021@kylrx.ai',
        },
        {
          employee_id: 'EMP037',
          employee_name: 'Invalid Account Staff',
          account_number: '12345', // ❌ EMP037 (length < 9)
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 45000,
          email: 'emp037@kylrx.ai',
        },
      ],
    };

    const sourceLedger = { total_net: 95000 };
    const result = await pipeline.execute({ batch, payrollSourceLedger: sourceLedger });

    assert.equal(result.status, 'FAILED');
    assert.equal(batch.status, 'FAILED');
    assert.equal(result.can_generate_bank_file, false);
    assert.equal(result.is_blocked, true);

    const emp021Issue = result.issues.find((i) => i.code === 'EMP021');
    assert(emp021Issue);
    assert.equal(emp021Issue.severity, ErrorSeverity.BLOCK);
    assert.equal(emp021Issue.employee_id, 'EMP021');

    const emp037Issue = result.issues.find((i) => i.code === 'EMP037');
    assert(emp037Issue);
    assert.equal(emp037Issue.severity, ErrorSeverity.BLOCK);
    assert.equal(emp037Issue.employee_id, 'EMP037');
  });

  await t.test('3. Error Catalog: EMP052 (Non-positive Net Pay) & VAL001 (Missing Statutory Identifier) Trigger BLOCK Severity', async () => {
    const pipeline = new DeterministicValidationPipeline();
    const batch = {
      batch_id: 'BATCH-POLICY-FAIL',
      status: 'DRAFT',
      records: [
        {
          employee_id: 'EMP052',
          employee_name: 'Zero Pay Staff',
          account_number: '50100492819200',
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 0, // ❌ EMP052
          email: 'emp052@kylrx.ai',
        },
        {
          employee_id: 'VAL001',
          employee_name: 'Missing UAN Staff',
          account_number: '50100492819201',
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 45000,
          gross_salary: 14000,
          is_pf_covered: true,
          uan: null, // ❌ VAL001
          email: 'val001@kylrx.ai',
        },
      ],
    };

    const sourceLedger = { total_net: 45000 };
    const result = await pipeline.execute({ batch, payrollSourceLedger: sourceLedger });

    assert.equal(result.status, 'FAILED');
    const emp052Issue = result.issues.find((i) => i.code === 'EMP052');
    assert(emp052Issue);
    assert.equal(emp052Issue.severity, ErrorSeverity.BLOCK);

    const val001Issue = result.issues.find((i) => i.code === 'VAL001');
    assert(val001Issue);
    assert.equal(val001Issue.severity, ErrorSeverity.BLOCK);
  });

  await t.test('4. Error Catalog: VAL001 Temporal Effective Date Windows Flag Expiration / Future Dates', async () => {
    const pipeline = new DeterministicValidationPipeline();
    const batch = {
      batch_id: 'BATCH-TEMPORAL-FAIL',
      status: 'DRAFT',
      records: [
        {
          employee_id: 'EMP_EXPIRED',
          employee_name: 'Expired Contractor',
          account_number: '50100492819200',
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 50000,
          email: 'contractor@kylrx.ai',
          effective_to: '2026-08-31', // ❌ Expired before cycle date
        },
      ],
    };

    const sourceLedger = { total_net: 50000 };
    const result = await pipeline.execute({
      batch,
      payrollSourceLedger: sourceLedger,
      asOfDate: '2026-09-04',
    });

    assert.equal(result.status, 'FAILED');
    const val001Issue = result.issues.find((i) => i.code === 'VAL001' && i.field === 'effective_to');
    assert(val001Issue);
    assert.equal(val001Issue.severity, ErrorSeverity.BLOCK);
  });

  await t.test('5. Error Catalog: DUP001 (Duplicate Payment Instruction) Flags Shared Accounts and IDs', async () => {
    const pipeline = new DeterministicValidationPipeline();
    const batch = {
      batch_id: 'BATCH-DUP-FAIL',
      status: 'DRAFT',
      records: [
        {
          employee_id: 'EMP100',
          employee_name: 'Primary Employee',
          account_number: '999988887777',
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 50000,
          email: 'emp100@kylrx.ai',
        },
        {
          employee_id: 'EMP200',
          employee_name: 'Colliding Employee',
          account_number: '999988887777', // ❌ DUP001: Duplicate account
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 50000,
          email: 'emp200@kylrx.ai',
        },
      ],
    };

    const sourceLedger = { total_net: 100000 };
    const result = await pipeline.execute({ batch, payrollSourceLedger: sourceLedger });

    assert.equal(result.status, 'FAILED');
    const dupIssue = result.issues.find((i) => i.code === 'DUP001');
    assert(dupIssue);
    assert.equal(dupIssue.severity, ErrorSeverity.BLOCK);
    assert.equal(dupIssue.field, 'account_number');
  });

  await t.test('6. Error Catalog: WARN001 (Missing Email) Is Non-Blocking & Does NOT Halt VALIDATED State Transition', async () => {
    const pipeline = new DeterministicValidationPipeline();
    const batch = {
      batch_id: 'BATCH-WARN-PASS',
      status: 'DRAFT',
      records: [
        {
          employee_id: 'EMP_WARN',
          employee_name: 'Warning Employee',
          account_number: '50100492819200',
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 50000,
          email: '', // ⚠️ WARN001: Missing email
        },
      ],
    };

    const sourceLedger = { total_net: 50000 };
    const result = await pipeline.execute({ batch, payrollSourceLedger: sourceLedger });

    assert.equal(result.status, 'VALIDATED');
    assert.equal(result.can_generate_bank_file, true);
    assert.equal(result.blocking_issues.length, 0);
    assert.equal(result.warning_issues.length, 1);
    assert.equal(result.warning_issues[0].code, 'WARN001');
    assert.equal(result.warning_issues[0].severity, ErrorSeverity.WARN);
  });

  await t.test('7. Step 7 & 8: Frozen Source Ledger Disparity Triggers LEDGER_MISMATCH and Persists Issues', async () => {
    const repo = new ValidationIssueRepository();
    const pipeline = new DeterministicValidationPipeline({ issueRepository: repo });

    const batch = {
      batch_id: 'BATCH-LEDGER-MISMATCH',
      status: 'DRAFT',
      records: [
        {
          employee_id: 'EMP001',
          employee_name: 'Abhishek Rai',
          account_number: '50100492819200',
          ifsc_code: 'SBIN0001234',
          net_payable_amount: 50000,
          email: 'abhishek@kylrx.ai',
        },
      ],
    };

    // Expected net is 60000, but batch records sum to 50000 -> LEDGER_MISMATCH
    const sourceLedger = { total_net: 60000 };
    const result = await pipeline.execute({ batch, payrollSourceLedger: sourceLedger });

    assert.equal(result.status, 'FAILED');
    const mismatchIssue = result.issues.find((i) => i.code === 'LEDGER_MISMATCH');
    assert(mismatchIssue);
    assert.equal(mismatchIssue.severity, ErrorSeverity.BLOCK);

    // Verify issues persisted in repository
    const storedIssues = await repo.getIssuesByBatch('BATCH-LEDGER-MISMATCH');
    assert.equal(storedIssues.length, 1);
    assert.equal(storedIssues[0].code, 'LEDGER_MISMATCH');
  });
});
