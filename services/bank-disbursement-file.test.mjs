/**
 * ============================================================================
 * KYLRX AI HRMS - BANK DISBURSEMENT FILE GENERATION ENGINE INTEGRATION TESTS
 * ============================================================================
 */

import assert from 'node:assert/strict';
import {
  BankDisbursementFileEngine,
  BankLayout,
  maskAccountNumber,
  computeSha256,
} from './bank-disbursement-file-engine.mjs';

async function runBankEngineTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING KYLRX AI BANK DISBURSEMENT FILE GENERATION TESTS');
  console.log('===============================================================\n');

  const engine = new BankDisbursementFileEngine({
    debitAccountNumber: '50200088997766',
    companyName: 'KYLRX AI ENTERPRISE PRIVATE LIMITED',
  });

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
  // TEST 1: Account Number Masking Utility
  // --------------------------------------------------------------------------
  await test('1. Account Masking: Correctly masks account numbers leaving only last 4 digits visible', async () => {
    assert.equal(maskAccountNumber('50100456789012'), '••••••••••9012');
    assert.equal(maskAccountNumber('123456789'), '•••••6789');
    assert.equal(maskAccountNumber('1234'), '1234');
    assert.equal(maskAccountNumber(''), '');
  });

  // --------------------------------------------------------------------------
  // TEST 2: HDFC E-Net Layout Generation & SHA-256 Checksum
  // --------------------------------------------------------------------------
  await test('2. HDFC E-Net: Compiles valid CSV, assigns NEFT/RTGS rail, and produces accurate SHA-256', async () => {
    const batch = {
      batch_id: 'BATCH-HDFC-001',
      payroll_run_id: 'PR-2026-08',
      batch_name: 'Core Tech Payout',
      status: 'APPROVED',
      summary: { total_amount: 350000 },
      records: [
        {
          employee_id: 'EMP101',
          employee_name: 'Ananya Roy',
          net_payable_amount: 150000, // < 200,000 -> NEFT ('N')
          ifsc_code: 'HDFC0001234',
          account_number_raw: '50100456789012',
          payment_reference: 'KYLRX-HDFC-001',
          email: 'ananya@kylrx.ai',
        },
        {
          employee_id: 'EMP102',
          employee_name: 'Vikram Joshi',
          net_payable_amount: 200000, // >= 200,000 -> RTGS ('R')
          ifsc_code: 'ICIC0005678',
          account_number_raw: '00110156789033',
          payment_reference: 'KYLRX-HDFC-002',
          email: 'vikram@kylrx.ai',
        },
      ],
    };

    const payrollRun = { run_id: 'PR-2026-08', status: 'APPROVED' };

    const result = await engine.generateAndLockBankFile({
      batch,
      payrollRun,
      bankLayout: BankLayout.HDFC_ENET,
      operatorId: 'usr_fin_ops',
      operatorEmail: 'finance@kylrx.ai',
      ipAddress: '10.0.4.15',
    });

    const { bank_file, payment_batch, payroll_run, disbursement_log, file_content } = result;

    // Verify CSV Headers & Content
    assert.match(file_content, /^Transaction Type,Beneficiary Account Number,Amount,Beneficiary Name/);
    assert.match(file_content, /N,"50100456789012",150000.00,"Ananya Roy","KYLRX-HDFC-001",HDFC0001234/);
    assert.match(file_content, /R,"00110156789033",200000.00,"Vikram Joshi","KYLRX-HDFC-002",ICIC0005678/);

    // Verify SHA-256 Checksum
    const expectedChecksum = computeSha256(file_content);
    assert.equal(bank_file.checksum_sha256, expectedChecksum);
    assert.equal(bank_file.record_count, 2);
    assert.equal(bank_file.total_disbursed_amount, 350000);

    // Verify State Locking
    assert.equal(payment_batch.status, 'FILE_GENERATED');
    assert.equal(payment_batch.is_locked, true);
    assert.equal(payroll_run.status, 'LOCKED');

    // Verify UI Masking (raw stripped, masked preserved)
    assert.equal(payment_batch.records[0].account_number_masked, '••••••••••9012');
    assert.equal(payment_batch.records[0].account_number_raw, undefined);

    // Verify Immutable Audit Log
    assert.equal(disbursement_log.checksum_sha256, expectedChecksum);
    assert.equal(disbursement_log.operator_id, 'usr_fin_ops');
    assert.equal(disbursement_log.action, 'BANK_DISBURSEMENT_FILE_GENERATED_AND_LOCKED');
  });

  // --------------------------------------------------------------------------
  // TEST 3: ICICI CIB Layout Generation
  // --------------------------------------------------------------------------
  await test('3. ICICI CIB: Generates compliant CIB layout with currency and customer references', async () => {
    const batch = {
      batch_id: 'BATCH-ICICI-001',
      payroll_run_id: 'PR-2026-08',
      batch_name: 'Staff Payout',
      status: 'CHECKER_APPROVED',
      summary: { total_amount: 80000 },
      records: [
        {
          employee_id: 'EMP103',
          employee_name: 'Pooja Hegde',
          net_payable_amount: 80000,
          ifsc_code: 'ICIC0009988',
          account_number_raw: '00110199887766',
          payment_reference: 'ICICI-REF-001',
        },
      ],
    };

    const result = await engine.generateAndLockBankFile({
      batch,
      bankLayout: BankLayout.ICICI_CIB,
      operatorId: 'usr_checker_01',
      operatorEmail: 'checker@kylrx.ai',
    });

    const { file_content, bank_file } = result;
    assert.match(file_content, /^Payment Mode,Debit Account Number,Beneficiary Account Number,Beneficiary Name/);
    assert.match(file_content, /NEFT,"50200088997766","00110199887766","Pooja Hegde",80000.00,INR,ICIC0009988/);
    assert.equal(bank_file.bank_layout, BankLayout.ICICI_CIB);
  });

  // --------------------------------------------------------------------------
  // TEST 4: SBI CMP Layout Generation
  // --------------------------------------------------------------------------
  await test('4. SBI CMP: Generates valid SBI Corporate Multi-Payment structure', async () => {
    const batch = {
      batch_id: 'BATCH-SBI-001',
      payroll_run_id: 'PR-2026-08',
      batch_name: 'Operations Team Payout',
      status: 'APPROVED',
      summary: { total_amount: 45000 },
      records: [
        {
          employee_id: 'EMP104',
          employee_name: 'Sunil Gavaskar',
          net_payable_amount: 45000,
          ifsc_code: 'SBIN0004321',
          account_number_raw: '201994883921',
          email: 'sunil@kylrx.ai',
        },
      ],
    };

    const result = await engine.generateAndLockBankFile({
      batch,
      bankLayout: BankLayout.SBI_CMP,
      operatorId: 'usr_maker_01',
      operatorEmail: 'maker@kylrx.ai',
    });

    const { file_content, bank_file } = result;
    assert.match(file_content, /^Txn Type,Debit Account No,Beneficiary Name,Beneficiary Account No/);
    assert.match(file_content, /NEFT,"50200088997766","Sunil Gavaskar","201994883921",45000.00,SBIN0004321/);
    assert.equal(bank_file.bank_layout, BankLayout.SBI_CMP);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Guard against Unapproved Batches
  // --------------------------------------------------------------------------
  await test('5. Security Guard: Throws error if batch is DRAFT or not yet APPROVED', async () => {
    const unapprovedBatch = {
      batch_id: 'BATCH-UNAPPROVED',
      status: 'DRAFT',
      records: [{ employee_id: 'EMP001', net_payable_amount: 1000 }],
    };

    await assert.rejects(
      async () => {
        await engine.generateAndLockBankFile({
          batch: unapprovedBatch,
          operatorId: 'usr_hacker',
          operatorEmail: 'hacker@kylrx.ai',
        });
      },
      (err) => {
        assert.match(err.message, /Cannot generate bank file for batch/);
        assert.match(err.message, /must be APPROVED by Checker first/);
        return true;
      }
    );
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} BANK DISBURSEMENT ENGINE TESTS PASSED!`);
  console.log('===============================================================\n');
}

runBankEngineTestSuite().catch((err) => {
  console.error('Bank Engine Test Suite Failed:', err);
  process.exit(1);
});
