/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - GRATUITY VALIDATION PIPELINE & EXCEPTION INTERCEPTOR
 * ============================================================================
 * Features:
 *  1. Pre-Flight Validation:
 *     - Missing or logically inverted dates (date_of_exit <= date_of_joining)
 *     - Salary basis <= 0 or NaN (Basic + DA)
 *     - Duplicate exit settlement records (intra-batch & prior history)
 *     - Incomplete nominee details (ensuring share_percentage sums to exactly 100%)
 *  2. Vesting & Eligibility Gate Interceptor (unvested without death/disability bypass)
 *  3. Structured ValidationIssue generation (code: 'GRAT_VAL_001', severity: 'BLOCK')
 *  4. Automated HR Alert Task dispatching to administrator review queue
 *  5. Disbursement workflow blocking guardrail
 *
 * @version 3.3.0
 * @author Kylrx AI Lead Systems Architect & Principal Backend Engineer
 */

import crypto from 'node:crypto';
import {
  DEFAULT_GRATUITY_POLICIES,
  resolveActiveGratuityPolicy,
  normalizeDateToIso,
} from './gratuity-policy-resolver-service.mjs';
import { executeGratuityCalculationEngine } from './statutory-gratuity-calculation-engine.mjs';

/**
 * Validates whether a date string is a valid ISO calendar date without rollover.
 *
 * @param {any} dateVal
 * @returns {boolean}
 */
export function isValidCalendarDate(dateVal) {
  if (!dateVal || typeof dateVal !== 'string') return false;
  const match = dateVal.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Helper to construct a canonical Gratuity ValidationIssue.
 *
 * @param {Object} params
 * @returns {Object} GratuityValidationIssue
 */
export function createGratuityValidationIssue({
  batch_id,
  employee_id,
  employee_name = '',
  field = null,
  actual_value = null,
  message,
  suggested_fix,
  sub_code = 'PRE_FLIGHT_DEFECT',
  severity = 'BLOCK',
}) {
  const issueId = `iss_grat_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    issue_id: issueId,
    batch_id,
    employee_id: String(employee_id || 'UNKNOWN'),
    employee_name: employee_name || `Employee ${employee_id || ''}`,
    code: 'GRAT_VAL_001',
    sub_code,
    title: 'Gratuity Statutory Validation Failure',
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
 * Helper to construct an automated HR alert task for the administrator queue.
 *
 * @param {Object} params
 * @returns {Object} GratuityHRTask
 */
export function createGratuityHRTask({
  batch_id,
  employee_id,
  employee_name = '',
  issue_code = 'GRAT_VAL_001',
  title,
  message,
  suggested_action,
  priority = 'HIGH',
}) {
  const taskId = `task_hr_grat_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    task_id: taskId,
    batch_id,
    employee_id: String(employee_id || 'UNKNOWN'),
    employee_name: employee_name || `Employee ${employee_id || ''}`,
    issue_code,
    priority,
    title,
    message,
    suggested_action,
    status: 'PENDING_REVIEW',
    assigned_role: 'HR_STATUTORY_ADMIN',
    created_at: new Date().toISOString(),
  };
}

/**
 * Performs pre-flight checks on an individual employee gratuity profile.
 *
 * @param {Object} profile - EmployeeGratuityProfile
 * @param {Object} context - Validation context (batch_id, seenBatchIds, historicalSettlements)
 * @returns {Array<Object>} List of ValidationIssue objects (empty if clean)
 */
