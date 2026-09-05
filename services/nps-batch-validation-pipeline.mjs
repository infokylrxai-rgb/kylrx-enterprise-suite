/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - NPS BATCH STAGING VALIDATION PIPELINE & EXCEPTION INTERCEPTOR
 * ============================================================================
 * Features:
 *  1. Validation Checks:
 *     - PRAN format integrity (strictly a 12-digit numeric string /^[0-9]{12}$/)
 *     - Duplicate PRAN checks across multiple employee profiles (intra-batch & cross-profile master registry)
 *     - Valid Tier selection (TIER_1 mandatory for corporate tax exemptions)
 *     - Contribution amounts > 0 and within policy bounds (Basic + DA > 0, net pay ceiling, policy rates)
 *     - Unambiguous contribution type (EMPLOYER_ONLY, EMPLOYEE_ONLY, or BOTH)
 *  2. Exception Interceptor:
 *     - Logs all validation failures as ValidationIssue entities (code: 'NPS_VAL_001', severity: 'BLOCK')
 *     - Triggers automated HR tasks and alerts for missing PRANs or invalid inputs
 *     - Excludes failed profiles from upcoming file export while leaving clean records in the batch
 *
 * @version 3.3.0
 * @author Kylrx AI Principal Systems Architect & Lead Backend Engineer
 */

import crypto from 'node:crypto';
import {
  DEFAULT_NPS_POLICIES,
  resolveActiveNPSPolicy,
  normalizeNPSDateToIso,
  computeNPSSalaryBasis,
  calculateEmployeeNPS,
} from './nps-policy-resolver-service.mjs';

/**
 * Validates PRAN string strictly against 12-digit statutory numeric format.
 *
 * @param {any} pran
 * @returns {boolean}
 */
export function isValidPranFormat(pran) {
  if (pran === null || pran === undefined) return false;
  return /^[0-9]{12}$/.test(String(pran).trim());
}

/**
 * Validates whether a contribution type is unambiguous and statutory compliant.
 *
 * @param {any} type
 * @returns {boolean}
 */
export function isValidContributionType(type) {
  if (!type || typeof type !== 'string') return false;
  const upper = type.trim().toUpperCase();
  return upper === 'EMPLOYER_ONLY' || upper === 'EMPLOYEE_ONLY' || upper === 'BOTH';
}

/**
 * Validates whether a tier selection is recognized.
 *
 * @param {any} tier
 * @returns {boolean}
 */
export function isValidTierSelection(tier) {
  if (!tier || typeof tier !== 'string') return false;
  const upper = tier.trim().toUpperCase();
  return upper === 'TIER_1' || upper === 'TIER_2';
}

/**
 * Helper to construct a canonical NPS ValidationIssue.
 *
 * @param {Object} params
 * @returns {Object} NPSValidationIssue
 */
