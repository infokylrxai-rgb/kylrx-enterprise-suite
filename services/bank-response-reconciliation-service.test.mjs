/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CRITERION 7 TEST SUITE
 * ============================================================================
 * Bank Response Ingestion and Transaction Reconciliation Service:
 *  - 1:1 Matching Engine (CSV, XML, TXT feeds & fan-in collision detection)
 *  - Settlement Verification (Anti-Assumption Guard: never PAID without positive confirmation)
 *  - Reconciliation Discrepancies (unmatched rows, amount deltas Δ ≠ 0, duplicate UTRs)
 *  - Parent Batch RECONCILING lock until manual finance desk resolution
 *  - Manual Finance Desk Resolution workflow & REST API verification
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  BankResponseReconciliationService,
  ReconciliationExceptionStore,
  DiscrepancyType,
  ExceptionStatus,
  BatchReconciliationLifecycle,
} from './bank-response-reconciliation-service.mjs';

import {
  createPayrollDisbursementApiRouter,
  PaymentBatchService,
  BankIntegrationService,
  store,
  resetDisbursementMicroserviceStores,
  globalReconciliationStore,
} from './payroll-disbursement-api.mjs';

function createMockBatch(batchId = 'BATCH_RECON_001') {
  return {
    batch_id: batchId,
    state: 'SUBMITTED',
    status: 'SUBMITTED',
    period: '2026-08',
    total_amount: 150000.00,
    records: [
      {
        record_id: 'REC_001',
        payment_reference: 'TXN_REF_001',
        employee_id: 'EMP_101',
        employee_name: 'Ananya Sharma',
        amount: 50000.00,
        net_payable_amount: 50000.00,
        status: 'PENDING',
        account_number: '987654321001',
        ifsc_code: 'HDFC0000001',
      },
      {
        record_id: 'REC_002',
        payment_reference: 'TXN_REF_002',
        employee_id: 'EMP_102',
        employee_name: 'Rahul Verma',
        amount: 60000.00,
        net_payable_amount: 60000.00,
        status: 'PENDING',
        account_number: '987654321002',
        ifsc_code: 'ICIC0000002',
      },
      {
        record_id: 'REC_003',
        payment_reference: 'TXN_REF_003',
        employee_id: 'EMP_103',
        employee_name: 'Vikram Singh',
        amount: 40000.00,
        net_payable_amount: 40000.00,
        status: 'PENDING',
        account_number: '987654321003',
        ifsc_code: 'SBIN0000003',
      },
    ],
  };
}

