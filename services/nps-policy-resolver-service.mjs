/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CORPORATE NPS POLICY RESOLVER & STATUTORY SERVICE
 * ============================================================================
 * Features:
 *  1. Versioned Effective-Dated Corporate NPS Policy Registry (PFRDA / NSDL CRA)
 *  2. Date & Tier-driven Policy Resolver with strict boundary validation
 *  3. Dynamic Salary Basis Extraction based on configured components (e.g. Basic + DA)
 *  4. Co-Contribution Engine supporting EMPLOYER_ONLY, EMPLOYEE_ONLY, and BOTH
 *  5. Voluntary Excess & Section 80CCD(1B) additional tax benefit handling
 *
 * @version 3.1.0
 * @author Kylrx AI Principal Systems Architect
 */

/**
 * Custom Error thrown when no active NPS policy covers the specified date and tier.
 */
export class NoActiveNPSPolicyError extends Error {
  constructor(dateStr, tier = 'TIER_1', details = '') {
    super(`No active Corporate NPS policy found covering date: '${dateStr}' for tier: '${tier}'. ${details}`.trim());
    this.name = 'NoActiveNPSPolicyError';
    this.date = dateStr;
    this.tier = tier;
  }
}

/**
 * Default Statutory & Corporate NPS Policy Configurations.
 */
export const DEFAULT_NPS_POLICIES = Object.freeze([
  {
    config_id: 'NPS_CORP_STD_TIER1_V1',
    plan_name: 'Corporate NPS Tier 1 Standard Plan (10% Co-Contribution)',
    effective_from: '2019-04-01',
    effective_to: null, // Open-ended active rule
    tier_type: 'TIER_1',
    employer_rate_percentage: 10, // 10% under Section 80CCD(2)
    employee_default_rate: 10,    // 10% under Section 80CCD(1)
    allow_voluntary_excess: true, // Enables voluntary contribution under Section 80CCD(1B)
    annual_sec80ccd1b_cap: 50000, // ₹50,000 annual deduction cap
    salary_basis_components: ['BASIC', 'DA'],
    rounding_rule: 'NEAREST_RUPEE',
    description: 'Corporate NPS Tier 1 Standard Plan with 10% Employer & 10% Employee Contribution',
    version: 1,
    is_active: true,
  },
  {
    config_id: 'NPS_CORP_GOVT_TIER1_V1',
    plan_name: 'Central/State Government & PSU NPS Tier 1 (14% Employer Share)',
    effective_from: '2019-04-01',
    effective_to: null,
    tier_type: 'TIER_1',
    employer_rate_percentage: 14, // 14% Employer contribution for Govt/PSU entities
    employee_default_rate: 10,
    allow_voluntary_excess: true,
    annual_sec80ccd1b_cap: 50000,
    salary_basis_components: ['BASIC', 'DA'],
    rounding_rule: 'NEAREST_RUPEE',
    description: 'Government & PSU NPS Tier 1 with 14% Employer contribution rate',
    version: 1,
    is_active: true,
  },
  {
    config_id: 'NPS_CORP_STD_TIER2_V1',
    plan_name: 'Corporate NPS Tier 2 Voluntary Account',
    effective_from: '2019-04-01',
    effective_to: null,
    tier_type: 'TIER_2',
    employer_rate_percentage: 0,  // Tier 2 is employee-only withdrawable investment account
    employee_default_rate: 10,
    allow_voluntary_excess: true,
    annual_sec80ccd1b_cap: 0,     // No 80CCD(1B) deduction on Tier 2 for private sector
    salary_basis_components: ['BASIC', 'DA'],
    rounding_rule: 'NEAREST_RUPEE',
    description: 'Tier 2 Savings Account without employer liability',
    version: 1,
    is_active: true,
  },
]);

/**
 * Normalizes input date or period string to standard ISO format (YYYY-MM-DD).
 *
 * @param {string|Date} dateInput
 * @returns {string} ISO Date String (YYYY-MM-DD)
 */
