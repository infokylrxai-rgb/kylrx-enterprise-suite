/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - STATUTORY GRATUITY PROVISIONING & SETTLEMENT ENGINE
 * TEST SUITE (COLUMN 2 BLUEPRINT)
 * ============================================================================
 * Validates Column 2 of the visual compliance blueprint across all pillars:
 *
 * 1. Profile Master (EmployeeGratuityProfile modeling & nominee details)
 * 2. Automation Builder & Eligibility Gate (Exit/Resignation & Payroll triggers, 5-year gate, death/disability bypass)
 * 3. Calculation Engine ((Salary * 15 * Completed Years) / 26, test vector: 25k salary, 6.2 years = ₹89,423)
 * 4. Exceptions, HR Tasks & Alerts (Continuous service < 5 years, missing data)
 * 5. Reporting & 7-Stage Settlement Workflow (Gratuity_Statement_MONTH_YEAR.xlsx, maker-checker HR approval)
 * 6. End-to-End REST API Endpoints Integration
 *
 * @version 1.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import express from 'express';

import {
  GratuityAutomationEngine,
  EmployeeGratuityProfileStore,
  GRATUITY_WORKFLOW_STAGES,
  globalGratuityAutomationEngine,
} from './gratuity-automation-engine.mjs';

import { createPayrollDisbursementApiRouter } from './payroll-disbursement-api.mjs';

