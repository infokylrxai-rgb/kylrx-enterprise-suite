/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CHALLAN RECONCILIATION & ALERTS TEST SUITE
 * ============================================================================
 * Validates:
 * 1. Multi-Level Reconciliation Engine (1:1 Verified Clearing):
 *    - Ingestion of final bank/EPFO clearing statement
 *    - Exact total match (Δ = 0)
 *    - Exact statutory account breakdown match (Accounts 1, 2, 10, 21, 22)
 *    - Individual employee lines match against internal submission batch
 *    - Terminal Closure: Transition to SETTLED/COMPLETED and employee ledger update
 * 2. Discrepancy Interceptor:
 *    - Total amount mismatch (Δ ≠ 0) blocks SETTLED transition
 *    - Line-level discrepancy exceptions flagged
 *    - Missing employee lines and unmapped payment references detected
 * 3. Operational Alert Dispatchers:
 *    - REJECTED_UPLOAD alert on portal rejection
 *    - OVERDUE_CHALLAN_PAYMENT alert when approaching/exceeding 15th cutoff
 *    - SETTLEMENT_VARIANCE alert on financial drift
 * 4. REST API Endpoints Integration
 *
 * @version 6.3.0
 * @author Kylrx AI Lead Compliance Architect
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  PfReconciliationAlertService,
  globalPfReconciliationAlertService,
  clearReconciliationAlertStores,
  getOperationalAlerts,
  getEmployeeLedgersByBatch,
  ALERT_PRIORITIES,
  ALERT_TYPES,
} from '../services/pf-reconciliation-alert-service.mjs';

import {
  globalPfChallanReconciliationEngine,
  clearPfChallanAndStepperStores,
} from '../services/pf-challan-reconciliation-service.mjs';

import pfComplianceRouter from '../routes/pf-compliance.mjs';

