/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - MODULAR STATUTORY WORKFLOWS ORCHESTRATOR
 * ============================================================================
 * Satisfies Criteria 8, 9, and 10 using versioned, effective-dated policies:
 *
 * 1. Criterion 8: ESIC Multi-Stage Pipeline:
 *    Explicit sequential stages:
 *    Stage 1: Profile Master Sync
 *    Stage 2: Calculation (0.75% EE / 3.25% ER)
 *    Stage 3: Format Validation (10-digit IP regex)
 *    Stage 4: Exception Queue (isolation of defects & HR tasks)
 *    Stage 5: Return Layout Mapping (official 6-column ESIC portal layout)
 *    Stage 6: Output Generation (CSV and Excel-compatible matrix with SHA-256)
 *
 * 2. Criterion 9: Gratuity Rule Engine:
 *    Vesting and payout calculator using effective-dated parameters (min_vesting_days,
 *    15/26 factor, statutory cap ₹20L, Death/Disability bypass). Emits a fully
 *    traceable execution receipt capturing intermediate variables, input salary basis,
 *    and applied policy_version_id.
 *
 * 3. Criterion 10: NPS Validation & NSDL CRA Export:
 *    Validates 12-digit PRAN format, active tier selection, and Sec 80CCD contribution
 *    boundaries before file compilation. Compiles standardized NSDL CRA Subscriber
 *    Contribution Files (.txt SCF format with Caret ^ delimiter) strictly after
 *    clearing all data checks.
 *
 * @version 1.0.0
 * @author Kylrx AI Lead Statutory Compliance Team
 */

import crypto from 'node:crypto';

// Import foundational policy resolvers & helpers
import {
  resolveEsicPolicy,
  applyRoundingRule as applyEsicRounding,
  normalizeDate as normalizeEsicDate,
} from './esic-policy-resolver-service.mjs';

import {
  DEFAULT_GRATUITY_POLICIES,
  resolveActiveGratuityPolicy,
  normalizeDateToIso as normalizeGratuityDate,
  calculateGratuityTenure,
} from './gratuity-policy-resolver-service.mjs';

import {
  DEFAULT_NPS_POLICIES,
  resolveActiveNPSPolicy,
  normalizeNPSDateToIso,
  computeNPSSalaryBasis,
} from './nps-policy-resolver-service.mjs';

import { isValidPranFormat } from './nps-batch-validation-pipeline.mjs';
import { generateNsdlCraScfFile } from './nsdl-cra-scf-generation-service.mjs';

export const ESIC_10_DIGIT_IP_REGEX = /^[0-9]{10}$/;

/* ============================================================================
 * 1. CRITERION 8: ESIC MULTI-STAGE PIPELINE
 * ============================================================================
 */

export class EsicMultiStagePipeline {
  constructor(options = {}) {
    this.customPolicyRegistry = options.customPolicyRegistry || null;
  }

