/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CORPORATE NPS AUTOMATION ENGINE TEST SUITE
 * (COLUMN 3 BLUEPRINT)
 * ============================================================================
 * Validates Column 3 of the visual compliance blueprint across all pillars:
 *
 * 1. Profile Master (EmployeeNPSProfile, 12-digit PRAN, Tier I/II, Contribution type)
 * 2. Automation Builder (Trigger on monthly Payroll Finalized where nps_applicable === true)
 * 3. Contribution Engine (10% EE, 10% ER under Sec 80CCD(2), Sec 80CCD(1B) additional benefit)
 * 4. Validation & Exception Handling (12-digit PRAN format enforcement, HR tasks, alerts, export blocking)
 * 5. NSDL Output Compilation (NPS_Contribution_MONTH_YEAR.txt layout: PRAN, Name, EE Amt, ER Amt, Total)
 * 6. 7-Stage Visual Lifecycle Stepper (Payroll Finalized -> ... -> Completed, PRN acknowledgement)
 * 7. End-to-End REST API Endpoints Integration
 *
 * @version 1.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import express from 'express';

import {
  CorporateNpsAutomationEngine,
  EmployeeNpsProfileStore,
  NPS_STEPPER_STAGES,
  globalCorporateNpsAutomationEngine,
} from './corporate-nps-automation-engine.mjs';

import { createPayrollDisbursementApiRouter } from './payroll-disbursement-api.mjs';

