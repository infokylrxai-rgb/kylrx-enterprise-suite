/**
 * ============================================================================
 * TEST SUITE: STATUTORY GRATUITY CALCULATION & VESTING ENGINE
 * ============================================================================
 * Tests:
 *  1. Service Duration Calculator: Continuous days & policy rounding rules
 *  2. Vesting Gatekeeper: Standard 5-year gate vs Death/Disability statutory bypass
 *  3. Dynamic Formula Execution: (Salary Basis * Completed Service * Factor) / Divisor
 *  4. Statutory Tax-Free Capping & Taxable Excess Split
 *  5. Complete Execution Trace Integrity with Intermediate Variables
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateServiceDuration,
  evaluateVestingGate,
  executeDynamicGratuityFormula,
  calculateGratuityTaxSplit,
  executeGratuityCalculationEngine,
} from './statutory-gratuity-calculation-engine.mjs';
import { DEFAULT_GRATUITY_POLICIES } from './gratuity-policy-resolver-service.mjs';

describe('⚡ KYLRX AI STATUTORY GRATUITY CALCULATION & VESTING ENGINE TEST SUITE', () => {

  const active2018Policy = DEFAULT_GRATUITY_POLICIES[1]; // 2018 Policy: ₹20L cap, 1825 min days, 15/26 factor

  describe('1. Service Duration Calculator', () => {
    it('Should calculate continuous days and round up to next full year when service > 6 months in final year', () => {
      const duration = calculateServiceDuration({
        date_of_joining: '2020-01-01',
        date_of_exit: '2025-07-20', // 5 years 6 months 20 days -> > 6 months
        service_rounding_rule: 'ROUND_NEAREST_HALF_YEAR',
      });

      assert.equal(duration.completed_service_factor, 6);
      assert.ok(duration.continuous_service_days > 2000);
    });

    it('Should round down when service <= 6 months in final year', () => {
      const duration = calculateServiceDuration({
        date_of_joining: '2020-01-01',
        date_of_exit: '2025-04-30', // 5 years 4 months
        service_rounding_rule: 'ROUND_NEAREST_HALF_YEAR',
      });

      assert.equal(duration.completed_service_factor, 5);
    });

    it('Should return exact continuous fraction under EXACT_FRACTION rule', () => {
      const duration = calculateServiceDuration({
        date_of_joining: '2020-01-01',
        date_of_exit: '2025-01-01',
        service_rounding_rule: 'EXACT_FRACTION',
      });

      assert.ok(Math.abs(duration.completed_service_factor - 5.0) < 0.05);
    });
  });

  describe('2. Vesting Gatekeeper', () => {
    it('Should enforce 1825 days (5 years) vesting gate for standard resignation', () => {
      const gateUnvested = evaluateVestingGate({
        continuous_service_days: 1400, // < 5 years
        exit_reason: 'RESIGNATION',
        policy: active2018Policy,
      });

      assert.equal(gateUnvested.is_vested, false);
      assert.equal(gateUnvested.bypass_applied, false);
      assert.equal(gateUnvested.bypass_reason, null);

      const gateVested = evaluateVestingGate({
        continuous_service_days: 1825, // >= 5 years
        exit_reason: 'RESIGNATION',
        policy: active2018Policy,
      });

      assert.equal(gateVested.is_vested, true);
      assert.equal(gateVested.bypass_applied, false);
    });

    it('Should automatically bypass continuous service requirement upon DEATH', () => {
      const gate = evaluateVestingGate({
        continuous_service_days: 200, // Less than 1 year
        exit_reason: 'DEATH',
        policy: active2018Policy,
      });

      assert.equal(gate.is_vested, true);
      assert.equal(gate.bypass_applied, true);
      assert.equal(gate.bypass_reason, 'STATUTORY_EXEMPTION_DEATH');
    });

    it('Should automatically bypass continuous service requirement upon PERMANENT DISABLEMENT', () => {
      const gate = evaluateVestingGate({
        continuous_service_days: 500, // Under 2 years
        exit_reason: 'DISABILITY',
        policy: active2018Policy,
      });

      assert.equal(gate.is_vested, true);
      assert.equal(gate.bypass_applied, true);
      assert.equal(gate.bypass_reason, 'STATUTORY_EXEMPTION_DISABILITY');
    });
  });

  describe('3. Dynamic Formula Execution & Capping', () => {
    it('Should compute gratuity accurately using dynamic formula: (Salary Basis * Years * 15) / 26', () => {
      // Basic 40,000 + DA 12,000 = 52,000
      // 5 years service
      // Expected = (52,000 * 5 * 15) / 26 = 3,900,000 / 26 = 150000
      const amount = executeDynamicGratuityFormula({
        salary_basis: 52000,
        completed_service_factor: 5,
        days_per_year_factor: 15,
        working_days_divisor: 26,
      });

      assert.equal(amount, 150000);
    });

    it('Should compute tax split and isolate taxable excess above ₹20,00,000 statutory cap', () => {
      const rawGratuity = 2884615;
      const taxSplit = calculateGratuityTaxSplit({
        raw_gratuity_amount: rawGratuity,
        statutory_tax_free_cap: 2000000,
        is_vested: true,
      });

      assert.equal(taxSplit.tax_exempt_amount, 2000000);
      assert.equal(taxSplit.taxable_amount, 884615);
      assert.equal(taxSplit.payable_gratuity_amount, 2884615);
    });

    it('Should output 0 payable, 0 tax-exempt, and 0 taxable when employee is unvested', () => {
      const taxSplit = calculateGratuityTaxSplit({
        raw_gratuity_amount: 150000,
        statutory_tax_free_cap: 2000000,
        is_vested: false,
      });

      assert.equal(taxSplit.payable_gratuity_amount, 0);
      assert.equal(taxSplit.tax_exempt_amount, 0);
      assert.equal(taxSplit.taxable_amount, 0);
    });
  });

  describe('4. End-to-End Orchestrator & Execution Trace Verification', () => {
    it('Should generate complete settlement with detailed execution trace and intermediate variables', () => {
      const profile = {
        employee_id: 'EMP_EXEC_TRACE_001',
        date_of_joining: '2019-01-01',
        date_of_exit: '2026-09-01', // 7 years, 8 months -> rounded to 8 years under statutory rule
        exit_reason: 'RESIGNATION',
        last_drawn_basic: 65000,
        last_drawn_da: 15000, // Total salary basis = 80,000
        nominees: [
          { nominee_name: 'Rohit Verma', relationship: 'BROTHER', share_percentage: 100 },
        ],
      };

      const result = executeGratuityCalculationEngine(profile);

      assert.equal(result.success, true);
      assert.ok(result.settlement);
      assert.ok(result.execution_trace);

      // Verify Execution Trace Intermediate Variables
      const trace = result.execution_trace;
      assert.equal(trace.config_id, 'GRAT_POL_2018_V2');
      assert.equal(trace.policy_version, 2);
      assert.equal(trace.salary_basis, 80000);
      assert.equal(trace.last_drawn_basic, 65000);
      assert.equal(trace.last_drawn_da, 15000);
      assert.equal(trace.completed_service_factor, 8);
      assert.equal(trace.days_per_year_factor, 15);
      assert.equal(trace.working_days_divisor, 26);
      assert.equal(trace.service_rounding_rule_applied, 'ROUND_NEAREST_HALF_YEAR');

      // Expected Formula Output = (80000 * 8 * 15) / 26 = 9,600,000 / 26 = 369230.769 -> 369231
      assert.equal(trace.raw_formula_output, 369231);
      assert.equal(trace.statutory_tax_free_cap, 2000000);
      assert.equal(trace.is_vested, true);
      assert.equal(trace.tax_exempt_amount, 369231);
      assert.equal(trace.taxable_amount, 0);
      assert.equal(trace.final_payable_amount, 369231);
      assert.ok(trace.execution_timestamp);

      // Settlement Verification
      assert.equal(result.settlement.payable_gratuity_amount, 369231);
      assert.equal(result.settlement.nominee_allocations.length, 1);
      assert.equal(result.settlement.nominee_allocations[0].allocated_amount, 369231);
    });

    it('Should trace statutory death bypass and allocate full proceeds to nominee', () => {
      const profile = {
        employee_id: 'EMP_DEATH_TRACE_002',
        date_of_joining: '2025-01-01',
        date_of_exit: '2026-01-01', // 1 year
        exit_reason: 'DEATH',
        last_drawn_basic: 45000,
        last_drawn_da: 5000, // Total = 50,000
        nominees: [
          { nominee_name: 'Kavita Singh', relationship: 'SPOUSE', share_percentage: 50 },
          { nominee_name: 'Anil Singh', relationship: 'FATHER', share_percentage: 50 },
        ],
      };

      const result = executeGratuityCalculationEngine(profile);

      assert.equal(result.execution_trace.is_vested, true);
      assert.equal(result.execution_trace.vesting_gate_details.bypass_applied, true);
      assert.equal(result.execution_trace.vesting_gate_details.bypass_reason, 'STATUTORY_EXEMPTION_DEATH');

      // (50000 * 1 * 15) / 26 = 750000 / 26 = 28846.15 -> 28846
      assert.equal(result.settlement.payable_gratuity_amount, 28846);
      assert.equal(result.settlement.nominee_allocations.length, 2);
      assert.equal(result.settlement.nominee_allocations[0].allocated_amount, 14423);
      assert.equal(result.settlement.nominee_allocations[1].allocated_amount, 14423);
    });
  });
});