  /**
   * Stage 1: Profile Master Sync
   * Syncs candidate payroll calculations with employee master ESIC profiles.
   */
  stage1_profileMasterSync(payrollRecords = [], employeeProfiles = [], period = '2026-09') {
    const normalizedPeriod = normalizeEsicDate(period);
    const activePolicy = resolveEsicPolicy(normalizedPeriod, this.customPolicyRegistry);

    const profileMap = new Map();
    for (const prof of employeeProfiles) {
      if (prof && prof.employee_id) {
        profileMap.set(String(prof.employee_id).trim(), prof);
      }
    }

    const candidateProfiles = [];
    const nonApplicableRecords = [];

    for (const rec of payrollRecords) {
      const empId = String(rec.employee_id || rec.employeeId || rec.id || '').trim();
      const grossWages = Number(rec.gross_wages ?? rec.grossSalary ?? rec.gross ?? 0);
      const profile = profileMap.get(empId) || {
        employee_id: empId,
        esic_number: rec.esic_number || rec.esic_ip_number || rec.ip_number || '',
        esic_applicable: rec.esic_applicable !== undefined ? Boolean(rec.esic_applicable) : Boolean(rec.esic_number || rec.esic_ip_number),
        disability_flag: Boolean(rec.disability_flag),
        is_grandfathered: Boolean(rec.is_grandfathered),
        days_worked: rec.days_worked !== undefined ? rec.days_worked : (rec.payable_days || 30),
        zero_days_reason_code: rec.zero_days_reason_code || null,
        last_working_day: rec.last_working_day || null,
        date_of_joining: rec.date_of_joining || '2024-01-01',
        date_of_exit: rec.date_of_exit || null,
        employee_name: rec.employee_name || rec.name || `Employee ${empId}`,
      };

      if (profile.esic_applicable !== true) {
        nonApplicableRecords.push({
          employee_id: empId,
          employee_name: profile.employee_name,
          gross_wages: grossWages,
          reason: 'ESIC_NOT_APPLICABLE',
        });
        continue;
      }

      candidateProfiles.push({
        ...profile,
        employee_id: empId,
        gross_wages: grossWages,
        days_worked: profile.days_worked !== undefined ? profile.days_worked : (rec.days_worked || 30),
        zero_days_reason_code: profile.zero_days_reason_code || rec.zero_days_reason_code || (profile.days_worked === 0 ? '1' : ''),
        last_working_day: profile.last_working_day || rec.last_working_day || '',
      });
    }

    return {
      active_policy: activePolicy,
      candidate_profiles: candidateProfiles,
      non_applicable_records: nonApplicableRecords,
    };
  }

  /**
   * Stage 2: Calculation (0.75% / 3.25%)
   * Applies statutory employee deduction and employer contribution rates.
   */
  stage2_calculation(candidateProfiles = [], activePolicy) {
    const calculatedRecords = [];

    for (const cand of candidateProfiles) {
      const gross = cand.gross_wages;
      const isPersonWithDisability = Boolean(cand.disability_flag);
      const applicableWageCeiling = isPersonWithDisability
        ? activePolicy.wage_ceiling_disabled
        : activePolicy.wage_ceiling_standard;

      // Unrounded statutory deductions
      const rawEeDeduction = gross * activePolicy.employee_rate; // 0.0075 (0.75%)
      const rawErContribution = gross * activePolicy.employer_rate; // 0.0325 (3.25%)

      // Statutory rounding
      const employeeDeduction = applyEsicRounding(rawEeDeduction, activePolicy.rounding_rule);
      const employerContribution = applyEsicRounding(rawErContribution, activePolicy.rounding_rule);
      const totalChallanLiability = employeeDeduction + employerContribution;

      // Check wage ceiling breach
      const isGrandfathered = Boolean(cand.is_grandfathered);
      const isCeilingBreached = gross > applicableWageCeiling && !isGrandfathered;

      calculatedRecords.push({
        ...cand,
        applicable_wage_ceiling: applicableWageCeiling,
        is_ceiling_breached: isCeilingBreached,
        employee_rate: activePolicy.employee_rate,
        employer_rate: activePolicy.employer_rate,
        employee_deduction: employeeDeduction,
        employer_contribution: employerContribution,
        total_challan_liability: totalChallanLiability,
        policy_version_id: activePolicy.config_id || activePolicy.version_id,
      });
    }

    return calculatedRecords;
  }

