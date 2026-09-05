/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - 8-POINT AUTOMATED BANK FILE VALIDATION SERVICE
 * ============================================================================
 * Architecture Layer: Pre-Disbursement Regulatory & Integrity Validation Gate
 *
 * The 8 Deterministic Validation Points:
 *  1. GATE_01_PAYROLL_APPROVAL: Master Payroll Run & Batch approval status flag check
 *  2. GATE_02_CALC_CONSISTENCY: Calculation consistency (Gross - Total Deductions = Net)
 *  3. GATE_03_ACCOUNT_FORMAT: Bank account numeric format and length check (9 - 18 digits)
 *  4. GATE_04_IFSC_REGEX: Indian Reserve Bank IFSC code regex format (/^[A-Z]{4}0[A-Z0-9]{6}$/)
 *  5. GATE_05_DUPLICATE_PREVENTION: Duplicate employee IDs, bank accounts, or payment references
 *  6. GATE_06_POSITIVE_PAY: Non-zero, strictly positive net payout (> ₹0)
 *  7. GATE_07_PAYMENT_REFERENCE: Non-empty unique client payment reference code
 *  8. GATE_08_AGGREGATE_LEDGER: Batch total amount reconciles with sum of line items
 *
 * Multi-Tier Enforcement:
 *  - Severity: BLOCKING (Hard stop: Blocks frontend button & triggers backend 422 HTTP rejection)
 *  - Severity: WARNING (Informational: Penny drop verification, tax exemptions)
 *
 * @version 2.4.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

export const GateCode = Object.freeze({
  GATE_01_PAYROLL_APPROVAL: 'GATE_01_PAYROLL_APPROVAL',
  GATE_02_CALC_CONSISTENCY: 'GATE_02_CALC_CONSISTENCY',
  GATE_03_ACCOUNT_FORMAT: 'GATE_03_ACCOUNT_FORMAT',
  GATE_04_IFSC_REGEX: 'GATE_04_IFSC_REGEX',
  GATE_05_DUPLICATE_PREVENTION: 'GATE_05_DUPLICATE_PREVENTION',
  GATE_06_POSITIVE_PAY: 'GATE_06_POSITIVE_PAY',
  GATE_07_PAYMENT_REFERENCE: 'GATE_07_PAYMENT_REFERENCE',
  GATE_08_AGGREGATE_LEDGER: 'GATE_08_AGGREGATE_LEDGER',
});

export const ValidationSeverity = Object.freeze({
  BLOCKING: 'BLOCKING',
  WARNING: 'WARNING',
  INFO: 'INFO',
});

export class EightPointValidationGateService {
  constructor(options = {}) {
    this.tolerance = options.tolerance || 0.01; // ₹0.01 floating point rounding tolerance
    this.ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  }

