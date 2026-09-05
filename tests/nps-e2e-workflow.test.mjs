/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CORPORATE NPS END-TO-END WORKFLOW TEST
 * ============================================================================
 * Validates Column 3 of the Visual Compliance Blueprint across the full HTTP & Event API:
 *  1. Profile Master:
 *     - Structure EmployeeNPSProfile (employee_id, pran [12-digit], nps_applicable,
 *       tier [Tier I / Tier II], date_of_joining, contribution_type [Employee / Employer / Both], exit_date)
 *     - Standard template download (.csv / .xls)
 *     - Bulk master upload ingestion (POST /upload-master)
 *  2. Automation Builder:
 *     - Trigger on monthly Payroll Finalized where nps_applicable === true
 *     - Fetch PRAN, subscriber tier, and contribution configuration
 *     - Centralized EventBus automatic listener integration
 *  3. Contribution Engine:
 *     - Compute employee share (10% of Basic + DA under Sec 80CCD(1))
 *     - Compute employer share (10% of Basic + DA under Sec 80CCD(2))
 *     - Handle Sec 80CCD(1B) additional tax benefits
 *     - Respect contribution_type ('Both', 'Employee', 'Employer')
 *  4. Validation & Exception Handling:
 *     - Enforce 12-digit PRAN format (/^[0-9]{12}$/)
 *     - If PRAN missing (NPS_PRAN_MISSING) or invalid format (NPS_PRAN_INVALID_FORMAT):
 *       log failure, trigger an HR task, send an alert, and block record export
 *     - Gatekeeping: Reject advance to FILE_GENERATED with HTTP 422 if unresolved defects exist
 *     - Inline defect resolution (POST /exceptions/:id/resolve) with updated PRAN
 *  5. NSDL Output & 7-Stage Visual Lifecycle Stepper:
 *     - Stepper progression:
 *       PAYROLL_FINALIZED -> NPS_CALCULATED -> VALIDATED -> FILE_GENERATED ->
 *       UPLOADED_TO_NSDL -> ACKNOWLEDGEMENT -> COMPLETED
 *     - Stage 6: Record NSDL PRN Acknowledgement receipt
 *     - File output: Compile official NPS_Contribution_MONTH_YEAR.txt
 *       Exact 5 columns: PRAN#Employee Name#Employee Amt#Employer Amt#Total Amount
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import express from 'express';
import npsRouter from '../routes/nps.mjs';
import { globalCorporateNpsAutomationEngine } from '../services/corporate-nps-automation-engine.mjs';

