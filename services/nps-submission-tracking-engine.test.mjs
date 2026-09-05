/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - NPS SUBMISSION TRACKING ENGINE TEST SUITE
 * ============================================================================
 * Tests for:
 *  1. State Machine: FILE_GENERATED -> SUBMITTED -> ACK_RECEIVED -> COMPLETED
 *  2. Rejection of illegal state transitions & unauthorized step jumps
 *  3. Multi-format Acknowledgement Ingestion (XML, JSON, Delimited text)
 *  4. PRN / Transaction Reference mapping & subscriber ACK flag updating
 *  5. Gateway/CRA failure handling, raw error capture, and HR alert task dispatching
 *  6. Preservation of immutable transition audit logs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NPS_BATCH_STATES,
  NPS_TRANSITION_EVENTS,
  IllegalNpsTransitionError,
  createNpsSubmissionBatch,
  transitionNpsBatchState,
  submitNpsBatchToCra,
  parseNpsAcknowledgementPayload,
  ingestNpsAcknowledgementReceipt,
  handleNpsSubmissionRejection,
  confirmNpsSettlementComplete,
  resetNpsSubmissionStores,
  inMemoryNpsSubmissionBatches,
  inMemoryNpsTransitionLogs,
} from './nps-submission-tracking-engine.mjs';

