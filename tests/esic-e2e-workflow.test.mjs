/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC AUTOMATION END-TO-END INTEGRATION TEST
 * ============================================================================
 * Validates Column 1 of the visual compliance blueprint across the full HTTP & Event API:
 *  1. Profile Master & Bulk Upload (Excel / CSV ingestion, template download)
 *  2. Automation Trigger & Calculations (Wage limits ₹21,000 / ₹25,000, 0.75% / 3.25%)
 *  3. Exception Handling (EMP004, EMP005, EMP006, EMP007, HR Tasks, HR Alerts)
 *  4. 7-Stage Visual Compliance Stepper & Gatekeeper (Rejection at 422 if unresolved)
 *  5. Exception Resolution & Stepper Completion
 *  6. Official File Outputs (ESIC_CONTRIBUTION_MONTH_YEAR.txt / .xls with 7 statutory columns)
 *  7. EventBus PAYROLL_FINALIZED automated listener
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import esicRouter from '../routes/esic.mjs';
import { globalEsicAutomationEngine } from '../services/esic-automation-engine.mjs';

describe('Column 1 ESIC Visual Compliance Automation - End-to-End Suite', () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/esic', esicRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/esic`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. Should download standard ESIC Employee Master template', async () => {
    const res = await fetch(`${baseUrl}/template?format=csv`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('employee_id,employee_name,esic_number,esic_applicable'));
    assert.ok(text.includes('disability_percentage'));
    assert.ok(text.includes('is_grandfathered'));
  });

  it('2. Should ingest ESIC_Employee_Master data and detect master-level exceptions', async () => {
    const masterCsv = [
      'employee_id,employee_name,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_percentage,is_grandfathered',
      'EMP101,Aarav Sharma,3112345678,true,2024-01-01,,0,false',
      'EMP102,Priya Patel,3198765432,true,2024-02-15,,45,false', // Disabled >= 40%
      'EMP103,Rohan Verma,3155554444,true,2023-11-01,,0,false',
      'EMP104,Neha Gupta,,true,2024-03-01,,0,false', // EMP004: Missing ESIC number
      'EMP105,Vikram Singh,999,true,2024-04-01,,0,false', // EMP006: Malformed (not 10 digits)
    ].join('\n');

    const res = await fetch(`${baseUrl}/upload-master`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: masterCsv,
        file_name: 'ESIC_Employee_Master.xlsx',
        batch_id: 'BATCH_TEST_INGEST_001',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.valid_rows_count, 3);
    assert.equal(data.exception_rows_count, 2);

    const codes = data.exceptions.map((e) => e.code);
    assert.ok(codes.includes('EMP004'), 'Must record EMP004 for missing ESIC number');
    assert.ok(codes.includes('EMP006'), 'Must record EMP006 for malformed ESIC number');
  });

  it('3. Should calculate monthly ESIC batch upon Payroll Finalized trigger with statutory limits', async () => {
    const payrollPayload = {
      batch_id: 'BATCH_ESIC_2026_09_001',
      run_id: 'RUN_2026_09',
      period: '2026-09',
      employer_code: '31000123450000999',
      payroll_records: [
        {
          employee_id: 'EMP101',
          employee_name: 'Aarav Sharma',
          esic_number: '3112345678',
          esic_applicable: true,
          gross_salary: 18000,
          days_worked: 30,
          disability_percentage: 0,
        },
        {
          employee_id: 'EMP102',
          employee_name: 'Priya Patel',
          esic_number: '3198765432',
          esic_applicable: true,
          gross_salary: 24000, // Above ₹21k, but qualified under ₹25k disabled limit
          days_worked: 30,
          disability_percentage: 45,
          disability_flag: true,
        },
        {
          employee_id: 'EMP103',
          employee_name: 'Rohan Verma',
          esic_number: '3155554444',
          esic_applicable: true,
          gross_salary: 22500, // Above ₹21k, standard employee -> EMP005 Exception!
          days_worked: 30,
          disability_percentage: 0,
        },
        {
          employee_id: 'EMP104',
          employee_name: 'Neha Gupta',
          esic_number: '', // Missing -> EMP004
          esic_applicable: true,
          gross_salary: 15000,
          days_worked: 26,
        },
        {
          employee_id: 'EMP105',
          employee_name: 'Vikram Singh',
          esic_number: '12345', // Malformed -> EMP006
          esic_applicable: true,
          gross_salary: 16000,
          days_worked: 28,
        },
        {
          employee_id: 'EMP106',
          employee_name: 'Karan Mehra',
          esic_number: '3112345678', // Duplicate of EMP101 -> EMP007
          esic_applicable: true,
          gross_salary: 17000,
          days_worked: 30,
        },
      ],
    };

    const res = await fetch(`${baseUrl}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payrollPayload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    const calc = data.calculation;
    // Compliant: EMP101 (₹18k standard) and EMP102 (₹24k disabled <= ₹25k)
    assert.equal(calc.compliant_records.length, 2);

    // Verify statutory rounding & calculations:
    // EMP101: 18000 * 0.0075 = 135, 18000 * 0.0325 = 585
    const r1 = calc.compliant_records.find((r) => r.employee_id === 'EMP101');
    assert.equal(r1.employee_share, 135);
    assert.equal(r1.employer_share, 585);

    // EMP102: 24000 * 0.0075 = 180, 24000 * 0.0325 = 780
    const r2 = calc.compliant_records.find((r) => r.employee_id === 'EMP102');
    assert.equal(r2.employee_share, 180);
    assert.equal(r2.employer_share, 780);

    // Exceptions generated: EMP005 (EMP103), EMP004 (EMP104), EMP006 (EMP105), EMP007 (EMP106)
    assert.equal(calc.exceptions.length, 4);
    const exceptionCodes = calc.exceptions.map((e) => e.code);
    assert.ok(exceptionCodes.includes('EMP004'));
    assert.ok(exceptionCodes.includes('EMP005'));
    assert.ok(exceptionCodes.includes('EMP006'));
    assert.ok(exceptionCodes.includes('EMP007'));

    // Stepper must be blocked at stage ESIC_CALCULATED
    const stepper = data.stepper;
    assert.equal(stepper.current_stage, 'ESIC_CALCULATED');
    assert.equal(stepper.is_blocked, true);
    assert.equal(stepper.unresolved_blocking_exceptions_count, 4);
  });

  it('4. Gatekeeper: Should reject advancing stepper to VALIDATED when unresolved blocking exceptions exist', async () => {
    const batchId = 'BATCH_ESIC_2026_09_001';

    const res = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'VALIDATED' }),
    });

    assert.equal(res.status, 422, 'Must return 422 Unprocessable Entity when blocked');
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.code, 'UNRESOLVED_ESIC_EXCEPTIONS');
    assert.equal(data.unresolved_count, 4);
  });

  it('5. Should resolve all exceptions, update HR Tasks, and allow stepper to advance through all 7 stages', async () => {
    const batchId = 'BATCH_ESIC_2026_09_001';

    // Fetch exceptions
    const excRes = await fetch(`${baseUrl}/exceptions?batch_id=${batchId}&unresolved_only=true`);
    const excData = await excRes.json();
    assert.equal(excData.count, 4);

    // Resolve each exception
    for (const exc of excData.exceptions) {
      const resolveRes = await fetch(`${baseUrl}/exceptions/${exc.exception_id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolved_by: 'lead_hr_compliance',
          fix_applied: `Corrected ${exc.field} statutory value.`,
          new_esic_number: exc.code === 'EMP004' || exc.code === 'EMP006' ? '3188889999' : undefined,
        }),
      });
      assert.equal(resolveRes.status, 200);
    }

    // Check stepper is now unblocked
    const stepperRes = await fetch(`${baseUrl}/stepper/${batchId}`);
    const stepperData = await stepperRes.json();
    assert.equal(stepperData.stepper.is_blocked, false);
    assert.equal(stepperData.stepper.unresolved_blocking_exceptions_count, 0);

    // Advance: VALIDATED
    const a1 = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'VALIDATED' }),
    });
    assert.equal(a1.status, 200);

    // Advance: FILE_GENERATED
    const a2 = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'FILE_GENERATED' }),
    });
    assert.equal(a2.status, 200);

    // Advance: PORTAL_UPLOADED
    const a3 = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'PORTAL_UPLOADED' }),
    });
    assert.equal(a3.status, 200);

    // Advance: PAYMENT_DONE
    const a4 = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'PAYMENT_DONE' }),
    });
    assert.equal(a4.status, 200);

    // Advance: COMPLETED
    const a5 = await fetch(`${baseUrl}/stepper/${batchId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_stage: 'COMPLETED' }),
    });
    assert.equal(a5.status, 200);
    const completedStepper = await a5.json();
    assert.equal(completedStepper.stepper.current_stage, 'COMPLETED');
    assert.equal(completedStepper.stepper.progress_percent, 100);
  });

  it('6. Should export official ESIC_CONTRIBUTION_MONTH_YEAR.txt and .xls with exact 7 statutory columns', async () => {
    const batchId = 'BATCH_ESIC_2026_09_001';

    // 1. Delimited Text File (.txt)
    const txtRes = await fetch(`${baseUrl}/export/${batchId}?format=txt`);
    assert.equal(txtRes.status, 200);
    const txtContent = await txtRes.text();
    const lines = txtContent.split(/\r?\n/).filter(Boolean);
    const expectedHeaders = 'ESIC No#Employee Name#IP No#No. of Days#Total Wages#Employee Share#Employer Share';
    assert.equal(lines[0], expectedHeaders, 'Header must match exact 7 columns');
    assert.ok(lines.length >= 3, 'Must contain header and data rows');

    // 2. Excel Workbook (.xls)
    const xlsRes = await fetch(`${baseUrl}/export/${batchId}?format=xls`);
    assert.equal(xlsRes.status, 200);
    const xlsContent = await xlsRes.text();
    assert.ok(xlsContent.includes('<th>ESIC No</th>'));
    assert.ok(xlsContent.includes('<th>Employee Name</th>'));
    assert.ok(xlsContent.includes('<th>IP No</th>'));
    assert.ok(xlsContent.includes('<th>No. of Days</th>'));
    assert.ok(xlsContent.includes('<th>Total Wages</th>'));
    assert.ok(xlsContent.includes('<th>Employee Share</th>'));
    assert.ok(xlsContent.includes('<th>Employer Share</th>'));
    assert.ok(xlsContent.includes('3112345678')); // IP No
  });

  it('7. Should verify EventBus PAYROLL_FINALIZED triggers automated calculation', async () => {
    const mockEventBus = new (await import('events')).EventEmitter();
    globalEsicAutomationEngine.attachPayrollFinalizedListener(mockEventBus);

    const eventPayload = {
      batch_id: 'BATCH_EVENT_BUS_001',
      run_id: 'RUN_EVT_001',
      period: '2026-09',
      payroll_records: [
        {
          employee_id: 'EMP_EVT_01',
          employee_name: 'Suresh Raina',
          esic_number: '3177778888',
          esic_applicable: true,
          gross_salary: 19000,
          days_worked: 30,
        },
      ],
    };

    mockEventBus.emit('PAYROLL_FINALIZED', { payload: eventPayload });

    // Wait microtask
    await new Promise((r) => setTimeout(r, 100));

    const stepper = globalEsicAutomationEngine.getStepperState('BATCH_EVENT_BUS_001');
    assert.ok(stepper, 'Stepper state must be initialized');
    assert.equal(stepper.current_stage, 'VALIDATED', 'Zero exceptions must automatically advance to VALIDATED');
  });
});
