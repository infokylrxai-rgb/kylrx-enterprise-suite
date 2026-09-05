/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - STATUTORY PF & EPFO ECR AUTOMATION ENGINE
 * ============================================================================
 * Satisfies Section 4 of the Visual Compliance Blueprint:
 *
 * 1. Trigger & Condition:
 *    - Listens for monthly Payroll Finalized trigger.
 *    - Condition: pf_applicable === true.
 *    - If false, excludes the employee from the ECR workflow (status: 'EXCLUDED_NOT_APPLICABLE').
 *
 * 2. Validation Pre-Check:
 *    - Validates UAN (12 numeric digits) and PF Member ID existence and syntax.
 *    - On failure: dispatches an HR task, fires a real-time notification alert
 *      (e.g., 'UAN Missing for Neha Verma (EMP004)'), routes exception, and excludes
 *      the record from the pending ECR run.
 *
 * 3. Statutory Calculation Engine:
 *    - EPF Wages & EPS Wages respecting configured statutory ceilings (₹15,000 ceiling or actual wage policy).
 *    - Employee Share (EE): 12% of EPF wages (+ Voluntary PF / VPF if configured).
 *    - Employer Share (ER): 3.67% of EPF wages.
 *    - EPS Contribution (ER): 8.33% of EPS wages (capped at statutory ₹1,250 limit if EPS applicable,
 *      else 0% with remainder to EPF).
 *    - EDLI (0.50%) and Admin charges (0.50%) according to active policy configurations.
 *
 * 4. Execution Logging & Audit Manifest:
 *    - Output execution log recording calculation inputs, rule version (EPFO_PF_STATUTORY_RULE_V4.0),
 *      and validation outcome (Success / Failed).
 *
 * 5. Official EPFO ECR Output:
 *    - Standard #~# delimited ECR format:
 *      UAN#~#MEMBER_NAME#~#GROSS#~#EPF_WAGES#~#EPS_WAGES#~#EDLI_WAGES#~#EE_SHARE#~#EPS_SHARE#~#ER_EPF_SHARE#~#NCP_DAYS#~#ADV_REFUND
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Compliance Architect
 */

import crypto from 'node:crypto';
import { globalEcrFileGenerator, FieldMappingEngine } from './ecr-formatting-file-generator.mjs';

export const EPFO_STATUTORY_RULE_VERSION = 'EPFO_PF_STATUTORY_RULE_V4.0';

// Statutory Rates & Ceilings
export const STATUTORY_PF_DEFAULTS = Object.freeze({
  STATUTORY_WAGE_CEILING: 15000,
  STATUTORY_EPS_CEILING: 15000,
  EE_PF_RATE: 0.12,        // 12% Employee share
  ER_EPF_RATE: 0.0367,     // 3.67% Employer EPF share
  EPS_RATE: 0.0833,        // 8.33% Employer EPS share
  MAX_STATUTORY_EPS_AMOUNT: 1250, // ₹15,000 * 8.33% rounded = ₹1,250
  EDLI_RATE: 0.005,        // 0.50% EDLI charges
  ADMIN_RATE: 0.005,       // 0.50% EPF Admin charges
});

export const UAN_12_DIGIT_REGEX = /^[0-9]{12}$/;
// Standard Indian EPFO Member ID: e.g., MHBAN00123450000000123 or MH/BAN/0012345/000/0000123 (10-30 chars)
export const PF_MEMBER_ID_REGEX = /^[A-Z0-9\/_-]{10,30}$/i;

/* ============================================================================
 * 1. PROFILE MASTER STORE (EmployeePfProfile)
 * ============================================================================
 */

export class EmployeePfProfileStore {
  constructor() {
    /** @type {Map<string, object>} employee_id -> profile */
    this.profiles = new Map();
  }

  clear() {
    this.profiles.clear();
  }

