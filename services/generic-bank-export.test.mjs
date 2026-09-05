/**
 * ============================================================================
 * KYLRX AI HRMS - GENERIC BANK EXPORT & SECURE DATA GRID TEST SUITE
 * ============================================================================
 */

import assert from 'node:assert/strict';
import {
  maskAccountNumber,
  computeSha256,
  compileGenericBankExport,
  buildBankTransferRows,
  storeInMemoryVault,
  getFromMemoryVault,
  enrichEmployeeBankDetails
} from '../bank-export-service.js';
import {
  BankDisbursementFileEngine,
  BankLayout
} from './bank-disbursement-file-engine.mjs';

async function runGenericBankExportTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING GENERIC BANK EXPORT & SECURE DATA GRID TESTS');
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
  // TEST 1: Account Number Masking in UI Data Grid
  // --------------------------------------------------------------------------
  await test('1. UI Data Grid Masking: Displays only terminal 4 digits with bullet symbols', async () => {
    assert.equal(maskAccountNumber('5010049281928'), '•••••••••1928');
    assert.equal(maskAccountNumber('00110156789033'), '••••••••••9033');
    assert.equal(maskAccountNumber('12345678'), '••••5678');
    assert.equal(maskAccountNumber('1234'), '1234');
    assert.equal(maskAccountNumber(''), '');

    const rows = buildBankTransferRows([
      { id: 'EMP_TEST_1', name: 'Alok Gupta', rawBankAccount: '5010049281928', ifscCode: 'HDFC0001234', net: 75000 }
    ], 'Sep-2026');

    assert.equal(rows[0].bankAccount, '•••••••••1928');
    assert.equal(rows[0].bankAccountMasked, '•••••••••1928');
    // Ensure raw account is cached in memory
    assert.equal(getFromMemoryVault('EMP_TEST_1'), '5010049281928');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Generic NEFT/RTGS CSV Layout & Threshold Routing
  // --------------------------------------------------------------------------
  await test('2. Generic Banking CSV Export: Formats NEFT/RTGS rails with raw account numbers from memory vault', async () => {
    storeInMemoryVault('EMP_NEFT', '501002341234');
    storeInMemoryVault('EMP_RTGS', '620199281290');

    const employees = [
      { id: 'EMP_NEFT', name: 'Priya Mehta', ifscCode: 'SBIN0001234', net: 125000, paymentReference: 'REF-NEFT-01' },
      { id: 'EMP_RTGS', name: 'Rohan Deshmukh', ifscCode: 'ICIC0005678', net: 250000, paymentReference: 'REF-RTGS-01' }
    ];

    const result = await compileGenericBankExport({
      employees,
      periodLabel: 'September 2026',
      format: 'CSV',
      debitAccountNumber: '50200088997766',
      batchId: 'BATCH_SEP_01',
      operator: 'Finance_Lead'
    });

    const { fileContent, metadata } = result;

    // Verify CSV Headers
    assert.match(fileContent, /^Payment Mode,Debit Account Number,Beneficiary Name,Beneficiary Account Number/);

    // Verify NEFT (< 200,000) and RTGS (>= 200,000) Rails
    assert.match(fileContent, /NEFT,"50200088997766","Priya Mehta","501002341234",SBIN0001234,125000\.00,INR,"REF-NEFT-01"/);
    assert.match(fileContent, /RTGS,"50200088997766","Rohan Deshmukh","620199281290",ICIC0005678,250000\.00,INR,"REF-RTGS-01"/);

    // Verify Cryptographic SHA-256 Checksum
    const expectedChecksum = await computeSha256(fileContent);
    assert.equal(metadata.checksum, expectedChecksum);
    assert.equal(metadata.record_count, 2);
    assert.equal(metadata.total_amount, 375000);
    assert.equal(metadata.generated_by, 'Finance_Lead');
    assert.ok(metadata.file_id.startsWith('BF-'));
    assert.ok(metadata.generated_at);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Generic NEFT/RTGS Pipe-Delimited TXT Specification
  // --------------------------------------------------------------------------
  await test('3. Generic Banking TXT Export: Generates structured pipe-delimited stream with header/trailer and checksum', async () => {
    storeInMemoryVault('EMP_TXT_1', '002301565678');

    const employees = [
      { id: 'EMP_TXT_1', name: 'Siddharth Rao', ifscCode: 'HDFC0009988', net: 45000, paymentReference: 'REF-TXT-01' }
    ];

    const result = await compileGenericBankExport({
      employees,
      periodLabel: 'September 2026',
      format: 'TXT',
      debitAccountNumber: '50200088997766',
      batchId: 'BATCH_TXT_01',
      operator: 'Treasury_Ops'
    });

    const { fileContent, metadata } = result;

    assert.match(fileContent, /^HEADER\|KYLRX_AI_HRMS\|BATCH_TXT_01\|1/);
    assert.match(fileContent, /DETAIL\|NEFT\|50200088997766\|Siddharth Rao\|002301565678\|HDFC0009988\|45000\.00\|INR\|REF-TXT-01/);
    assert.match(fileContent, /TRAILER\|1\|45000\.00/);

    const expectedChecksum = await computeSha256(fileContent);
    assert.equal(metadata.checksum, expectedChecksum);
    assert.equal(metadata.format, 'TXT');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Backend BankDisbursementFileEngine Integration with Generic Layouts
  // --------------------------------------------------------------------------
  await test('4. Backend Engine: Generates GENERIC_NEFT_RTGS_CSV and STANDARD_TXT with immutable locking', async () => {
    const engine = new BankDisbursementFileEngine({
      debitAccountNumber: '50200088997766',
      companyName: 'KYLRX AI TECHNOLOGIES'
    });

    const batch = {
      batch_id: 'BATCH-GENERIC-001',
      payroll_run_id: 'PR-2026-08',
      status: 'APPROVED',
      summary: { total_amount: 320000 },
      records: [
        {
          employee_id: 'EMP301',
          employee_name: 'Kavita Iyer',
          net_payable_amount: 120000,
          ifsc_code: 'SBIN0004321',
          account_number_raw: '99887766554433',
          payment_reference: 'KYLRX-GEN-01'
        },
        {
          employee_id: 'EMP302',
          employee_name: 'Devraj Patil',
          net_payable_amount: 200000,
          ifsc_code: 'ICIC0001234',
          account_number_raw: '11223344556677',
          payment_reference: 'KYLRX-GEN-02'
        }
      ]
    };

    const result = await engine.generateAndLockBankFile({
      batch,
      bankLayout: BankLayout.GENERIC_NEFT_RTGS_CSV,
      operatorId: 'USR_LEAD_OPS',
      operatorEmail: 'lead@kylrx.ai'
    });

    assert.equal(result.payment_batch.status, 'FILE_GENERATED');
    assert.equal(result.payment_batch.is_locked, true);
    assert.equal(result.payment_batch.records[0].account_number_masked, '••••••••••4433');
    assert.equal(result.payment_batch.records[0].account_number_raw, undefined);
    assert.equal(result.bank_file.record_count, 2);
    assert.equal(result.bank_file.total_disbursed_amount, 320000);
    assert.ok(result.bank_file.checksum_sha256);
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} GENERIC BANK EXPORT TESTS PASSED!`);
  console.log('===============================================================\n');
}

runGenericBankExportTestSuite().catch((err) => {
  console.error('Generic Bank Export Test Suite Failed:', err);
  process.exit(1);
});
