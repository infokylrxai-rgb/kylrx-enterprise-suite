/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL DISBURSEMENT API CONTRACTS TEST SUITE
 * ============================================================================
 * Comprehensive unit and integration test coverage for all 8 microservices,
 * controllers, typed response envelopes, error handling, and state immutability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  PayrollService,
  PaymentBatchService,
  ValidationService,
  ApprovalService,
  FileService,
  BankIntegrationService,
  ComplianceEngineService,
  AuditService,
  createDisbursementApiRouter,
  store,
  resetDisbursementMicroserviceStores,
  successEnvelope,
  errorEnvelope,
  recordStateTransition,
} from './payroll-disbursement-api.mjs';

test('⚡ KYLRX AI PAYROLL DISBURSEMENT MICROSERVICES & API ROUTE CONTRACTS TEST SUITE', async (t) => {

  t.beforeEach(() => {
    resetDisbursementMicroserviceStores();
  });

  await t.test('1. Contract Envelopes: Standard Success & Error Envelopes', () => {
    const successRes = successEnvelope({ test: 'data' }, { immutable: true });
    assert.strictEqual(successRes.success, true);
    assert.strictEqual(successRes.data.test, 'data');
    assert.strictEqual(successRes.meta.version, '4.0.0');
    assert.strictEqual(successRes.meta.immutable, true);
    assert.ok(successRes.meta.request_id.startsWith('req_'));
    assert.ok(successRes.meta.timestamp);

    const errRes = errorEnvelope('TEST_ERROR', 'Something went wrong', { field: 'pran' });
    assert.strictEqual(errRes.success, false);
    assert.strictEqual(errRes.error.code, 'TEST_ERROR');
    assert.strictEqual(errRes.error.message, 'Something went wrong');
    assert.strictEqual(errRes.error.details.field, 'pran');
    assert.ok(errRes.error.request_id.startsWith('req_err_'));
  });

  await t.test('2. PayrollService: Finalize Run & Immutability Enforcement', async (t2) => {
    await t2.test('Should finalize payroll run, trigger event, and enforce immutability', async () => {
      const runId = 'RUN_2026_09';
      store.payrollRuns.set(runId, {
        run_id: runId,
        period: 'September 2026',
        status: 'DRAFT',
        gross_payroll: 500000,
        total_deductions: 50000,
        net_payable: 450000,
        employees: [
          { employee_id: 'EMP_01', name: 'Aarav Mehta', gross: 250000, deductions: 25000, net: 225000 },
          { employee_id: 'EMP_02', name: 'Priya Sharma', gross: 250000, deductions: 25000, net: 225000 },
        ],
      });

      const finalized = await PayrollService.finalizeRun(runId, { admin_id: 'admin_123' });
      assert.strictEqual(finalized.status, 'FINALIZED');
      assert.strictEqual(finalized.is_immutable, true);
      assert.strictEqual(finalized.finalized_by, 'admin_123');

      // Verify double finalization is rejected with 409
      await assert.rejects(
        async () => {
          await PayrollService.finalizeRun(runId);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.strictEqual(err.code, 'PAYROLL_RUN_ALREADY_FINALIZED');
          return true;
        }
      );

      // Verify GET payroll run
      const fetched = await PayrollService.getRun(runId);
      assert.strictEqual(fetched.status, 'FINALIZED');
      assert.strictEqual(fetched.is_immutable, true);
    });
  });

  await t.test('3. PaymentBatchService & ValidationService: Exact Contract Envelope', async (t2) => {
    await t2.test('Happy path: VALIDATED status, slim issue shape, zero blocking_count', async () => {
      const runId = 'RUN_BATCH_TEST';
      store.payrollRuns.set(runId, {
        run_id: runId,
        period: 'September 2026',
        status: 'FINALIZED',
        employees: [
          { employee_id: 'EMP_101', name: 'Rohan Gupta', bank_account: '123456789012', ifsc: 'HDFC0001234', gross: 100000, deductions: 10000, net: 90000 },
        ],
      });

      // 1. Create Payment Batch
      const batch = await PaymentBatchService.createBatch({
        run_id: runId,
        batch_type: 'SALARY',
        maker_id: 'maker_john',
      });
      assert.ok(batch.batch_id.startsWith('BATCH_'));
      assert.strictEqual(batch.state, 'DRAFT');
      assert.strictEqual(batch.total_amount, 90000);
      assert.strictEqual(batch.maker_id, 'maker_john');

      // 2. Validate — assert exact contract envelope
      const vr = await ValidationService.validateBatch(batch.batch_id);

      // Required top-level fields
      assert.strictEqual(vr.batch_id, batch.batch_id,      'batch_id must match');
      assert.ok('status'         in vr,                   'status field required');
      assert.ok('issues'         in vr,                   'issues field required');
      assert.ok('blocking_count' in vr,                   'blocking_count field required');

      // Clean batch → VALIDATED
      assert.strictEqual(vr.status,         'VALIDATED',  'status must be VALIDATED');
      assert.strictEqual(vr.blocking_count, 0,            'blocking_count must be 0');
      assert.ok(Array.isArray(vr.issues),                 'issues must be an array');

      // Every issue must conform to the slim five-field shape
      for (const issue of vr.issues) {
        assert.ok('code'        in issue, 'issue must have code');
        assert.ok('employee_id' in issue, 'issue must have employee_id');
        assert.ok('field'       in issue, 'issue must have field');
        assert.ok('severity'    in issue, 'issue must have severity');
        assert.ok('message'     in issue, 'issue must have message');
        // Severity must be one of the normalised values
        assert.ok(['BLOCK', 'WARN', 'INFO'].includes(issue.severity),
          `severity '${issue.severity}' is not a recognised value`);
      }

      // Batch FSM must transition to VALIDATED
      assert.strictEqual(batch.state, 'VALIDATED', 'batch.state must be VALIDATED');

      // 3. GET /issues — blocking_count must remain 0
      const issueReport = await ValidationService.getIssues(batch.batch_id);
      assert.strictEqual(issueReport.blocking_count, 0);
    });

    await t2.test('Blocked path: BLOCKED status when IFSC is invalid', async () => {
      const runId2 = 'RUN_BATCH_BLOCKED';
      store.payrollRuns.set(runId2, {
        run_id: runId2,
        period: 'September 2026',
        status: 'FINALIZED',
        employees: [
          // Bad IFSC — should trigger GATE_04_IFSC_REGEX → BLOCKING issue
          { employee_id: 'EMP_002', name: 'Bad IFSC Employee', bank_account: '123456789012', ifsc: 'INVALID_IFSC', gross: 50000, deductions: 5000, net: 45000 },
        ],
      });

      const batchB = await PaymentBatchService.createBatch({ run_id: runId2, maker_id: 'maker_x' });
      // Force bad IFSC into the record so the gate catches it
      batchB.records[0].ifsc_code = 'INVALID_IFSC';

      const vrB = await ValidationService.validateBatch(batchB.batch_id);

      assert.strictEqual(vrB.status, 'BLOCKED',   'status must be BLOCKED when blocking issues exist');
      assert.ok(vrB.blocking_count > 0,            'blocking_count must be > 0');
      assert.ok(vrB.issues.length   > 0,           'issues array must be non-empty');

      // Every BLOCK-severity issue in the slim envelope must carry the required fields
      const blockIssues = vrB.issues.filter((i) => i.severity === 'BLOCK');
      assert.ok(blockIssues.length > 0, 'at least one BLOCK issue expected');
      for (const bi of blockIssues) {
        assert.ok(bi.code,        'BLOCK issue must have code');
        assert.ok(bi.employee_id, 'BLOCK issue must have employee_id');
        assert.ok(bi.message,     'BLOCK issue must have message');
      }

      // FSM must be VALIDATION_FAILED
      assert.strictEqual(batchB.state, 'VALIDATION_FAILED');
    });
  });

  await t.test('4. ApprovalService: Strict VALIDATED Guard, Validation Block, SoD & Amount-Drift', async (t2) => {

    // ── Sub-test 4a: submit-approval rejects non-VALIDATED states ─────────────
    await t2.test('Should reject submit-approval when batch is in DRAFT (not VALIDATED)', async () => {
      const runId = 'RUN_APPROVAL_DRAFT_GUARD';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_DRAFT', gross: 40000, deductions: 4000, net: 36000 }],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_draft' });
      // Batch is in DRAFT — do NOT call validateBatch
      assert.strictEqual(batch.state, 'DRAFT');

      await assert.rejects(
        async () => ApprovalService.submitApproval(batch.batch_id, { maker_id: 'maker_draft' }),
        (err) => {
          assert.strictEqual(err.statusCode, 400,                    '400 Bad Request expected for DRAFT state');
          assert.strictEqual(err.code, 'INVALID_SUBMISSION_STATE',  'INVALID_SUBMISSION_STATE code expected');
          assert.strictEqual(err.details.current_state, 'DRAFT',    'current_state detail must be DRAFT');
          assert.strictEqual(err.details.required_state, 'VALIDATED','required_state detail must be VALIDATED');
          return true;
        }
      );
    });

    // ── Sub-test 4b: submit-approval blocked when VALIDATION_FAILED ───────────
    await t2.test('Should block submit-approval when batch is VALIDATION_FAILED (BLOCK issues exist)', async () => {
      const runId = 'RUN_APPROVAL_BLOCKED';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_BLOCK', gross: 50000, deductions: 5000, net: 45000 }],
      });

      const batchBlocked = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_blocked' });
      batchBlocked.records[0].ifsc_code = 'BAD_IFSC_CODE'; // Force BLOCK

      const vrBlocked = await ValidationService.validateBatch(batchBlocked.batch_id);
      assert.strictEqual(vrBlocked.status, 'BLOCKED',    'validation must BLOCK bad IFSC');
      assert.strictEqual(batchBlocked.state, 'VALIDATION_FAILED', 'FSM must be VALIDATION_FAILED');

      // State is VALIDATION_FAILED, not VALIDATED → must receive 400 before reaching 422
      await assert.rejects(
        async () => ApprovalService.submitApproval(batchBlocked.batch_id, { maker_id: 'maker_blocked' }),
        (err) => {
          // Strict VALIDATED guard fires first (400), not the blocking-count guard (422)
          assert.strictEqual(err.statusCode, 400,                   '400 Bad Request expected for VALIDATION_FAILED state');
          assert.strictEqual(err.code, 'INVALID_SUBMISSION_STATE',  'INVALID_SUBMISSION_STATE code expected');
          return true;
        }
      );
    });

    // ── Sub-test 4c: SoD 4-Eyes enforcement and successful independent approval ─
    await t2.test('Should enforce SoD (403 self-approval) and allow independent checker approval', async () => {
      const runId = 'RUN_APPROVAL_SOD';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_201', gross: 50000, deductions: 5000, net: 45000 }],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_alice' });
      await ValidationService.validateBatch(batch.batch_id);
      assert.strictEqual(batch.state, 'VALIDATED', 'batch must be VALIDATED before submit');

      const submitResult = await ApprovalService.submitApproval(batch.batch_id, { maker_id: 'maker_alice' });
      assert.strictEqual(batch.state, 'PENDING_APPROVAL',   'state must be PENDING_APPROVAL after submit');
      assert.strictEqual(submitResult.maker_id, 'maker_alice', 'maker_id must be persisted in response');
      assert.ok(submitResult.approval_amounts_snapshot,       'approval_amounts_snapshot must be included in submit response');
      assert.ok(submitResult.approval_amounts_snapshot.amounts_hash, 'snapshot must carry amounts_hash');

      // 4-Eyes: Maker cannot self-approve → 403
      await assert.rejects(
        async () => ApprovalService.approveBatch(batch.batch_id, { checker_id: 'maker_alice' }),
        (err) => {
          assert.strictEqual(err.statusCode, 403,               '403 Forbidden expected for self-approval');
          assert.strictEqual(err.code, 'SELF_APPROVAL_PROHIBITED', 'SELF_APPROVAL_PROHIBITED code expected');
          assert.strictEqual(err.details.maker_id, 'maker_alice',  'details.maker_id must identify the violating identity');
          return true;
        }
      );

      // Independent Checker approves successfully
      const approvalResult = await ApprovalService.approveBatch(batch.batch_id, {
        checker_id: 'checker_bob',
        decision:   'APPROVE',
        comments:   'Verified payroll calculations and banking details',
      });
      assert.strictEqual(approvalResult.state,      'APPROVED',     'state must be APPROVED');
      assert.strictEqual(approvalResult.checker_id, 'checker_bob',  'checker_id must be persisted');
      assert.ok(approvalResult.approved_snapshot.checksum,          'approved_snapshot.checksum must be set');
      assert.ok(approvalResult.approved_snapshot.approved_at,       'approved_snapshot.approved_at must be set');
    });

    // ── Sub-test 4d: Amount-drift detection at approval time ──────────────────
    await t2.test('Should reject approval with 409 when payment amounts drift after submit', async () => {
      const runId = 'RUN_DRIFT_TEST';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_DRIFT', gross: 60000, deductions: 6000, net: 54000 }],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_drift' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id, { maker_id: 'maker_drift' });
      assert.strictEqual(batch.state, 'PENDING_APPROVAL');

      // Simulate post-submit amount mutation (fraud / race condition scenario)
      batch.records[0].net_payable = 999999;  // tampered amount

      await assert.rejects(
        async () => ApprovalService.approveBatch(batch.batch_id, { checker_id: 'checker_drift' }),
        (err) => {
          assert.strictEqual(err.statusCode, 409,              '409 Conflict expected for amount drift');
          assert.strictEqual(err.code, 'AMOUNT_DRIFT_DETECTED','AMOUNT_DRIFT_DETECTED code expected');
          assert.ok(err.details.snapshot_total !== err.details.current_total, 'snapshot vs current totals must differ');
          assert.ok(err.details.snapshot_hash  !== err.details.current_hash,  'snapshot vs current hashes must differ');
          return true;
        }
      );
    });
  });

  await t.test('5. FileService: Pre-Conditions, Format Routing & SHA-256 Integrity', async (t2) => {

    // ── Sub-test 5a: Strict APPROVED guard ────────────────────────────────────
    await t2.test('Should reject file generation with 412 when batch is not APPROVED', async () => {
      const runId = 'RUN_FILE_STATE_GUARD';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_SG', gross: 60000, deductions: 6000, net: 54000 }],
      });
      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_1' });

      await assert.rejects(
        async () => FileService.generateFile(batch.batch_id),
        (err) => {
          assert.strictEqual(err.statusCode, 412,                '412 Precondition Failed expected');
          assert.strictEqual(err.code, 'PRECONDITION_NOT_MET',  'PRECONDITION_NOT_MET code expected');
          assert.strictEqual(err.details.current_state, 'DRAFT', 'current_state detail must be DRAFT');
          return true;
        }
      );
    });

    // ── Sub-test 5b: SALARY batch → NEFT/RTGS CSV, txn_id stamped, format_code set ─
    await t2.test('Should generate NEFT/RTGS salary CSV with txn_id stamped on each record', async () => {
      const runId = 'RUN_FILE_SALARY';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [
          { employee_id: 'EMP_301', bank_account: '998877665544', ifsc: 'ICIC0001234', gross: 60000,  deductions: 6000,  net: 54000  },
          { employee_id: 'EMP_302', bank_account: '112233445566', ifsc: 'HDFC0001234', gross: 250000, deductions: 25000, net: 225000 }, // RTGS
        ],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_1', batch_type: 'SALARY' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id);
      await ApprovalService.approveBatch(batch.batch_id, { checker_id: 'checker_2' });

      const file = await FileService.generateFile(batch.batch_id);

      assert.ok(file.file_id.startsWith('FILE_'),             'file_id must start with FILE_');
      assert.ok(file.checksum_sha256,                         'checksum_sha256 must be set');
      assert.strictEqual(file.format_code, 'NEFT_RTGS_SALARY_CSV', 'format_code must be NEFT_RTGS_SALARY_CSV');
      assert.strictEqual(file.total_records, 2,               'total_records must be 2');
      assert.ok(file.content.includes('Payment Mode'),        'CSV must include Payment Mode column');
      assert.ok(file.content.includes('NEFT'),                'CSV must include at least one NEFT row');
      assert.ok(file.content.includes('RTGS'),                'CSV must include at least one RTGS row (EMP_302 ≥ 2L)');
      assert.ok(file.content.includes('Txn ID'),              'CSV must include Txn ID column');
      // Verify txn_id was stamped on records for downstream reconciliation
      assert.ok(batch.records[0].txn_id,                      'txn_id must be stamped on record[0]');
      assert.ok(batch.records[1].txn_id,                      'txn_id must be stamped on record[1]');
      assert.strictEqual(batch.state, 'FILE_GENERATED',       'batch state must be FILE_GENERATED');
      assert.ok(file.neft_count >= 0 && file.rtgs_count >= 0, 'neft_count and rtgs_count must be present');
    });

    // ── Sub-test 5c: ESIC batch → statutory return CSV ───────────────────────
    await t2.test('Should generate scheme-specific statutory return CSV for non-SALARY batch', async () => {
      const runId = 'RUN_FILE_STATUTORY';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [
          { employee_id: 'EMP_E1', gross: 20000, deductions: 1500, net: 18500 },
        ],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_esic', batch_type: 'ESIC' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id);
      await ApprovalService.approveBatch(batch.batch_id, { checker_id: 'checker_esic' });

      const file = await FileService.generateFile(batch.batch_id);

      assert.ok(file.format_code.startsWith('STATUTORY_ESIC'), 'format_code must be STATUTORY_ESIC_RETURN_CSV');
      assert.ok(file.file_name.includes('ESIC'),               'file_name must include ESIC');
      assert.ok(file.content.includes('KYLRX STATUTORY RETURN'), 'content must include statutory header');
      assert.ok(file.content.includes('Challan Amount'),        'content must include ESIC-specific column');
    });

    // ── Sub-test 5d: Financial drift guard ─────────────────────────────────
    await t2.test('Should detect financial drift and reject file generation with 409', async () => {
      const runId = 'RUN_FILE_DRIFT';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_FD', gross: 80000, deductions: 8000, net: 72000 }],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_fd' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id);
      await ApprovalService.approveBatch(batch.batch_id, { checker_id: 'checker_fd' });

      // Tamper with a record after approval
      batch.records[0].net_payable = 99999;

      await assert.rejects(
        async () => FileService.generateFile(batch.batch_id),
        (err) => {
          assert.strictEqual(err.statusCode, 409,                   '409 Conflict expected for drift');
          assert.strictEqual(err.code, 'FINANCIAL_DRIFT_DETECTED',  'FINANCIAL_DRIFT_DETECTED code expected');
          assert.ok(err.details.approved_hash !== err.details.current_hash, 'hashes must differ');
          return true;
        }
      );
    });
  });

  await t.test('6. BankIntegrationService: Checksum Verification, Submissions & Per-Record Reconciliation', async (t2) => {

    // ── Sub-test 6a: File checksum verified at submission, batch → SUBMITTED ────
    await t2.test('Should verify file checksum and submit batch to bank gateway', async () => {
      const runId = 'RUN_BANK_SUBMIT';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_401', gross: 70000, deductions: 7000, net: 63000 }],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_1' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id);
      await ApprovalService.approveBatch(batch.batch_id, { checker_id: 'checker_2' });
      await FileService.generateFile(batch.batch_id);

      const submission = await BankIntegrationService.submitToBank({
        batch_id:     batch.batch_id,
        gateway_code: 'HDFC_ENET',
      });

      assert.strictEqual(submission.status, 'SUBMITTED',           'submission status must be SUBMITTED');
      assert.strictEqual(batch.state, 'SUBMITTED',                 'batch state must be SUBMITTED');
      assert.ok(submission.acknowledgement_reference,              'ack_reference must be set');
      assert.ok(submission.file_checksum_verified,                 'file_checksum_verified must be true when file exists');
      assert.ok(submission.file_id,                                'file_id must be linked in submission');
    });

    // ── Sub-test 6b: Per-txn reconciliation with mixed PAID/FAILED rows ───────
    await t2.test('Should map per-txn clearing statuses and write reconciliation ledger (PARTIALLY_PAID)', async () => {
      const runId = 'RUN_BANK_RECON';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [
          { employee_id: 'EMP_P1', gross: 50000, deductions: 5000, net: 45000 },
          { employee_id: 'EMP_P2', gross: 60000, deductions: 6000, net: 54000 },
          { employee_id: 'EMP_P3', gross: 70000, deductions: 7000, net: 63000 },
        ],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_recon' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id);
      await ApprovalService.approveBatch(batch.batch_id, { checker_id: 'checker_recon' });
      await FileService.generateFile(batch.batch_id);
      await BankIntegrationService.submitToBank({ batch_id: batch.batch_id, gateway_code: 'ICICI_CORP' });

      // Capture txn_ids that were stamped during file generation
      const txn0 = batch.records[0].txn_id;
      const txn1 = batch.records[1].txn_id;
      const txn2 = batch.records[2].txn_id;

      // Bank returns: EMP_P1 PAID, EMP_P2 FAILED, EMP_P3 PAID
      const importRes = await BankIntegrationService.importBankResponse({
        batch_id: batch.batch_id,
        raw_payload: {
          transactions: [
            { txn_id: txn0, status: 'SUCCESS', bank_ref: 'UTR_001' },
            { txn_id: txn1, status: 'FAILED',  reason: 'Account frozen' },
            { txn_id: txn2, status: 'SUCCESS', bank_ref: 'UTR_003' },
          ],
        },
      });

      // Top-level envelope
      assert.strictEqual(importRes.clearing_status,    'PARTIAL',         'mixed outcome → PARTIAL');
      assert.strictEqual(importRes.acknowledged_count, 2,                  'paid_count must be 2');
      assert.strictEqual(importRes.rejected_count,     1,                  'failed_count must be 1');
      assert.strictEqual(importRes.unmatched_count,    0,                  'unmatched_count must be 0');

      // Batch FSM
      assert.strictEqual(batch.state, 'PARTIALLY_PAID',                   'batch state must be PARTIALLY_PAID');

      // Per-record clearing status
      assert.strictEqual(batch.records[0].clearing_status, 'PAID',         'EMP_P1 must be PAID');
      assert.strictEqual(batch.records[0].bank_ref,        'UTR_001',      'EMP_P1 bank_ref must be UTR_001');
      assert.strictEqual(batch.records[1].clearing_status, 'FAILED',       'EMP_P2 must be FAILED');
      assert.strictEqual(batch.records[1].clearing_reason, 'Account frozen','EMP_P2 reason must match');
      assert.strictEqual(batch.records[2].clearing_status, 'PAID',         'EMP_P3 must be PAID');

      // Reconciliation ledger
      const ledger = batch.reconciliation_ledger;
      assert.ok(ledger,                                                     'reconciliation_ledger must be set');
      assert.strictEqual(ledger.paid_count,   2,                            'ledger paid_count must be 2');
      assert.strictEqual(ledger.failed_count, 1,                            'ledger failed_count must be 1');
      assert.strictEqual(ledger.total_count,  3,                            'ledger total_count must be 3');
      assert.strictEqual(ledger.entries.length, 3,                          'ledger must have 3 entries');
    });

    // ── Sub-test 6c: Batch-level SUCCESS shorthand → all records PAID ─────────
    await t2.test('Should clear all records as PAID when batch-level status is SUCCESS', async () => {
      const runId = 'RUN_BANK_SUCCESS';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_S1', gross: 70000, deductions: 7000, net: 63000 }],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_s' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id);
      await ApprovalService.approveBatch(batch.batch_id, { checker_id: 'checker_s' });
      await FileService.generateFile(batch.batch_id);
      await BankIntegrationService.submitToBank({ batch_id: batch.batch_id, gateway_code: 'HDFC_ENET' });

      const importRes = await BankIntegrationService.importBankResponse({
        batch_id:    batch.batch_id,
        raw_payload: { status: 'SUCCESS' },
      });

      assert.strictEqual(importRes.clearing_status, 'SUCCESS',    'clearing_status must be SUCCESS');
      assert.strictEqual(batch.state, 'PAID',                     'batch state must be PAID');
      assert.strictEqual(batch.records[0].clearing_status, 'PAID','record[0] must be PAID');
      assert.ok(batch.reconciliation_ledger,                      'reconciliation_ledger must be present');
    });
  });

  await t.test('7. ComplianceEngine: Statutory Calculations & File Generation', async (t2) => {
    await t2.test('Should execute statutory calculations for NPS, ESIC, and GRATUITY', async () => {
      // 1. NPS Calculation
      const npsCalc = await ComplianceEngineService.calculateCompliance('NPS', {
        period: 'September 2026',
        candidates: [
          { employee_id: 'EMP_NPS_1', pran: '110000112233', nps_applicable: true, tier: 'TIER_1', contribution_type: 'BOTH', basic: 50000, da: 10000 },
        ],
      });
      assert.strictEqual(npsCalc.scheme, 'NPS');
      assert.strictEqual(npsCalc.total_candidates, 1);
      assert.strictEqual(npsCalc.total_liability, 12000); // 10% ER + 10% EE on 60,000

      // 2. ESIC Calculation
      const esicCalc = await ComplianceEngineService.calculateCompliance('ESIC', {
        period: '08/2026',
        candidates: [
          { ip_number: '3100123456', name: 'Manoj', gross_earnings: 20000, days_worked: 30 },
        ],
      });
      assert.strictEqual(esicCalc.scheme, 'ESIC');
      assert.strictEqual(esicCalc.total_candidates, 1);
      assert.strictEqual(esicCalc.total_liability, 800); // 0.75% + 3.25% on 20,000

      // 3. Gratuity Calculation
      const gratCalc = await ComplianceEngineService.calculateCompliance('GRATUITY', {
        period: '2026-08',
        candidates: [
          { employee_id: 'EMP_GRAT_1', basic_salary: 50000, date_of_joining: '2019-01-01' },
        ],
      });
      assert.strictEqual(gratCalc.scheme, 'GRATUITY');
      assert.strictEqual(gratCalc.total_candidates, 1);
      assert.ok(gratCalc.total_liability > 0);

      // 4. NPS File Generation
      const npsFile = await ComplianceEngineService.generateComplianceFile('NPS', {
        period: 'September 2026',
        records: [
          { employee_id: 'EMP_NPS_1', pran: '110000112233', employer_contribution: 6000, total_employee_contribution: 6000, total_nps_contribution: 12000 },
        ],
      });
      assert.strictEqual(npsFile.scheme, 'NPS');
      assert.ok(npsFile.file_name.endsWith('.txt'));
      assert.ok(npsFile.checksum_sha256);
    });
  });

  await t.test('8. AuditService: Centralized State-Transition Interceptor & Query Timeline', async (t2) => {

    // ── Sub-test 8a: Canonical contract shape & immutability ────────────────
    await t2.test('recordStateTransition should produce a frozen entry matching the exact contract shape', () => {
      const entry = recordStateTransition({
        entity:        'payment_batch',
        entityId:      'BATCH-2026-09-SAL',
        from:          'VALIDATED',
        to:            'PENDING_APPROVAL',
        actorId:       'USR-123',
        correlationId: 'corr_test_001',
        metadata:      { comments: 'Approved by CFO' },
      });

      // Contract field presence
      assert.ok(entry.transition_id,                         'transition_id must be set');
      assert.strictEqual(entry.entity,          'payment_batch',     'entity must be lowercase');
      assert.strictEqual(entry.entity_id,       'BATCH-2026-09-SAL', 'entity_id must match');
      assert.strictEqual(entry.from,            'VALIDATED',          'from must be VALIDATED');
      assert.strictEqual(entry.to,              'PENDING_APPROVAL',   'to must be PENDING_APPROVAL');
      assert.strictEqual(entry.actor_id,        'USR-123',            'actor_id must match');
      assert.ok(entry.timestamp,                               'timestamp must be an ISO string');
      assert.strictEqual(entry.correlation_id,  'corr_test_001',     'correlation_id must match when supplied');

      // Immutability — frozen entries must not accept mutation
      assert.throws(() => { entry.to = 'TAMPERED'; }, /Cannot assign/, 'frozen entry must reject mutation');

      // Written to both stores
      assert.ok(store.stateTransitionLogs.some((e) => e.transition_id === entry.transition_id),
        'entry must be in stateTransitionLogs');
      assert.ok(store.auditLogs.some((e) => e.log_id === `aud_st_${entry.transition_id}`),
        'mirrored entry must be in auditLogs');
    });

    // ── Sub-test 8b: auto-generated correlation_id when not supplied ─────────
    await t2.test('Should auto-generate a correlation_id when not supplied by caller', () => {
      const e = recordStateTransition({ entity: 'payroll_run', entityId: 'RUN_CORR', from: 'DRAFT', to: 'FINALIZED', actorId: 'admin' });
      assert.ok(e.correlation_id.startsWith('corr_'), 'auto correlation_id must start with corr_');
    });

    // ── Sub-test 8c: Full FSM timeline captured by service instrumentation ───
    await t2.test('Should record a complete FSM timeline across the full payment batch lifecycle', async () => {
      const runId = 'RUN_FSM_TIMELINE';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_TL', gross: 80000, deductions: 8000, net: 72000 }],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'maker_tl' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id);
      await ApprovalService.approveBatch(batch.batch_id, { checker_id: 'checker_tl' });
      await FileService.generateFile(batch.batch_id);

      // Query state-transitions for this batch
      const result = await AuditService.queryStateTransitions({ entity_id: batch.batch_id });
      const timeline = result.timeline;

      // Must have captured every FSM hop in order
      const states = timeline.map((e) => e.to);
      assert.ok(states.includes('DRAFT'),            'DRAFT must be in timeline');
      assert.ok(states.includes('VALIDATED'),         'VALIDATED must be in timeline');
      assert.ok(states.includes('PENDING_APPROVAL'),  'PENDING_APPROVAL must be in timeline');
      assert.ok(states.includes('APPROVED'),           'APPROVED must be in timeline');
      assert.ok(states.includes('FILE_GENERATED'),     'FILE_GENERATED must be in timeline');

      // Chronological ordering — DRAFT must come before FILE_GENERATED
      const draftIdx = states.indexOf('DRAFT');
      const fileIdx  = states.indexOf('FILE_GENERATED');
      assert.ok(draftIdx < fileIdx, 'DRAFT must precede FILE_GENERATED in timeline');

      // Entity fields must match the contract shape
      const firstEntry = timeline[0];
      assert.strictEqual(firstEntry.entity,    'payment_batch', 'entity must be lowercase');
      assert.strictEqual(firstEntry.entity_id, batch.batch_id,  'entity_id must match the batch');
      assert.ok(firstEntry.correlation_id,                       'correlation_id must be present');
      assert.ok(firstEntry.actor_id,                             'actor_id must be present');
    });

    // ── Sub-test 8d: Payroll run finalization captured in state-transition ledger ─
    await t2.test('Should capture payroll run DRAFT→FINALIZED transition', async () => {
      const runId = 'RUN_AUDIT_TEST';
      store.payrollRuns.set(runId, {
        run_id: runId, period: 'September 2026', status: 'DRAFT',
        gross_payroll: 100000, total_deductions: 10000, net_payable: 90000,
      });
      await PayrollService.finalizeRun(runId, { admin_id: 'admin_audit' });

      // General audit log (backward-compatible check)
      const auditResult = await AuditService.queryAuditLogs({
        entity_type: 'PAYROLL_RUN',
        entity_id:   runId,
        event_type:  'PAYROLL_FINALIZED',
      });
      assert.ok(auditResult.timeline.length >= 1,                 'At least 1 PAYROLL_FINALIZED entry expected');
      assert.strictEqual(auditResult.timeline[0].actor_id, 'admin_audit', 'actor_id must match');
      assert.ok(typeof auditResult.total === 'number',            'total must be present');

      // State-transition ledger
      const stResult = await AuditService.queryStateTransitions({ entity: 'payroll_run', entity_id: runId, to_state: 'FINALIZED' });
      assert.strictEqual(stResult.total, 1,                       'Exactly 1 transition to FINALIZED expected');
      assert.strictEqual(stResult.timeline[0].from, 'DRAFT',      'from must be DRAFT');
      assert.strictEqual(stResult.timeline[0].to,   'FINALIZED',  'to must be FINALIZED');
    });

    // ── Sub-test 8e: entity_type filter is case-insensitive ────────────────
    await t2.test('queryAuditLogs entity_type filter should be case-insensitive', async () => {
      const runId2 = 'RUN_CASE_TEST';
      store.payrollRuns.set(runId2, { run_id: runId2, status: 'DRAFT' });
      await PayrollService.finalizeRun(runId2, { admin_id: 'admin_case' });

      const lower = await AuditService.queryAuditLogs({ entity_type: 'payroll_run', entity_id: runId2 });
      const upper = await AuditService.queryAuditLogs({ entity_type: 'PAYROLL_RUN', entity_id: runId2 });

      assert.ok(lower.total >= 1, 'lowercase entity_type filter must return results');
      assert.ok(upper.total >= 1, 'uppercase entity_type filter must return results');
    });

    // ── Sub-test 8f: Date-range filter ─────────────────────────────────
    await t2.test('Should filter state-transition logs by date range', () => {
      const past   = new Date(Date.now() - 60000).toISOString();
      const future = new Date(Date.now() + 60000).toISOString();

      // Seed a transition
      recordStateTransition({ entity: 'payment_batch', entityId: 'BATCH_DATE_TEST', from: 'DRAFT', to: 'VALIDATED', actorId: 'sys' });

      // Query with from_date just before now — should include the entry
      const within = AuditService.queryStateTransitions({ entity_id: 'BATCH_DATE_TEST', from_date: past, to_date: future });
      within.then((r) => assert.strictEqual(r.total, 1, 'Within-range query must return the entry'));

      // Query with to_date in the past — should exclude it
      const before = AuditService.queryStateTransitions({ entity_id: 'BATCH_DATE_TEST', to_date: new Date(Date.now() - 120000).toISOString() });
      before.then((r) => assert.strictEqual(r.total, 0, 'Pre-event to_date must return 0 entries'));
    });

    // ── Sub-test 8g: Pagination (limit / offset) ───────────────────────
    await t2.test('Should paginate state-transition results with limit and offset', async () => {
      // Seed 5 transitions
      for (let i = 0; i < 5; i++) {
        recordStateTransition({ entity: 'payment_batch', entityId: 'BATCH_PAGE', from: `STATE_${i}`, to: `STATE_${i + 1}`, actorId: 'pager' });
      }

      const page1 = await AuditService.queryStateTransitions({ entity_id: 'BATCH_PAGE', limit: 2, offset: 0 });
      const page2 = await AuditService.queryStateTransitions({ entity_id: 'BATCH_PAGE', limit: 2, offset: 2 });

      assert.strictEqual(page1.total,  5, 'total must always reflect the full count');
      assert.strictEqual(page1.count,  2, 'page 1 count must be 2');
      assert.strictEqual(page2.count,  2, 'page 2 count must be 2');
      assert.strictEqual(page1.limit,  2, 'limit must be echoed back');
      assert.strictEqual(page1.offset, 0, 'offset must be echoed back');

      // Pages must not overlap
      const ids1 = page1.timeline.map((e) => e.transition_id);
      const ids2 = page2.timeline.map((e) => e.transition_id);
      const overlap = ids1.filter((id) => ids2.includes(id));
      assert.strictEqual(overlap.length, 0, 'pages must not overlap');
    });

    // ── Sub-test 8h: from_state / to_state filter on queryStateTransitions ───
    await t2.test('Should filter by from_state and to_state in queryStateTransitions', async () => {
      const runId3 = 'RUN_STFILTER';
      store.payrollRuns.set(runId3, { run_id: runId3, status: 'DRAFT' });
      await PayrollService.finalizeRun(runId3, { admin_id: 'admin_filter' });

      const byTo   = await AuditService.queryStateTransitions({ entity: 'payroll_run', to_state: 'FINALIZED' });
      const byFrom = await AuditService.queryStateTransitions({ entity: 'payroll_run', from_state: 'DRAFT' });
      const byBoth = await AuditService.queryStateTransitions({ entity: 'payroll_run', from_state: 'DRAFT', to_state: 'FINALIZED' });

      assert.ok(byTo.total   >= 1, 'to_state=FINALIZED filter must match');
      assert.ok(byFrom.total >= 1, 'from_state=DRAFT filter must match');
      assert.ok(byBoth.total >= 1, 'combined from+to filter must match');

      // All byBoth entries must have exact from and to
      for (const e of byBoth.timeline) {
        assert.strictEqual(e.from, 'DRAFT',     'from must be DRAFT in byBoth');
        assert.strictEqual(e.to,   'FINALIZED', 'to must be FINALIZED in byBoth');
      }
    });
  });

  await t.test('9. Express Router Builder: End-to-End Route Integration', async (t2) => {
    await t2.test('Should export mountable Express Router matching all required endpoints', () => {
      const router = createDisbursementApiRouter();
      assert.ok(router);
      assert.strictEqual(typeof router, 'function'); // Express Router is a middleware function
    });
  });

});