test('🏦 CRITERION 7: Bank Response Ingestion & Transaction Reconciliation Suite', async (t) => {

  await t.test('1. 1:1 Matching Engine: Multi-Format Feed Parsing & Instruction Binding', async (t2) => {
    await t2.test('1.1 Ingests standard CSV feed and resolves 1:1 matching by txn_id', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_CSV_001');

      const csvContent = [
        'txn_id,bank_ref,amount,status,failure_reason',
        'TXN_REF_001,UTR_HDFC_001,50000.00,PAID,',
        'TXN_REF_002,UTR_ICIC_002,60000.00,PAID,',
        'TXN_REF_003,UTR_SBIN_003,40000.00,PAID,',
      ].join('\n');

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      assert.equal(result.matched_count, 3);
      assert.equal(result.settled_count, 3);
      assert.equal(result.open_exception_count, 0);
      assert.equal(result.status, 'PAID');
      assert.equal(batch.status, 'PAID');
      assert.equal(batch.auto_closure_blocked, false);

      // Verify instruction records updated with UTR and settled_at
      assert.equal(batch.records[0].status, 'PAID');
      assert.equal(batch.records[0].bank_utr, 'UTR_HDFC_001');
      assert.ok(batch.records[0].settled_at);
    });

    await t2.test('1.2 Ingests XML settlement feed and resolves records', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_XML_001');

      const xmlContent = `
        <BankSettlementResponse>
          <Txn>
            <TxnId>TXN_REF_001</TxnId>
            <UTR>UTR_XML_001</UTR>
            <Amt>50000.00</Amt>
            <Status>PAID</Status>
          </Txn>
          <Txn>
            <TxnId>TXN_REF_002</TxnId>
            <UTR>UTR_XML_002</UTR>
            <Amt>60000.00</Amt>
            <Status>PAID</Status>
          </Txn>
          <Txn>
            <TxnId>TXN_REF_003</TxnId>
            <UTR>UTR_XML_003</UTR>
            <Amt>40000.00</Amt>
            <Status>PAID</Status>
          </Txn>
        </BankSettlementResponse>
      `;

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: xmlContent,
        fileFormat: 'XML',
      });

      assert.equal(result.matched_count, 3);
      assert.equal(result.settled_count, 3);
      assert.equal(result.status, 'PAID');
      assert.equal(batch.records[1].bank_utr, 'UTR_XML_002');
    });

    await t2.test('1.3 Ingests delimited TXT feed', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_TXT_001');

      const txtContent = [
        'txn_id|bank_ref|amount|status',
        'TXN_REF_001|UTR_TXT_001|50000.00|PAID',
        'TXN_REF_002|UTR_TXT_002|60000.00|PAID',
        'TXN_REF_003|UTR_TXT_003|40000.00|PAID',
      ].join('\n');

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: txtContent,
        fileFormat: 'TXT',
      });

      assert.equal(result.matched_count, 3);
      assert.equal(result.settled_count, 3);
      assert.equal(result.status, 'PAID');
    });

    await t2.test('1.4 Detects 1:1 Matching Fan-In Collision when multiple bank rows claim the same instruction', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_COLLISION_001');

      const csvContent = [
        'txn_id,bank_ref,amount,status',
        'TXN_REF_001,UTR_001_A,50000.00,PAID',
        'TXN_REF_001,UTR_001_B,50000.00,PAID', // Duplicate claim on TXN_REF_001
        'TXN_REF_002,UTR_002,60000.00,PAID',
      ].join('\n');

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      assert.ok(result.open_exception_count > 0);
      assert.equal(result.status, 'RECONCILING');
      const collisionExc = result.reconciliation_exceptions.find(
        (e) => e.discrepancy_type === DiscrepancyType.FAN_IN_COLLISION
      );
      assert.ok(collisionExc, 'FAN_IN_COLLISION discrepancy must be isolated');
      assert.equal(collisionExc.instruction_id, 'REC_001');
    });
  });

  await t.test('2. Settlement Verification: Anti-Assumption Guard', async (t2) => {
    await t2.test('2.1 Updates record to FAILED when bank reports rejection; never sets PAID', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_FAILED_ROW');

      const csvContent = [
        'txn_id,bank_ref,amount,status,failure_reason',
        'TXN_REF_001,UTR_001,50000.00,PAID,',
        'TXN_REF_002,UTR_002,60000.00,FAILED,BENEFICIARY_ACCOUNT_BLOCKED',
        'TXN_REF_003,UTR_003,40000.00,PAID,',
      ].join('\n');

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      assert.equal(batch.records[1].status, 'FAILED');
      assert.equal(batch.records[1].settlement_error, 'BENEFICIARY_ACCOUNT_BLOCKED');
      assert.equal(result.settled_count, 2);
      assert.equal(result.failed_count, 1);
      assert.equal(result.status, 'PARTIALLY_SETTLED');
    });

    await t2.test('2.2 Anti-Assumption Guard: NEVER sets status to PAID if UTR (bank_ref) is blank', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_NO_UTR');

      const csvContent = [
        'txn_id,bank_ref,amount,status',
        'TXN_REF_001,,50000.00,PAID', // Status says PAID but UTR is missing!
        'TXN_REF_002,UTR_002,60000.00,PAID',
        'TXN_REF_003,UTR_003,40000.00,PAID',
      ].join('\n');

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      // Record 0 must NOT be PAID
      assert.notEqual(batch.records[0].status, 'PAID');
      assert.equal(batch.records[0].status, 'EXCEPTION');
      assert.ok(result.open_exception_count > 0);
      assert.equal(batch.status, 'RECONCILING');
    });
  });

  await t.test('3. Reconciliation Discrepancies & Isolation Queue', async (t2) => {
    await t2.test('3.1 Row fails to match: Isolate in reconciliation_exceptions queue and retain RECONCILING', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_UNMATCHED');

      const csvContent = [
        'txn_id,bank_ref,amount,status',
        'TXN_REF_001,UTR_001,50000.00,PAID',
        'TXN_UNKNOWN_999,UTR_999,75000.00,PAID', // Unmatched bank row
      ].join('\n');

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      assert.equal(result.status, 'RECONCILING');
      assert.equal(batch.status, 'RECONCILING');
      assert.equal(batch.auto_closure_blocked, true);

      const unmatchedExc = result.reconciliation_exceptions.find(
        (e) => e.discrepancy_type === DiscrepancyType.UNMATCHED_ROW
      );
      assert.ok(unmatchedExc);
      assert.equal(unmatchedExc.txn_id, 'TXN_UNKNOWN_999');
      assert.equal(unmatchedExc.difference_amount, 75000.00);
      assert.equal(unmatchedExc.status, 'OPEN');
    });

    await t2.test('3.2 Amount discrepancy (Δ ≠ 0): Isolate in queue with exact signed delta', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_DELTA');

      // Instructed for TXN_REF_001 is 50000.00, bank cleared 48500.00 (underpayment: Δ = -1500)
      const csvContent = [
        'txn_id,bank_ref,amount,status',
        'TXN_REF_001,UTR_001,48500.00,PAID',
        'TXN_REF_002,UTR_002,60000.00,PAID',
        'TXN_REF_003,UTR_003,40000.00,PAID',
      ].join('\n');

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      assert.equal(batch.status, 'RECONCILING');
      assert.equal(batch.auto_closure_blocked, true);
      assert.notEqual(batch.records[0].status, 'PAID');

      const amountExc = result.reconciliation_exceptions.find(
        (e) => e.discrepancy_type === DiscrepancyType.AMOUNT_MISMATCH
      );
      assert.ok(amountExc);
      assert.equal(amountExc.instructed_amount, 50000.00);
      assert.equal(amountExc.cleared_amount, 48500.00);
      assert.equal(amountExc.difference_amount, -1500.00);
    });

    await t2.test('3.3 Duplicate bank reference (UTR): Isolate in queue and block auto-closure', async () => {
      const reconStore = new ReconciliationExceptionStore();
      reconStore.registerConfirmedUtr('UTR_ALREADY_USED_HISTORIC');

      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_DUP_UTR');

      const csvContent = [
        'txn_id,bank_ref,amount,status',
        'TXN_REF_001,UTR_ALREADY_USED_HISTORIC,50000.00,PAID', // Duplicate historic UTR
        'TXN_REF_002,UTR_002,60000.00,PAID',
      ].join('\n');

      const result = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      assert.equal(batch.status, 'RECONCILING');
      assert.equal(batch.auto_closure_blocked, true);
      const dupExc = result.reconciliation_exceptions.find(
        (e) => e.discrepancy_type === DiscrepancyType.DUPLICATE_BANK_REF
      );
      assert.ok(dupExc);
      assert.equal(dupExc.bank_ref, 'UTR_ALREADY_USED_HISTORIC');
    });
  });

  await t.test('4. Manual Finance Desk Resolution Workflow', async (t2) => {
    await t2.test('4.1 Batch remains in RECONCILING until manual finance desk resolution clears all exceptions', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_MANUAL_RES');

      // Induce an amount discrepancy on REC_001
      const csvContent = [
        'txn_id,bank_ref,amount,status',
        'TXN_REF_001,UTR_001,49500.00,PAID', // Δ = -500
        'TXN_REF_002,UTR_002,60000.00,PAID',
        'TXN_REF_003,UTR_003,40000.00,PAID',
      ].join('\n');

      const initialResult = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      assert.equal(batch.status, 'RECONCILING');
      assert.equal(initialResult.open_exception_count, 1);
      const exceptionId = initialResult.reconciliation_exceptions[0].exception_id;

      // Desk action: ACCEPT_DIFFERENCE
      const resolveResult = await service.resolveException({
        batch,
        exceptionId,
        action: 'ACCEPT_DIFFERENCE',
        resolvedBy: 'finance_analyst_priya@kylrx.ai',
        notes: 'Small fee deduction of ₹500 accepted per corporate bank mandate agreement.',
      });

      assert.equal(resolveResult.status, 'RESOLVED');
      assert.equal(resolveResult.remaining_open_exceptions, 0);

      // Now all exceptions are cleared and all instructions are settled → batch transitions to PAID!
      assert.equal(batch.status, 'PAID');
      assert.equal(batch.auto_closure_blocked, false);
      assert.equal(batch.records[0].status, 'PAID');
      assert.equal(batch.records[0].manual_resolution_action, 'ACCEPT_DIFFERENCE');
    });

    await t2.test('4.2 Desk action MARK_FAILED_FOR_RETRY results in PARTIALLY_SETTLED batch', async () => {
      const reconStore = new ReconciliationExceptionStore();
      const service = new BankResponseReconciliationService({ store: reconStore });
      const batch = createMockBatch('BATCH_RETRY_RES');

      const csvContent = [
        'txn_id,bank_ref,amount,status',
        'TXN_REF_001,UTR_001,40000.00,PAID', // Δ = -10000
        'TXN_REF_002,UTR_002,60000.00,PAID',
        'TXN_REF_003,UTR_003,40000.00,PAID',
      ].join('\n');

      const initialResult = await service.ingestAndReconcile({
        batch,
        fileContent: csvContent,
        fileFormat: 'CSV',
      });

      const exceptionId = initialResult.reconciliation_exceptions[0].exception_id;

      await service.resolveException({
        batch,
        exceptionId,
        action: 'MARK_FAILED_FOR_RETRY',
        resolvedBy: 'finance_analyst@kylrx.ai',
        notes: 'Underpayment flagged for manual payroll rerun',
      });

      assert.equal(batch.records[0].status, 'FAILED');
      assert.equal(batch.status, 'PARTIALLY_SETTLED');
      assert.equal(batch.auto_closure_blocked, false);
    });
  });

  await t.test('5. REST API: Ingest & Manual Resolution Endpoints', async (t2) => {
    let server;
    let baseUrl;

    t2.before(() => {
      resetDisbursementMicroserviceStores();
      const app = express();
      app.use(express.json());
      app.use('/api', createPayrollDisbursementApiRouter());
      server = app.listen(0);
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}/api`;
    });

    t2.after(() => {
      if (server) server.close();
      resetDisbursementMicroserviceStores();
    });

    await t2.test('5.1 POST /payment-batches/:id/reconcile-bank-response runs matching and isolates exceptions', async () => {
      // Seed batch
      const batch = createMockBatch('BATCH_API_RECON_001');
      store.paymentBatches.set(batch.batch_id, batch);

      const csvContent = [
        'txn_id,bank_ref,amount,status',
        'TXN_REF_001,UTR_API_001,45000.00,PAID', // Δ = -5000
        'TXN_REF_002,UTR_API_002,60000.00,PAID',
        'TXN_REF_003,UTR_API_003,40000.00,PAID',
      ].join('\n');

      const res = await fetch(`${baseUrl}/payment-batches/${batch.batch_id}/reconcile-bank-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_content: csvContent,
          file_format: 'CSV',
          file_name: 'hdfc_response.csv',
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.status, 'RECONCILING');
      assert.equal(json.data.open_exception_count, 1);
      assert.equal(json.data.auto_closure_blocked, true);

      // GET /payment-batches/:id/reconciliation-exceptions
      const getRes = await fetch(`${baseUrl}/payment-batches/${batch.batch_id}/reconciliation-exceptions`);
      assert.equal(getRes.status, 200);
      const getJson = await getRes.json();
      assert.equal(getJson.data.open_count, 1);
      const exceptionId = getJson.data.exceptions[0].exception_id;

      // POST /payment-batches/:id/resolve-exception
      const resolveRes = await fetch(`${baseUrl}/payment-batches/${batch.batch_id}/resolve-exception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exception_id: exceptionId,
          action: 'ACCEPT_DIFFERENCE',
          resolved_by: 'lead_accountant@kylrx.ai',
          notes: 'Approved tolerance variance',
        }),
      });

      assert.equal(resolveRes.status, 200);
      const resolveJson = await resolveRes.json();
      assert.equal(resolveJson.success, true);
      assert.equal(resolveJson.data.batch_status, 'PAID');
      assert.equal(resolveJson.data.remaining_open_exceptions, 0);
    });
  });
});
