/**
 * ============================================================================
 * TEST SUITE: GRATUITY POLICY RESOLVER & STATUTORY ENGINE
 * ============================================================================
 * Tests:
 *  1. Effective-Dated Policy Resolver (Pre-2018 vs Post-2018 Amendments & Bounds)
 *  2. Tenure Calculation & Service Rounding Rules (Half-Year, Exact, Full Years)
 *  3. Vesting Evaluation & Death/Disability Statutory Exemption Bypass
 *  4. Gratuity Calculation, Formula Multipliers, & Statutory ₹20L Cap
 *  5. Nominee Distribution & Share Allocation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GRATUITY_POLICIES,
  NoActiveGratuityPolicyError,
  resolveActiveGratuityPolicy,
  calculateGratuityTenure,
  evaluateGratuityVesting,
  calculateNomineeAllocations,
  calculateEmployeeGratuity,
  normalizeDateToIso,
} from './gratuity-policy-resolver-service.mjs';

describe('⚡ KYLRX AI GRATUITY POLICY RESOLVER & STATUTORY ENGINE TEST SUITE', () => {

  describe('1. Effective-Dated Policy Resolver', () => {
    it('Should resolve active 2018 policy (GRAT_POL_2018_V2) for current/future dates with ₹20L cap', () => {
      const policy = resolveActiveGratuityPolicy('2026-09-04');

      assert.equal(policy.config_id, 'GRAT_POL_2018_V2');
      assert.equal(policy.statutory_tax_free_cap, 2000000);
      assert.equal(policy.days_per_year_factor, 15);
      assert.equal(policy.working_days_divisor, 26);
      assert.equal(policy.min_vesting_days, 1825);
      assert.equal(policy.death_disability_bypass_vesting, true);
    });

    it('Should resolve historical pre-2018 policy (GRAT_POL_1997_V1) for pre-amendment dates with ₹10L cap', () => {
      const policy = resolveActiveGratuityPolicy('2015-06-30');

      assert.equal(policy.config_id, 'GRAT_POL_1997_V1');
      assert.equal(policy.statutory_tax_free_cap, 1000000);
      assert.equal(policy.version, 1);
    });

    it('Should throw NoActiveGratuityPolicyError when date is prior to any configured policy', () => {
      assert.throws(
        () => resolveActiveGratuityPolicy('1990-01-01'),
        (err) => {
          assert.ok(err instanceof NoActiveGratuityPolicyError);
          assert.match(err.message, /No active Gratuity policy configuration found/);
          return true;
        }
      );
    });

    it('Should normalize multiple date input formats (ISO, DD/MM/YYYY, Date object)', () => {
      assert.equal(normalizeDateToIso('15/09/2026'), '2026-09-15');
      assert.equal(normalizeDateToIso('2026-09-15'), '2026-09-15');
      assert.equal(normalizeDateToIso('2026-09'), '2026-09-01');
      assert.equal(normalizeDateToIso(new Date('2026-09-15T00:00:00Z')), '2026-09-15');
    });
  });

  describe('2. Service Tenure & Rounding Rules', () => {
    it('Should apply ROUND_NEAREST_HALF_YEAR rule: 5y 7m rounds UP to 6 years', () => {
      const tenure = calculateGratuityTenure({
        date_of_joining: '2020-01-01',
        date_of_exit: '2025-08-15', // 5 years, 7 months, 14 days
        service_rounding_rule: 'ROUND_NEAREST_HALF_YEAR',
      });

      assert.equal(tenure.tenure_years_statutory, 6);
      assert.ok(tenure.tenure_days > 2000);
    });

    it('Should apply ROUND_NEAREST_HALF_YEAR rule: 5y 4m rounds DOWN to 5 years', () => {
      const tenure = calculateGratuityTenure({
        date_of_joining: '2020-01-01',
        date_of_exit: '2025-05-01', // 5 years, 4 months
        service_rounding_rule: 'ROUND_NEAREST_HALF_YEAR',
      });

      assert.equal(tenure.tenure_years_statutory, 5);
    });

    it('Should support COMPLETED_FULL_YEARS rule', () => {
      const tenure = calculateGratuityTenure({
        date_of_joining: '2020-01-01',
        date_of_exit: '2025-11-30', // 5 years 11 months
        service_rounding_rule: 'COMPLETED_FULL_YEARS',
      });

      assert.equal(tenure.tenure_years_statutory, 5);
    });

    it('Should support EXACT_FRACTION rule', () => {
      const tenure = calculateGratuityTenure({
        date_of_joining: '2020-01-01',
        date_of_exit: '2025-01-01',
        service_rounding_rule: 'EXACT_FRACTION',
      });

      assert.ok(Math.abs(tenure.tenure_years_statutory - 5.0) < 0.05);
    });

    it('Should reject inverted tenure dates', () => {
      assert.throws(
        () => calculateGratuityTenure({
          date_of_joining: '2025-01-01',
          date_of_exit: '2020-01-01',
        }),
        { message: /cannot be earlier than date_of_joining/ }
      );
    });
  });

  describe('3. Vesting & Death/Disability Statutory Bypass', () => {
    const activePolicy = DEFAULT_GRATUITY_POLICIES[1]; // 2018 policy

    it('Should mark employee not vested if tenure is under 5 years on RESIGNATION', () => {
      const vesting = evaluateGratuityVesting({
        tenure_days: 1095, // 3 years
        exit_reason: 'RESIGNATION',
        policy: activePolicy,
      });

      assert.equal(vesting.is_vested, false);
      assert.equal(vesting.vesting_bypass_reason, null);
    });

    it('Should mark employee vested if tenure is >= 5 years (1825 days) on RESIGNATION', () => {
      const vesting = evaluateGratuityVesting({
        tenure_days: 1900,
        exit_reason: 'RESIGNATION',
        policy: activePolicy,
      });

      assert.equal(vesting.is_vested, true);
    });

    it('Should bypass 5-year vesting requirement on DEATH', () => {
      const vesting = evaluateGratuityVesting({
        tenure_days: 365, // Only 1 year of service
        exit_reason: 'DEATH',
        policy: activePolicy,
      });

      assert.equal(vesting.is_vested, true);
      assert.equal(vesting.vesting_bypass_reason, 'STATUTORY_EXEMPTION_DEATH');
    });

    it('Should bypass 5-year vesting requirement on DISABILITY', () => {
      const vesting = evaluateGratuityVesting({
        tenure_days: 730, // 2 years
        exit_reason: 'DISABILITY',
        policy: activePolicy,
      });

      assert.equal(vesting.is_vested, true);
      assert.equal(vesting.vesting_bypass_reason, 'STATUTORY_EXEMPTION_DISABILITY');
    });
  });

  describe('4. Gratuity Calculation & Statutory Tax-Free Cap', () => {
    it('Should compute full gratuity using formula (15 * (Basic + DA) * Years) / 26', () => {
      // Basic: 50,000, DA: 10,000 -> Total: 60,000
      // 6 years service
      // Expected = (15 * 60,000 * 6) / 26 = 5,400,000 / 26 = 207692.307 -> 207692
      const profile = {
        employee_id: 'EMP_GRAT_001',
        date_of_joining: '2020-01-01',
        date_of_exit: '2026-01-01', // 6 years
        exit_reason: 'RESIGNATION',
        last_drawn_basic: 50000,
        last_drawn_da: 10000,
        nominees: [],
      };

      const result = calculateEmployeeGratuity(profile);

      assert.equal(result.is_vested, true);
      assert.equal(result.tenure_years_statutory, 6);
      assert.equal(result.last_drawn_wages, 60000);
      assert.equal(result.raw_gratuity_amount, 207692);
      assert.equal(result.statutory_tax_free_amount, 207692);
      assert.equal(result.taxable_excess_amount, 0);
      assert.equal(result.payable_gratuity_amount, 207692);
    });

    it('Should enforce ₹20,00,000 statutory tax-free cap and compute taxable excess', () => {
      // High earner: Basic 2,00,000, DA 50,000 -> 2,50,000
      // 20 years service
      // Raw = (15 * 250,000 * 20) / 26 = 75,000,000 / 26 = 2,884,615
      const profile = {
        employee_id: 'EMP_EXEC_001',
        date_of_joining: '2006-01-01',
        date_of_exit: '2026-01-01',
        exit_reason: 'RETIREMENT',
        last_drawn_basic: 200000,
        last_drawn_da: 50000,
        nominees: [],
      };

      const result = calculateEmployeeGratuity(profile);

      assert.equal(result.raw_gratuity_amount, 2884615);
      assert.equal(result.statutory_tax_free_amount, 2000000);
      assert.equal(result.taxable_excess_amount, 884615);
      assert.equal(result.payable_gratuity_amount, 2884615);
    });

    it('Should yield 0 payable gratuity if employee is unvested upon resignation', () => {
      const profile = {
        employee_id: 'EMP_UNVESTED_001',
        date_of_joining: '2024-01-01',
        date_of_exit: '2026-01-01', // 2 years
        exit_reason: 'RESIGNATION',
        last_drawn_basic: 40000,
        last_drawn_da: 0,
        nominees: [],
      };

      const result = calculateEmployeeGratuity(profile);

      assert.equal(result.is_vested, false);
      assert.ok(result.raw_gratuity_amount > 0);
      assert.equal(result.payable_gratuity_amount, 0);
    });
  });

  describe('5. Nominee Allocations & Beneficiary Splitting', () => {
    it('Should correctly allocate gratuity payout across declared nominees', () => {
      const nominees = [
        { nominee_name: 'Meera Sharma', relationship: 'SPOUSE', share_percentage: 60 },
        { nominee_name: 'Aarav Sharma', relationship: 'SON', share_percentage: 40 },
      ];

      const allocations = calculateNomineeAllocations(500000, nominees);

      assert.equal(allocations.length, 2);
      assert.equal(allocations[0].nominee_name, 'Meera Sharma');
      assert.equal(allocations[0].allocated_amount, 300000);
      assert.equal(allocations[1].nominee_name, 'Aarav Sharma');
      assert.equal(allocations[1].allocated_amount, 200000);
    });

    it('Should allocate 100% to beneficiaries in Death claim scenario', () => {
      const profile = {
        employee_id: 'EMP_DEATH_CLAIM',
        date_of_joining: '2024-01-01',
        date_of_exit: '2025-01-01', // 1 year
        exit_reason: 'DEATH',
        last_drawn_basic: 52000,
        last_drawn_da: 0,
        nominees: [
          { nominee_name: 'Sunita Devi', relationship: 'MOTHER', share_percentage: 100 },
        ],
      };

      const result = calculateEmployeeGratuity(profile);

      assert.equal(result.is_vested, true);
      assert.equal(result.vesting_bypass_reason, 'STATUTORY_EXEMPTION_DEATH');
      assert.equal(result.nominee_allocations.length, 1);
      assert.equal(result.nominee_allocations[0].allocated_amount, result.payable_gratuity_amount);
    });
  });
});
