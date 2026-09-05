/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PRE-DISBURSEMENT VALIDATION PIPELINE
 * ============================================================================
 * Module: Pre-Disbursement Automated Regulatory & Integrity Validation Gate
 *
 * Core Capabilities:
 *  1. Indian Banking Rules: Strict IFSC Regex (/^[A-Z]{4}0[A-Z0-9]{6}$/), Account Length & Number Checks
 *  2. Financial Math Integrity: Exact Balance Verification ($Gross - Deductions = Net$, tolerance < ₹0.01)
 *  3. Duplicate Transaction Detection: Identical Employee IDs, Bank Accounts, or Payment References
 *  4. Statutory Identifiers Gate:
 *     - UAN (12 digits) for PF Covered Records
 *     - ESIC IP No (10 digits) for Gross <= ₹21,000 (or ₹25,000 for PWD)
 *     - PRAN (12 digits) for NPS Opt-in Records
 *  5. Structured ValidationIssue generator with BLOCKING vs WARNING classifications
 *  6. Bank File Export Gatekeeper (hard block on any unresolved BLOCKING issue)
 *  7. Automated HR Task & Incident Alert Dispatcher Payload
 *
 * @version 2.4.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

export const IssueSeverity = Object.freeze({
  BLOCKING: 'BLOCKING',
  WARNING: 'WARNING',
  INFO: 'INFO',
});

export const ValidationCode = Object.freeze({
  // Banking Codes
  INVALID_IFSC: 'INVALID_IFSC',
  MISSING_ACCOUNT_NUMBER: 'MISSING_ACCOUNT_NUMBER',
  INVALID_ACCOUNT_FORMAT: 'INVALID_ACCOUNT_FORMAT',
  ZERO_OR_NEGATIVE_PAY: 'ZERO_OR_NEGATIVE_PAY',
  
  // Math Integrity Codes
  CALCULATION_MISMATCH: 'CALCULATION_MISMATCH',
  
  // Duplication Codes
  DUPLICATE_EMPLOYEE_ID: 'DUPLICATE_EMPLOYEE_ID',
  DUPLICATE_ACCOUNT_NUMBER: 'DUPLICATE_ACCOUNT_NUMBER',
  DUPLICATE_PAYMENT_REF: 'DUPLICATE_PAYMENT_REF',
  
  // Statutory Identifiers Codes
  PF_MISSING_OR_INVALID_UAN: 'PF_MISSING_OR_INVALID_UAN',
  ESIC_MISSING_OR_INVALID_IP: 'ESIC_MISSING_OR_INVALID_IP',
  NPS_MISSING_OR_INVALID_PRAN: 'NPS_MISSING_OR_INVALID_PRAN',
  
  // Profile & KYC
  UNVERIFIED_BANK_ACCOUNT: 'UNVERIFIED_BANK_ACCOUNT',
});

/**
 * Pre-Disbursement Validation Pipeline Engine
 */
export class PreDisbursementValidationPipeline {
  constructor(options = {}) {
    this.tolerance = options.tolerance || 0.01; // ₹0.01 floating point rounding tolerance
    this.esicStandardWageCeiling = options.esicStandardWageCeiling || 21000;
    this.esicPwdWageCeiling = options.esicPwdWageCeiling || 25000;
  }

