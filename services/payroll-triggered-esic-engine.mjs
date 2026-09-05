/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL-TRIGGERED ESIC CALCULATION ENGINE
 * ============================================================================
 * Automated Event-Driven ESIC Statutory Compliance & Deduction Engine.
 *
 * Core Capabilities:
 *  1. Trigger & Eligibility Filter: Listens to PAYROLL_FINALIZED event for run_id.
 *     Filters candidates where esic_applicable === true and evaluates gross wages
 *     against active policy wage ceilings (standard vs disabled).
 *  2. Dynamic Calculation: Computes Employee Deductions (Gross * EmployeeRate)
 *     and Employer Contributions (Gross * EmployerRate) using versioned policy rules.
 *  3. Exception & Task Automation: Flags blocking ValidationIssues for malformed
 *     ESIC numbers or un-grandfathered wage ceiling breaches, dispatches actionable
 *     alerts to the HR task queue, and isolates clean return payloads.
 *
 * @version 3.2.0
 * @author Kylrx AI Lead Systems Architect
 */

import crypto from 'node:crypto';
import { resolveEsicPolicy, applyRoundingRule, normalizeDate } from './esic-policy-resolver-service.mjs';
import { ESIC_10_DIGIT_REGEX } from './esic-bulk-ingestion-processor.mjs';

/**
 * Executes ESIC Statutory Calculation upon PAYROLL_FINALIZED event.
 *
 * @param {object} params
 * @param {string} params.run_id Unique payroll run identifier
 * @param {string} params.period Payroll period (e.g., 'September 2026', '2026-09-01')
 * @param {Array<object>} params.payroll_records Array of employee payroll calculations { employee_id, gross_wages, ... }
 * @param {Array<object>} [params.employee_profiles=[]] Array of master EmployeeESICProfile records
 * @param {Array<object>} [params.custom_policy_registry] Optional custom effective-dated policy rules
 * @param {object} [params.task_dispatcher] Optional custom task dispatcher / hook
 * @returns {Promise<object>} ESIC Execution Output with compliant records, exceptions, and task queue items
 */