export function createNPSValidationIssue({
  run_id = 'RUN_NPS_DEFAULT',
  employee_id = 'UNKNOWN',
  employee_name = '',
  field = null,
  actual_value = null,
  message,
  suggested_fix,
  code = 'NPS_VAL_001',
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
    title: 'NPS Batch Staging Validation Defect',
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
 * Helper to construct an automated HR alert task for the compliance review queue.
 *
 * @param {Object} params
 * @returns {Object} NPSHRTask
 */
export function createNPSHRTask({
  run_id = 'RUN_NPS_DEFAULT',
  employee_id = 'UNKNOWN',
  employee_name = '',
  issue_code = 'NPS_VAL_001',
  sub_code = 'NPS_DEFECT',
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
    sub_code,
    priority,
    title: title || `Action Required: NPS Defect (${sub_code})`,
    message,
    suggested_action,
    status: 'PENDING_REVIEW',
    assigned_role: 'HR_COMPLIANCE_OFFICER',
    created_at: new Date().toISOString(),
  };
}

/**
 * Validates an individual staged employee NPS record against all statutory blocking criteria:
 *  1. Employee ID presence
 *  2. PRAN format integrity (/^[0-9]{12}$/)
 *  3. Duplicate PRAN checks (intra-batch & cross-profile active master registry)
 *  4. Tier selection validity & TIER_1 mandatory corporate tax exemption gate
 *  5. Unambiguous contribution type (EMPLOYER_ONLY | EMPLOYEE_ONLY | BOTH)
 *  6. Salary basis & contribution amounts > 0 and within policy bounds
 *  7. Net earnings availability limit guard
 *
 * @param {Object} record - Staged Employee NPS record
 * @param {Object} context - Validation context
 * @param {string} context.run_id - Batch or Run ID
 * @param {string} context.period - Wage period
 * @param {Map<string, string>} [context.seenBatchPrans] - Map of PRAN -> employee_id within current batch
 * @param {Map<string, string>|Object} [context.existingPrans] - Map or object of PRAN -> employee_id in master registry
 * @param {Array<Object>} [context.policies] - Policy configurations
 * @returns {Array<Object>} List of ValidationIssue objects (empty if clean)
 */
export function validateNpsRecordPreFlight(record, context = {}) {
  const issues = [];
  const runId = context.run_id || context.batch_id || 'RUN_NPS_DEFAULT';
  const employeeId = record.employee_id ? String(record.employee_id).trim() : '';
  const employeeName = record.employee_name || record.name || `Employee ${employeeId || ''}`;

  // 1. Employee ID Check
  if (!employeeId) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: 'MISSING_ID',
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'MISSING_EMPLOYEE_ID',
        field: 'employee_id',
        actual_value: record.employee_id,
        message: 'Mandatory employee_id is missing or empty.',
        suggested_fix: 'Provide a valid unique employee identifier for the NPS staged record.',
      })
    );
    return issues; // Cannot proceed without employee ID
  }

  // 2. PRAN Format Integrity Check (must be strictly a 12-digit numeric string)
  const rawPran = record.pran !== undefined && record.pran !== null ? String(record.pran).trim() : '';
  if (!isValidPranFormat(rawPran)) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'INVALID_PRAN_FORMAT',
        field: 'pran',
        actual_value: record.pran,
        message: `PRAN '${record.pran}' is invalid. PRAN must strictly be a 12-digit numeric string.`,
        suggested_fix: 'Obtain and update employee profile with authentic 12-digit Permanent Retirement Account Number.',
      })
    );
  } else {
    // 3. Duplicate PRAN Checks
    // A. Intra-batch duplicate check
    if (context.seenBatchPrans) {
      if (context.seenBatchPrans.has(rawPran)) {
        const priorEmpId = context.seenBatchPrans.get(rawPran);
        issues.push(
          createNPSValidationIssue({
            run_id: runId,
            employee_id: employeeId,
            employee_name: employeeName,
            code: 'NPS_VAL_001',
            sub_code: 'DUPLICATE_PRAN_INTRA_BATCH',
            field: 'pran',
            actual_value: rawPran,
            message: `Duplicate PRAN '${rawPran}' detected within the current batch (already assigned to employee '${priorEmpId}').`,
            suggested_fix: 'Ensure each active employee profile maintains a unique 12-digit PRAN in the staging batch.',
          })
        );
      } else {
        context.seenBatchPrans.set(rawPran, employeeId);
      }
    }

    // B. Cross-profile / active master duplicate check
    if (context.existingPrans) {
      let existingEmpId = null;
      if (context.existingPrans instanceof Map) {
        existingEmpId = context.existingPrans.get(rawPran);
      } else if (context.existingPrans[rawPran]) {
        existingEmpId = context.existingPrans[rawPran];
      }

      if (existingEmpId && existingEmpId !== employeeId) {
        issues.push(
          createNPSValidationIssue({
            run_id: runId,
            employee_id: employeeId,
            employee_name: employeeName,
            code: 'NPS_VAL_001',
            sub_code: 'DUPLICATE_PRAN_CROSS_PROFILE',
            field: 'pran',
            actual_value: rawPran,
            message: `PRAN '${rawPran}' is already registered to another active profile ('${existingEmpId}') in master records.`,
            suggested_fix: 'Verify PRAN allocation with CRA NSDL master database to resolve cross-employee conflict.',
          })
        );
      }
    }
  }

  // 4. Tier Selection Check (TIER_1 mandatory for corporate tax exemptions)
  const rawTier = record.tier !== undefined && record.tier !== null ? String(record.tier).trim().toUpperCase() : '';
  if (!isValidTierSelection(rawTier)) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'INVALID_TIER_SELECTION',
        field: 'tier',
        actual_value: record.tier,
        message: `Invalid Tier selection '${record.tier}'. Tier must strictly be 'TIER_1' or 'TIER_2'.`,
        suggested_fix: "Select 'TIER_1' for standard corporate pension accounts or 'TIER_2' for voluntary investment.",
      })
    );
  } else {
    // Check TIER_1 mandatory requirement for corporate tax exemptions / employer contributions
    const contributionType = record.contribution_type ? String(record.contribution_type).trim().toUpperCase() : '';
    if (rawTier === 'TIER_2' && (contributionType === 'EMPLOYER_ONLY' || contributionType === 'BOTH')) {
      issues.push(
        createNPSValidationIssue({
          run_id: runId,
          employee_id: employeeId,
          employee_name: employeeName,
          code: 'NPS_VAL_001',
          sub_code: 'TIER1_MANDATORY_FOR_CORPORATE_EXEMPTION',
          field: 'tier',
          actual_value: `tier: ${rawTier}, contribution_type: ${contributionType}`,
          message: 'Employer co-contribution under Section 80CCD(2) is strictly permitted on TIER_1 accounts only.',
          suggested_fix: "Switch employee tier to 'TIER_1' to claim corporate employer co-contributions and tax exemptions.",
        })
      );
    }
  }

  // 5. Unambiguous Contribution Type Check
  const rawContribType = record.contribution_type !== undefined && record.contribution_type !== null
    ? String(record.contribution_type).trim().toUpperCase()
    : '';

  if (!isValidContributionType(rawContribType)) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'AMBIGUOUS_CONTRIBUTION_TYPE',
        field: 'contribution_type',
        actual_value: record.contribution_type,
        message: `Ambiguous or invalid contribution type '${record.contribution_type}'. Must strictly be 'EMPLOYER_ONLY', 'EMPLOYEE_ONLY', or 'BOTH'.`,
        suggested_fix: "Specify an explicit contribution scheme: 'EMPLOYER_ONLY', 'EMPLOYEE_ONLY', or 'BOTH'.",
      })
    );
  }

  // 6. Salary Basis & Contribution Amounts Checks
  const earnings = {
    basic: Number(record.basic || record.basic_salary || record.basic_pay || 0),
    da: Number(record.da || record.dearness_allowance || 0),
    gross: Number(record.gross_earnings || record.gross || 0),
    net: Number(record.net_salary || record.net || 0),
  };

  const basisResult = computeNPSSalaryBasis(earnings, ['BASIC', 'DA']);
  const salaryBasis = record.salary_basis !== undefined && Number(record.salary_basis) > 0
    ? Number(record.salary_basis)
    : basisResult.salary_basis;

  if (isNaN(salaryBasis) || salaryBasis <= 0) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'ZERO_OR_NEGATIVE_SALARY_BASIS',
        field: 'salary_basis',
        actual_value: salaryBasis,
        message: `Pension salary basis (Basic + DA) is ₹${salaryBasis}. Salary basis must be strictly greater than 0.`,
        suggested_fix: 'Ensure employee earnings breakdown includes valid positive Basic Pay and Dearness Allowance.',
      })
    );
  }

  // Check explicit or calculated contribution bounds
  if (record.employer_contribution !== undefined && Number(record.employer_contribution) < 0) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'INVALID_CONTRIBUTION_AMOUNT',
        field: 'employer_contribution',
        actual_value: record.employer_contribution,
        message: `Employer contribution cannot be negative: ₹${record.employer_contribution}.`,
        suggested_fix: 'Recalculate employer contribution using positive policy rate percentage.',
      })
    );
  }

  if (record.employee_mandatory_deduction !== undefined && Number(record.employee_mandatory_deduction) < 0) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'INVALID_CONTRIBUTION_AMOUNT',
        field: 'employee_mandatory_deduction',
        actual_value: record.employee_mandatory_deduction,
        message: `Employee mandatory deduction cannot be negative: ₹${record.employee_mandatory_deduction}.`,
        suggested_fix: 'Recalculate employee deduction using positive rate percentage.',
      })
    );
  }

  if (record.voluntary_monthly_amount !== undefined && Number(record.voluntary_monthly_amount) < 0) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'INVALID_CONTRIBUTION_AMOUNT',
        field: 'voluntary_monthly_amount',
        actual_value: record.voluntary_monthly_amount,
        message: `Voluntary monthly amount cannot be negative: ₹${record.voluntary_monthly_amount}.`,
        suggested_fix: 'Provide a positive amount or ₹0 for voluntary contribution.',
      })
    );
  }

  // 7. Net Earnings Ceiling Guard
  const totalEmployeeDeduction = Number(
    record.total_employee_contribution !== undefined
      ? record.total_employee_contribution
      : (Number(record.employee_mandatory_deduction || 0) + Number(record.voluntary_monthly_amount || 0))
  );

  const netEarnings = earnings.net > 0 ? earnings.net : (earnings.gross > 0 ? earnings.gross : (salaryBasis * 1.5));
  if (totalEmployeeDeduction > netEarnings && netEarnings > 0) {
    issues.push(
      createNPSValidationIssue({
        run_id: runId,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'NPS_VAL_001',
        sub_code: 'DEDUCTION_EXCEEDS_NET_EARNINGS',
        field: 'total_employee_contribution',
        actual_value: `Deduction: ₹${totalEmployeeDeduction}, Net: ₹${netEarnings}`,
        message: `Total employee NPS deduction (₹${totalEmployeeDeduction}) exceeds available net take-home earnings (₹${netEarnings}).`,
        suggested_fix: 'Adjust voluntary contribution amount to remain within available net salary.',
      })
    );
  }

  return issues;
}