  /**
   * Evaluates all 8 gates deterministically.
   * 
   * @param {Object} batch - The PaymentBatch entity
   * @param {Array} records - Array of disbursement line items
   * @param {Object} options - Optional context (payrollRun status, etc.)
   * @returns {Object} Comprehensive evaluation result
   */
  evaluate(batch, records = [], options = {}) {
    const batchId = batch.batch_id || 'BATCH_DISBURSEMENT';
    const issues = [];

    // Track checklist items for UI visualization
    const checklist = [
      { id: GateCode.GATE_01_PAYROLL_APPROVAL, label: 'Payroll approved', isPassed: true, message: 'Approval status confirmed' },
      { id: GateCode.GATE_02_CALC_CONSISTENCY, label: 'Net salary calculated', isPassed: true, message: 'Gross - Deductions = Net' },
      { id: GateCode.GATE_03_ACCOUNT_FORMAT, label: 'Account number present & valid', isPassed: true, message: 'Numeric 9-18 digits' },
      { id: GateCode.GATE_04_IFSC_REGEX, label: 'IFSC valid', isPassed: true, message: 'RBI standard format (/^[A-Z]{4}0[A-Z0-9]{6}$/)' },
      { id: GateCode.GATE_05_DUPLICATE_PREVENTION, label: 'No duplicate payment', isPassed: true, message: 'Zero duplicate records' },
      { id: GateCode.GATE_06_POSITIVE_PAY, label: 'Positive net payouts', isPassed: true, message: 'Net amount > ₹0' },
      { id: GateCode.GATE_07_PAYMENT_REFERENCE, label: 'Payment reference unique', isPassed: true, message: 'Non-empty client reference' },
      { id: GateCode.GATE_08_AGGREGATE_LEDGER, label: 'Total amount reconciled', isPassed: true, message: 'Sum equals batch total' },
    ];

    const markChecklistFailed = (code, msg) => {
      const item = checklist.find(c => c.id === code);
      if (item) {
        item.isPassed = false;
        item.message = msg;
      }
    };

    // ------------------------------------------------------------------------
    // GATE 1: Master Approval Status Flag
    // ------------------------------------------------------------------------
    const isApproved = batch.status === 'APPROVED' || batch.status === 'CHECKER_APPROVED' || options.isApproved === true;
    if (!isApproved) {
      markChecklistFailed(GateCode.GATE_01_PAYROLL_APPROVAL, `Batch status is '${batch.status}'. Must be APPROVED.`);
      issues.push(this._createIssue({
        batch_id: batchId,
        employee_id: 'SYSTEM',
        employee_name: 'Batch Approval Authority',
        code: GateCode.GATE_01_PAYROLL_APPROVAL,
        severity: ValidationSeverity.BLOCKING,
        message: `Batch '${batchId}' is in '${batch.status}' state and has not received final Checker 4-Eyes approval.`,
        field: 'status',
        current_value: batch.status,
        suggested_fix: 'Submit batch for Checker sign-off before generating bank export file.',
      }));
    }

    // Check for empty records
    if (!records || records.length === 0) {
      markChecklistFailed(GateCode.GATE_06_POSITIVE_PAY, '0 records in batch');
      issues.push(this._createIssue({
        batch_id: batchId,
        employee_id: 'SYSTEM',
        employee_name: 'Disbursement Ledger',
        code: GateCode.GATE_06_POSITIVE_PAY,
        severity: ValidationSeverity.BLOCKING,
        message: 'Batch contains 0 active employee disbursement records.',
        field: 'records',
        current_value: 0,
        suggested_fix: 'Populate employee records from calculated payroll run.',
      }));

      return this._buildResponse(batch, checklist, issues);
    }

    // Maps for duplicate checks
    const seenEmpIds = new Map();
    const seenAccounts = new Map();
    const seenRefs = new Map();

    let computedSumOfNet = 0;

    // Evaluate Record-Level Gates (Gates 2, 3, 4, 5, 6, 7)
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const empId = rec.employee_id || `REC_ROW_${i + 1}`;
      const empName = rec.employee_name || 'Unnamed Employee';
      const gross = Number(rec.gross_earnings || rec.gross_salary || rec.gross_wages || 0);
      const deductions = Number(rec.total_deductions || rec.deductions || 0);
      const net = Number(rec.net_payable_amount ?? rec.amount ?? rec.net_salary ?? 0);

      computedSumOfNet += net;

      // ----------------------------------------------------------------------
      // GATE 6: Positive Net Payout (> ₹0)
      // ----------------------------------------------------------------------
      if (net <= 0) {
        markChecklistFailed(GateCode.GATE_06_POSITIVE_PAY, `Record ${empId} has non-positive pay ₹${net}`);
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: GateCode.GATE_06_POSITIVE_PAY,
          severity: ValidationSeverity.BLOCKING,
          message: `Employee ${empName} (${empId}) has zero or negative net payable amount: ₹${net}. Bank clearing requires positive pay > ₹0.`,
          field: 'net_payable_amount',
          current_value: net,
          suggested_fix: 'Review payroll deductions or move negative recovery to off-cycle adjustment.',
        }));
      }

      // ----------------------------------------------------------------------
      // GATE 2: Calculation Consistency (Gross - Deductions = Net)
      // ----------------------------------------------------------------------
      if (rec.gross_earnings !== undefined && rec.total_deductions !== undefined) {
        const expectedNet = Math.round((gross - deductions) * 100) / 100;
        const delta = Math.abs(expectedNet - net);
        if (delta > this.tolerance) {
          markChecklistFailed(GateCode.GATE_02_CALC_CONSISTENCY, `Calculation mismatch on ${empId} (Delta: ₹${delta.toFixed(2)})`);
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: GateCode.GATE_02_CALC_CONSISTENCY,
            severity: ValidationSeverity.BLOCKING,
            message: `Mathematical integrity mismatch for ${empName} (${empId}): Gross (₹${gross}) - Deductions (₹${deductions}) = ₹${expectedNet}, but Net is ₹${net} (Delta: ₹${delta.toFixed(2)}).`,
            field: 'net_payable_amount',
            current_value: { gross, deductions, net, delta },
            suggested_fix: 'Recalculate payroll run to resolve earnings/deductions ledger disparity.',
          }));
        }
      }

      // ----------------------------------------------------------------------
      // GATE 3: Account Number Format and Length (9 - 18 digits)
      // ----------------------------------------------------------------------
      const rawAccount = String(rec.account_number_raw || rec.account_number || '').trim();
      const maskedAccount = String(rec.account_number_masked || '').trim();

      if (!rawAccount && !maskedAccount) {
        markChecklistFailed(GateCode.GATE_03_ACCOUNT_FORMAT, `Missing account for ${empId}`);
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: GateCode.GATE_03_ACCOUNT_FORMAT,
          severity: ValidationSeverity.BLOCKING,
          message: `Bank account number is completely missing for employee ${empName} (${empId}).`,
          field: 'banking.account_number',
          current_value: null,
          suggested_fix: 'Update employee bank profile with valid bank account details.',
        }));
      } else if (rawAccount) {
        const cleanAcc = rawAccount.replace(/\s+/g, '');
        if (cleanAcc.length < 9 || cleanAcc.length > 18 || !/^\d+$/.test(cleanAcc)) {
          markChecklistFailed(GateCode.GATE_03_ACCOUNT_FORMAT, `Invalid account format for ${empId}`);
          issues.push(this._createIssue({
            batch_id: batchId,
            employee_id: empId,
            employee_name: empName,
            code: GateCode.GATE_03_ACCOUNT_FORMAT,
            severity: ValidationSeverity.BLOCKING,
            message: `Bank account number for ${empName} (${empId}) must be strictly numeric between 9 and 18 digits. Found length ${cleanAcc.length}.`,
            field: 'banking.account_number',
            current_value: `...${cleanAcc.slice(-4)}`,
            suggested_fix: 'Verify account number with cancelled cheque or bank statement.',
          }));
        }
      }

      // ----------------------------------------------------------------------
      // GATE 4: Indian IFSC Code Regex Compliance
      // ----------------------------------------------------------------------
      const ifsc = String(rec.ifsc_code || '').trim().toUpperCase();
      if (!ifsc) {
        markChecklistFailed(GateCode.GATE_04_IFSC_REGEX, `Missing IFSC for ${empId}`);
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: GateCode.GATE_04_IFSC_REGEX,
          severity: ValidationSeverity.BLOCKING,
          message: `IFSC code is missing for employee ${empName} (${empId}).`,
          field: 'banking.ifsc_code',
          current_value: null,
          suggested_fix: 'Enter 11-character RBI assigned IFSC code.',
        }));
      } else if (!this.ifscRegex.test(ifsc)) {
        markChecklistFailed(GateCode.GATE_04_IFSC_REGEX, `Invalid IFSC format '${ifsc}' on ${empId}`);
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: GateCode.GATE_04_IFSC_REGEX,
          severity: ValidationSeverity.BLOCKING,
          message: `Invalid Indian IFSC format '${ifsc}' for ${empName} (${empId}). Expected format: 4 uppercase alphabets, 5th digit '0', followed by 6 alphanumeric characters (e.g., HDFC0001234, SBIN0004321).`,
          field: 'banking.ifsc_code',
          current_value: ifsc,
          suggested_fix: 'Correct the IFSC code matching RBI branch directory.',
        }));
      }

      // ----------------------------------------------------------------------
      // GATE 5: Duplicate Payment Prevention
      // ----------------------------------------------------------------------
      if (seenEmpIds.has(empId)) {
        markChecklistFailed(GateCode.GATE_05_DUPLICATE_PREVENTION, `Duplicate Employee ID ${empId}`);
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: GateCode.GATE_05_DUPLICATE_PREVENTION,
          severity: ValidationSeverity.BLOCKING,
          message: `Duplicate disbursement line item found for Employee ID '${empId}' (Rows ${seenEmpIds.get(empId) + 1} and ${i + 1}).`,
          field: 'employee_id',
          current_value: empId,
          suggested_fix: 'Remove duplicate payroll entry or merge off-cycle earnings into a single disbursement.',
        }));
      } else {
        seenEmpIds.set(empId, i);
      }

      if (rawAccount && seenAccounts.has(rawAccount)) {
        markChecklistFailed(GateCode.GATE_05_DUPLICATE_PREVENTION, `Duplicate bank account on ${empId}`);
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: GateCode.GATE_05_DUPLICATE_PREVENTION,
          severity: ValidationSeverity.BLOCKING,
          message: `Duplicate bank account shared between ${empName} (${empId}) and ${records[seenAccounts.get(rawAccount)].employee_name} (${records[seenAccounts.get(rawAccount)].employee_id}).`,
          field: 'banking.account_number',
          current_value: `...${rawAccount.slice(-4)}`,
          suggested_fix: 'Verify separate employee bank accounts to prevent accidental multi-credit.',
        }));
      } else if (rawAccount) {
        seenAccounts.set(rawAccount, i);
      }

      // ----------------------------------------------------------------------
      // GATE 7: Payment Reference Code
      // ----------------------------------------------------------------------
      const ref = String(rec.payment_reference || '').trim();
      if (!ref) {
        markChecklistFailed(GateCode.GATE_07_PAYMENT_REFERENCE, `Missing payment reference on ${empId}`);
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: GateCode.GATE_07_PAYMENT_REFERENCE,
          severity: ValidationSeverity.BLOCKING,
          message: `Payment reference code is empty for employee ${empName} (${empId}).`,
          field: 'payment_reference',
          current_value: null,
          suggested_fix: 'Assign a unique customer reference code (e.g. KYLRX-SAL-001).',
        }));
      } else if (seenRefs.has(ref)) {
        markChecklistFailed(GateCode.GATE_07_PAYMENT_REFERENCE, `Duplicate payment reference '${ref}'`);
        issues.push(this._createIssue({
          batch_id: batchId,
          employee_id: empId,
          employee_name: empName,
          code: GateCode.GATE_07_PAYMENT_REFERENCE,
          severity: ValidationSeverity.BLOCKING,
          message: `Duplicate payment reference '${ref}' found in batch. Banking clearing requires strictly unique references.`,
          field: 'payment_reference',
          current_value: ref,
          suggested_fix: 'Generate unique sequence reference codes.',
        }));
      } else {
        seenRefs.set(ref, i);
      }
    }

    // ------------------------------------------------------------------------
    // GATE 8: Aggregate Ledger Balance Consistency
    // ------------------------------------------------------------------------
    const statedBatchAmount = Number(batch.summary?.total_amount || batch.amount || computedSumOfNet);
    const sumDelta = Math.abs(statedBatchAmount - computedSumOfNet);

    if (sumDelta > this.tolerance) {
      markChecklistFailed(GateCode.GATE_08_AGGREGATE_LEDGER, `Batch sum mismatch: Stated ₹${statedBatchAmount} vs Computed ₹${computedSumOfNet}`);
      issues.push(this._createIssue({
        batch_id: batchId,
        employee_id: 'SYSTEM',
        employee_name: 'Batch General Ledger',
        code: GateCode.GATE_08_AGGREGATE_LEDGER,
        severity: ValidationSeverity.BLOCKING,
        message: `Disbursement ledger balance mismatch: Batch summary states ₹${statedBatchAmount}, but line items sum to ₹${computedSumOfNet} (Delta: ₹${sumDelta.toFixed(2)}).`,
        field: 'summary.total_amount',
        current_value: { stated: statedBatchAmount, computed: computedSumOfNet, delta: sumDelta },
        suggested_fix: 'Recompute batch total amount to synchronize with line items.',
      }));
    }

    return this._buildResponse(batch, checklist, issues);
  }

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
    return {
      issue_id: `ISS-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
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
    };
  }

  _buildResponse(batch, checklist, issues) {
    const blockingIssues = issues.filter(i => i.severity === ValidationSeverity.BLOCKING && !i.resolved_at);
    const warningIssues = issues.filter(i => i.severity === ValidationSeverity.WARNING && !i.resolved_at);

    const isGatePassed = blockingIssues.length === 0;

    return {
      batch_id: batch.batch_id || 'UNKNOWN',
      is_gate_passed: isGatePassed,
      can_generate_bank_file: isGatePassed,
      checklist,
      summary: {
        total_checks: checklist.length,
        passed_checks_count: checklist.filter(c => c.isPassed).length,
        failed_checks_count: checklist.filter(c => !c.isPassed).length,
        blocking_issues_count: blockingIssues.length,
        warning_issues_count: warningIssues.length,
      },
      blocking_issues: blockingIssues,
      warnings: warningIssues,
      all_issues: issues,
      evaluated_at: new Date().toISOString(),
    };
  }
}
