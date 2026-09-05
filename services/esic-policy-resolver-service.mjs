/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC STATUTORY POLICY RESOLVER & ENGINE
 * ============================================================================
 * Effective-Dated Statutory Configuration Engine for ESIC Compliance.
 * Eliminates all hardcoded statutory rates (0.75%, 3.25%) and wage ceilings (21k, 25k).
 *
 * @version 3.0.0
 * @author Kylrx AI Lead Systems Architect
 */

/**
 * Custom Error thrown when no active ESIC policy rule covers the specified date.
 */
export class NoActiveEsicPolicyError extends Error {
  constructor(dateString, availableRulesCount = 0) {
    super(`No active ESIC policy configuration rule found for date: ${dateString}. Aborting calculation.`);
    this.name = 'NoActiveEsicPolicyError';
    this.code = 'NO_ACTIVE_ESIC_POLICY';
    this.date = dateString;
    this.availableRulesCount = availableRulesCount;
  }
}

/**
 * Canonical Historical & Active ESIC Statutory Policies Registry.
 */
export const DEFAULT_ESIC_POLICIES = Object.freeze([
  {
    config_id: 'ESIC_POL_1997',
    effective_from: '1997-01-01',
    effective_to: '2016-12-31',
    wage_ceiling_standard: 15000,
    wage_ceiling_disabled: 15000,
    employee_rate: 0.0175, // 1.75%
    employer_rate: 0.0475, // 4.75%
    rounding_rule: 'NEAREST_RUPEE',
    description: 'Pre-2017 Historical ESIC Policy (15k ceiling, 1.75% / 4.75%)',
    version: 1,
    is_active: false,
  },
  {
    config_id: 'ESIC_POL_2017',
    effective_from: '2017-01-01',
    effective_to: '2019-06-30',
    wage_ceiling_standard: 21000,
    wage_ceiling_disabled: 25000,
    employee_rate: 0.0175, // 1.75%
    employer_rate: 0.0475, // 4.75%
    rounding_rule: 'NEAREST_RUPEE',
    description: 'Enhanced Ceiling Policy (21k / 25k ceiling, 1.75% / 4.75%)',
    version: 2,
    is_active: false,
  },
  {
    config_id: 'ESIC_POL_2019_CURRENT',
    effective_from: '2019-07-01',
    effective_to: null, // Open-ended current active rule
    wage_ceiling_standard: 21000,
    wage_ceiling_disabled: 25000,
    employee_rate: 0.0075, // 0.75%
    employer_rate: 0.0325, // 3.25%
    rounding_rule: 'NEAREST_RUPEE',
    description: 'Current Central Government Gazetted Policy (0.75% EE, 3.25% ER, 21k/25k)',
    version: 3,
    is_active: true,
  },
]);

/**
 * Normalizes input date format (e.g. '2026-09-01', 'September 2026', '2026-09', Date object)
 * to ISO YYYY-MM-DD.
 *
 * @param {string|Date} dateInput
 * @returns {string} ISO Date string YYYY-MM-DD
 */