export function validateGratuityRecordPreFlight(profile, context = {}) {
  const issues = [];
  const batchId = context.batch_id || 'GRAT_BATCH_DEFAULT';
  const employeeId = profile.employee_id ? String(profile.employee_id).trim() : '';
  const employeeName = profile.employee_name || profile.name || `Employee ${employeeId}`;

  // 1. Missing Employee ID
  if (!employeeId) {
    issues.push(
      createGratuityValidationIssue({
        batch_id: batchId,
        employee_id: 'MISSING_ID',
        employee_name: employeeName,
        field: 'employee_id',
        actual_value: profile.employee_id,
        message: 'Mandatory field employee_id is missing or empty.',
        suggested_fix: 'Provide a valid unique employee identifier for the gratuity claim.',
        sub_code: 'MISSING_EMPLOYEE_ID',
      })
    );
    return issues; // Cannot proceed without employee ID
  }

  // 2. Duplicate Exit Settlement Checks
  if (context.seenBatchIds && context.seenBatchIds.has(employeeId)) {
    issues.push(
      createGratuityValidationIssue({
        batch_id: batchId,
        employee_id: employeeId,
        employee_name: employeeName,
        field: 'employee_id',
        actual_value: employeeId,
        message: `Duplicate exit settlement record detected for employee_id '${employeeId}' within the current batch.`,
        suggested_fix: 'Deduplicate the gratuity batch by removing redundant settlement records for this employee.',
        sub_code: 'DUPLICATE_BATCH_SETTLEMENT',
      })
    );
  } else if (context.seenBatchIds) {
    context.seenBatchIds.add(employeeId);
  }

  if (context.historicalSettlements && context.historicalSettlements.has(employeeId)) {
    issues.push(
      createGratuityValidationIssue({
        batch_id: batchId,
        employee_id: employeeId,
        employee_name: employeeName,
        field: 'employee_id',
        actual_value: employeeId,
        message: `Gratuity settlement has already been previously processed and finalized for employee_id '${employeeId}'.`,
        suggested_fix: 'Review historical settlement registry or initiate an authorized reinstatement/override workflow.',
        sub_code: 'PRIOR_SETTLEMENT_EXISTS',
      })
    );
  }

  // 3. Date Validation: Missing, Invalid ISO, or Inverted
  let joiningIso = '';
  let exitIso = '';

  try {
    joiningIso = normalizeDateToIso(profile.date_of_joining);
  } catch (err) {
    issues.push(
      createGratuityValidationIssue({
        batch_id: batchId,
        employee_id: employeeId,
        employee_name: employeeName,
        field: 'date_of_joining',
        actual_value: profile.date_of_joining,
        message: `Invalid or missing date_of_joining: '${profile.date_of_joining}'.`,
        suggested_fix: 'Ensure date_of_joining is provided in valid YYYY-MM-DD or DD/MM/YYYY format.',
        sub_code: 'INVALID_JOINING_DATE',
      })
    );
  }

  try {
    exitIso = normalizeDateToIso(profile.date_of_exit);
  } catch (err) {
    issues.push(
      createGratuityValidationIssue({
        batch_id: batchId,
        employee_id: employeeId,
        employee_name: employeeName,
        field: 'date_of_exit',
        actual_value: profile.date_of_exit,
        message: `Invalid or missing date_of_exit: '${profile.date_of_exit}'.`,
        suggested_fix: 'Ensure date_of_exit is provided in valid YYYY-MM-DD or DD/MM/YYYY format.',
        sub_code: 'INVALID_EXIT_DATE',
      })
    );
  }

  if (joiningIso && exitIso) {
    if (!isValidCalendarDate(joiningIso)) {
      issues.push(
        createGratuityValidationIssue({
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          field: 'date_of_joining',
          actual_value: joiningIso,
          message: `Non-existent calendar date for date_of_joining: '${joiningIso}'.`,
          suggested_fix: 'Correct date_of_joining to a valid calendar date.',
          sub_code: 'INVALID_CALENDAR_DATE_JOINING',
        })
      );
    }

    if (!isValidCalendarDate(exitIso)) {
      issues.push(
        createGratuityValidationIssue({
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          field: 'date_of_exit',
          actual_value: exitIso,
          message: `Non-existent calendar date for date_of_exit: '${exitIso}'.`,
          suggested_fix: 'Correct date_of_exit to a valid calendar date.',
          sub_code: 'INVALID_CALENDAR_DATE_EXIT',
        })
      );
    }

    // Inverted Date Rule: date_of_exit <= date_of_joining
    if (new Date(exitIso).getTime() <= new Date(joiningIso).getTime()) {
      issues.push(
        createGratuityValidationIssue({
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          field: 'date_of_exit',
          actual_value: `Joining: ${joiningIso}, Exit: ${exitIso}`,
          message: `Logically inverted dates: date_of_exit (${exitIso}) must be strictly later than date_of_joining (${joiningIso}).`,
          suggested_fix: 'Correct the employment tenure dates in the employee master profile.',
          sub_code: 'INVERTED_TENURE_DATES',
        })
      );
    }
  }

  // 4. Salary Basis Checks: Basic + DA <= 0 or NaN
  const basic = Number(profile.last_drawn_basic);
  const da = Number(profile.last_drawn_da || 0);
  const salaryBasis = basic + da;

  if (isNaN(basic) || isNaN(da) || isNaN(salaryBasis) || salaryBasis <= 0) {
    issues.push(
      createGratuityValidationIssue({
        batch_id: batchId,
        employee_id: employeeId,
        employee_name: employeeName,
        field: 'last_drawn_basic',
        actual_value: `Basic: ${profile.last_drawn_basic}, DA: ${profile.last_drawn_da}, Sum: ${salaryBasis}`,
        message: `Invalid salary basis: Last drawn wages (Basic: ₹${basic}, DA: ₹${da}) sum to ₹${salaryBasis} (must be > 0 and numeric).`,
        suggested_fix: 'Update the employee compensation profile with positive last drawn Basic and DA components.',
        sub_code: 'INVALID_SALARY_BASIS',
      })
    );
  }

  // 5. Nominee Details Validation: Must sum to strictly 100%
  const nominees = profile.nominees;
  const exitReason = String(profile.exit_reason || '').toUpperCase();

  if (Array.isArray(nominees) && nominees.length > 0) {
    let shareSum = 0;
    let hasMalformedNominee = false;

    nominees.forEach((nom, idx) => {
      const share = Number(nom.share_percentage);
      const name = String(nom.nominee_name || '').trim();
      const relation = String(nom.relationship || '').trim();

      if (!name || !relation || isNaN(share) || share <= 0 || share > 100) {
        hasMalformedNominee = true;
      } else {
        shareSum += share;
      }
    });

    if (hasMalformedNominee) {
      issues.push(
        createGratuityValidationIssue({
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          field: 'nominees',
          actual_value: nominees,
          message: 'Nominee record contains missing names, invalid relationships, or non-positive percentage shares.',
          suggested_fix: 'Ensure all nominee records contain valid names, statutory relationships, and positive percentage shares.',
          sub_code: 'MALFORMED_NOMINEE_RECORD',
        })
      );
    } else if (Math.abs(shareSum - 100) > 0.001) {
      issues.push(
        createGratuityValidationIssue({
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          field: 'nominees',
          actual_value: `${shareSum}%`,
          message: `Incomplete nominee details: Nominee share percentages sum to ${shareSum}% (must sum to exactly 100%).`,
          suggested_fix: 'Adjust beneficiary percentage shares in the nominee declaration form so the sum equals exactly 100%.',
          sub_code: 'NOMINEE_PERCENTAGE_MISMATCH',
        })
      );
    }
  } else if (exitReason === 'DEATH') {
    // If exit reason is Death, nominees declaration is mandatory for settlement
    issues.push(
      createGratuityValidationIssue({
        batch_id: batchId,
        employee_id: employeeId,
        employee_name: employeeName,
        field: 'nominees',
        actual_value: null,
        message: 'Nominee details are mandatory for death claim settlement, but none were declared.',
        suggested_fix: 'Upload Form F Nominee Declaration or Legal Heir certificate before processing death claim payout.',
        sub_code: 'MISSING_DEATH_CLAIM_NOMINEES',
      })
    );
  }

  return issues;
}