describe('🔍 Challan Reconciliation Service & Operational Alert Dispatchers', () => {
  let app;
  let server;
  let baseUrl;
  let service;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/pf', pfComplianceRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/pf`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    clearReconciliationAlertStores();
    clearPfChallanAndStepperStores();
    service = new PfReconciliationAlertService();

    // Seed baseline internal challan
    globalPfChallanReconciliationEngine.ingestTrrn('BATCH_RECON_001', {
      trrn: '1012609012345',
      period: '2026-09',
      epf_wages: 100000,
      eps_wages: 100000,
      ee_contribution: 12000,
      er_epf_contribution: 3670,
      admin_charges: 500,
      eps_contribution: 8330,
      edli_contribution: 500,
      edli_admin_charges: 0,
    });
    // Expected total: 12000 + 3670 + 500 + 8330 + 500 + 0 = 25000
  });

  // ==========================================================================
  // 1. RECONCILIATION ENGINE: 1:1 VERIFIED CLEARING & TERMINAL CLOSURE
  // ==========================================================================
  describe('1. 1:1 Verified Clearing & Terminal Closure', () => {
    it('1.1 Should settle batch and update employee ledgers on exact 1:1 match', () => {
      const internalLines = [
        { employee_id: 'EMP001', uan: '100111111111', total_contribution: 12500 },
        { employee_id: 'EMP002', uan: '100222222222', total_contribution: 12500 },
      ];

      const clearingStatement = {
        batch_id: 'BATCH_RECON_001',
        trrn: '1012609012345',
        bank_reference_utr: 'HDFCR520260915001234',
        cleared_total_amount: 25000,
        account_breakdown: {
          account_1: 15670, // 12000 + 3670
          account_2: 500,
          account_10: 8330,
          account_21: 500,
          account_22: 0,
        },
        employee_lines: [
          { employee_id: 'EMP001', uan: '100111111111', cleared_amount: 12500 },
          { employee_id: 'EMP002', uan: '100222222222', cleared_amount: 12500 },
        ],
        internal_employee_lines: internalLines,
      };

      const res = service.reconcileClearingStatement(clearingStatement);

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.is_settled, true);
      assert.strictEqual(res.status, 'SETTLED');
      assert.strictEqual(res.challan.status, 'SETTLED');
      assert.strictEqual(res.challan.payment_reconciliation.bank_utr, 'HDFCR520260915001234');
      assert.strictEqual(res.stepper.current_stage, 'PAYMENT_COMPLETED');

      // Verify employee ledgers updated to CLEARED
      const ledgers = getEmployeeLedgersByBatch('BATCH_RECON_001');
      assert.strictEqual(ledgers.length, 2);
      assert.strictEqual(ledgers[0].status, 'CLEARED');
      assert.strictEqual(ledgers[0].bank_utr, 'HDFCR520260915001234');
      assert.strictEqual(ledgers[1].status, 'CLEARED');
    });
  });

  // ==========================================================================
  // 2. DISCREPANCY INTERCEPTOR: AMOUNT MISMATCH & VARIANCES
  // ==========================================================================
  describe('2. Discrepancy Interceptor & Anomaly Prevention', () => {
    it('2.1 Should prevent transition to SETTLED if total cleared amount differs (Δ ≠ 0)', () => {
      const clearingStatement = {
        batch_id: 'BATCH_RECON_001',
        trrn: '1012609012345',
        bank_reference_utr: 'SBIN0001234567890123',
        cleared_total_amount: 24500, // Short by ₹500 (Δ = -500)
        account_breakdown: {
          account_1: 15670,
          account_2: 0, // Admin charge missing
          account_10: 8330,
          account_21: 500,
          account_22: 0,
        },
      };

      const res = service.reconcileClearingStatement(clearingStatement);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.is_settled, false);
      assert.strictEqual(res.status, 'RECONCILIATION_FAILED');
      assert.ok(res.discrepancy_report);
      assert.strictEqual(res.discrepancy_report.status, 'DISCREPANCIES_FLAGGED');

      // Verify alert was dispatched
      assert.ok(res.alerts.length >= 1);
      const varianceAlert = res.alerts.find((a) => a.alert_type === ALERT_TYPES.SETTLEMENT_VARIANCE);
      assert.ok(varianceAlert);
      assert.strictEqual(varianceAlert.priority, ALERT_PRIORITIES.HIGH);
      assert.strictEqual(varianceAlert.details.amount_delta, -500);

      // Verify challan was NOT marked SETTLED
      const challan = globalPfChallanReconciliationEngine.getChallan('BATCH_RECON_001');
      assert.notEqual(challan.status, 'SETTLED');
    });

    it('2.2 Should flag line-level discrepancy exception when an employee is missing in clearing', () => {
      const internalLines = [
        { employee_id: 'EMP001', uan: '100111111111', total_contribution: 12500 },
        { employee_id: 'EMP002', uan: '100222222222', total_contribution: 12500 },
      ];

      const clearingStatement = {
        batch_id: 'BATCH_RECON_001',
        trrn: '1012609012345',
        bank_reference_utr: 'SBIN0001234567890123',
        cleared_total_amount: 12500, // Missing second employee
        account_breakdown: { account_1: 15670 },
        employee_lines: [
          { employee_id: 'EMP001', uan: '100111111111', cleared_amount: 12500 },
          // EMP002 missing
        ],
        internal_employee_lines: internalLines,
      };

      const res = service.reconcileClearingStatement(clearingStatement);

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.is_settled, false);
      const missingEmpExc = res.discrepancy_report.line_exceptions.find(
        (e) => e.employee_id === 'EMP002' && e.type === 'MISSING_EMPLOYEE_IN_CLEARING'
      );
      assert.ok(missingEmpExc);
      assert.strictEqual(missingEmpExc.delta, -12500);
    });

    it('2.3 Should block settlement on unmapped TRRN or invalid Bank UTR', () => {
      const res = service.reconcileClearingStatement({
        batch_id: 'BATCH_RECON_001',
        trrn: 'WRONG_TRRN_9999999',
        bank_reference_utr: 'SHORT', // Invalid UTR (<12 chars)
        cleared_total_amount: 25000,
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.is_settled, false);
      const unmappedRef = res.discrepancy_report.header_discrepancies.find((d) => d.type === 'UNMAPPED_PAYMENT_REF');
      assert.ok(unmappedRef);
    });
  });

  // ==========================================================================
  // 3. OPERATIONAL ALERT DISPATCHERS
  // ==========================================================================
  describe('3. Operational Alert Dispatchers', () => {
    it('3.1 Should dispatch CRITICAL alert on rejected EPFO portal upload', () => {
      const alert = service.handleRejectedUpload({
        batch_id: 'BATCH_REJECTED_001',
        rejection_reason: 'Invalid ECR Member ID format in row 14: Member not found in EPFO database.',
      });

      assert.strictEqual(alert.alert_type, ALERT_TYPES.REJECTED_UPLOAD);
      assert.strictEqual(alert.priority, ALERT_PRIORITIES.CRITICAL);
      assert.strictEqual(alert.status, 'OPEN');
      assert.ok(alert.hr_task);
      assert.strictEqual(alert.hr_task.assignee_role, 'HR_OPERATIONS');

      // Verify queryable via getOperationalAlerts
      const criticalAlerts = getOperationalAlerts({ priority: ALERT_PRIORITIES.CRITICAL });
      assert.ok(criticalAlerts.some((a) => a.alert_id === alert.alert_id));
    });

    it('3.2 Should dispatch HIGH priority alert for unpaid challan approaching 15th cutoff', () => {
      // Seed challan due on 2026-10-15
      globalPfChallanReconciliationEngine.ingestTrrn('BATCH_OCT_15', {
        trrn: '1012609088888',
        period: '2026-09',
        due_date: '2026-10-15',
        epf_wages: 50000,
      });

      // Simulate date: 2026-10-13 (2 days remaining)
      const scanRes = service.checkOverdueChallans('2026-10-13', { threshold_days: 3 });
      assert.strictEqual(scanRes.success, true);
      assert.ok(scanRes.alerts_count >= 1);

      const alert = scanRes.alerts.find((a) => a.batch_id === 'BATCH_OCT_15');
      assert.ok(alert);
      assert.strictEqual(alert.alert_type, ALERT_TYPES.OVERDUE_CHALLAN_PAYMENT);
      assert.strictEqual(alert.priority, ALERT_PRIORITIES.HIGH);
      assert.strictEqual(alert.details.days_remaining, 2);
      assert.strictEqual(alert.details.is_past_due, false);
    });

    it('3.3 Should dispatch CRITICAL priority alert for past-due unpaid challan', () => {
      globalPfChallanReconciliationEngine.ingestTrrn('BATCH_OVERDUE_PAST', {
        trrn: '1012609077777',
        period: '2026-09',
        due_date: '2026-10-15',
        epf_wages: 50000,
      });

      // Simulate date: 2026-10-18 (3 days past due)
      const scanRes = service.checkOverdueChallans('2026-10-18', { threshold_days: 3 });
      const alert = scanRes.alerts.find((a) => a.batch_id === 'BATCH_OVERDUE_PAST');
      assert.ok(alert);
      assert.strictEqual(alert.priority, ALERT_PRIORITIES.CRITICAL);
      assert.strictEqual(alert.details.is_past_due, true);
      assert.ok(alert.message.includes('Sec 7Q'));
    });
  });

  // ==========================================================================
  // 4. REST API ENDPOINTS INTEGRATION
  // ==========================================================================
  describe('4. REST API Endpoints Integration', () => {
    it('4.1 POST /api/v1/pf/reconcile-clearing should return 200 on exact match and 422 on discrepancy', async () => {
      // 1. Discrepancy Case (returns 422)
      const failRes = await fetch(`${baseUrl}/reconcile-clearing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: 'BATCH_RECON_001',
          trrn: '1012609012345',
          bank_reference_utr: 'HDFCR520260915001234',
          cleared_total_amount: 20000, // Short (Expected: 25000)
        }),
      });
      assert.strictEqual(failRes.status, 422);
      const failJson = await failRes.json();
      assert.strictEqual(failJson.success, false);
      assert.strictEqual(failJson.is_settled, false);

      // 2. Exact Match Case (returns 200)
      const passRes = await fetch(`${baseUrl}/reconcile-clearing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: 'BATCH_RECON_001',
          trrn: '1012609012345',
          bank_reference_utr: 'HDFCR520260915001234',
          cleared_total_amount: 25000,
          account_breakdown: {
            account_1: 15670,
            account_2: 500,
            account_10: 8330,
            account_21: 500,
            account_22: 0,
          },
          employee_lines: [
            { employee_id: 'EMP_API_1', uan: '100111111111', cleared_amount: 25000 },
          ],
          internal_employee_lines: [
            { employee_id: 'EMP_API_1', uan: '100111111111', total_contribution: 25000 },
          ],
        }),
      });
      assert.strictEqual(passRes.status, 200);
      const passJson = await passRes.json();
      assert.strictEqual(passJson.success, true);
      assert.strictEqual(passJson.is_settled, true);
    });

    it('4.2 GET /api/v1/pf/alerts should query operational alerts with filters', async () => {
      // Seed alert
      service.dispatchAlert({
        alert_type: ALERT_TYPES.SETTLEMENT_VARIANCE,
        priority: ALERT_PRIORITIES.HIGH,
        batch_id: 'BATCH_ALERT_QUERY',
        title: 'Query Test Alert',
      });

      const res = await fetch(`${baseUrl}/alerts?priority=HIGH`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.data.total_count >= 1);
      assert.ok(json.data.alerts.some((a) => a.batch_id === 'BATCH_ALERT_QUERY'));
    });

    it('4.3 POST /api/v1/pf/check-overdue should execute overdue scan', async () => {
      const res = await fetch(`${baseUrl}/check-overdue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_date: '2026-10-14' }),
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.data.scanned_count >= 1);
    });

    it('4.4 GET /api/v1/pf/ledgers/:batch_id should return updated employee ledgers', async () => {
      const res = await fetch(`${baseUrl}/ledgers/BATCH_RECON_001`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data.ledgers));
    });
  });
});
