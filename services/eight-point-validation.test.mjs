/**
 * ============================================================================
 * KYLRX AI HRMS - 8-POINT AUTOMATED VALIDATION GATE TEST SUITE
 * ============================================================================
 */

import assert from 'node:assert/strict';
import {
  EightPointValidationGateService,
  GateCode,
  ValidationSeverity,
} from './eight-point-validation-gate.mjs';

async function runEightPointTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING KYLRX AI 8-POINT VALIDATION GATE TEST SUITE');
  console.log('===============================================================\n');

  const gateService = new EightPointValidationGateService();
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
  // TEST 1: Clean Batch Pass
  // --------------------------------------------------------------------------
  await test('1. 100% Clean Records: All 8 gates passed, export unblocked', async () => {
    const batch = {
      batch_id: 'BATCH-CLEAN-8PT',
      status: 'APPROVED',
      summary: { total_amount: 150000 },
    };
    const records = [
      {
        employee_id: 'EMP001',
        employee_name: 'Ananya Roy',
        gross_earnings: 120000,
        total_deductions: 20000,
        net_payable_amount: 100000,
        account_number_raw: '50100456789012',
        ifsc_code: 'HDFC0001234',
        payment_reference: 'REF-001',
      },
      {
        employee_id: 'EMP002',
        employee_name: 'Karan Mehra',
        gross_earnings: 60000,
        total_deductions: 10000,
        net_payable_amount: 50000,
        account_number_raw: '00110156789033',
        ifsc_code: 'ICIC0005678',
        payment_reference: 'REF-002',
      },
    ];

    const result = gateService.evaluate(batch, records);
    assert.equal(result.is_gate_passed, true);
    assert.equal(result.can_generate_bank_file, true);
    assert.equal(result.blocking_issues.length, 0);
    assert.equal(result.checklist.every((c) => c.isPassed), true);
  });

  // --------------------------------------------------------------------------
  // TEST 2: GATE 1 - Unapproved Batch
  // --------------------------------------------------------------------------
  await test('2. Gate 1: Unapproved batch fails approval gate and blocks export', async () => {
    const unapprovedBatch = {
      batch_id: 'BATCH-UNAPPROVED',
      status: 'DRAFT', // Not approved
      summary: { total_amount: 50000 },
    };
    const records = [
      {
        employee_id: 'EMP003',
        net_payable_amount: 50000,
        account_number_raw: '50100456789012',
        ifsc_code: 'HDFC0001234',
        payment_reference: 'REF-003',
      },
    ];

    const result = gateService.evaluate(unapprovedBatch, records);
    assert.equal(result.is_gate_passed, false);
    assert.equal(result.can_generate_bank_file, false);
    
    const gate1 = result.blocking_issues.find((i) => i.code === GateCode.GATE_01_PAYROLL_APPROVAL);
    assert.ok(gate1);
    assert.equal(gate1.severity, ValidationSeverity.BLOCKING);
  });

  // --------------------------------------------------------------------------
  // TEST 3: GATE 2 - Math Calculation Integrity
  // --------------------------------------------------------------------------
  await test('3. Gate 2: Gross - Deductions != Net triggers BLOCKING issue', async () => {
    const batch = { batch_id: 'BATCH-MATH', status: 'APPROVED', summary: { total_amount: 80000 } };
    const records = [
      {
        employee_id: 'EMP004',
        gross_earnings: 100000,
        total_deductions: 10000, // Should be 90,000
        net_payable_amount: 80000, // Delta of 10,000
        account_number_raw: '50100456789012',
        ifsc_code: 'HDFC0001234',
        payment_reference: 'REF-004',
      },
    ];

    const result = gateService.evaluate(batch, records);
    assert.equal(result.is_gate_passed, false);
    const gate2 = result.blocking_issues.find((i) => i.code === GateCode.GATE_02_CALC_CONSISTENCY);
    assert.ok(gate2);
  });

  // --------------------------------------------------------------------------
  // TEST 4: GATE 3 & 4 - Account Number & Indian IFSC Format
  // --------------------------------------------------------------------------
  await test('4. Gate 3 & 4: Invalid account length and non-compliant IFSC fail checks', async () => {
    const batch = { batch_id: 'BATCH-BANK-ERR', status: 'APPROVED', summary: { total_amount: 40000 } };
    const records = [
      {
        employee_id: 'EMP005',
        net_payable_amount: 40000,
        account_number_raw: '1234', // Only 4 digits (< 9)
        ifsc_code: 'HDFC_INVALID', // Invalid IFSC
        payment_reference: 'REF-005',
      },
    ];

    const result = gateService.evaluate(batch, records);
    assert.equal(result.is_gate_passed, false);

    const gate3 = result.blocking_issues.find((i) => i.code === GateCode.GATE_03_ACCOUNT_FORMAT);
    const gate4 = result.blocking_issues.find((i) => i.code === GateCode.GATE_04_IFSC_REGEX);

    assert.ok(gate3, 'Must fail account length');
    assert.ok(gate4, 'Must fail IFSC format');
  });

  // --------------------------------------------------------------------------
  // TEST 5: GATE 5 - Duplicate Detection
  // --------------------------------------------------------------------------
  await test('5. Gate 5: Duplicate employee ID or account number flagged as BLOCKING', async () => {
    const batch = { batch_id: 'BATCH-DUP', status: 'APPROVED', summary: { total_amount: 60000 } };
    const records = [
      { employee_id: 'EMP006', net_payable_amount: 30000, account_number_raw: '50100456789012', ifsc_code: 'HDFC0001234', payment_reference: 'REF-006A' },
      { employee_id: 'EMP006', net_payable_amount: 30000, account_number_raw: '50100456789012', ifsc_code: 'HDFC0001234', payment_reference: 'REF-006B' },
    ];

    const result = gateService.evaluate(batch, records);
    assert.equal(result.is_gate_passed, false);

    const gate5 = result.blocking_issues.find((i) => i.code === GateCode.GATE_05_DUPLICATE_PREVENTION);
    assert.ok(gate5);
  });

  // --------------------------------------------------------------------------
  // TEST 6: GATE 6 - Positive Net Payout
  // --------------------------------------------------------------------------
  await test('6. Gate 6: Zero or negative payout fails positive pay gate', async () => {
    const batch = { batch_id: 'BATCH-ZERO', status: 'APPROVED', summary: { total_amount: 0 } };
    const records = [
      { employee_id: 'EMP007', net_payable_amount: -500, account_number_raw: '50100456789012', ifsc_code: 'HDFC0001234', payment_reference: 'REF-007' },
    ];

    const result = gateService.evaluate(batch, records);
    assert.equal(result.is_gate_passed, false);

    const gate6 = result.blocking_issues.find((i) => i.code === GateCode.GATE_06_POSITIVE_PAY);
    assert.ok(gate6);
  });

  // --------------------------------------------------------------------------
  // TEST 7: GATE 8 - Aggregate Ledger Balance Disparity
  // --------------------------------------------------------------------------
  await test('7. Gate 8: Disparity between stated batch amount and line items fails aggregate check', async () => {
    const batch = {
      batch_id: 'BATCH-LEDGER-ERR',
      status: 'APPROVED',
      summary: { total_amount: 500000 }, // Stated 500,000
    };
    const records = [
      { employee_id: 'EMP008', net_payable_amount: 50000, account_number_raw: '50100456789012', ifsc_code: 'HDFC0001234', payment_reference: 'REF-008' },
    ]; // Line items sum only 50,000

    const result = gateService.evaluate(batch, records);
    assert.equal(result.is_gate_passed, false);

    const gate8 = result.blocking_issues.find((i) => i.code === GateCode.GATE_08_AGGREGATE_LEDGER);
    assert.ok(gate8);
    assert.equal(gate8.severity, ValidationSeverity.BLOCKING);
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} 8-POINT VALIDATION TESTS PASSED!`);
  console.log('===============================================================\n');
}

runEightPointTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