describe('🏛️ Column 3 Corporate NPS Automation Service - End-to-End Suite', () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/nps', npsRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/nps`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. Should download standard Employee NPS Master template (.csv and .xls)', async () => {
    // 1.1 CSV Template
    const resCsv = await fetch(`${baseUrl}/template?format=csv`);
    assert.equal(resCsv.status, 200);
    const csvText = await resCsv.text();
    assert.ok(csvText.includes('employee_id,employee_name,pran,nps_applicable,tier,date_of_joining,contribution_type'));
    assert.ok(csvText.includes('voluntary_monthly_amount'));

    // 1.2 Excel XML Template
    const resXls = await fetch(`${baseUrl}/template?format=xlsx`);
    assert.equal(resXls.status, 200);
    const xlsText = await resXls.text();
    assert.ok(xlsText.includes('Worksheet ss:Name="NPS_Master"'));
    assert.ok(xlsText.includes('110012345678'));
  });

  it('2. Should model EmployeeNPSProfile with 12-digit PRAN, tier, contribution type and bulk upload', async () => {
    // 2.1 Single profile creation
    const profileRes = await fetch(`${baseUrl}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: 'NPS_E2E_001',
        employee_name: 'Aditi Rao',
        pran: '110011223344',
        nps_applicable: true,
        tier: 'Tier I',
        contribution_type: 'Both',
        date_of_joining: '2020-04-01',
        voluntary_monthly_amount: 2500, // Sec 80CCD(1B)
      }),
    });
    assert.equal(profileRes.status, 200);
    const profileData = await profileRes.json();
    assert.equal(profileData.data.employee_id, 'NPS_E2E_001');
    assert.equal(profileData.data.pran, '110011223344');
    assert.equal(profileData.data.tier, 'Tier I');
    assert.equal(profileData.data.contribution_type, 'Both');
    assert.equal(profileData.data.voluntary_monthly_amount, 2500);

    // 2.2 Bulk master ingestion
    const bulkRes = await fetch(`${baseUrl}/upload-master`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [
          {
            employee_id: 'NPS_E2E_002',
            employee_name: 'Bhavesh Joshi',
            pran: '110099887766',
            nps_applicable: true,
            tier: 'Tier II',
            contribution_type: 'Employee',
            date_of_joining: '2021-08-15',
          },
          {
            employee_id: 'NPS_E2E_003',
            employee_name: 'Chandresh Shah',
            pran: '110055443322',
            nps_applicable: true,
            tier: 'Tier I',
            contribution_type: 'Employer',
            date_of_joining: '2022-01-10',
          },
        ],
      }),
    });
    assert.equal(bulkRes.status, 200);
    const bulkData = await bulkRes.json();
    assert.equal(bulkData.count, 2);

    // 2.3 Query all profiles
    const listRes = await fetch(`${baseUrl}/profiles`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.data.profiles.some((p) => p.employee_id === 'NPS_E2E_001'));
    assert.ok(listData.data.profiles.some((p) => p.employee_id === 'NPS_E2E_002'));
    assert.ok(listData.data.profiles.some((p) => p.employee_id === 'NPS_E2E_003'));
  });

  it('3. Contribution Engine: Should calculate 10% EE, 10% ER under Sec 80CCD(2), and Sec 80CCD(1B) additional tax benefits', async () => {
    const batchId = `NPS_CALC_TEST_${Date.now()}`;
    const triggerRes = await fetch(`${baseUrl}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: batchId,
        period: '2026-09',
        payroll_records: [
          // Aditi: Both EE & ER, Basic+DA = ₹60,000, Voluntary = ₹2,500
          // EE Share: 10% of 60k (= 6,000) + 2,500 = ₹8,500
          // ER Share: 10% of 60k under Sec 80CCD(2) = ₹6,000
          // Total: ₹14,500
          {
            employee_id: 'NPS_E2E_001',
            basic: 50000,
            da: 10000,
          },
          // Bhavesh: Employee only, Basic+DA = ₹40,000
          // EE Share: 10% of 40k = ₹4,000
          // ER Share: 0
          // Total: ₹4,000
          {
            employee_id: 'NPS_E2E_002',
            basic_da: 40000,
          },
          // Chandresh: Employer only, Basic+DA = ₹80,000
          // EE Share: 0
          // ER Share: 10% of 80k under Sec 80CCD(2) = ₹8,000
          // Total: ₹8,000
          {
            employee_id: 'NPS_E2E_003',
            basic_da: 80000,
          },
        ],
      }),
    });

    assert.equal(triggerRes.status, 200);
    const triggerData = await triggerRes.json();
    const result = triggerData.data;

    assert.equal(result.compliant_subscribers.length, 3);
    assert.equal(result.validation_issues.length, 0);

    const s1 = result.compliant_subscribers.find((s) => s.employee_id === 'NPS_E2E_001');
    assert.equal(s1.salary_basis, 60000);
    assert.equal(s1.mandatory_employee_amt, 6000);
    assert.equal(s1.voluntary_80ccd1b_amt, 2500);
    assert.equal(s1.employee_amt, 8500);
    assert.equal(s1.employer_amt, 6000);
    assert.equal(s1.total_amount, 14500);

    const s2 = result.compliant_subscribers.find((s) => s.employee_id === 'NPS_E2E_002');
    assert.equal(s2.employee_amt, 4000);
    assert.equal(s2.employer_amt, 0);
    assert.equal(s2.total_amount, 4000);

    const s3 = result.compliant_subscribers.find((s) => s.employee_id === 'NPS_E2E_003');
    assert.equal(s3.employee_amt, 0);
    assert.equal(s3.employer_amt, 8000);
    assert.equal(s3.total_amount, 8000);

    assert.equal(result.summary.total_employee_amount, 8500 + 4000 + 0);
    assert.equal(result.summary.total_employer_amount, 6000 + 0 + 8000);
    assert.equal(result.summary.total_contribution_amount, 14500 + 4000 + 8000);
  });

  it('4. Validation & Exception Handling: Should detect missing PRAN & malformed PRAN, trigger HR tasks/alerts, and block export', async () => {
    // Setup defective profiles
    globalCorporateNpsAutomationEngine.profileStore.upsertProfile({
      employee_id: 'NPS_DEFECT_MISSING',
      employee_name: 'Deepak Missing',
      pran: '', // Missing PRAN
      nps_applicable: true,
    });
    globalCorporateNpsAutomationEngine.profileStore.upsertProfile({
      employee_id: 'NPS_DEFECT_MALFORMED',
      employee_name: 'Gita Malformed',
      pran: '12345ABC', // Not 12 digits
      nps_applicable: true,
    });

    const batchId = `NPS_DEFECT_BATCH_${Date.now()}`;
    const triggerRes = await fetch(`${baseUrl}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: batchId,
        period: '2026-09',
        payroll_records: [
          { employee_id: 'NPS_DEFECT_MISSING', basic: 35000 },
          { employee_id: 'NPS_DEFECT_MALFORMED', basic: 45000 },
        ],
      }),
    });

    assert.equal(triggerRes.status, 200);
    const triggerData = await triggerRes.json();
    assert.equal(triggerData.data.validation_issues.length, 2);
    assert.equal(triggerData.data.is_blocked, true);

    // 4.1 Query Exceptions
    const excRes = await fetch(`${baseUrl}/exceptions?batch_id=${batchId}`);
    assert.equal(excRes.status, 200);
    const excData = await excRes.json();
    assert.equal(excData.data.total_count, 2);
    const missingIssue = excData.data.issues.find((i) => i.code === 'NPS_PRAN_MISSING');
    const malformedIssue = excData.data.issues.find((i) => i.code === 'NPS_PRAN_INVALID_FORMAT');
    assert.ok(missingIssue);
    assert.ok(malformedIssue);

    // 4.2 Query HR Tasks
    const tasksRes = await fetch(`${baseUrl}/tasks?batch_id=${batchId}`);
    assert.equal(tasksRes.status, 200);
    const tasksData = await tasksRes.json();
    assert.equal(tasksData.data.total_count, 2);
    assert.ok(tasksData.data.tasks.some((t) => t.task_type === 'NPS_EXCEPTION_REMEDIATION'));

    // 4.3 Query Compliance Alerts
    const alertsRes = await fetch(`${baseUrl}/alerts?batch_id=${batchId}`);
    assert.equal(alertsRes.status, 200);
    const alertsData = await alertsRes.json();
    assert.equal(alertsData.data.total_count, 2);
    assert.ok(alertsData.data.alerts.some((a) => a.severity === 'CRITICAL'));

    // 4.4 Gatekeeper: Attempting to advance to FILE_GENERATED must be rejected with 422
    await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'VALIDATED' }),
    });

    const blockedAdvanceRes = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'FILE_GENERATED' }),
    });
    assert.equal(blockedAdvanceRes.status, 422);
    const blockedData = await blockedAdvanceRes.json();
    assert.equal(blockedData.error.code, 'NPS_BLOCKING_DEFECTS');
    assert.equal(blockedData.error.unresolved_count, 2);

    // 4.5 Inline Remediation: Resolve both defects with valid 12-digit PRANs
    const resolve1 = await fetch(`${baseUrl}/exceptions/${missingIssue.issue_id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corrected_pran: '110099991111',
        resolved_by: 'compliance-officer',
      }),
    });
    assert.equal(resolve1.status, 200);

    const resolve2 = await fetch(`${baseUrl}/exceptions/${malformedIssue.issue_id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corrected_pran: '110099992222',
        resolved_by: 'compliance-officer',
      }),
    });
    assert.equal(resolve2.status, 200);

    // 4.6 Verify issues are now resolved and stepper unblocked
    const excAfter = await fetch(`${baseUrl}/exceptions?batch_id=${batchId}`);
    const excAfterData = await excAfter.json();
    assert.equal(excAfterData.data.unresolved_count, 0);

    const stepperAfter = await fetch(`${baseUrl}/stepper/${batchId}`);
    const stepperData = await stepperAfter.json();
    assert.equal(stepperData.data.is_blocked, false);
    assert.equal(stepperData.data.unresolved_blocking_defects_count, 0);
  });

  it('5. 7-Stage Visual Lifecycle, NSDL PRN Acknowledgement & Official File Output (NPS_Contribution_MONTH_YEAR.txt)', async () => {
    const batchId = `NPS_LIFECYCLE_BATCH_${Date.now()}`;

    // Step 1: Payroll Finalized -> NPS Calculated
    await fetch(`${baseUrl}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: batchId,
        period: '2026-09',
        payroll_records: [
          { employee_id: 'NPS_E2E_001', basic: 50000, da: 10000 },
          { employee_id: 'NPS_E2E_002', basic_da: 40000 },
        ],
      }),
    });

    let sRes = await fetch(`${baseUrl}/stepper/${batchId}`);
    let sData = await sRes.json();
    assert.equal(sData.data.current_stage, 'NPS_CALCULATED');

    // Step 2: Advance to VALIDATED
    await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'VALIDATED' }),
    });

    // Step 3: Advance to FILE_GENERATED
    await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'FILE_GENERATED' }),
    });

    // Verify official NSDL file output (format: PRAN#Employee Name#Employee Amt#Employer Amt#Total Amount)
    const exportRes = await fetch(`${baseUrl}/export/${batchId}?format=txt`);
    assert.equal(exportRes.status, 200);
    const fileContent = await exportRes.text();

    const lines = fileContent.split('\n');
    assert.equal(lines[0], 'PRAN#Employee Name#Employee Amt#Employer Amt#Total Amount');
    assert.ok(lines.some((l) => l.startsWith('110011223344#Aditi Rao#8500.00#6000.00#14500.00')));
    assert.ok(lines.some((l) => l.startsWith('110099887766#Bhavesh Joshi#4000.00#0.00#4000.00')));

    // Step 4: Advance to UPLOADED_TO_NSDL
    await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'UPLOADED_TO_NSDL' }),
    });

    // Step 5: Record Acknowledgement with PRN
    const ackRes = await fetch(`${baseUrl}/stepper/${batchId}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prn: 'PRN_NSDL_2026_987654321',
        recorded_by: 'finance-desk@kylrx.ai',
        notes: 'Confirmed processed by NSDL CRA portal',
      }),
    });
    assert.equal(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.equal(ackData.data.current_stage, 'ACKNOWLEDGEMENT');
    assert.equal(ackData.data.prn_acknowledgement_token, 'PRN_NSDL_2026_987654321');

    // Step 6: Advance to COMPLETED
    const compRes = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'COMPLETED' }),
    });
    assert.equal(compRes.status, 200);
    const compData = await compRes.json();
    assert.equal(compData.data.current_stage, 'COMPLETED');
    assert.equal(compData.data.progress_percent, 100);
  });

  it('6. Centralized EventBus: Should trigger NPS automation on PAYROLL_FINALIZED event', async () => {
    const mockBus = new EventEmitter();
    globalCorporateNpsAutomationEngine.attachPayrollFinalizedListener(mockBus);

    const busBatchId = `NPS_BUS_BATCH_${Date.now()}`;
    mockBus.emit('PAYROLL_FINALIZED', {
      batch_id: busBatchId,
      run_id: 'RUN_BUS_001',
      period: '2026-09',
      employees: [
        { employee_id: 'NPS_E2E_001', basic: 70000, da: 10000 },
      ],
    });

    // Give event loop tick to process async listener
    await new Promise((resolve) => setTimeout(resolve, 50));

    const sRes = await fetch(`${baseUrl}/stepper/${busBatchId}`);
    assert.equal(sRes.status, 200);
    const sData = await sRes.json();
    assert.equal(sData.data.current_stage, 'NPS_CALCULATED');
    assert.ok(sData.data.history.some((h) => h.notes.includes('RUN_BUS_001')));
  });
});
