/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC STATUTORY CONFIGURATION ENGINE TEST SUITE
 * ============================================================================
 * Comprehensive unit and integration tests for:
 *  1. Effective-Dated ESIC Policy Resolution & Error Gating
 *  2. Standard vs Disability Wage Thresholds (₹21k vs ₹25k)
 *  3. Dynamic Calculation without Hardcoded Rates (0.75% / 3.25% vs 1.75% / 4.75%)
 *  4. Rounding Rules & Profile Temporal Lifecycle Validation
 *  5. Full Batch Aggregation & Challan Computation
 *
 * @version 3.0.0
 * @author Kylrx AI Principal QA & Systems Architecture Team
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ESIC_POLICIES,
  NoActiveEsicPolicyError,
  normalizeDate,
  resolveEsicPolicy,
  applyRoundingRule,
  evaluateEmployeeESICEligibility,
  calculateEmployeeESIC,
  calculateBatchESIC,
} from './esic-policy-resolver-service.mjs';

describe('🏛️ KYLRX AI ESIC STATUTORY CONFIGURATION ENGINE TEST SUITE', () => {

  describe('1. Date Normalization & Parsing', () => {
    it('Should normalize YYYY-MM-DD strings', () => {
      assert.strictEqual(normalizeDate('2026-09-01'), '2026-09-01');
      assert.strictEqual(normalizeDate('2026-09-30'), '2026-09-30');
    });

    it('Should normalize YYYY-MM strings to the 1st of the month', () => {
      assert.strictEqual(normalizeDate('2026-09'), '2026-09-01');
    });

    it('Should normalize Month YYYY text representation', () => {
      assert.strictEqual(normalizeDate('September 2026'), '2026-09-01');
      assert.strictEqual(normalizeDate('Aug 2026'), '2026-08-01');
    });

    it('Should normalize native Date instances', () => {
      const d = new Date('2026-09-15T00:00:00.000Z');
      assert.strictEqual(normalizeDate(d), '2026-09-15');
    });

    it('Should throw error on empty or invalid date input', () => {
      assert.throws(() => normalizeDate(''), /Date parameter is required/);
      assert.throws(() => normalizeDate('not-a-valid-date-string-xyz'), /Unable to normalize date format/);
    });
  });

  describe('2. Effective-Dated Policy Resolver Service', () => {
    it('Should resolve the current active gazetted policy (Post-July 2019) for 2026-09-01', () => {
      const activePolicy = resolveEsicPolicy('2026-09-01');
      assert.strictEqual(activePolicy.config_id, 'ESIC_POL_2019_CURRENT');
      assert.strictEqual(activePolicy.employee_rate, 0.0075);
      assert.strictEqual(activePolicy.employer_rate, 0.0325);
      assert.strictEqual(activePolicy.wage_ceiling_standard, 21000);
      assert.strictEqual(activePolicy.wage_ceiling_disabled, 25000);
      assert.strictEqual(activePolicy.rounding_rule, 'NEAREST_RUPEE');
    });

    it('Should resolve historical policy for pre-2019 periods', () => {
      const historicalPolicy = resolveEsicPolicy('2018-05-15');
      assert.strictEqual(historicalPolicy.config_id, 'ESIC_POL_2017');
      assert.strictEqual(historicalPolicy.employee_rate, 0.0175); // Historical 1.75%
      assert.strictEqual(historicalPolicy.employer_rate, 0.0475); // Historical 4.75%
      assert.strictEqual(historicalPolicy.wage_ceiling_standard, 21000);
    });

    it('Should resolve historical policy for pre-2017 periods with 15k ceiling', () => {
      const earlyPolicy = resolveEsicPolicy('2015-10-01');
      assert.strictEqual(earlyPolicy.config_id, 'ESIC_POL_1997');
      assert.strictEqual(earlyPolicy.wage_ceiling_standard, 15000);
      assert.strictEqual(earlyPolicy.employee_rate, 0.0175);
      assert.strictEqual(earlyPolicy.employer_rate, 0.0475);
    });

    it('Should abort calculation and throw NoActiveEsicPolicyError if date has no active policy rule', () => {
      const restrictedRegistry = [
        {
          config_id: 'CUSTOM_POL_2025',
          effective_from: '2025-01-01',
          effective_to: '2025-12-31',
          wage_ceiling_standard: 21000,
          wage_ceiling_disabled: 25000,
          employee_rate: 0.0075,
          employer_rate: 0.0325,
          rounding_rule: 'NEAREST_RUPEE',
        }
      ];

      // Querying date in 2026 outside the restricted policy window
      assert.throws(
        () => resolveEsicPolicy('2026-09-01', restrictedRegistry),
        (err) => {
          assert.ok(err instanceof NoActiveEsicPolicyError);
          assert.strictEqual(err.code, 'NO_ACTIVE_ESIC_POLICY');
          assert.ok(err.message.includes('No active ESIC policy configuration rule found'));
          return true;
        }
      );
    });
  });

  describe('3. Employee Eligibility & Dual Wage Ceilings (Standard vs Disabled)', () => {
    const activePolicy = resolveEsicPolicy('2026-09-01');

    it('Should cover standard employee with wages <= ₹21,000', () => {
      const profile = {
        employee_id: 'EMP_STD_001',
        esic_number: '31000123450000001',
        esic_applicable: true,
        date_of_joining: '2024-01-01',
        date_of_exit: null,
        disability_flag: false,
        effective_from: '2024-01-01',
        effective_to: null,
      };

      const result = evaluateEmployeeESICEligibility(profile, 20000, '2026-09-01', activePolicy);
      assert.strictEqual(result.is_eligible, true);
      assert.strictEqual(result.reason, 'COVERED');
      assert.strictEqual(result.applicable_ceiling, 21000);
      assert.strictEqual(result.is_disabled_scheme, false);
    });

    it('Should exempt standard employee with wages > ₹21,000 (Wage Ceiling Exceeded)', () => {
      const profile = {
        employee_id: 'EMP_STD_002',
        esic_number: '31000123450000002',
        esic_applicable: true,
        date_of_joining: '2024-01-01',
        date_of_exit: null,
        disability_flag: false,
        effective_from: '2024-01-01',
        effective_to: null,
      };

      const result = evaluateEmployeeESICEligibility(profile, 21050, '2026-09-01', activePolicy);
      assert.strictEqual(result.is_eligible, false);
      assert.ok(result.reason.includes('WAGE_CEILING_EXCEEDED'));
      assert.strictEqual(result.applicable_ceiling, 21000);
    });

    it('Should cover employee with disability under enhanced ₹25,000 ceiling', () => {
      const disabledProfile = {
        employee_id: 'EMP_DIS_001',
        esic_number: '31000123450000003',
        esic_applicable: true,
        date_of_joining: '2024-01-01',
        date_of_exit: null,
        disability_flag: true, // Triggers Section 39 enhanced threshold
        effective_from: '2024-01-01',
        effective_to: null,
      };

      // ₹24,000 is > 21k standard ceiling, but <= 25k disabled ceiling
      const result = evaluateEmployeeESICEligibility(disabledProfile, 24000, '2026-09-01', activePolicy);
      assert.strictEqual(result.is_eligible, true);
      assert.strictEqual(result.applicable_ceiling, 25000);
      assert.strictEqual(result.is_disabled_scheme, true);
    });

    it('Should exempt disabled employee if wages exceed ₹25,000', () => {
      const disabledProfile = {
        employee_id: 'EMP_DIS_002',
        esic_number: '31000123450000004',
        esic_applicable: true,
        date_of_joining: '2024-01-01',
        date_of_exit: null,
        disability_flag: true,
        effective_from: '2024-01-01',
        effective_to: null,
      };

      const result = evaluateEmployeeESICEligibility(disabledProfile, 25500, '2026-09-01', activePolicy);
      assert.strictEqual(result.is_eligible, false);
      assert.ok(result.reason.includes('WAGE_CEILING_EXCEEDED'));
      assert.strictEqual(result.applicable_ceiling, 25000);
    });

    it('Should exempt employee if profile is marked esic_applicable: false', () => {
      const optOutProfile = {
        employee_id: 'EMP_OPT_001',
        esic_number: '',
        esic_applicable: false,
        date_of_joining: '2024-01-01',
        date_of_exit: null,
        disability_flag: false,
        effective_from: '2024-01-01',
        effective_to: null,
      };

      const result = evaluateEmployeeESICEligibility(optOutProfile, 15000, '2026-09-01', activePolicy);
      assert.strictEqual(result.is_eligible, false);
      assert.strictEqual(result.reason, 'EXPLICITLY_NOT_APPLICABLE');
    });

    it('Should exempt employee who joined after the payroll period', () => {
      const futureJoiner = {
        employee_id: 'EMP_FUT_001',
        esic_number: '31000123450000005',
        esic_applicable: true,
        date_of_joining: '2026-10-01', // Joining next month
        date_of_exit: null,
        disability_flag: false,
        effective_from: '2026-10-01',
        effective_to: null,
      };

      const result = evaluateEmployeeESICEligibility(futureJoiner, 18000, '2026-09-01', activePolicy);
      assert.strictEqual(result.is_eligible, false);
      assert.ok(result.reason.includes('JOINED_AFTER_PERIOD') || result.reason.includes('PROFILE_NOT_YET_EFFECTIVE'));
    });
  });

  describe('4. Dynamic Rate Calculation & Rounding Engine', () => {
    it('Should calculate exact 0.75% EE and 3.25% ER contributions for active period using NEAREST_RUPEE rounding', () => {
      const profile = {
        employee_id: 'EMP_CALC_001',
        esic_number: '31000123450000010',
        esic_applicable: true,
        date_of_joining: '2024-01-01',
        date_of_exit: null,
        disability_flag: false,
        effective_from: '2024-01-01',
        effective_to: null,
      };

      // Gross Wages = ₹18,450
      // EE = 18450 * 0.0075 = 138.375 -> Nearest Rupee: ₹138
      // ER = 18450 * 0.0325 = 599.625 -> Nearest Rupee: ₹600
      // Total = 138 + 600 = ₹738
      const calc = calculateEmployeeESIC(profile, 18450, '2026-09-01');

      assert.strictEqual(calc.is_covered, true);
      assert.strictEqual(calc.employee_rate_applied, 0.0075);
      assert.strictEqual(calc.employer_rate_applied, 0.0325);
      assert.strictEqual(calc.employee_contribution, 138);
      assert.strictEqual(calc.employer_contribution, 600);
      assert.strictEqual(calc.total_contribution, 738);
      assert.strictEqual(calc.rounding_rule_applied, 'NEAREST_RUPEE');
    });

    it('Should dynamically adapt to custom policy with different rates (e.g. 1.0% EE, 4.0% ER, ROUND_UP)', () => {
      const customPolicy = [
        {
          config_id: 'CUSTOM_FUTURE_ESIC',
          effective_from: '2027-01-01',
          effective_to: null,
          wage_ceiling_standard: 30000,
          wage_ceiling_disabled: 35000,
          employee_rate: 0.010, // 1.0%
          employer_rate: 0.040, // 4.0%
          rounding_rule: 'ROUND_UP',
        }
      ];

      const profile = {
        employee_id: 'EMP_CUSTOM_001',
        esic_number: '31000123450000020',
        esic_applicable: true,
        date_of_joining: '2024-01-01',
        date_of_exit: null,
        disability_flag: false,
        effective_from: '2024-01-01',
        effective_to: null,
      };

      // Gross = ₹24,550
      // EE = 24550 * 0.010 = 245.50 -> ROUND_UP: ₹246
      // ER = 24550 * 0.040 = 982.00 -> ROUND_UP: ₹982
      const calc = calculateEmployeeESIC(profile, 24550, '2027-04-01', customPolicy);

      assert.strictEqual(calc.is_covered, true);
      assert.strictEqual(calc.employee_rate_applied, 0.010);
      assert.strictEqual(calc.employer_rate_applied, 0.040);
      assert.strictEqual(calc.employee_contribution, 246);
      assert.strictEqual(calc.employer_contribution, 982);
      assert.strictEqual(calc.total_contribution, 1228);
    });

    it('Should test all rounding modes', () => {
      assert.strictEqual(applyRoundingRule(138.49, 'NEAREST_RUPEE'), 138);
      assert.strictEqual(applyRoundingRule(138.51, 'NEAREST_RUPEE'), 139);
      assert.strictEqual(applyRoundingRule(138.01, 'ROUND_UP'), 139);
      assert.strictEqual(applyRoundingRule(138.99, 'ROUND_DOWN'), 138);
      assert.strictEqual(applyRoundingRule(138.456, 'NO_ROUNDING'), 138.46);
    });
  });

  describe('5. Batch ESIC Return & Challan Aggregator', () => {
    it('Should aggregate entire workforce payroll records into compliant ESIC summary', () => {
      const profiles = [
        {
          employee_id: 'EMP001',
          esic_number: '31000123450000101',
          esic_applicable: true,
          date_of_joining: '2023-01-01',
          date_of_exit: null,
          disability_flag: false,
          effective_from: '2023-01-01',
          effective_to: null,
        },
        {
          employee_id: 'EMP002',
          esic_number: '31000123450000102',
          esic_applicable: true,
          date_of_joining: '2023-01-01',
          date_of_exit: null,
          disability_flag: true, // Disabled, covered up to 25k
          effective_from: '2023-01-01',
          effective_to: null,
        },
        {
          employee_id: 'EMP003',
          esic_number: '31000123450000103',
          esic_applicable: true,
          date_of_joining: '2023-01-01',
          date_of_exit: null,
          disability_flag: false, // Standard, 35k exceeds ceiling -> Exempt
          effective_from: '2023-01-01',
          effective_to: null,
        },
      ];

      const records = [
        { employee_id: 'EMP001', gross_wages: 16000 }, // Covered (EE: 120, ER: 520)
        { employee_id: 'EMP002', gross_wages: 24000 }, // Covered (EE: 180, ER: 780)
        { employee_id: 'EMP003', gross_wages: 35000 }, // Exempt (Gross > 21k)
      ];

      const batchSummary = calculateBatchESIC(profiles, records, 'September 2026');

      assert.strictEqual(batchSummary.total_headcount, 3);
      assert.strictEqual(batchSummary.total_covered_employees, 2);
      assert.strictEqual(batchSummary.total_exempt_employees, 1);
      assert.strictEqual(batchSummary.total_statutory_wages, 40000); // 16000 + 24000
      assert.strictEqual(batchSummary.total_employee_deductions, 300); // 120 + 180
      assert.strictEqual(batchSummary.total_employer_contributions, 1300); // 520 + 780
      assert.strictEqual(batchSummary.total_challan_amount, 1600); // 300 + 1300
    });
  });

});
