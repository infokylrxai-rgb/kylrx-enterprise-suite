/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - SECTION 6: PF CHALLAN RECONCILIATION TEST SUITE
 * ============================================================================
 * Validates Section 6 of the Visual Compliance Blueprint:
 * 1. Process Flow Stepper (7 Canonical States & Sequential Rules)
 * 2. TRRN Ingestion & 15th Statutory Due Date Calculation
 * 3. Payment Confirmation Reconciliation (TRRN, Cleared Amount, Bank UTR)
 * 4. Immutable Audit Trail Logging to compliance_audit_logs
 * 5. REST API Endpoints Integration
 *
 * @version 6.0.0
 * @author Kylrx AI Lead Compliance Architect
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  PfProcessFlowStepper,
  PfChallanReconciliationEngine,
  globalPfChallanReconciliationEngine,
  calculateStatutoryDueDate,
  clearPfChallanAndStepperStores,
  PF_PROCESS_STAGES,
  PF_STAGE_LABELS,
  PF_STEPPER_RULE_VERSION,
} from '../services/pf-challan-reconciliation-service.mjs';

import { globalComplianceAuditStream } from '../services/compliance-audit-logger.mjs';
import pfComplianceRouter from '../routes/pf-compliance.mjs';

describe('🏛️ Section 6: State Machine and Challan Reconciliation Service (EPFO Engine)', () => {
  let app;
  let server;
  let baseUrl;
  let engine;

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
    clearPfChallanAndStepperStores();
    engine = new PfChallanReconciliationEngine();
  });

  // ==========================================================================
  // 1. PROCESS FLOW STEPPER (STATE MACHINE)
  // ==========================================================================
  describe('1. Process Flow Stepper (7 Canonical States & Transitions)', () => {
    it('1.1 Should initialize at Stage 1: PAYROLL_FINALIZED', () => {
      const stepper = new PfProcessFlowStepper('BATCH_TEST_01', { period: '2026-09' });
      const json = stepper.toJSON();

      assert.equal(json.current_stage, 'PAYROLL_FINALIZED');
      assert.equal(json.stage_index, 1);
      assert.equal(json.total_stages, 7);
      assert.equal(json.is_completed, false);
      assert.equal(json.stages.length, 7);
      assert.equal(json.stages[0].status, 'CURRENT');
      assert.equal(json.stages[1].status, 'PENDING');
    });

    it('1.2 Should advance sequentially across stages: Payroll Finalized -> PF Calculated -> ECR Validated -> ECR TXT Generated', () => {
      const stepper = new PfProcessFlowStepper('BATCH_TEST_02');

      stepper.advance('PF_CALCULATED', { actor: 'PAYROLL_BUILDER' });
      assert.equal(stepper.current_stage, 'PF_CALCULATED');

      stepper.advance('ECR_VALIDATED', { actor: 'VALIDATION_ENGINE', blocking_exceptions_count: 0 });
      assert.equal(stepper.current_stage, 'ECR_VALIDATED');

      stepper.advance('ECR_TXT_GENERATED', { actor: 'ECR_GENERATOR' });
      assert.equal(stepper.current_stage, 'ECR_TXT_GENERATED');
      assert.equal(stepper.getCurrentStageIndex(), 3);
    });

    it('1.3 Should reject non-sequential stage skips', () => {
      const stepper = new PfProcessFlowStepper('BATCH_TEST_03');
      // Attempt to jump from PAYROLL_FINALIZED directly to CHALLAN_GENERATED
      assert.throws(() => {
        stepper.advance('CHALLAN_GENERATED', { has_trrn: true });
      }, (err) => {
        assert.equal(err.code, 'STEPPER_TRANSITION_BLOCKED');
        assert.match(err.message, /Cannot jump from PAYROLL_FINALIZED to CHALLAN_GENERATED/);
        return true;
      });
    });

    it('1.4 Should block advance to ECR_VALIDATED when unresolved blocking exceptions exist', () => {
      const stepper = new PfProcessFlowStepper('BATCH_TEST_04', { blocking_exceptions_count: 2 });
      stepper.advance('PF_CALCULATED');

      assert.throws(() => {
        stepper.advance('ECR_VALIDATED');
      }, (err) => {
        assert.equal(err.code, 'STEPPER_TRANSITION_BLOCKED');
        assert.match(err.message, /Gatekeeper Blocked: 2 unresolved blocking exceptions/);
        return true;
      });
    });
  });

  // ==========================================================================
  // 2. TRRN INGESTION & STATUTORY DUE DATE
  // ==========================================================================
  describe('2. TRRN Ingestion & Due Date Calculation', () => {
    it('2.1 Should correctly compute statutory due date as 15th of subsequent calendar month', () => {
      assert.equal(calculateStatutoryDueDate('2026-09'), '2026-10-15');
      assert.equal(calculateStatutoryDueDate('2026-12'), '2027-01-15');
      assert.equal(calculateStatutoryDueDate('2026-01'), '2026-02-15');
    });

    it('2.2 Should validate TRRN syntax and reject invalid formats', () => {
      assert.throws(() => {
        engine.ingestTrrn('BATCH_TRRN_ERR', { trrn: '' });
      }, /Invalid TRRN format/);

      assert.throws(() => {
        engine.ingestTrrn('BATCH_TRRN_ERR', { trrn: 'ABC' }); // Too short
      }, /Invalid TRRN format/);
    });

    it('2.3 Should ingest valid TRRN, calculate statutory breakdown, and advance stepper to CHALLAN_GENERATED', () => {
      const result = engine.ingestTrrn('BATCH_PF_SEP2026', {
        trrn: '10012345678901',
        period: '2026-09',
        establishment_id: 'MH_BAN_0012345',
        challan_generation_date: '2026-10-05',
        epf_wages: 42000,
        eps_wages: 27000,
        ee_contribution: 5040,
        er_epf_contribution: 2790,
        eps_contribution: 2250,
        admin_charges: 500,
        edli_contribution: 210,
        actor: 'COMPLIANCE_OFFICER_01',
      });

      assert.equal(result.success, true);
      const challan = result.data;
      assert.equal(challan.trrn, '10012345678901');
      assert.equal(challan.due_date, '2026-10-15');
      assert.equal(challan.status, 'CHALLAN_GENERATED');

      // Summary Account Figures
      const acc = challan.account_summary;
      assert.equal(acc.account_1_epf.total_account_1, 5040 + 2790); // 7830
      assert.equal(acc.account_2_admin.admin_charges, 500);
      assert.equal(acc.account_10_eps.eps_contribution, 2250);
      assert.equal(acc.account_21_edli.edli_contribution, 210);
      assert.equal(acc.total_challan_amount, 7830 + 500 + 2250 + 210); // 10790

      // Stepper verification
      assert.equal(result.stepper.current_stage, 'CHALLAN_GENERATED');
      assert.equal(result.stepper.stage_index, 6);
    });
  });

  // ==========================================================================
  // 3. PAYMENT RECONCILIATION & ACCOUNTING ENGINE
  // ==========================================================================
  describe('3. Payment Reconciliation & Accounting Engine', () => {
    beforeEach(() => {
      // Ingest a baseline challan
      engine.ingestTrrn('BATCH_RECON_01', {
        trrn: 'TRRN2026090001',
        period: '2026-09',
        epf_wages: 30000,
        eps_wages: 30000,
        ee_contribution: 3600,
        er_epf_contribution: 1100,
        eps_contribution: 2500,
        admin_charges: 500,
        edli_contribution: 150,
      });
    });

    it('3.1 Should reject payment reconciliation if TRRN does not match', () => {
      assert.throws(() => {
        engine.reconcilePayment('BATCH_RECON_01', {
          trrn: 'WRONG_TRRN',
          bank_utr: 'HDFCN00123456789',
          cleared_amount: 7850,
        });
      }, (err) => {
        assert.equal(err.code, 'TRRN_MISMATCH');
        return true;
      });
    });

    it('3.2 Should reject invalid Bank Reference UTR format', () => {
      assert.throws(() => {
        engine.reconcilePayment('BATCH_RECON_01', {
          trrn: 'TRRN2026090001',
          bank_utr: 'SHORT', // Invalid length
          cleared_amount: 7850,
        });
      }, (err) => {
        assert.equal(err.code, 'INVALID_BANK_UTR');
        return true;
      });
    });

    it('3.3 Should reject cleared amount mismatch', () => {
      // Expected total: (3600+1100) + 500 + 2500 + 150 = 7850
      assert.throws(() => {
        engine.reconcilePayment('BATCH_RECON_01', {
          trrn: 'TRRN2026090001',
          bank_utr: 'HDFCN00123456789',
          cleared_amount: 7000, // Short payment
        });
      }, (err) => {
        assert.equal(err.code, 'AMOUNT_MISMATCH');
        assert.match(err.message, /Difference: ₹850/);
        return true;
      });
    });

    it('3.4 Should reconcile valid receipt, advance to PAYMENT_COMPLETED, and stamp payment metadata', () => {
      const res = engine.reconcilePayment('BATCH_RECON_01', {
        trrn: 'TRRN2026090001',
        bank_utr: 'HDFCN00123456789',
        cleared_amount: 7850,
        payment_mode: 'NEFT',
        bank_name: 'HDFC Bank Corporate Banking',
        actor: 'TREASURY_OFFICER_PATEL',
      });

      assert.equal(res.success, true);
      assert.equal(res.challan.status, 'PAYMENT_COMPLETED');
      assert.equal(res.challan.payment_reconciliation.is_reconciled, true);
      assert.equal(res.challan.payment_reconciliation.bank_utr, 'HDFCN00123456789');
      assert.equal(res.challan.payment_reconciliation.cleared_amount, 7850);
      assert.equal(res.challan.payment_reconciliation.payment_status, 'PAID');

      // Stepper Stage 7
      assert.equal(res.stepper.current_stage, 'PAYMENT_COMPLETED');
      assert.equal(res.stepper.stage_index, 7);
      assert.equal(res.stepper.is_completed, true);
    });
  });

  // ==========================================================================
  // 4. IMMUTABLE AUDIT TRAIL LOGGING
  // ==========================================================================
  describe('4. Immutable Audit Trail Logging', () => {
    it('4.1 Should record an immutable audit event in compliance_audit_logs on payment completion', () => {
      engine.ingestTrrn('BATCH_AUDIT_01', {
        trrn: 'TRRN9999999999',
        period: '2026-09',
        epf_wages: 10000,
        ee_contribution: 1200,
        er_epf_contribution: 367,
        eps_contribution: 833,
        admin_charges: 500,
        edli_contribution: 50,
      });

      const initialLogCount = globalComplianceAuditStream.size;

      const res = engine.reconcilePayment('BATCH_AUDIT_01', {
        trrn: 'TRRN9999999999',
        bank_utr: 'AXISN009988776655',
        cleared_amount: 2950, // 1200 + 367 + 833 + 500 + 50 = 2950
        actor: 'CHIEF_AUDITOR_SINGH',
      });

      assert.ok(res.audit_event, 'Audit event must be generated');
      assert.equal(res.audit_event.entity_type, 'ComplianceReturn');
      assert.equal(res.audit_event.entity_id, 'BATCH_AUDIT_01');
      assert.equal(res.audit_event.from_state, 'CHALLAN_GENERATED');
      assert.equal(res.audit_event.to_state, 'PAYMENT_COMPLETED');
      assert.equal(res.audit_event.actor_id, 'CHIEF_AUDITOR_SINGH');
      assert.equal(res.audit_event.rule_version_applied, PF_STEPPER_RULE_VERSION);
      assert.ok(Object.isFrozen(res.audit_event), 'Audit event must be tamper-proof and frozen');

      // Verify stream size increased
      assert.equal(globalComplianceAuditStream.size, initialLogCount + 1);
    });
  });

  // ==========================================================================
  // 5. REST API INTEGRATION
  // ==========================================================================
  describe('5. REST API Integration Endpoints', () => {
    const testBatchId = 'BATCH_REST_PF_01';

    it('5.1 GET /stepper/:batch_id should return initial stepper state', async () => {
      const res = await fetch(`${baseUrl}/stepper/${testBatchId}`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.current_stage, 'PAYROLL_FINALIZED');
      assert.equal(json.data.total_stages, 7);
    });

    it('5.2 POST /stepper/:batch_id/advance should advance stage', async () => {
      const res = await fetch(`${baseUrl}/stepper/${testBatchId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_stage: 'PF_CALCULATED',
          actor: 'API_TEST_USER',
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.current_stage, 'PF_CALCULATED');
    });

    it('5.3 POST /challan/trrn should ingest TRRN and return challan breakdown', async () => {
      const res = await fetch(`${baseUrl}/challan/trrn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: testBatchId,
          trrn: 'TRRNREST0001234',
          period: '2026-09',
          epf_wages: 50000,
          eps_wages: 30000,
          ee_contribution: 6000,
          er_epf_contribution: 1835,
          eps_contribution: 2500,
          admin_charges: 500,
          edli_contribution: 250,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.trrn, 'TRRNREST0001234');
      assert.equal(json.data.status, 'CHALLAN_GENERATED');
      assert.equal(json.stepper.current_stage, 'CHALLAN_GENERATED');
    });

    it('5.4 POST /challan/reconcile-payment should reconcile UTR and mark PAYMENT_COMPLETED', async () => {
      // Ensure challan is present in case of isolated test execution
      await fetch(`${baseUrl}/challan/trrn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: testBatchId,
          trrn: 'TRRNREST0001234',
          period: '2026-09',
          epf_wages: 50000,
          eps_wages: 30000,
          ee_contribution: 6000,
          er_epf_contribution: 1835,
          eps_contribution: 2500,
          admin_charges: 500,
          edli_contribution: 250,
        }),
      });

      // Total amount: (6000 + 1835) + 500 + 2500 + 250 = 11085
      const res = await fetch(`${baseUrl}/challan/reconcile-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: testBatchId,
          trrn: 'TRRNREST0001234',
          bank_utr: 'SBIN001122334455',
          cleared_amount: 11085,
          actor: 'FINANCE_TREASURY_CHIEF',
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.status, 'PAYMENT_COMPLETED');
      assert.equal(json.data.payment_reconciliation.bank_utr, 'SBIN001122334455');
      assert.equal(json.stepper.current_stage, 'PAYMENT_COMPLETED');
      assert.ok(json.audit_event);
    });

    it('5.5 GET /challan/:batch_id should retrieve finalized challan and reconciliation status', async () => {
      // Ensure challan is present
      await fetch(`${baseUrl}/challan/trrn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: testBatchId,
          trrn: 'TRRNREST0001234',
          period: '2026-09',
          epf_wages: 50000,
          eps_wages: 30000,
          ee_contribution: 6000,
          er_epf_contribution: 1835,
          eps_contribution: 2500,
          admin_charges: 500,
          edli_contribution: 250,
        }),
      });
      await fetch(`${baseUrl}/challan/reconcile-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: testBatchId,
          trrn: 'TRRNREST0001234',
          bank_utr: 'SBIN001122334455',
          cleared_amount: 11085,
        }),
      });

      const res = await fetch(`${baseUrl}/challan/${testBatchId}`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.trrn, 'TRRNREST0001234');
      assert.equal(json.data.payment_reconciliation.is_reconciled, true);
    });
  });
});