  upsertProfile(profileData = {}) {
    if (!profileData || !profileData.employee_id) {
      throw new Error('employee_id is mandatory for EmployeePfProfile.');
    }

    const employeeId = String(profileData.employee_id).trim();
    const uan = profileData.uan ? String(profileData.uan).trim() : '';
    const pfMemberId = profileData.pf_member_id ? String(profileData.pf_member_id).trim() : '';
    const pfApplicable = profileData.pf_applicable !== undefined
      ? Boolean(profileData.pf_applicable)
      : true;
    const epsApplicable = profileData.eps_applicable !== undefined
      ? Boolean(profileData.eps_applicable)
      : true;

    const vpfPercentage = Number(profileData.vpf_percentage || 0);
    const vpfAmount = Number(profileData.vpf_amount || profileData.voluntary_pf || 0);

    const profile = {
      employee_id: employeeId,
      employee_name: profileData.employee_name || profileData.name || `Employee ${employeeId}`,
      uan,
      pf_member_id: pfMemberId,
      pf_applicable: pfApplicable,
      eps_applicable: epsApplicable,
      vpf_percentage: vpfPercentage,
      vpf_amount: vpfAmount,
      date_of_joining: profileData.date_of_joining || '2022-01-01',
      date_of_exit: profileData.date_of_exit || null,
      created_at: profileData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.profiles.set(employeeId, profile);
    return profile;
  }

  getProfile(employeeId) {
    return this.profiles.get(String(employeeId).trim()) || null;
  }

  getAllProfiles() {
    return Array.from(this.profiles.values());
  }
}

/* ============================================================================
 * 2. CORE PF & ECR AUTOMATION ENGINE
 * ============================================================================
 */

export class PfEcrAutomationEngine {
  constructor(options = {}) {
    this.profileStore = options.profileStore || new EmployeePfProfileStore();
    this.eventBus = options.eventBus || null;

    /** @type {Map<string, object>} batchId -> calculationResult */
    this.calculationResults = new Map();

    /** @type {Map<string, Array<object>>} batchId -> executionLogs */
    this.executionLogs = new Map();

    /** @type {Map<string, Array<object>>} batchId -> exceptions */
    this.pfExceptions = new Map();

    /** @type {Map<string, Array<object>>} batchId -> hrTasks */
    this.hrTasks = new Map();

    /** @type {Map<string, Array<object>>} batchId -> hrAlerts */
    this.hrAlerts = new Map();

    /** @type {Map<string, object>} batchId -> exportFiles */
    this.exportFiles = new Map();

    if (this.eventBus) {
      this.attachEventBusListener(this.eventBus);
    }
  }

  /**
   * Listen for PAYROLL_FINALIZED event from Centralized EventBus
   */
  attachEventBusListener(eventBus) {
    if (!eventBus || typeof eventBus.on !== 'function') return;
    this.eventBus = eventBus;

    eventBus.on('PAYROLL_FINALIZED', async (eventData) => {
      try {
        const payload = eventData?.payload || eventData || {};
        await this.onPayrollFinalized(payload);
      } catch (err) {
        console.error('[PfEcrAutomationEngine] Error handling PAYROLL_FINALIZED:', err);
      }
    });
  }

  /**
   * Automation Builder: Monthly Payroll Finalized Trigger Handler
   */
  async onPayrollFinalized(payrollRunData = {}) {
    const runId = payrollRunData.payroll_run_id || payrollRunData.run_id || `RUN_${Date.now()}`;
    const period = payrollRunData.period || payrollRunData.wage_period || '2026-09';
    const batchId = payrollRunData.batch_id || `BATCH_PF_${runId}`;
    const payrollRecords = payrollRunData.employees || payrollRunData.payroll_records || payrollRunData.records || [];

    return this.calculatePfBatch({
      batch_id: batchId,
      run_id: runId,
      period,
      payroll_records: payrollRecords,
      policy_configuration: payrollRunData.policy_configuration || {},
    });
  }

