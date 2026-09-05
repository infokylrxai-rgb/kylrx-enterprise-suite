import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PaymentBatchState,
  BatchTransitionEvent,
  ActorRole,
  PaymentBatchTransitionRunner,
  IllegalStateTransitionError,
  UnauthorizedTransitionError,
  PreconditionFailedError,
  BatchTransitionHistoryRepository,
  PaymentBatchEntityRepository,
} from './payment-batch-fsm.mjs';

test('🧪 KYLRX AI PAYMENT BATCH FINITE STATE MACHINE (FSM) TEST SUITE', async (t) => {
  
  await t.test('1. Full Lifecycle Happy Path: DRAFT -> VALIDATING -> VALIDATED -> PENDING_APPROVAL -> APPROVED -> FILE_GENERATED -> SUBMITTED -> RECONCILING -> PAID', async () => {
    const runner = new PaymentBatchTransitionRunner();
    const batchId = 'BATCH-SAL-SEP2026-001';
    const makerId = 'MAKER_NANDAN';
    const checkerId = 'CHECKER_ABHISHEK';

    // 1. DRAFT Genesis
    const { batch: b1, transition_record: tr1 } = await runner.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-09',
      batch_name: 'September 2026 Salary Disbursement',
      batch_type: 'SALARY',
      maker_id: makerId,
      total_amount: 5400000,
      record_count: 52,
    });

    assert.equal(b1.status, PaymentBatchState.DRAFT);
    assert.equal(b1.version, 1);
    assert.equal(tr1.from_state, null);
    assert.equal(tr1.to_state, PaymentBatchState.DRAFT);
    assert.equal(tr1.sequence_number, 1);

    // 2. DRAFT -> VALIDATING
    const { batch: b2, transition_record: tr2 } = await runner.startValidation(batchId, {
      actor_id: makerId,
      actor_role: ActorRole.PAYROLL_MAKER,
    });
    assert.equal(b2.status, PaymentBatchState.VALIDATING);
    assert.equal(tr2.from_state, PaymentBatchState.DRAFT);
    assert.equal(tr2.to_state, PaymentBatchState.VALIDATING);
    assert.equal(tr2.event, BatchTransitionEvent.START_VALIDATION);

    // 3. VALIDATING -> VALIDATED
    const { batch: b3, transition_record: tr3 } = await runner.markValidationPassed(batchId, {
      actor_id: 'ENGINE_8POINT_GATE',
      actor_role: ActorRole.SYSTEM_SERVICE,
      metadata: { passed_gates: 8, blocking_issues_count: 0 },
    });
    assert.equal(b3.status, PaymentBatchState.VALIDATED);
    assert.equal(tr3.from_state, PaymentBatchState.VALIDATING);
    assert.equal(tr3.to_state, PaymentBatchState.VALIDATED);

    // 4. VALIDATED -> PENDING_APPROVAL
    const { batch: b4, transition_record: tr4 } = await runner.submitForApproval(batchId, {
      actor_id: makerId,
      actor_role: ActorRole.PAYROLL_MAKER,
    });
    assert.equal(b4.status, PaymentBatchState.PENDING_APPROVAL);
    assert.equal(tr4.from_state, PaymentBatchState.VALIDATED);
    assert.equal(tr4.to_state, PaymentBatchState.PENDING_APPROVAL);

    // 5. PENDING_APPROVAL -> APPROVED (4-Eyes approval by checker)
    const { batch: b5, transition_record: tr5 } = await runner.approveBatch(batchId, {
      checker_id: checkerId,
      actor_role: ActorRole.PAYROLL_CHECKER,
      metadata: { approval_note: 'Approved for generic NEFT/RTGS generation' },
    });
    assert.equal(b5.status, PaymentBatchState.APPROVED);
    assert.equal(b5.checker_id, checkerId);
    assert.equal(tr5.from_state, PaymentBatchState.PENDING_APPROVAL);
    assert.equal(tr5.to_state, PaymentBatchState.APPROVED);

    // 6. APPROVED -> FILE_GENERATED
    const checksum = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const { batch: b6, transition_record: tr6 } = await runner.generateFile(batchId, {
      actor_id: makerId,
      checksum,
      file_url: 'https://vault.kylrx.ai/files/batch-sal-2026-09.csv',
      actor_role: ActorRole.PAYROLL_MAKER,
    });
    assert.equal(b6.status, PaymentBatchState.FILE_GENERATED);
    assert.equal(b6.checksum, checksum);
    assert.equal(tr6.from_state, PaymentBatchState.APPROVED);
    assert.equal(tr6.to_state, PaymentBatchState.FILE_GENERATED);

    // 7. FILE_GENERATED -> SUBMITTED
    const { batch: b7, transition_record: tr7 } = await runner.transmitToBank(batchId, {
      actor_id: checkerId,
      actor_role: ActorRole.PAYROLL_CHECKER,
      channel: 'HDFC_ENET_GATEWAY',
    });
    assert.equal(b7.status, PaymentBatchState.SUBMITTED);
    assert.equal(tr7.from_state, PaymentBatchState.FILE_GENERATED);
    assert.equal(tr7.to_state, PaymentBatchState.SUBMITTED);

    // 8. SUBMITTED -> RECONCILING
    const { batch: b8, transition_record: tr8 } = await runner.startReconciliation(batchId, {
      actor_id: 'HDFC_SETTLEMENT_FEED',
      actor_role: ActorRole.BANK_INTEGRATION_GATEWAY,
    });
    assert.equal(b8.status, PaymentBatchState.RECONCILING);
    assert.equal(tr8.from_state, PaymentBatchState.SUBMITTED);
    assert.equal(tr8.to_state, PaymentBatchState.RECONCILING);

    // 9. RECONCILING -> PAID
    const { batch: b9, transition_record: tr9 } = await runner.markPaid(batchId, {
      actor_id: 'SETTLEMENT_MATCHER',
      actor_role: ActorRole.SYSTEM_SERVICE,
      metadata: { total_settled: 5400000, settled_records: 52 },
    });
    assert.equal(b9.status, PaymentBatchState.PAID);
    assert.equal(tr9.from_state, PaymentBatchState.RECONCILING);
    assert.equal(tr9.to_state, PaymentBatchState.PAID);

    // Verify full immutable history length and ordering
    const history = await runner.getTransitionHistory(batchId);
    assert.equal(history.length, 9);
    assert.deepEqual(
      history.map((h) => h.to_state),
      [
        PaymentBatchState.DRAFT,
        PaymentBatchState.VALIDATING,
        PaymentBatchState.VALIDATED,
        PaymentBatchState.PENDING_APPROVAL,
        PaymentBatchState.APPROVED,
        PaymentBatchState.FILE_GENERATED,
        PaymentBatchState.SUBMITTED,
        PaymentBatchState.RECONCILING,
        PaymentBatchState.PAID,
      ]
    );
  });

  await t.test('2. Rejection of Illegal State Skips and Step Jumps', async () => {
    const runner = new PaymentBatchTransitionRunner();
    const batchId = 'BATCH-ILLEGAL-001';

    await runner.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-09',
      batch_name: 'Test Illegal Skips',
      maker_id: 'MAKER_1',
      record_count: 10,
    });

    // ❌ Skip 1: DRAFT -> APPROVED
    await assert.rejects(
      async () => {
        await runner.approveBatch(batchId, {
          checker_id: 'CHECKER_1',
          actor_role: ActorRole.PAYROLL_CHECKER,
        });
      },
      (err) => {
        assert(err instanceof IllegalStateTransitionError);
        assert.equal(err.fromState, PaymentBatchState.DRAFT);
        assert.equal(err.event, BatchTransitionEvent.APPROVE_BATCH);
        return true;
      }
    );

    // ❌ Skip 2: DRAFT -> FILE_GENERATED
    await assert.rejects(
      async () => {
        await runner.generateFile(batchId, {
          actor_id: 'MAKER_1',
          checksum: 'abc12345',
          actor_role: ActorRole.PAYROLL_MAKER,
        });
      },
      (err) => err instanceof IllegalStateTransitionError
    );

    // ❌ Skip 3: DRAFT -> PAID
    await assert.rejects(
      async () => {
        await runner.markPaid(batchId, {
          actor_id: 'SYS',
          actor_role: ActorRole.SYSTEM_SERVICE,
        });
      },
      (err) => err instanceof IllegalStateTransitionError
    );
  });

  await t.test('3. Segregation of Duties (4-Eyes Rule) Enforced on Approval', async () => {
    const runner = new PaymentBatchTransitionRunner();
    const batchId = 'BATCH-4EYES-001';
    const makerId = 'NANDAN_MAKER';

    await runner.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-09',
      batch_name: '4-Eyes Verification Batch',
      maker_id: makerId,
      record_count: 5,
    });

    await runner.startValidation(batchId, { actor_id: makerId });
    await runner.markValidationPassed(batchId, { actor_id: 'VAL_ENGINE' });
    await runner.submitForApproval(batchId, { actor_id: makerId });

    // ❌ Maker tries to approve their own batch
    await assert.rejects(
      async () => {
        await runner.approveBatch(batchId, {
          checker_id: makerId, // Same as maker_id!
          actor_role: ActorRole.PAYROLL_CHECKER,
        });
      },
      (err) => {
        assert(err instanceof UnauthorizedTransitionError);
        assert.match(err.message, /Segregation of Duties Violation/);
        return true;
      }
    );

    // ✅ Different Checker approves successfully
    const { batch } = await runner.approveBatch(batchId, {
      checker_id: 'ABHISHEK_CHECKER',
      actor_role: ActorRole.PAYROLL_CHECKER,
    });
    assert.equal(batch.status, PaymentBatchState.APPROVED);
    assert.equal(batch.checker_id, 'ABHISHEK_CHECKER');
  });

  await t.test('4. Precondition Failure Guards', async () => {
    const runner = new PaymentBatchTransitionRunner();
    const batchId = 'BATCH-PRECOND-001';

    await runner.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-09',
      batch_name: 'Precondition Test',
      maker_id: 'MAKER_1',
      record_count: 10,
    });

    await runner.startValidation(batchId, { actor_id: 'MAKER_1' });

    // ❌ Validation cannot pass if blocking issues remain
    await assert.rejects(
      async () => {
        await runner.markValidationPassed(batchId, {
          actor_id: 'VAL_ENGINE',
          metadata: { blocking_issues_count: 2 },
        });
      },
      (err) => err instanceof PreconditionFailedError
    );
  });

  await t.test('5. Enforced Retry & Re-open Rules: REOPENED_FOR_RETRY creates auditable record without overwriting history', async () => {
    const runner = new PaymentBatchTransitionRunner();
    const batchId = 'BATCH-RETRY-001';
    const makerId = 'MAKER_NANDAN';
    const checkerId = 'CHECKER_ABHISHEK';

    // 1. Initialize
    await runner.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-09',
      batch_name: 'Remediated Batch with Retry',
      maker_id: makerId,
      record_count: 15,
    });

    // 2. Start validation and fail it
    await runner.startValidation(batchId, { actor_id: makerId });
    const { batch: failedBatch } = await runner.markValidationFailed(batchId, {
      actor_id: 'VAL_ENGINE',
      reason: '3 blocking errors detected: invalid IFSC and missing account number',
      metadata: { failed_employees: ['EMP021', 'EMP037', 'EMP052'] },
    });
    assert.equal(failedBatch.status, PaymentBatchState.FAILED);

    // 3. Re-open for retry (emits REOPENED_FOR_RETRY)
    const { batch: reopenedBatch, transition_record: retryRecord } = await runner.reopenForRetry(batchId, {
      actor_id: makerId,
      actor_role: ActorRole.PAYROLL_MAKER,
      reason: 'IFSC and account number corrected in employee master records',
      remediated_issues: ['GATE_04_IFSC_REGEX', 'GATE_03_ACCOUNT_FORMAT'],
      metadata: { remediation_ticket: 'HR-FIX-8819' },
    });

    assert.equal(reopenedBatch.status, PaymentBatchState.DRAFT);
    assert.equal(reopenedBatch.retry_count, 1);
    assert.equal(retryRecord.event, BatchTransitionEvent.REOPENED_FOR_RETRY);
    assert.equal(retryRecord.from_state, PaymentBatchState.FAILED);
    assert.equal(retryRecord.to_state, PaymentBatchState.DRAFT);
    assert.equal(retryRecord.metadata.remediation_reason, 'IFSC and account number corrected in employee master records');

    // 4. Progress re-opened batch through full validation, approval, and settlement
    await runner.startValidation(batchId, { actor_id: makerId });
    await runner.markValidationPassed(batchId, { actor_id: 'VAL_ENGINE' });
    await runner.submitForApproval(batchId, { actor_id: makerId });
    await runner.approveBatch(batchId, { checker_id: checkerId });
    await runner.generateFile(batchId, {
      actor_id: makerId,
      checksum: 'sha256_remediated_file_hash_998877665544332211',
    });
    await runner.transmitToBank(batchId, { actor_id: checkerId });
    await runner.startReconciliation(batchId, { actor_id: 'BANK_GW' });
    const { batch: finalPaidBatch } = await runner.markPaid(batchId, { actor_id: 'RECON_ENGINE' });

    assert.equal(finalPaidBatch.status, PaymentBatchState.PAID);
    assert.equal(finalPaidBatch.retry_count, 1);

    // 5. Verify that past audit history contains failure, retry event, and subsequent steps
    const history = await runner.getTransitionHistory(batchId);
    assert.equal(history.length, 12); // Genesis + StartVal + ValFailed + ReopenRetry + StartVal2 + ValPassed + Submit + Approve + GenFile + Transmit + Recon + Paid

    const eventSequence = history.map((h) => h.event);
    assert.deepEqual(eventSequence, [
      'INITIALIZE_BATCH',
      BatchTransitionEvent.START_VALIDATION,
      BatchTransitionEvent.VALIDATION_FAILED,
      BatchTransitionEvent.REOPENED_FOR_RETRY,
      BatchTransitionEvent.START_VALIDATION,
      BatchTransitionEvent.VALIDATION_PASSED,
      BatchTransitionEvent.SUBMIT_FOR_APPROVAL,
      BatchTransitionEvent.APPROVE_BATCH,
      BatchTransitionEvent.GENERATE_FILE,
      BatchTransitionEvent.TRANSMIT_TO_BANK,
      BatchTransitionEvent.START_RECONCILIATION,
      BatchTransitionEvent.SETTLEMENT_COMPLETED,
    ]);

    // Check sequence numbers are strictly incrementing 1..12
    for (let i = 0; i < history.length; i++) {
      assert.equal(history[i].sequence_number, i + 1);
    }
  });

  await t.test('6. Immutable History Store Invariant & Defensive Copying', async () => {
    const historyRepo = new BatchTransitionHistoryRepository();
    const batchId = 'BATCH-IMMUTABLE-001';

    await historyRepo.append({
      batch_id: batchId,
      from_state: PaymentBatchState.DRAFT,
      to_state: PaymentBatchState.VALIDATING,
      event: BatchTransitionEvent.START_VALIDATION,
      actor_id: 'ACTOR_1',
      actor_role: ActorRole.PAYROLL_MAKER,
      metadata: { original_key: 'original_value' },
    });

    const history = await historyRepo.getHistory(batchId);
    assert.equal(history.length, 1);

    // Attempt to tamper with returned history copy
    history[0].to_state = 'TAMPERED_STATE';
    history[0].metadata.original_key = 'TAMPERED_VALUE';

    // Verify pristine internal state
    const cleanHistory = await historyRepo.getHistory(batchId);
    assert.equal(cleanHistory[0].to_state, PaymentBatchState.VALIDATING);
    assert.equal(cleanHistory[0].metadata.original_key, 'original_value');
  });

});
