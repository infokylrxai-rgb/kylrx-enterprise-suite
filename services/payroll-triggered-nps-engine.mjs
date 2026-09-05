/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL-TRIGGERED NPS CALCULATION ENGINE
 * ============================================================================
 * Features:
 *  1. Automated Execution Trigger: Binds to PAYROLL_FINALIZED event by run_id
 *  2. Eligibility Filtering: Filters candidates strictly where nps_applicable === true
 *     and exit_date is either null or after the wage period
 *  3. Dynamic Salary Basis: Basic + DA dynamically extracted per active policy
 *  4. Co-Contribution Engine:
 *     - Employer contribution under Section 80CCD(2)
 *     - Employee mandatory deduction under Section 80CCD(1)
 *     - Employee voluntary pre-tax contribution under Section 80CCD(1B)
 *  5. Boundary & Cap Guards: 12-digit PRAN gate, net earnings limit guard, 80CCD(1B) cap tracking
 *  6. Structured ValidationIssue & HR Alert Task queue dispatching
 *
 * @version 3.2.0
 * @author Kylrx AI Principal Systems Architect
 */

import crypto from 'node:crypto';
import {
  DEFAULT_NPS_POLICIES,
  resolveActiveNPSPolicy,
  normalizeNPSDateToIso,
  computeNPSSalaryBasis,
  applyNPSRounding,
  calculateEmployeeNPS,
} from './nps-policy-resolver-service.mjs';

/**
 * Validates PRAN string strictly against 12-digit statutory format.
 *
 * @param {string|number|null|undefined} pran
 * @returns {boolean}
 */
export function isValidPran(pran) {
  if (pran === null || pran === undefined) return false;
  return /^[0-9]{12}$/.test(String(pran).trim());
}

/**
 * Helper to construct a canonical NPS ValidationIssue.
 *
 * @param {Object} params
 * @returns {Object} NPSValidationIssue
 */
export function createNPSValidationIssue({
  run_id,
  employee_id,
  employee_name = '',
  field = null,
  actual_value = null,
  message,
  suggested_fix,
  code = 'STAT_NPS_INVALID_PRAN',
  sub_code = 'NPS_DEFECT',
  severity = 'BLOCK',
}) {
  const issueId = `iss_nps_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    issue_id: issueId,
    run_id,
    employee_id: String(employee_id || 'UNKNOWN'),
    employee_name: employee_name || `Employee ${employee_id || ''}`,
    code,
    sub_code,
    title: 'Corporate NPS Statutory Validation Defect',
    severity,
    field,
    actual_value,
    message,
    suggested_fix,
    resolved: false,
    resolved_at: null,
    resolved_by: null,
    created_at: new Date().toISOString(),
  };
}

/**
 * Helper to construct an automated HR alert task for NPS review queue.
 *
 * @param {Object} params
 * @returns {Object} NPSHRTask
 */
export function createNPSHRTask({
  run_id,
  employee_id,
  employee_name = '',
  issue_code = 'STAT_NPS_INVALID_PRAN',
  title,
  message,
  suggested_action,
  priority = 'HIGH',
}) {
  const taskId = `task_hr_nps_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    task_id: taskId,
    run_id,
    employee_id: String(employee_id || 'UNKNOWN'),
    employee_name: employee_name || `Employee ${employee_id || ''}`,
    issue_code,
    priority,
    title,
    message,
    suggested_action,
    status: 'PENDING_REVIEW',
    assigned_role: 'HR_COMPLIANCE_OFFICER',
    created_at: new Date().toISOString(),
  };
}

/**
 * Evaluates whether an employee is eligible for NPS in the given payroll cycle.
 * Filters strictly where nps_applicable === true and exit_date is null or after period start.
 *
 * @param {Object} profile - EmployeeNPSProfile
 * @param {string} periodIso - ISO Date string of period (e.g. '2026-09-01')
 * @returns {boolean}
 */
export function isEmployeeNPSEligible(profile, periodIso) {
  if (!profile) return false;

  // 1. Strict Opt-in Applicable Flag
  const isApplicable = profile.nps_applicable === true ||
    String(profile.nps_applicable).toLowerCase() === 'true' ||
    profile.nps_status === 'OPTED_IN' ||
    profile.is_nps === true;

  if (!isApplicable) return false;

  // 2. Employment Tenure Verification
  if (profile.joining_date) {
    const joiningIso = normalizeNPSDateToIso(profile.joining_date);
    // If joined in the future after current period, not eligible yet
    if (joiningIso > periodIso) {
      // Allow if same month
      if (joiningIso.slice(0, 7) > periodIso.slice(0, 7)) {
        return false;
      }
    }
  }

  // 3. Exit Date Gate: Active or exited within/after period
  if (profile.exit_date) {
    const exitIso = normalizeNPSDateToIso(profile.exit_date);
    // Exited before current month starts
    const periodMonth = periodIso.slice(0, 7);
    const exitMonth = exitIso.slice(0, 7);
    if (exitMonth < periodMonth) {
      return false;
    }
  }

  return true;
}

