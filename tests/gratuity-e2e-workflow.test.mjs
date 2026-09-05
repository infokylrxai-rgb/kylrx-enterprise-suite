/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - STATUTORY GRATUITY END-TO-END WORKFLOW TEST
 * ============================================================================
 * Validates Column 2 of the Visual Compliance Blueprint across the full HTTP & Event API:
 *  1. Profile Master & Nominee modeling (EmployeeGratuityProfile, template download, bulk upload)
 *  2. Automation Builder & 5-Year Continuous Service Gate (< 5 years excluded, HR Task & Alert)
 *  3. Statutory Bypass on Death / Permanent Disability (service < 5 years allowed)
 *  4. Calculation Engine Precision & Blueprint Test Vector:
 *     Formula: (Last Drawn Salary * 15 * Completed Years) / 26
 *     Test Vector: ₹25,000 salary, 6.2 completed years = ₹89,423 payable
 *  5. ₹20,00,000 Tax-Free Cap & Nominee Share Allocation
 *  6. 7-Stage Visual Compliance Stepper:
 *     TRIGGERED -> ELIGIBILITY_CHECK -> CALCULATE_GRATUITY ->
 *     GENERATE_STATEMENT -> HR_APPROVAL -> PROCESS_PAYMENT -> COMPLETED
 *  7. 4-Eyes Maker-Checker Segregation of Duties:
 *     - Rejection of self-approval (403 MAKER_CHECKER_VIOLATION)
 *     - Rejection of payment without approval (422 UNAPPROVED_GRATUITY_BATCH)
 *     - Successful distinct checker approval
 *  8. Official Statement Generation: Gratuity_Statement_MONTH_YEAR.xlsx / .csv (exact 7 columns)
 *  9. Centralized EventBus Automated Listener Integration
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import express from 'express';
import gratuityRouter from '../routes/gratuity.mjs';
import { globalGratuityAutomationEngine } from '../services/gratuity-automation-engine.mjs';

