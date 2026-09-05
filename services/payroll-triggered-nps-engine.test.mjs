/**
 * ============================================================================
 * TEST SUITE: PAYROLL-TRIGGERED NPS CALCULATION ENGINE
 * ============================================================================
 * Tests:
 *  1. Eligibility Filtering: nps_applicable === true and exit_date validity
 *  2. Dynamic Salary Basis & Contribution Calculations (80CCD(2) & 80CCD(1/1B))
 *  3. Boundary & Cap Guards: 12-digit PRAN format gate, net pay limit, zero salary
 *  4. Exception Interception: ValidationIssue & HR task generation
 *  5. EventBus PAYROLL_FINALIZED automated listener integration
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import {
  isValidPran,
  isEmployeeNPSEligible,
  executePayrollNpsEngine,
  registerPayrollFinalizedNpsListener,
} from './payroll-triggered-nps-engine.mjs';

describe('⚡ KYLRX AI PAYROLL-TRIGGERED NPS CALCULATION ENGINE TEST SUITE', () => {

  describe('1. Eligibility Filtering & Exit Date Verification', () => {
    it('Should include active employees where nps_applicable === true', () => {
      const profile = {
        employee_id: 'EMP_NPS_ELIGIBLE_01',
        nps_applicable: true,
        joining_date: '2022-01-01',
        exit_date: null,
      };

      assert.equal(isEmployeeNPSEligible(profile, '2026-09-01'), true);
    });

    it('Should exclude employees where nps_applicable === false', () => {
      const profile = {
        employee_id: 'EMP_NPS_INELIGIBLE_02',
        nps_applicable: false,
        joining_date: '2022-01-01',
        exit_date: null,
      };

      assert.equal(isEmployeeNPSEligible(profile, '2026-09-01'), false);
    });

    it('Should exclude employees who exited prior to the payroll period', () => {
      const profileExited = {
        employee_id: 'EMP_NPS_EXITED_03',
        nps_applicable: true,
        joining_date: '2020-01-01',
        exit_date: '2026-07-31', // Exited in July, checking September
      };

      assert.equal(isEmployeeNPSEligible(profileExited, '2026-09-01'), false);
    });

    it('Should include employees who exited during or after the payroll period', () => {
      const profileExitedInMonth = {
        employee_id: 'EMP_NPS_EXIT_SEPT_04',
        nps_applicable: true,
        joining_date: '2020-01-01',
        exit_date: '2026-09-20', // Exited within September
      };

      assert.equal(isEmployeeNPSEligible(profileExitedInMonth, '2026-09-01'), true);
    });
  });

  describe('2. Contribution Calculations & Dynamic Salary Basis', () => {
    it('Should compute 10% ER, 10% EE, and voluntary contributions accurately', () => {
      const employees = [
        {
          employee_id: 'EMP_NPS_STD_01',
          pran: '110022334455', // Valid 12 digits
          nps_applicable: true,
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          voluntary_monthly_amount: 4167,
          joining_date: '2022-01-01',
          exit_date: null,
        }
      ];

      const earnings = {
        EMP_NPS_STD_01: {
          basic: 60000,
          da: 15000, // Salary basis = 75,000
          hra: 25000,
          gross: 100000,
          net: 85000,
        }
      };

      const result = executePayrollNpsEngine({
        run_id: 'RUN_NPS_202609_01',
        period: 'September 2026',
        employee_profiles: employees,
        earnings_by_employee: earnings,
      });

      assert.equal(result.total_candidates, 1);
      assert.equal(result.eligible_count, 1);
      assert.equal(result.blocked_count, 0);
      assert.equal(result.compliant_records.length, 1);

      const record = result.compliant_records[0];
      assert.equal(record.salary_basis, 75000);
      assert.equal(record.employer_contribution, 7500); // 10% of 75k
      assert.equal(record.employee_mandatory_deduction, 7500); // 10% of 75k
      assert.equal(record.employee_voluntary_contribution, 4167);
      assert.equal(record.total_employee_contribution, 11667);
      assert.equal(record.total_nps_contribution, 19167);
      assert.equal(record.sec80ccd1b_applicable_amount, 4167);
      assert.equal(record.policy_config_id, 'NPS_CORP_STD_TIER1_V1');
    });
  });

  describe('3. Boundary Guards: PRAN Format, Net Earnings & Zero Salary', () => {
    it('Should block employee missing 12-digit PRAN and dispatch HR task', () => {
      assert.equal(isValidPran('110022334455'), true);
      assert.equal(isValidPran('12345'), false); // Too short
      assert.equal(isValidPran('11002233445A'), false); // Non-numeric

      const employees = [
        {
          employee_id: 'EMP_BAD_PRAN_01',
          pran: '12345', // Malformed
          nps_applicable: true,
          tier: 'TIER_1',
          joining_date: '2022-01-01',
          exit_date: null,
        }
      ];

      const earnings = {
        EMP_BAD_PRAN_01: { basic: 50000, da: 10000, net: 45000 }
      };

      const result = executePayrollNpsEngine({
        run_id: 'RUN_NPS_BAD_PRAN',
        period: 'September 2026',
        employee_profiles: employees,
        earnings_by_employee: earnings,
      });

      assert.equal(result.compliant_records.length, 0);
      assert.equal(result.validation_issues.length, 1);

      const issue = result.validation_issues[0];
      assert.equal(issue.code, 'STAT_NPS_INVALID_PRAN');
      assert.equal(issue.severity, 'BLOCK');
      assert.equal(issue.field, 'pran');

      assert.equal(result.hr_tasks.length, 1);
      assert.equal(result.hr_tasks[0].assigned_role, 'HR_COMPLIANCE_OFFICER');
    });

    it('Should block employee whose voluntary deduction exceeds available net earnings', () => {
      const employees = [
        {
          employee_id: 'EMP_EXCESS_VOLUNTARY',
          pran: '110033445566',
          nps_applicable: true,
          tier: 'TIER_1',
          contribution_type: 'BOTH',
          voluntary_monthly_amount: 80000, // Excess
          joining_date: '2022-01-01',
          exit_date: null,
        }
      ];

      const earnings = {
        EMP_EXCESS_VOLUNTARY: { basic: 40000, da: 10000, gross: 50000, net: 35000 }
      };

      const result = executePayrollNpsEngine({
        run_id: 'RUN_NPS_EXCESS_VOL',
        period: 'September 2026',
        employee_profiles: employees,
        earnings_by_employee: earnings,
      });

      assert.equal(result.compliant_records.length, 0);
      assert.equal(result.validation_issues.length, 1);
      assert.equal(result.validation_issues[0].sub_code, 'DEDUCTION_EXCEEDS_NET_EARNINGS');
    });

    it('Should block employee with zero or negative salary basis', () => {
      const employees = [
        {
          employee_id: 'EMP_ZERO_SALARY',
          pran: '110033445577',
          nps_applicable: true,
          tier: 'TIER_1',
          joining_date: '2022-01-01',
          exit_date: null,
        }
      ];

      const earnings = {
        EMP_ZERO_SALARY: { basic: 0, da: 0, net: 0 }
      };

      const result = executePayrollNpsEngine({
        run_id: 'RUN_NPS_ZERO_SAL',
        period: 'September 2026',
        employee_profiles: employees,
        earnings_by_employee: earnings,
      });

      assert.equal(result.compliant_records.length, 0);
      assert.equal(result.validation_issues.length, 1);
      assert.equal(result.validation_issues[0].sub_code, 'ZERO_OR_NEGATIVE_SALARY_BASIS');
    });
  });

  describe('4. EventBus PAYROLL_FINALIZED Automated Listener Integration', () => {
    it('Should automatically trigger NPS engine on PAYROLL_FINALIZED event', async () => {
      const eventBus = new EventEmitter();
      let completedBatch = null;

      const unsubscribe = registerPayrollFinalizedNpsListener(eventBus, {}, {
        onCalculationComplete: async (res) => {
          completedBatch = res;
        }
      });

      const eventPayload = {
        run_id: 'RUN_SEP2026_EVENT_TEST',
        period: 'September 2026',
        employees: [
          {
            employee_id: 'EMP_EVENT_01',
            pran: '110055667788',
            nps_applicable: true,
            tier: 'TIER_1',
            contribution_type: 'BOTH',
            voluntary_monthly_amount: 0,
            joining_date: '2022-01-01',
            exit_date: null,
          }
        ],
        earnings: {
          EMP_EVENT_01: { basic: 70000, da: 10000, gross: 90000, net: 75000 }
        }
      };

      eventBus.emit('PAYROLL_FINALIZED', eventPayload);

      // Yield event loop
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.ok(completedBatch);
      assert.equal(completedBatch.run_id, 'RUN_SEP2026_EVENT_TEST');
      assert.equal(completedBatch.compliant_records.length, 1);
      assert.equal(completedBatch.total_employer_contributions, 8000); // 10% of 80k
      assert.equal(completedBatch.total_employee_deductions, 8000);

      unsubscribe();
    });
  });
});