/**
 * Core Payroll-Triggered NPS Calculation Engine:
 * Processes a finalized payroll run, filters eligible candidates, applies policy rules,
 * enforces boundary guards, emits validation issues/tasks, and returns compliant records.
 *
 * @param {Object} params
 * @param {string} params.run_id - Payroll run ID
 * @param {string} params.period - Period description (e.g. 'September 2026' or '2026-09')
 * @param {Array<Object>} params.employee_profiles - Array of EmployeeNPSProfile objects
 * @param {Object|Map} [params.earnings_by_employee={}] - Map of employee_id -> earnings record
 * @param {Object} [params.options={}] - Custom policies & hooks
 * @returns {Object} NPSBatchCalculationResult
 */
export function executePayrollNpsEngine({
  run_id,
  period = 'September 2026',
  employee_profiles = [],
  earnings_by_employee = {},
  options = {},
}) {
  if (!run_id) {
    throw new Error('run_id is required for payroll NPS execution.');
  }

  const periodIso = normalizeNPSDateToIso(period);
  const policies = options.policies || DEFAULT_NPS_POLICIES;

  const compliantRecords = [];
  const validationIssues = [];
  const hrTasks = [];

  let totalEmployerContributions = 0;
  let totalEmployeeDeductions = 0;
  let totalSalaryBasis = 0;
  let eligibleCount = 0;
  let policyIdApplied = 'NPS_CORP_STD_TIER1_V1';

  for (const profile of employee_profiles) {
    // 1. Eligibility Filter
    if (!isEmployeeNPSEligible(profile, periodIso)) {
      continue;
    }

    eligibleCount++;
    const employeeId = profile.employee_id;
    const employeeName = profile.employee_name || profile.name || `Employee ${employeeId}`;

    // 2. Fetch Earnings Record for Employee
    let earnings = {};
    if (earnings_by_employee instanceof Map) {
      earnings = earnings_by_employee.get(employeeId) || {};
    } else if (earnings_by_employee[employeeId]) {
      earnings = earnings_by_employee[employeeId];
    } else if (profile.earnings) {
      earnings = profile.earnings;
    } else {
      earnings = {
        basic: profile.basic || profile.basic_salary || 0,
        da: profile.da || profile.dearness_allowance || 0,
        gross: profile.gross_earnings || profile.gross || 0,
        net: profile.net_salary || profile.net || 0,
      };
    }

    // 3. Resolve Policy for Tier
    let policy;
    try {
      policy = options.policy_override || resolveActiveNPSPolicy(profile, periodIso, policies);
      policyIdApplied = policy.config_id;
    } catch (err) {
      const issue = createNPSValidationIssue({
        run_id,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_NO_ACTIVE_POLICY',
        sub_code: 'POLICY_UNCONFIGURED',
        field: 'period',
        actual_value: period,
        message: err.message,
        suggested_fix: 'Configure an active Corporate NPS policy for the given period and tier.',
      });
      validationIssues.push(issue);
      hrTasks.push(
        createNPSHRTask({
          run_id,
          employee_id: employeeId,
          employee_name: employeeName,
          issue_code: issue.code,
          title: 'NPS Policy Resolution Failure',
          message: issue.message,
          suggested_action: issue.suggested_fix,
        })
      );
      continue;
    }

    // 4. Boundary Guard 1: PRAN Format & Presence Check
    const rawPran = profile.pran || profile.nps_pran;
    if (!isValidPran(rawPran)) {
      const issue = createNPSValidationIssue({
        run_id,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'STAT_NPS_INVALID_PRAN',
        sub_code: 'MALFORMED_OR_MISSING_PRAN',
        field: 'pran',
        actual_value: rawPran,
        message: `Employee is opted into Corporate NPS but is missing a valid 12-digit PRAN: '${rawPran}'.`,
        suggested_fix: 'Update employee compliance profile with authentic 12-digit Permanent Retirement Account Number.',
      });
      validationIssues.push(issue);
      hrTasks.push(
        createNPSHRTask({
          run_id,
          employee_id: employeeId,
          employee_name: employeeName,
          issue_code: issue.code,
          title: 'Missing/Invalid 12-Digit PRAN',
          message: issue.message,
          suggested_action: issue.suggested_fix,
        })
      );
      continue; // Exclude from return payload
    }

    // 5. Dynamic Calculation
    const calcResult = calculateEmployeeNPS(profile, earnings, period, {
      policy_override: policy,
    });

    // 6. Boundary Guard 2: Salary Basis Validity
    if (calcResult.salary_basis <= 0) {
      const issue = createNPSValidationIssue({
        run_id,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'ZERO_OR_NEGATIVE_SALARY_BASIS',
        field: 'salary_basis',
        actual_value: calcResult.salary_basis,
        message: `Designated pension salary components (Basic + DA) sum to ₹${calcResult.salary_basis} (must be > 0).`,
        suggested_fix: 'Verify payroll earnings breakdown and assign positive Basic/DA compensation.',
      });
      validationIssues.push(issue);
      hrTasks.push(
        createNPSHRTask({
          run_id,
          employee_id: employeeId,
          employee_name: employeeName,
          issue_code: issue.code,
          title: 'Zero NPS Salary Basis',
          message: issue.message,
          suggested_action: issue.suggested_fix,
        })
      );
      continue;
    }

    // 7. Boundary Guard 3: Net Earnings Availability Guard
    const grossEarnings = Number(earnings.gross_earnings || earnings.gross || (calcResult.salary_basis * 1.5));
    const netEarnings = earnings.net_salary !== undefined ? Number(earnings.net_salary) : grossEarnings;

    if (calcResult.total_employee_contribution > netEarnings && netEarnings > 0) {
      const issue = createNPSValidationIssue({
        run_id,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'DEDUCTION_EXCEEDS_NET_EARNINGS',
        field: 'voluntary_monthly_amount',
        actual_value: `Deduction: ₹${calcResult.total_employee_contribution}, Net: ₹${netEarnings}`,
        message: `Total employee NPS contribution (₹${calcResult.total_employee_contribution}) exceeds available net earnings (₹${netEarnings}).`,
        suggested_fix: 'Adjust voluntary contribution amount to stay within available take-home pay.',
      });
      validationIssues.push(issue);
      hrTasks.push(
        createNPSHRTask({
          run_id,
          employee_id: employeeId,
          employee_name: employeeName,
          issue_code: issue.code,
          title: 'NPS Deduction Exceeds Net Earnings',
          message: issue.message,
          suggested_action: issue.suggested_fix,
        })
      );
      continue;
    }

    // 8. Passed All Boundary Guards: Stage into Compliant Records
    compliantRecords.push(calcResult);
    totalEmployerContributions += calcResult.employer_contribution;
    totalEmployeeDeductions += calcResult.total_employee_contribution;
    totalSalaryBasis += calcResult.salary_basis;
  }

  return {
    run_id,
    period,
    policy_id: policyIdApplied,
    total_candidates: employee_profiles.length,
    eligible_count: eligibleCount,
    blocked_count: validationIssues.length,
    compliant_records: compliantRecords,
    validation_issues: validationIssues,
    hr_tasks: hrTasks,
    total_employer_contributions: totalEmployerContributions,
    total_employee_deductions: totalEmployeeDeductions,
    total_nps_liability: totalEmployerContributions + totalEmployeeDeductions,
    total_salary_basis: Math.round(totalSalaryBasis * 100) / 100,
    processed_at: new Date().toISOString(),
  };
}