export function normalizeNPSDateToIso(dateInput) {
  if (!dateInput) {
    throw new Error('Date input is required for NPS date normalization.');
  }

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) {
      throw new Error('Invalid Date object provided.');
    }
    return dateInput.toISOString().split('T')[0];
  }

  const str = String(dateInput).trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // DD/MM/YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(str)) {
    return `${str}-01`;
  }

  // Handle Month Year strings (e.g. 'September 2026')
  const months = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const monthYearMatch = str.match(/^([a-zA-Z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const monthKey = monthYearMatch[1].toLowerCase();
    const year = monthYearMatch[2];
    if (months[monthKey]) {
      return `${year}-${months[monthKey]}-01`;
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  throw new Error(`Unable to parse NPS date string: '${dateInput}'.`);
}

/**
 * Applies configured rounding rule to a numerical currency amount.
 *
 * @param {number} amount
 * @param {string} rule - 'NEAREST_RUPEE' | 'ROUND_UP' | 'ROUND_DOWN' | 'NO_ROUNDING'
 * @returns {number}
 */
export function applyNPSRounding(amount, rule = 'NEAREST_RUPEE') {
  const num = Number(amount) || 0;
  switch (rule) {
    case 'NEAREST_RUPEE':
      return Math.round(num);
    case 'ROUND_UP':
      return Math.ceil(num);
    case 'ROUND_DOWN':
      return Math.floor(num);
    case 'NO_ROUNDING':
      return Math.round(num * 100) / 100;
    default:
      return Math.round(num);
  }
}

/**
 * Resolves the active Corporate NPS Policy configuration for an employee and payroll cycle date.
 *
 * @param {Object|string} employeeOrTier - EmployeeNPSProfile or tier string ('TIER_1' | 'TIER_2')
 * @param {string|Date} payrollCycleDate - Payroll cycle date (e.g. '2026-09-01' or 'September 2026')
 * @param {Array<Object>} [policies=DEFAULT_NPS_POLICIES] - Policy registry
 * @returns {Object} Matched NPS_Policy_Config
 * @throws {NoActiveNPSPolicyError} If no active policy matches
 */
export function resolveActiveNPSPolicy(
  employeeOrTier,
  payrollCycleDate,
  policies = DEFAULT_NPS_POLICIES
) {
  if (!payrollCycleDate) {
    throw new Error('payrollCycleDate is required to resolve active NPS policy.');
  }

  const isoDate = normalizeNPSDateToIso(payrollCycleDate);

  let targetTier = 'TIER_1';
  let targetPlanConfigId = null;

  if (typeof employeeOrTier === 'string') {
    targetTier = employeeOrTier.toUpperCase();
  } else if (employeeOrTier && typeof employeeOrTier === 'object') {
    if (employeeOrTier.tier) {
      targetTier = String(employeeOrTier.tier).toUpperCase();
    }
    if (employeeOrTier.config_id || employeeOrTier.policy_config_id) {
      targetPlanConfigId = employeeOrTier.config_id || employeeOrTier.policy_config_id;
    }
  }

  const matchedPolicy = policies.find((p) => {
    // If specific config_id is requested, match it first
    if (targetPlanConfigId && p.config_id !== targetPlanConfigId) {
      return false;
    }

    if (p.tier_type !== targetTier) {
      return false;
    }

    const from = p.effective_from;
    const to = p.effective_to;
    const isAfterFrom = isoDate >= from;
    const isBeforeTo = !to || isoDate <= to;

    return isAfterFrom && isBeforeTo;
  });

  if (!matchedPolicy) {
    throw new NoActiveNPSPolicyError(isoDate, targetTier);
  }

  return { ...matchedPolicy };
}

/**
 * Extracts and sums the salary basis components from an earnings record based on the active policy.
 *
 * @param {Object} earnings - Earnings record (e.g. { basic: 50000, da: 10000, hra: 20000 })
 * @param {Array<string>} [components=['BASIC', 'DA']] - Components configured in policy
 * @returns {{ salary_basis: number, components_used: Array<string> }}
 */
export function computeNPSSalaryBasis(earnings = {}, components = ['BASIC', 'DA']) {
  let salaryBasis = 0;
  const componentsUsed = [];

  const normComponents = (components || ['BASIC', 'DA']).map((c) => String(c).toUpperCase());

  for (const comp of normComponents) {
    let compValue = 0;
    if (comp === 'BASIC' || comp === 'BASIC_SALARY' || comp === 'BASIC_PAY') {
      compValue = Number(earnings.basic || earnings.basic_salary || earnings.basic_pay || 0);
      componentsUsed.push('BASIC');
    } else if (comp === 'DA' || comp === 'DEARNESS_ALLOWANCE') {
      compValue = Number(earnings.da || earnings.dearness_allowance || 0);
      componentsUsed.push('DA');
    } else if (earnings[comp.toLowerCase()] !== undefined) {
      compValue = Number(earnings[comp.toLowerCase()] || 0);
      componentsUsed.push(comp);
    } else if (earnings[comp] !== undefined) {
      compValue = Number(earnings[comp] || 0);
      componentsUsed.push(comp);
    }

    if (!isNaN(compValue) && compValue > 0) {
      salaryBasis += compValue;
    }
  }

  return {
    salary_basis: Math.round(salaryBasis * 100) / 100,
    components_used: componentsUsed,
  };
}

/**
 * Computes monthly NPS contributions for an employee.
 *
 * @param {Object} employeeProfile - EmployeeNPSProfile
 * @param {Object} earnings - Monthly earnings record
 * @param {string|Date} payrollCycleDate - Date of payroll period
 * @param {Object} [options={}] - Override policies or custom settings
 * @returns {Object} NPSCalculationResult
 */
export function calculateEmployeeNPS(
  employeeProfile,
  earnings = {},
  payrollCycleDate,
  options = {}
) {
  if (!employeeProfile || !employeeProfile.employee_id) {
    throw new Error('Valid employeeProfile with employee_id is required for NPS calculation.');
  }

  const periodIso = normalizeNPSDateToIso(payrollCycleDate);
  const policies = options.policies || DEFAULT_NPS_POLICIES;

  // 1. Resolve Active Policy Configuration
  const policy = options.policy_override || resolveActiveNPSPolicy(employeeProfile, periodIso, policies);

  // 2. Compute Salary Basis (Basic + DA or custom components)
  const basisResult = computeNPSSalaryBasis(earnings, policy.salary_basis_components);
  const salaryBasis = basisResult.salary_basis;

  // 3. Determine Contribution Rates
  const employerRatePct = policy.employer_rate_percentage || 0;
  const employeeRatePct = employeeProfile.employee_custom_rate !== undefined
    ? Number(employeeProfile.employee_custom_rate)
    : (policy.employee_default_rate || 0);

  const contributionType = employeeProfile.contribution_type || 'BOTH';

  // 4. Calculate Employer Contribution (Section 80CCD(2))
  let rawEmployerContribution = 0;
  if (contributionType === 'EMPLOYER_ONLY' || contributionType === 'BOTH') {
    rawEmployerContribution = (salaryBasis * employerRatePct) / 100;
  }
  const employerContribution = applyNPSRounding(rawEmployerContribution, policy.rounding_rule);

  // 5. Calculate Employee Mandatory Deduction (Section 80CCD(1))
  let rawEmployeeMandatory = 0;
  if (contributionType === 'EMPLOYEE_ONLY' || contributionType === 'BOTH') {
    rawEmployeeMandatory = (salaryBasis * employeeRatePct) / 100;
  }
  const employeeMandatory = applyNPSRounding(rawEmployeeMandatory, policy.rounding_rule);

  // 6. Calculate Voluntary Contribution (Section 80CCD(1B))
  let voluntaryAmount = 0;
  if (policy.allow_voluntary_excess && employeeProfile.voluntary_monthly_amount) {
    voluntaryAmount = Number(employeeProfile.voluntary_monthly_amount) || 0;
  }
  const employeeVoluntary = applyNPSRounding(voluntaryAmount, policy.rounding_rule);

  const totalEmployeeContribution = employeeMandatory + employeeVoluntary;
  const totalNpsContribution = employerContribution + totalEmployeeContribution;

  // Portion attributable to additional 80CCD(1B) benefit (voluntary up to annual cap/monthly pro-rata)
  const sec80ccd1bAmount = Math.min(employeeVoluntary, policy.annual_sec80ccd1b_cap || 50000);

  return {
    employee_id: employeeProfile.employee_id,
    pran: String(employeeProfile.pran || '').trim(),
    period: payrollCycleDate,
    tier: policy.tier_type,
    contribution_type: contributionType,
    salary_basis: salaryBasis,
    salary_basis_components_used: basisResult.components_used,
    employer_rate_percentage: employerRatePct,
    employer_contribution: employerContribution,
    employee_rate_percentage: employeeRatePct,
    employee_mandatory_deduction: employeeMandatory,
    employee_voluntary_contribution: employeeVoluntary,
    total_employee_contribution: totalEmployeeContribution,
    total_nps_contribution: totalNpsContribution,
    sec80ccd1b_applicable_amount: sec80ccd1bAmount,
    rounding_rule_applied: policy.rounding_rule,
    policy_config_id: policy.config_id,
    policy_version: policy.version,
    calculation_timestamp: new Date().toISOString(),
  };
}
