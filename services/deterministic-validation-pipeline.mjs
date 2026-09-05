/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - DETERMINISTIC VALIDATION PIPELINE SERVICE
 * ============================================================================
 * Standardized Canonical Error Catalog and 9-Step Sequential Validation Pipeline:
 *
 * Single Shared Vocabulary:
 *  - EMP021 (Severity: BLOCK): Invalid IFSC / bank routing value (Regex: /^[A-Z]{4}0[A-Z0-9]{6}$/).
 *  - EMP037 (Severity: BLOCK): Invalid or missing account number (length < 9 or non-numeric).
 *  - EMP052 (Severity: BLOCK): Negative or invalid payment amount (<= 0 or NaN).
 *  - DUP001 (Severity: BLOCK): Duplicate payment instruction for the same payroll run.
 *  - VAL001 (Severity: BLOCK): Employee not eligible for scheme based on statutory policy, wage ceiling, or effective dates.
 *  - WARN001 (Severity: WARN): Non-blocking profile warning requiring policy acknowledgment.
 *  - LEDGER_MISMATCH (Severity: BLOCK): Calculated batch sum does not match frozen payroll source ledger.
 *
 * 9-Step Validation Pipeline:
 *  Step 1: Load immutable payroll result from the finalized payroll run.
 *  Step 2: Join employee banking and statutory compliance master profiles.
 *  Step 3: Apply structural validations (account number digits, IFSC regex).
 *  Step 4: Apply policy and eligibility validations (effective_from/effective_to checks, statutory scheme rules, wage ceiling).
 *  Step 5: Apply cross-row validations (duplicate instruction checks).
 *  Step 6: Calculate batch aggregate totals.
 *  Step 7: Compare calculated batch totals against the frozen payroll source record.
 *  Step 8: Persist detected issues into the ValidationIssue collection/table.
 *  Step 9: Transition batch state to VALIDATED if and only if zero blocking issues exist.
 *
 * @version 2.0.0
 * @author Kylrx AI Principal Backend Engineering Team
 */

import crypto from 'node:crypto';

export const ErrorSeverity = Object.freeze({
  BLOCK: 'BLOCK',
  WARN: 'WARN',
  INFO: 'INFO',
});

export const ErrorCatalog = Object.freeze({
  EMP021: {
    code: 'EMP021',
    severity: ErrorSeverity.BLOCK,
    category: 'STRUCTURAL',
    title: 'Invalid IFSC / Bank Routing Value',
    description: 'Bank routing code does not match RBI standard canonical format (/^[A-Z]{4}0[A-Z0-9]{6}$/).',
    resolutionStrategy: 'Update employee bank master record with a valid 11-character alphanumeric IFSC code.',
  },
  EMP037: {
    code: 'EMP037',
    severity: ErrorSeverity.BLOCK,
    category: 'STRUCTURAL',
    title: 'Invalid or Missing Bank Account Number',
    description: 'Bank account number is missing, non-numeric, or length is less than 9 digits (or exceeds 18 digits).',
    resolutionStrategy: 'Provide a valid 9 to 18 digit numeric bank account number in employee profile.',
  },
  EMP052: {
    code: 'EMP052',
    severity: ErrorSeverity.BLOCK,
    category: 'POLICY',
    title: 'Negative or Invalid Payment Amount',
    description: 'Net payable amount is zero, negative, or NaN.',
    resolutionStrategy: 'Adjust earnings or deductions in payroll calculation to guarantee positive net payout.',
  },
  DUP001: {
    code: 'DUP001',
    severity: ErrorSeverity.BLOCK,
    category: 'CROSS_ROW',
    title: 'Duplicate Payment Instruction',
    description: 'Duplicate employee ID, bank account, or payment reference detected in active disbursement batch.',
    resolutionStrategy: 'Remove or consolidate duplicate records to prevent double disbursement.',
  },
  VAL001: {
    code: 'VAL001',
    severity: ErrorSeverity.BLOCK,
    category: 'ELIGIBILITY',
    title: 'Statutory Policy, Wage Ceiling, or Effective Date Violation',
    description: 'Employee not eligible for scheme based on statutory policy, wage ceiling, missing mandatory identifier, or outside effective date range.',
    resolutionStrategy: 'Update effective date window, link mandatory statutory identifier (UAN/IP/PRAN), or adjust scheme eligibility.',
  },
  WARN001: {
    code: 'WARN001',
    severity: ErrorSeverity.WARN,
    category: 'PROFILE',
    title: 'Non-Blocking Profile Warning',
    description: 'Employee profile is missing non-critical attributes requiring policy acknowledgment (e.g., email address, emergency contact).',
    resolutionStrategy: 'Acknowledge warning or update optional employee communication attributes.',
  },
  LEDGER_MISMATCH: {
    code: 'LEDGER_MISMATCH',
    severity: ErrorSeverity.BLOCK,
    category: 'RECONCILIATION',
    title: 'Frozen Source Ledger Disparity',
    description: 'Calculated batch sum does not match authoritative immutable payroll ledger.',
    resolutionStrategy: 'Re-sync batch records with authoritative immutable payroll run calculation.',
  },
});