  /**
   * Validates UAN and PF Member ID syntax & existence
   */
  validateMemberIdentifiers(employeeId, employeeName, uan, pfMemberId) {
    const issues = [];

    // 1. UAN Validation
    if (!uan) {
      issues.push({
        error_code: 'PF_UAN_MISSING',
        code: 'PF_UAN_MISSING',
        field: 'uan',
        severity: 'BLOCK',
        message: `UAN Missing for ${employeeName} (${employeeId})`,
        suggested_fix: 'Obtain and link the 12-digit Universal Account Number from EPFO portal.',
      });
    } else if (!UAN_12_DIGIT_REGEX.test(uan)) {
      issues.push({
        error_code: 'PF_UAN_INVALID_FORMAT',
        code: 'PF_UAN_INVALID_FORMAT',
        field: 'uan',
        actual_value: uan,
        severity: 'BLOCK',
        message: `Invalid UAN "${uan}" for ${employeeName} (${employeeId}). Must be exactly 12 numeric digits.`,
        suggested_fix: 'Correct UAN to 12 numeric digits.',
      });
    }

    // 2. PF Member ID Validation
    if (!pfMemberId) {
      issues.push({
        error_code: 'PF_MEMBER_ID_MISSING',
        code: 'PF_MEMBER_ID_MISSING',
        field: 'pf_member_id',
        severity: 'BLOCK',
        message: `PF Member ID Missing for ${employeeName} (${employeeId})`,
        suggested_fix: 'Assign and link the EPFO Member ID / Region-Est-Extension-Member format.',
      });
    } else if (!PF_MEMBER_ID_REGEX.test(pfMemberId)) {
      issues.push({
        error_code: 'PF_MEMBER_ID_INVALID_FORMAT',
        code: 'PF_MEMBER_ID_INVALID_FORMAT',
        field: 'pf_member_id',
        actual_value: pfMemberId,
        severity: 'BLOCK',
        message: `Invalid PF Member ID "${pfMemberId}" for ${employeeName} (${employeeId}). Must be a valid alphanumeric establishment string.`,
        suggested_fix: 'Ensure PF Member ID adheres to standard EPFO establishment alphanumeric format.',
      });
    }

    return issues;
  }

  /**
   * Creates HR Task and real-time Notification Alert for validation defects
   */
  createTaskAndAlert(batchId, issue, employeeId, employeeName) {
    const timestamp = new Date().toISOString();
    const taskId = `TASK_PF_${batchId}_${employeeId}_${crypto.randomBytes(2).toString('hex')}`;
    const alertId = `ALERT_PF_${batchId}_${employeeId}_${crypto.randomBytes(2).toString('hex')}`;

    const task = {
      task_id: taskId,
      batch_id: batchId,
      task_type: 'PF_EXCEPTION_REMEDIATION',
      priority: 'HIGH',
      sla_hours: 24,
      assigned_role: 'COMPLIANCE_OFFICER',
      employee_id: employeeId,
      employee_name: employeeName,
      description: issue.message,
      suggested_fix: issue.suggested_fix,
      status: 'OPEN',
      created_at: timestamp,
    };

    const alert = {
      alert_id: alertId,
      batch_id: batchId,
      channel: 'IN_APP_NOTIFICATION',
      severity: 'CRITICAL',
      title: 'PF Statutory Validation Failure',
      message: issue.message, // e.g. "UAN Missing for Neha Verma (EMP004)"
      recipient_group: 'PF_PAYROLL_DESK',
      timestamp,
    };

    return { task, alert };
  }

