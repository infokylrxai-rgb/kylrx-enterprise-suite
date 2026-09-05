/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - NPS BATCH STAGING VALIDATION PIPELINE TESTS
 * ============================================================================
 * Test coverage for:
 *  1. PRAN format integrity (/^[0-9]{12}$/)
 *  2. Intra-batch and cross-profile duplicate PRAN guards
 *  3. Valid Tier selection & TIER_1 mandatory corporate tax exemption gate
 *  4. Contribution amounts > 0 and within policy / net earnings bounds
 *  5. Unambiguous contribution type (EMPLOYER_ONLY, EMPLOYEE_ONLY, BOTH)
 *  6. Exception Interceptor: ValidationIssue generation (NPS_VAL_001, BLOCK),
 *     automated HR task dispatching, and defective profile exclusion from export
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPranFormat,
  isValidContributionType,
  isValidTierSelection,
  validateNpsRecordPreFlight,
  executeNpsBatchValidationPipeline,
  createNPSValidationIssue,
  createNPSHRTask,
} from './nps-batch-validation-pipeline.mjs';

test('⚡ KYLRX AI NPS BATCH STAGING VALIDATION & EXCEPTION INTERCEPTOR TEST SUITE', async (t) => {

  await t.test('1. PRAN Format Integrity Guard', async (t2) => {
    await t2.test('Should validate standard 12-digit numeric PRAN', () => {
      assert.strictEqual(isValidPranFormat('110001234567'), true);
      assert.strictEqual(isValidPranFormat('200198765432'), true);
      assert.strictEqual(isValidPranFormat(110001234567), true);
    });

    await t2.test('Should reject malformed, non-12-digit, or alphanumeric PRAN strings', () => {
      assert.strictEqual(isValidPranFormat(''), false);
      assert.strictEqual(isValidPranFormat(null), false);
      assert.strictEqual(isValidPranFormat(undefined), false);
      assert.strictEqual(isValidPranFormat('1234567890'), false);        // 10 digits
      assert.strictEqual(isValidPranFormat('12345678901'), false);       // 11 digits
      assert.strictEqual(isValidPranFormat('1234567890123'), false);     // 13 digits
      assert.strictEqual(isValidPranFormat('11000123456A'), false);      // Alpha
      assert.strictEqual(isValidPranFormat('1100-0123-4567'), false);    // Hyphens
    });

    await t2.test('Should flag blocking ValidationIssue with code NPS_VAL_001 on invalid PRAN in record', () => {
      const record = {
        employee_id: 'EMP_NPS_001',
        employee_name: 'Aarav Mehta',
        pran: '1100A12345', // Invalid
        tier: 'TIER_1',
        contribution_type: 'BOTH',
        basic: 50000,
        da: 10000,
        net_salary: 55000,
      };

      const issues = validateNpsRecordPreFlight(record, { run_id: 'RUN_TEST_01' });
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].code, 'NPS_VAL_001');
      assert.strictEqual(issues[0].sub_code, 'INVALID_PRAN_FORMAT');
      assert.strictEqual(issues[0].severity, 'BLOCK');
      assert.strictEqual(issues[0].field, 'pran');
      assert.strictEqual(issues[0].employee_id, 'EMP_NPS_001');
      assert.strictEqual(issues[0].resolved, false);
    });
  });

  await t.test('2. Intra-Batch & Cross-Profile Duplicate PRAN Guards', async (t2) => {
    await t2.test('Should intercept intra-batch duplicate PRAN across multiple employees', () => {
      const sharedPran = '110012345678';
      const stagedRecords = [
        {
          employee_id: 'EMP_101',
          employee_name: 'Priya Sharma',
          pran: sharedPran,
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          basic: 60000,
          da: 12000,
          net_salary: 65000,
        },
        {
          employee_id: 'EMP_102',
          employee_name: 'Vikram Singh',
          pran: sharedPran, // Duplicate PRAN
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          basic: 55000,
          da: 11000,
          net_salary: 60000,
        },
      ];

      const result = executeNpsBatchValidationPipeline({
        batch_id: 'BATCH_DUP_INTRA',
        records: stagedRecords,
      });

      assert.strictEqual(result.status, 'PARTIAL');
      assert.strictEqual(result.clean_count, 1);
      assert.strictEqual(result.blocked_count, 1);
      assert.strictEqual(result.clean_records[0].employee_id, 'EMP_101');
      assert.strictEqual(result.blocked_records[0].record.employee_id, 'EMP_102');
      assert.strictEqual(result.validation_issues[0].sub_code, 'DUPLICATE_PRAN_INTRA_BATCH');
      assert.strictEqual(result.validation_issues[0].code, 'NPS_VAL_001');
      assert.strictEqual(result.validation_issues[0].severity, 'BLOCK');
    });

    await t2.test('Should intercept PRAN registered to another active profile in master registry', () => {
      const masterPrans = new Map([
        ['110099887766', 'EMP_EXISTING_999'],
      ]);

      const stagedRecords = [
        {
          employee_id: 'EMP_201',
          employee_name: 'Rohan Gupta',
          pran: '110099887766', // Registered to EMP_EXISTING_999
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          basic: 70000,
          da: 14000,
          net_salary: 75000,
        },
      ];

      const result = executeNpsBatchValidationPipeline({
        batch_id: 'BATCH_DUP_CROSS',
        records: stagedRecords,
        existing_prans: masterPrans,
      });

      assert.strictEqual(result.status, 'BLOCKED');
      assert.strictEqual(result.clean_count, 0);
      assert.strictEqual(result.blocked_count, 1);
      assert.strictEqual(result.validation_issues[0].sub_code, 'DUPLICATE_PRAN_CROSS_PROFILE');
      assert.strictEqual(result.validation_issues[0].severity, 'BLOCK');
      assert.strictEqual(result.hr_tasks.length, 1);
      assert.strictEqual(result.hr_tasks[0].assigned_role, 'HR_COMPLIANCE_OFFICER');
    });
  });

  await t.test('3. Tier Selection Validity & Mandatory TIER_1 Corporate Exemption Gate', async (t2) => {
    await t2.test('Should accept valid TIER_1 and TIER_2 tiers and reject invalid tiers', () => {
      assert.strictEqual(isValidTierSelection('TIER_1'), true);
      assert.strictEqual(isValidTierSelection('TIER_2'), true);
      assert.strictEqual(isValidTierSelection('tier_1'), true);
      assert.strictEqual(isValidTierSelection('TIER_3'), false);
      assert.strictEqual(isValidTierSelection('SAVINGS'), false);
      assert.strictEqual(isValidTierSelection(''), false);
      assert.strictEqual(isValidTierSelection(null), false);
    });

    await t2.test('Should block record with invalid tier string', () => {
      const record = {
        employee_id: 'EMP_301',
        employee_name: 'Neha Roy',
        pran: '110033445566',
        tier: 'INVALID_TIER',
        contribution_type: 'BOTH',
        basic: 40000,
        da: 8000,
        net_salary: 45000,
      };

      const issues = validateNpsRecordPreFlight(record);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].code, 'NPS_VAL_001');
      assert.strictEqual(issues[0].sub_code, 'INVALID_TIER_SELECTION');
      assert.strictEqual(issues[0].severity, 'BLOCK');
    });

    await t2.test('Should enforce TIER_1 mandatory requirement for corporate employer co-contributions', () => {
      const record = {
        employee_id: 'EMP_302',
        employee_name: 'Ananya Sen',
        pran: '110044556677',
        tier: 'TIER_2',
        contribution_type: 'BOTH', // Employer co-contribution not allowed on TIER_2
        basic: 50000,
        da: 10000,
        net_salary: 55000,
      };

      const issues = validateNpsRecordPreFlight(record);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].code, 'NPS_VAL_001');
      assert.strictEqual(issues[0].sub_code, 'TIER1_MANDATORY_FOR_CORPORATE_EXEMPTION');
      assert.strictEqual(issues[0].severity, 'BLOCK');
    });
  });

  await t.test('4. Contribution Amounts & Net Earnings Policy Bounds', async (t2) => {
    await t2.test('Should block record with zero or negative salary basis (Basic + DA <= 0)', () => {
      const record = {
        employee_id: 'EMP_401',
        employee_name: 'Suresh Raina',
        pran: '110055667788',
        tier: 'TIER_1',
        contribution_type: 'BOTH',
        basic: 0,
        da: 0,
        net_salary: 30000,
      };

      const issues = validateNpsRecordPreFlight(record);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].code, 'NPS_VAL_001');
      assert.strictEqual(issues[0].sub_code, 'ZERO_OR_NEGATIVE_SALARY_BASIS');
      assert.strictEqual(issues[0].severity, 'BLOCK');
    });

    await t2.test('Should block record where employee deductions exceed available net take-home earnings', () => {
      const record = {
        employee_id: 'EMP_402',
        employee_name: 'Kavita Das',
        pran: '110066778899',
        tier: 'TIER_1',
        contribution_type: 'BOTH',
        basic: 50000,
        da: 10000,
        employee_mandatory_deduction: 6000,
        voluntary_monthly_amount: 40000, // Total 46,000
        net_salary: 15000,               // Net pay is only 15,000
      };

      const issues = validateNpsRecordPreFlight(record);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].code, 'NPS_VAL_001');
      assert.strictEqual(issues[0].sub_code, 'DEDUCTION_EXCEEDS_NET_EARNINGS');
      assert.strictEqual(issues[0].severity, 'BLOCK');
    });

    await t2.test('Should block negative contribution amounts', () => {
      const record = {
        employee_id: 'EMP_403',
        employee_name: 'Karan Kapoor',
        pran: '110077889900',
        tier: 'TIER_1',
        contribution_type: 'BOTH',
        basic: 40000,
        da: 8000,
        voluntary_monthly_amount: -500, // Negative amount
        net_salary: 45000,
      };

      const issues = validateNpsRecordPreFlight(record);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].code, 'NPS_VAL_001');
      assert.strictEqual(issues[0].sub_code, 'INVALID_CONTRIBUTION_AMOUNT');
    });
  });

  await t.test('5. Unambiguous Contribution Type Guard', async (t2) => {
    await t2.test('Should validate standard contribution types and reject ambiguous values', () => {
      assert.strictEqual(isValidContributionType('EMPLOYER_ONLY'), true);
      assert.strictEqual(isValidContributionType('EMPLOYEE_ONLY'), true);
      assert.strictEqual(isValidContributionType('BOTH'), true);
      assert.strictEqual(isValidContributionType('both'), true);
      assert.strictEqual(isValidContributionType('SPLIT'), false);
      assert.strictEqual(isValidContributionType('CUSTOM'), false);
      assert.strictEqual(isValidContributionType('NONE'), false);
      assert.strictEqual(isValidContributionType(''), false);
      assert.strictEqual(isValidContributionType(null), false);
    });

    await t2.test('Should block record with ambiguous contribution type', () => {
      const record = {
        employee_id: 'EMP_501',
        employee_name: 'Aditya Verma',
        pran: '110088990011',
        tier: 'TIER_1',
        contribution_type: 'CUSTOM_SPLIT', // Ambiguous
        basic: 60000,
        da: 12000,
        net_salary: 65000,
      };

      const issues = validateNpsRecordPreFlight(record);
      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].code, 'NPS_VAL_001');
      assert.strictEqual(issues[0].sub_code, 'AMBIGUOUS_CONTRIBUTION_TYPE');
      assert.strictEqual(issues[0].severity, 'BLOCK');
    });
  });

  await t.test('6. Complete Exception Interceptor & Batch Staging Workflow', async (t2) => {
    await t2.test('Should isolate clean records from defective records and format batch result', () => {
      const stagedBatch = [
        // Clean Record 1
        {
          employee_id: 'EMP_CLEAN_01',
          employee_name: 'Rajesh Kumar',
          pran: '110011112222',
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          basic: 50000,
          da: 10000,
          net_salary: 55000,
        },
        // Defect 1: Invalid PRAN
        {
          employee_id: 'EMP_FAIL_01',
          employee_name: 'Sneha Patel',
          pran: '1100BADPRAN',
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          basic: 60000,
          da: 12000,
          net_salary: 65000,
        },
        // Clean Record 2
        {
          employee_id: 'EMP_CLEAN_02',
          employee_name: 'Manoj Tiwari',
          pran: '110033334444',
          tier: 'TIER_1',
          contribution_type: 'EMPLOYER_ONLY',
          basic: 80000,
          da: 16000,
          net_salary: 90000,
        },
        // Defect 2: Zero Basic & DA
        {
          employee_id: 'EMP_FAIL_02',
          employee_name: 'Amitabh Sen',
          pran: '110055556666',
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          basic: 0,
          da: 0,
          net_salary: 20000,
        },
      ];

      const result = executeNpsBatchValidationPipeline({
        batch_id: 'BATCH_NPS_SEPT_2026',
        run_id: 'RUN_2026_09',
        period: 'September 2026',
        records: stagedBatch,
      });

      assert.strictEqual(result.total_staged, 4);
      assert.strictEqual(result.clean_count, 2);
      assert.strictEqual(result.blocked_count, 2);
      assert.strictEqual(result.status, 'PARTIAL');
      assert.strictEqual(result.is_blocked, true);
      assert.strictEqual(result.can_export_file, true); // Clean records can be staged for file export

      // Verify Clean Records Export payload
      assert.strictEqual(result.clean_records.length, 2);
      assert.strictEqual(result.clean_records[0].employee_id, 'EMP_CLEAN_01');
      assert.strictEqual(result.clean_records[0].salary_basis, 60000); // 50000 + 10000
      assert.strictEqual(result.clean_records[0].employer_contribution, 6000); // 10%
      assert.strictEqual(result.clean_records[0].total_employee_contribution, 6000); // 10%
      assert.strictEqual(result.clean_records[0].total_nps_contribution, 12000);

      assert.strictEqual(result.clean_records[1].employee_id, 'EMP_CLEAN_02');
      assert.strictEqual(result.clean_records[1].salary_basis, 96000); // 80000 + 16000
      assert.strictEqual(result.clean_records[1].employer_contribution, 9600); // 10%
      assert.strictEqual(result.clean_records[1].total_employee_contribution, 0); // EMPLOYER_ONLY

      // Total liabilities for clean staged records
      assert.strictEqual(result.total_employer_share, 15600);
      assert.strictEqual(result.total_employee_share, 6000);
      assert.strictEqual(result.total_nps_liability, 21600);

      // Verify Blocked Records & Exception Interceptor
      assert.strictEqual(result.blocked_records.length, 2);
      assert.strictEqual(result.blocked_records[0].record.employee_id, 'EMP_FAIL_01');
      assert.strictEqual(result.blocked_records[1].record.employee_id, 'EMP_FAIL_02');

      // Verify Automated HR Alert Tasks
      assert.strictEqual(result.hr_tasks.length, 2);
      assert.strictEqual(result.hr_tasks[0].employee_id, 'EMP_FAIL_01');
      assert.strictEqual(result.hr_tasks[0].status, 'PENDING_REVIEW');
      assert.strictEqual(result.hr_tasks[0].assigned_role, 'HR_COMPLIANCE_OFFICER');
      assert.strictEqual(result.hr_tasks[1].employee_id, 'EMP_FAIL_02');

      // Verify ValidationIssues entity format
      assert.strictEqual(result.validation_issues.length, 2);
      for (const issue of result.validation_issues) {
        assert.strictEqual(issue.code, 'NPS_VAL_001');
        assert.strictEqual(issue.severity, 'BLOCK');
        assert.strictEqual(issue.resolved, false);
      }
    });

    await t2.test('Should return status PASSED and blocked_count 0 when all staged records are clean', () => {
      const cleanBatch = [
        {
          employee_id: 'EMP_PASS_01',
          employee_name: 'Geeta Kumari',
          pran: '110077778888',
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          basic: 50000,
          da: 10000,
          net_salary: 55000,
        },
      ];

      const result = executeNpsBatchValidationPipeline({
        batch_id: 'BATCH_CLEAN_ALL',
        records: cleanBatch,
      });

      assert.strictEqual(result.status, 'PASSED');
      assert.strictEqual(result.is_blocked, false);
      assert.strictEqual(result.can_export_file, true);
      assert.strictEqual(result.clean_count, 1);
      assert.strictEqual(result.blocked_count, 0);
      assert.strictEqual(result.validation_issues.length, 0);
      assert.strictEqual(result.hr_tasks.length, 0);
    });
  });

});