describe('🏛️ STATUTORY GRATUITY PROVISIONING & SETTLEMENT ENGINE (COLUMN 2 BLUEPRINT)', () => {
  let engine;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = new EventEmitter();
    engine = new GratuityAutomationEngine({ eventBus: mockEventBus });
  });

  // ==========================================================================
  // PILLAR 1: PROFILE MASTER
  // ==========================================================================
  describe('1. Profile Master (EmployeeGratuityProfile & Nominee Details)', () => {
    it('1.1 Should model and persist EmployeeGratuityProfile with nominee_details [name, relation, share %]', () => {
      const profile = engine.profileStore.upsertProfile({
        employee_id: 'GRAT_EMP_01',
        employee_name: 'Harish Kalyan',
        date_of_joining: '2018-05-15',
        last_drawn_salary: 45000,
        gratuity_eligible: true,
        date_of_exit: '2026-09-01',
        nominee_details: [
          { name: 'Priya Kalyan', relation: 'Spouse', share_percentage: 60 },
          { name: 'Rohan Kalyan', relation: 'Son', share_percentage: 40 },
        ],
      });

      assert.strictEqual(profile.employee_id, 'GRAT_EMP_01');
      assert.strictEqual(profile.last_drawn_salary, 45000);
      assert.strictEqual(profile.nominee_details.length, 2);
      assert.strictEqual(profile.nominee_details[0].share_percentage, 60);

      const retrieved = engine.profileStore.getProfile('GRAT_EMP_01');
      assert.strictEqual(retrieved.employee_name, 'Harish Kalyan');
      assert.strictEqual(retrieved.nominee_details[1].relation, 'Son');
    });

    it('1.2 Should normalize last_drawn_salary from Basic and DA if provided separately', () => {
      const profile = engine.profileStore.upsertProfile({
        employee_id: 'GRAT_EMP_02',
        employee_name: 'Ananya Deshmukh',
        date_of_joining: '2017-02-01',
        last_drawn_basic: 30000,
        last_drawn_da: 12000,
      });

      assert.strictEqual(profile.last_drawn_salary, 42000, 'Salary basis must be Basic + DA = 42,000');
    });
  });

  // ==========================================================================
  // PILLAR 2: AUTOMATION BUILDER & ELIGIBILITY GATE
  // ==========================================================================
  describe('2. Automation Builder & Eligibility Gate (5-Year Gate, Exit & Payroll Triggers)', () => {
    it('2.1 Should automatically listen to employee.exit and resignation.submitted on EventBus', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EXIT_EMP_01',
        employee_name: 'Manish Pandey',
        date_of_joining: '2018-01-01',
        last_drawn_salary: 35000,
        date_of_exit: '2026-08-31',
        exit_reason: 'RESIGNATION',
      });

      mockEventBus.emit('employee.exit', {
        employee_id: 'EXIT_EMP_01',
        actor_id: 'HR_EXIT_DESK',
      });

      await new Promise((r) => setImmediate(r));

      const allSteppers = Array.from(engine.stepperStates.values());
      const exitStepper = allSteppers.find((s) => s.trigger_source === 'EMPLOYEE_EXIT');
      assert.ok(exitStepper, 'Stepper must be triggered upon employee.exit');
      assert.strictEqual(exitStepper.current_stage, 'GENERATE_STATEMENT');
    });

    it('2.2 Should automatically listen to monthly PAYROLL_FINALIZED trigger', async () => {
      engine.profileStore.upsertProfile({
        employee_id: 'PAYROLL_GRAT_01',
        employee_name: 'Sunita Rao',
        date_of_joining: '2019-01-01',
        last_drawn_salary: 50000,
        date_of_exit: '2026-09-01',
      });

      mockEventBus.emit('PAYROLL_FINALIZED', {
        run_id: 'RUN_2026_09_TEST',
        period: '2026-09',
        payroll_records: [{ employee_id: 'PAYROLL_GRAT_01', date_of_exit: '2026-09-01' }],
      });

      await new Promise((r) => setImmediate(r));

      const payrollStepper = engine.getStepperState('GRAT_PAYROLL_RUN_2026_09_TEST');
      assert.ok(payrollStepper, 'Stepper must be triggered upon PAYROLL_FINALIZED');
      assert.strictEqual(payrollStepper.current_stage, 'GENERATE_STATEMENT');
    });

    it('2.3 Should enforce 5-Year Continuous Service requirement and exclude unvested staff', async () => {
      const candidates = [
        {
          employee_id: 'UNVESTED_01',
          employee_name: 'Fresh Employee',
          date_of_joining: '2024-01-01', // Under 5 years (~2.7 years)
          date_of_exit: '2026-09-01',
          last_drawn_salary: 30000,
          exit_reason: 'RESIGNATION',
        },
        {
          employee_id: 'VESTED_01',
          employee_name: 'Senior Employee',
          date_of_joining: '2019-01-01', // Over 5 years (~7.7 years)
          date_of_exit: '2026-09-01',
          last_drawn_salary: 30000,
          exit_reason: 'RESIGNATION',
        },
      ];

      const result = await engine.triggerProvisioningAndSettlement({
        batch_id: 'BATCH_VESTING_GATE_TEST',
        exit_records: candidates,
      });

      assert.strictEqual(result.total_candidates, 2);
      assert.strictEqual(result.total_eligible, 1, 'Only Senior Employee should be eligible');
      assert.strictEqual(result.total_ineligible, 1);
      assert.strictEqual(result.ineligible_candidates[0].profile.employee_id, 'UNVESTED_01');

      // Check HR Task and Alert created for unvested employee
      assert.strictEqual(result.hr_tasks.length, 1);
      assert.strictEqual(result.hr_tasks[0].employee_id, 'UNVESTED_01');
      assert.strictEqual(result.hr_tasks[0].task_type, 'GRATUITY_ELIGIBILITY_REVIEW');

      assert.strictEqual(result.hr_alerts.length, 1);
      assert.strictEqual(result.hr_alerts[0].employee_id, 'UNVESTED_01');
    });

    it('2.4 Should automatically apply statutory bypass on DEATH or DISABILITY even if service < 5 years', async () => {
      const candidates = [
        {
          employee_id: 'DEATH_BYPASS_01',
          employee_name: 'Late Rajesh Kumar',
          date_of_joining: '2025-01-01', // Only 1.7 years of service
          date_of_exit: '2026-09-01',
          last_drawn_salary: 40000,
          exit_reason: 'DEATH', // Statutory exemption
          nominee_details: [{ name: 'Kavita Kumar', relation: 'Widow', share_percentage: 100 }],
        },
      ];

      const result = await engine.triggerProvisioningAndSettlement({
        batch_id: 'BATCH_BYPASS_TEST',
        exit_records: candidates,
      });

      assert.strictEqual(result.total_eligible, 1, 'Death exit reason must bypass continuous service gate');
      assert.strictEqual(result.total_ineligible, 0);
      assert.strictEqual(result.calculations[0].statutory_bypass_applied, true);
      assert.ok(result.calculations[0].gratuity_amount > 0);
    });
  });

  // ==========================================================================
  // PILLAR 3: CALCULATION ENGINE
  // ==========================================================================
  describe('3. Calculation Engine ((Salary * 15 * Years) / 26 Precision & Capping)', () => {
    it('3.1 Should execute exact statutory formula matching blueprint test vector: ₹25,000 salary, 6.2 years = ₹89,423 payable', async () => {
      const candidate = {
        employee_id: 'BLUEPRINT_VECTOR_01',
        employee_name: 'Blueprint Test Employee',
        date_of_joining: '2020-01-01',
        date_of_exit: '2026-03-15',
        completed_years: 6.2, // Explicit 6.2 completed years from blueprint
        last_drawn_salary: 25000, // ₹25,000
        exit_reason: 'RESIGNATION',
      };

      const result = await engine.triggerProvisioningAndSettlement({
        batch_id: 'BATCH_VECTOR_01',
        exit_records: [candidate],
      });

      assert.strictEqual(result.total_eligible, 1);
      const calc = result.calculations[0];

      // Exact Formula: (25000 * 15 * 6.2) / 26 = 89423.0769 -> ₹89,423
      assert.strictEqual(calc.last_drawn_salary, 25000);
      assert.strictEqual(calc.completed_years, 6.2);
      assert.strictEqual(calc.gratuity_amount, 89423, 'Must match blueprint test vector exactly: ₹89,423');
    });

    it('3.2 Should enforce statutory ₹20,00,000 tax-free cap and isolate taxable excess', async () => {
      const highEarner = {
        employee_id: 'EXECUTIVE_01',
        employee_name: 'Chief Executive Officer',
        completed_years: 25,
        last_drawn_salary: 250000, // (250000 * 15 * 25) / 26 = 3,605,769.23 -> ₹36,05,769
        exit_reason: 'RETIREMENT',
      };

      const result = await engine.triggerProvisioningAndSettlement({
        batch_id: 'BATCH_HIGH_EARNER',
        exit_records: [highEarner],
      });

      const calc = result.calculations[0];
      assert.strictEqual(calc.gratuity_amount, 3605769);
      assert.strictEqual(calc.tax_free_amount, 2000000, 'Tax free portion capped at ₹20L');
      assert.strictEqual(calc.taxable_excess, 1605769, 'Excess beyond ₹20L must be taxable');
    });

    it('3.3 Should allocate payout across declared nominees according to percentage share', async () => {
      const candidate = {
        employee_id: 'NOMINEE_TEST_01',
        employee_name: 'Mahesh Bhatt',
        completed_years: 10,
        last_drawn_salary: 52000, // (52000 * 15 * 10) / 26 = 300,000
        nominee_details: [
          { name: 'Soni Bhatt', relation: 'Spouse', share_percentage: 50 },
          { name: 'Alia Bhatt', relation: 'Daughter', share_percentage: 50 },
        ],
      };

      const result = await engine.triggerProvisioningAndSettlement({
        batch_id: 'BATCH_NOMINEE_SPLIT',
        exit_records: [candidate],
      });

      const calc = result.calculations[0];
      assert.strictEqual(calc.gratuity_amount, 300000);
      assert.strictEqual(calc.nominee_allocations.length, 2);
      assert.strictEqual(calc.nominee_allocations[0].allocated_amount, 150000);
      assert.strictEqual(calc.nominee_allocations[1].allocated_amount, 150000);
    });
  });

  // ==========================================================================
  // PILLAR 4 & 5: REPORTING & 7-STAGE SETTLEMENT WORKFLOW
  // ==========================================================================
  describe('4. Reporting & 7-Stage Settlement Workflow (Gratuity_Statement_MONTH_YEAR.xlsx & 4-Eyes Gate)', () => {
    it('4.1 Should generate Gratuity_Statement_MONTH_YEAR.xlsx with the required 7 columns', async () => {
      const candidate = {
        employee_id: 'STMT_EMP_01',
        employee_name: 'Prakash Padukone',
        date_of_joining: '2015-06-01',
        date_of_exit: '2026-09-01',
        completed_years: 11.2,
        last_drawn_salary: 65000,
      };

      await engine.triggerProvisioningAndSettlement({
        batch_id: 'BATCH_STMT_01',
        period: '2026-09',
        exit_records: [candidate],
      });

      const exportFiles = engine.statementFiles.get('BATCH_STMT_01');
      assert.ok(exportFiles);
      assert.strictEqual(exportFiles.xlsx.file_name, 'Gratuity_Statement_09_2026.xlsx');
      assert.strictEqual(exportFiles.csv.file_name, 'Gratuity_Statement_09_2026.csv');

      // Verify CSV header layout: [Employee ID, Employee Name, DOJ, Exit Date, Completed Years, Last Salary, Gratuity Amount]
      const csvLines = exportFiles.csv.content.split('\r\n');
      assert.strictEqual(
        csvLines[0],
        'Employee ID,Employee Name,DOJ,Exit Date,Completed Years,Last Salary,Gratuity Amount'
      );
      assert.ok(csvLines[1].includes('"STMT_EMP_01","Prakash Padukone"'));

      // Verify XLSX XML table
      assert.ok(exportFiles.xlsx.content.includes('<table'));
      assert.ok(exportFiles.xlsx.content.includes('<th>Employee ID</th>'));
      assert.ok(exportFiles.xlsx.content.includes('<td>Prakash Padukone</td>'));
    });

    it('4.2 Should enforce 4-Eyes Maker-Checker segregation of duties (Reject self-approval: maker_id === checker_id)', async () => {
      const batchId = 'BATCH_MAKER_CHECKER_01';
      const makerId = 'hr-maker@kylrx.ai';

      await engine.triggerProvisioningAndSettlement({
        batch_id: batchId,
        maker_id: makerId,
        exit_records: [
          {
            employee_id: 'MC_EMP_01',
            completed_years: 8,
            last_drawn_salary: 30000,
          },
        ],
      });

      // Self-approval must be rejected with 403 / MAKER_CHECKER_VIOLATION
      assert.throws(
        () => {
          engine.approveGratuityBatch(batchId, makerId, 'Attempted self-approval');
        },
        (err) => {
          assert.strictEqual(err.code, 'MAKER_CHECKER_VIOLATION');
          assert.strictEqual(err.statusCode, 403);
          return true;
        }
      );

      // Distinct checker approval must succeed
      const checkerId = 'finance-checker@kylrx.ai';
      const approvedState = engine.approveGratuityBatch(batchId, checkerId, 'Authorized disbursement');
      assert.strictEqual(approvedState.is_approved, true);
      assert.strictEqual(approvedState.checker_id, checkerId);
      assert.strictEqual(approvedState.current_stage, 'HR_APPROVAL');
    });

    it('4.3 Should advance through all 7 stages: TRIGGERED -> COMPLETED with gatekeeping', async () => {
      const batchId = 'BATCH_FULL_LIFECYCLE';
      await engine.triggerProvisioningAndSettlement({
        batch_id: batchId,
        maker_id: 'MAKER_USER',
        exit_records: [
          {
            employee_id: 'LIFECYCLE_01',
            completed_years: 7,
            last_drawn_salary: 35000,
          },
        ],
      });

      // Currently at Stage 4: GENERATE_STATEMENT
      let state = engine.getStepperState(batchId);
      assert.strictEqual(state.current_stage, 'GENERATE_STATEMENT');

      // Attempt to jump straight to PROCESS_PAYMENT without HR_APPROVAL must be blocked (422)
      assert.throws(
        () => {
          engine.advanceWorkflow(batchId, 'PROCESS_PAYMENT');
        },
        (err) => {
          assert.strictEqual(err.code, 'UNAPPROVED_GRATUITY_BATCH');
          return true;
        }
      );

      // Stage 5: Grant HR Approval by checker
      state = engine.approveGratuityBatch(batchId, 'CHECKER_USER', 'Approved by Senior Compliance Officer');
      assert.strictEqual(state.current_stage, 'HR_APPROVAL');

      // Stage 6: Advance to PROCESS_PAYMENT
      state = engine.advanceWorkflow(batchId, 'PROCESS_PAYMENT', { actor: 'DISBURSEMENT_DESK' });
      assert.strictEqual(state.current_stage, 'PROCESS_PAYMENT');
      assert.strictEqual(state.progress_percent, 86);

      // Stage 7: Advance to COMPLETED
      state = engine.advanceWorkflow(batchId, 'COMPLETED', { actor: 'SETTLEMENT_DESK' });
      assert.strictEqual(state.current_stage, 'COMPLETED');
      assert.strictEqual(state.progress_percent, 100);
      assert.strictEqual(state.stages[6].status, 'COMPLETED');
    });
  });

  // ==========================================================================
  // PILLAR 6: REST API ENDPOINTS INTEGRATION
  // ==========================================================================
  describe('5. REST API Endpoints Integration', () => {
    let server;
    let baseUrl;

    before(() => {
      const app = express();
      app.use(express.json());
      app.use(createPayrollDisbursementApiRouter());
      server = app.listen(0);
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    after(() => {
      if (server) server.close();
    });

    it('5.1 POST /api/v1/gratuity/profiles upserts and GET /profiles retrieves', async () => {
      const postRes = await fetch(`${baseUrl}/api/v1/gratuity/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: 'API_GRAT_01',
          employee_name: 'Dharmesh Sharma',
          date_of_joining: '2019-03-01',
          last_drawn_salary: 38000,
        }),
      });
      assert.strictEqual(postRes.status, 200);
      const postBody = await postRes.json();
      assert.strictEqual(postBody.success, true);
      assert.strictEqual(postBody.data.last_drawn_salary, 38000);

      const getRes = await fetch(`${baseUrl}/api/v1/gratuity/profiles`);
      assert.strictEqual(getRes.status, 200);
      const getBody = await getRes.json();
      assert.ok(getBody.data.profiles.some((p) => p.employee_id === 'API_GRAT_01'));
    });

    it('5.2 POST /api/v1/gratuity/trigger triggers settlement engine', async () => {
      const triggerRes = await fetch(`${baseUrl}/api/v1/gratuity/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: 'BATCH_API_GRAT_01',
          maker_id: 'API_MAKER',
          exit_records: [
            {
              employee_id: 'API_GRAT_01',
              completed_years: 6.2,
              last_drawn_salary: 25000,
            },
          ],
        }),
      });

      assert.strictEqual(triggerRes.status, 200);
      const triggerBody = await triggerRes.json();
      assert.strictEqual(triggerBody.success, true);
      assert.strictEqual(triggerBody.data.calculations[0].gratuity_amount, 89423);
    });

    it('5.3 POST /approve rejects self-approval with 403 and approves distinct checker', async () => {
      // 1. Self-approval must return 403 Forbidden
      const rejectRes = await fetch(`${baseUrl}/api/v1/gratuity/stepper/BATCH_API_GRAT_01/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checker_id: 'API_MAKER' }),
      });
      assert.strictEqual(rejectRes.status, 403);
      const rejectBody = await rejectRes.json();
      assert.strictEqual(rejectBody.error.code, 'MAKER_CHECKER_VIOLATION');

      // 2. Distinct checker approval must succeed with 200
      const approveRes = await fetch(`${baseUrl}/api/v1/gratuity/stepper/BATCH_API_GRAT_01/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checker_id: 'API_CHECKER' }),
      });
      assert.strictEqual(approveRes.status, 200);
      const approveBody = await approveRes.json();
      assert.strictEqual(approveBody.data.is_approved, true);
    });

    it('5.4 GET /statement/:batch_id downloads statement in .xlsx and .csv formats', async () => {
      // Download CSV
      const csvRes = await fetch(`${baseUrl}/api/v1/gratuity/statement/BATCH_API_GRAT_01?format=csv`);
      assert.strictEqual(csvRes.status, 200);
      const csvText = await csvRes.text();
      assert.ok(csvText.includes('Employee ID,Employee Name,DOJ,Exit Date,Completed Years,Last Salary,Gratuity Amount'));
      assert.ok(csvText.includes('89423'));

      // Download XLSX
      const xlsxRes = await fetch(`${baseUrl}/api/v1/gratuity/statement/BATCH_API_GRAT_01?format=xlsx`);
      assert.strictEqual(xlsxRes.status, 200);
      const xlsxText = await xlsxRes.text();
      assert.ok(xlsxText.includes('<table'));
      assert.ok(xlsxText.includes('89423'));
    });
  });
});