/**
 * Executes the complete NPS Batch Staging Validation Pipeline:
 *  1. Ingests staged candidate records.
 *  2. Evaluates blocking validation criteria on each record:
 *     - PRAN format integrity (/^[0-9]{12}$/)
 *     - Duplicate PRAN detection (intra-batch and cross-profile active master)
 *     - Tier selection validity & TIER_1 corporate mandatory exemption rule
 *     - Contribution amounts > 0 and within policy bounds
 *     - Unambiguous contribution type (EMPLOYER_ONLY, EMPLOYEE_ONLY, BOTH)
 *  3. Exception Interceptor:
 *     - Logs structured ValidationIssue entities (code: 'NPS_VAL_001', severity: 'BLOCK')
 *     - Dispatches automated HR alert tasks to compliance queue
 *     - Excludes failed profiles from clean exportable records while leaving clean records in batch
 *
 * @param {Object} params
 * @param {string} [params.batch_id] - Staging batch identifier
 * @param {string} [params.run_id] - Source payroll run ID
 * @param {string} [params.period='September 2026'] - Wage period
 * @param {Array<Object>} [params.records=[]] - Staged candidate records
 * @param {Map<string, string>|Object} [params.existing_prans] - Master PRAN registry (PRAN -> employee_id)
 * @param {Object} [params.options={}] - Custom policies & hooks
 * @returns {Object} NPSBatchStagingValidationResult
 */
