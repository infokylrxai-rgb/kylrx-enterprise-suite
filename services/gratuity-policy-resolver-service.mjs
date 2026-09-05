/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - GRATUITY POLICY RESOLVER & STATUTORY ENGINE
 * ============================================================================
 * Features:
 *  1. Versioned Effective-Dated Gratuity Policy Registry (Payment of Gratuity Act)
 *  2. Date-driven Policy Resolver with strict boundary validation
 *  3. Statutory Service Rounding Engine (Nearest Half-Year, Exact Fraction, Full Years)
 *  4. Death & Disability Vesting Bypass Automation
 *  5. Complete Gratuity Settlement & Nominee Allocation Engine
 *
 * @version 3.2.0
 * @author Kylrx AI Lead Systems Architect
 */

/**
 * Custom Error thrown when no active Gratuity policy covers the specified date.
 */
export class NoActiveGratuityPolicyError extends Error {
  constructor(dateStr) {
    super(`No active Gratuity policy configuration found covering date: '${dateStr}'.`);
    this.name = 'NoActiveGratuityPolicyError';
    this.date = dateStr;
  }
}

/**
 * Default Statutory Gratuity Policies under the Payment of Gratuity Act, 1972.
 */
export const DEFAULT_GRATUITY_POLICIES = Object.freeze([
  {
    config_id: 'GRAT_POL_1997_V1',
    effective_from: '1997-01-01',
    effective_to: '2018-03-28',
    min_vesting_days: 1825, // 5 continuous years
    days_per_year_factor: 15, // 15 days wages per completed year of service
    working_days_divisor: 26, // 26 working days in a month
    statutory_tax_free_cap: 1000000, // ₹10,00,000 pre-2018 amendment cap
    service_rounding_rule: 'ROUND_NEAREST_HALF_YEAR',
    death_disability_bypass_vesting: true,
    monthly_provision_rate: 0.0481, // 15 / (26 * 12) ~ 4.81%
    description: 'Pre-2018 Gratuity Policy with ₹10 Lakh statutory tax-free cap',
    version: 1,
    is_active: false,
  },
  {
    config_id: 'GRAT_POL_2018_V2',
    effective_from: '2018-03-29', // Effective date of Payment of Gratuity (Amendment) Act, 2018
    effective_to: null, // Open-ended current active rule
    min_vesting_days: 1825, // 5 continuous years (or 1700 days for 4y 240d rule)
    days_per_year_factor: 15,
    working_days_divisor: 26,
    statutory_tax_free_cap: 2000000, // ₹20,00,000 statutory tax-free cap
    service_rounding_rule: 'ROUND_NEAREST_HALF_YEAR',
    death_disability_bypass_vesting: true,
    monthly_provision_rate: 0.0481,
    description: 'Payment of Gratuity (Amendment) Act 2018 with ₹20 Lakh statutory tax-free cap',
    version: 2,
    is_active: true,
  },
]);

/**
 * Normalizes input date to standard ISO format (YYYY-MM-DD).
 * Supports ISO strings, DD/MM/YYYY, Date instances, and period strings.
 *
 * @param {string|Date} dateInput
 * @returns {string} ISO Date String (YYYY-MM-DD)
 */
