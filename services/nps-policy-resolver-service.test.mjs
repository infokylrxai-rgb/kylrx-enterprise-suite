/**
 * ============================================================================
 * TEST SUITE: CORPORATE NPS POLICY RESOLVER & STATUTORY SERVICE
 * ============================================================================
 * Tests:
 *  1. Effective-Dated NPS Policy Resolver (Tier 1 Standard vs Govt/PSU vs Tier 2)
 *  2. Date Normalization & Multi-Format Support
 *  3. Dynamic Salary Basis Extraction (Basic + DA)
 *  4. Co-Contribution Rules (BOTH, EMPLOYER_ONLY, EMPLOYEE_ONLY)
 *  5. Voluntary Contributions & Section 80CCD(1B) Cap Evaluation
 *  6. Rounding Rules Engine (Nearest Rupee, Round Up, Round Down)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NPS_POLICIES,
  NoActiveNPSPolicyError,
  resolveActiveNPSPolicy,
  normalizeNPSDateToIso,
  computeNPSSalaryBasis,
  applyNPSRounding,
  calculateEmployeeNPS,
} from './nps-policy-resolver-service.mjs';

describe('⚡ KYLRX AI CORPORATE NPS POLICY RESOLVER & STATUTORY SERVICE TEST SUITE', () => {

  describe('1. Effective-Dated Policy Resolver', () => {
    it('Should resolve standard Corporate NPS Tier 1 policy (10% co-contribution)', () => {
      const policy = resolveActiveNPSPolicy('TIER_1', '2026-09-01');

      assert.equal(policy.config_id, 'NPS_CORP_STD_TIER1_V1');
      assert.equal(policy.tier_type, 'TIER_1');
      assert.equal(policy.employer_rate_percentage, 10);
      assert.equal(policy.employee_default_rate, 10);
      assert.equal(policy.annual_sec80ccd1b_cap, 50000);
      assert.deepEqual(policy.salary_basis_components, ['BASIC', 'DA']);
    });

    it('Should resolve Tier 2 voluntary savings policy with 0% employer rate', () => {
      const policy = resolveActiveNPSPolicy('TIER_2', '2026-09-01');

      assert.equal(policy.config_id, 'NPS_CORP_STD_TIER2_V1');
      assert.equal(policy.tier_type, 'TIER_2');
      assert.equal(policy.employer_rate_percentage, 0);
      assert.equal(policy.employee_default_rate, 10);
    });

    it('Should resolve explicit policy config_id when specified in profile', () => {
      const profile = {
        employee_id: 'EMP_GOVT_01',
        tier: 'TIER_1',
        config_id: 'NPS_CORP_GOVT_TIER1_V1',
      };

      const policy = resolveActiveNPSPolicy(profile, '2026-09-01');
      assert.equal(policy.config_id, 'NPS_CORP_GOVT_TIER1_V1');
      assert.equal(policy.employer_rate_percentage, 14);
    });

    it('Should throw NoActiveNPSPolicyError for unconfigured dates', () => {
      assert.throws(
        () => resolveActiveNPSPolicy('TIER_1', '1995-01-01'),
        (err) => {
          assert.ok(err instanceof NoActiveNPSPolicyError);
          assert.match(err.message, /No active Corporate NPS policy found/);
          return true;
        }
      );
    });
  });

  describe('2. Date Normalization & Multi-Format Handling', () => {
    it('Should normalize ISO, DD/MM/YYYY, Month-Year, and Date objects', () => {
      assert.equal(normalizeNPSDateToIso('2026-09-15'), '2026-09-15');
      assert.equal(normalizeNPSDateToIso('15/09/2026'), '2026-09-15');
      assert.equal(normalizeNPSDateToIso('September 2026'), '2026-09-01');
      assert.equal(normalizeNPSDateToIso('August 2026'), '2026-08-01');
      assert.equal(normalizeNPSDateToIso(new Date('2026-09-01T00:00:00Z')), '2026-09-01');
    });
  });

  describe('3. Dynamic Salary Basis Extraction', () => {
    it('Should sum Basic + DA components and ignore HRA / Special Allowance', () => {
      const earnings = {
        basic: 60000,
        da: 15000,
        hra: 25000,
        special_allowance: 18000,
      };

      const basis = computeNPSSalaryBasis(earnings, ['BASIC', 'DA']);
      assert.equal(basis.salary_basis, 75000);
      assert.deepEqual(basis.components_used, ['BASIC', 'DA']);
    });
  });

  describe('4. Co-Contribution Rules & Calculations', () => {
    const earnings = { basic: 50000, da: 10000 }; // Basis = 60,000

    it('Should compute BOTH contributions: 10% ER (₹6,000) and 10% EE (₹6,000)', () => {
      const profile = {
        employee_id: 'EMP_NPS_BOTH',
        pran: '110099887766',
        tier: 'TIER_1',
        contribution_type: 'BOTH',
        voluntary_monthly_amount: 0,
      };

      const result = calculateEmployeeNPS(profile, earnings, 'September 2026');

      assert.equal(result.salary_basis, 60000);
      assert.equal(result.employer_contribution, 6000);
      assert.equal(result.employee_mandatory_deduction, 6000);
      assert.equal(result.employee_voluntary_contribution, 0);
      assert.equal(result.total_employee_contribution, 6000);
      assert.equal(result.total_nps_contribution, 12000);
    });

    it('Should compute EMPLOYER_ONLY co-contribution without employee deduction', () => {
      const profile = {
        employee_id: 'EMP_NPS_ER_ONLY',
        pran: '110099887755',
        tier: 'TIER_1',
        contribution_type: 'EMPLOYER_ONLY',
        voluntary_monthly_amount: 0,
      };

      const result = calculateEmployeeNPS(profile, earnings, 'September 2026');

      assert.equal(result.employer_contribution, 6000);
      assert.equal(result.employee_mandatory_deduction, 0);
      assert.equal(result.total_employee_contribution, 0);
      assert.equal(result.total_nps_contribution, 6000);
    });

    it('Should compute EMPLOYEE_ONLY deduction without employer co-contribution', () => {
      const profile = {
        employee_id: 'EMP_NPS_EE_ONLY',
        pran: '110099887744',
        tier: 'TIER_1',
        contribution_type: 'EMPLOYEE_ONLY',
        voluntary_monthly_amount: 0,
      };

      const result = calculateEmployeeNPS(profile, earnings, 'September 2026');

      assert.equal(result.employer_contribution, 0);
      assert.equal(result.employee_mandatory_deduction, 6000);
      assert.equal(result.total_employee_contribution, 6000);
      assert.equal(result.total_nps_contribution, 6000);
    });
  });

  describe('5. Voluntary Contribution & Section 80CCD(1B) Benefit', () => {
    it('Should add voluntary monthly amount and tag Section 80CCD(1B) applicable portion', () => {
      const earnings = { basic: 70000, da: 10000 }; // Basis = 80,000
      const profile = {
        employee_id: 'EMP_NPS_VOLUNTARY',
        pran: '110011223344',
        tier: 'TIER_1',
        contribution_type: 'BOTH',
        voluntary_monthly_amount: 4167, // ~50,000 / 12
      };

      const result = calculateEmployeeNPS(profile, earnings, 'September 2026');

      assert.equal(result.employer_contribution, 8000); // 10% of 80k
      assert.equal(result.employee_mandatory_deduction, 8000); // 10% of 80k
      assert.equal(result.employee_voluntary_contribution, 4167);
      assert.equal(result.total_employee_contribution, 12167);
      assert.equal(result.total_nps_contribution, 20167);
      assert.equal(result.sec80ccd1b_applicable_amount, 4167);
    });
  });

  describe('6. Rounding Rules Engine', () => {
    it('Should apply NEAREST_RUPEE, ROUND_UP, and ROUND_DOWN correctly', () => {
      assert.equal(applyNPSRounding(1234.45, 'NEAREST_RUPEE'), 1234);
      assert.equal(applyNPSRounding(1234.55, 'NEAREST_RUPEE'), 1235);
      assert.equal(applyNPSRounding(1234.10, 'ROUND_UP'), 1235);
      assert.equal(applyNPSRounding(1234.90, 'ROUND_DOWN'), 1234);
      assert.equal(applyNPSRounding(1234.567, 'NO_ROUNDING'), 1234.57);
    });
  });
});