  /**
   * Stage 3: Format Validation (10-digit IP)
   * Validates statutory IP number structure and mandatory return fields.
   */
  stage3_formatValidation(calculatedRecords = []) {
    const validatedRecords = [];

    for (const rec of calculatedRecords) {
      const ipNo = String(rec.esic_number || rec.ip_number || rec.esic_ip_number || '').trim();
      const isIpValid = ESIC_10_DIGIT_IP_REGEX.test(ipNo);
      const validationErrors = [];

      if (!ipNo) {
        validationErrors.push('MISSING_ESIC_IP_NUMBER');
      } else if (!isIpValid) {
        validationErrors.push('MALFORMED_ESIC_IP_NUMBER_NOT_10_DIGITS');
      }

      if (rec.is_ceiling_breached) {
        validationErrors.push('WAGE_CEILING_BREACH_WITHOUT_GRANDFATHERING');
      }

      validatedRecords.push({
        ...rec,
        ip_number: ipNo,
        ip_format_valid: isIpValid,
        has_validation_errors: validationErrors.length > 0,
        validation_errors: validationErrors,
      });
    }

    return validatedRecords;
  }

  /**
   * Stage 4: Exception Queue
   * Isolates invalid / breached records from clean candidates.
   */
  stage4_exceptionQueue(validatedRecords = [], runId = 'RUN_DEFAULT') {
    const cleanRecords = [];
    const exceptionRecords = [];

    for (const rec of validatedRecords) {
      if (rec.has_validation_errors) {
        const exceptionEntry = {
          exception_id: `EXC_ESIC_${runId}_${rec.employee_id}`,
          run_id: runId,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          ip_number: rec.ip_number,
          gross_wages: rec.gross_wages,
          errors: rec.validation_errors,
          severity: 'BLOCK',
          remediation_task: {
            task_id: `TASK_ESIC_REMED_${runId}_${rec.employee_id}`,
            entity_id: rec.employee_id,
            action_required: rec.ip_format_valid ? 'CONFIRM_WAGE_CEILING_OR_EXEMPT' : 'UPDATE_10_DIGIT_IP_NUMBER',
            priority: 'HIGH',
            due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
          created_at: new Date().toISOString(),
        };
        exceptionRecords.push(exceptionEntry);
      } else {
        cleanRecords.push(rec);
      }
    }

    return {
      clean_records: cleanRecords,
      exception_records: exceptionRecords,
    };
  }

  /**
   * Stage 5: Return Layout Mapping
   * Maps clean records to the official 6-column ESIC portal layout.
   */
  stage5_returnLayoutMapping(cleanRecords = []) {
    const mappedRows = [];

    for (const rec of cleanRecords) {
      const daysWorked = rec.days_worked !== undefined ? rec.days_worked : 30;
      const zeroReason = daysWorked === 0 ? (rec.zero_days_reason_code || '1') : '';
      const lastWorkingDay = rec.last_working_day ? this._formatStatutoryDate(rec.last_working_day) : '';
      const sanitizedName = String(rec.employee_name || '').replace(/[,"]/g, '').trim();

      mappedRows.push({
        ip_number: rec.ip_number,
        ip_name: sanitizedName,
        days_worked: daysWorked,
        total_monthly_wages: Number(rec.gross_wages).toFixed(2),
        reason_code_zero_days: zeroReason,
        last_working_day: lastWorkingDay,
        // Internal metadata
        employee_id: rec.employee_id,
        employee_deduction: rec.employee_deduction,
        employer_contribution: rec.employer_contribution,
      });
    }

    return mappedRows;
  }

  /**
   * Stage 6: Output Generation (CSV & Excel-compatible matrix)
   * Produces downloadable file assets and cryptographic SHA-256 checksums.
   */
  stage6_outputGeneration(mappedRows = [], employerCode = '31000123450000999', wageMonth = '092026') {
    const headers = [
      'IP Number',
      'IP Name',
      'No of Days for which wages paid',
      'Total Monthly Wages',
      'Reason Code for Zero Working Days',
      'Last Working Day',
    ];

    const csvLines = [headers.join(',')];
    const excelRows = [];

    for (const row of mappedRows) {
      const csvRow = [
        row.ip_number,
        `"${row.ip_name}"`,
        row.days_worked,
        row.total_monthly_wages,
        row.reason_code_zero_days,
        row.last_working_day,
      ].join(',');

      csvLines.push(csvRow);

      excelRows.push([
        row.ip_number,
        row.ip_name,
        row.days_worked,
        Number(row.total_monthly_wages),
        row.reason_code_zero_days,
        row.last_working_day,
      ]);
    }

    const csvContent = csvLines.join('\r\n');
    const checksum = crypto.createHash('sha256').update(csvContent, 'utf8').digest('hex');

    return {
      csv_output: {
        file_name: `ESIC_RETURN_${employerCode}_${wageMonth}.csv`,
        content: csvContent,
        checksum_sha256: checksum,
      },
      excel_matrix_output: {
        headers,
        rows: excelRows,
        row_count: excelRows.length,
      },
    };
  }

  /**
   * End-to-end Orchestrator executing all 6 sequential stages.
   */
  async runPipeline({
    run_id,
    period,
    payroll_records = [],
    employee_profiles = [],
    employer_code = '31000123450000999',
  }) {
    if (!run_id) throw new Error('[EsicMultiStagePipeline] run_id is mandatory.');
    if (!period) throw new Error('[EsicMultiStagePipeline] period is mandatory.');

    const stageTraces = [];
    const startTime = new Date().toISOString();

    // Stage 1: Profile Master Sync
    const s1 = this.stage1_profileMasterSync(payroll_records, employee_profiles, period);
    stageTraces.push({
      stage: 'PROFILE_MASTER_SYNC',
      stage_order: 1,
      input_count: payroll_records.length,
      output_count: s1.candidate_profiles.length,
      executed_at: new Date().toISOString(),
      metadata: { non_applicable_count: s1.non_applicable_records.length },
    });

    // Stage 2: Calculation (0.75% / 3.25%)
    const s2 = this.stage2_calculation(s1.candidate_profiles, s1.active_policy);
    stageTraces.push({
      stage: 'CALCULATION',
      stage_order: 2,
      input_count: s1.candidate_profiles.length,
      output_count: s2.length,
      executed_at: new Date().toISOString(),
      metadata: {
        policy_version: s1.active_policy.config_id || s1.active_policy.version_id,
        employee_rate: s1.active_policy.employee_rate,
        employer_rate: s1.active_policy.employer_rate,
      },
    });

    // Stage 3: Format Validation (10-digit IP)
    const s3 = this.stage3_formatValidation(s2);
    stageTraces.push({
      stage: 'FORMAT_VALIDATION',
      stage_order: 3,
      input_count: s2.length,
      output_count: s3.length,
      executed_at: new Date().toISOString(),
    });

    // Stage 4: Exception Queue
    const s4 = this.stage4_exceptionQueue(s3, run_id);
    stageTraces.push({
      stage: 'EXCEPTION_QUEUE',
      stage_order: 4,
      input_count: s3.length,
      output_count: s4.clean_records.length,
      executed_at: new Date().toISOString(),
      metadata: { exceptions_isolated: s4.exception_records.length },
    });

    // Stage 5: Return Layout Mapping
    const s5 = this.stage5_returnLayoutMapping(s4.clean_records);
    stageTraces.push({
      stage: 'RETURN_LAYOUT_MAPPING',
      stage_order: 5,
      input_count: s4.clean_records.length,
      output_count: s5.length,
      executed_at: new Date().toISOString(),
    });

    // Stage 6: Output Generation (CSV / Excel)
    const wageMonth = String(period).replace(/[^0-9]/g, '').slice(0, 6) || '092026';
    const s6 = this.stage6_outputGeneration(s5, employer_code, wageMonth);
    stageTraces.push({
      stage: 'OUTPUT_GENERATION',
      stage_order: 6,
      input_count: s5.length,
      output_count: s5.length,
      executed_at: new Date().toISOString(),
      metadata: { checksum_sha256: s6.csv_output.checksum_sha256 },
    });

    // Compute financial aggregates across clean records
    let totalWages = 0;
    let totalEe = 0;
    let totalEr = 0;

    for (const r of s4.clean_records) {
      totalWages += r.gross_wages;
      totalEe += r.employee_deduction;
      totalEr += r.employer_contribution;
    }

    return {
      run_id,
      period,
      policy_version_id: s1.active_policy.config_id || 'ESIC_STATUTORY_V1',
      total_candidates: payroll_records.length,
      compliant_ip_count: s4.clean_records.length,
      exception_count: s4.exception_records.length,
      non_applicable_count: s1.non_applicable_records.length,
      total_wages: Math.round(totalWages * 100) / 100,
      total_employee_deduction_0_75: totalEe,
      total_employer_contribution_3_25: totalEr,
      total_challan_liability: totalEe + totalEr,
      stages_executed: stageTraces,
      clean_return_records: s5,
      esic_exceptions: s4.exception_records,
      csv_output: s6.csv_output,
      excel_matrix_output: s6.excel_matrix_output,
      generated_at: new Date().toISOString(),
    };
  }

  _formatStatutoryDate(dateStr) {
    if (!dateStr) return '';
    const str = String(dateStr).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return str;
  }
}

/* ============================================================================
 * 2. CRITERION 9: GRATUITY RULE ENGINE
 * ============================================================================
 */

export class GratuityRuleEngine {
  constructor(options = {}) {
    this.policies = options.policies || DEFAULT_GRATUITY_POLICIES;
  }

  /**
   * Calculates Gratuity with effective-dated parameters and outputs a traceable execution receipt.
   *
   * @param {object} params
   * @param {string} params.employee_id
   * @param {string} params.date_of_joining
   * @param {string} params.date_of_exit
   * @param {string} [params.exit_reason='RESIGNATION']
   * @param {number} params.last_drawn_basic
   * @param {number} [params.last_drawn_da=0]
   * @param {Array<object>} [params.nominees=[]]
   * @param {object} [params.policy_override]
   * @returns {object} GratuityCalculationResult
   */
  calculateWithTraceableReceipt({
    employee_id,
    date_of_joining,
    date_of_exit,
    exit_reason = 'RESIGNATION',
    last_drawn_basic,
    last_drawn_da = 0,
    nominees = [],
    policy_override = null,
  }) {
    if (!employee_id) throw new Error('[GratuityRuleEngine] employee_id is mandatory.');
    if (!date_of_joining) throw new Error('[GratuityRuleEngine] date_of_joining is mandatory.');
    if (!date_of_exit) throw new Error('[GratuityRuleEngine] date_of_exit is mandatory.');

    const dojIso = normalizeGratuityDate(date_of_joining);
    const doeIso = normalizeGratuityDate(date_of_exit);
    const reason = String(exit_reason || 'RESIGNATION').toUpperCase();

    // 1. Resolve Effective-Dated Policy
    const activePolicy = policy_override || resolveActiveGratuityPolicy(doeIso, this.policies);
    const policyVersionId = activePolicy.config_id || activePolicy.version_id || 'PGA_1972_STD_V1';

    // 2. Service Duration & Tenure Rounding
    const tenure = calculateGratuityTenure({
      date_of_joining: dojIso,
      date_of_exit: doeIso,
      service_rounding_rule: activePolicy.service_rounding_rule || 'ROUND_NEAREST_HALF_YEAR',
    });

    const continuousServiceDays = tenure.tenure_days;
    const completedServiceFactor = tenure.tenure_years_statutory;
    const tenureYearsRaw = tenure.tenure_years_raw;

    // 3. Vesting Gatekeeper (5 years / 1825 days, with statutory Death/Disability bypass)
    const minVestingDays = activePolicy.min_vesting_days !== undefined ? activePolicy.min_vesting_days : 1825;
    let isVested = continuousServiceDays >= minVestingDays;
    let bypassApplied = false;
    let bypassReason = null;

    if (activePolicy.death_disability_bypass_vesting && (reason === 'DEATH' || reason === 'DISABILITY')) {
      isVested = true;
      bypassApplied = true;
      bypassReason = `STATUTORY_EXEMPTION_${reason}`;
    }

    // 4. Input Salary Basis
    const basic = Number(last_drawn_basic || 0);
    const da = Number(last_drawn_da || 0);
    const salaryBasis = basic + da;

    if (salaryBasis <= 0) {
      throw new Error(`[GratuityRuleEngine] Salary Basis (Basic: ${basic}, DA: ${da}) must be strictly greater than 0.`);
    }

    // 5. Dynamic Formula Execution: (Salary Basis * Completed Service Factor * 15) / 26
    const daysPerYearFactor = activePolicy.days_per_year_factor || 15;
    const workingDaysDivisor = activePolicy.working_days_divisor || 26;

    const rawFormulaOutput = Math.round(
      (salaryBasis * completedServiceFactor * daysPerYearFactor) / workingDaysDivisor
    );

    // 6. Statutory Capping & Tax Split (Section 10(10))
    const statutoryCap = activePolicy.statutory_tax_free_cap || 2000000;
    let taxExemptAmount = 0;
    let taxableAmount = 0;
    let finalPayableAmount = 0;

    if (isVested) {
      finalPayableAmount = rawFormulaOutput;
      taxExemptAmount = Math.min(finalPayableAmount, statutoryCap);
      taxableAmount = Math.max(0, finalPayableAmount - statutoryCap);
    }

    // 7. Nominee Allocations
    const nomineeAllocations = (nominees || []).map((n) => {
      const sharePct = Number(n.share_percentage || 100);
      const allocatedAmount = Math.round((finalPayableAmount * sharePct) / 100);
      return {
        nominee_name: n.nominee_name || n.name || 'Beneficiary',
        share_percentage: sharePct,
        amount: allocatedAmount,
      };
    });

    const receiptId = `RCP_GRAT_${employee_id}_${Date.now()}`;
    const timestamp = new Date().toISOString();

    // 8. Traceable Execution Receipt capturing intermediate variables & policy metadata
    const executionReceipt = {
      receipt_id: receiptId,
      employee_id,
      policy_version_id: policyVersionId,
      policy_config_id: activePolicy.config_id || 'PGA_1972_CONFIG',
      date_of_joining: dojIso,
      date_of_exit: doeIso,
      exit_reason: reason,
      last_drawn_basic: basic,
      last_drawn_da: da,
      salary_basis: salaryBasis,
      continuous_service_days: continuousServiceDays,
      completed_service_factor: completedServiceFactor,
      tenure_years_raw: tenureYearsRaw,
      service_rounding_rule_applied: activePolicy.service_rounding_rule,
      days_per_year_factor: daysPerYearFactor,
      working_days_divisor: workingDaysDivisor,
      raw_formula_output: rawFormulaOutput,
      statutory_tax_free_cap: statutoryCap,
      is_vested: isVested,
      vesting_bypass_applied: bypassApplied,
      vesting_bypass_reason: bypassReason,
      tax_exempt_amount: taxExemptAmount,
      taxable_amount: taxableAmount,
      final_payable_amount: finalPayableAmount,
      nominee_allocations: nomineeAllocations,
      execution_timestamp: timestamp,
    };

    return {
      success: true,
      employee_id,
      final_payable_amount: finalPayableAmount,
      is_vested: isVested,
      execution_receipt: executionReceipt,
    };
  }
}

/* ============================================================================
 * 3. CRITERION 10: NPS VALIDATION & NSDL CRA EXPORT ENGINE
 * ============================================================================
 */

export class NpsValidationAndExportEngine {
  constructor(options = {}) {
    this.policies = options.policies || DEFAULT_NPS_POLICIES;
  }

  /**
   * Pre-Export Validation:
   * Validates 12-digit PRAN format, active tier selection, and Sec 80CCD contribution boundaries.
   *
   * @param {Array<object>} records
   * @param {string} period
   * @returns {object} Validation breakdown with record details
   */
  validateCandidateRecords(records = [], period = '2026-09') {
    const normDate = normalizeNPSDateToIso(period);
    const activeTier1Policy = resolveActiveNPSPolicy('TIER_1', normDate, this.policies);

    const validationDetails = [];
    const validationIssues = [];
    let allChecksPassed = true;

    for (const rec of records) {
      const empId = String(rec.employee_id || rec.id || '').trim();
      const pran = String(rec.pran || rec.nps_pran || '').trim();
      const tierType = String(rec.tier_type || rec.tier || 'TIER_1').toUpperCase().trim();
      const contribType = String(rec.contribution_type || 'BOTH').toUpperCase().trim();

      const basic = Number(rec.basic_salary ?? rec.basic ?? 0);
      const da = Number(rec.dearness_allowance ?? rec.da ?? 0);
      const salaryBasis = basic + da;

      const employeeShare = Number(rec.employee_share ?? rec.employee_contribution ?? 0);
      const employerShare = Number(rec.employer_share ?? rec.employer_contribution ?? 0);
      const voluntaryExcess = Number(rec.voluntary_excess ?? 0);

      const errors = [];

      // 1. 12-digit PRAN Format Validation
      const isPranValid = isValidPranFormat(pran);
      if (!isPranValid) {
        errors.push(`INVALID_PRAN_FORMAT: "${pran}" is not a valid 12-digit numeric PRAN.`);
      }

      // 2. Active Tier Selection Validation
      const isTierValid = tierType === 'TIER_1' || tierType === 'TIER_2';
      if (!isTierValid) {
        errors.push(`INVALID_TIER_SELECTION: "${tierType}" is unrecognized. Must be TIER_1 or TIER_2.`);
      }

      // 3. Section 80CCD Contribution Boundaries Validation
      let sec80ccd1Valid = true;
      let sec80ccd2Valid = true;
      let sec80ccd1bValid = true;

      // Only check percentage bounds if salary basis is positive
      if (salaryBasis > 0) {
        // Section 80CCD(1): Employee share max 10% of (Basic + DA)
        const maxEeShare = Math.round((salaryBasis * activeTier1Policy.employee_default_rate) / 100);
        if (employeeShare > maxEeShare) {
          sec80ccd1Valid = false;
          errors.push(`SEC_80CCD_1_BREACH: Employee share ₹${employeeShare} exceeds 10% ceiling ₹${maxEeShare}.`);
        }

        // Section 80CCD(2): Employer share max 10% (corporate) or 14% (Govt)
        const maxErShare = Math.round((salaryBasis * activeTier1Policy.employer_rate_percentage) / 100);
        if (employerShare > maxErShare) {
          sec80ccd2Valid = false;
          errors.push(`SEC_80CCD_2_BREACH: Employer share ₹${employerShare} exceeds ${activeTier1Policy.employer_rate_percentage}% statutory ceiling ₹${maxErShare}.`);
        }
      }

      // Section 80CCD(1B): Voluntary excess up to ₹50,000 annual deduction cap
      if (voluntaryExcess > (activeTier1Policy.annual_sec80ccd1b_cap || 50000)) {
        sec80ccd1bValid = false;
        errors.push(`SEC_80CCD_1B_BREACH: Voluntary excess ₹${voluntaryExcess} exceeds annual ₹50,000 cap.`);
      }

      // Overall record validity
      const isRecordValid = isPranValid && isTierValid && sec80ccd1Valid && sec80ccd2Valid && sec80ccd1bValid;
      if (!isRecordValid) {
        allChecksPassed = false;
        validationIssues.push({
          employee_id: empId,
          pran,
          errors,
        });
      }

      validationDetails.push({
        employee_id: empId,
        pran,
        pran_valid: isPranValid,
        tier_type: tierType,
        tier_valid: isTierValid,
        contribution_type: contribType,
        employee_share: employeeShare,
        employer_share: employerShare,
        salary_basis: salaryBasis,
        sec80ccd1_valid: sec80ccd1Valid,
        sec80ccd2_valid: sec80ccd2Valid,
        sec80ccd1b_valid: sec80ccd1bValid,
        is_valid: isRecordValid,
        validation_errors: errors,
      });
    }

    return {
      all_data_checks_passed: allChecksPassed,
      validation_details: validationDetails,
      validation_issues: validationIssues,
      clean_records: records.filter((_, idx) => validationDetails[idx].is_valid),
      rejected_records: records.filter((_, idx) => !validationDetails[idx].is_valid),
    };
  }

  /**
   * Compiles Standardized NSDL CRA Subscriber Contribution File (.txt SCF format)
   * strictly and only after clearing all data checks.
   *
   * @param {object} params
   * @returns {object} NpsValidationAndExportResult
   */
  validateAndCompileScf({
    source_run_id = 'RUN_NPS_DEFAULT',
    period = 'September 2026',
    month_year = null,
    records = [],
    corporate_registration_number = 'CHO12345',
    pao_or_pop_sp_code = 'POP00987',
    entity_name = 'KYLRX ENTERPRISE AI HRMS',
    admin_user = 'admin@kylrx.ai',
    options = {},
  }) {
    // Stage 1: Run comprehensive pre-export checks
    const valResult = this.validateCandidateRecords(records, period);

    // CRITERION 10 REQUIREMENT:
    // "Produce standardized NSDL CRA Subscriber Contribution Files (.txt SCF format) only after clearing all data checks."
    if (!valResult.all_data_checks_passed && !options.allow_partial_clean_export) {
      return {
        source_run_id,
        period,
        month_year: month_year || '092026',
        all_data_checks_passed: false,
        total_candidates: records.length,
        valid_subscribers_count: valResult.clean_records.length,
        rejected_count: valResult.rejected_records.length,
        validation_details: valResult.validation_details,
        validation_issues: valResult.validation_issues,
        scf_file: null, // Prohibited from compilation when data checks fail
        error: 'NSDL CRA SCF file compilation blocked: Pre-export validation checks failed on 1 or more records.',
        generated_at: new Date().toISOString(),
      };
    }

    // Records permitted for compilation
    const recordsToCompile = options.allow_partial_clean_export
      ? valResult.clean_records
      : records;

    // Stage 2: Standardized NSDL CRA SCF File Compilation
    const scfResult = generateNsdlCraScfFile({
      corporateRegistrationNumber: corporate_registration_number,
      paoOrPopSpCode: pao_or_pop_sp_code,
      entityName: entity_name,
      period,
      monthYear: month_year,
      sourceRunId: source_run_id,
      adminUser: admin_user,
      records: recordsToCompile,
      options,
    });

    return {
      source_run_id,
      period,
      month_year: scfResult.month_year || '092026',
      all_data_checks_passed: valResult.all_data_checks_passed,
      total_candidates: records.length,
      valid_subscribers_count: recordsToCompile.length,
      rejected_count: valResult.rejected_records.length,
      validation_details: valResult.validation_details,
      scf_file: {
        file_name: scfResult.file_name,
        file_content: scfResult.content,
        checksum_sha256: scfResult.checksum_sha256,
        record_counts: {
          total_lines: scfResult.summary.total_lines,
          total_subscribers: scfResult.summary.total_subscribers,
        },
        total_employee_contribution: scfResult.summary.total_employee_contribution,
        total_employer_contribution: scfResult.summary.total_employer_contribution,
        grand_total_contribution: scfResult.summary.total_nps_remittance,
      },
      generated_at: new Date().toISOString(),
    };
  }
}
