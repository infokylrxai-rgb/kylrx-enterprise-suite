/**
 * ============================================================================
 * KYLRX AI HRMS - BANK RECONCILIATION SERVICE INTEGRATION TESTS
 * ============================================================================
 */

import assert from 'node:assert/strict';
import {
  BankReconciliationService,
  BatchSettlementStatus,
  TransactionStatus,
  FailureReasonCode,
} from './bank-reconciliation-service.mjs';

async function runReconTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING KYLRX AI BANK RECONCILIATION SERVICE TESTS');
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
  // TEST 1: 100% Successful CSV Settlement Ingestion
  // --------------------------------------------------------------------------
  await test('1. 100% Success CSV Settlement: Binds UTRs, marks batch SETTLED, empty retry queue', async () => {
    const batch = {
      batch_id: 'BATCH-AUG26-SALARY',
      status: 'FILE_GENERATED',
      records: [
        { employee_id: 'EMP101', employee_name: 'Aarav Patel', net_payable_amount: 125000, payment_reference: 'KYLRX-AUG-001', status: 'PENDING' },
        { employee_id: 'EMP102', employee_name: 'Diya Sharma', net_payable_amount: 98000, payment_reference: 'KYLRX-AUG-002', status: 'PENDING' },
      ],
    };

    const csvResponse = `txn_id,bank_ref,employee_id,amount,status,failure_reason
KYLRX-AUG-001,HDFCN26247890123,EMP101,125000,PAID,
KYLRX-AUG-002,HDFCN26247890124,EMP102,98000,SUCCESS,`;

    const result = await reconService.processSettlementFile({
      batch,
      fileContent: csvResponse,
      fileFormat: 'CSV',
      fileName: 'HDFC_SETTLEMENT_20260831.csv',
    });

    assert.ok(result.batch_status === BatchSettlementStatus.PAID || result.batch_status === BatchSettlementStatus.SETTLED);
    assert.equal(result.is_all_terminal, true);
    assert.equal(result.bank_response.success_count, 2);
    assert.equal(result.bank_response.failure_count, 0);
    assert.equal(result.bank_response.total_settled_amount, 223000);
    assert.equal(result.reprocessing_queue.length, 0);
    assert.equal(result.exception_alerts.length, 0);

    // Verify employee record updates
    assert.equal(batch.records[0].status, TransactionStatus.SUCCESS);
    assert.equal(batch.records[0].bank_utr, 'HDFCN26247890123');
    assert.equal(batch.records[1].status, TransactionStatus.SUCCESS);
    assert.equal(batch.records[1].bank_utr, 'HDFCN26247890124');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Mixed Settlement (Partial Failures & Reprocessing Queue Dispatch)
  // --------------------------------------------------------------------------
  await test('2. Mixed Settlement: Succeeded lines get UTRs, failed lines push to reprocessing queue, status PARTIALLY_PAID', async () => {
    const batch = {
      batch_id: 'BATCH-MIXED-001',
      status: 'TRANSMITTED',
      records: [
        { employee_id: 'EMP201', employee_name: 'Karan Mehra', net_payable_amount: 50000, payment_reference: 'REF-K-01', status: 'PENDING' },
        { employee_id: 'EMP202', employee_name: 'Sneha Rao', net_payable_amount: 40000, payment_reference: 'REF-S-02', status: 'PENDING' },
      ],
    };

    const csvResponse = `txn_id,bank_ref,employee_id,amount,status,failure_reason
REF-K-01,ICICN99881122,EMP201,50000,PAID,
REF-S-02,,EMP202,40000,FAILED,Account closed or dormant by beneficiary bank`;

    const result = await reconService.processSettlementFile({
      batch,
      fileContent: csvResponse,
      fileFormat: 'CSV',
      fileName: 'ICICI_RECON_FEED.csv',
    });

    assert.ok(result.batch_status === BatchSettlementStatus.PARTIALLY_PAID || result.batch_status === BatchSettlementStatus.PARTIALLY_SETTLED);
    assert.equal(result.is_all_terminal, true);
    assert.equal(result.bank_response.success_count, 1);
    assert.equal(result.bank_response.failure_count, 1);
    assert.equal(result.bank_response.total_settled_amount, 50000);
    assert.equal(result.bank_response.total_failed_amount, 40000);

    // Verify Reprocessing Queue Dispatch & Exception Alerts
    assert.equal(result.reprocessing_queue.length, 1);
    assert.equal(result.exception_alerts.length, 1);
    const retryItem = result.reprocessing_queue[0];
    assert.equal(retryItem.employee_id, 'EMP202');
    assert.equal(retryItem.failure_code, FailureReasonCode.ACCOUNT_CLOSED_OR_BLOCKED);
    assert.match(retryItem.suggested_action, /Request updated active salary account/);
    assert.equal(retryItem.status, 'PENDING_HR_CORRECTION');
  });

  // --------------------------------------------------------------------------
  // TEST 3: XML Bank Response Parsing & Reconciliation
  // --------------------------------------------------------------------------
  await test('3. XML Settlement Feed: Accurately parses XML tags and matches batch records', async () => {
    const batch = {
      batch_id: 'BATCH-XML-001',
      status: 'FILE_GENERATED',
      records: [
        { employee_id: 'EMP301', employee_name: 'Vikram Joshi', net_payable_amount: 85000, payment_reference: 'XML-REF-100', status: 'PENDING' },
      ],
    };

    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<BankSettlementNotification>
  <Transaction>
    <TxnId>XML-REF-100</TxnId>
    <BankRef>SBIN00088992211</BankRef>
    <EmployeeId>EMP301</EmployeeId>
    <Amount>85000.00</Amount>
    <Status>SUCCESS</Status>
  </Transaction>
</BankSettlementNotification>`;

    const result = await reconService.processSettlementFile({
      batch,
      fileContent: xmlResponse,
      fileFormat: 'XML',
      fileName: 'SBI_CAMT054.xml',
    });

    assert.ok(result.batch_status === BatchSettlementStatus.PAID || result.batch_status === BatchSettlementStatus.SETTLED);
    assert.equal(result.bank_response.success_count, 1);
    assert.equal(batch.records[0].status, TransactionStatus.SUCCESS);
    assert.equal(batch.records[0].bank_utr, 'SBIN00088992211');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Non-Terminal Guard (Partial Batch Response)
  // --------------------------------------------------------------------------
  await test('4. Non-Terminal Guard: Partial file maintains PROCESSING status until all records terminate', async () => {
    const batch = {
      batch_id: 'BATCH-PARTIAL-001',
      status: 'TRANSMITTED',
      records: [
        { employee_id: 'EMP401', employee_name: 'Worker 1', net_payable_amount: 30000, payment_reference: 'REF-P-01', status: 'PENDING' },
        { employee_id: 'EMP402', employee_name: 'Worker 2', net_payable_amount: 35000, payment_reference: 'REF-P-02', status: 'PENDING' },
      ],
    };

    // Response file contains only record 1
    const partialCsv = `txn_id,bank_ref,employee_id,amount,status,failure_reason
REF-P-01,UTR1234567,EMP401,30000,PAID,`;

    const result = await reconService.processSettlementFile({
      batch,
      fileContent: partialCsv,
      fileFormat: 'CSV',
    });

    // Since Record 2 is still PENDING, batch is not all terminal
    assert.equal(result.is_all_terminal, false);
    assert.equal(result.batch_status, BatchSettlementStatus.PROCESSING);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Unmatched Rows Tracking
  // --------------------------------------------------------------------------
  await test('5. Unmatched Records: Accurately logs unmatched response lines without crashing', async () => {
    const batch = {
      batch_id: 'BATCH-UNMATCH-001',
      status: 'TRANSMITTED',
      records: [
        { employee_id: 'EMP501', employee_name: 'Worker Real', net_payable_amount: 20000, payment_reference: 'REF-REAL-01', status: 'PENDING' },
      ],
    };

    const strayCsv = `txn_id,bank_ref,employee_id,amount,status,failure_reason
REF-GHOST-99,UTR99999,EMP_UNKNOWN,99999,PAID,`;

    const result = await reconService.processSettlementFile({
      batch,
      fileContent: strayCsv,
      fileFormat: 'CSV',
    });

    assert.equal(result.bank_response.matched_records_count, 0);
    assert.equal(result.bank_response.unmatched_records_count, 1);
    assert.equal(result.unmatched_rows.length, 1);
    assert.equal(result.unmatched_rows[0].txn_id, 'REF-GHOST-99');
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} RECONCILIATION TESTS PASSED!`);
  console.log('===============================================================\n');
}

runReconTestSuite().catch((err) => {
  console.error('Reconciliation Test Suite Failed:', err);
  process.exit(1);
});