test('⚡ KYLRX AI NPS SUBMISSION & ACKNOWLEDGEMENT TRACKING ENGINE TEST SUITE', async (t) => {

  t.beforeEach(() => {
    resetNpsSubmissionStores();
  });

  await t.test('1. FSM Lifecycle & State Transition Rails', async (t2) => {
    await t2.test('Should initialize batch in FILE_GENERATED state with transition history entry', () => {
      const batch = createNpsSubmissionBatch({
        batch_id: 'BATCH_NPS_001',
        run_id: 'RUN_2026_09',
        period: 'September 2026',
        file_name: 'NSDL_CRA_SCF_CHO12345_092026.txt',
        checksum_sha256: 'a1b2c3d4e5f6',
        total_subscribers: 2,
        total_amount: 25000,
        subscriber_records: [
          { pran: '110000112233', employee_id: 'EMP_01', total_contribution: 15000 },
          { pran: '110044556677', employee_id: 'EMP_02', total_contribution: 10000 },
        ],
      });

      assert.strictEqual(batch.state, 'FILE_GENERATED');
      assert.strictEqual(batch.total_subscribers, 2);
      assert.strictEqual(batch.total_amount, 25000);
      assert.strictEqual(batch.subscriber_records[0].status, 'STAGED');
      assert.strictEqual(batch.transition_history.length, 1);
      assert.strictEqual(batch.transition_history[0].from_state, 'DRAFT');
      assert.strictEqual(batch.transition_history[0].to_state, 'FILE_GENERATED');
    });

    await t2.test('Should execute full happy path: FILE_GENERATED -> SUBMITTED -> ACK_RECEIVED -> COMPLETED', () => {
      const batch = createNpsSubmissionBatch({
        batch_id: 'BATCH_NPS_HAPPY',
        run_id: 'RUN_HAPPY',
        subscriber_records: [
          { pran: '110000112233', employee_id: 'EMP_01', total_contribution: 12000 },
        ],
      });

      // 1. Submit to CRA
      submitNpsBatchToCra({
        batch,
        submissionReference: 'CRA_SUB_REF_001',
        actorId: 'admin@kylrx.ai',
      });
      assert.strictEqual(batch.state, 'SUBMITTED');
      assert.strictEqual(batch.subscriber_records[0].status, 'SUBMITTED');

      // 2. Ingest Acknowledgement (PRN Receipt)
      const ackPayload = {
        prn: 'PRN202609049999',
        transaction_id: 'TXN_GATEWAY_888',
        processed_date: '2026-09-04',
        clearing_status: 'SUCCESS',
        subscribers: [{ pran: '110000112233', status: 'ACKNOWLEDGED' }],
      };
      ingestNpsAcknowledgementReceipt({
        batch,
        receiptPayload: ackPayload,
        actorId: 'cra_webhook@kylrx.ai',
      });
      assert.strictEqual(batch.state, 'ACK_RECEIVED');
      assert.strictEqual(batch.prn, 'PRN202609049999');
      assert.strictEqual(batch.transaction_id, 'TXN_GATEWAY_888');
      assert.strictEqual(batch.subscriber_records[0].status, 'ACKNOWLEDGED');

      // 3. Confirm Settlement
      confirmNpsSettlementComplete({
        batch,
        settlementReference: 'SETTLEMENT_CLEAR_001',
        actorId: 'finance_controller@kylrx.ai',
      });
      assert.strictEqual(batch.state, 'COMPLETED');
      assert.strictEqual(batch.clearing_status, 'CLEARED');
      assert.strictEqual(batch.subscriber_records[0].status, 'COMPLETED');

      // Check transition history integrity (4 steps: Init + Submit + Ack + Complete)
      assert.strictEqual(batch.transition_history.length, 4);
    });

    await t2.test('Should reject illegal state transitions with IllegalNpsTransitionError', () => {
      const batch = createNpsSubmissionBatch({
        batch_id: 'BATCH_ILLEGAL',
      });

      // Illegal: Jump from FILE_GENERATED directly to COMPLETED
      assert.throws(
        () => {
          transitionNpsBatchState(batch, 'COMPLETED', 'CONFIRM_SETTLEMENT');
        },
        (err) => {
          assert.ok(err instanceof IllegalNpsTransitionError);
          assert.strictEqual(err.fromState, 'FILE_GENERATED');
          assert.strictEqual(err.attemptedToState, 'COMPLETED');
          return true;
        }
      );
    });
  });

  await t.test('2. Multi-Format Acknowledgement Ingestion (XML, JSON, Delimited Text)', async (t2) => {
    await t2.test('Should parse CRA PRN Receipt in XML format and update subscriber records', () => {
      const xmlPayload = `
        <Receipt>
          <PRN>PRN202609040001</PRN>
          <TransactionId>TXN_NSDL_9911</TransactionId>
          <ProcessedDate>2026-09-04</ProcessedDate>
          <Status>SUCCESS</Status>
          <SubscriberCount>2</SubscriberCount>
          <TotalAmount>30000.00</TotalAmount>
          <SubscriberDetails>
            <Subscriber>
              <PRAN>110000112233</PRAN>
              <Status>ACKNOWLEDGED</Status>
            </Subscriber>
            <Subscriber>
              <PRAN>110044556677</PRAN>
              <Status>ACKNOWLEDGED</Status>
            </Subscriber>
          </SubscriberDetails>
        </Receipt>
      `;

      const batch = createNpsSubmissionBatch({
        batch_id: 'BATCH_XML_ACK',
        subscriber_records: [
          { pran: '110000112233', employee_id: 'EMP_01', total_contribution: 15000 },
          { pran: '110044556677', employee_id: 'EMP_02', total_contribution: 15000 },
        ],
      });
      submitNpsBatchToCra({ batch });

      const result = ingestNpsAcknowledgementReceipt({
        batch,
        receiptPayload: xmlPayload,
      });

      assert.strictEqual(batch.state, 'ACK_RECEIVED');
      assert.strictEqual(batch.prn, 'PRN202609040001');
      assert.strictEqual(batch.transaction_id, 'TXN_NSDL_9911');
      assert.strictEqual(result.acknowledged_count, 2);
      assert.strictEqual(batch.subscriber_records[0].status, 'ACKNOWLEDGED');
      assert.strictEqual(batch.subscriber_records[1].status, 'ACKNOWLEDGED');
    });

    await t2.test('Should parse Delimited Caret/CSV Acknowledgement Receipt', () => {
      const delimitedPayload = `
        PRN^PRN_CARET_7788^TXN_BANK_1234^2026-09-04^SUCCESS^18000.00
        SUB^110088889999^ACKNOWLEDGED^
      `;

      const parsed = parseNpsAcknowledgementPayload(delimitedPayload);
      assert.strictEqual(parsed.prn, 'PRN_CARET_7788');
      assert.strictEqual(parsed.transaction_id, 'TXN_BANK_1234');
      assert.strictEqual(parsed.clearing_status, 'SUCCESS');
      assert.strictEqual(parsed.subscriber_acknowledgements.length, 1);
      assert.strictEqual(parsed.subscriber_acknowledgements[0].pran, '110088889999');
      assert.strictEqual(parsed.subscriber_acknowledgements[0].status, 'ACKNOWLEDGED');
    });
  });

  await t.test('3. Failure Handling, Gateway Rejection & HR Alert Dispatching', async (t2) => {
    await t2.test('Should handle CRA gateway rejection, capture raw payload, and flag affected employees', () => {
      const batch = createNpsSubmissionBatch({
        batch_id: 'BATCH_REJECT_01',
        run_id: 'RUN_REJECT_01',
        subscriber_records: [
          { pran: '110099990000', employee_id: 'EMP_DEFECT_01', employee_name: 'Varun Dhawan', total_contribution: 10000 },
          { pran: '110011112222', employee_id: 'EMP_DEFECT_02', employee_name: 'Kriti Sanon', total_contribution: 10000 },
        ],
      });
      submitNpsBatchToCra({ batch });

      const rawGatewayError = {
        error_code: 'CRA_AUTH_FAIL_403',
        gateway_message: 'Corporate PRAN mapping inactive on NSDL subscriber master',
        timestamp: '2026-09-04T12:00:00Z',
        http_status: 403,
      };

      const rejectionResult = handleNpsSubmissionRejection({
        batch,
        errorPayload: rawGatewayError,
        reason: 'CRA Portal Authorization Failure: Inactive Corporate Mandate',
        errorCode: 'CRA_AUTH_FAIL_403',
        actorId: 'nsdl_gateway_listener',
      });

      // 1. Check Batch State Transition
      assert.strictEqual(batch.state, 'REJECTED');
      assert.strictEqual(batch.clearing_status, 'REJECTED');
      assert.deepStrictEqual(batch.raw_gateway_error, rawGatewayError);
      assert.ok(batch.rejection_reason.includes('CRA Portal Authorization Failure'));

      // 2. Check Affected Employees Flagged
      assert.strictEqual(rejectionResult.affected_employees.length, 2);
      for (const emp of batch.subscriber_records) {
        assert.strictEqual(emp.status, 'REJECTED');
        assert.strictEqual(emp.flagged_for_correction, true);
        assert.ok(emp.rejection_reason.includes('CRA Portal Authorization Failure'));
      }

      // 3. Check Actionable HR Compliance Tasks Generated
      assert.strictEqual(rejectionResult.hr_tasks.length, 2);
      assert.strictEqual(rejectionResult.hr_tasks[0].priority, 'CRITICAL');
      assert.strictEqual(rejectionResult.hr_tasks[0].assigned_role, 'HR_COMPLIANCE_OFFICER');
      assert.strictEqual(rejectionResult.hr_tasks[0].employee_id, 'EMP_DEFECT_01');

      // 4. Verify Immutable History (past transition records intact)
      assert.strictEqual(batch.transition_history.length, 3); // FILE_GENERATED -> SUBMITTED -> REJECTED
      assert.strictEqual(batch.transition_history[0].to_state, 'FILE_GENERATED');
      assert.strictEqual(batch.transition_history[1].to_state, 'SUBMITTED');
      assert.strictEqual(batch.transition_history[2].to_state, 'REJECTED');
    });

    await t2.test('Should allow reopening rejected batch for retry after remediation', () => {
      const batch = createNpsSubmissionBatch({
        batch_id: 'BATCH_RETRY_01',
      });
      submitNpsBatchToCra({ batch });
      handleNpsSubmissionRejection({
        batch,
        errorPayload: 'Temporary Gateway Timeout 504',
        errorCode: 'GATEWAY_TIMEOUT',
      });

      assert.strictEqual(batch.state, 'REJECTED');

      // Reopen for Retry
      transitionNpsBatchState(batch, 'FILE_GENERATED', 'REOPEN_FOR_RETRY', {
        actorId: 'admin@kylrx.ai',
        metadata: { reason: 'Gateway timeout resolved; resubmitting batch' },
      });

      assert.strictEqual(batch.state, 'FILE_GENERATED');
      assert.strictEqual(batch.transition_history.length, 4);
    });
  });

});