  /**
   * Execute full validation suite across all batch records.
   * 
   * @param {Object} batch - The PaymentBatch document
   * @param {Array} records - Array of disbursement employee line items
   * @returns {Object} ValidationResult containing issues, metrics, gate decision, and HR task payload
   */
  validateBatch(batch, records = []) {
    const batchId = batch.batch_id || 'UNKNOWN_BATCH';
    const batchType = batch.batch_type || 'SALARY';
    const issues = [];

    if (!records || records.length === 0) {
      issues.push(this._createIssue({
        batch_id: batchId,
        employee_id: 'SYSTEM',
        employee_name: 'System Validation Engine',
        code: 'EMPTY_BATCH',
        severity: IssueSeverity.BLOCKING,
        message: 'Disbursement batch contains 0 employee records.',
        field: 'records',
        current_value: 0,
        suggested_fix: 'Add active employee payout entries before running validation gate.',
      }));

      return this._buildPipelineResponse(batch, issues);
    }

    // Hash maps for duplicate detection
    const seenEmployeeIds = new Map();
    const seenAccountNumbers = new Map();
    const seenPaymentRefs = new Map();

    for (let index = 0; index < records.length; index++) {
      const rec = records[index];
      const empId = rec.employee_id || `REC_ROW_${index + 1}`;
      const empName = rec.employee_name || 'Unnamed Employee';

      // ----------------------------------------------------------------------
      // RULE 1: Bank Account Number Integrity
      // ----------------------------------------------------------------------
      const rawAccount = rec.account_number_raw || rec.account_number || '';
      const maskedAccount = rec.account_number_masked || '';

      if (!rawAccount && !maskedAccount) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: ValidationCode.MISSING_ACCOUNT_NUMBER,
          severity: IssueSeverity.BLOCKING,
          message: `Missing bank account number for employee ${empName} (${empId}).`,
          field: 'banking.account_number',
          current_value: null,
          suggested_fix: 'Update employee bank profile with valid bank account details.',
        }));
      } else {
        const cleanAccount = String(rawAccount).replace(/\s+/g, '');
        if (cleanAccount && (cleanAccount.length < 9 || cleanAccount.length > 18 || !/^\d+$/.test(cleanAccount))) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: ValidationCode.INVALID_ACCOUNT_FORMAT,
            severity: IssueSeverity.BLOCKING,
            message: `Bank account number must be numeric between 9 to 18 digits. Found: ${cleanAccount.slice(0, 2)}***${cleanAccount.slice(-3)}`,
            field: 'banking.account_number',
            current_value: cleanAccount,
            suggested_fix: 'Verify account number with cancelled cheque or bank statement.',
          }));
        }
      }

      // ----------------------------------------------------------------------
      // RULE 2: Indian IFSC Code Regex Validation
      // ----------------------------------------------------------------------
      // Format: 4 uppercase alphabets, digit 0, 6 alphanumeric characters
      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      const ifscCode = (rec.ifsc_code || '').trim().toUpperCase();

      if (!ifscCode) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: ValidationCode.INVALID_IFSC,
          severity: IssueSeverity.BLOCKING,
          message: `IFSC code is missing for employee ${empName} (${empId}).`,
          field: 'banking.ifsc_code',
          current_value: null,
          suggested_fix: 'Enter standard 11-character RBI assigned IFSC code.',
        }));
      } else if (!ifscRegex.test(ifscCode)) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: ValidationCode.INVALID_IFSC,
          severity: IssueSeverity.BLOCKING,
          message: `Invalid IFSC format '${ifscCode}'. Expected format: 4 uppercase alphabetic, 5th digit '0', followed by 6 alphanumeric (e.g. HDFC0001234).`,
          field: 'banking.ifsc_code',
          current_value: ifscCode,
          suggested_fix: 'Correct the IFSC code matching RBI branch directory.',
        }));
      }

      // ----------------------------------------------------------------------
      // RULE 3: Calculation Integrity (Gross - Deductions = Net) & Positive Pay
      // ----------------------------------------------------------------------
      const gross = Number(rec.gross_earnings || rec.gross_wages || 0);
      const deductions = Number(rec.total_deductions || 0);
      const netPayable = Number(rec.net_payable_amount ?? rec.amount ?? 0);

      // Check positive pay
      if (netPayable <= 0) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: ValidationCode.ZERO_OR_NEGATIVE_PAY,
          severity: IssueSeverity.BLOCKING,
          message: `Net payable amount must be positive. Found ₹${netPayable.toFixed(2)}.`,
          field: 'net_payable_amount',
          current_value: netPayable,
          suggested_fix: 'Review unpaid leave deductions or off-cycle loan recovery.',
        }));
      }

      // Math verification if gross and deductions are supplied
      if (rec.gross_earnings !== undefined && rec.total_deductions !== undefined) {
        const calculatedNet = Math.round((gross - deductions) * 100) / 100;
        const diff = Math.abs(calculatedNet - netPayable);
        if (diff > this.tolerance) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: ValidationCode.CALCULATION_MISMATCH,
            severity: IssueSeverity.BLOCKING,
            message: `Mathematical integrity error: Gross (₹${gross}) - Deductions (₹${deductions}) = ₹${calculatedNet}, but Net Payable is ₹${netPayable} (Delta: ₹${diff.toFixed(2)}).`,
            field: 'net_payable_amount',
            current_value: { gross, deductions, netPayable, delta: diff },
            suggested_fix: 'Recompute payroll run to synchronize earnings and deductions ledger.',
          }));
        }
      }

      // ----------------------------------------------------------------------
      // RULE 4: Duplicate Transaction Detection
      // ----------------------------------------------------------------------
      // Duplicate Employee ID
      if (seenEmployeeIds.has(empId)) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: ValidationCode.DUPLICATE_EMPLOYEE_ID,
          severity: IssueSeverity.BLOCKING,
          message: `Duplicate disbursement entry detected for Employee ID '${empId}' (Rows ${seenEmployeeIds.get(empId) + 1} and ${index + 1}).`,
          field: 'employee_id',
          current_value: empId,
          suggested_fix: 'Remove duplicate payroll entry or merge off-cycle earnings into a single disbursement.',
        }));
      } else {
        seenEmployeeIds.set(empId, index);
      }

      // Duplicate Bank Account
      if (rawAccount) {
        if (seenAccountNumbers.has(rawAccount)) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: ValidationCode.DUPLICATE_ACCOUNT_NUMBER,
            severity: IssueSeverity.BLOCKING,
            message: `Duplicate bank account number shared between ${empName} (${empId}) and ${records[seenAccountNumbers.get(rawAccount)].employee_name} (${records[seenAccountNumbers.get(rawAccount)].employee_id}).`,
            field: 'banking.account_number',
            current_value: `...${String(rawAccount).slice(-4)}`,
            suggested_fix: 'Verify separate employee bank accounts to prevent accidental multi-credit.',
          }));
        } else {
          seenAccountNumbers.set(rawAccount, index);
        }
      }

      // Duplicate Payment Reference
      if (rec.payment_reference) {
        if (seenPaymentRefs.has(rec.payment_reference)) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: ValidationCode.DUPLICATE_PAYMENT_REF,
            severity: IssueSeverity.BLOCKING,
            message: `Duplicate client payment reference '${rec.payment_reference}' found. Banking APIs require unique references per line item.`,
            field: 'payment_reference',
            current_value: rec.payment_reference,
            suggested_fix: 'Generate distinct sequence IDs for payment references.',
          }));
        } else {
          seenPaymentRefs.set(rec.payment_reference, index);
        }
      }

      // ----------------------------------------------------------------------
      // RULE 5: Statutory Identifiers Validation
      // ----------------------------------------------------------------------
      
      // 5A. PF UAN Check
      const isPfCovered = rec.is_pf_covered ?? (batchType === 'PF' || (rec.epf_wages && rec.epf_wages > 0));
      if (isPfCovered) {
        const uan = String(rec.uan || '').trim();
        const isValidUan = /^\d{12}$/.test(uan);
        if (!uan || !isValidUan) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: ValidationCode.PF_MISSING_OR_INVALID_UAN,
            severity: IssueSeverity.BLOCKING,
            message: `Employee ${empName} is PF covered but lacks a valid 12-digit numeric Universal Account Number (UAN). Found: '${uan || 'NONE'}'.`,
            field: 'statutory_identifiers.uan',
            current_value: uan || null,
            suggested_fix: 'Collect UAN from employee or generate new UAN on EPFO Unified Portal.',
          }));
        }
      }

      // 5B. ESIC Insurance Person (IP) Number Check
      const isPwd = Boolean(rec.is_pwd);
      const wageCeiling = isPwd ? this.esicPwdWageCeiling : this.esicStandardWageCeiling;
      const isEsicCovered = rec.is_esic_covered ?? (batchType === 'ESIC' || (gross > 0 && gross <= wageCeiling));
      
      if (isEsicCovered) {
        const ipNo = String(rec.esic_ip_number || rec.ip_number || '').trim();
        const isValidIp = /^\d{10}$/.test(ipNo);
        if (!ipNo || !isValidIp) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: ValidationCode.ESIC_MISSING_OR_INVALID_IP,
            severity: IssueSeverity.BLOCKING,
            message: `Employee ${empName} (Gross: ₹${gross} <= ₹${wageCeiling}) is covered under ESIC Act but missing valid 10-digit IP Number. Found: '${ipNo || 'NONE'}'.`,
            field: 'statutory_identifiers.esic_ip_number',
            current_value: ipNo || null,
            suggested_fix: 'Register employee on ESIC Portal to obtain 10-digit Insurance Person number.',
          }));
        }
      }

      // 5C. NPS PRAN Check
      const isNpsOptIn = rec.is_nps_opt_in ?? (batchType === 'NPS' || (rec.nps_contribution && rec.nps_contribution > 0));
      if (isNpsOptIn) {
        const pran = String(rec.pran || rec.nps_pran || '').trim();
        const isValidPran = /^\d{12}$/.test(pran);
        if (!pran || !isValidPran) {
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: ValidationCode.NPS_MISSING_OR_INVALID_PRAN,
            severity: IssueSeverity.BLOCKING,
            message: `Employee ${empName} is opted into Corporate NPS but has missing or invalid 12-digit PRAN. Found: '${pran || 'NONE'}'.`,
            field: 'statutory_identifiers.nps_pran',
            current_value: pran || null,
            suggested_fix: 'Input employee CRA/NSDL allotted 12-digit PRAN.',
          }));
        }
      }

      // 5D. Penny-Drop Bank Account Verification Warning
      if (rec.is_bank_verified === false) {
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: ValidationCode.UNVERIFIED_BANK_ACCOUNT,
          severity: IssueSeverity.WARNING,
          message: `Bank account for ${empName} has not been penny-drop verified. Higher risk of transfer failure.`,
          field: 'banking.is_verified',
          current_value: false,
          suggested_fix: 'Trigger penny-drop API check or manual verification prior to execution.',
        }));
      }
    }

    return this._buildPipelineResponse(batch, issues);
  }

  /**
   * Evaluates whether a BankFile export is permitted.
   * STRICT BLOCKING: Returns false if ANY unresolved BLOCKING issue exists.
   * 
   * @param {Array} issues - Array of ValidationIssue objects
   * @returns {Object} Evaluation status { can_generate_file: boolean, blocking_count: number, reason: string }
   */
  canGenerateBankFile(issues = []) {
    const unresolvedBlocking = issues.filter(
      (iss) => iss.severity === IssueSeverity.BLOCKING && !iss.resolved_at
    );

    if (unresolvedBlocking.length > 0) {
      return {
        can_generate_file: false,
        blocking_count: unresolvedBlocking.length,
        reason: `EXPORT_BLOCKED: ${unresolvedBlocking.length} unresolved BLOCKING issue(s) exist. Resolve all blocking anomalies before generating bank file.`,
        blocking_issues: unresolvedBlocking,
      };
    }

    return {
      can_generate_file: true,
      blocking_count: 0,
      reason: 'GATE_PASSED: All blocking pre-disbursement checks cleared.',
      blocking_issues: [],
    };
  }

  /**
   * Helper to construct a standardized ValidationIssue object.
   */
  _createIssue({
    batch_id,
    employee_id,
    employee_name,
    code,
    severity,
    message,
    field,
    current_value,
    suggested_fix,
  }) {
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    return {
      issue_id: `ISS-${Date.now()}-${randomSuffix}`,
      batch_id,
      employee_id,
      employee_name,
      code,
      severity,
      message,
      field,
      current_value,
      suggested_fix,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
      resolution_notes: null,
    };
  }

  /**
   * Construct final comprehensive pipeline output with HR task payload.
   */
  _buildPipelineResponse(batch, issues) {
    const blockingIssues = issues.filter((i) => i.severity === IssueSeverity.BLOCKING && !i.resolved_at);
    const warnings = issues.filter((i) => i.severity === IssueSeverity.WARNING && !i.resolved_at);
    const isPassed = blockingIssues.length === 0;

    const exportGate = this.canGenerateBankFile(issues);

    // Build automated HR Incident Task payload
    const hrTaskPayload = blockingIssues.length > 0 ? {
      task_type: 'PAYROLL_DISBURSEMENT_VALIDATION_ALERT',
      priority: 'CRITICAL',
      title: `Action Required: ${blockingIssues.length} Blocking Issue(s) on ${batch.batch_name || batch.batch_id}`,
      batch_id: batch.batch_id,
      assigned_role: 'HR_PAYROLL_OFFICER',
      due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours SLA
      payload: {
        total_blocking_count: blockingIssues.length,
        total_warning_count: warnings.length,
        affected_employees: Array.from(new Set(blockingIssues.map((i) => i.employee_id))),
        issues: blockingIssues.map((i) => ({
          issue_id: i.issue_id,
          employee_id: i.employee_id,
          employee_name: i.employee_name,
          code: i.code,
          field: i.field,
          message: i.message,
          suggested_fix: i.suggested_fix,
        })),
      },
      created_at: new Date().toISOString(),
    } : null;

    return {
      batch_id: batch.batch_id,
      is_gate_passed: isPassed,
      can_generate_bank_file: exportGate.can_generate_file,
      summary: {
        total_issues: issues.length,
        blocking_count: blockingIssues.length,
        warning_count: warnings.length,
      },
      issues,
      export_gate: exportGate,
      hr_task_payload: hrTaskPayload,
      validated_at: new Date().toISOString(),
    };
  }
}