/**
 * Validates vesting eligibility for a clean pre-flight record.
 * Flags unvested employees exiting without Death/Disability bypass.
 *
 * @param {Object} profile - EmployeeGratuityProfile
 * @param {Object} policy - Active Gratuity policy
 * @param {string} batchId - Batch ID
 * @returns {Array<Object>} Validation issues
 */
export function validateVestingEligibility(profile, policy, batchId) {
  const issues = [];
  const employeeId = profile.employee_id;
  const employeeName = profile.employee_name || profile.name || `Employee ${employeeId}`;
  const exitReason = String(profile.exit_reason || 'RESIGNATION').toUpperCase();

  const joiningIso = normalizeDateToIso(profile.date_of_joining);
  const exitIso = normalizeDateToIso(profile.date_of_exit);

  const diffMs = new Date(exitIso).getTime() - new Date(joiningIso).getTime();
  const tenureDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const minVestingDays = policy.min_vesting_days || 1825;

  const isBypassed = policy.death_disability_bypass_vesting && (exitReason === 'DEATH' || exitReason === 'DISABILITY');

  if (!isBypassed && tenureDays < minVestingDays) {
    const tenureYears = Math.round((tenureDays / 365.25) * 10) / 10;
    issues.push(
      createGratuityValidationIssue({
        batch_id: batchId,
        employee_id: employeeId,
        employee_name: employeeName,
        field: 'tenure_days',
        actual_value: `${tenureDays} days (${tenureYears} yrs)`,
        message: `Employee is not eligible for statutory gratuity: Completed tenure of ${tenureDays} days (${tenureYears} years) is below the statutory vesting threshold of ${minVestingDays} days (5 years) for exit reason '${exitReason}'.`,
        suggested_fix: 'Verify date_of_joining/date_of_exit or check if an authorized management vesting exception applies.',
        sub_code: 'NON_VESTED_TENURE_DEFECT',
      })
    );
  }

  return issues;
}

/**
 * Executes the complete Gratuity Validation Pipeline:
 *  1. Ingests candidate records
 *  2. Runs pre-flight validation (dates, salary, duplicates, nominees)
 *  3. Evaluates vesting gates & statutory exemptions
 *  4. Dispatches actionable HR tasks for all defects
 *  5. Isolates clean settlements into staged_settlements
 *  6. Blocks disbursement workflow if any blocking issues exist
 *
 * @param {Object} params
 * @param {string} params.batch_id - Unique batch ID
 * @param {Array<Object>} params.records - Array of EmployeeGratuityProfile
 * @param {Array<string>|Set<string>} [params.existing_settlements=[]] - Array of previously settled employee IDs
 * @param {Object} [params.options={}] - Policy overrides & custom configurations
 * @returns {Object} GratuityBatchValidationResult
 */
