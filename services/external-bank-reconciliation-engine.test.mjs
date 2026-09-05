import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ExternalBankReconciliationEngine,
  ReconciliationStatus,
  ReconciliationExceptionCode,
} from './external-bank-reconciliation-engine.mjs';

test('🏦 KYLRX AI EXTERNAL BANK RECONCILIATION PROCESSING ENGINE TEST SUITE', async (t) => {

  await t.test('1. 100% Success Reconciliation: All Rows Settle -> Batch Advances to PAID', async () => {
    const engine = new ExternalBankReconciliationEngine();
    const batch = {
      batch_id: 'BATCH-SAL-2026-09',
      status: 'SUBMITTED',
      records: [
        { employee_id: 'EMP001', employee_name: 'Abhishek Rai', payment_reference: 'SAL-SEP-001', net_payable_amount: 45200 },
        { employee_id: 'EMP002', employee_name: 'Rohit Kumar', payment_reference: 'SAL-SEP-002', net_payable_amount: 36500 },
        { employee_id: 'EMP003', employee_name: 'Sneha Sharma', payment_reference: 'SAL-SEP-003', net_payable_amount: 41000 },
      ],
    };

    const csvFeed = `Transaction Reference,UTR,Employee ID,Amount,Status,Remarks
SAL-SEP-001,HDFC0019283719,EMP001,45200,PAID,Account Credited
SAL-SEP-002,HDFC0019283720,EMP002,36500,PAID,Account Credited
SAL-SEP-003,HDFC0019283721,EMP003,41000,PAID,Account Credited`;

    const result = await engine.processBankResponse({
      batch,
      responseFeed: csvFeed,
      feedFormat: 'CSV',
    });

    assert.equal(result.final_state, ReconciliationStatus.PAID);
    assert.equal(batch.status, ReconciliationStatus.PAID);
    assert.equal(result.reconciliation_summary.success_count, 3);
    assert.equal(result.reconciliation_summary.failure_count, 0);
    assert.equal(result.reconciliation_summary.exception_count, 0);
    assert.equal(result.reconciliation_summary.total_settled_amount, 122700);
    assert.equal(result.remediation_tasks.length, 0);
    assert.equal(result.reconciliation_exceptions.length, 0);
  });

  await t.test('2. Reconciliation Guard: Intercept Unmatched Payment Instructions', async () => {
    const engine = new ExternalBankReconciliationEngine();
    const batch = {
      batch_id: 'BATCH-SAL-UNMATCHED',
      status: 'SUBMITTED',
      records: [
        { employee_id: 'EMP001', payment_reference: 'SAL-SEP-001', net_payable_amount: 50000 },
      ],
    };

    // Bank response contains unknown ghost transaction
    const csvFeed = `Transaction Reference,UTR,Employee ID,Amount,Status
SAL-SEP-001,UTR990011,EMP001,50000,PAID
SAL-GHOST-999,UTR990099,EMP999,75000,PAID`;

    const result = await engine.processBankResponse({
      batch,
      responseFeed: csvFeed,
      feedFormat: 'CSV',
    });

    assert.equal(result.reconciliation_summary.unmatched_records_count, 1);
    assert.equal(result.reconciliation_exceptions.length, 1);
    assert.equal(result.reconciliation_exceptions[0].code, ReconciliationExceptionCode.UNMATCHED_INSTRUCTION);
    assert.equal(result.reconciliation_exceptions[0].employee_id, 'EMP999');
    assert.equal(result.final_state, ReconciliationStatus.PARTIALLY_PAID);
  });

  await t.test('3. Reconciliation Guard: Intercept Amount Mismatch Discrepancies', async () => {
    const engine = new ExternalBankReconciliationEngine();
    const batch = {
      batch_id: 'BATCH-SAL-MISMATCH',
      status: 'SUBMITTED',
      records: [
        { employee_id: 'EMP001', payment_reference: 'SAL-SEP-001', net_payable_amount: 50000 },
      ],
    };

    // Bank cleared 45000 instead of 50000
    const csvFeed = `Transaction Reference,UTR,Employee ID,Amount,Status
SAL-SEP-001,UTR880011,EMP001,45000,PAID`;

    const result = await engine.processBankResponse({
      batch,
      responseFeed: csvFeed,
      feedFormat: 'CSV',
    });

    assert.equal(result.reconciliation_summary.success_count, 0);
    assert.equal(result.reconciliation_summary.failure_count, 1);
    assert.equal(result.reconciliation_exceptions.length, 1);
    assert.equal(result.reconciliation_exceptions[0].code, ReconciliationExceptionCode.AMOUNT_MISMATCH);
    assert.equal(result.reconciliation_exceptions[0].discrepancy, -5000);
    assert.equal(result.final_state, ReconciliationStatus.FAILED);
    assert.equal(result.remediation_tasks.length, 1);
    assert.equal(result.remediation_tasks[0].failure_code, ReconciliationExceptionCode.AMOUNT_MISMATCH);
  });

  await t.test('4. Reconciliation Guard: Duplicate UTR and Txn ID Detection', async () => {
    const pastUtrs = ['UTR_ALREADY_SETTLED_001'];
    const engine = new ExternalBankReconciliationEngine({ pastUtrLedger: pastUtrs });
    const batch = {
      batch_id: 'BATCH-SAL-DUP',
      status: 'SUBMITTED',
      records: [
        { employee_id: 'EMP001', payment_reference: 'SAL-SEP-001', net_payable_amount: 30000 },
        { employee_id: 'EMP002', payment_reference: 'SAL-SEP-002', net_payable_amount: 35000 },
      ],
    };

    // Row 1 attempts to use an already registered historic UTR
    // Row 2 attempts to duplicate Row 1's UTR within same feed
    const csvFeed = `Transaction Reference,UTR,Employee ID,Amount,Status
SAL-SEP-001,UTR_ALREADY_SETTLED_001,EMP001,30000,PAID
SAL-SEP-002,UTR_ALREADY_SETTLED_001,EMP002,35000,PAID`;

    const result = await engine.processBankResponse({
      batch,
      responseFeed: csvFeed,
      feedFormat: 'CSV',
    });

    assert.equal(result.reconciliation_exceptions.length, 2);
    assert.equal(result.reconciliation_exceptions[0].code, ReconciliationExceptionCode.DUPLICATE_UTR);
    assert.equal(result.reconciliation_exceptions[1].code, ReconciliationExceptionCode.DUPLICATE_UTR);
    assert.equal(result.final_state, ReconciliationStatus.FAILED);
  });

  await t.test('5. Mixed Response: Transition to PARTIALLY_PAID and Generate Remediation Tasks', async () => {
    const engine = new ExternalBankReconciliationEngine();
    const batch = {
      batch_id: 'BATCH-SAL-MIXED',
      status: 'SUBMITTED',
      records: [
        { employee_id: 'EMP001', employee_name: 'Abhishek Rai', payment_reference: 'SAL-SEP-001', net_payable_amount: 50000 },
        { employee_id: 'EMP002', employee_name: 'Rohit Kumar', payment_reference: 'SAL-SEP-002', net_payable_amount: 40000, ifsc: 'SBIN0009999' },
      ],
    };

    const csvFeed = `Transaction Reference,UTR,Employee ID,Amount,Status,Remarks
SAL-SEP-001,UTR11223344,EMP001,50000,PAID,Settled
SAL-SEP-002,,EMP002,40000,FAILED,IFSC branch code not found`;

    const result = await engine.processBankResponse({
      batch,
      responseFeed: csvFeed,
      feedFormat: 'CSV',
    });

    assert.equal(result.final_state, ReconciliationStatus.PARTIALLY_PAID);
    assert.equal(batch.status, ReconciliationStatus.PARTIALLY_PAID);
    assert.equal(result.reconciliation_summary.success_count, 1);
    assert.equal(result.reconciliation_summary.failure_count, 1);
    assert.equal(result.reconciliation_summary.total_settled_amount, 50000);
    assert.equal(result.reconciliation_summary.total_failed_amount, 40000);

    // Remediation task generated for uncredited employee EMP002
    assert.equal(result.remediation_tasks.length, 1);
    const task = result.remediation_tasks[0];
    assert.equal(task.employee_id, 'EMP002');
    assert.equal(task.uncredited_amount, 40000);
    assert.equal(task.status, 'OPEN_FOR_REMEDIATION');
    assert(task.suggested_fix.length > 0);
  });

  await t.test('6. Multi-Format Feeds: JSON, Delimited TXT, and XML Parsing Support', async () => {
    const engine = new ExternalBankReconciliationEngine();

    // A. JSON Feed
    const jsonBatch = {
      batch_id: 'BATCH-JSON',
      status: 'SUBMITTED',
      records: [{ employee_id: 'EMP001', payment_reference: 'SAL-01', net_payable_amount: 25000 }],
    };
    const jsonFeed = JSON.stringify([
      { txn_id: 'SAL-01', bank_ref: 'UTR-JSON-1', employee_id: 'EMP001', amount: 25000, status: 'PAID' },
    ]);
    const jsonRes = await engine.processBankResponse({ batch: jsonBatch, responseFeed: jsonFeed, feedFormat: 'JSON' });
    assert.equal(jsonRes.final_state, ReconciliationStatus.PAID);

    // B. XML Feed
    const xmlBatch = {
      batch_id: 'BATCH-XML',
      status: 'SUBMITTED',
      records: [{ employee_id: 'EMP002', payment_reference: 'SAL-02', net_payable_amount: 35000 }],
    };
    const xmlFeed = `
      <BankResponse>
        <Transaction>
          <TxnId>SAL-02</TxnId>
          <UTR>UTR-XML-2</UTR>
          <EmployeeId>EMP002</EmployeeId>
          <Amount>35000</Amount>
          <Status>PAID</Status>
        </Transaction>
      </BankResponse>
    `;
    const xmlRes = await engine.processBankResponse({ batch: xmlBatch, responseFeed: xmlFeed, feedFormat: 'XML' });
    assert.equal(xmlRes.final_state, ReconciliationStatus.PAID);
  });

});