describe('🏛️ CORPORATE NPS AUTOMATION SERVICE (COLUMN 3 BLUEPRINT)', () => {
  let engine;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = new EventEmitter();
    engine = new CorporateNpsAutomationEngine({ eventBus: mockEventBus });
  });

  // ==========================================================================
  // PILLAR 1: PROFILE MASTER
  // ==========================================================================
  describe('1. Profile Master (EmployeeNPSProfile Modeling & Configuration)', () => {
    it('1.1 Should model and persist EmployeeNPSProfile with all statutory attributes', () => {
      const profile = engine.profileStore.upsertProfile({
        employee_id: 'NPS_EMP_01',
        employee_name: 'Ananya Sharma',
        pran: '110012345678',
        nps_applicable: true,
        tier: 'Tier I',
        date_of_joining: '2020-03-01',
        contribution_type: 'Both',
        exit_date: null,
      });

      assert.strictEqual(profile.employee_id, 'NPS_EMP_01');
      assert.strictEqual(profile.employee_name, 'Ananya Sharma');
      assert.strictEqual(profile.pran, '110012345678');
      assert.strictEqual(profile.nps_applicable, true);
      assert.strictEqual(profile.tier, 'Tier I');
      assert.strictEqual(profile.contribution_type, 'Both');
      assert.strictEqual(profile.exit_date, null);

      const retrieved = engine.profileStore.getProfile('NPS_EMP_01');
      assert.deepStrictEqual(retrieved, profile);
    });

    it('1.2 Should normalize tier selection (Tier I vs Tier II) and contribution types (Employee, Employer, Both)', () => {
      const p1 = engine.profileStore.upsertProfile({
        employee_id: 'NPS_EMP_TIER2',
        pran: '110088889999',
        tier: 'Tier II',
        contribution_type: 'Employee',
      });
      assert.strictEqual(p1.tier, 'Tier II');
      assert.strictEqual(p1.contribution_type, 'Employee');

      const p2 = engine.profileStore.upsertProfile({
        employee_id: 'NPS_EMP_EMPLOYER',
        pran: '110077776666',
        tier: 'TIER_1',
        contribution_type: 'employer_only',
      });
      assert.strictEqual(p2.tier, 'Tier I');
      assert.strictEqual(p2.contribution_type, 'Employer');
    });

    it('1.3 Should reject upsert without employee_id', () => {
      assert.throws(() => {
        engine.profileStore.upsertProfile({ pran: '110012345678' });
      }, /employee_id is mandatory/i);
    });
  });

  // ==========================================================================
  // PILLAR 2 & 3: AUTOMATION BUILDER & CONTRIBUTION ENGINE
  // ==========================================================================
  describe('2. Automation Builder & Statutory Contribution Engine', () => {
    it('2.1 Should trigger automatically on monthly Payroll Finalized event for nps_applicable === true', async () => {
      // Seed profiles
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_NPS_AUTO',
        employee_name: 'Rajesh Kumar',
        pran: '110099887766',
        nps_applicable: true,
        tier: 'Tier I',
        contribution_type: 'Both',
      });

      engine.profileStore.upsertProfile({
        employee_id: 'EMP_NPS_OPT_OUT',
        employee_name: 'Suresh Raina',
        pran: '110011223344',
        nps_applicable: false, // Not applicable
        tier: 'Tier I',
        contribution_type: 'Both',
      });

      const eventPayload = {
        batch_id: 'BATCH_NPS_2026_09',
        period: '2026-09',
        employees: [
          { employee_id: 'EMP_NPS_AUTO', basic: 50000, da: 10000, gross_salary: 80000 },
          { employee_id: 'EMP_NPS_OPT_OUT', basic: 60000, da: 12000, gross_salary: 95000 },
        ],
      };

      const result = await engine.handlePayrollFinalized(eventPayload);

      assert.strictEqual(result.batch_id, 'BATCH_NPS_2026_09');
      assert.strictEqual(result.total_records, 1, 'Only nps_applicable employee should be processed');
      assert.strictEqual(result.contributions[0].employee_id, 'EMP_NPS_AUTO');
      assert.strictEqual(result.contributions[0].pran, '110099887766');
    });

    it('2.2 Should compute Employee share (10% of Basic+DA) and Employer share (10% of Basic+DA under Sec 80CCD(2))', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_CALC_01',
        employee_name: 'Deepak Chahar',
        pran: '123456789012',
        nps_applicable: true,
        contribution_type: 'Both',
      });

      const result = await engine.handlePayrollFinalized({
        batch_id: 'BATCH_CALC_01',
        period: '2026-09',
        employees: [
          { employee_id: 'EMP_CALC_01', basic: 40000, da: 10000 }, // Salary basis = 50,000
        ],
      });

      const contrib = result.contributions[0];
      assert.strictEqual(contrib.salary_basis, 50000);
      assert.strictEqual(contrib.employee_share, 5000, 'Employee share must be 10% of Basic+DA');
      assert.strictEqual(contrib.employer_share, 5000, 'Employer share under Sec 80CCD(2) must be 10% of Basic+DA');
      assert.strictEqual(contrib.total_contribution, 10000);
    });

    it('2.3 Should handle Section 80CCD(1B) additional voluntary pre-tax contributions up to statutory cap', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_80CCD1B',
        employee_name: 'Sneha Patel',
        pran: '987654321098',
        nps_applicable: true,
        contribution_type: 'Both',
        voluntary_monthly_amount: 4166.67, // ₹50,000 / 12 months
      });

      const result = await engine.handlePayrollFinalized({
        batch_id: 'BATCH_80CCD1B',
        period: '2026-09',
        employees: [
          { employee_id: 'EMP_80CCD1B', basic: 30000, da: 5000, voluntary_nps_amount: 4166.67 }, // Salary basis = 35,000
        ],
      });

      const contrib = result.contributions[0];
      assert.strictEqual(contrib.employee_share, 3500); // 10% of 35k
      assert.strictEqual(contrib.employer_share, 3500); // 10% of 35k
      assert.strictEqual(contrib.additional_80ccd1b_amount, 4166.67);
      assert.strictEqual(contrib.total_contribution, 3500 + 3500 + 4166.67);
    });

    it('2.4 Should honor contribution_type configuration (Employee only vs Employer only)', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_ONLY_EE',
        pran: '111122223333',
        nps_applicable: true,
        contribution_type: 'Employee',
      });
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_ONLY_ER',
        pran: '444455556666',
        nps_applicable: true,
        contribution_type: 'Employer',
      });

      const result = await engine.handlePayrollFinalized({
        batch_id: 'BATCH_CONTRIB_TYPES',
        period: '2026-09',
        employees: [
          { employee_id: 'EMP_ONLY_EE', basic: 50000, da: 0 },
          { employee_id: 'EMP_ONLY_ER', basic: 50000, da: 0 },
        ],
      });

      const eeRecord = result.contributions.find((c) => c.employee_id === 'EMP_ONLY_EE');
      assert.strictEqual(eeRecord.employee_share, 5000);
      assert.strictEqual(eeRecord.employer_share, 0);

      const erRecord = result.contributions.find((c) => c.employee_id === 'EMP_ONLY_ER');
      assert.strictEqual(erRecord.employee_share, 0);
      assert.strictEqual(erRecord.employer_share, 5000);
    });
  });

  // ==========================================================================
  // PILLAR 4: VALIDATION & EXCEPTION HANDLING
  // ==========================================================================
  describe('3. Validation & Exception Handling (12-Digit PRAN & Export Gatekeeper)', () => {
    it('3.1 Should detect missing PRAN, log failure, create HR task, send alert, and block record export', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_NO_PRAN',
        employee_name: 'Vikas Khanna',
        pran: '', // Missing PRAN
        nps_applicable: true,
      });

      const result = await engine.handlePayrollFinalized({
        batch_id: 'BATCH_DEFECT_PRAN',
        period: '2026-09',
        employees: [{ employee_id: 'EMP_NO_PRAN', basic: 40000, da: 5000 }],
      });

      assert.strictEqual(result.unresolved_blocking_defects_count, 1);
      assert.strictEqual(result.is_blocked, true);

      // Check validation issue
      const issues = engine.validationIssues.get('BATCH_DEFECT_PRAN');
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].error_code, 'NPS_PRAN_MISSING');
      assert.strictEqual(issues[0].severity, 'BLOCK');

      // Check HR Task
      const tasks = engine.hrTasks.get('BATCH_DEFECT_PRAN');
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].priority, 'HIGH');
      assert.match(tasks[0].action_required, /Permanent Retirement Account Number/i);

      // Check HR Alert
      const alerts = engine.hrAlerts.get('BATCH_DEFECT_PRAN');
      assert.strictEqual(alerts.length, 1);
      assert.strictEqual(alerts[0].severity, 'CRITICAL');
    });

    it('3.2 Should enforce strict 12-digit numeric format for PRAN and reject malformed/short values', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_INVALID_PRAN',
        employee_name: 'Pooja Hegde',
        pran: '12345ABC', // Invalid format and length
        nps_applicable: true,
      });

      const result = await engine.handlePayrollFinalized({
        batch_id: 'BATCH_MALFORMED_PRAN',
        period: '2026-09',
        employees: [{ employee_id: 'EMP_INVALID_PRAN', basic: 30000, da: 0 }],
      });

      const issues = engine.validationIssues.get('BATCH_MALFORMED_PRAN');
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].error_code, 'NPS_PRAN_INVALID_FORMAT');
    });

    it('3.3 Should prevent advancing to FILE_GENERATED while blocking defects exist unless resolved', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_GATEKEEPER',
        pran: '', // Missing
        nps_applicable: true,
      });

      await engine.handlePayrollFinalized({
        batch_id: 'BATCH_GATE_TEST',
        period: '2026-09',
        employees: [{ employee_id: 'EMP_GATEKEEPER', basic: 50000 }],
      });

      // Attempting to advance to FILE_GENERATED should throw 422
      assert.throws(() => {
        engine.advanceLifecycle('BATCH_GATE_TEST', 'FILE_GENERATED');
      }, /Cannot advance to FILE_GENERATED: batch has 1 unresolved blocking defect/i);

      // Now resolve the defect
      const issues = engine.validationIssues.get('BATCH_GATE_TEST');
      const resolveRes = engine.resolveValidationIssue(issues[0].issue_id, {
        resolved_by: 'hr-lead',
        fix_applied: 'Acquired 12-digit PRAN from subscriber',
      });
      assert.strictEqual(resolveRes.success, true);

      // Now advance should succeed
      const advanced = engine.advanceLifecycle('BATCH_GATE_TEST', 'FILE_GENERATED');
      assert.strictEqual(advanced.current_stage, 'FILE_GENERATED');
    });
  });

  // ==========================================================================
  // PILLAR 5: NSDL OUTPUT COMPILATION
  // ==========================================================================
  describe('4. NSDL Upload File Compilation (NPS_Contribution_MONTH_YEAR.txt)', () => {
    it('4.1 Should compile standardized NSDL upload file with exact 5 columns [PRAN, Employee Name, Employee Amt, Employer Amt, Total Amount]', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_NSDL_01',
        employee_name: 'Aarav Mehta',
        pran: '110012345678',
        nps_applicable: true,
        contribution_type: 'Both',
      });

      engine.profileStore.upsertProfile({
        employee_id: 'EMP_NSDL_02',
        employee_name: 'Bhavna Sen',
        pran: '110087654321',
        nps_applicable: true,
        contribution_type: 'Both',
      });

      await engine.handlePayrollFinalized({
        batch_id: 'BATCH_NSDL_01',
        period: '2026-09',
        employees: [
          { employee_id: 'EMP_NSDL_01', basic: 50000, da: 10000 }, // EE: 6000, ER: 6000, Total: 12000
          { employee_id: 'EMP_NSDL_02', basic: 40000, da: 5000 },  // EE: 4500, ER: 4500, Total: 9000
        ],
      });

      const exportResult = engine.generateNsdlExportFile('BATCH_NSDL_01');

      assert.strictEqual(exportResult.manifest.file_name, 'NPS_Contribution_09_2026.txt');
      assert.strictEqual(exportResult.manifest.row_count, 2);
      assert.strictEqual(exportResult.manifest.total_amount, 21000);
      assert.strictEqual(exportResult.manifest.total_employee_amount, 10500);
      assert.strictEqual(exportResult.manifest.total_employer_amount, 10500);

      // Verify file layout
      const lines = exportResult.txt.trim().split('\n');
      assert.strictEqual(lines[0], 'PRAN#Employee Name#Employee Amt#Employer Amt#Total Amount');

      const row1 = lines[1].split('#');
      assert.strictEqual(row1[0], '110012345678');
      assert.strictEqual(row1[1], 'Aarav Mehta');
      assert.strictEqual(row1[2], '6000.00');
      assert.strictEqual(row1[3], '6000.00');
      assert.strictEqual(row1[4], '12000.00');

      const row2 = lines[2].split('#');
      assert.strictEqual(row2[0], '110087654321');
      assert.strictEqual(row2[1], 'Bhavna Sen');
      assert.strictEqual(row2[2], '4500.00');
      assert.strictEqual(row2[3], '4500.00');
      assert.strictEqual(row2[4], '9000.00');
    });

    it('4.2 Should exclude defective/blocked records from NSDL export file compilation', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_VALID',
        employee_name: 'Valid Employee',
        pran: '110012345678',
        nps_applicable: true,
      });

      engine.profileStore.upsertProfile({
        employee_id: 'EMP_DEFECTIVE',
        employee_name: 'Invalid PRAN Employee',
        pran: 'INVALID_PRAN',
        nps_applicable: true,
      });

      await engine.handlePayrollFinalized({
        batch_id: 'BATCH_PARTIAL',
        period: '2026-09',
        employees: [
          { employee_id: 'EMP_VALID', basic: 50000, da: 0 },
          { employee_id: 'EMP_DEFECTIVE', basic: 50000, da: 0 },
        ],
      });

      const exportResult = engine.generateNsdlExportFile('BATCH_PARTIAL');
      assert.strictEqual(exportResult.manifest.row_count, 1, 'Only valid record must be included');
      assert.strictEqual(exportResult.manifest.rows[0].employee_id, 'EMP_VALID');
    });
  });

  // ==========================================================================
  // PILLAR 6: 7-STAGE VISUAL LIFECYCLE STEPPER & ACKNOWLEDGEMENT
  // ==========================================================================
  describe('5. 7-Stage Visual Lifecycle Stepper & NSDL Acknowledgement', () => {
    it('5.1 Should progress sequentially through the full 7-stage visual lifecycle', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_STEPPER',
        employee_name: 'Karan Sharma',
        pran: '110099887766',
        nps_applicable: true,
      });

      // Stage 1: Payroll Finalized (and auto NPS Calculated)
      await engine.handlePayrollFinalized({
        batch_id: 'BATCH_LIFECYCLE_01',
        period: '2026-09',
        employees: [{ employee_id: 'EMP_STEPPER', basic: 40000, da: 10000 }],
      });

      let state = engine.getStepperState('BATCH_LIFECYCLE_01');
      assert.strictEqual(state.current_stage, 'NPS_CALCULATED');

      // Stage 3: Validated
      state = engine.advanceLifecycle('BATCH_LIFECYCLE_01', 'VALIDATED');
      assert.strictEqual(state.current_stage, 'VALIDATED');
      assert.strictEqual(state.current_stage_label, 'Validated');

      // Stage 4: File Generated
      state = engine.advanceLifecycle('BATCH_LIFECYCLE_01', 'FILE_GENERATED');
      assert.strictEqual(state.current_stage, 'FILE_GENERATED');

      // Stage 5: Uploaded to NSDL
      state = engine.advanceLifecycle('BATCH_LIFECYCLE_01', 'UPLOADED_TO_NSDL');
      assert.strictEqual(state.current_stage, 'UPLOADED_TO_NSDL');

      // Stage 6: Acknowledgement (with NSDL PRN)
      state = engine.recordNsdlAcknowledgement('BATCH_LIFECYCLE_01', {
        prn: 'NSDL_PRN_20260905_9988',
        recorded_by: 'finance-desk',
      });
      assert.strictEqual(state.current_stage, 'ACKNOWLEDGEMENT');
      assert.strictEqual(state.acknowledgement_receipt.prn, 'NSDL_PRN_20260905_9988');

      // Stage 7: Completed
      state = engine.advanceLifecycle('BATCH_LIFECYCLE_01', 'COMPLETED');
      assert.strictEqual(state.current_stage, 'COMPLETED');
      assert.strictEqual(state.progress_percent, 100);
    });

    it('5.2 Should reject recording acknowledgement on unknown batch', () => {
      assert.throws(() => {
        engine.recordNsdlAcknowledgement('NON_EXISTENT_BATCH', { prn: 'PRN_123' });
      }, /NPS Stepper state not found/i);
    });
  });

  // ==========================================================================
  // PILLAR 7: END-TO-END REST API ENDPOINTS
  // ==========================================================================
  describe('6. REST API Endpoints Integration', () => {
    let app;
    let server;
    let baseUrl;

    before((t, done) => {
      app = express();
      app.use(express.json());
      const router = createPayrollDisbursementApiRouter();
      app.use(router);

      server = app.listen(0, () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        done();
      });
    });

    after((t, done) => {
      if (server) {
        server.close(done);
      } else {
        done();
      }
    });

    it('6.1 POST & GET /api/v1/nps/profiles: should upsert and retrieve profiles', async () => {
      const res1 = await fetch(`${baseUrl}/api/v1/nps/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: 'REST_NPS_01',
          employee_name: 'Vikram Seth',
          pran: '110055554444',
          nps_applicable: true,
          tier: 'Tier I',
          contribution_type: 'Both',
        }),
      });
      const data1 = await res1.json();
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(data1.data.employee_id, 'REST_NPS_01');

      const res2 = await fetch(`${baseUrl}/api/v1/nps/profiles`);
      const data2 = await res2.json();
      assert.strictEqual(res2.status, 200);
      assert.ok(data2.data.profiles.some((p) => p.employee_id === 'REST_NPS_01'));
    });

    it('6.2 POST /api/v1/nps/trigger: should execute payroll finalized trigger', async () => {
      globalCorporateNpsAutomationEngine.profileStore.upsertProfile({
        employee_id: 'REST_NPS_TRIGGER',
        employee_name: 'Pooja Bhatt',
        pran: '110033332222',
        nps_applicable: true,
      });

      const res = await fetch(`${baseUrl}/api/v1/nps/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: 'BATCH_REST_TRIGGER',
          period: '2026-09',
          employees: [{ employee_id: 'REST_NPS_TRIGGER', basic: 50000, da: 10000 }],
        }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.data.batch_id, 'BATCH_REST_TRIGGER');
      assert.strictEqual(data.data.total_amount, 12000);
    });

    it('6.3 GET & POST /api/v1/nps/stepper/:batch_id: should inspect and advance workflow', async () => {
      const getRes = await fetch(`${baseUrl}/api/v1/nps/stepper/BATCH_REST_TRIGGER`);
      const getData = await getRes.json();
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getData.data.current_stage, 'NPS_CALCULATED');

      const advRes = await fetch(`${baseUrl}/api/v1/nps/stepper/BATCH_REST_TRIGGER/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_stage: 'VALIDATED' }),
      });
      const advData = await advRes.json();
      assert.strictEqual(advRes.status, 200);
      assert.strictEqual(advData.data.current_stage, 'VALIDATED');
    });

    it('6.4 POST /api/v1/nps/stepper/:batch_id/acknowledge: should record NSDL PRN', async () => {
      // Advance to UPLOADED_TO_NSDL first
      await fetch(`${baseUrl}/api/v1/nps/stepper/BATCH_REST_TRIGGER/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_stage: 'FILE_GENERATED' }),
      });
      await fetch(`${baseUrl}/api/v1/nps/stepper/BATCH_REST_TRIGGER/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_stage: 'UPLOADED_TO_NSDL' }),
      });

      const ackRes = await fetch(`${baseUrl}/api/v1/nps/stepper/BATCH_REST_TRIGGER/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prn: 'ACK_PRN_REST_999',
          recorded_by: 'nps-admin',
        }),
      });
      const ackData = await ackRes.json();
      assert.strictEqual(ackRes.status, 200);
      assert.strictEqual(ackData.data.current_stage, 'ACKNOWLEDGEMENT');
      assert.strictEqual(ackData.data.acknowledgement_receipt.prn, 'ACK_PRN_REST_999');
    });

    it('6.5 GET /api/v1/nps/export/:batch_id: should download NPS_Contribution_MONTH_YEAR.txt', async () => {
      const res = await fetch(`${baseUrl}/api/v1/nps/export/BATCH_REST_TRIGGER?format=txt`);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.match(text, /PRAN#Employee Name#Employee Amt#Employer Amt#Total Amount/);
      assert.match(text, /110033332222#Pooja Bhatt#6000\.00#6000\.00#12000\.00/);
    });

    it('6.6 GET /api/v1/nps/exceptions, tasks, alerts and POST /resolve', async () => {
      // Trigger a batch with defect
      globalCorporateNpsAutomationEngine.profileStore.upsertProfile({
        employee_id: 'REST_NPS_DEFECT',
        employee_name: 'Defect Emp',
        pran: '', // Missing
        nps_applicable: true,
      });

      await fetch(`${baseUrl}/api/v1/nps/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: 'BATCH_REST_DEFECT',
          period: '2026-09',
          employees: [{ employee_id: 'REST_NPS_DEFECT', basic: 30000 }],
        }),
      });

      // Verify exceptions
      const excRes = await fetch(`${baseUrl}/api/v1/nps/exceptions?batch_id=BATCH_REST_DEFECT`);
      const excData = await excRes.json();
      assert.strictEqual(excRes.status, 200);
      assert.strictEqual(excData.data.total_count, 1);
      const issueId = excData.data.issues[0].issue_id;

      // Verify tasks
      const taskRes = await fetch(`${baseUrl}/api/v1/nps/tasks?batch_id=BATCH_REST_DEFECT`);
      const taskData = await taskRes.json();
      assert.strictEqual(taskData.data.total_count, 1);

      // Verify alerts
      const alertRes = await fetch(`${baseUrl}/api/v1/nps/alerts?batch_id=BATCH_REST_DEFECT`);
      const alertData = await alertRes.json();
      assert.strictEqual(alertData.data.total_count, 1);

      // Resolve exception
      const resResolve = await fetch(`${baseUrl}/api/v1/nps/exceptions/${issueId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved_by: 'lead-ops', fix_applied: 'Updated PRAN' }),
      });
      const resResolveData = await resResolve.json();
      assert.strictEqual(resResolve.status, 200);
      assert.strictEqual(resResolveData.data.issue.resolved, true);
    });
  });
});
