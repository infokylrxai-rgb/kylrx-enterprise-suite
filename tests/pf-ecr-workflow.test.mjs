/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PF & EPFO ECR WORKFLOW TEST SUITE
 * ============================================================================
 * Validates Section 4 of the Statutory Compliance Blueprint:
 *
 * 1. Trigger & Condition:
 *    - Listens for monthly Payroll Finalized trigger.
 *    - Evaluates pf_applicable === true.
 *    - If false, excludes the employee from the ECR workflow.
 *
 * 2. Validation Pre-Check:
 *    - Validates UAN (12 numeric digits) and PF Member ID existence and syntax.
 *    - If validation fails, dispatches an HR task, fires real-time notification alert
 *      (e.g., 'UAN Missing for Neha Verma (EMP004)'), and excludes the employee record
 *      from the pending ECR run.
 *
 * 3. Statutory Calculation Engine:
 *    - EPF Wages and EPS Wages respecting ₹15,000 ceiling or actual wage policy.
 *    - Employee Share (EE): 12% of EPF wages (+ Voluntary PF if configured).
 *    - Employer Share (ER): 3.67% of EPF wages.
 *    - EPS Contribution (ER): 8.33% of EPS wages (capped at ₹1,250 statutory limit
 *      if EPS applicable, else 0% with remainder to EPF).
 *    - EDLI (0.50%) and Admin charges (0.50%) according to active policy configurations.
 *
 * 4. Execution Logging & Audit Manifest:
 *    - Records calculation inputs, rule version (EPFO_PF_STATUTORY_RULE_V4.0), and
 *      validation outcome (Success / Failed).
 *
 * 5. Official ECR Output File Compilation:
 *    - Standard #~# delimited ECR text file with SHA-256 checksum.
 *
 * 6. REST API Endpoints & Centralized EventBus Integration
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Compliance Architect
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import express from 'express';

import {
  PfEcrAutomationEngine,
  EmployeePfProfileStore,
  EPFO_STATUTORY_RULE_VERSION,
  globalPfEcrAutomationEngine,
} from '../services/pf-ecr-automation-engine.mjs';

import pfComplianceRouter from '../routes/pf-compliance.mjs';

