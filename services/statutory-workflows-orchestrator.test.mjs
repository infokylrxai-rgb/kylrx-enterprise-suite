/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CRITERIA 8, 9 & 10 TEST SUITE
 * ============================================================================
 * Modular Statutory Calculation and File Preparation Workflows:
 *  - Criterion 8: ESIC Multi-Stage Pipeline (6 sequential stages & CSV/Excel export)
 *  - Criterion 9: Gratuity Rule Engine (15/26 factor, vesting, ₹20L cap & Traceable Execution Receipts)
 *  - Criterion 10: NPS Validation & Export (12-digit PRAN, active tier, Sec 80CCD bounds & Caret ^ SCF export)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  EsicMultiStagePipeline,
  GratuityRuleEngine,
  NpsValidationAndExportEngine,
} from './statutory-workflows-orchestrator.mjs';

import {
  createDisbursementApiRouter,
  ComplianceEngineService,
  resetDisbursementMicroserviceStores,
} from './payroll-disbursement-api.mjs';

test('⚖️ CRITERIA 8, 9 & 10: MODULAR STATUTORY WORKFLOWS TEST SUITE', async (t) => {

  // ==========================================================================
  // CRITERION 8: ESIC MULTI-STAGE PIPELINE
  // ==========================================================================
  await t.test('1. Criterion 8: ESIC Multi-Stage Pipeline', async (t2) => {
    const pipeline = new EsicMultiStagePipeline();

    await t2.test('1.1 Executes explicit sequential 6-stage pipeline and produces stage traces', async () => {
      const payrollRecords = [
        { employee_id: 'EMP_001', employee_name: 'Pooja Nair', gross_wages: 18000, days_worked: 26, esic_number: '1100223344', esic_applicable: true },
        { employee_id: 'EMP_002', employee_name: 'Amit Patel', gross_wages: 20000, days_worked: 28, esic_number: '5566778899', esic_applicable: true },
        { employee_id: 'EMP_003', employee_name: 'Sara Khan', gross_wages: 85000, days_worked: 30, esic_applicable: false }, // Exempt
      ];

      const employeeProfiles = [
        { employee_id: 'EMP_001', employee_name: 'Pooja Nair', esic_number: '1100223344', esic_applicable: true },
        { employee_id: 'EMP_002', employee_name: 'Amit Patel', esic_number: '5566778899', esic_applicable: true },
        { employee_id: 'EMP_003', employee_name: 'Sara Khan', esic_applicable: false },
      ];

      const result = await pipeline.runPipeline({
        run_id: 'RUN_ESIC_001',
        period: '2026-09',
        payroll_records: payrollRecords,
        employee_profiles: employeeProfiles,
        employer_code: '31000123450000999',
      });

      // Stage Traces Verification: Exactly 6 sequential stages
      assert.equal(result.stages_executed.length, 6);
      const stageNames = result.stages_executed.map((s) => s.stage);
      assert.deepEqual(stageNames, [
        'PROFILE_MASTER_SYNC',
        'CALCULATION',
        'FORMAT_VALIDATION',
        'EXCEPTION_QUEUE',
        'RETURN_LAYOUT_MAPPING',
        'OUTPUT_GENERATION',
      ]);

      // Metrics & Calculation Verification (0.75% EE, 3.25% ER)
      // EMP_001: 18000 * 0.0075 = 135; 18000 * 0.0325 = 585
      // EMP_002: 20000 * 0.0075 = 150; 20000 * 0.0325 = 650
      assert.equal(result.compliant_ip_count, 2);
      assert.equal(result.non_applicable_count, 1);
      assert.equal(result.exception_count, 0);
      assert.equal(result.total_wages, 38000.00);
      assert.equal(result.total_employee_deduction_0_75, 285);
      assert.equal(result.total_employer_contribution_3_25, 1235);
      assert.equal(result.total_challan_liability, 1520);

      // Return Layout Mapping & Output Verification
      assert.equal(result.clean_return_records.length, 2);
      assert.equal(result.clean_return_records[0].ip_number, '1100223344');
      assert.equal(result.clean_return_records[0].total_monthly_wages, '18000.00');

      // CSV file & SHA-256 Checksum
      assert.ok(result.csv_output.file_name.startsWith('ESIC_RETURN_31000123450000999_'));
      assert.ok(result.csv_output.content.includes('IP Number,IP Name,No of Days for which wages paid'));
      assert.ok(result.csv_output.content.includes('1100223344,"Pooja Nair",26,18000.00'));
      assert.equal(result.csv_output.checksum_sha256.length, 64);

      // Excel matrix output
      assert.equal(result.excel_matrix_output.row_count, 2);
      assert.equal(result.excel_matrix_output.rows[0][0], '1100223344');
    });

    await t2.test('1.2 Format validation isolates non-10-digit IP numbers into Exception Queue', async () => {
      const payrollRecords = [
        { employee_id: 'EMP_BAD_IP', employee_name: 'John Doe', gross_wages: 15000, esic_number: '12345', esic_applicable: true }, // 5 digits
        { employee_id: 'EMP_CLEAN', employee_name: 'Jane Smith', gross_wages: 19000, esic_number: '9876543210', esic_applicable: true }, // 10 digits
      ];

      const result = await pipeline.runPipeline({
        run_id: 'RUN_ESIC_VAL',
        period: '2026-09',
        payroll_records: payrollRecords,
      });

      assert.equal(result.compliant_ip_count, 1);
      assert.equal(result.exception_count, 1);
      assert.equal(result.clean_return_records[0].ip_number, '9876543210');

      const exc = result.esic_exceptions[0];
      assert.equal(exc.employee_id, 'EMP_BAD_IP');
      assert.ok(exc.errors.includes('MALFORMED_ESIC_IP_NUMBER_NOT_10_DIGITS'));
      assert.equal(exc.severity, 'BLOCK');
      assert.equal(exc.remediation_task.action_required, 'UPDATE_10_DIGIT_IP_NUMBER');
    });

    await t2.test('1.3 Enforces wage ceiling (₹21,000) and isolates un-grandfathered breaches into Exception Queue', async () => {
      const payrollRecords = [
        { employee_id: 'EMP_BREACH', employee_name: 'Senior Dev', gross_wages: 28000, esic_number: '1234567890', esic_applicable: true, is_grandfathered: false },
        { employee_id: 'EMP_GF', employee_name: 'Grandfathered Lead', gross_wages: 24000, esic_number: '2345678901', esic_applicable: true, is_grandfathered: true },
      ];

      const result = await pipeline.runPipeline({
        run_id: 'RUN_ESIC_CEILING',
        period: '2026-09',
        payroll_records: payrollRecords,
      });

      assert.equal(result.compliant_ip_count, 1); // Grandfathered one passes
      assert.equal(result.exception_count, 1); // Un-grandfathered breach isolated
      assert.ok(result.esic_exceptions[0].errors.includes('WAGE_CEILING_BREACH_WITHOUT_GRANDFATHERING'));
    });
  });

  // ==========================================================================
  // CRITERION 9: GRATUITY RULE ENGINE
  // ==========================================================================
  await t.test('2. Criterion 9: Gratuity Rule Engine & Traceable Execution Receipts', async (t2) => {
    const engine = new GratuityRuleEngine();

    await t2.test('2.1 Calculates payout using dynamic 15/26 formula and emits traceable execution receipt', () => {
      // 6 continuous years of service: DOJ 2018-01-01 to DOE 2024-01-01
      // Basic = 60000, DA = 10000 -> Salary Basis = 70000
      // Formula = (70000 * 6 * 15) / 26 = 6,300,000 / 26 = 242,308
      const result = engine.calculateWithTraceableReceipt({
        employee_id: 'EMP_GRAT_001',
        date_of_joining: '2018-01-01',
        date_of_exit: '2024-01-01',
        exit_reason: 'RESIGNATION',
        last_drawn_basic: 60000,
        last_drawn_da: 10000,
      });

      assert.equal(result.success, true);
      assert.equal(result.is_vested, true);
      assert.equal(result.final_payable_amount, 242308);

      const receipt = result.execution_receipt;
      assert.ok(receipt.receipt_id);
      assert.equal(receipt.employee_id, 'EMP_GRAT_001');
      assert.equal(receipt.salary_basis, 70000);
      assert.equal(receipt.completed_service_factor, 6);
      assert.equal(receipt.days_per_year_factor, 15);
      assert.equal(receipt.working_days_divisor, 26);
      assert.equal(receipt.raw_formula_output, 242308);
      assert.equal(receipt.statutory_tax_free_cap, 2000000);
      assert.equal(receipt.tax_exempt_amount, 242308);
      assert.equal(receipt.taxable_amount, 0);
      assert.ok(receipt.policy_version_id);
      assert.ok(receipt.execution_timestamp);
    });

    await t2.test('2.2 Enforces 5-year vesting gate (1825 days); unvested employees receive 0 payable', () => {
      // 3 years of service (unvested)
      const result = engine.calculateWithTraceableReceipt({
        employee_id: 'EMP_UNVESTED',
        date_of_joining: '2021-01-01',
        date_of_exit: '2024-01-01',
        exit_reason: 'RESIGNATION',
        last_drawn_basic: 50000,
      });

      assert.equal(result.is_vested, false);
      assert.equal(result.final_payable_amount, 0);
      assert.equal(result.execution_receipt.is_vested, false);
      assert.equal(result.execution_receipt.tax_exempt_amount, 0);
      assert.equal(result.execution_receipt.taxable_amount, 0);
    });

    await t2.test('2.3 Automatically applies statutory vesting bypass on DEATH or DISABILITY', () => {
      // 2 years of service, exit reason DEATH
      const result = engine.calculateWithTraceableReceipt({
        employee_id: 'EMP_DECEASED',
        date_of_joining: '2022-01-01',
        date_of_exit: '2024-01-01',
        exit_reason: 'DEATH',
        last_drawn_basic: 52000,
        nominees: [
          { nominee_name: 'Spouse', share_percentage: 60 },
          { nominee_name: 'Child', share_percentage: 40 },
        ],
      });

      assert.equal(result.is_vested, true);
      assert.equal(result.execution_receipt.vesting_bypass_applied, true);
      assert.equal(result.execution_receipt.vesting_bypass_reason, 'STATUTORY_EXEMPTION_DEATH');
      assert.ok(result.final_payable_amount > 0);

      // Nominee allocation check
      assert.equal(result.execution_receipt.nominee_allocations.length, 2);
      assert.equal(result.execution_receipt.nominee_allocations[0].share_percentage, 60);
      assert.equal(result.execution_receipt.nominee_allocations[1].share_percentage, 40);
    });

    await t2.test('2.4 Enforces statutory ₹20,00,000 tax-free cap and isolates taxable excess', () => {
      // Very high earner: Basic = 350000, 20 years service
      // Raw Payout = (350000 * 20 * 15) / 26 = 4,038,462
      const result = engine.calculateWithTraceableReceipt({
        employee_id: 'EMP_EXEC',
        date_of_joining: '2004-01-01',
        date_of_exit: '2024-01-01',
        exit_reason: 'RETIREMENT',
        last_drawn_basic: 350000,
      });

      const receipt = result.execution_receipt;
      assert.equal(receipt.statutory_tax_free_cap, 2000000);
      assert.equal(receipt.tax_exempt_amount, 2000000);
      assert.equal(receipt.taxable_amount, receipt.final_payable_amount - 2000000);
      assert.ok(receipt.taxable_amount > 0);
    });
  });

  // ==========================================================================
  // CRITERION 10: NPS VALIDATION & EXPORT ENGINE
  // ==========================================================================
  await t.test('3. Criterion 10: NPS Pre-Export Validation & NSDL CRA SCF Compilation', async (t2) => {
    const engine = new NpsValidationAndExportEngine();

    await t2.test('3.1 Validates 12-digit PRAN format and blocks compilation on malformed PRAN', () => {
      const records = [
        { employee_id: 'EMP_NPS_1', pran: '110022334455', basic_salary: 50000, employer_share: 5000, employee_share: 5000 }, // Clean 12 digits
        { employee_id: 'EMP_NPS_2', pran: '12345', basic_salary: 40000, employer_share: 4000, employee_share: 4000 }, // Malformed 5 digits
      ];

      const result = engine.validateAndCompileScf({
        records,
        period: 'September 2026',
      });

      assert.equal(result.all_data_checks_passed, false);
      assert.equal(result.scf_file, null, 'File compilation must be BLOCKED when PRAN is invalid');
      assert.equal(result.rejected_count, 1);
      assert.ok(result.validation_issues[0].errors.some((e) => e.includes('INVALID_PRAN_FORMAT')));
    });

    await t2.test('3.2 Validates active tier selection (TIER_1 vs TIER_2)', () => {
      const records = [
        { employee_id: 'EMP_NPS_BAD_TIER', pran: '110022334455', tier_type: 'TIER_INVALID', basic_salary: 50000, employer_share: 5000, employee_share: 5000 },
      ];

      const result = engine.validateAndCompileScf({
        records,
        period: 'September 2026',
      });

      assert.equal(result.all_data_checks_passed, false);
      assert.equal(result.scf_file, null);
      assert.ok(result.validation_issues[0].errors.some((e) => e.includes('INVALID_TIER_SELECTION')));
    });

    await t2.test('3.3 Validates Section 80CCD contribution boundaries (80CCD(1) 10% EE, 80CCD(2) 10% ER)', () => {
      const records = [
        {
          employee_id: 'EMP_EXCESS_CONTRIB',
          pran: '110022334455',
          basic_salary: 50000,
          employee_share: 15000, // 30% -> exceeds 10% ceiling of ₹5000
          employer_share: 10000, // 20% -> exceeds 10% ceiling of ₹5000
        },
      ];

      const result = engine.validateAndCompileScf({
        records,
        period: 'September 2026',
      });

      assert.equal(result.all_data_checks_passed, false);
      assert.equal(result.scf_file, null);
      assert.ok(result.validation_issues[0].errors.some((e) => e.includes('SEC_80CCD_1_BREACH')));
      assert.ok(result.validation_issues[0].errors.some((e) => e.includes('SEC_80CCD_2_BREACH')));
    });

    await t2.test('3.4 Compiles Caret (^) separated NSDL CRA .txt SCF file strictly after all checks pass', () => {
      const cleanRecords = [
        {
          employee_id: 'EMP_01',
          employee_name: 'Anil Kumar',
          pran: '110022334455',
          tier_type: 'TIER_1',
          basic_salary: 50000,
          employer_share: 5000,
          employee_share: 5000,
        },
        {
          employee_id: 'EMP_02',
          employee_name: 'Deepa Sharma',
          pran: '220033445566',
          tier_type: 'TIER_1',
          basic_salary: 60000,
          employer_share: 6000,
          employee_share: 6000,
        },
      ];

      const result = engine.validateAndCompileScf({
        records: cleanRecords,
        period: 'September 2026',
        corporate_registration_number: 'CHO99887',
        pao_or_pop_sp_code: 'POP12345',
        entity_name: 'KYLRX ENTERPRISE SUITE',
      });

      assert.equal(result.all_data_checks_passed, true);
      assert.ok(result.scf_file, 'SCF file must be compiled when all data checks pass');

      const scf = result.scf_file;
      assert.ok(scf.file_name.startsWith('NSDL_CRA_SCF_CHO99887_'));
      assert.equal(scf.checksum_sha256.length, 64);
      assert.equal(scf.grand_total_contribution, 22000);

      // Verify Caret ^ structure: FH, BH, SD, FT
      const lines = scf.file_content.split('\r\n');
      assert.ok(lines[0].startsWith('FH^01^SCF^CHO99887^'));
      assert.ok(lines[1].startsWith('BH^') && lines[1].includes('POP12345'));
      assert.ok(lines[2].startsWith('SD^'));
      assert.ok(lines[2].includes('110022334455'));
      assert.ok(lines[3].startsWith('SD^'));
      assert.ok(lines[3].includes('220033445566'));
      assert.ok(lines[lines.length - 1].startsWith('FT^'));
    });
  });

  // ==========================================================================
  // REST API ENDPOINT INTEGRATION
  // ==========================================================================
  await t.test('4. REST API Endpoints Integration', async (t2) => {
    let server;
    let baseUrl;

    t2.before(() => {
      resetDisbursementMicroserviceStores();
      const app = express();
      app.use(express.json());
      app.use('/api', createDisbursementApiRouter());
      server = app.listen(0);
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}/api`;
    });

    t2.after(() => {
      if (server) server.close();
      resetDisbursementMicroserviceStores();
    });

    await t2.test('4.1 POST /compliance/esic/pipeline runs 6-stage pipeline', async () => {
      const res = await fetch(`${baseUrl}/compliance/esic/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: 'RUN_API_ESIC',
          period: '2026-09',
          payroll_records: [
            { employee_id: 'EMP_E1', gross_wages: 19500, esic_number: '1234567890', esic_applicable: true },
          ],
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.stages_executed.length, 6);
      assert.equal(json.data.compliant_ip_count, 1);
      assert.ok(json.data.csv_output.content);
    });

    await t2.test('4.2 POST /compliance/gratuity/calculate-with-receipt outputs receipt and tax split', async () => {
      const res = await fetch(`${baseUrl}/compliance/gratuity/calculate-with-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: 'EMP_API_GRAT',
          date_of_joining: '2015-01-01',
          date_of_exit: '2023-01-01',
          last_drawn_basic: 80000,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data.final_payable_amount > 0);
      assert.ok(json.data.execution_receipt.receipt_id);
      assert.equal(json.data.execution_receipt.completed_service_factor, 8);
    });

    await t2.test('4.3 POST /compliance/nps/validate-and-export enforces pre-export checks (422 on validation fail, 200 on pass)', async () => {
      // 1. Failing request with bad PRAN
      const failRes = await fetch(`${baseUrl}/compliance/nps/validate-and-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_run_id: 'RUN_FAIL',
          period: 'September 2026',
          records: [
            { employee_id: 'EMP_BAD', pran: '999', basic_salary: 50000 },
          ],
        }),
      });

      assert.equal(failRes.status, 422);
      const failJson = await failRes.json();
      assert.equal(failJson.success, false);
      assert.equal(failJson.error.code, 'NPS_PRE_EXPORT_VALIDATION_FAILED');

      // 2. Passing request with clean records
      const passRes = await fetch(`${baseUrl}/compliance/nps/validate-and-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_run_id: 'RUN_PASS',
          period: 'September 2026',
          records: [
            { employee_id: 'EMP_GOOD', pran: '123456789012', basic_salary: 50000, employer_share: 5000, employee_share: 5000 },
          ],
        }),
      });

      assert.equal(passRes.status, 200);
      const passJson = await passRes.json();
      assert.equal(passJson.success, true);
      assert.ok(passJson.data.scf_file.file_content);
      assert.equal(passJson.data.all_data_checks_passed, true);
    });
  });
});
