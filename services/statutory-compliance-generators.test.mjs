/**
 * ============================================================================
 * KYLRX AI HRMS - STATUTORY GENERATORS INTEGRATION TESTS
 * ============================================================================
 */

import assert from 'node:assert/strict';
import {
  generateEsicMonthlyCsv,
  generateNsdlCraScf,
  computeGratuityLedger,
} from './statutory-compliance-generators.mjs';

async function runGeneratorsTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING KYLRX AI STATUTORY COMPLIANCE GENERATOR TESTS');
  console.log('===============================================================\n');

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
  // TEST 1: ESIC Monthly Return CSV Generation
  // --------------------------------------------------------------------------
  await test('1. ESIC Return: Generates valid 6-column CSV with 0.75% EE and 3.25% ER liability', async () => {
    const records = [
      {
        esic_ip_number: '3198765432',
        employee_name: 'Rohit Sharma',
        gross_earnings: 20000,
        days_worked: 30,
      },
      {
        esic_ip_number: '3198765433',
        employee_name: 'Virat Kohli',
        gross_earnings: 15000,
        days_worked: 26,
      },
    ];

    const result = generateEsicMonthlyCsv({
      employerCode: '310009988776655',
      wageMonth: '08/2026',
      records,
    });

    assert.equal(result.file_type, 'ESIC_CSV');
    assert.match(result.file_name, /^ESIC_RETURN_310009988776655_082026\.csv$/);
    
    // Check Content
    assert.match(result.content, /^IP Number,IP Name,No of Days for which wages paid,Total Monthly Wages/);
    assert.match(result.content, /3198765432,"Rohit Sharma",30,20000\.00,,/);
    assert.match(result.content, /3198765433,"Virat Kohli",26,15000\.00,,/);

    // Verify Financials (Gross 35,000 -> EE 0.75% = 263, ER 3.25% = 1138)
    assert.equal(result.summary.total_statutory_wages, 35000);
    assert.equal(result.summary.employee_deduction_0_75, 150 + 113); // 263
    assert.equal(result.summary.employer_contribution_3_25, 650 + 488); // 1138
    assert.ok(result.checksum_sha256.length === 64);
  });

  // --------------------------------------------------------------------------
  // TEST 2: NSDL CRA SCF Caret Delimited File Generation
  // --------------------------------------------------------------------------
  await test('2. NSDL CRA SCF: Produces exact FH, BH, SD, and FT Caret ^ lines for NPS', async () => {
    const records = [
      {
        pran: '110098765432',
        employee_name: 'Jasprit Bumrah',
        employer_nps_share: 10000,
        employee_nps_share: 5000,
      },
      {
        pran: '110098765433',
        employee_name: 'Hardik Pandya',
        employer_nps_share: 8000,
        employee_nps_share: 4000,
      },
    ];

    const result = generateNsdlCraScf({
      corporateRegistrationNumber: 'CHO99887',
      paoOrPopSpCode: 'POP33445',
      monthYear: '082026',
      records,
    });

    assert.equal(result.file_type, 'NSDL_SCF_TXT');
    const lines = result.content.split('\r\n');

    // Record 1: FH
    assert.match(lines[0], /^FH\^01\^SCF\^CHO99887\^SCF\d+\^\d{8}\^1200$/);
    // Record 2: BH
    assert.equal(lines[1], 'BH^02^001^POP33445^2^27000.00^082026');
    // Record 3: SD Line 1
    assert.equal(lines[2], 'SD^1^110098765432^Jasprit Bumrah^10000.00^5000.00^15000.00^082026');
    // Record 4: SD Line 2
    assert.equal(lines[3], 'SD^2^110098765433^Hardik Pandya^8000.00^4000.00^12000.00^082026');
    // Record 5: FT
    assert.equal(lines[4], 'FT^03^1^2^27000.00');

    assert.equal(result.summary.total_subscribers, 2);
    assert.equal(result.summary.total_nps_remittance, 27000);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Gratuity Provisioning & Vesting Engine
  // --------------------------------------------------------------------------
  await test('3. Gratuity Engine: Computes 4.81% basic accrual, 5-year vesting gate, and GL journal entry', async () => {
    const employees = [
      {
        employee_id: 'EMP_V_01',
        employee_name: 'Senior Architect',
        basic_salary: 100000,
        date_of_joining: '2020-01-01', // > 5 years -> VESTED
      },
      {
        employee_id: 'EMP_NV_02',
        employee_name: 'Junior Engineer',
        basic_salary: 50000,
        date_of_joining: '2025-06-01', // < 4.657 years -> NON-VESTED
      },
    ];

    const result = computeGratuityLedger({
      organizationId: 'KYLRX-AI-HQ',
      periodMonth: '2026-08',
      employees,
    });

    assert.equal(result.summary.total_headcount, 2);
    assert.equal(result.summary.total_basic_payroll, 150000);
    
    // 4.81% of 150,000 = 7,215
    assert.equal(result.summary.monthly_gratuity_provision_expense, 7215);

    // Journal Entry
    assert.equal(result.journal_entry.debit_account, 'GL-6100 - Gratuity Expense (P&L)');
    assert.equal(result.journal_entry.debit_amount, 7215);
    assert.equal(result.journal_entry.credit_account, 'GL-2200 - Provision for Gratuity (Balance Sheet)');
    assert.equal(result.journal_entry.credit_amount, 7215);

    // Check Vesting Flags
    const v1 = result.ledger_entries.find((e) => e.employee_id === 'EMP_V_01');
    const nv2 = result.ledger_entries.find((e) => e.employee_id === 'EMP_NV_02');

    assert.equal(v1.is_vested, true);
    assert.equal(nv2.is_vested, false);
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} STATUTORY GENERATOR TESTS PASSED!`);
  console.log('===============================================================\n');
}

runGeneratorsTestSuite().catch((err) => {
  console.error('Generators Test Suite Failed:', err);
  process.exit(1);
});
