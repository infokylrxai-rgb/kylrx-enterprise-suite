/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - STATUTORY GRATUITY CALCULATION & VESTING ENGINE
 * ============================================================================
 * Features:
 *  1. Service Duration Calculator with policy-driven rounding rules
 *  2. Vesting Gatekeeper with Death/Disability statutory bypass automation
 *  3. Dynamic Formula Execution: (SalaryBasis * CompletedService * DaysPerYear) / WorkingDaysDivisor
 *  4. Statutory Tax-Free Capping (₹20L) & Taxable Excess Splitting
 *  5. Complete Execution Trace capturing intermediate variables and policy metadata
 *
 * @version 3.3.0
 * @author Kylrx AI Lead Systems Architect & Principal Backend Engineer
 */

import {
  DEFAULT_GRATUITY_POLICIES,
  resolveActiveGratuityPolicy,
  normalizeDateToIso,
  calculateGratuityTenure,
  evaluateGratuityVesting,
  calculateNomineeAllocations,
} from './gratuity-policy-resolver-service.mjs';

/**
 * Service Duration Calculator:
 * Ingests date_of_joining and date_of_exit, computes continuous days, and
 * converts to statutory service years based on the policy's service_rounding_rule.
 *
 * @param {Object} params
 * @param {string|Date} params.date_of_joining - Joining date
 * @param {string|Date} params.date_of_exit - Exit date
 * @param {string} [params.service_rounding_rule='ROUND_NEAREST_HALF_YEAR'] - Rounding rule
 * @returns {{ continuous_service_days: number, completed_service_factor: number, tenure_years_raw: number }}
 */
export function calculateServiceDuration({
  date_of_joining,
  date_of_exit,
  service_rounding_rule = 'ROUND_NEAREST_HALF_YEAR',
}) {
  const tenure = calculateGratuityTenure({
    date_of_joining,
    date_of_exit,
    service_rounding_rule,
  });

  return {
    continuous_service_days: tenure.tenure_days,
    completed_service_factor: tenure.tenure_years_statutory,
    tenure_years_raw: tenure.tenure_years_raw,
  };
}

/**
 * Vesting Gatekeeper:
 * Evaluates continuous service against min_vesting_days.
 * Automatically bypasses the continuous service requirement for Death or Permanent Disablement
 * when death_disability_bypass_vesting is enabled.
 *
 * @param {Object} params
 * @param {number} params.continuous_service_days - Total continuous days of service
 * @param {string} params.exit_reason - 'RESIGNATION' | 'RETIREMENT' | 'TERMINATION' | 'DEATH' | 'DISABILITY'
 * @param {Object} params.policy - Active Gratuity policy config
 * @returns {{ is_vested: boolean, bypass_applied: boolean, bypass_reason: string|null, min_vesting_days: number, continuous_service_days: number }}
 */
export function evaluateVestingGate({
  continuous_service_days,
  exit_reason,
  policy,
}) {
  const reason = String(exit_reason || 'RESIGNATION').toUpperCase();
  const minVestingDays = policy.min_vesting_days !== undefined ? policy.min_vesting_days : 1825;

  let isVested = continuous_service_days >= minVestingDays;
  let bypassApplied = false;
  let bypassReason = null;

  if (policy.death_disability_bypass_vesting && (reason === 'DEATH' || reason === 'DISABILITY')) {
    isVested = true;
    bypassApplied = true;
    bypassReason = `STATUTORY_EXEMPTION_${reason}`;
  }

  return {
    is_vested: isVested,
    bypass_applied: bypassApplied,
    bypass_reason: bypassReason,
    min_vesting_days: minVestingDays,
    continuous_service_days,
  };
}

/**
 * Executes the dynamic formula:
 * Gratuity = (Salary Basis * Completed Service Factor * Days Per Year Factor) / Working Days Divisor
 * Where Salary Basis = last_drawn_basic + last_drawn_da
 *
 * @param {Object} params
 * @param {number} params.salary_basis - Sum of Basic + DA
 * @param {number} params.completed_service_factor - Statutory years of service
 * @param {number} params.days_per_year_factor - Configured days per year factor (e.g., 15)
 * @param {number} params.working_days_divisor - Configured divisor (e.g., 26)
 * @returns {number} Uncapped raw gratuity amount (rounded to nearest whole rupee)
 */
export function executeDynamicGratuityFormula({
  salary_basis,
  completed_service_factor,
  days_per_year_factor = 15,
  working_days_divisor = 26,
}) {
  if (working_days_divisor <= 0) {
    throw new Error('working_days_divisor must be strictly greater than 0.');
  }

  const rawAmount = (salary_basis * completed_service_factor * days_per_year_factor) / working_days_divisor;
  return Math.round(rawAmount);
}

/**
 * Applies Statutory Tax-Free Cap & Computes Tax Split:
 * Calculates tax-exempt amount and taxable excess amount.
 *
 * @param {Object} params
 * @param {number} params.raw_gratuity_amount - Calculated raw payout
 * @param {number} params.statutory_tax_free_cap - Active tax-free limit (e.g., 2000000)
 * @param {boolean} params.is_vested - Vesting gate outcome
 * @returns {{ tax_exempt_amount: number, taxable_amount: number, payable_gratuity_amount: number }}
 */
export function calculateGratuityTaxSplit({
  raw_gratuity_amount,
  statutory_tax_free_cap = 2000000,
  is_vested = true,
}) {
  if (!is_vested) {
    return {
      tax_exempt_amount: 0,
      taxable_amount: 0,
      payable_gratuity_amount: 0,
    };
  }

  const taxExempt = Math.min(raw_gratuity_amount, statutory_tax_free_cap);
  const taxable = Math.max(0, raw_gratuity_amount - statutory_tax_free_cap);

  return {
    tax_exempt_amount: taxExempt,
    taxable_amount: taxable,
    payable_gratuity_amount: raw_gratuity_amount,
  };
}

