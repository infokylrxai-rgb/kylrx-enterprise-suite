/**
 * ============================================================================
 * KYLRX AI HRMS - MAKER-CHECKER APPROVAL SERVICE INTEGRATION TESTS
 * ============================================================================
 * Test Suite:
 *  1. Happy-path state machine progression
 *  2. Invalid transition guard enforcement
 *  3. 4-Eyes Segregation of Duties (Maker cannot approve)
 *  4. Checker rejection & retry flow
 *  5. State Isolation: Settling 'SALARY' batch leaves 'PF', 'ESIC', 'PT', 'NPS' untouched
 */

import assert from 'node:assert/strict';
import {
  MakerCheckerApprovalService,
  PaymentBatchRepository,
  BatchState,
  BatchType,
  StateTransitionError,
  SegregationOfDutiesError,
  ValidationError,
} from './maker-checker-service.mjs';

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING KYLRX AI MAKER-CHECKER SERVICE INTEGRATION TESTS');
  console.log('===============================================================\n');

  const repo = new PaymentBatchRepository();
  const service = new MakerCheckerApprovalService(repo);

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
  // TEST 1: Full Happy Path Transition Lifecycle
  // --------------------------------------------------------------------------
  await test('1. Full Lifecycle: DRAFT -> VALIDATED -> SUBMITTED -> APPROVED -> FILE_GENERATED -> SETTLED', async () => {
    const batchId = 'BATCH-SALARY-2026-08-CORE';
    const makerId = 'usr_maker_ananya';
    const checkerId = 'usr_checker_rajesh'; // Different user

    // 1. Create Batch (DRAFT)
    const draft = await service.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-08',
      batch_name: 'August 2026 Core Engineering Salary',
      batch_type: BatchType.SALARY,
      created_by_user_id: makerId,
      records: [
        { employee_id: 'EMP001', employee_name: 'Aarav Patel', net_payable_amount: 125000, ifsc_code: 'HDFC0001234', account_number_raw: '50100456789012' },
        { employee_id: 'EMP002', employee_name: 'Diya Sharma', net_payable_amount: 98000, ifsc_code: 'ICIC0005678', account_number_raw: '00110156789033' },
      ],
    });
    assert.equal(draft.status, BatchState.DRAFT);
    assert.equal(draft.summary.total_amount, 223000);
    assert.equal(draft.summary.total_records, 2);

    // 2. Validate Batch (VALIDATED)
    const validated = await service.validateBatch(batchId, makerId);
    assert.equal(validated.status, BatchState.VALIDATED);
    assert.equal(validated.validation_gate.is_passed, true);

    // 3. Submit for Approval (SUBMITTED_FOR_APPROVAL)
    const submitted = await service.submitForApproval(batchId, makerId, 'Payroll audited and verified against attendance logs.');
    assert.equal(submitted.status, BatchState.SUBMITTED_FOR_APPROVAL);
    assert.equal(submitted.maker_checker.maker_id, makerId);
    assert.equal(submitted.maker_checker.checker_id, null);

    // 4. Checker Approval (APPROVED)
    const approved = await service.approveBatch(batchId, checkerId, 'Reviewed disbursement totals. Approved for HDFC E-Net export.');
    assert.equal(approved.status, BatchState.APPROVED);
    assert.equal(approved.maker_checker.checker_id, checkerId);
    assert.ok(approved.maker_checker.checker_timestamp);

    // 5. Generate Bank File (FILE_GENERATED)
    const fileGen = await service.markFileGenerated(batchId, makerId, {
      file_id: 'FILE-HDFC-NEFT-88912',
      file_name: 'HDFC_SALARY_202608.csv',
      format: 'CSV',
      checksum_sha256: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
    });
    assert.equal(fileGen.status, BatchState.FILE_GENERATED);
    assert.equal(fileGen.bank_file_id, 'FILE-HDFC-NEFT-88912');

    // 6. Settle Batch (SETTLED)
    const settled = await service.settleBatch(
      batchId,
      {
        is_success: true,
        bank_utr: 'HDFCN26247890123',
        settled_amount: 223000,
        failed_amount: 0,
        settlement_reference: 'RECON-HDFC-20260831-01',
      },
      'system_recon_bot'
    );
    assert.equal(settled.status, BatchState.SETTLED);
    assert.equal(settled.settlement_details.bank_utr, 'HDFCN26247890123');
    assert.equal(settled.settlement_details.settled_amount, 223000);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Hard Security Rule - 4-Eyes Segregation of Duties
  // --------------------------------------------------------------------------
  await test('2. 4-Eyes Rule: Maker cannot approve their own batch (maker_id === checker_id throws)', async () => {
    const batchId = 'BATCH-4EYES-TEST';
    const makerId = 'usr_maker_same_person';

    await service.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-08',
      batch_name: 'Bonus Batch - Fast Track',
      batch_type: BatchType.BONUS,
      created_by_user_id: makerId,
      records: [
        { employee_id: 'EMP009', employee_name: 'Rohan Verma', net_payable_amount: 50000, ifsc_code: 'SBIN0001122', account_number_raw: '201994883921' },
      ],
    });

    await service.validateBatch(batchId, makerId);
    await service.submitForApproval(batchId, makerId, 'Attempting single-user workflow');

    // Attempting self-approval MUST reject with SegregationOfDutiesError
    await assert.rejects(
      async () => {
        await service.approveBatch(batchId, makerId, 'Self approving my own batch');
      },
      (err) => {
        assert.ok(err instanceof SegregationOfDutiesError);
        assert.match(err.message, /4-Eyes Rule Violation/);
        assert.equal(err.makerId, makerId);
        assert.equal(err.checkerId, makerId);
        return true;
      }
    );

    // Verify batch remains in SUBMITTED_FOR_APPROVAL and was NOT approved
    const batchAfterAttempt = await repo.findById(batchId);
    assert.equal(batchAfterAttempt.status, BatchState.SUBMITTED_FOR_APPROVAL);
    assert.equal(batchAfterAttempt.maker_checker.checker_id, null);

    // Verify security violation was logged in audit trail
    const auditLogs = repo.getAuditLogs(batchId);
    const violationLog = auditLogs.find((l) => l.action === 'SECURITY_VIOLATION_SELF_APPROVAL_ATTEMPT');
    assert.ok(violationLog, 'Security violation must be audited');
  });

  // --------------------------------------------------------------------------
  // TEST 3: State Machine Guards (Cannot skip required states)
  // --------------------------------------------------------------------------
  await test('3. State Machine Guards: Cannot approve DRAFT or generate file without approval', async () => {
    const batchId = 'BATCH-GUARD-TEST';
    await service.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-08',
      batch_name: 'Guard Batch',
      batch_type: BatchType.SALARY,
      created_by_user_id: 'maker_1',
      records: [
        { employee_id: 'EMP010', employee_name: 'Karan Mehra', net_payable_amount: 45000, ifsc_code: 'HDFC0004321', account_number_raw: '50100456789099' },
      ],
    });

    // 1. Cannot approve DRAFT directly
    await assert.rejects(
      async () => {
        await service.approveBatch(batchId, 'checker_1');
      },
      (err) => {
        assert.ok(err instanceof StateTransitionError);
        assert.equal(err.fromState, BatchState.DRAFT);
        return true;
      }
    );

    // 2. Cannot generate bank file while still in DRAFT or VALIDATED
    await service.validateBatch(batchId, 'maker_1');
    await assert.rejects(
      async () => {
        await service.markFileGenerated(batchId, 'maker_1', { file_name: 'illegal.csv' });
      },
      (err) => {
        assert.ok(err instanceof StateTransitionError);
        assert.equal(err.fromState, BatchState.VALIDATED);
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // TEST 4: Checker Rejection & Re-Submission Flow
  // --------------------------------------------------------------------------
  await test('4. Checker Rejection: Batch transitions to REJECTED with notes and can be re-worked', async () => {
    const batchId = 'BATCH-REJECT-TEST';
    const makerId = 'maker_alice';
    const checkerId = 'checker_bob';

    await service.createBatch({
      batch_id: batchId,
      payroll_run_id: 'PR-2026-08',
      batch_name: 'Offcycle Payout',
      batch_type: BatchType.SALARY,
      created_by_user_id: makerId,
      records: [
        { employee_id: 'EMP020', employee_name: 'Sneha Rao', net_payable_amount: 30000, ifsc_code: 'UTIB0001234', account_number_raw: '918020045678901' },
      ],
    });

    await service.validateBatch(batchId, makerId);
    await service.submitForApproval(batchId, makerId, 'Please approve');

    // Checker rejects
    const rejected = await service.rejectBatch(batchId, checkerId, 'Incorrect bonus component included for Sneha Rao');
    assert.equal(rejected.status, BatchState.REJECTED);
    assert.match(rejected.maker_checker.checker_comments, /Incorrect bonus component/);

    // Re-validate and re-submit after fixing
    const revalidated = await service.validateBatch(batchId, makerId);
    assert.equal(revalidated.status, BatchState.VALIDATED);

    const resubmitted = await service.submitForApproval(batchId, makerId, 'Corrected bonus deduction');
    assert.equal(resubmitted.status, BatchState.SUBMITTED_FOR_APPROVAL);

    const approved = await service.approveBatch(batchId, checkerId, 'Looks good now. Approved.');
    assert.equal(approved.status, BatchState.APPROVED);
  });

  // --------------------------------------------------------------------------
  // TEST 5: State Isolation between SALARY and STATUTORY batches (PF/ESIC/PT/NPS)
  // --------------------------------------------------------------------------
  await test('5. State Isolation: Settling SALARY batch does NOT mutate or settle PF, ESIC, PT, or NPS compliance batches', async () => {
    const runId = 'PR-2026-08-ISOLATION-DEMO';
    const makerId = 'usr_payroll_maker';
    const checkerId = 'usr_fin_controller';

    // 1. Create Salary Batch
    const salaryBatch = await service.createBatch({
      batch_id: 'BATCH-SALARY-AUG26',
      payroll_run_id: runId,
      batch_name: 'Monthly Salary Disbursement',
      batch_type: BatchType.SALARY,
      created_by_user_id: makerId,
      records: [
        { employee_id: 'EMP101', employee_name: 'Vikram Seth', net_payable_amount: 85000, ifsc_code: 'HDFC0001234', account_number_raw: '50100234567811' },
      ],
    });

    // 2. Create Statutory Compliance Batches in the same Payroll Run
    const pfBatch = await service.createBatch({
      batch_id: 'BATCH-PF-ECR-AUG26',
      payroll_run_id: runId,
      batch_name: 'PF Challan / ECR File Return',
      batch_type: BatchType.PF,
      created_by_user_id: makerId,
      records: [
        { employee_id: 'EMP101', uan: '100902345678', gross_wages: 85000, epf_wages: 15000, ee_share: 1800, er_share: 1800, net_payable_amount: 3600 },
      ],
    });

    const esicBatch = await service.createBatch({
      batch_id: 'BATCH-ESIC-AUG26',
      payroll_run_id: runId,
      batch_name: 'ESIC Monthly Return',
      batch_type: BatchType.ESIC,
      created_by_user_id: makerId,
      records: [
        { employee_id: 'EMP102', esic_ip_number: '3198765432', gross_wages: 20000, ee_share: 150, er_share: 650, net_payable_amount: 800 },
      ],
    });

    const ptBatch = await service.createBatch({
      batch_id: 'BATCH-PT-KA-AUG26',
      payroll_run_id: runId,
      batch_name: 'Karnataka Professional Tax Return',
      batch_type: BatchType.PT,
      created_by_user_id: makerId,
      records: [
        { employee_id: 'EMP101', pt_state: 'KA', net_payable_amount: 200 },
      ],
    });

    const npsBatch = await service.createBatch({
      batch_id: 'BATCH-NPS-SCF-AUG26',
      payroll_run_id: runId,
      batch_name: 'NPS Corporate CRA Contribution',
      batch_type: BatchType.NPS,
      created_by_user_id: makerId,
      records: [
        { employee_id: 'EMP101', pran: '110098765432', net_payable_amount: 8500 },
      ],
    });

    // Verify all batches start in DRAFT
    assert.equal(salaryBatch.status, BatchState.DRAFT);
    assert.equal(pfBatch.status, BatchState.DRAFT);
    assert.equal(esicBatch.status, BatchState.DRAFT);
    assert.equal(ptBatch.status, BatchState.DRAFT);
    assert.equal(npsBatch.status, BatchState.DRAFT);

    // Transition ONLY the Salary batch through validation, approval, and settlement
    await service.validateBatch(salaryBatch.batch_id, makerId);
    await service.submitForApproval(salaryBatch.batch_id, makerId, 'Salary disbursement ready');
    await service.approveBatch(salaryBatch.batch_id, checkerId, 'Approved for payment');
    await service.markFileGenerated(salaryBatch.batch_id, makerId, { file_id: 'BANK-CSV-001', file_name: 'salary_aug26.csv' });
    
    // SETTLE SALARY BATCH
    const settledSalary = await service.settleBatch(
      salaryBatch.batch_id,
      { is_success: true, bank_utr: 'SALARY-UTR-999888' },
      'recon_service'
    );
    assert.equal(settledSalary.status, BatchState.SETTLED);

    // FETCH ALL BATCHES FOR THE PAYROLL RUN AND VERIFY STATUTORY ISOLATION
    const allBatchesInRun = await repo.findByPayrollRunId(runId);
    const refreshedSalary = allBatchesInRun.find((b) => b.batch_id === salaryBatch.batch_id);
    const refreshedPf = allBatchesInRun.find((b) => b.batch_id === pfBatch.batch_id);
    const refreshedEsic = allBatchesInRun.find((b) => b.batch_id === esicBatch.batch_id);
    const refreshedPt = allBatchesInRun.find((b) => b.batch_id === ptBatch.batch_id);
    const refreshedNps = allBatchesInRun.find((b) => b.batch_id === npsBatch.batch_id);

    // SALARY is SETTLED
    assert.equal(refreshedSalary.status, BatchState.SETTLED);
    assert.equal(refreshedSalary.settlement_details.bank_utr, 'SALARY-UTR-999888');

    // STATUTORY batches MUST NOT be settled; they remain in DRAFT (unaffected)
    assert.equal(refreshedPf.status, BatchState.DRAFT, 'PF batch must remain in DRAFT');
    assert.equal(refreshedPf.settlement_details, null, 'PF batch settlement details must be null');

    assert.equal(refreshedEsic.status, BatchState.DRAFT, 'ESIC batch must remain in DRAFT');
    assert.equal(refreshedEsic.settlement_details, null, 'ESIC batch settlement details must be null');

    assert.equal(refreshedPt.status, BatchState.DRAFT, 'PT batch must remain in DRAFT');
    assert.equal(refreshedPt.settlement_details, null, 'PT batch settlement details must be null');

    assert.equal(refreshedNps.status, BatchState.DRAFT, 'NPS batch must remain in DRAFT');
    assert.equal(refreshedNps.settlement_details, null, 'NPS batch settlement details must be null');

    // Now demonstrate that PF can undergo its own independent lifecycle
    await service.validateBatch(pfBatch.batch_id, makerId);
    await service.submitForApproval(pfBatch.batch_id, makerId, 'PF ECR filing submission');
    const approvedPf = await service.approveBatch(pfBatch.batch_id, checkerId, 'PF ECR approved for TRRN generation');
    assert.equal(approvedPf.status, BatchState.APPROVED);

    const checkPf = await repo.findById(pfBatch.batch_id);
    assert.equal(checkPf.status, BatchState.APPROVED);
    assert.equal(checkPf.settlement_details, null);
  });

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} INTEGRATION TESTS PASSED SUCCESSFULLY!`);
  console.log('===============================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