export function executeGratuityValidationPipeline({
  batch_id = `GRAT_BATCH_${Date.now()}`,
  records = [],
  existing_settlements = [],
  options = {},
}) {
  const seenBatchIds = new Set();
  const historicalSettlements = new Set(existing_settlements);
  const policies = options.policies || DEFAULT_GRATUITY_POLICIES;

  const allValidationIssues = [];
  const allHrTasks = [];
  const stagedSettlements = [];

  for (const record of records) {
    // 1. Run Pre-Flight Validation Checks
    const preFlightIssues = validateGratuityRecordPreFlight(record, {
      batch_id,
      seenBatchIds,
      historicalSettlements,
    });

    if (preFlightIssues.length > 0) {
      for (const issue of preFlightIssues) {
        allValidationIssues.push(issue);
        allHrTasks.push(
          createGratuityHRTask({
            batch_id,
            employee_id: issue.employee_id,
            employee_name: issue.employee_name,
            issue_code: issue.code,
            title: `Gratuity Validation Defect: ${issue.sub_code}`,
            message: issue.message,
            suggested_action: issue.suggested_fix,
            priority: 'HIGH',
          })
        );
      }
      continue; // Exclude defective record from staged calculation
    }

    // 2. Resolve Policy & Run Vesting Gate Check
    let policy;
    try {
      policy = options.policy_override || resolveActiveGratuityPolicy(record.date_of_exit, policies);
    } catch (err) {
      const issue = createGratuityValidationIssue({
        batch_id,
        employee_id: record.employee_id,
        employee_name: record.employee_name,
        field: 'date_of_exit',
        actual_value: record.date_of_exit,
        message: err.message,
        suggested_fix: 'Configure an active statutory gratuity policy for the specified exit date.',
        sub_code: 'NO_ACTIVE_POLICY',
      });
      allValidationIssues.push(issue);
      allHrTasks.push(
        createGratuityHRTask({
          batch_id,
          employee_id: record.employee_id,
          employee_name: record.employee_name,
          issue_code: issue.code,
          title: 'Gratuity Policy Configuration Missing',
          message: issue.message,
          suggested_action: issue.suggested_fix,
          priority: 'CRITICAL',
        })
      );
      continue;
    }

    const vestingIssues = validateVestingEligibility(record, policy, batch_id);
    if (vestingIssues.length > 0) {
      for (const issue of vestingIssues) {
        allValidationIssues.push(issue);
        allHrTasks.push(
          createGratuityHRTask({
            batch_id,
            employee_id: issue.employee_id,
            employee_name: issue.employee_name,
            issue_code: issue.code,
            title: 'Gratuity Vesting Gate Exception',
            message: issue.message,
            suggested_action: issue.suggested_fix,
            priority: 'HIGH',
          })
        );
      }
      continue; // Exclude unvested record from payable staged settlements
    }

    // 3. Calculation Engine Execution for Compliant Record
    try {
      const engineResult = executeGratuityCalculationEngine(record, {
        policy_override: policy,
      });
      stagedSettlements.push(engineResult.settlement);
    } catch (err) {
      const issue = createGratuityValidationIssue({
        batch_id,
        employee_id: record.employee_id,
        employee_name: record.employee_name,
        field: null,
        actual_value: null,
        message: `Calculation engine failure: ${err.message}`,
        suggested_fix: 'Review employee profile compensation values and date inputs.',
        sub_code: 'CALCULATION_ENGINE_ERROR',
      });
      allValidationIssues.push(issue);
      allHrTasks.push(
        createGratuityHRTask({
          batch_id,
          employee_id: record.employee_id,
          employee_name: record.employee_name,
          issue_code: issue.code,
          title: 'Calculation Engine Error',
          message: issue.message,
          suggested_action: issue.suggested_fix,
          priority: 'HIGH',
        })
      );
    }
  }

  const blockingIssues = allValidationIssues.filter((i) => i.severity === 'BLOCK' && !i.resolved);
  const isBlocked = blockingIssues.length > 0;
  const canDisburse = !isBlocked && stagedSettlements.length > 0;

  let status = 'PASSED';
  if (isBlocked && stagedSettlements.length > 0) {
    status = 'PARTIAL';
  } else if (isBlocked) {
    status = 'BLOCKED';
  }

  return {
    batch_id,
    status,
    is_blocked: isBlocked,
    can_disburse: canDisburse,
    total_records: records.length,
    valid_count: stagedSettlements.length,
    blocked_count: allValidationIssues.length,
    staged_settlements: stagedSettlements,
    validation_issues: allValidationIssues,
    blocking_issues: blockingIssues,
    hr_tasks: allHrTasks,
    validation_timestamp: new Date().toISOString(),
  };
}