describe('🏛️ Section 4: Payroll-Triggered PF Calculation and Mapping Pipeline (EPFO ECR)', () => {
  let app;
  let server;
  let baseUrl;
  let mockEventBus;
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
    mockEventBus = new EventEmitter();
    engine = new PfEcrAutomationEngine({ eventBus: mockEventBus });
  });

  // ==========================================================================
  // 1. TRIGGER & CONDITION (pf_applicable === true)
  // ==========================================================================
  describe('1. Trigger & Applicability Condition', () => {
    it('1.1 Should process employees where pf_applicable === true and exclude when pf_applicable === false', () => {
      const records = [
        {
          employee_id: 'EMP_PF_01',
          employee_name: 'Aditya Birla',
          basic: 25000,
          gross_salary: 30000,
          uan: '100123456789',
          pf_member_id: 'MH/BAN/0012345/000/0000101',
          pf_applicable: true,
        },
        {
          employee_id: 'EMP_PF_02',
          employee_name: 'Consultant Exempt',
          basic: 60000,
          gross_salary: 65000,
          uan: '100123456790',
          pf_member_id: 'MH/BAN/0012345/000/0000102',
          pf_applicable: false, // Condition: false -> exclude
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_TEST_01',
        period: '2026-09',
        payroll_records: records,
      });

      assert.strictEqual(result.summary.total_records_processed, 2);
      assert.strictEqual(result.summary.total_applicable_records, 1);
      assert.strictEqual(result.summary.total_compliant_records, 1);
      assert.strictEqual(result.summary.total_excluded_records, 1);

      // Verify excluded record details
      assert.strictEqual(result.excluded_records[0].employee_id, 'EMP_PF_02');
      assert.strictEqual(result.excluded_records[0].status, 'EXCLUDED_NOT_APPLICABLE');

      // Verify execution log records exclusion
      const log = result.execution_logs.find((l) => l.employee_id === 'EMP_PF_02');
      assert.ok(log);
      assert.strictEqual(log.validation_outcome, 'EXCLUDED');
      assert.strictEqual(log.rule_version, EPFO_STATUTORY_RULE_VERSION);
    });
  });

  // ==========================================================================
  // 2. VALIDATION PRE-CHECK & REAL-TIME ALERTS
  // ==========================================================================
  describe('2. Validation Pre-Check, Real-Time Alerts & HR Tasks', () => {
    it('2.1 Should validate UAN & PF Member ID; dispatch HR task and alert e.g. "UAN Missing for Neha Verma (EMP004)"', () => {
      const records = [
        // Missing UAN (e.g. Neha Verma EMP004)
        {
          employee_id: 'EMP004',
          employee_name: 'Neha Verma',
          basic: 14000,
          gross_salary: 15000,
          uan: '', // Missing
          pf_member_id: 'MH/BAN/0012345/000/0000104',
          pf_applicable: true,
        },
        // Malformed UAN (< 12 digits)
        {
          employee_id: 'EMP_BAD_UAN',
          employee_name: 'Rohan Joshi',
          basic: 18000,
          gross_salary: 20000,
          uan: '12345', // Malformed
          pf_member_id: 'MH/BAN/0012345/000/0000105',
          pf_applicable: true,
        },
        // Missing PF Member ID
        {
          employee_id: 'EMP_NO_MEMBER',
          employee_name: 'Farhan Ali',
          basic: 12000,
          gross_salary: 14000,
          uan: '100987654321',
          pf_member_id: '', // Missing
          pf_applicable: true,
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_VALIDATION_01',
        period: '2026-09',
        payroll_records: records,
      });

      // All 3 records failed validation and were excluded from pending ECR run
      assert.strictEqual(result.summary.total_compliant_records, 0);
      assert.strictEqual(result.summary.total_exceptions, 3);
      assert.strictEqual(result.is_blocked, true);

      // 1. Verify Real-time Notification Alerts
      const nehaAlert = result.hr_alerts.find((a) => a.message.includes('Neha Verma'));
      assert.ok(nehaAlert, 'Must fire real-time alert for Neha Verma');
      assert.strictEqual(nehaAlert.message, 'UAN Missing for Neha Verma (EMP004)');
      assert.strictEqual(nehaAlert.severity, 'CRITICAL');
      assert.strictEqual(nehaAlert.channel, 'IN_APP_NOTIFICATION');

      // 2. Verify HR Tasks
      const nehaTask = result.hr_tasks.find((t) => t.employee_id === 'EMP004');
      assert.ok(nehaTask);
      assert.strictEqual(nehaTask.task_type, 'PF_EXCEPTION_REMEDIATION');
      assert.strictEqual(nehaTask.priority, 'HIGH');
      assert.strictEqual(nehaTask.sla_hours, 24);
      assert.strictEqual(nehaTask.status, 'OPEN');

      // 3. Verify Execution Logs mark FAILED
      const nehaLog = result.execution_logs.find((l) => l.employee_id === 'EMP004');
      assert.ok(nehaLog);
      assert.strictEqual(nehaLog.validation_outcome, 'FAILED');
      assert.strictEqual(nehaLog.rule_version, EPFO_STATUTORY_RULE_VERSION);
    });
  });

  // ==========================================================================
  // 3. STATUTORY CALCULATION ENGINE (12% EE, 3.67% ER EPF, 8.33% EPS, VPF, CEILING)
  // ==========================================================================
  describe('3. Statutory Calculation Engine & Split Reconciliation', () => {
    it('3.1 Should cap at ₹15,000 ceiling: Basic ₹25,000 -> EPF/EPS ₹15,000; EE ₹1,800, EPS ₹1,250, ER EPF ₹550', () => {
      const records = [
        {
          employee_id: 'EMP_CAP_01',
          employee_name: 'Sunita Rao',
          basic: 25000,
          gross_salary: 30000,
          uan: '100111222333',
          pf_member_id: 'MH/BAN/0012345/000/0000201',
          pf_applicable: true,
          eps_applicable: true,
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_CALC_01',
        period: '2026-09',
        payroll_records: records,
      });

      assert.strictEqual(result.summary.total_compliant_records, 1);
      const row = result.compliant_records[0];

      // EPF & EPS Wages capped at ₹15,000 statutory limit
      assert.strictEqual(row.epf_wages, 15000);
      assert.strictEqual(row.eps_wages, 15000);
      assert.strictEqual(row.edli_wages, 15000);

      // Employee Share (12% of ₹15,000 = ₹1,800)
      assert.strictEqual(row.ee_share, 1800);

      // EPS Contribution (8.33% of ₹15,000 capped at ₹1,250)
      assert.strictEqual(row.eps_share, 1250);

      // Employer EPF Share (12% - 8.33% = 3.67% -> ₹1,800 - ₹1,250 = ₹550)
      assert.strictEqual(row.er_epf_share, 550);

      // Total Employer share reconciliation: ₹1,250 + ₹550 = ₹1,800 (12%)
      assert.strictEqual(row.total_er_share, 1800);
    });

    it('3.2 Should calculate exact sub-ceiling wage: Basic ₹12,000 -> EE ₹1,440, EPS ₹1,000, ER EPF ₹440', () => {
      const records = [
        {
          employee_id: 'EMP_SUB_01',
          employee_name: 'Kavita Sen',
          basic: 12000,
          gross_salary: 13500,
          uan: '100222333444',
          pf_member_id: 'MH/BAN/0012345/000/0000202',
          pf_applicable: true,
          eps_applicable: true,
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_CALC_02',
        period: '2026-09',
        payroll_records: records,
      });

      const row = result.compliant_records[0];
      assert.strictEqual(row.epf_wages, 12000);
      assert.strictEqual(row.eps_wages, 12000);

      // EE: 12% of 12,000 = 1,440
      assert.strictEqual(row.ee_share, 1440);

      // EPS: 8.33% of 12,000 = Math.round(999.6) = 1,000
      assert.strictEqual(row.eps_share, 1000);

      // ER EPF: 1,440 - 1,000 = 440
      assert.strictEqual(row.er_epf_share, 440);
      assert.strictEqual(row.total_er_share, 1440);
    });

    it('3.3 Should support Voluntary PF (VPF) additions to Employee Share', () => {
      const records = [
        {
          employee_id: 'EMP_VPF_01',
          employee_name: 'Vikram Seth',
          basic: 15000,
          gross_salary: 18000,
          uan: '100333444555',
          pf_member_id: 'MH/BAN/0012345/000/0000203',
          pf_applicable: true,
          eps_applicable: true,
          vpf_amount: 1000, // Voluntary addition
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_VPF_01',
        period: '2026-09',
        payroll_records: records,
      });

      const row = result.compliant_records[0];
      // Base EE (12% of 15,000 = 1,800) + VPF (1,000) = 2,800
      assert.strictEqual(row.base_ee_share, 1800);
      assert.strictEqual(row.vpf_amount, 1000);
      assert.strictEqual(row.ee_share, 2800);

      // Employer share unaffected by employee voluntary PF
      assert.strictEqual(row.eps_share, 1250);
      assert.strictEqual(row.er_epf_share, 550);
    });
  });

  // ==========================================================================
  // 4. EPS EXEMPTION / BYPASS & ACTUAL WAGE POLICY
  // ==========================================================================
  describe('4. EPS Exemption & Actual Wage Policy', () => {
    it('4.1 Should handle EPS not applicable: 0% EPS, entire 12% allocated to ER EPF', () => {
      const records = [
        {
          employee_id: 'EMP_EPS_EXEMPT',
          employee_name: 'Senior Employee (>58 yrs)',
          basic: 15000,
          gross_salary: 18000,
          uan: '100444555666',
          pf_member_id: 'MH/BAN/0012345/000/0000204',
          pf_applicable: true,
          eps_applicable: false, // Pension exempt
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_EPS_EXEMPT',
        period: '2026-09',
        payroll_records: records,
      });

      const row = result.compliant_records[0];
      assert.strictEqual(row.epf_wages, 15000);
      assert.strictEqual(row.eps_wages, 0);

      assert.strictEqual(row.ee_share, 1800);
      assert.strictEqual(row.eps_share, 0); // 0% EPS
      assert.strictEqual(row.er_epf_share, 1800); // Full 12% to EPF
      assert.strictEqual(row.total_er_share, 1800);
    });

    it('4.2 Should calculate on actual wages when is_actual_wage_policy === true', () => {
      const records = [
        {
          employee_id: 'EMP_ACTUAL_WAGE',
          employee_name: 'Lead Architect',
          basic: 50000,
          gross_salary: 60000,
          uan: '100555666777',
          pf_member_id: 'MH/BAN/0012345/000/0000205',
          pf_applicable: true,
          eps_applicable: true,
          is_actual_wage_policy: true, // Actual wages opted
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_ACTUAL_WAGE',
        period: '2026-09',
        payroll_records: records,
      });

      const row = result.compliant_records[0];
      // EPF computed on actual 50,000; EPS capped at 15,000
      assert.strictEqual(row.epf_wages, 50000);
      assert.strictEqual(row.eps_wages, 15000);

      // EE: 12% of 50,000 = 6,000
      assert.strictEqual(row.ee_share, 6000);
      // EPS: capped at 1,250
      assert.strictEqual(row.eps_share, 1250);
      // ER EPF: 6,000 - 1,250 = 4,750
      assert.strictEqual(row.er_epf_share, 4750);
    });
  });

  // ==========================================================================
  // 5. EDLI & ADMINISTRATIVE CHARGES
  // ==========================================================================
  describe('5. EDLI and Administrative Charges Policy', () => {
    it('5.1 Should calculate EDLI (0.50%) and Admin charges (0.50%) according to active policy', () => {
      const records = [
        {
          employee_id: 'EMP_CHARGES_01',
          employee_name: 'Ananya Roy',
          basic: 15000,
          gross_salary: 16000,
          uan: '100666777888',
          pf_member_id: 'MH/BAN/0012345/000/0000206',
          pf_applicable: true,
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_CHARGES_01',
        period: '2026-09',
        payroll_records: records,
        policy_configuration: {
          edli_rate: 0.005, // 0.50%
          admin_rate: 0.005, // 0.50%
        },
      });

      const row = result.compliant_records[0];
      // EDLI: 0.50% of 15,000 = 75
      assert.strictEqual(row.edli_charges, 75);
      // Admin: 0.50% of 15,000 = 75
      assert.strictEqual(row.admin_charges, 75);

      // Total summary charges
      assert.strictEqual(result.summary.total_edli_charges, 75);
      assert.strictEqual(result.summary.total_admin_charges, 75);
      // Total Challan = EE(1800) + ER EPF(550) + EPS(1250) + EDLI(75) + Admin(75) = 3750
      assert.strictEqual(result.summary.total_challan_amount, 3750);
    });
  });

  // ==========================================================================
  // 6. EXECUTION LOGGING & AUDIT MANIFEST
  // ==========================================================================
  describe('6. Execution Logging & Audit Manifest', () => {
    it('6.1 Should record execution logs with calculation inputs, rule version, and validation outcome', () => {
      const records = [
        {
          employee_id: 'EMP_LOG_01',
          employee_name: 'Meera Nambiar',
          basic: 15000,
          gross_salary: 17000,
          uan: '100777888999',
          pf_member_id: 'MH/BAN/0012345/000/0000207',
          pf_applicable: true,
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_LOG_01',
        period: '2026-09',
        payroll_records: records,
      });

      assert.ok(result.execution_logs.length >= 1);
      const log = result.execution_logs[0];

      assert.strictEqual(log.employee_id, 'EMP_LOG_01');
      assert.strictEqual(log.rule_version, EPFO_STATUTORY_RULE_VERSION);
      assert.strictEqual(log.validation_outcome, 'SUCCESS');

      // Check inputs logged
      assert.strictEqual(log.inputs.uan, '100777888999');
      assert.strictEqual(log.inputs.pf_member_id, 'MH/BAN/0012345/000/0000207');
      assert.strictEqual(log.inputs.basic, 15000);

      // Check outputs logged
      assert.strictEqual(log.outputs.ee_share, 1800);
      assert.strictEqual(log.outputs.eps_share, 1250);
      assert.strictEqual(log.outputs.er_epf_share, 550);
      assert.ok(Date.parse(log.timestamp));
    });
  });

  // ==========================================================================
  // 7. OFFICIAL EPFO ECR TEXT OUTPUT COMPILATION (#~# DELIMITED)
  // ==========================================================================
  describe('7. Official EPFO ECR #~# Text File Output', () => {
    it('7.1 Should generate exact 11-column #~# delimited ECR text file with SHA-256 checksum', () => {
      const records = [
        {
          employee_id: 'EMP_ECR_01',
          employee_name: 'Rajeev Menon',
          basic: 15000,
          gross_salary: 20000,
          uan: '100888999000',
          pf_member_id: 'MH/BAN/0012345/000/0000208',
          pf_applicable: true,
          ncp_days: 0,
        },
      ];

      const result = engine.calculatePfBatch({
        batch_id: 'BATCH_PF_ECR_01',
        period: '2026-09',
        payroll_records: records,
      });

      const ecrFile = engine.exportFiles.get('BATCH_PF_ECR_01');
      assert.ok(ecrFile);
      assert.ok(ecrFile.manifest);

      // Verify SHA-256 Checksum
      assert.ok(ecrFile.manifest.checksum_sha256);
      assert.strictEqual(ecrFile.manifest.checksum_sha256.length, 64);
      assert.strictEqual(ecrFile.manifest.rule_version, EPFO_STATUTORY_RULE_VERSION);

      // Verify ECR line format:
      // UAN#~#MEMBER_NAME#~#GROSS#~#EPF_WAGES#~#EPS_WAGES#~#EDLI_WAGES#~#EE_SHARE#~#EPS_SHARE#~#ER_EPF_SHARE#~#NCP_DAYS#~#ADV_REFUND
      const expectedLine = '100888999000#~#Rajeev Menon#~#20000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0';
      assert.ok(ecrFile.txt.includes(expectedLine));
    });
  });

  // ==========================================================================
  // 8. REST API & EVENTBUS AUTOMATION INTEGRATION
  // ==========================================================================
  describe('8. REST API Endpoints & Centralized EventBus Integration', () => {
    it('8.1 POST /api/v1/pf/calculate, GET /exceptions, POST /resolve, and GET /export/:batch_id', async () => {
      // 1. Calculate via REST API
      const calcRes = await fetch(`${baseUrl}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payroll_run_id: 'PR_PF_API_TEST',
          period: '2026-09',
          employees: [
            {
              employee_id: 'EMP_API_DEFECT',
              employee_name: 'Alok Nath',
              basic: 15000,
              gross_salary: 18000,
              uan: '123', // Invalid UAN
              pf_member_id: 'MH/BAN/0012345/000/0000209',
              pf_applicable: true,
            },
          ],
        }),
      });

      assert.strictEqual(calcRes.status, 200);
      const calcData = await calcRes.json();
      assert.strictEqual(calcData.success, true);
      assert.strictEqual(calcData.data.is_blocked, true);

      // 2. Query exceptions
      const excRes = await fetch(`${baseUrl}/exceptions?batch_id=BATCH_PF_PR_PF_API_TEST`);
      assert.strictEqual(excRes.status, 200);
      const excData = await excRes.json();
      assert.ok(excData.data.total_count >= 1);
      const excId = excData.data.exceptions[0].exception_id;

      // 3. Resolve exception
      const resolveRes = await fetch(`${baseUrl}/exceptions/${excId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrected_value: '100999000111',
          field: 'uan',
          resolved_by: 'lead-compliance-officer',
        }),
      });
      assert.strictEqual(resolveRes.status, 200);
      const resolveData = await resolveRes.json();
      assert.strictEqual(resolveData.success, true);
      assert.strictEqual(resolveData.data.resolved, true);

      // 4. Download template
      const tplRes = await fetch(`${baseUrl}/template?format=csv`);
      assert.strictEqual(tplRes.status, 200);
      const tplText = await tplRes.text();
      assert.ok(tplText.includes('employee_id,employee_name,uan,pf_member_id'));
    });

    it('8.2 Should trigger PF automation via EventBus PAYROLL_FINALIZED', async () => {
      const busRunId = `PR_PF_EVENTBUS_${Date.now()}`;
      mockEventBus.emit('PAYROLL_FINALIZED', {
        payroll_run_id: busRunId,
        period: '2026-09',
        employees: [
          {
            employee_id: 'EMP_BUS_PF',
            basic: 15000,
            gross_salary: 16000,
            uan: '100123456789',
            pf_member_id: 'MH/BAN/0012345/000/0000210',
            pf_applicable: true,
          },
        ],
      });

      // Allow tick for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));

      const batchId = `BATCH_PF_${busRunId}`;
      const calcResult = engine.calculationResults.get(batchId);
      assert.ok(calcResult);
      assert.strictEqual(calcResult.summary.total_compliant_records, 1);
      assert.strictEqual(calcResult.compliant_records[0].ee_share, 1800);
    });
  });
});