export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * In-Memory & Database-Ready ValidationIssue Repository
 */
export class ValidationIssueRepository {
  constructor() {
    this.issuesStore = new Map(); // batch_id -> Array of issues
  }

  async persistIssues(batchId, issues = []) {
    const cloned = JSON.parse(JSON.stringify(issues));
    this.issuesStore.set(batchId, cloned);
    return JSON.parse(JSON.stringify(cloned));
  }

  async getIssuesByBatch(batchId) {
    const list = this.issuesStore.get(batchId) || [];
    return JSON.parse(JSON.stringify(list));
  }

  async getUnresolvedBlockingIssues(batchId) {
    const list = this.issuesStore.get(batchId) || [];
    return list.filter((i) => (i.resolved !== true && !i.resolved_at) && i.severity === ErrorSeverity.BLOCK);
  }
}

/**
 * Deterministic Validation Pipeline Service (9-Step Sequential Execution Engine)
 */
export class DeterministicValidationPipeline {
  constructor(options = {}) {
    this.tolerance = options.tolerance || 0.01;
    this.issueRepo = options.issueRepository || new ValidationIssueRepository();
  }

  /**
   * Main 9-Step Sequential Validation Pipeline
   */
  async execute({
    batch,
    payrollSourceLedger,
    employeeMasterList = [],
    bankingProfiles = [],
    statutoryProfiles = [],
    operatorId = 'SYSTEM_VALIDATION_ENGINE',
    asOfDate = new Date().toISOString(),
  }) {
    if (!batch || !batch.batch_id) {
      throw new Error('Valid PaymentBatch entity is required.');
    }

    const batchId = batch.batch_id;
    const issues = [];
    const executionTrace = [];

    // ========================================================================
    // STEP 1: Load immutable payroll result from the finalized payroll run
    // ========================================================================
    executionTrace.push({
      step: 1,
      name: 'LOAD_IMMUTABLE_PAYROLL_RESULT',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    if (!payrollSourceLedger) {
      issues.push(this._createIssue({
        batch_id: batchId,
        employee_id: 'SYSTEM',
        employee_name: 'Payroll Source Ledger Engine',
        errorDef: ErrorCatalog.LEDGER_MISMATCH,
        customMessage: 'Failed to load authoritative immutable payroll source ledger from finalized payroll run.',
      }));
    }

    // ========================================================================
    // STEP 2: Join employee banking and statutory compliance master profiles
    // ========================================================================
    executionTrace.push({
      step: 2,
      name: 'JOIN_MASTER_PROFILES',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    const bankingMap = new Map();
    bankingProfiles.forEach((b) => bankingMap.set(String(b.employee_id || b.id).trim(), b));

    const statutoryMap = new Map();
    statutoryProfiles.forEach((s) => statutoryMap.set(String(s.employee_id || s.id).trim(), s));

    const sourceRecords = (batch.records && batch.records.length > 0) ? batch.records : employeeMasterList;
    const joinedRecords = sourceRecords.map((rec) => {
      const empId = String(rec.employee_id || rec.id || '').trim();
      const bank = bankingMap.get(empId) || rec.banking || {};
      const stat = statutoryMap.get(empId) || rec.statutory || {};

      return {
        ...rec,
        employee_id: empId,
        employee_name: rec.employee_name || rec.name || 'Employee',
        account_number: bank.account_number || rec.account_number || rec.accountNumber || '',
        ifsc_code: (bank.ifsc_code || rec.ifsc_code || rec.ifsc || '').trim().toUpperCase(),
        net_payable_amount: Number(rec.net_payable_amount ?? rec.net ?? rec.netSalary ?? rec.salary ?? (Number(rec.gross || 0) - Number(rec.deductions || 0))),
        gross_salary: Number(rec.gross_salary ?? rec.grossSalary ?? rec.gross ?? rec.salary ?? 0),
        deductions: Number(rec.deductions ?? rec.employeeDeductions ?? 0),
        employer_contributions: Number(rec.employer_contributions ?? rec.employerContributions ?? 0),
        email: rec.email || bank.email || '',
        uan: stat.uan || rec.uan || '',
        esic_ip: stat.esic_ip || stat.ip_number || rec.esic_ip || '',
        pran: stat.pran || rec.pran || '',
        is_pf_covered: stat.is_pf_covered ?? rec.is_pf_covered ?? (rec.gross_salary <= 15000),
        is_esic_covered: stat.is_esic_covered ?? rec.is_esic_covered ?? (rec.gross_salary <= 21000),
        is_nps_opted: stat.is_nps_opted ?? rec.is_nps_opted ?? false,
        effective_from: stat.effective_from || rec.effective_from || null,
        effective_to: stat.effective_to || rec.effective_to || null,
      };
    });

    // ========================================================================
    // STEP 3: Apply structural validations (account number digits, IFSC regex)
    // ========================================================================
    executionTrace.push({
      step: 3,
      name: 'APPLY_STRUCTURAL_VALIDATIONS',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    for (const rec of joinedRecords) {
      // EMP021: IFSC Code Regex Format
      if (!IFSC_REGEX.test(rec.ifsc_code)) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          errorDef: ErrorCatalog.EMP021,
          field: 'ifsc_code',
          actual_value: rec.ifsc_code,
          customMessage: `Invalid IFSC '${rec.ifsc_code || '(empty)'}'. Must match canonical format /^[A-Z]{4}0[A-Z0-9]{6}$/.`,
        }));
      }

      // EMP037: Bank Account Number Bounds & Format (Numeric, >= 9 and <= 18 digits)
      const cleanAcc = String(rec.account_number).trim();
      const isDigitsOnly = /^\d+$/.test(cleanAcc);
      if (!cleanAcc || cleanAcc.length < 9 || cleanAcc.length > 18 || !isDigitsOnly) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          errorDef: ErrorCatalog.EMP037,
          field: 'account_number',
          actual_value: cleanAcc ? `len:${cleanAcc.length}` : '(empty)',
          customMessage: `Account number '${cleanAcc || '(empty)'}' is invalid. Must be numeric and between 9 to 18 digits.`,
        }));
      }
    }

    // ========================================================================
    // STEP 4: Apply policy and eligibility validations (effective dates, wage ceiling)
    // ========================================================================
    executionTrace.push({
      step: 4,
      name: 'APPLY_POLICY_AND_ELIGIBILITY',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    const evalDate = new Date(asOfDate);

    for (const rec of joinedRecords) {
      // EMP052: Positive Net Pay Gate (<= 0 or NaN)
      if (isNaN(rec.net_payable_amount) || rec.net_payable_amount <= 0) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          errorDef: ErrorCatalog.EMP052,
          field: 'net_payable_amount',
          actual_value: rec.net_payable_amount,
          customMessage: `Net payable amount ₹${rec.net_payable_amount} is zero, negative, or invalid.`,
        }));
      }

      // VAL001: Effective Date Window Checks (effective_from / effective_to)
      if (rec.effective_from) {
        const fromDate = new Date(rec.effective_from);
        if (evalDate < fromDate) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: rec.employee_id,
            employee_name: rec.employee_name,
            errorDef: ErrorCatalog.VAL001,
            field: 'effective_from',
            actual_value: rec.effective_from,
            customMessage: `Employee effective date '${rec.effective_from}' is in the future relative to cycle date '${asOfDate}'.`,
          }));
        }
      }

      if (rec.effective_to) {
        const toDate = new Date(rec.effective_to);
        if (evalDate > toDate) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: rec.employee_id,
            employee_name: rec.employee_name,
            errorDef: ErrorCatalog.VAL001,
            field: 'effective_to',
            actual_value: rec.effective_to,
            customMessage: `Employee statutory profile expired on '${rec.effective_to}'.`,
          }));
        }
      }

      // VAL001: Statutory Scheme Policy & Mandatory Identifiers Gate
      if (rec.is_pf_covered && (!rec.uan || !/^\d{12}$/.test(String(rec.uan).trim()))) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          errorDef: ErrorCatalog.VAL001,
          field: 'uan',
          actual_value: rec.uan || '(missing)',
          customMessage: `Employee is covered under EPF but lacks a valid 12-digit UAN.`,
        }));
      }

      if (rec.is_esic_covered && (!rec.esic_ip || !/^\d{10,17}$/.test(String(rec.esic_ip).trim()))) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          errorDef: ErrorCatalog.VAL001,
          field: 'esic_ip',
          actual_value: rec.esic_ip || '(missing)',
          customMessage: `Employee is covered under ESIC (Gross <= ₹21,000) but lacks a valid ESIC IP Number.`,
        }));
      }

      // WARN001: Non-Blocking Profile Warnings
      if (!rec.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          errorDef: ErrorCatalog.WARN001,
          field: 'email',
          actual_value: rec.email || '(missing)',
          customMessage: `Missing or invalid employee email address. Payslip dispatch will require manual routing.`,
        }));
      }
    }

    // ========================================================================
    // STEP 5: Apply cross-row validations (duplicate instruction checks)
    // ========================================================================
    executionTrace.push({
      step: 5,
      name: 'APPLY_CROSS_ROW_VALIDATIONS',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    const seenEmpIds = new Set();
    const seenAccounts = new Map(); // acc -> firstEmpId
    const seenRefs = new Set();

    for (const rec of joinedRecords) {
      // DUP001: Duplicate Employee ID
      if (seenEmpIds.has(rec.employee_id)) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: rec.employee_id,
          employee_name: rec.employee_name,
          errorDef: ErrorCatalog.DUP001,
          field: 'employee_id',
          actual_value: rec.employee_id,
          customMessage: `Duplicate payment instruction for employee ID '${rec.employee_id}'.`,
        }));
      } else {
        seenEmpIds.add(rec.employee_id);
      }

      // DUP001: Duplicate Bank Account Number
      if (rec.account_number) {
        if (seenAccounts.has(rec.account_number)) {
          const originalEmp = seenAccounts.get(rec.account_number);
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: rec.employee_id,
            employee_name: rec.employee_name,
            errorDef: ErrorCatalog.DUP001,
            field: 'account_number',
            actual_value: rec.account_number,
            customMessage: `Duplicate bank account '${rec.account_number}' shared between employee '${rec.employee_id}' and '${originalEmp}'.`,
          }));
        } else {
          seenAccounts.set(rec.account_number, rec.employee_id);
        }
      }

      // DUP001: Duplicate Payment Reference
      if (rec.payment_reference) {
        if (seenRefs.has(rec.payment_reference)) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: rec.employee_id,
            employee_name: rec.employee_name,
            errorDef: ErrorCatalog.DUP001,
            field: 'payment_reference',
            actual_value: rec.payment_reference,
            customMessage: `Duplicate payment reference '${rec.payment_reference}'.`,
          }));
        } else {
          seenRefs.add(rec.payment_reference);
        }
      }
    }

    // ========================================================================
    // STEP 6: Calculate batch aggregate totals
    // ========================================================================
    executionTrace.push({
      step: 6,
      name: 'CALCULATE_BATCH_AGGREGATES',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalContributions = 0;

    joinedRecords.forEach((r) => {
      totalGross += r.gross_salary;
      totalDeductions += r.deductions;
      totalNet += r.net_payable_amount;
      totalContributions += r.employer_contributions;
    });

    const calculatedAggregates = {
      record_count: joinedRecords.length,
      total_gross: Math.round(totalGross * 100) / 100,
      total_deductions: Math.round(totalDeductions * 100) / 100,
      total_net: Math.round(totalNet * 100) / 100,
      total_contributions: Math.round(totalContributions * 100) / 100,
    };

    // ========================================================================
    // STEP 7: Compare calculated batch totals against frozen payroll source record
    // ========================================================================
    executionTrace.push({
      step: 7,
      name: 'COMPARE_FROZEN_SOURCE_RECORD',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    if (payrollSourceLedger) {
      const sourceNet = Number(payrollSourceLedger.total_net ?? payrollSourceLedger.net_salary ?? payrollSourceLedger.total_amount ?? 0);
      const diff = Math.abs(calculatedAggregates.total_net - sourceNet);

      if (diff > this.tolerance) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: 'SYSTEM',
          employee_name: 'Ledger Reconciliation Service',
          errorDef: ErrorCatalog.LEDGER_MISMATCH,
          field: 'total_net',
          actual_value: calculatedAggregates.total_net,
          customMessage: `Batch net total ₹${calculatedAggregates.total_net} does not match frozen payroll source ledger ₹${sourceNet} (Disparity: ₹${diff.toFixed(2)}).`,
        }));
      }
    }

    // ========================================================================
    // STEP 8: Persist detected issues into the ValidationIssue collection/table
    // ========================================================================
    executionTrace.push({
      step: 8,
      name: 'PERSIST_VALIDATION_ISSUES',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    await this.issueRepo.persistIssues(batchId, issues);

    // ========================================================================
    // STEP 9: Transition batch state to VALIDATED if and only if zero blocking issues exist
    // ========================================================================
    executionTrace.push({
      step: 9,
      name: 'TRANSITION_BATCH_STATE',
      status: 'STARTED',
      timestamp: new Date().toISOString(),
    });

    const blockingIssues = issues.filter((i) => i.severity === ErrorSeverity.BLOCK);
    const warningIssues = issues.filter((i) => i.severity === ErrorSeverity.WARN);
    const isPassed = blockingIssues.length === 0;

    // Advance batch status to VALIDATED if and only if 0 unresolved BLOCK issues exist
    batch.status = isPassed ? 'VALIDATED' : 'FAILED';
    batch.validation_status = isPassed ? 'VALIDATED' : 'VALIDATION_FAILED';
    batch.can_generate_bank_file = isPassed;
    batch.is_blocked = !isPassed;
    batch.validation_summary = {
      is_passed: isPassed,
      total_issues_count: issues.length,
      blocking_issues_count: blockingIssues.length,
      warning_issues_count: warningIssues.length,
      calculated_aggregates: calculatedAggregates,
      validated_at: new Date().toISOString(),
      validated_by: operatorId,
    };

    return {
      batch_id: batchId,
      status: batch.status,
      validation_status: batch.validation_status,
      can_generate_bank_file: isPassed,
      is_blocked: !isPassed,
      validation_summary: batch.validation_summary,
      issues,
      blocking_issues: blockingIssues,
      warning_issues: warningIssues,
      unresolved_blocking_count: blockingIssues.length,
      calculated_aggregates: calculatedAggregates,
      execution_trace: executionTrace,
      validated_at: batch.validation_summary.validated_at,
      validated_by: operatorId,
    };
  }

  _createIssue({
    batch_id,
    employee_id,
    employee_name,
    errorDef,
    field = null,
    actual_value = null,
    customMessage = null,
  }) {
    return {
      issue_id: `ISS-${errorDef.code}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`,
      batch_id,
      employee_id,
      employee_name,
      code: errorDef.code,
      title: errorDef.title,
      severity: errorDef.severity,
      category: errorDef.category,
      field,
      actual_value,
      message: customMessage || errorDef.description,
      suggested_fix: errorDef.resolutionStrategy,
      resolved: false,
      resolved_at: null,
      resolved_by: null,
      created_at: new Date().toISOString(),
    };
  }
}