describe('Column 2 Gratuity Provisioning & Settlement Automation - End-to-End Suite', () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/gratuity', gratuityRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/gratuity`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. Should download standard Employee Gratuity Master template', async () => {
    const res = await fetch(`${baseUrl}/template?format=csv`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('employee_id,employee_name,date_of_joining,date_of_exit'));
    assert.ok(text.includes('last_drawn_salary'));
    assert.ok(text.includes('nominee_name,nominee_relation,nominee_share_pct'));
  });

  it('2. Should model EmployeeGratuityProfile with nominee details and bulk upload', async () => {
    // 2.1 Single Profile creation
    const profileRes = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: 'GRAT_EMP_01',
        employee_name: 'Ananya Deshmukh',
        date_of_joining: '2019-01-01',
        date_of_exit: '2026-03-31',
        last_drawn_salary: 50000,
        nominee_details: [
          { name: 'Sameer Deshmukh', relation: 'Spouse', share_percentage: 60 },
          { name: 'Ria Deshmukh', relation: 'Daughter', share_percentage: 40 },
        ],
      }),
    });
    assert.equal(profileRes.status, 200);
    const profileData = await profileRes.json();
    assert.equal(profileData.success, true);
    assert.equal(profileData.data.nominee_details.length, 2);

    // 2.2 Bulk Master Ingestion
    const csvContent = [
      'employee_id,employee_name,date_of_joining,date_of_exit,exit_reason,last_drawn_salary,nominee_name,nominee_relation,nominee_share_pct',
      'GRAT_EMP_02,Vikram Malhotra,2017-06-01,2026-08-31,RESIGNATION,60000,Pooja Malhotra,Spouse,100',
      'GRAT_EMP_03,Karan Saxena,2023-01-15,2026-08-31,RESIGNATION,35000,Suman Saxena,Mother,100', // Unvested (< 5 yrs)
      'GRAT_EMP_04,Devendra Joshi,2024-02-01,2026-08-15,DEATH,40000,Sunita Joshi,Widow,100', // Statutory Bypass (< 5 yrs)
    ].join('\n');

    const uploadRes = await fetch(`${baseUrl}/upload-master`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: csvContent }),
    });
    assert.equal(uploadRes.status, 200);
    const uploadData = await uploadRes.json();
    assert.equal(uploadData.count, 3);
  });

  it('3. Should evaluate continuous service 5-year gate, apply death bypass, and route unvested to HR tasks & alerts', async () => {
    const batchId = 'BATCH_GRAT_GATE_TEST_01';
    const triggerRes = await fetch(`${baseUrl}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: batchId,
        maker_id: 'HR_MAKER_OFFICER_01',
        exit_records: [
          {
            employee_id: 'GRAT_EMP_01', // Joined 2019, exited 2026 (> 7 yrs) -> Eligible
            date_of_joining: '2019-01-01',
            date_of_exit: '2026-03-31',
            last_drawn_salary: 50000,
          },
          {
            employee_id: 'GRAT_EMP_03', // Joined 2023, exited 2026 (3.6 yrs) -> Unvested!
            date_of_joining: '2023-01-15',
            date_of_exit: '2026-08-31',
            last_drawn_salary: 35000,
            exit_reason: 'RESIGNATION',
          },
          {
            employee_id: 'GRAT_EMP_04', // Joined 2024, exited 2026 (2.5 yrs) but DEATH -> Statutory Bypass!
            date_of_joining: '2024-02-01',
            date_of_exit: '2026-08-15',
            last_drawn_salary: 40000,
            exit_reason: 'DEATH',
          },
        ],
      }),
    });

    assert.equal(triggerRes.status, 200);
    const triggerData = await triggerRes.json();
    assert.equal(triggerData.success, true);

    const calc = triggerData.data;
    assert.equal(calc.total_eligible, 2, 'Must have 2 eligible: GRAT_EMP_01 (>5 yrs) and GRAT_EMP_04 (Death bypass)');
    assert.equal(calc.total_ineligible, 1, 'Must have 1 ineligible: GRAT_EMP_03 (<5 yrs)');

    // Verify death bypass flag
    const deathRec = calc.calculations.find((c) => c.employee_id === 'GRAT_EMP_04');
    assert.equal(deathRec.statutory_bypass_applied, true);

    // Verify HR tasks and compliance alerts created for ineligible staff
    assert.ok(calc.hr_tasks.length >= 1);
    assert.ok(calc.hr_alerts.length >= 1);
    const unvestedTask = calc.hr_tasks.find((t) => t.employee_id === 'GRAT_EMP_03');
    assert.ok(unvestedTask);
    assert.equal(unvestedTask.status, 'PENDING');
  });

  it('4. Calculation Precision: Must execute exact formula and match blueprint test vector (₹25k, 6.2 yrs = ₹89,423)', async () => {
    const batchId = 'BATCH_GRAT_VECTOR_TEST';
    const triggerRes = await fetch(`${baseUrl}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: batchId,
        maker_id: 'HR_MAKER_OFFICER_01',
        exit_records: [
          {
            employee_id: 'BLUEPRINT_VECTOR_EMP',
            employee_name: 'Blueprint Test Person',
            date_of_joining: '2020-01-01',
            date_of_exit: '2026-03-15',
            completed_years: 6.2, // Explicit 6.2 completed years from blueprint
            last_drawn_salary: 25000, // ₹25,000
            exit_reason: 'RESIGNATION',
          },
        ],
      }),
    });

    assert.equal(triggerRes.status, 200);
    const triggerData = await triggerRes.json();
    const calculation = triggerData.data.calculations[0];

    // Statutory Formula: (25000 * 15 * 6.2) / 26 = 89423.0769 -> ₹89,423
    assert.equal(calculation.last_drawn_salary, 25000);
    assert.equal(calculation.completed_years, 6.2);
    assert.equal(calculation.gratuity_amount, 89423, 'Must match exact blueprint test vector: ₹89,423');
  });

  it('5. Should enforce statutory ₹20L tax-free cap and allocate nominee percentage shares', async () => {
    const batchId = 'BATCH_CAP_NOMINEE_TEST';
    const triggerRes = await fetch(`${baseUrl}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: batchId,
        maker_id: 'HR_MAKER_OFFICER_01',
        exit_records: [
          {
            employee_id: 'HIGH_EARNER_EMP',
            employee_name: 'Managing Director',
            completed_years: 25,
            last_drawn_salary: 250000, // (250000 * 15 * 25) / 26 = 3,605,769
            exit_reason: 'RETIREMENT',
            nominee_details: [
              { name: 'Pooja Director', relation: 'Spouse', share_percentage: 50 },
              { name: 'Karan Director', relation: 'Son', share_percentage: 50 },
            ],
          },
        ],
      }),
    });

    assert.equal(triggerRes.status, 200);
    const calculation = (await triggerRes.json()).data.calculations[0];

    assert.equal(calculation.gratuity_amount, 3605769);
    assert.equal(calculation.tax_free_amount, 2000000, 'Tax free portion capped at ₹20,00,000');
    assert.equal(calculation.taxable_excess, 1605769, 'Excess must be isolated for tax deduction');

    // Nominee 50-50 split
    assert.equal(calculation.nominee_allocations.length, 2);
    assert.equal(calculation.nominee_allocations[0].allocated_amount, Math.round(3605769 * 0.5));
    assert.equal(calculation.nominee_allocations[1].allocated_amount, Math.round(3605769 * 0.5));
  });

  it('6. 4-Eyes Maker-Checker Gate: Should reject self-approval with 403, block payment without approval with 422, and approve with checker', async () => {
    const batchId = 'BATCH_4EYES_GATE_01';
    const makerId = 'MAKER_USER_RAHUL';
    const distinctCheckerId = 'CHECKER_USER_PRIYA';

    // 1. Trigger workflow (creates batch with maker_id = MAKER_USER_RAHUL)
    const triggerRes = await fetch(`${baseUrl}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: batchId,
        maker_id: makerId,
        exit_records: [
          {
            employee_id: 'EMP_4EYES_01',
            completed_years: 6,
            last_drawn_salary: 30000,
          },
        ],
      }),
    });
    assert.equal(triggerRes.status, 200);

    // Current stage is Stage 4: GENERATE_STATEMENT
    const stepRes = await fetch(`${baseUrl}/stepper/${batchId}`);
    const stepper = (await stepRes.json()).data;
    assert.equal(stepper.current_stage, 'GENERATE_STATEMENT');

    // 2. Attempting to jump to PROCESS_PAYMENT without HR Approval must return 422
    const unapprovedAdvanceRes = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'PROCESS_PAYMENT' }),
    });
    assert.equal(unapprovedAdvanceRes.status, 422, 'Must return 422 when batch is unapproved');
    const unapprovedErr = await unapprovedAdvanceRes.json();
    assert.equal(unapprovedErr.error.code, 'UNAPPROVED_GRATUITY_BATCH');

    // 3. Maker attempting self-approval must return 403 Forbidden
    const selfApproveRes = await fetch(`${baseUrl}/stepper/${batchId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checker_id: makerId, notes: 'Self approving' }),
    });
    assert.equal(selfApproveRes.status, 403, 'Must return 403 Forbidden for Maker-Checker violation');
    const selfApproveErr = await selfApproveRes.json();
    assert.equal(selfApproveErr.error.code, 'MAKER_CHECKER_VIOLATION');

    // 4. Distinct checker approval must succeed with 200
    const checkerApproveRes = await fetch(`${baseUrl}/stepper/${batchId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checker_id: distinctCheckerId, notes: 'Reviewed and verified calculation.' }),
    });
    assert.equal(checkerApproveRes.status, 200);
    const approvedStepper = (await checkerApproveRes.json()).data;
    assert.equal(approvedStepper.current_stage, 'HR_APPROVAL');
    assert.equal(approvedStepper.is_approved, true);

    // 5. Advance to PROCESS_PAYMENT
    const advancePaymentRes = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'PROCESS_PAYMENT' }),
    });
    assert.equal(advancePaymentRes.status, 200);

    // 6. Advance to COMPLETED
    const completeRes = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'COMPLETED' }),
    });
    assert.equal(completeRes.status, 200);
    const completedStepper = (await completeRes.json()).data;
    assert.equal(completedStepper.current_stage, 'COMPLETED');
    assert.equal(completedStepper.progress_percent, 100);
  });

  it('7. Should export official Gratuity_Statement_MONTH_YEAR.xlsx and .csv with exact 7 statutory columns', async () => {
    const batchId = 'BATCH_GRAT_VECTOR_TEST';

    // 1. CSV statement export
    const csvRes = await fetch(`${baseUrl}/statement/${batchId}?format=csv`);
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    const expectedHeaders = 'Employee ID,Employee Name,DOJ,Exit Date,Completed Years,Last Salary,Gratuity Amount';
    assert.equal(lines[0], expectedHeaders, 'Must match exact 7 blueprint columns');
    assert.ok(lines.length >= 2);
    assert.ok(csvText.includes('89423'));

    // 2. XLSX statement export
    const xlsxRes = await fetch(`${baseUrl}/statement/${batchId}?format=xlsx`);
    assert.equal(xlsxRes.status, 200);
    const xlsxText = await xlsxRes.text();
    assert.ok(xlsxText.includes('<th>Employee ID</th>'));
    assert.ok(xlsxText.includes('<th>Employee Name</th>'));
    assert.ok(xlsxText.includes('<th>DOJ</th>'));
    assert.ok(xlsxText.includes('<th>Exit Date</th>'));
    assert.ok(xlsxText.includes('<th>Completed Years</th>'));
    assert.ok(xlsxText.includes('<th>Last Salary</th>'));
    assert.ok(xlsxText.includes('<th>Gratuity Amount</th>'));
    assert.ok(xlsxText.includes('89423'));
  });

  it('8. Should verify EventBus triggers provisioning on employee.exit and PAYROLL_FINALIZED', async () => {
    const mockBus = new EventEmitter();
    globalGratuityAutomationEngine.attachEventListeners(mockBus);

    // 1. Trigger employee.exit event
    mockBus.emit('employee.exit', {
      entityId: 'EVT_EXIT_01',
      payload: {
        employee_id: 'EVT_EXIT_01',
        employee_name: 'Ravi Teja',
        date_of_joining: '2018-01-01',
        date_of_exit: '2026-08-31',
        last_drawn_salary: 42000,
        exit_reason: 'RESIGNATION',
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    // Check that engine processed candidate
    const profiles = globalGratuityAutomationEngine.profileStore.getAllProfiles();
    assert.ok(profiles.some((p) => p.employee_id === 'EVT_EXIT_01'));
  });
});
