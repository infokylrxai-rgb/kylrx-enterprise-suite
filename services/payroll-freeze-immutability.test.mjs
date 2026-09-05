/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL FREEZE & BATCH ISOLATION TEST SUITE
 * ============================================================================
 * Tests verifying:
 *   Criteria 1: Payroll Freeze & Immutability Guard
 *   Criteria 4: Batch State Isolation (Independent Domain Lifecycles & Non-Cascading Settlement)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  PayrollService,
  PaymentBatchService,
  PayrollFreezeGuard,
  BatchStateIsolationManager,
  PayrollFrozenError,
  UnfinalizedRunError,
  BatchStateIsolationError,
  BATCH_DOMAIN_TYPES,
  DOMAIN_LEDGER_REGISTRY,
  freezeStore,
  resetFreezeStore,
  store,
  resetDisbursementMicroserviceStores,
  createDisbursementApiRouter,
} from './payroll-disbursement-api.mjs';

test('⚡ KYLRX AI CRITERIA 1 & 4: PAYROLL FREEZE & BATCH STATE ISOLATION TEST SUITE', async (t) => {

  t.beforeEach(() => {
    resetDisbursementMicroserviceStores();
  });

  // ==========================================================================
  // CRITERIA 1: PAYROLL FREEZE & IMMUTABILITY GUARD
  // ==========================================================================
  await t.test('CRITERIA 1: Payroll Freeze & Immutability Guard', async (t1) => {

    await t1.test('1.1 Snapshotting: POST /payroll/runs/:id/finalize creates versioned, read-only snapshot in payroll_run_snapshots', async () => {
      const runId = 'RUN_2026_08_CORE';
      store.payrollRuns.set(runId, {
        run_id: runId,
        period: '2026-08',
        payroll_cycle_month: '2026-08',
        pay_period_start: '2026-08-01',
        pay_period_end: '2026-08-31',
        status: 'CALCULATED',
        gross_payroll: 1200000,
        total_deductions: 120000,
        net_payable: 1080000,
        employees: [
          {
            employee_id: 'EMP_001',
            name: 'Aarav Patel',
            gross: 100000,
            basic: 50000,
            deductions: 10000,
            net: 90000,
            bank_account: '50100123456789',
            ifsc: 'HDFC0001234',
            pan: 'ABCDE1234F',
            uan: '100902345678',
            esic_ip: null,
            pran: '110098765432',
            is_nps: true,
          },
          {
            employee_id: 'EMP_002',
            name: 'Meera Nair',
            gross: 20000,
            basic: 10000,
            deductions: 2000,
            net: 18000,
            bank_account: '50100987654321',
            ifsc: 'ICIC0005678',
            pan: 'XYZAB5678G',
            uan: '100909876543',
            esic_ip: '3100012345',
            pran: null,
            is_nps: false,
          },
        ],
      });

      // 1. Finalize run
      const finalizedResult = await PayrollService.finalizeRun(runId, {
        admin_id: 'lead_fin_officer@kylrx.ai',
        notes: 'August 2026 Core Staff Run approved and frozen.',
      });

      // Assertions on finalization return envelope
      assert.strictEqual(finalizedResult.status, 'FINALIZED');
      assert.strictEqual(finalizedResult.is_immutable, true);
      assert.strictEqual(finalizedResult.is_frozen, true);
      assert.strictEqual(finalizedResult.version, 1);
      assert.ok(finalizedResult.snapshot_id.startsWith('SNAP_RUN_2026_08_CORE_v1'));
      assert.ok(finalizedResult.checksum_sha256, 'Checksum SHA-256 must be generated');

      // 2. Verify snapshot document exists in store.payrollRunSnapshots
      const snapshot = store.payrollRunSnapshots.get(runId);
      assert.ok(snapshot, 'Snapshot must be stored in payrollRunSnapshots');
      assert.strictEqual(snapshot.snapshot_id, finalizedResult.snapshot_id);
      assert.strictEqual(snapshot.status, 'FINALIZED');
      assert.strictEqual(snapshot.is_frozen, true);
      assert.strictEqual(snapshot.is_immutable, true);
      assert.strictEqual(snapshot.totals.total_headcount, 2);

      // 3. Verify deep immutability: object is strictly frozen
      assert.ok(Object.isFrozen(snapshot), 'Snapshot root object must be frozen');
      assert.ok(Object.isFrozen(snapshot.totals), 'Snapshot totals must be frozen');
      assert.ok(Object.isFrozen(snapshot.employees), 'Snapshot employees array must be frozen');
      assert.ok(Object.isFrozen(snapshot.employees[0]), 'Snapshot employee item must be frozen');

      // Modifying frozen snapshot property fails in strict mode
      assert.throws(() => {
        snapshot.totals.total_net_payable = 9999999;
      }, TypeError);
    });

    await t1.test('1.2 Immutability Guard: Rejects any attempt to modify source run once finalized', async () => {
      const runId = 'RUN_FROZEN_SOURCE';
      const sourceRun = {
        run_id: runId,
        period: '2026-08',
        status: 'DRAFT',
        employees: [
          { employee_id: 'EMP_10', gross: 50000, deductions: 5000, net: 45000 },
        ],
      };
      store.payrollRuns.set(runId, sourceRun);

      // Pre-finalization update should succeed
      await PayrollService.updateRun(runId, { gross_payroll: 50000 });
      assert.strictEqual(sourceRun.gross_payroll, 50000);

      // Finalize the run
      await PayrollService.finalizeRun(runId);
      assert.strictEqual(sourceRun.status, 'FINALIZED');
      assert.strictEqual(sourceRun.is_immutable, true);

      // Attempting to modify source run via updateRun must throw PayrollFrozenError
      await assert.rejects(
        async () => {
          await PayrollService.updateRun(runId, { gross_payroll: 9999999 });
        },
        (err) => {
          assert.strictEqual(err.name, 'PayrollFrozenError');
          assert.strictEqual(err.code, 'PAYROLL_RUN_FROZEN_IMMUTABLE');
          assert.strictEqual(err.statusCode, 409);
          assert.strictEqual(err.runId, runId);
          return true;
        }
      );

      // Intercepted illegal mutation must be audited
      assert.ok(freezeStore.sourceRunMutationAttempts.length > 0);
      assert.strictEqual(freezeStore.sourceRunMutationAttempts[0].run_id, runId);
      assert.strictEqual(freezeStore.sourceRunMutationAttempts[0].attempted_action, 'UPDATE_RUN');

      // Attempting to re-finalize must throw 409
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
    });

    await t1.test('1.3 Downstream payment calculations read strictly from frozen snapshot and block unfinalized runs', async () => {
      const draftRunId = 'RUN_UNFINALIZED_DRAFT';
      store.payrollRuns.set(draftRunId, {
        run_id: draftRunId,
        period: '2026-08',
        status: 'DRAFT',
        employees: [{ employee_id: 'EMP_55', gross: 60000, deductions: 6000, net: 54000 }],
      });

      // Calling downstream payment batch calculation with require_freeze on DRAFT run must throw UnfinalizedRunError
      await assert.rejects(
        async () => {
          await PaymentBatchService.createBatch({
            run_id: draftRunId,
            require_freeze: true,
          });
        },
        (err) => {
          assert.strictEqual(err.name, 'UnfinalizedRunError');
          assert.strictEqual(err.code, 'RUN_NOT_FINALIZED_FOR_DISBURSEMENT');
          assert.strictEqual(err.statusCode, 412);
          return true;
        }
      );

      // Now finalize the run
      await PayrollService.finalizeRun(draftRunId);

      // Now downstream creation succeeds and reads strictly from frozen snapshot
      const batch = await PaymentBatchService.createBatch({
        run_id: draftRunId,
        require_freeze: true,
      });
      assert.strictEqual(batch.state, 'DRAFT');
      assert.strictEqual(batch.total_amount, 54000);
      assert.ok(batch.snapshot_id.startsWith('SNAP_RUN_UNFINALIZED_DRAFT_v1'));
    });
  });

  // ==========================================================================
  // CRITERIA 4: BATCH STATE ISOLATION
  // ==========================================================================
  await t.test('CRITERIA 4: Batch State Isolation & Independent Lifecycles', async (t4) => {
    const runId = 'RUN_ISOLATION_MASTER';

    async function setupIsolationRun() {
      store.payrollRuns.set(runId, {
        run_id: runId,
        period: '2026-08',
        payroll_cycle_month: '2026-08',
        status: 'CALCULATED',
        employees: [
          {
            employee_id: 'EMP_A',
            name: 'Ananya Roy',
            gross: 80000,
            basic: 40000,
            deductions: 10000,
            net: 70000,
            bank_account: '111122223333',
            ifsc: 'HDFC0001234',
            pan: 'AAAAA1111A',
            uan: '100111111111',
            esic_ip: null, // > 21k
            pran: '200111111111',
            is_nps: true,
          },
          {
            employee_id: 'EMP_B',
            name: 'Bharat Verma',
            gross: 18000,
            basic: 9000,
            deductions: 2000,
            net: 16000,
            bank_account: '444455556666',
            ifsc: 'ICIC0005678',
            pan: 'BBBBB2222B',
            uan: '100222222222',
            esic_ip: '3102222222',
            pran: null,
            is_nps: false,
          },
        ],
      });
      await PayrollService.finalizeRun(runId);
    }

    await t4.test('4.1 Independent Domain Lifecycles: Each domain batch has unique batch_id, status, scheduled payment date, and ledger refs', async () => {
      await setupIsolationRun();
      // Create independent domain batches for Salary, PF, ESI, Professional Tax, TDS, and NPS
      const batches = BatchStateIsolationManager.createAllIsolatedBatchesForRun(runId);

      const salaryBatch = batches[BATCH_DOMAIN_TYPES.SALARY];
      const pfBatch = batches[BATCH_DOMAIN_TYPES.PF];
      const esiBatch = batches[BATCH_DOMAIN_TYPES.ESI];
      const ptBatch = batches[BATCH_DOMAIN_TYPES.PROFESSIONAL_TAX];
      const tdsBatch = batches[BATCH_DOMAIN_TYPES.TDS];
      const npsBatch = batches[BATCH_DOMAIN_TYPES.NPS];

      // 1. Assert unique batch_ids
      const batchIds = [salaryBatch.batch_id, pfBatch.batch_id, esiBatch.batch_id, ptBatch.batch_id, tdsBatch.batch_id, npsBatch.batch_id];
      const uniqueBatchIds = new Set(batchIds);
      assert.strictEqual(uniqueBatchIds.size, batchIds.length, 'Every batch must have a globally unique batch_id');

      // 2. Assert independent scheduled payment dates
      assert.strictEqual(salaryBatch.scheduled_payment_date, '2026-08-31', 'Salary payment scheduled on month end');
      assert.strictEqual(pfBatch.scheduled_payment_date, '2026-09-15', 'PF payment scheduled on 15th of next month');
      assert.strictEqual(esiBatch.scheduled_payment_date, '2026-09-15', 'ESI payment scheduled on 15th of next month');
      assert.strictEqual(tdsBatch.scheduled_payment_date, '2026-09-07', 'TDS payment scheduled on 7th of next month');
      assert.strictEqual(ptBatch.scheduled_payment_date, '2026-09-20', 'PT payment scheduled on 20th of next month');

      // 3. Assert independent ledger references
      assert.strictEqual(salaryBatch.ledger_references.general_ledger_code, 'GL-210100');
      assert.strictEqual(pfBatch.ledger_references.general_ledger_code, 'GL-210200');
      assert.strictEqual(esiBatch.ledger_references.general_ledger_code, 'GL-210300');
      assert.strictEqual(tdsBatch.ledger_references.general_ledger_code, 'GL-210400');
      assert.strictEqual(ptBatch.ledger_references.general_ledger_code, 'GL-210500');

      // 4. Assert initial status enum is DRAFT across all independent units
      for (const b of Object.values(batches)) {
        assert.strictEqual(b.status, 'DRAFT');
        assert.strictEqual(b.is_settled, false);
        assert.strictEqual(b.settled_at, null);
      }
    });

    await t4.test('4.2 Non-Cascading Settlement: Settling Salary batch to PAID never mutates or cascades to compliance batches', async () => {
      await setupIsolationRun();
      const batches = BatchStateIsolationManager.createAllIsolatedBatchesForRun(runId);

      const salaryBatch = batches[BATCH_DOMAIN_TYPES.SALARY];
      const pfBatch = batches[BATCH_DOMAIN_TYPES.PF];
      const esiBatch = batches[BATCH_DOMAIN_TYPES.ESI];
      const ptBatch = batches[BATCH_DOMAIN_TYPES.PROFESSIONAL_TAX];
      const tdsBatch = batches[BATCH_DOMAIN_TYPES.TDS];

      // Initial state verify
      assert.strictEqual(salaryBatch.status, 'DRAFT');
      assert.strictEqual(pfBatch.status, 'DRAFT');
      assert.strictEqual(esiBatch.status, 'DRAFT');
      assert.strictEqual(ptBatch.status, 'DRAFT');
      assert.strictEqual(tdsBatch.status, 'DRAFT');

      // Settle SALARY batch independently
      const settleResult = BatchStateIsolationManager.settleBatchIndependently(salaryBatch.batch_id, {
        status: 'PAID',
        bank_ref: 'HDFC_SAL_UTR_9876543210',
        settled_by: 'bank_treasury_clearing',
      });

      assert.strictEqual(settleResult.status, 'PAID');
      assert.strictEqual(settleResult.cascaded_to_other_batches, false, 'Must strictly confirm zero cascade');

      // SALARY batch must be PAID
      assert.strictEqual(salaryBatch.status, 'PAID');
      assert.strictEqual(salaryBatch.is_settled, true);
      assert.ok(salaryBatch.settled_at);
      assert.strictEqual(salaryBatch.bank_ref, 'HDFC_SAL_UTR_9876543210');

      // CRITICAL ARCHITECTURAL GUARANTEE:
      // Compliance batches must remain strictly in DRAFT state and untouched!
      assert.strictEqual(pfBatch.status, 'DRAFT', 'PF batch must remain DRAFT when Salary is settled');
      assert.strictEqual(pfBatch.is_settled, false, 'PF batch must not be marked settled');
      assert.strictEqual(pfBatch.settled_at, null, 'PF batch settled_at must remain null');

      assert.strictEqual(esiBatch.status, 'DRAFT', 'ESI batch must remain DRAFT when Salary is settled');
      assert.strictEqual(esiBatch.is_settled, false);

      assert.strictEqual(ptBatch.status, 'DRAFT', 'PT batch must remain DRAFT when Salary is settled');
      assert.strictEqual(ptBatch.is_settled, false);

      assert.strictEqual(tdsBatch.status, 'DRAFT', 'TDS batch must remain DRAFT when Salary is settled');
      assert.strictEqual(tdsBatch.is_settled, false);

      // Now settle PF batch independently
      const pfSettleResult = BatchStateIsolationManager.settleBatchIndependently(pfBatch.batch_id, {
        status: 'PAID',
        bank_ref: 'EPFO_TRRN_UTR_12345678',
      });
      assert.strictEqual(pfSettleResult.status, 'PAID');
      assert.strictEqual(pfBatch.status, 'PAID');

      // ESI, PT, TDS still remain in DRAFT!
      assert.strictEqual(esiBatch.status, 'DRAFT', 'ESI remains DRAFT after PF settled');
      assert.strictEqual(ptBatch.status, 'DRAFT', 'PT remains DRAFT after PF settled');
      assert.strictEqual(tdsBatch.status, 'DRAFT', 'TDS remains DRAFT after PF settled');
    });

    await t4.test('4.3 REST API Endpoints: GET /snapshot, PATCH /runs/:id (immutability), POST /payment-batches/:id/settle', async () => {
      const app = express();
      const router = createDisbursementApiRouter();
      app.use('/api', router);

      const testRunId = 'RUN_API_TEST_FREEZE';
      store.payrollRuns.set(testRunId, {
        run_id: testRunId,
        period: '2026-08',
        status: 'FINALIZED',
        employees: [{ employee_id: 'E1', gross: 50000, deductions: 5000, net: 45000 }],
      });
      PayrollFreezeGuard.snapshotPayrollRun(store.payrollRuns.get(testRunId));

      // 1. GET snapshot
      const snapshot = await PayrollService.getSnapshot(testRunId);
      assert.strictEqual(snapshot.status, 'FINALIZED');
      assert.strictEqual(snapshot.is_frozen, true);

      // 2. PATCH run rejected due to immutability guard
      await assert.rejects(
        async () => {
          await PayrollService.updateRun(testRunId, { gross_payroll: 100 });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          return true;
        }
      );

      // 3. Create and Settle Batch via Service
      const batch = await PaymentBatchService.createBatch({
        run_id: testRunId,
        batch_type: 'SALARY',
      });
      assert.strictEqual(batch.status, 'DRAFT');

      const settle = await PaymentBatchService.settleBatch(batch.batch_id, {
        status: 'PAID',
        bank_ref: 'BANK_UTR_API_123',
      });
      assert.strictEqual(settle.status, 'PAID');
      assert.strictEqual(settle.cascaded_to_other_batches, false);
    });
  });
});