export function normalizeDate(dateInput) {
  if (!dateInput) {
    throw new Error('Date parameter is required for statutory policy resolution.');
  }

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) throw new Error('Invalid Date object provided.');
    return dateInput.toISOString().slice(0, 10);
  }

  const str = String(dateInput).trim();

  // If format is YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // If format is YYYY-MM
  if (/^\d{4}-\d{2}$/.test(str)) {
    return `${str}-01`;
  }

  // If format is 'Month YYYY' (e.g. 'September 2026')
  const monthMap = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  const parts = str.toLowerCase().split(/[\s-]+/);
  if (parts.length === 2) {
    if (monthMap[parts[0]] && /^\d{4}$/.test(parts[1])) {
      return `${parts[1]}-${monthMap[parts[0]]}-01`;
    }
    if (/^\d{4}$/.test(parts[0]) && monthMap[parts[1]]) {
      return `${parts[0]}-${monthMap[parts[1]]}-01`;
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  throw new Error(`Unable to normalize date format: "${dateInput}". Expected YYYY-MM-DD or Month YYYY.`);
}

/**
 * Policy Resolver Service:
 * Ingests a payroll period date (e.g. 2026-09-01) and retrieves the active policy version rule.
 * Aborts the calculation with an error if no active policy rule covers the specified date.
 *
 * @param {string|Date} payrollPeriodDate
 * @param {Array<object>} [policyRegistry=DEFAULT_ESIC_POLICIES]
 * @returns {object} Active ESIC_Policy_Config
 */
export function resolveEsicPolicy(payrollPeriodDate, policyRegistry = DEFAULT_ESIC_POLICIES) {
  const targetDate = normalizeDate(payrollPeriodDate);
  const policies = Array.isArray(policyRegistry) && policyRegistry.length > 0 ? policyRegistry : DEFAULT_ESIC_POLICIES;

  for (const policy of policies) {
    const from = policy.effective_from;
    const to = policy.effective_to;

    if (!from) continue;

    // Check if targetDate falls within [effective_from, effective_to]
    const isAfterFrom = targetDate >= from;
    const isBeforeTo = !to || targetDate <= to;

    if (isAfterFrom && isBeforeTo) {
      return { ...policy };
    }
  }

  // Abort the calculation with an error if no active policy rule covers the specified date
  throw new NoActiveEsicPolicyError(targetDate, policies.length);
}

/**
 * Applies the configured rounding rule to statutory monetary values.
 *
 * @param {number} amount
 * @param {string} [roundingRule='NEAREST_RUPEE']
 * @returns {number}
 */
export function applyRoundingRule(amount, roundingRule = 'NEAREST_RUPEE') {
  const val = Number(amount) || 0;
  switch (roundingRule) {
    case 'NEAREST_RUPEE':
      return Math.round(val);
    case 'ROUND_UP':
      return Math.ceil(val);
    case 'ROUND_DOWN':
      return Math.floor(val);
    case 'NO_ROUNDING':
      return Math.round(val * 100) / 100;
    default:
      return Math.round(val);
  }
}

/**
 * Evaluates an employee's ESIC eligibility based on profile, wage, and active statutory policy.
 *
 * @param {object} profile EmployeeESICProfile
 * @param {number} grossWages
 * @param {string|Date} periodDate
 * @param {object} activePolicy ESIC_Policy_Config
 * @returns {object} Evaluation breakdown
 */
export function evaluateEmployeeESICEligibility(profile, grossWages, periodDate, activePolicy) {
  const targetDate = normalizeDate(periodDate);
  const wages = Number(grossWages) || 0;

  if (!profile) {
    return {
      is_eligible: false,
      reason: 'MISSING_PROFILE',
      applicable_ceiling: activePolicy.wage_ceiling_standard,
    };
  }

  // 1. Check if policy is applicable to employee
  if (profile.esic_applicable === false) {
    return {
      is_eligible: false,
      reason: 'EXPLICITLY_NOT_APPLICABLE',
      applicable_ceiling: activePolicy.wage_ceiling_standard,
    };
  }

  // 2. Check Employee Profile Effective Date Window
  if (profile.effective_from && targetDate < profile.effective_from) {
    return {
      is_eligible: false,
      reason: `PROFILE_NOT_YET_EFFECTIVE (Effective from ${profile.effective_from})`,
      applicable_ceiling: activePolicy.wage_ceiling_standard,
    };
  }

  if (profile.effective_to && targetDate > profile.effective_to) {
    return {
      is_eligible: false,
      reason: `PROFILE_EXPIRED (Expired on ${profile.effective_to})`,
      applicable_ceiling: activePolicy.wage_ceiling_standard,
    };
  }

  // 3. Check Employment Tenure (DOJ & Exit Date)
  if (profile.date_of_joining && targetDate < profile.date_of_joining.slice(0, 7)) {
    return {
      is_eligible: false,
      reason: `JOINED_AFTER_PERIOD (DOJ ${profile.date_of_joining})`,
      applicable_ceiling: activePolicy.wage_ceiling_standard,
    };
  }

  if (profile.date_of_exit && targetDate > profile.date_of_exit) {
    return {
      is_eligible: false,
      reason: `EXITED_PRIOR_TO_PERIOD (Exit Date ${profile.date_of_exit})`,
      applicable_ceiling: activePolicy.wage_ceiling_standard,
    };
  }

  // 4. Select Applicable Wage Ceiling based on disability_flag
  const isPersonWithDisability = Boolean(profile.disability_flag);
  const applicableCeiling = isPersonWithDisability
    ? activePolicy.wage_ceiling_disabled
    : activePolicy.wage_ceiling_standard;

  // 5. Wage Threshold Evaluation
  // If wages exceed statutory ceiling, employee is exempt from statutory coverage
  if (wages > applicableCeiling) {
    return {
      is_eligible: false,
      reason: `WAGE_CEILING_EXCEEDED (Gross ₹${wages} > Ceiling ₹${applicableCeiling})`,
      applicable_ceiling: applicableCeiling,
      is_disabled_scheme: isPersonWithDisability,
    };
  }

  return {
    is_eligible: true,
    reason: 'COVERED',
    applicable_ceiling: applicableCeiling,
    is_disabled_scheme: isPersonWithDisability,
  };
}

/**
 * Calculates ESIC Employee Deduction and Employer Contribution for an individual employee.
 *
 * @param {object} profile EmployeeESICProfile
 * @param {number} grossWages
 * @param {string|Date} periodDate
 * @param {Array<object>} [policyRegistry]
 * @returns {object} ESIC_Calculation_Result
 */
export function calculateEmployeeESIC(profile, grossWages, periodDate, policyRegistry) {
  const targetDate = normalizeDate(periodDate);
  const activePolicy = resolveEsicPolicy(targetDate, policyRegistry);
  const wages = Number(grossWages) || 0;

  const eligibility = evaluateEmployeeESICEligibility(profile, wages, targetDate, activePolicy);

  if (!eligibility.is_eligible) {
    return {
      employee_id: profile?.employee_id || 'UNKNOWN',
      period_date: targetDate,
      gross_wages: wages,
      is_covered: false,
      exemption_reason: eligibility.reason,
      applicable_wage_ceiling: eligibility.applicable_ceiling,
      is_disabled_scheme: Boolean(eligibility.is_disabled_scheme),
      employee_rate_applied: activePolicy.employee_rate,
      employer_rate_applied: activePolicy.employer_rate,
      employee_contribution: 0,
      employer_contribution: 0,
      total_contribution: 0,
      rounding_rule_applied: activePolicy.rounding_rule,
      policy_config_id: activePolicy.config_id,
      policy_version: activePolicy.version,
      calculation_timestamp: new Date().toISOString(),
    };
  }

  // Calculate dynamic contributions using active policy rates
  const rawEmployeeDeduction = wages * activePolicy.employee_rate;
  const rawEmployerContribution = wages * activePolicy.employer_rate;

  const employeeContribution = applyRoundingRule(rawEmployeeDeduction, activePolicy.rounding_rule);
  const employerContribution = applyRoundingRule(rawEmployerContribution, activePolicy.rounding_rule);
  const totalContribution = employeeContribution + employerContribution;

  return {
    employee_id: profile.employee_id,
    period_date: targetDate,
    gross_wages: wages,
    is_covered: true,
    exemption_reason: null,
    applicable_wage_ceiling: eligibility.applicable_ceiling,
    is_disabled_scheme: Boolean(eligibility.is_disabled_scheme),
    employee_rate_applied: activePolicy.employee_rate,
    employer_rate_applied: activePolicy.employer_rate,
    employee_contribution: employeeContribution,
    employer_contribution: employerContribution,
    total_contribution: totalContribution,
    rounding_rule_applied: activePolicy.rounding_rule,
    policy_config_id: activePolicy.config_id,
    policy_version: activePolicy.version,
    calculation_timestamp: new Date().toISOString(),
  };
}

/**
 * Calculates Batch ESIC Deductions and Returns for an entire payroll run.
 *
 * @param {Array<object>} profiles EmployeeESICProfile[]
 * @param {Array<object>} payrollRecords Array of { employee_id, gross_wages, ... }
 * @param {string|Date} periodDate
 * @param {Array<object>} [policyRegistry]
 * @returns {object} ESIC_Batch_Calculation_Result
 */
export function calculateBatchESIC(profiles = [], payrollRecords = [], periodDate, policyRegistry) {
  const targetDate = normalizeDate(periodDate);
  const activePolicy = resolveEsicPolicy(targetDate, policyRegistry);

  const profileMap = new Map();
  for (const p of profiles) {
    if (p && p.employee_id) profileMap.set(p.employee_id, p);
  }

  let totalHeadcount = 0;
  let totalCovered = 0;
  let totalExempt = 0;
  let totalStatutoryWages = 0;
  let totalEmployeeDeductions = 0;
  let totalEmployerContributions = 0;

  const breakdowns = [];

  for (const rec of payrollRecords) {
    totalHeadcount++;
    const empId = rec.employee_id || rec.employeeId || rec.id;
    const gross = Number(rec.gross_wages ?? rec.grossSalary ?? rec.gross ?? 0);
    const profile = profileMap.get(empId) || {
      employee_id: empId,
      esic_number: rec.esic_ip_number || rec.ip_number || '',
      esic_applicable: Boolean(rec.esic_ip_number || rec.esic_applicable),
      date_of_joining: rec.date_of_joining || '2020-01-01',
      date_of_exit: rec.date_of_exit || null,
      disability_flag: Boolean(rec.disability_flag),
      effective_from: '2020-01-01',
      effective_to: null,
    };

    const calcResult = calculateEmployeeESIC(profile, gross, targetDate, policyRegistry);
    breakdowns.push(calcResult);

    if (calcResult.is_covered) {
      totalCovered++;
      totalStatutoryWages += gross;
      totalEmployeeDeductions += calcResult.employee_contribution;
      totalEmployerContributions += calcResult.employer_contribution;
    } else {
      totalExempt++;
    }
  }

  return {
    payroll_period: targetDate,
    policy_used: activePolicy,
    total_headcount: totalHeadcount,
    total_covered_employees: totalCovered,
    total_exempt_employees: totalExempt,
    total_statutory_wages: Math.round(totalStatutoryWages * 100) / 100,
    total_employee_deductions: totalEmployeeDeductions,
    total_employer_contributions: totalEmployerContributions,
    total_challan_amount: totalEmployeeDeductions + totalEmployerContributions,
    employee_breakdowns: breakdowns,
  };
}
