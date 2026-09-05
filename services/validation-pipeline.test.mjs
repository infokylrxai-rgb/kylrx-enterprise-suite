/**
 * ============================================================================
 * KYLRX AI HRMS - PRE-DISBURSEMENT VALIDATION PIPELINE INTEGRATION TESTS
 * ============================================================================
 */

import assert from 'node:assert/strict';
import {
  PreDisbursementValidationPipeline,
  IssueSeverity,
  ValidationCode,
} from './validation-pipeline-service.mjs';

async function runValidationTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING KYLRX AI PRE-DISBURSEMENT VALIDATION PIPELINE TESTS');
  console.log('===============================================================\n');

  const pipeline = new PreDisbursementValidationPipeline();
  let passedTests = 0;
  let totalTests = 0;

  async function test(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Clean Records Gate Pass
  // --------------------------------------------------------------------------
  await test('1. Clean Records: All checks pass -> 0 blocking issues, BankFile export allowed, HR alert null', async () => {
    const batch = { batch_id: 'BATCH-CLEAN-001', batch_name: 'Clean August Salary', batch_type: 'SALARY' };
    const records = [
      {
        employee_id: 'EMP101',
        employee_name: 'Priya Nair',
        gross_earnings: 100000,
        total_deductions: 15000,
        net_payable_amount: 85000,
        ifsc_code: 'HDFC0001234',
        account_number_raw: '50100456789012',
        account_number_masked: '••••••••9012',
        payment_reference: 'KYLRX-REF-001',
        is_pf_covered: true,
        uan: '100902345678',
        is_esic_covered: false,
        is_nps_opt_in: true,
        pran: '110098765432',
        is_bank_verified: true,
      },
    ];

    const result = pipeline.validateBatch(batch, records);
    assert.equal(result.is_gate_passed, true);
    assert.equal(result.can_generate_bank_file, true);
    assert.equal(result.summary.blocking_count, 0);
    assert.equal(result.hr_task_payload, null);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Indian IFSC Format Blocking Rule
  // --------------------------------------------------------------------------
  await test('2. IFSC Regex Failure: Flags BLOCKING issue and blocks BankFile export', async () => {
    const batch = { batch_id: 'BATCH-IFSC-ERR', batch_name: 'Bad IFSC Batch', batch_type: 'SALARY' };
    const records = [
      {
        employee_id: 'EMP102',
        employee_name: 'Ramesh Kumar',
        gross_earnings: 50000,
        total_deductions: 5000,
        net_payable_amount: 45000,
        ifsc_code: 'HDFC01234', // Invalid: only 9 chars instead of 11
        account_number_raw: '50100456789012',
        payment_reference: 'KYLRX-REF-002',
        is_pf_covered: false,
        is_esic_covered: false,
      },
    ];

    const result = pipeline.validateBatch(batch, records);
    assert.equal(result.is_gate_passed, false);
    assert.equal(result.can_generate_bank_file, false);
    assert.equal(result.summary.blocking_count, 1);

    const ifscIssue = result.issues.find((i) => i.code === ValidationCode.INVALID_IFSC);
    assert.ok(ifscIssue);
    assert.equal(ifscIssue.severity, IssueSeverity.BLOCKING);
    assert.match(ifscIssue.message, /Invalid IFSC format/);

    // Verify HR Task alert generated
    assert.ok(result.hr_task_payload);
    assert.equal(result.hr_task_payload.priority, 'CRITICAL');
    assert.equal(result.hr_task_payload.payload.total_blocking_count, 1);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Math Integrity Gate (Gross - Deductions = Net)
  // --------------------------------------------------------------------------
  await test('3. Math Integrity: Mismatch between Gross, Deductions, and Net triggers CALCULATION_MISMATCH', async () => {
    const batch = { batch_id: 'BATCH-MATH-ERR', batch_name: 'Math Error Batch', batch_type: 'SALARY' };
    const records = [
      {
        employee_id: 'EMP103',
        employee_name: 'Anil Kapoor',
        gross_earnings: 80000,
        total_deductions: 10000, // Gross - Deductions should be 70,000
        net_payable_amount: 75000, // Manipulated or desynced net
        ifsc_code: 'ICIC0005678',
        account_number_raw: '00110156789033',
        payment_reference: 'KYLRX-REF-003',
        is_pf_covered: false,
        is_esic_covered: false,
      },
    ];

    const result = pipeline.validateBatch(batch, records);
    assert.equal(result.is_gate_passed, false);
    assert.equal(result.can_generate_bank_file, false);

    const mathIssue = result.issues.find((i) => i.code === ValidationCode.CALCULATION_MISMATCH);
    assert.ok(mathIssue);
    assert.equal(mathIssue.severity, IssueSeverity.BLOCKING);
    assert.match(mathIssue.message, /Mathematical integrity error/);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Duplicate Detection (Employee, Account, Reference)
  // --------------------------------------------------------------------------
  await test('4. Duplicate Detection: Detects duplicate employees, accounts, and payment references', async () => {
    const batch = { batch_id: 'BATCH-DUP-ERR', batch_name: 'Duplicate Batch', batch_type: 'SALARY' };
    const records = [
      {
        employee_id: 'EMP104',
        employee_name: 'Sunita Rao',
        gross_earnings: 60000,
        total_deductions: 6000,
        net_payable_amount: 54000,
        ifsc_code: 'SBIN0001234',
        account_number_raw: '10293847561',
        payment_reference: 'REF-DUP-01',
        is_pf_covered: false,
        is_esic_covered: false,
      },
      {
        employee_id: 'EMP104', // Duplicate employee_id
        employee_name: 'Sunita Rao',
        gross_earnings: 60000,
        total_deductions: 6000,
        net_payable_amount: 54000,
        ifsc_code: 'SBIN0001234',
        account_number_raw: '10293847561', // Duplicate account
        payment_reference: 'REF-DUP-01', // Duplicate reference
        is_pf_covered: false,
        is_esic_covered: false,
      },
    ];

    const result = pipeline.validateBatch(batch, records);
    assert.equal(result.is_gate_passed, false);
    
    const dupEmp = result.issues.find((i) => i.code === ValidationCode.DUPLICATE_EMPLOYEE_ID);
    const dupAcc = result.issues.find((i) => i.code === ValidationCode.DUPLICATE_ACCOUNT_NUMBER);
    const dupRef = result.issues.find((i) => i.code === ValidationCode.DUPLICATE_PAYMENT_REF);

    assert.ok(dupEmp, 'Must flag duplicate employee ID');
    assert.ok(dupAcc, 'Must flag duplicate account number');
    assert.ok(dupRef, 'Must flag duplicate payment reference');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Statutory Identifiers (PF UAN, ESIC IP No, NPS PRAN)
  // --------------------------------------------------------------------------
  await test('5. Statutory Identifiers: Blocks export when covered employees lack UAN, IP No, or PRAN', async () => {
    const batch = { batch_id: 'BATCH-STAT-ERR', batch_name: 'Statutory Issue Batch', batch_type: 'SALARY' };
    const records = [
      {
        employee_id: 'EMP_PF_ERR',
        employee_name: 'Worker One',
        gross_earnings: 30000,
        total_deductions: 3600,
        net_payable_amount: 26400,
        ifsc_code: 'HDFC0001234',
        account_number_raw: '50100456789012',
        payment_reference: 'REF-STAT-01',
        is_pf_covered: true,
        uan: '12345', // Invalid UAN (not 12 digits)
        is_esic_covered: false,
      },
      {
        employee_id: 'EMP_ESIC_ERR',
        employee_name: 'Worker Two',
        gross_earnings: 18000, // Under ₹21,000 ESIC ceiling
        total_deductions: 135,
        net_payable_amount: 17865,
        ifsc_code: 'HDFC0001234',
        account_number_raw: '50100456789088',
        payment_reference: 'REF-STAT-02',
        is_pf_covered: false,
        // Missing esic_ip_number
      },
      {
        employee_id: 'EMP_NPS_ERR',
        employee_name: 'Worker Three',
        gross_earnings: 90000,
        total_deductions: 10000,
        net_payable_amount: 80000,
        ifsc_code: 'HDFC0001234',
        account_number_raw: '50100456789099',
        payment_reference: 'REF-STAT-03',
        is_pf_covered: false,
        is_esic_covered: false,
        is_nps_opt_in: true,
        pran: null, // Missing PRAN for NPS opt-in
      },
    ];

    const result = pipeline.validateBatch(batch, records);
    assert.equal(result.is_gate_passed, false);

    const pfIssue = result.issues.find((i) => i.code === ValidationCode.PF_MISSING_OR_INVALID_UAN);
    const esicIssue = result.issues.find((i) => i.code === ValidationCode.ESIC_MISSING_OR_INVALID_IP);
    const npsIssue = result.issues.find((i) => i.code === ValidationCode.NPS_MISSING_OR_INVALID_PRAN);

    assert.ok(pfIssue, 'Must flag missing/invalid PF UAN');
    assert.ok(esicIssue, 'Must flag missing ESIC IP number for wage <= ₹21k');
    assert.ok(npsIssue, 'Must flag missing PRAN for NPS opt-in');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Resolution Workflow (Resolving BLOCKING issues unblocks export)
  // --------------------------------------------------------------------------
  await test('6. Resolution Workflow: Resolving issues unlocks can_generate_bank_file', async () => {
    const batch = { batch_id: 'BATCH-RESOLVE-001', batch_name: 'Fix and Re-validate', batch_type: 'SALARY' };
    const records = [
      {
        employee_id: 'EMP105',
        employee_name: 'Deepak Joshi',
        gross_earnings: 40000,
        total_deductions: 4000,
        net_payable_amount: 36000,
        ifsc_code: 'INVALID_IFSC_CODE',
        account_number_raw: '50100456789012',
        payment_reference: 'REF-RES-01',
        is_pf_covered: false,
        is_esic_covered: false,
      },
    ];

    // Initial validation fails
    const initialResult = pipeline.validateBatch(batch, records);
    assert.equal(initialResult.can_generate_bank_file, false);
    assert.equal(initialResult.issues.length, 1);

    // Simulate HR resolving the issue
    const issue = initialResult.issues[0];
    issue.resolved_at = new Date().toISOString();
    issue.resolved_by = 'hr_admin_user';
    issue.resolution_notes = 'Corrected IFSC code to HDFC0001234 via bank portal check.';

    // Gatekeeper evaluates resolved issues list
    const unblockedGate = pipeline.canGenerateBankFile(initialResult.issues);
    assert.equal(unblockedGate.can_generate_file, true);
    assert.equal(unblockedGate.blocking_count, 0);
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} VALIDATION PIPELINE TESTS PASSED!`);
  console.log('===============================================================\n');
}

runValidationTestSuite().catch((err) => {
  console.error('Validation Test Suite Failed:', err);
  process.exit(1);
});