export async function executePayrollEsicEngine({
  run_id,
  period,
  payroll_records = [],
  employee_profiles = [],
  custom_policy_registry = null,
  task_dispatcher = null,
}) {
  if (!run_id) {
    throw new Error('run_id is required for payroll-triggered ESIC calculation.');
  }
  if (!period) {
    throw new Error('period is required for payroll-triggered ESIC calculation.');
  }

  const normalizedPeriod = normalizeDate(period);
  const activePolicy = resolveEsicPolicy(normalizedPeriod, custom_policy_registry);

  // Map employee profiles by employee_id for fast lookup
  const profileMap = new Map();
  for (const prof of employee_profiles) {
    if (prof && prof.employee_id) {
      profileMap.set(prof.employee_id, prof);
    }
  }

  const compliantRecords = [];
  const blockingIssues = [];
  const hrTasks = [];
  const nonApplicableRecords = [];

  let totalCoveredStatutoryWages = 0;
  let totalEmployeeDeductions = 0;
  let totalEmployerContributions = 0;

  for (const rec of payroll_records) {
    const employeeId = rec.employee_id || rec.employeeId || rec.id;
    const grossWages = Number(rec.gross_wages ?? rec.grossSalary ?? rec.gross ?? 0);
    const profile = profileMap.get(employeeId) || {
      employee_id: employeeId,
      esic_number: rec.esic_number || rec.esic_ip_number || rec.ip_number || '',
      esic_applicable: rec.esic_applicable !== undefined ? Boolean(rec.esic_applicable) : Boolean(rec.esic_number || rec.esic_ip_number),
      disability_flag: Boolean(rec.disability_flag),
      is_grandfathered: Boolean(rec.is_grandfathered),
      date_of_joining: rec.date_of_joining || '2024-01-01',
      date_of_exit: rec.date_of_exit || null,
      employee_name: rec.employee_name || rec.name || 'Employee',
    };

    // 1. Trigger & Eligibility Filter: Strictly evaluate candidates where esic_applicable === true
    if (profile.esic_applicable !== true) {
      nonApplicableRecords.push({
        employee_id: employeeId,
        gross_wages: grossWages,
        status: 'NON_APPLICABLE',
      });
      continue;
    }

    const employeeName = profile.employee_name || rec.employee_name || rec.name || employeeId;
    const esicNumber = String(profile.esic_number || rec.esic_number || '').trim();
    const isPersonWithDisability = Boolean(profile.disability_flag);
    const applicableWageCeiling = isPersonWithDisability
      ? activePolicy.wage_ceiling_disabled
      : activePolicy.wage_ceiling_standard;
    const isGrandfathered = Boolean(profile.is_grandfathered || rec.is_grandfathered);

    let hasBlockingError = false;

    // 2. Exception Check: Missing or Invalid 10-Digit Statutory ESIC Number
    if (!esicNumber || !ESIC_10_DIGIT_REGEX.test(esicNumber)) {
      hasBlockingError = true;
      const issueId = `ISSUE-${run_id}-${employeeId}-ESIC_NUM`;
      const taskId = `TASK-HR-${run_id}-${employeeId}-ESIC_NUM`;

      const issue = {
        issue_id: issueId,
        run_id,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'EMP038',
        canonical_code: 'ERR_MALFORMED_ESIC_NUMBER',
        severity: 'BLOCK',
        field: 'esic_number',
        actual_value: esicNumber || null,
        message: `Employee is marked ESIC applicable but has missing or invalid 10-digit statutory ESIC/IP number: "${esicNumber}".`,
        suggested_fix: 'Update employee statutory profile with a valid 10-digit numeric ESIC Insurance Person (IP) number.',
        resolved: false,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date().toISOString(),
      };

      const task = {
        task_id: taskId,
        run_id,
        entity_id: employeeId,
        task_type: 'STATUTORY_REMEDIATION',
        assignee_role: 'HR_COMPLIANCE_OFFICER',
        priority: 'HIGH',
        title: `ESIC IP Number Missing/Invalid: ${employeeName} (${employeeId})`,
        description: `Payroll run ${run_id} detected invalid ESIC number "${esicNumber}" for active covered employee. File generation blocked until remediated.`,
        action_required: 'UPDATE_ESIC_IP_NUMBER',
        issue_ref: issueId,
        status: 'PENDING',
        due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h SLA
        created_at: new Date().toISOString(),
      };

      blockingIssues.push(issue);
      hrTasks.push(task);
    }

    // 3. Exception Check: Wage Ceiling Breach without Grandfathering
    if (grossWages > applicableWageCeiling && !isGrandfathered) {
      hasBlockingError = true;
      const issueId = `ISSUE-${run_id}-${employeeId}-WAGE_CEILING`;
      const taskId = `TASK-HR-${run_id}-${employeeId}-WAGE_CEILING`;

      const issue = {
        issue_id: issueId,
        run_id,
        employee_id: employeeId,
        employee_name: employeeName,
        code: 'EMP039',
        canonical_code: 'ERR_ESIC_WAGE_CEILING_BREACH',
        severity: 'BLOCK',
        field: 'gross_wages',
        actual_value: grossWages,
        message: `Employee gross wages (₹${grossWages}) exceed the active ESIC wage ceiling (₹${applicableWageCeiling}${isPersonWithDisability ? ' - Disabled Threshold' : ''}) without active contribution cycle grandfathering.`,
        suggested_fix: `Review employee ESIC applicability flag, verify if grandfathered under current half-yearly contribution cycle (April-Sep / Oct-March), or adjust wage ceiling override.`,
        resolved: false,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date().toISOString(),
      };

      const task = {
        task_id: taskId,
        run_id,
        entity_id: employeeId,
        task_type: 'STATUTORY_CEILING_REVIEW',
        assignee_role: 'HR_COMPLIANCE_OFFICER',
        priority: 'HIGH',
        title: `ESIC Wage Ceiling Exceeded: ${employeeName} (${employeeId})`,
        description: `Gross wages of ₹${grossWages} exceed statutory threshold ₹${applicableWageCeiling}. Review applicability or confirm grandfathering for run ${run_id}.`,
        action_required: 'ACKNOWLEDGE_CEILING_OR_EXEMPT',
        issue_ref: issueId,
        status: 'PENDING',
        due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };

      blockingIssues.push(issue);
      hrTasks.push(task);
    }

    // If record encountered any blocking issues, exclude from compliant return payload
    if (hasBlockingError) {
      continue;
    }

    // 4. Dynamic Calculation using active policy rates and statutory rounding
    const rawEeDeduction = grossWages * activePolicy.employee_rate;
    const rawErContribution = grossWages * activePolicy.employer_rate;

    const employeeDeduction = applyRoundingRule(rawEeDeduction, activePolicy.rounding_rule);
    const employerContribution = applyRoundingRule(rawErContribution, activePolicy.rounding_rule);
    const totalLineChallan = employeeDeduction + employerContribution;

    totalCoveredStatutoryWages += grossWages;
    totalEmployeeDeductions += employeeDeduction;
    totalEmployerContributions += employerContribution;

    compliantRecords.push({
      employee_id: employeeId,
      employee_name: employeeName,
      esic_number: esicNumber,
      gross_wages: grossWages,
      is_covered: true,
      is_disabled_scheme: isPersonWithDisability,
      is_grandfathered: isGrandfathered,
      applicable_wage_ceiling: applicableWageCeiling,
      employee_rate: activePolicy.employee_rate,
      employer_rate: activePolicy.employer_rate,
      employee_deduction: employeeDeduction,
      employer_contribution: employerContribution,
      total_challan_amount: totalLineChallan,
      rounding_rule: activePolicy.rounding_rule,
      policy_config_id: activePolicy.config_id,
    });
  }

  // Dispatch tasks via external dispatcher if provided
  if (task_dispatcher && typeof task_dispatcher.dispatchTasks === 'function' && hrTasks.length > 0) {
    try {
      await task_dispatcher.dispatchTasks(hrTasks);
    } catch (err) {
      console.warn('Task dispatcher notice:', err.message);
    }
  }

  const isCalculationClean = blockingIssues.length === 0;

  return {
    run_id,
    period: normalizedPeriod,
    policy_applied: activePolicy,
    is_valid: isCalculationClean,
    status: isCalculationClean ? 'COMPLETED' : 'REQUIRES_REMEDIATION',
    summary: {
      total_records_processed: payroll_records.length,
      total_applicable_candidates: payroll_records.length - nonApplicableRecords.length,
      total_compliant_ips: compliantRecords.length,
      total_blocked_exceptions: blockingIssues.length,
      total_statutory_wages: Math.round(totalCoveredStatutoryWages * 100) / 100,
      total_employee_deductions: totalEmployeeDeductions,
      total_employer_contributions: totalEmployerContributions,
      total_challan_liability: totalEmployeeDeductions + totalEmployerContributions,
    },
    compliant_records: compliantRecords,
    blocking_issues: blockingIssues,
    hr_tasks_created: hrTasks,
    non_applicable_records: nonApplicableRecords,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Event-Bus integration helper for attaching to PAYROLL_FINALIZED events.
 *
 * @param {object} eventBus Instance of EventBus or EventEmitter
 * @param {object} [options]
 */
export function registerPayrollFinalizedEsicListener(eventBus, options = {}) {
  if (!eventBus || typeof eventBus.on !== 'function') {
    throw new Error('Valid EventBus instance required to register PAYROLL_FINALIZED listener.');
  }

  eventBus.on('PAYROLL_FINALIZED', async (eventData) => {
    try {
      const payload = eventData?.payload || eventData || {};
      const runId = payload.run_id || payload.runId || eventData.entityId;
      const period = payload.period || payload.wage_period || 'September 2026';
      const records = payload.payroll_records || payload.records || [];
      const profiles = payload.employee_profiles || payload.profiles || [];

      const result = await executePayrollEsicEngine({
        run_id: runId,
        period,
        payroll_records: records,
        employee_profiles: profiles,
        ...options,
      });

      if (typeof options.onComplete === 'function') {
        options.onComplete(result);
      }

      return result;
    } catch (err) {
      if (typeof options.onError === 'function') {
        options.onError(err);
      } else {
        console.error('[ESIC Engine] Error processing PAYROLL_FINALIZED event:', err);
      }
    }
  });
}