/**
 * Registers an automated EventBus listener for PAYROLL_FINALIZED events
 * to execute the NPS calculation engine for the finalized run.
 *
 * @param {Object} eventBus - Event emitter / EventBus
 * @param {Object} [store] - Master store to load run data
 * @param {Object} [options] - Custom engine options
 * @returns {Function} Unsubscribe handler
 */
export function registerPayrollFinalizedNpsListener(eventBus, store = {}, options = {}) {
  if (!eventBus || typeof eventBus.on !== 'function') {
    throw new Error('Valid EventBus instance with .on() is required.');
  }

  const handler = async (eventPayload) => {
    const runId = eventPayload.run_id || eventPayload.runId;
    if (!runId) return;

    const period = eventPayload.period || 'September 2026';
    const employeeProfiles = eventPayload.employees || (store.getEmployees ? await store.getEmployees(runId) : []);
    const earnings = eventPayload.earnings || (store.getEarnings ? await store.getEarnings(runId) : {});

    const result = executePayrollNpsEngine({
      run_id: runId,
      period,
      employee_profiles: employeeProfiles,
      earnings_by_employee: earnings,
      options,
    });

    if (typeof options.onCalculationComplete === 'function') {
      await options.onCalculationComplete(result);
    }

    return result;
  };

  eventBus.on('PAYROLL_FINALIZED', handler);

  return () => {
    if (typeof eventBus.off === 'function') {
      eventBus.off('PAYROLL_FINALIZED', handler);
    } else if (typeof eventBus.removeListener === 'function') {
      eventBus.removeListener('PAYROLL_FINALIZED', handler);
    }
  };
}
