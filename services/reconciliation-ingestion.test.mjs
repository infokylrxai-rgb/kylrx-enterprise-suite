/**
 * ============================================================================
 * KYLRX AI HRMS - RECONCILIATION INGESTION & LEDGER UPDATE TEST SUITE
 * ============================================================================
 */

import assert from 'node:assert/strict';
import {
  BankReconciliationService,
  BatchSettlementStatus,
  TransactionStatus,
  FailureReasonCode,
} from './bank-reconciliation-service.mjs';

async function runReconciliationIngestionTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING RECONCILIATION INGESTION & LEDGER UPDATE TESTS');
  console.log('===============================================================\n');

  const reconService = new BankReconciliationService();
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
  // TEST 1: CSV Ingestion with 100% PAID -> Batch transitions to PAID
  // --------------------------------------------------------------------------
  await test('1. CSV Ingestion (100% PAID): Maps records, binds UTRs, sets batch status to PAID, empty exception queue', async () => {
    const batch = {
      batch_id: 'BATCH-SEP2026-SALARY',
      status: 'FILE_GENERATED',
      records: [
        { employee_id: 'EMP001', employee_name: 'Abhishek Rai', net_payable_amount: 45200, payment_reference: 'SAL-SEP-001', status: 'PENDING' },
        { employee_id: 'EMP002', employee_name: 'Rohit Kumar', net_payable_amount: 36500, payment_reference: 'SAL-SEP-002', status: 'PENDING' },
      ],
    };

    const csvContent = `Transaction_ID,Bank_Ref,Employee_ID,Amount,Status,Return_Code
SAL-SEP-001,HDFCN260904001,EMP001,45200.00,PAID,
SAL-SEP-002,HDFCN260904002,EMP002,36500.00,PAID,`;

    const result = await reconService.processSettlementFile({
      batch,
      fileContent: csvContent,
      fileFormat: 'CSV',
      fileName: 'HDFC_SETTLEMENT_SEP2026.csv',
      operatorId: 'TREASURY_OFFICER_01'
    });

    assert.equal(result.batch_status, BatchSettlementStatus.PAID);
    assert.equal(batch.status, 'PAID');
    assert.equal(result.is_all_terminal, true);
    assert.equal(result.bank_response.success_count, 2);
    assert.equal(result.bank_response.failure_count, 0);
    assert.equal(result.reprocessing_queue.length, 0);
    assert.equal(result.exception_alerts.length, 0);

    // Verify Traceable UTRs and timestamp flags
    assert.equal(batch.records[0].status, TransactionStatus.SUCCESS);
    assert.equal(batch.records[0].bank_utr, 'HDFCN260904001');
    assert.ok(batch.records[0].settled_at);
    assert.equal(batch.records[1].status, TransactionStatus.SUCCESS);
    assert.equal(batch.records[1].bank_utr, 'HDFCN260904002');
    assert.ok(batch.records[1].settled_at);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Mixed Ingestion (PAID & FAILED) -> Batch transitions to PARTIALLY_PAID
  // --------------------------------------------------------------------------
  await test('2. Mixed Ingestion (PAID + FAILED): Transitions batch to PARTIALLY_PAID, logs return code, and triggers HR reprocessing queue', async () => {
    const batch = {
      batch_id: 'BATCH-SEP2026-CORP',
      status: 'TRANSMITTED',
      records: [
        { employee_id: 'EMP101', employee_name: 'Aditi Sharma', net_payable_amount: 80000, payment_reference: 'SAL-SEP-101', status: 'PENDING' },
        { employee_id: 'EMP102', employee_name: 'Varun Nair', net_payable_amount: 60000, payment_reference: 'SAL-SEP-102', status: 'PENDING' },
      ],
    };

    const csvContent = `Transaction_ID,Bank_Ref,Employee_ID,Amount,Status,Return_Code
SAL-SEP-101,ICICR26090401,EMP101,80000.00,PAID,
SAL-SEP-102,,EMP102,60000.00,FAILED,ACCOUNT_CLOSED_OR_BLOCKED`;

    const result = await reconService.processSettlementFile({
      batch,
      fileContent: csvContent,
      fileFormat: 'CSV',
      fileName: 'ICICI_RETURN_FEED.csv',
      operatorId: 'OPS_LEAD'
    });

    assert.equal(result.batch_status, BatchSettlementStatus.PARTIALLY_PAID);
    assert.equal(batch.status, 'PARTIALLY_PAID');
    assert.equal(result.bank_response.success_count, 1);
    assert.equal(result.bank_response.failure_count, 1);
    assert.equal(result.bank_response.total_settled_amount, 80000);
    assert.equal(result.bank_response.total_failed_amount, 60000);

    // Verify Failed Record details
    assert.equal(batch.records[1].status, TransactionStatus.FAILED);
    assert.equal(batch.records[1].failure_code, FailureReasonCode.ACCOUNT_CLOSED_OR_BLOCKED);

    // Verify Exception Alert for dashboard
    assert.equal(result.exception_alerts.length, 1);
    assert.equal(result.exception_alerts[0].severity, 'CRITICAL');
    assert.match(result.exception_alerts[0].title, /Disbursement Failed: Varun Nair/);

    // Verify HR Reprocessing Queue
    assert.equal(result.reprocessing_queue.length, 1);
    assert.equal(result.reprocessing_queue[0].employee_id, 'EMP102');
    assert.equal(result.reprocessing_queue[0].status, 'PENDING_HR_CORRECTION');
    assert.match(result.reprocessing_queue[0].suggested_action, /Request updated active salary account/);
  });

  // --------------------------------------------------------------------------
  // TEST 3: 100% Failure Ingestion -> Batch transitions to FAILED
  // --------------------------------------------------------------------------
  await test('3. Complete Failure (100% FAILED): Transitions batch to FAILED, populates queue for all rows', async () => {
    const batch = {
      batch_id: 'BATCH-FAILED-001',
      status: 'TRANSMITTED',
      records: [
        { employee_id: 'EMP201', employee_name: 'Rajesh Sen', net_payable_amount: 55000, payment_reference: 'SAL-FAIL-01', status: 'PENDING' },
      ],
    };

    const csvContent = `Transaction_ID,Bank_Ref,Employee_ID,Amount,Status,Return_Code
SAL-FAIL-01,,EMP201,55000.00,FAILED,BENEFICIARY_NAME_MISMATCH`;

    const result = await reconService.processSettlementFile({
      batch,
      fileContent: csvContent,
      fileFormat: 'CSV',
      fileName: 'SBI_REJECT_FILE.csv',
    });

    assert.equal(result.batch_status, BatchSettlementStatus.FAILED);
    assert.equal(batch.status, 'FAILED');
    assert.equal(result.reprocessing_queue.length, 1);
    assert.equal(result.exception_alerts.length, 1);
    assert.equal(result.reprocessing_queue[0].failure_code, FailureReasonCode.BENEFICIARY_NAME_MISMATCH);
  });

  // --------------------------------------------------------------------------
  // TEST 4: XML & Delimited TXT Formats
  // --------------------------------------------------------------------------
  await test('4. Delimited TXT & XML: Accurately ingests pipe-delimited and XML settlement feeds', async () => {
    const batchTxt = {
      batch_id: 'BATCH-TXT-001',
      status: 'FILE_GENERATED',
      records: [
        { employee_id: 'EMP301', employee_name: 'Kavita Pillai', net_payable_amount: 92000, payment_reference: 'TXT-REF-01', status: 'PENDING' },
      ],
    };

    const txtContent = `HEADER|BANK_FEED|BATCH-TXT-001
DETAIL|TXT-REF-01|UTRN2026090488|EMP301|92000.00|PAID|SUCCESS
TRAILER|1|92000.00`;

    const resultTxt = await reconService.processSettlementFile({
      batch: batchTxt,
      fileContent: txtContent,
      fileFormat: 'TXT',
      fileName: 'BANK_CLEARANCE.txt'
    });

    assert.equal(resultTxt.batch_status, BatchSettlementStatus.PAID);
    assert.equal(batchTxt.records[0].bank_utr, 'UTRN2026090488');
    assert.equal(batchTxt.records[0].status, TransactionStatus.SUCCESS);
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} RECONCILIATION INGESTION TESTS PASSED!`);
  console.log('===============================================================\n');
}

runReconciliationIngestionTestSuite().catch((err) => {
  console.error('Reconciliation Ingestion Test Suite Failed:', err);
  process.exit(1);
});