export function executeNpsBatchValidationPipeline({
  batch_id = `NPS_BATCH_${Date.now()}`,
  run_id,
  period = 'September 2026',
  records = [],
  existing_prans = new Map(),
  options = {},
}) {
  const effectiveRunId = run_id || batch_id;
  const periodIso = normalizeNPSDateToIso(period);
  const policies = options.policies || DEFAULT_NPS_POLICIES;

  const seenBatchPrans = new Map();
  const allValidationIssues = [];
  const allHrTasks = [];
  const cleanRecords = [];
  const blockedRecords = [];

  let totalEmployerShare = 0;
  let totalEmployeeShare = 0;

  for (const record of records) {
    // 1. Run Pre-Flight Validation Checks
    const preFlightIssues = validateNpsRecordPreFlight(record, {
      run_id: effectiveRunId,
      batch_id,
      period: periodIso,
      seenBatchPrans,
      existingPrans: existing_prans,
      policies,
    });

    if (preFlightIssues.length > 0) {
      // Exception Interceptor: Log issues and dispatch HR Tasks
      for (const issue of preFlightIssues) {
        allValidationIssues.push(issue);
        allHrTasks.push(
          createNPSHRTask({
            run_id: effectiveRunId,
            employee_id: issue.employee_id,
            employee_name: issue.employee_name,
            issue_code: issue.code,
            sub_code: issue.sub_code,
            title: `NPS Defect: ${issue.sub_code}`,
            message: issue.message,
            suggested_action: issue.suggested_fix,
            priority: issue.sub_code === 'INVALID_PRAN_FORMAT' || issue.sub_code === 'DUPLICATE_PRAN_INTRA_BATCH'
              ? 'CRITICAL'
              : 'HIGH',
          })
        );
      }

      // Exclude defective record from upcoming file export
      blockedRecords.push({
        record,
        issues: preFlightIssues,
      });
      continue;
    }

    // 2. Compute Calculation Output for Clean Record
    let calculatedCleanRecord;
    try {
      const earnings = {
        basic: Number(record.basic || record.basic_salary || record.basic_pay || 0),
        da: Number(record.da || record.dearness_allowance || 0),
        gross: Number(record.gross_earnings || record.gross || 0),
        net: Number(record.net_salary || record.net || 0),
      };

      calculatedCleanRecord = calculateEmployeeNPS(record, earnings, period, {
        policies,
        policy_override: options.policy_override,
      });

      // Verification that final calculated contribution is > 0
      if (calculatedCleanRecord.total_nps_contribution <= 0) {
        const issue = createNPSValidationIssue({
          run_id: effectiveRunId,
          employee_id: record.employee_id,
          employee_name: record.employee_name,
          code: 'NPS_VAL_001',
          sub_code: 'ZERO_OR_NEGATIVE_CONTRIBUTION',
          field: 'total_nps_contribution',
          actual_value: calculatedCleanRecord.total_nps_contribution,
          message: `Calculated total NPS contribution is ₹${calculatedCleanRecord.total_nps_contribution} (must be > 0).`,
          suggested_fix: 'Verify policy contribution rates and salary basis.',
        });
        allValidationIssues.push(issue);
        allHrTasks.push(
          createNPSHRTask({
            run_id: effectiveRunId,
            employee_id: issue.employee_id,
            employee_name: issue.employee_name,
            issue_code: issue.code,
            sub_code: issue.sub_code,
            title: 'Zero Calculated Contribution',
            message: issue.message,
            suggested_action: issue.suggested_fix,
          })
        );
        blockedRecords.push({
          record,
          issues: [issue],
        });
        continue;
      }

      cleanRecords.push(calculatedCleanRecord);
      totalEmployerShare += calculatedCleanRecord.employer_contribution;
      totalEmployeeShare += calculatedCleanRecord.total_employee_contribution;
    } catch (err) {
      const issue = createNPSValidationIssue({
        run_id: effectiveRunId,
        employee_id: record.employee_id,
        employee_name: record.employee_name,
        code: 'NPS_VAL_001',
        sub_code: 'CALCULATION_ENGINE_ERROR',
        field: null,
        actual_value: null,
        message: `Calculation failure: ${err.message}`,
        suggested_fix: 'Verify policy parameters and employee compensation configuration.',
      });
      allValidationIssues.push(issue);
      allHrTasks.push(
        createNPSHRTask({
          run_id: effectiveRunId,
          employee_id: record.employee_id,
          employee_name: record.employee_name,
          issue_code: issue.code,
          sub_code: issue.sub_code,
          title: 'Calculation Engine Exception',
          message: issue.message,
          suggested_action: issue.suggested_fix,
        })
      );
      blockedRecords.push({
        record,
        issues: [issue],
      });
    }
  }

  const blockingIssues = allValidationIssues.filter((i) => i.severity === 'BLOCK' && !i.resolved);
  const isBlocked = blockingIssues.length > 0;
  const canExportFile = cleanRecords.length > 0;

  let status = 'PASSED';
  if (blockedRecords.length > 0 && cleanRecords.length > 0) {
    status = 'PARTIAL';
  } else if (blockedRecords.length > 0 && cleanRecords.length === 0) {
    status = 'BLOCKED';
  }

  return {
    batch_id,
    run_id: effectiveRunId,
    period,
    status,
    is_blocked: isBlocked,
    can_export_file: canExportFile,
    total_staged: records.length,
    clean_count: cleanRecords.length,
    blocked_count: blockedRecords.length,
    clean_records: cleanRecords,
    blocked_records: blockedRecords,
    validation_issues: allValidationIssues,
    blocking_issues: blockingIssues,
    hr_tasks: allHrTasks,
    total_employer_share: totalEmployerShare,
    total_employee_share: totalEmployeeShare,
    total_nps_liability: totalEmployerShare + totalEmployeeShare,
    validation_timestamp: new Date().toISOString(),
  };
}
