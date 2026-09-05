/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC AUTOMATION ENGINE TEST SUITE
 * ============================================================================
 * Validates Column 1 of the visual compliance blueprint across all 5 pillars:
 *
 * 1. Profile Master & Bulk Upload (Excel ingestion of ESIC_Employee_Master.xlsx)
 * 2. Automation Builder (Monthly Payroll Finalized trigger & condition evaluation)
 * 3. Calculation & Validation (0.75% EE, 3.25% ER, 10-digit format, duplicate detection)
 * 4. Exceptions & Alerts (EMP004, EMP005, EMP006, ESIC_Exceptions table, HRTask, HRAlert)
 * 5. File Output & 7-Stage Visual Compliance Stepper (Official txt/xls export & FSM)
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
  EsicAutomationEngine,
  EmployeeEsicProfileStore,
  ESIC_STEPPER_STAGES,
  ESIC_STANDARD_WAGE_LIMIT,
  ESIC_DISABLED_WAGE_LIMIT,
  globalEsicAutomationEngine,
} from './esic-automation-engine.mjs';

import { createPayrollDisbursementApiRouter } from './payroll-disbursement-api.mjs';

describe('🏛️ ESIC AUTOMATION ENGINE & VISUAL COMPLIANCE STEPPER (COLUMN 1 BLUEPRINT)', () => {
  let engine;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = new EventEmitter();
    engine = new EsicAutomationEngine({ eventBus: mockEventBus });
  });

  // ==========================================================================
  // PILLAR 1: PROFILE MASTER & BULK UPLOAD
  // ==========================================================================
  describe('1. Profile Master & Bulk Upload (ESIC_Employee_Master.xlsx)', () => {
    it('1.1 Should store and retrieve EmployeeESICProfile with disability_percentage', () => {
      const profile = engine.profileStore.upsertProfile({
        employee_id: 'EMP_101',
        employee_name: 'Aditi Sharma',
        esic_number: '3101234567',
        esic_applicable: true,
        date_of_joining: '2023-04-01',
        date_of_exit: null,
        disability_percentage: 45,
      });

      assert.strictEqual(profile.employee_id, 'EMP_101');
      assert.strictEqual(profile.esic_number, '3101234567');
      assert.strictEqual(profile.esic_applicable, true);
      assert.strictEqual(profile.disability_percentage, 45);
      assert.strictEqual(profile.disability_flag, true, 'Disability >= 40% must set disability_flag to true');

      const retrieved = engine.profileStore.getProfile('EMP_101');
      assert.strictEqual(retrieved.employee_id, 'EMP_101');
    });

    it('1.2 Should ingest master data from XML Spreadsheet 2003 Excel format', () => {
      const xmlExcelContent = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Master">
    <Table>
      <Row>
        <Cell><Data ss:Type="String">employee_id</Data></Cell>
        <Cell><Data ss:Type="String">employee_name</Data></Cell>
        <Cell><Data ss:Type="String">esic_number</Data></Cell>
        <Cell><Data ss:Type="String">esic_applicable</Data></Cell>
        <Cell><Data ss:Type="String">date_of_joining</Data></Cell>
        <Cell><Data ss:Type="String">disability_percentage</Data></Cell>
        <Cell><Data ss:Type="String">date_of_exit</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">EMP_EXCEL_01</Data></Cell>
        <Cell><Data ss:Type="String">Rohan Verma</Data></Cell>
        <Cell><Data ss:Type="String">1100123456</Data></Cell>
        <Cell><Data ss:Type="String">true</Data></Cell>
        <Cell><Data ss:Type="String">2022-01-15</Data></Cell>
        <Cell><Data ss:Type="String">0</Data></Cell>
        <Cell><Data ss:Type="String"></Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">EMP_EXCEL_02</Data></Cell>
        <Cell><Data ss:Type="String">Sneha Patel</Data></Cell>
        <Cell><Data ss:Type="String">1100123457</Data></Cell>
        <Cell><Data ss:Type="String">true</Data></Cell>
        <Cell><Data ss:Type="String">2023-06-01</Data></Cell>
        <Cell><Data ss:Type="String">50</Data></Cell>
        <Cell><Data ss:Type="String"></Data></Cell>
      </Row>
    </Table>
  </Worksheet>
</Workbook>`;

      const result = engine.profileStore.ingestExcelMaster(xmlExcelContent, {
        file_name: 'ESIC_Employee_Master.xlsx',
      });

      assert.strictEqual(result.total_rows, 2);
      assert.strictEqual(result.valid_rows_count, 2);
      assert.strictEqual(result.exception_rows_count, 0);

      const p1 = engine.profileStore.getProfile('EMP_EXCEL_01');
      assert.ok(p1);
      assert.strictEqual(p1.esic_number, '1100123456');
      assert.strictEqual(p1.disability_flag, false);

      const p2 = engine.profileStore.getProfile('EMP_EXCEL_02');
      assert.ok(p2);
      assert.strictEqual(p2.disability_percentage, 50);
      assert.strictEqual(p2.disability_flag, true);
    });

    it('1.3 Should detect validation errors during bulk upload (EMP004, EMP006, EMP007)', () => {
      const csvContent = `employee_id,employee_name,esic_number,esic_applicable,date_of_joining,disability_percentage,date_of_exit
EMP_ERR_01,No Number Emp,,true,2024-01-01,0,
EMP_ERR_02,Malformed Emp,12345,true,2024-01-01,0,
EMP_ERR_03,Valid Emp 1,9900112233,true,2024-01-01,0,
EMP_ERR_04,Duplicate Emp,9900112233,true,2024-01-01,0,`;

      const result = engine.profileStore.ingestExcelMaster(csvContent);

      assert.strictEqual(result.total_rows, 4);
      assert.strictEqual(result.valid_rows_count, 1, 'Only Valid Emp 1 should pass');
      assert.strictEqual(result.exception_rows_count, 3);

      const codes = result.exceptions.map((e) => e.code);
      assert.ok(codes.includes('EMP004'), 'Missing ESIC number triggers EMP004');
      assert.ok(codes.includes('EMP006'), 'Short ESIC number triggers EMP006');
      assert.ok(codes.includes('EMP007'), 'Duplicate ESIC number in batch triggers EMP007');
    });
  });

  // ==========================================================================
  // PILLAR 2: AUTOMATION BUILDER
  // ==========================================================================
  describe('2. Automation Builder (Monthly Payroll Finalized Trigger)', () => {
    it('2.1 Should automatically listen to PAYROLL_FINALIZED trigger on EventBus', async () => {
      // Pre-seed employee profile in store
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_AUTO_01',
        employee_name: 'Aarav Gupta',
        esic_number: '2001122334',
        esic_applicable: true,
        date_of_joining: '2023-01-01',
      });

      const eventPayload = {
        run_id: 'RUN_2026_09_CORE',
        period: '2026-09',
        batch_id: 'BATCH_ESIC_AUTO_01',
        employer_code: '31000998870000123',
        payroll_records: [
          {
            employee_id: 'EMP_AUTO_01',
            gross_salary: 18000,
            days_worked: 30,
          },
        ],
      };

      // Emit event on bus
      mockEventBus.emit('PAYROLL_FINALIZED', { payload: eventPayload });

      // Give event loop a microtick
      await new Promise((r) => setImmediate(r));

      const stepper = engine.getStepperState('BATCH_ESIC_AUTO_01');
      assert.ok(stepper, 'Stepper must be initialized automatically upon event');
      assert.strictEqual(stepper.current_stage, 'VALIDATED', 'Clean record should automatically reach VALIDATED');

      const calcResult = engine.calculationResults.get('BATCH_ESIC_AUTO_01');
      assert.ok(calcResult);
      assert.strictEqual(calcResult.summary.total_compliant_records, 1);
      assert.strictEqual(calcResult.summary.total_wages, 18000);
      assert.strictEqual(calcResult.summary.total_employee_share, 135); // 18000 * 0.0075 = 135
      assert.strictEqual(calcResult.summary.total_employer_share, 585); // 18000 * 0.0325 = 585
    });

    it('2.2 Should evaluate conditions: esic_applicable === true AND gross_salary <= wage_limit', () => {
      engine.profileStore.upsertProfile({
        employee_id: 'EMP_COND_01',
        employee_name: 'Standard Wage Emp',
        esic_number: '3100112233',
        esic_applicable: true,
        disability_percentage: 0,
      });

      engine.profileStore.upsertProfile({
        employee_id: 'EMP_COND_02',
        employee_name: 'Disabled PwD Emp',
        esic_number: '3100112234',
        esic_applicable: true,
        disability_percentage: 45, // qualifies for ₹25,000 threshold
      });

      engine.profileStore.upsertProfile({
        employee_id: 'EMP_COND_03',
        employee_name: 'Exempt Non-ESIC Emp',
        esic_number: '',
        esic_applicable: false, // Non-applicable
      });

      const records = [
        { employee_id: 'EMP_COND_01', gross_salary: 20500 }, // Under 21k -> Compliant
        { employee_id: 'EMP_COND_02', gross_salary: 24000 }, // Under 25k PwD -> Compliant
        { employee_id: 'EMP_COND_03', gross_salary: 15000 }, // Exempt -> Skipped
      ];

      const result = engine.calculateEsicBatch({
        batch_id: 'BATCH_COND_TEST',
        run_id: 'RUN_COND',
        period: '2026-09',
        payroll_records: records,
      });

      assert.strictEqual(result.summary.total_compliant_records, 2);
      assert.strictEqual(result.summary.total_exceptions, 0);
      assert.strictEqual(result.non_applicable_records.length, 1);
      assert.strictEqual(result.non_applicable_records[0].employee_id, 'EMP_COND_03');
    });
  });

  // ==========================================================================
  // PILLAR 3: CALCULATION & VALIDATION
  // ==========================================================================
  describe('3. Calculation & Validation (0.75% EE, 3.25% ER, Limits & Duplicates)', () => {
    it('3.1 Should accurately compute employee share (0.75%) and employer share (3.25%) with rounding', () => {
      const records = [
        {
          employee_id: 'EMP_CALC_01',
          employee_name: 'Vikram Seth',
          esic_number: '5500112233',
          esic_applicable: true,
          gross_salary: 15750, // 0.75% = 118.125 -> 118; 3.25% = 511.875 -> 512
          days_worked: 31,
        },
      ];

      const result = engine.calculateEsicBatch({
        batch_id: 'BATCH_CALC_01',
        run_id: 'RUN_CALC_01',
        payroll_records: records,
      });

      assert.strictEqual(result.summary.total_compliant_records, 1);
      const rec = result.compliant_records[0];
      assert.strictEqual(rec.employee_share, 118);
      assert.strictEqual(rec.employer_share, 512);
      assert.strictEqual(rec.total_contribution, 630);
      assert.strictEqual(result.summary.total_challan_amount, 630);
    });

    it('3.2 Should validate against 10-digit format and flag EMP006 if invalid', () => {
      const records = [
        {
          employee_id: 'EMP_INVALID_IP',
          employee_name: 'Invalid IP Person',
          esic_number: '12345ABCDE', // Not 10 digits
          esic_applicable: true,
          gross_salary: 15000,
        },
      ];

      const result = engine.calculateEsicBatch({
        batch_id: 'BATCH_INVALID_IP',
        run_id: 'RUN_INVALID_IP',
        payroll_records: records,
      });

      assert.strictEqual(result.summary.total_compliant_records, 0);
      assert.strictEqual(result.summary.total_exceptions, 1);
      assert.strictEqual(result.exceptions[0].code, 'EMP006');
      assert.strictEqual(result.exceptions[0].error_label, 'Invalid ESIC Number');
    });

    it('3.3 Should validate against duplicate ESIC numbers across batch records and flag EMP007', () => {
      const records = [
        {
          employee_id: 'EMP_DUP_A',
          employee_name: 'First IP Holder',
          esic_number: '7788990011',
          esic_applicable: true,
          gross_salary: 18000,
        },
        {
          employee_id: 'EMP_DUP_B',
          employee_name: 'Second IP Holder (Duplicate)',
          esic_number: '7788990011',
          esic_applicable: true,
          gross_salary: 18000,
        },
      ];

      const result = engine.calculateEsicBatch({
        batch_id: 'BATCH_DUP_TEST',
        run_id: 'RUN_DUP',
        payroll_records: records,
      });

      assert.strictEqual(result.summary.total_compliant_records, 1, 'First holder is compliant');
      assert.strictEqual(result.summary.total_exceptions, 1, 'Second holder flagged as duplicate');
      assert.strictEqual(result.exceptions[0].code, 'EMP007');
      assert.strictEqual(result.exceptions[0].employee_id, 'EMP_DUP_B');
    });
  });

  // ==========================================================================
  // PILLAR 4: EXCEPTIONS & ALERTS
  // ==========================================================================
  describe('4. Exceptions & Alerts (EMP004, EMP005, EMP006, ESIC_Exceptions, HR Tasks & Alerts)', () => {
    it('4.1 Should route EMP004 (Missing), EMP005 (Salary Exceeds), and EMP006 to ESIC_Exceptions', () => {
      const records = [
        {
          employee_id: 'EMP_004_TEST',
          employee_name: 'Missing Number',
          esic_number: '',
          esic_applicable: true,
          gross_salary: 15000,
        },
        {
          employee_id: 'EMP_005_TEST',
          employee_name: 'Exceeds Wage Limit',
          esic_number: '3100223344',
          esic_applicable: true,
          gross_salary: 22500, // Exceeds 21,000 standard limit
          disability_percentage: 0,
        },
        {
          employee_id: 'EMP_006_TEST',
          employee_name: 'Malformed Number',
          esic_number: '9999', // Not 10 digits
          esic_applicable: true,
          gross_salary: 15000,
        },
      ];

      const result = engine.calculateEsicBatch({
        batch_id: 'BATCH_EXCEPTIONS_TEST',
        run_id: 'RUN_EXC',
        payroll_records: records,
      });

      assert.strictEqual(result.exceptions.length, 3);

      const emp004 = result.exceptions.find((e) => e.code === 'EMP004');
      assert.ok(emp004);
      assert.strictEqual(emp004.error_label, 'ESIC Number Missing');

      const emp005 = result.exceptions.find((e) => e.code === 'EMP005');
      assert.ok(emp005);
      assert.strictEqual(emp005.error_label, 'Salary Exceeds Limit');

      const emp006 = result.exceptions.find((e) => e.code === 'EMP006');
      assert.ok(emp006);
      assert.strictEqual(emp006.error_label, 'Invalid ESIC Number');

      // Check HR Tasks
      assert.strictEqual(result.hr_tasks.length, 3);
      assert.strictEqual(result.hr_tasks[0].assignee_role, 'HR_OPERATIONS');
      assert.strictEqual(result.hr_tasks[0].status, 'PENDING');
      assert.strictEqual(result.hr_tasks[0].priority, 'HIGH');

      // Check HR Alerts
      assert.strictEqual(result.hr_alerts.length, 3);
      assert.strictEqual(result.hr_alerts[0].severity, 'CRITICAL');
      assert.ok(result.hr_alerts[0].channels.includes('IN_APP'));
      assert.ok(result.hr_alerts[0].channels.includes('EMAIL'));
    });

    it('4.2 Should resolve exceptions and update corresponding HRTask status', () => {
      const records = [
        {
          employee_id: 'EMP_RES_01',
          employee_name: 'Remediation Candidate',
          esic_number: '',
          esic_applicable: true,
          gross_salary: 14000,
        },
      ];

      const result = engine.calculateEsicBatch({
        batch_id: 'BATCH_RES_TEST',
        run_id: 'RUN_RES',
        payroll_records: records,
      });

      const exc = result.exceptions[0];
      const stepperBefore = engine.getStepperState('BATCH_RES_TEST');
      assert.strictEqual(stepperBefore.is_blocked, true);
      assert.strictEqual(stepperBefore.unresolved_blocking_exceptions_count, 1);

      // Resolve exception
      const resResult = engine.resolveException(exc.exception_id, {
        resolved_by: 'lead-compliance-officer@kylrx.ai',
        fix_applied: 'Assigned valid IP Number 3100554433',
      });

      assert.strictEqual(resResult.success, true);
      assert.strictEqual(resResult.exception.resolved, true);

      // Verify task resolved
      const tasks = engine.hrTasks.get('BATCH_RES_TEST');
      assert.strictEqual(tasks[0].status, 'RESOLVED');

      // Verify stepper unblocked
      const stepperAfter = engine.getStepperState('BATCH_RES_TEST');
      assert.strictEqual(stepperAfter.is_blocked, false);
      assert.strictEqual(stepperAfter.unresolved_blocking_exceptions_count, 0);
    });
  });

  // ==========================================================================
  // PILLAR 5: FILE OUTPUT & 7-STAGE VISUAL COMPLIANCE STEPPER
  // ==========================================================================
  describe('5. File Output & 7-Stage Visual Compliance Stepper', () => {
    it('5.1 Should generate official export files ESIC_CONTRIBUTION_MONTH_YEAR.txt and .xls with exact 7 columns', () => {
      const records = [
        {
          employee_id: 'EMP_FILE_01',
          employee_name: 'Deepak Chopra',
          esic_number: '1234567890',
          esic_applicable: true,
          gross_salary: 20000,
          days_worked: 30,
        },
        {
          employee_id: 'EMP_FILE_02',
          employee_name: 'Anita Roy',
          esic_number: '1234567891',
          esic_applicable: true,
          gross_salary: 18000,
          days_worked: 28,
        },
      ];

      engine.calculateEsicBatch({
        batch_id: 'BATCH_EXPORT_01',
        run_id: 'RUN_EXPORT_01',
        period: '2026-09',
        payroll_records: records,
        employer_code: '31000123450000999',
      });

      const exportFiles = engine.generateExportFiles('BATCH_EXPORT_01');

      // Verify filenames
      assert.strictEqual(exportFiles.txt.file_name, 'ESIC_CONTRIBUTION_09_2026.txt');
      assert.strictEqual(exportFiles.xls.file_name, 'ESIC_CONTRIBUTION_09_2026.xls');

      // Verify SHA-256 Checksums
      assert.ok(exportFiles.txt.checksum);
      assert.ok(exportFiles.xls.checksum);

      // Verify Delimited Text Columns: [ESIC No, Employee Name, IP No, No. of Days, Total Wages, Employee Share, Employer Share]
      const txtLines = exportFiles.txt.content.split('\r\n');
      assert.strictEqual(
        txtLines[0],
        'ESIC No#Employee Name#IP No#No. of Days#Total Wages#Employee Share#Employer Share'
      );
      assert.ok(txtLines[1].includes('31000123450000999#Deepak Chopra#1234567890#30#20000#150#650'));

      // Verify Excel XML / HTML content
      assert.ok(exportFiles.xls.content.includes('<table'));
      assert.ok(exportFiles.xls.content.includes('<th>ESIC No</th>'));
      assert.ok(exportFiles.xls.content.includes('<td>Deepak Chopra</td>'));
      assert.ok(exportFiles.xls.content.includes('>1234567890</td>'));
    });

    it('5.2 Should advance through 7-stage visual compliance stepper: Payroll Finalized -> Compliance Completed', () => {
      const records = [
        {
          employee_id: 'EMP_STEP_01',
          employee_name: 'Pooja Hegde',
          esic_number: '4455667788',
          esic_applicable: true,
          gross_salary: 19000,
        },
      ];

      engine.calculateEsicBatch({
        batch_id: 'BATCH_STEPPER_01',
        run_id: 'RUN_STEPPER_01',
        period: '2026-09',
        payroll_records: records,
      });

      // Initially at VALIDATED (since 0 exceptions)
      let state = engine.getStepperState('BATCH_STEPPER_01');
      assert.strictEqual(state.current_stage, 'VALIDATED');
      assert.strictEqual(state.progress_percent, 43); // 3 of 7 stages = 43%

      // Stage 4: Advance to FILE_GENERATED
      state = engine.advanceStepperStage('BATCH_STEPPER_01', 'FILE_GENERATED', {
        actor: 'COMPLIANCE_BOT',
      });
      assert.strictEqual(state.current_stage, 'FILE_GENERATED');
      assert.strictEqual(state.progress_percent, 57);

      // Stage 5: Advance to PORTAL_UPLOADED
      state = engine.advanceStepperStage('BATCH_STEPPER_01', 'PORTAL_UPLOADED', {
        actor: 'OFFICER_PATEL',
        notes: 'Challan uploaded to ESIC Shram Suvidha portal.',
      });
      assert.strictEqual(state.current_stage, 'PORTAL_UPLOADED');
      assert.strictEqual(state.progress_percent, 71);

      // Stage 6: Advance to PAYMENT_DONE
      state = engine.advanceStepperStage('BATCH_STEPPER_01', 'PAYMENT_DONE', {
        actor: 'TREASURY_DESK',
        notes: 'Internet banking Challan payment acknowledged with CRN #1234987.',
      });
      assert.strictEqual(state.current_stage, 'PAYMENT_DONE');
      assert.strictEqual(state.progress_percent, 86);

      // Stage 7: Advance to COMPLETED
      state = engine.advanceStepperStage('BATCH_STEPPER_01', 'COMPLETED', {
        actor: 'AUDIT_DESK',
        notes: 'Compliance filed and settled successfully.',
      });
      assert.strictEqual(state.current_stage, 'COMPLETED');
      assert.strictEqual(state.progress_percent, 100);
      assert.strictEqual(state.stages[6].status, 'COMPLETED');
    });

    it('5.3 Should block stepper advancement past VALIDATED if unresolved blocking exceptions exist', () => {
      const records = [
        {
          employee_id: 'EMP_BLOCK_01',
          employee_name: 'Blocked User',
          esic_number: '', // Missing -> EMP004
          esic_applicable: true,
          gross_salary: 15000,
        },
      ];

      engine.calculateEsicBatch({
        batch_id: 'BATCH_BLOCKED_STEPPER',
        run_id: 'RUN_BLOCK',
        period: '2026-09',
        payroll_records: records,
      });

      const state = engine.getStepperState('BATCH_BLOCKED_STEPPER');
      assert.strictEqual(state.current_stage, 'ESIC_CALCULATED');
      assert.strictEqual(state.is_blocked, true);

      // Attempting to advance to VALIDATED or FILE_GENERATED without resolving must throw
      assert.throws(
        () => {
          engine.advanceStepperStage('BATCH_BLOCKED_STEPPER', 'VALIDATED');
        },
        (err) => {
          assert.strictEqual(err.code, 'UNRESOLVED_ESIC_EXCEPTIONS');
          assert.strictEqual(err.unresolved_count, 1);
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // PILLAR 6: REST API ENDPOINTS INTEGRATION
  // ==========================================================================
  describe('6. REST API Endpoints Integration', () => {
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

    it('6.1 POST /api/v1/esic/upload-master ingests Excel data', async () => {
      const csvData = `employee_id,employee_name,esic_number,esic_applicable,date_of_joining,disability_percentage
API_EMP_01,Kavita Rao,1122334455,true,2023-01-01,0
API_EMP_02,Sanjay Dutt,1122334456,true,2023-01-01,50`;

      const response = await fetch(`${baseUrl}/api/v1/esic/upload-master`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_content: csvData, file_name: 'ESIC_Employee_Master.xlsx' }),
      });

      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.valid_rows_count, 2);
    });

    it('6.2 POST /api/v1/esic/trigger initiates workflow and returns calculation', async () => {
      const payload = {
        run_id: 'RUN_API_TEST_01',
        period: '2026-09',
        batch_id: 'BATCH_API_01',
        payroll_records: [
          {
            employee_id: 'API_EMP_01',
            employee_name: 'Kavita Rao',
            esic_number: '1122334455',
            esic_applicable: true,
            gross_salary: 16000,
            days_worked: 30,
          },
        ],
      };

      const response = await fetch(`${baseUrl}/api/v1/esic/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.summary.total_compliant_records, 1);
      assert.strictEqual(body.data.summary.total_employee_share, 120); // 16000 * 0.0075 = 120
      assert.strictEqual(body.data.summary.total_employer_share, 520); // 16000 * 0.0325 = 520
    });

    it('6.3 GET /api/v1/esic/stepper/:batch_id and POST /advance transitions stage', async () => {
      // Advance to FILE_GENERATED
      const advResponse = await fetch(`${baseUrl}/api/v1/esic/stepper/BATCH_API_01/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_stage: 'FILE_GENERATED', actor: 'API_TESTER' }),
      });

      assert.strictEqual(advResponse.status, 200);
      const advBody = await advResponse.json();
      assert.strictEqual(advBody.success, true);
      assert.strictEqual(advBody.data.current_stage, 'FILE_GENERATED');

      // Query stepper status
      const getResponse = await fetch(`${baseUrl}/api/v1/esic/stepper/BATCH_API_01`);
      assert.strictEqual(getResponse.status, 200);
      const getBody = await getResponse.json();
      assert.strictEqual(getBody.data.current_stage, 'FILE_GENERATED');
      assert.strictEqual(getBody.data.progress_percent, 57);
    });

    it('6.4 GET /api/v1/esic/export/:batch_id downloads official .txt and .xls files', async () => {
      // Download TXT
      const txtResponse = await fetch(`${baseUrl}/api/v1/esic/export/BATCH_API_01?format=txt`);
      assert.strictEqual(txtResponse.status, 200);
      const txtText = await txtResponse.text();
      assert.ok(txtText.includes('ESIC No#Employee Name#IP No'));
      assert.ok(txtText.includes('Kavita Rao#1122334455#30#16000#120#520'));

      // Download XLS
      const xlsResponse = await fetch(`${baseUrl}/api/v1/esic/export/BATCH_API_01?format=xls`);
      assert.strictEqual(xlsResponse.status, 200);
      const xlsText = await xlsResponse.text();
      assert.ok(xlsText.includes('<table'));
      assert.ok(xlsText.includes('<td>Kavita Rao</td>'));
    });

    it('6.5 POST /advance rejects blocked batch with 422 Unprocessable Entity', async () => {
      // Trigger defective batch
      const triggerResponse = await fetch(`${baseUrl}/api/v1/esic/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: 'RUN_DEFECT_01',
          batch_id: 'BATCH_DEFECT_01',
          payroll_records: [
            {
              employee_id: 'DEFECT_01',
              employee_name: 'No Number',
              esic_number: '',
              esic_applicable: true,
              gross_salary: 15000,
            },
          ],
        }),
      });
      assert.strictEqual(triggerResponse.status, 200);

      // Attempt advance to VALIDATED
      const advResponse = await fetch(`${baseUrl}/api/v1/esic/stepper/BATCH_DEFECT_01/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_stage: 'VALIDATED' }),
      });

      assert.strictEqual(advResponse.status, 422);
      const advBody = await advResponse.json();
      assert.strictEqual(advBody.success, false);
      assert.strictEqual(advBody.error.code, 'UNRESOLVED_ESIC_EXCEPTIONS');
      assert.strictEqual(advBody.error.unresolved_blocking_count, 1);
    });
  });
});