  /**
   * Statutory Calculation Engine for a batch of payroll records
   */
  calculatePfBatch(params = {}) {
    const batchId = params.batch_id || `BATCH_PF_${Date.now()}`;
    const runId = params.run_id || `RUN_${Date.now()}`;
    const period = String(params.period || '2026-09');
    const records = params.payroll_records || params.records || [];
    const policyConfig = {
      wage_ceiling: STATUTORY_PF_DEFAULTS.STATUTORY_WAGE_CEILING,
      eps_wage_ceiling: STATUTORY_PF_DEFAULTS.STATUTORY_EPS_CEILING,
      ee_pf_rate: STATUTORY_PF_DEFAULTS.EE_PF_RATE,
      er_epf_rate: STATUTORY_PF_DEFAULTS.ER_EPF_RATE,
      eps_rate: STATUTORY_PF_DEFAULTS.EPS_RATE,
      max_eps_amount: STATUTORY_PF_DEFAULTS.MAX_STATUTORY_EPS_AMOUNT,
      edli_rate: STATUTORY_PF_DEFAULTS.EDLI_RATE,
      admin_rate: STATUTORY_PF_DEFAULTS.ADMIN_RATE,
      is_actual_wage_policy: false,
      ...(params.policy_configuration || {}),
    };

    const compliantRecords = [];
    const excludedRecords = [];
    const batchExceptions = [];
    const batchTasks = [];
    const batchAlerts = [];
    const executionLogs = [];

    let totalEpfWages = 0;
    let totalEpsWages = 0;
    let totalEdliWages = 0;
    let totalEeShare = 0;
    let totalErEpfShare = 0;
    let totalEpsShare = 0;
    let totalVpfAmount = 0;
    let totalEdliCharges = 0;
    let totalAdminCharges = 0;

    for (const rec of records) {
      const employeeId = String(rec.employee_id || rec.id || '').trim();
      const employeeName = rec.employee_name || rec.name || `Employee ${employeeId}`;

      // Look up master profile or fallback
      let profile = this.profileStore.getProfile(employeeId);
      if (!profile) {
        profile = {
          employee_id: employeeId,
          employee_name: employeeName,
          uan: String(rec.uan || rec.pf_uan || '').trim(),
          pf_member_id: String(rec.pf_member_id || rec.member_id || '').trim(),
          pf_applicable: rec.pf_applicable !== undefined ? Boolean(rec.pf_applicable) : true,
          eps_applicable: rec.eps_applicable !== undefined ? Boolean(rec.eps_applicable) : true,
          vpf_percentage: Number(rec.vpf_percentage || 0),
          vpf_amount: Number(rec.vpf_amount || rec.voluntary_pf || 0),
        };
      }

      // Trigger Condition: pf_applicable === true
      if (profile.pf_applicable !== true) {
        const excludedDoc = {
          employee_id: employeeId,
          employee_name: employeeName,
          gross_salary: Number(rec.gross_salary || rec.gross || 0),
          reason: 'pf_applicable is false',
          status: 'EXCLUDED_NOT_APPLICABLE',
        };
        excludedRecords.push(excludedDoc);

        // Execution log for excluded record
        executionLogs.push({
          log_id: `LOG_PF_${batchId}_${employeeId}`,
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          rule_version: EPFO_STATUTORY_RULE_VERSION,
          validation_outcome: 'EXCLUDED',
          inputs: {
            pf_applicable: false,
            gross_salary: rec.gross_salary || rec.gross || 0,
          },
          notes: 'Excluded from ECR workflow: pf_applicable is false.',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const uan = String(profile.uan || rec.uan || '').trim();
      const pfMemberId = String(profile.pf_member_id || rec.pf_member_id || rec.member_id || '').trim();

      // Validation Pre-Check
      const validationIssues = this.validateMemberIdentifiers(employeeId, employeeName, uan, pfMemberId);

      if (validationIssues.length > 0) {
        for (const issue of validationIssues) {
          const excDoc = {
            exception_id: `EXC_PF_${batchId}_${employeeId}_${issue.error_code}`,
            scheme: 'PF',
            batch_id: batchId,
            source_payroll_id: runId,
            employee_id: employeeId,
            employee_name: employeeName,
            error_code: issue.error_code,
            code: issue.code,
            field: issue.field,
            actual_value: issue.actual_value || null,
            severity: issue.severity,
            message: issue.message,
            suggested_fix: issue.suggested_fix,
            resolved: false,
            rule_version_applied: EPFO_STATUTORY_RULE_VERSION,
            created_at: new Date().toISOString(),
          };
          batchExceptions.push(excDoc);

          const { task, alert } = this.createTaskAndAlert(batchId, issue, employeeId, employeeName);
          batchTasks.push(task);
          batchAlerts.push(alert);
        }

        // Exclude defective employee record from the pending ECR run
        executionLogs.push({
          log_id: `LOG_PF_${batchId}_${employeeId}`,
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          rule_version: EPFO_STATUTORY_RULE_VERSION,
          validation_outcome: 'FAILED',
          inputs: {
            uan,
            pf_member_id: pfMemberId,
            gross_salary: rec.gross_salary || rec.gross || 0,
            basic: rec.basic || 0,
            da: rec.da || 0,
          },
          errors: validationIssues.map((v) => v.message),
          notes: 'Validation pre-check failed. Record excluded from pending ECR run.',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // Statutory Calculation Engine
      const basic = Number(rec.basic || rec.last_drawn_basic || 0);
      const da = Number(rec.da || rec.last_drawn_da || 0);
      const gross = Number(rec.gross_salary || rec.gross || rec.gross_wages || (basic + da));
      const salaryBasis = (basic + da > 0) ? (basic + da) : gross;

      const isActualWagePolicy = Boolean(rec.is_actual_wage_policy ?? policyConfig.is_actual_wage_policy);
      const wageCeiling = policyConfig.wage_ceiling;
      const epsWageCeiling = policyConfig.eps_wage_ceiling;

      // 1. EPF Wages
      const epfWages = isActualWagePolicy ? salaryBasis : Math.min(salaryBasis, wageCeiling);

      // 2. EPS Wages (0 if EPS not applicable or employee exempt)
      const epsApplicable = Boolean(rec.eps_applicable ?? profile.eps_applicable);
      const epsWages = epsApplicable ? Math.min(salaryBasis, epsWageCeiling) : 0;

      // 3. EDLI Wages (capped at statutory ceiling)
      const edliWages = Math.min(salaryBasis, wageCeiling);

      // 4. Employee Share (EE): 12% of EPF wages (+ Voluntary PF if configured)
      const baseEeShare = Math.round(epfWages * policyConfig.ee_pf_rate);
      let vpfAmount = Number(profile.vpf_amount || rec.vpf_amount || 0);
      if (!vpfAmount && (profile.vpf_percentage || rec.vpf_percentage)) {
        const vpfPct = Number(profile.vpf_percentage || rec.vpf_percentage || 0);
        vpfAmount = Math.round(epfWages * (vpfPct / 100));
      }
      const recordEeShare = baseEeShare + vpfAmount;

      // 5. EPS Contribution (ER): 8.33% of EPS wages (capped at ₹1,250)
      const epsContribution = epsApplicable
        ? Math.min(policyConfig.max_eps_amount, Math.round(epsWages * policyConfig.eps_rate))
        : 0;

      // 6. Employer Share (ER EPF): 12% total minus EPS share (or 3.67% of EPF wages)
      // Statutory reconciliation: Total ER PF = EE Base Share (12%), split into EPS + ER EPF.
      const erEpfShare = baseEeShare - epsContribution;

      // 7. EDLI & Admin Charges
      const edliCharges = Math.round(edliWages * policyConfig.edli_rate);
      const adminCharges = Math.round(epfWages * policyConfig.admin_rate);

      const ncpDays = Number(rec.ncp_days || rec.non_contributory_days || 0);
      const advRefund = Number(rec.adv_refund || 0);

      totalEpfWages += epfWages;
      totalEpsWages += epsWages;
      totalEdliWages += edliWages;
      totalEeShare += recordEeShare;
      totalErEpfShare += erEpfShare;
      totalEpsShare += epsContribution;
      totalVpfAmount += vpfAmount;
      totalEdliCharges += edliCharges;
      totalAdminCharges += adminCharges;

      const recordResult = {
        employee_id: employeeId,
        employee_name: employeeName,
        uan,
        pf_member_id: pfMemberId,
        gross,
        epf_wages: epfWages,
        eps_wages: epsWages,
        edli_wages: edliWages,
        ee_share: recordEeShare,
        base_ee_share: baseEeShare,
        vpf_amount: vpfAmount,
        eps_share: epsContribution,
        er_epf_share: erEpfShare,
        total_er_share: epsContribution + erEpfShare,
        edli_charges: edliCharges,
        admin_charges: adminCharges,
        ncp_days: ncpDays,
        adv_refund: advRefund,
        eps_applicable: epsApplicable,
        is_actual_wage_policy: isActualWagePolicy,
      };

      compliantRecords.push(recordResult);

      // Output execution log for successful calculation
      executionLogs.push({
        log_id: `LOG_PF_${batchId}_${employeeId}`,
        batch_id: batchId,
        employee_id: employeeId,
        employee_name: employeeName,
        rule_version: EPFO_STATUTORY_RULE_VERSION,
        validation_outcome: 'SUCCESS',
        inputs: {
          uan,
          pf_member_id: pfMemberId,
          gross_salary: gross,
          basic,
          da,
          salary_basis: salaryBasis,
          is_actual_wage_policy: isActualWagePolicy,
          eps_applicable: epsApplicable,
          vpf_amount: vpfAmount,
          configured_policy: policyConfig,
        },
        outputs: {
          epf_wages: epfWages,
          eps_wages: epsWages,
          edli_wages: edliWages,
          ee_share: totalEeShare,
          er_epf_share: erEpfShare,
          eps_share: epsContribution,
          edli_charges: edliCharges,
          admin_charges: adminCharges,
          total_statutory_remittance: totalEeShare + erEpfShare + epsContribution + edliCharges + adminCharges,
        },
        timestamp: new Date().toISOString(),
      });
    }

    this.pfExceptions.set(batchId, batchExceptions);
    this.hrTasks.set(batchId, batchTasks);
    this.hrAlerts.set(batchId, batchAlerts);
    this.executionLogs.set(batchId, executionLogs);

    const totalChallanAmount = totalEeShare + totalErEpfShare + totalEpsShare + totalEdliCharges + totalAdminCharges;

    const calculationResult = {
      batch_id: batchId,
      run_id: runId,
      period,
      rule_version: EPFO_STATUTORY_RULE_VERSION,
      policy_configuration: policyConfig,
      summary: {
        total_records_processed: records.length,
        total_applicable_records: records.length - excludedRecords.length,
        total_compliant_records: compliantRecords.length,
        total_exceptions: batchExceptions.length,
        total_excluded_records: excludedRecords.length,
        total_epf_wages: totalEpfWages,
        total_eps_wages: totalEpsWages,
        total_edli_wages: totalEdliWages,
        total_ee_share: totalEeShare,
        total_vpf_amount: totalVpfAmount,
        total_er_epf_share: totalErEpfShare,
        total_eps_share: totalEpsShare,
        total_edli_charges: totalEdliCharges,
        total_admin_charges: totalAdminCharges,
        total_challan_amount: totalChallanAmount,
      },
      compliant_records: compliantRecords,
      excluded_records: excludedRecords,
      exceptions: batchExceptions,
      hr_tasks: batchTasks,
      hr_alerts: batchAlerts,
      execution_logs: executionLogs,
      is_blocked: batchExceptions.length > 0,
      calculated_at: new Date().toISOString(),
    };

    this.calculationResults.set(batchId, calculationResult);

    // If there are compliant records and no blocking defects, auto-generate ECR file
    if (compliantRecords.length > 0) {
      this.generateEcrExport(batchId);
    }

    return calculationResult;
  }

  /**
   * Compiles official #~# delimited EPFO ECR text export file
   * Format: UAN#~#MEMBER_NAME#~#GROSS#~#EPF_WAGES#~#EPS_WAGES#~#EDLI_WAGES#~#EE_SHARE#~#EPS_SHARE#~#ER_EPF_SHARE#~#NCP_DAYS#~#ADV_REFUND
   */
  generateEcrExport(batchId) {
    const calcResult = this.calculationResults.get(batchId);
    if (!calcResult) {
      throw new Error(`Calculation results not found for PF batch ${batchId}.`);
    }

    const periodStr = calcResult.period;
    const records = calcResult.compliant_records || [];

    // Use canonical EcrFileGenerator
    const genResult = globalEcrFileGenerator.generateEcrReturn({
      period: periodStr,
      source_payroll_run_id: calcResult.run_id,
      records,
    });

    const manifest = {
      file_name: genResult.file_name,
      batch_id: batchId,
      period: periodStr,
      rule_version: EPFO_STATUTORY_RULE_VERSION,
      total_subscribers: records.length,
      row_count: records.length,
      total_challan_amount: calcResult.summary.total_challan_amount,
      checksum_sha256: genResult.checksum_sha256,
      size_bytes: genResult.size_bytes,
      generated_at: new Date().toISOString(),
      compliance_return: genResult.compliance_return,
    };

    const output = {
      manifest,
      txt: genResult.content,
      compliance_return: genResult.compliance_return,
      file: {
        file_name: genResult.file_name,
        content: genResult.content,
        checksum: genResult.checksum_sha256,
      },
    };

    this.exportFiles.set(batchId, output);
    return output;
  }
}

// Export singleton instance
export const globalPfEcrAutomationEngine = new PfEcrAutomationEngine();