/**
 * Core Orchestrator:
 * Executes complete end-to-end Gratuity Calculation, Vesting Evaluation,
 * Tax Splitting, Nominee Allocations, and produces a full Execution Trace.
 *
 * @param {Object} profile - EmployeeGratuityProfile
 * @param {Object} [options] - Optional configurations, policy overrides, or custom policy registries
 * @returns {Object} GratuitySettlementEngineResult with settlement and execution_trace
 */
export function executeGratuityCalculationEngine(profile, options = {}) {
  if (!profile.employee_id) {
    throw new Error('employee_id is required for gratuity calculation.');
  }
  if (!profile.date_of_joining) {
    throw new Error('date_of_joining is required for gratuity calculation.');
  }
  if (!profile.date_of_exit) {
    throw new Error('date_of_exit is required for gratuity calculation.');
  }

  const dateOfJoining = normalizeDateToIso(profile.date_of_joining);
  const dateOfExit = normalizeDateToIso(profile.date_of_exit);
  const exitReason = String(profile.exit_reason || 'RESIGNATION').toUpperCase();

  // 1. Resolve Policy Configuration
  const policies = options.policies || DEFAULT_GRATUITY_POLICIES;
  const policy = options.policy_override || resolveActiveGratuityPolicy(dateOfExit, policies);

  // 2. Service Duration Calculator
  const duration = calculateServiceDuration({
    date_of_joining: dateOfJoining,
    date_of_exit: dateOfExit,
    service_rounding_rule: policy.service_rounding_rule,
  });

  // 3. Vesting Gatekeeper
  const vestingGate = evaluateVestingGate({
    continuous_service_days: duration.continuous_service_days,
    exit_reason: exitReason,
    policy,
  });

  // 4. Salary Basis Calculation
  const lastDrawnBasic = Number(profile.last_drawn_basic || 0);
  const lastDrawnDa = Number(profile.last_drawn_da || 0);
  const salaryBasis = lastDrawnBasic + lastDrawnDa;

  if (salaryBasis <= 0) {
    throw new Error(`Salary Basis (Basic: ${lastDrawnBasic}, DA: ${lastDrawnDa}) must be greater than 0 for employee ${profile.employee_id}.`);
  }

  // 5. Dynamic Formula Execution
  const rawFormulaOutput = executeDynamicGratuityFormula({
    salary_basis: salaryBasis,
    completed_service_factor: duration.completed_service_factor,
    days_per_year_factor: policy.days_per_year_factor,
    working_days_divisor: policy.working_days_divisor,
  });

  // 6. Capping & Tax Split
  const taxSplit = calculateGratuityTaxSplit({
    raw_gratuity_amount: rawFormulaOutput,
    statutory_tax_free_cap: policy.statutory_tax_free_cap,
    is_vested: vestingGate.is_vested,
  });

  // 7. Nominee Allocations
  const nomineeAllocations = calculateNomineeAllocations(
    taxSplit.payable_gratuity_amount,
    profile.nominees || []
  );

  const timestamp = new Date().toISOString();

  // 8. Execution Trace
  const executionTrace = {
    config_id: policy.config_id,
    policy_version: policy.version,
    salary_basis: salaryBasis,
    last_drawn_basic: lastDrawnBasic,
    last_drawn_da: lastDrawnDa,
    continuous_service_days: duration.continuous_service_days,
    completed_service_factor: duration.completed_service_factor,
    service_rounding_rule_applied: policy.service_rounding_rule,
    days_per_year_factor: policy.days_per_year_factor,
    working_days_divisor: policy.working_days_divisor,
    raw_formula_output: rawFormulaOutput,
    statutory_tax_free_cap: policy.statutory_tax_free_cap,
    is_vested: vestingGate.is_vested,
    vesting_gate_details: {
      min_vesting_days: vestingGate.min_vesting_days,
      continuous_service_days: vestingGate.continuous_service_days,
      bypass_applied: vestingGate.bypass_applied,
      bypass_reason: vestingGate.bypass_reason,
    },
    tax_exempt_amount: taxSplit.tax_exempt_amount,
    taxable_amount: taxSplit.taxable_amount,
    final_payable_amount: taxSplit.payable_gratuity_amount,
    execution_timestamp: timestamp,
  };

  // 9. Structured Settlement Entity
  const settlement = {
    employee_id: profile.employee_id,
    date_of_joining: dateOfJoining,
    date_of_exit: dateOfExit,
    exit_reason: exitReason,
    tenure_days: duration.continuous_service_days,
    tenure_years_raw: duration.tenure_years_raw,
    tenure_years_statutory: duration.completed_service_factor,
    is_vested: vestingGate.is_vested,
    vesting_bypass_reason: vestingGate.bypass_reason,
    last_drawn_wages: salaryBasis,
    raw_gratuity_amount: rawFormulaOutput,
    statutory_tax_free_amount: taxSplit.tax_exempt_amount,
    taxable_excess_amount: taxSplit.taxable_amount,
    payable_gratuity_amount: taxSplit.payable_gratuity_amount,
    nominee_allocations: nomineeAllocations,
    policy_config_id: policy.config_id,
    policy_version: policy.version,
    calculation_timestamp: timestamp,
    execution_trace: executionTrace,
  };

  return {
    success: true,
    settlement,
    execution_trace: executionTrace,
  };
}