export function normalizeDateToIso(dateInput) {
  if (!dateInput) {
    throw new Error('Date input is required for date normalization.');
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

  // YYYY-MM (e.g., '2026-09') -> default to 1st of month
  if (/^\d{4}-\d{2}$/.test(str)) {
    return `${str}-01`;
  }

  // Parse generic date string
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  throw new Error(`Unable to parse date string: '${dateInput}'. Expected YYYY-MM-DD or DD/MM/YYYY.`);
}

/**
 * Ingests an employee exit date and retrieves the strictly active gratuity policy configuration.
 *
 * @param {string|Date} exitDate - Employee exit date
 * @param {Array<Object>} [policies=DEFAULT_GRATUITY_POLICIES] - Array of policy configs
 * @returns {Object} Active EmployeeGratuityPolicyConfig
 * @throws {NoActiveGratuityPolicyError} If no policy covers the given exit date
 */
export function resolveActiveGratuityPolicy(exitDate, policies = DEFAULT_GRATUITY_POLICIES) {
  if (!exitDate) {
    throw new Error('Exit date is required to resolve active Gratuity policy.');
  }

  const isoDate = normalizeDateToIso(exitDate);

  const matchedPolicy = policies.find((policy) => {
    const from = policy.effective_from;
    const to = policy.effective_to;

    const isAfterFrom = isoDate >= from;
    const isBeforeTo = !to || isoDate <= to;

    return isAfterFrom && isBeforeTo;
  });

  if (!matchedPolicy) {
    throw new NoActiveGratuityPolicyError(isoDate);
  }

  return { ...matchedPolicy };
}

/**
 * Calculates tenure in days, exact raw years, and statutory rounded years.
 *
 * @param {Object} params
 * @param {string|Date} params.date_of_joining - Joining date
 * @param {string|Date} params.date_of_exit - Exit date
 * @param {string} [params.service_rounding_rule='ROUND_NEAREST_HALF_YEAR'] - Rounding rule
 * @returns {{ tenure_days: number, tenure_years_raw: number, tenure_years_statutory: number }}
 */
export function calculateGratuityTenure({
  date_of_joining,
  date_of_exit,
  service_rounding_rule = 'ROUND_NEAREST_HALF_YEAR',
}) {
  const joiningIso = normalizeDateToIso(date_of_joining);
  const exitIso = normalizeDateToIso(date_of_exit);

  const joinDate = new Date(joiningIso);
  const exitDate = new Date(exitIso);

  if (exitDate < joinDate) {
    throw new Error(`Invalid tenure: date_of_exit (${exitIso}) cannot be earlier than date_of_joining (${joiningIso}).`);
  }

  // Calculate calendar days
  const diffMs = exitDate.getTime() - joinDate.getTime();
  const tenureDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  // Calendar year & month breakdown for statutory half-year rule
  let yearsDiff = exitDate.getUTCFullYear() - joinDate.getUTCFullYear();
  let monthsDiff = exitDate.getUTCMonth() - joinDate.getUTCMonth();
  let daysDiff = exitDate.getUTCDate() - joinDate.getUTCDate();

  if (daysDiff < 0) {
    monthsDiff -= 1;
  }
  if (monthsDiff < 0) {
    yearsDiff -= 1;
    monthsDiff += 12;
  }

  const tenureYearsRaw = Math.round((tenureDays / 365.25) * 1000) / 1000;
  let tenureYearsStatutory = yearsDiff;

  switch (service_rounding_rule) {
    case 'ROUND_NEAREST_HALF_YEAR':
      // Under Payment of Gratuity Act: If service exceeds 6 months in the last year (> 6 months), round UP to 1 full year
      if (monthsDiff > 6 || (monthsDiff === 6 && daysDiff > 0)) {
        tenureYearsStatutory = yearsDiff + 1;
      } else {
        tenureYearsStatutory = yearsDiff;
      }
      break;

    case 'EXACT_FRACTION':
      tenureYearsStatutory = tenureYearsRaw;
      break;

    case 'COMPLETED_FULL_YEARS':
      tenureYearsStatutory = yearsDiff;
      break;

    default:
      tenureYearsStatutory = yearsDiff;
  }

  return {
    tenure_days: tenureDays,
    tenure_years_raw: tenureYearsRaw,
    tenure_years_statutory: tenureYearsStatutory,
  };
}

/**
 * Evaluates whether an employee is vested for Gratuity payout.
 *
 * @param {Object} params
 * @param {number} params.tenure_days - Total days of service
 * @param {string} params.exit_reason - 'RESIGNATION' | 'RETIREMENT' | 'TERMINATION' | 'DEATH' | 'DISABILITY'
 * @param {Object} params.policy - Active Gratuity policy config
 * @returns {{ is_vested: boolean, vesting_bypass_reason: string|null }}
 */
export function evaluateGratuityVesting({ tenure_days, exit_reason, policy }) {
  const reason = String(exit_reason || '').toUpperCase();

  // Statutory Exception: 5-year vesting waived in case of Death or Disablement
  if (policy.death_disability_bypass_vesting && (reason === 'DEATH' || reason === 'DISABILITY')) {
    return {
      is_vested: true,
      vesting_bypass_reason: `STATUTORY_EXEMPTION_${reason}`,
    };
  }

  const isVested = tenure_days >= policy.min_vesting_days;
  return {
    is_vested: isVested,
    vesting_bypass_reason: null,
  };
}

/**
 * Allocates total payable gratuity to nominated beneficiaries based on declared percentage shares.
 *
 * @param {number} totalPayable - Total payable gratuity amount
 * @param {Array<Object>} nominees - List of nominees with share_percentage
 * @returns {Array<Object>} Allocated nominee list
 */
export function calculateNomineeAllocations(totalPayable, nominees = []) {
  if (!nominees || nominees.length === 0) {
    return [];
  }

  let totalAllocated = 0;
  const allocations = nominees.map((nominee, idx) => {
    const sharePct = Number(nominee.share_percentage || 0);
    // Allocate proportional amount
    const allocated = Math.round((totalPayable * sharePct) / 100);
    totalAllocated += allocated;

    return {
      nominee_name: nominee.nominee_name,
      relationship: nominee.relationship,
      share_percentage: sharePct,
      allocated_amount: allocated,
    };
  });

  // Reconcile any whole-rupee rounding discrepancy on the primary nominee
  const discrepancy = totalPayable - totalAllocated;
  if (discrepancy !== 0 && allocations.length > 0) {
    allocations[0].allocated_amount += discrepancy;
  }

  return allocations;
}

/**
 * Computes full Gratuity settlement calculation for an employee profile.
 *
 * @param {Object} profile - EmployeeGratuityProfile
 * @param {Object} [options] - Configuration and policy override options
 * @returns {Object} GratuityCalculationResult
 */
export function calculateEmployeeGratuity(profile, options = {}) {
  if (!profile.employee_id) {
    throw new Error('employee_id is required for gratuity calculation.');
  }
  if (!profile.date_of_joining) {
    throw new Error('date_of_joining is required for gratuity calculation.');
  }
  if (!profile.date_of_exit) {
    throw new Error('date_of_exit is required for gratuity calculation.');
  }

  const exitReason = (profile.exit_reason || 'RESIGNATION').toUpperCase();

  // 1. Resolve Active Policy for Exit Date
  const policies = options.policies || DEFAULT_GRATUITY_POLICIES;
  const policy = options.policy_override || resolveActiveGratuityPolicy(profile.date_of_exit, policies);

  // 2. Compute Service Tenure
  const tenure = calculateGratuityTenure({
    date_of_joining: profile.date_of_joining,
    date_of_exit: profile.date_of_exit,
    service_rounding_rule: policy.service_rounding_rule,
  });

  // 3. Evaluate Vesting
  const vesting = evaluateGratuityVesting({
    tenure_days: tenure.tenure_days,
    exit_reason: exitReason,
    policy,
  });

  // 4. Compute Wages (Basic + DA)
  const basic = Number(profile.last_drawn_basic || 0);
  const da = Number(profile.last_drawn_da || 0);
  const lastDrawnWages = basic + da;

  if (lastDrawnWages <= 0) {
    throw new Error(`last_drawn_wages (basic + da) must be greater than 0 for employee ${profile.employee_id}.`);
  }

  // 5. Formula: (days_per_year_factor * (basic + da) * statutory_years) / working_days_divisor
  const rawGratuity = Math.round(
    (policy.days_per_year_factor * lastDrawnWages * tenure.tenure_years_statutory) / policy.working_days_divisor
  );

  // 6. Statutory Tax-Free Cap & Taxable Excess
  const taxFreeCap = policy.statutory_tax_free_cap;
  const statutoryTaxFree = Math.min(rawGratuity, taxFreeCap);
  const taxableExcess = Math.max(0, rawGratuity - taxFreeCap);

  // 7. Payable Amount (0 if not vested)
  const payableGratuity = vesting.is_vested ? rawGratuity : 0;

  // 8. Nominee Allocations
  const nomineeAllocations = calculateNomineeAllocations(payableGratuity, profile.nominees || []);

  return {
    employee_id: profile.employee_id,
    date_of_joining: normalizeDateToIso(profile.date_of_joining),
    date_of_exit: normalizeDateToIso(profile.date_of_exit),
    exit_reason: exitReason,
    tenure_days: tenure.tenure_days,
    tenure_years_raw: tenure.tenure_years_raw,
    tenure_years_statutory: tenure.tenure_years_statutory,
    is_vested: vesting.is_vested,
    vesting_bypass_reason: vesting.vesting_bypass_reason,
    last_drawn_wages: lastDrawnWages,
    raw_gratuity_amount: rawGratuity,
    statutory_tax_free_amount: statutoryTaxFree,
    taxable_excess_amount: taxableExcess,
    payable_gratuity_amount: payableGratuity,
    nominee_allocations: nomineeAllocations,
    policy_config_id: policy.config_id,
    policy_version: policy.version,
    calculation_timestamp: new Date().toISOString(),
  };
}
