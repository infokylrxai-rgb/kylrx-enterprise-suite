/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - GRATUITY SETTLEMENT, STATEMENTS & APPROVAL WORKFLOW
 * ============================================================================
 * Features:
 *  1. Employee Gratuity Statement Generator (HTML/PDF-ready layout)
 *  2. Statutory Form I Notice Generator (Payment of Gratuity Central Rules, 1972)
 *  3. 4-Eyes Maker-Checker Approval Gate (Prevention of self-approval: maker_id !== checker_id)
 *  4. Automated Posting to Final Settlement (F&F) Batch
 *  5. Corporate Gratuity Liability Ledger Entry Generation (GL-2200 Debit, GL-1100 Credit)
 *
 * @version 3.4.0
 * @author Kylrx AI Lead Systems Architect & Principal Backend Engineer
 */

import crypto from 'node:crypto';

/**
 * Custom Error for Maker-Checker 4-Eyes Segregation of Duties Violations.
 */
export class MakerCheckerSecurityViolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MakerCheckerSecurityViolationError';
    this.statusCode = 403;
    this.details = details;
    this.makerId = details.makerId;
    this.checkerId = details.checkerId;
  }
}

/**
 * In-memory stores for Gratuity settlements, ledgers, and F&F entries.
 */
export const inMemoryGratuitySettlements = new Map();
export const inMemoryGratuityLedgers = new Map();
export const inMemoryGratuityFnFBatches = new Map();

/**
 * Clears in-memory stores for test isolation.
 */
export function resetGratuityWorkflowStores() {
  inMemoryGratuitySettlements.clear();
  inMemoryGratuityLedgers.clear();
  inMemoryGratuityFnFBatches.clear();
}

/**
 * Formats a currency number into Indian Rupee format (e.g. ₹1,50,000).
 *
 * @param {number} num
 * @returns {string}
 */
export function formatINR(num) {
  const val = Number(num) || 0;
  return `₹${val.toLocaleString('en-IN')}`;
}

/**
 * Generates an employee-facing Gratuity Settlement Breakdown Statement (HTML).
 *
 * @param {Object} settlement - GratuityCalculationResult
 * @param {Object} employeeProfile - EmployeeGratuityProfile / master details
 * @param {Object} [employerDetails={}] - Employer details
 * @returns {string} Responsive HTML statement
 */
export function renderEmployeeGratuityStatement(
  settlement,
  employeeProfile = {},
  employerDetails = {}
) {
  const companyName = employerDetails.company_name || 'KYLRX AI ENTERPRISE HRMS';
  const companyAddress = employerDetails.address || 'Corporate Headquarters, Bengaluru, Karnataka - 560103';
  const refId = settlement.employee_id ? `GRAT-STMT-${settlement.employee_id}-${Date.now().toString().slice(-4)}` : `GRAT-STMT-${Date.now()}`;

  const nomineeRows = (settlement.nominee_allocations || []).map((nom) => `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${nom.nominee_name}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${nom.relationship}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${nom.share_percentage}%</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: #0f172a;">${formatINR(nom.allocated_amount)}</td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="4" style="padding: 12px; text-align: center; color: #64748b; font-style: italic;">No nominee declaration on record; payout to employee/legal heir account.</td>
    </tr>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Gratuity Settlement Statement - ${settlement.employee_id}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; margin: 0; padding: 24px; background: #f8fafc; }
    .card { background: #ffffff; max-width: 850px; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden; }
    .header { background: #0f172a; color: #ffffff; padding: 28px 32px; border-bottom: 3px solid #3b82f6; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
    .header p { margin: 4px 0 0 0; font-size: 13px; color: #94a3b8; }
    .content { padding: 32px; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
    .meta-box { background: #f1f5f9; padding: 14px 16px; border-radius: 8px; font-size: 13px; }
    .meta-box span { color: #64748b; display: block; font-size: 11px; text-transform: uppercase; font-weight: 600; margin-bottom: 2px; }
    .meta-box strong { color: #0f172a; font-size: 14px; }
    .section-title { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; margin: 24px 0 12px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
    .table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
    .table th { background: #f8fafc; color: #475569; font-weight: 600; text-align: left; padding: 10px 12px; border-bottom: 2px solid #cbd5e1; }
    .summary-card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin-top: 24px; }
    .summary-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .summary-row.total { border-top: 2px solid #93c5fd; padding-top: 12px; margin-top: 8px; font-size: 16px; font-weight: 700; color: #1e3a8a; }
    .footer { padding: 24px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${companyName}</h1>
      <p>${companyAddress} | Statutory Gratuity Statement</p>
      <div style="margin-top: 12px; font-size: 12px; color: #38bdf8;">Reference ID: ${refId} | Date: ${new Date().toLocaleDateString('en-IN')}</div>
    </div>

    <div class="content">
      <div class="meta-grid">
        <div class="meta-box">
          <span>Employee Name & ID</span>
          <strong>${employeeProfile.employee_name || employeeProfile.name || settlement.employee_id} (${settlement.employee_id})</strong>
        </div>
        <div class="meta-box">
          <span>Department & Designation</span>
          <strong>${employeeProfile.department || 'Operations'} / ${employeeProfile.designation || 'Staff'}</strong>
        </div>
        <div class="meta-box">
          <span>Service Timeline</span>
          <strong>${settlement.date_of_joining} to ${settlement.date_of_exit} (${settlement.exit_reason})</strong>
        </div>
        <div class="meta-box">
          <span>Calculated Tenure</span>
          <strong>${settlement.tenure_days} Continuous Days (~${settlement.tenure_years_statutory} Statutory Years)</strong>
        </div>
      </div>

      <div class="section-title">1. Salary Basis & Policy Details</div>
      <table class="table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Value</th>
            <th>Formula / Rule Applied</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">Last Drawn Basic + DA</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${formatINR(settlement.last_drawn_wages)}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Basic: ${formatINR(employeeProfile.last_drawn_basic || settlement.last_drawn_wages)}, DA: ${formatINR(employeeProfile.last_drawn_da || 0)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">Statutory Formula</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">15 / 26 Multiplier</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">(Wages &times; 15 &times; ${settlement.tenure_years_statutory} Years) / 26</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">Vesting & Policy Config</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: ${settlement.is_vested ? '#16a34a' : '#dc2626'};">${settlement.is_vested ? 'VESTED' : 'UNVESTED'}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Policy ${settlement.policy_config_id} ${settlement.vesting_bypass_reason ? `(${settlement.vesting_bypass_reason})` : ''}</td>
          </tr>
        </tbody>
      </table>

      <div class="section-title">2. Taxability & Disbursement Summary</div>
      <div class="summary-card">
        <div class="summary-row">
          <span>Gross Computed Gratuity</span>
          <strong>${formatINR(settlement.raw_gratuity_amount)}</strong>
        </div>
        <div class="summary-row">
          <span>Statutory Tax-Free Limit (Section 10(10))</span>
          <strong>₹20,00,000</strong>
        </div>
        <div class="summary-row">
          <span>Tax-Exempt Portion</span>
          <strong style="color: #16a34a;">${formatINR(settlement.statutory_tax_free_amount)}</strong>
        </div>
        <div class="summary-row">
          <span>Taxable Excess Portion</span>
          <strong style="color: ${settlement.taxable_excess_amount > 0 ? '#ea580c' : '#64748b'};">${formatINR(settlement.taxable_excess_amount)}</strong>
        </div>
        <div class="summary-row total">
          <span>Total Net Payable Gratuity</span>
          <span>${formatINR(settlement.payable_gratuity_amount)}</span>
        </div>
      </div>

      <div class="section-title">3. Nominee Disbursement Schedule</div>
      <table class="table">
        <thead>
          <tr>
            <th>Nominee / Beneficiary</th>
            <th>Relationship</th>
            <th style="text-align: center;">Share (%)</th>
            <th style="text-align: right;">Payable Amount</th>
          </tr>
        </thead>
        <tbody>
          ${nomineeRows}
        </tbody>
      </table>
    </div>

    <div class="footer">
      This statement is electronically generated by the Kylrx AI Statutory Compliance Engine and is valid subject to Maker-Checker approval and final settlement verification.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates statutory Form I (Notice of Claim for Gratuity by an Employee)
 * under sub-rule (1) of Rule 7 of Payment of Gratuity (Central) Rules, 1972.
 *
 * @param {Object} settlement - GratuityCalculationResult
 * @param {Object} employeeProfile - EmployeeGratuityProfile
 * @param {Object} [employerDetails={}] - Employer metadata
 * @returns {string} HTML / printable notice
 */
export function renderFormINotice(
  settlement,
  employeeProfile = {},
  employerDetails = {}
) {
  const companyName = employerDetails.company_name || 'KYLRX AI ENTERPRISE HRMS';
  const companyAddress = employerDetails.address || 'Bengaluru, Karnataka';
  const employeeName = employeeProfile.employee_name || employeeProfile.name || `Employee ${settlement.employee_id}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FORM I - Notice of Claim for Gratuity</title>
  <style>
    body { font-family: 'Times New Roman', Times, serif; color: #000; line-height: 1.6; margin: 0; padding: 40px; }
    .form-container { max-width: 800px; margin: 0 auto; }
    .title-block { text-align: center; margin-bottom: 24px; }
    .title-block h2 { margin: 0; font-size: 18px; text-transform: uppercase; font-weight: bold; }
    .title-block h3 { margin: 4px 0 0 0; font-size: 14px; font-weight: normal; }
    .title-block p { margin: 4px 0 0 0; font-size: 13px; font-style: italic; }
    .recipient { margin-bottom: 20px; }
    .item-list { list-style: none; padding-left: 0; }
    .item-list li { margin-bottom: 12px; display: flex; align-items: baseline; }
    .item-label { width: 320px; font-weight: bold; flex-shrink: 0; }
    .item-dots { border-bottom: 1px dotted #000; flex-grow: 1; margin-left: 8px; font-weight: normal; }
    .footer-signatures { margin-top: 40px; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="form-container">
    <div class="title-block">
      <h2>FORM 'I'</h2>
      <h3>[See sub-rule (1) of Rule 7]</h3>
      <p>Application for Gratuity by an Employee</p>
    </div>

    <div class="recipient">
      To,<br>
      <strong>The Employer / Management,</strong><br>
      ${companyName}<br>
      ${companyAddress}
    </div>

    <p>Sir/Madam,</p>
    <p>I beg to apply for payment of gratuity to which I am entitled under sub-section (1) of section 4 of the Payment of Gratuity Act, 1972 on account of my superannuation/resignation/disablement/termination after completion of continuous service.</p>

    <ul class="item-list">
      <li>
        <span class="item-label">1. Name in full of applicant:</span>
        <span class="item-dots">${employeeName}</span>
      </li>
      <li>
        <span class="item-label">2. Employee ID / Token No:</span>
        <span class="item-dots">${settlement.employee_id}</span>
      </li>
      <li>
        <span class="item-label">3. Department / Branch / Section:</span>
        <span class="item-dots">${employeeProfile.department || 'Operations'}</span>
      </li>
      <li>
        <span class="item-label">4. Post held:</span>
        <span class="item-dots">${employeeProfile.designation || 'Permanent Staff'}</span>
      </li>
      <li>
        <span class="item-label">5. Date of appointment:</span>
        <span class="item-dots">${settlement.date_of_joining}</span>
      </li>
      <li>
        <span class="item-label">6. Date and cause of termination of service:</span>
        <span class="item-dots">${settlement.date_of_exit} (${settlement.exit_reason})</span>
      </li>
      <li>
        <span class="item-label">7. Total period of continuous service:</span>
        <span class="item-dots">${settlement.tenure_days} days (~${settlement.tenure_years_statutory} completed years)</span>
      </li>
      <li>
        <span class="item-label">8. Amount of wages last drawn (Basic + DA):</span>
        <span class="item-dots">${formatINR(settlement.last_drawn_wages)} per month</span>
      </li>
      <li>
        <span class="item-label">9. Amount of gratuity claimed:</span>
        <span class="item-dots"><strong>${formatINR(settlement.payable_gratuity_amount)}</strong></span>
      </li>
    </ul>

    <p style="margin-top: 24px;">I was not an employee of a seasonal establishment. It is requested that the amount of gratuity may be paid to me through Bank Transfer / F&F settlement batch.</p>

    <div class="footer-signatures">
      <div>
        Place: Bengaluru<br>
        Date: ${new Date().toLocaleDateString('en-IN')}
      </div>
      <div style="text-align: right;">
        Yours faithfully,<br><br><br>
        _______________________________<br>
        Signature / Thumb impression of applicant
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Service to orchestrate Maker-Checker approvals, F&F batch posting,
 * and corporate Gratuity liability ledger generation.
 */
export class GratuitySettlementWorkflowService {
  constructor(options = {}) {
    this.settlementsStore = options.settlementsStore || inMemoryGratuitySettlements;
    this.ledgersStore = options.ledgersStore || inMemoryGratuityLedgers;
    this.fnfBatchesStore = options.fnfBatchesStore || inMemoryGratuityFnFBatches;
  }

  /**
   * Stage 1: Maker submits calculated settlement to PENDING_GRATUITY_APPROVAL.
   *
   * @param {Object} params
   * @param {string} params.batch_id
   * @param {Object} params.settlement - GratuityCalculationResult
   * @param {Object} params.employee_profile - Employee master profile
   * @param {string} params.maker_id - User ID of executing Maker
   * @param {string} [params.maker_name] - Name of Maker
   * @returns {Object} GratuitySettlementRecord
   */
  async submitForApproval({
    batch_id,
    settlement,
    employee_profile = {},
    maker_id,
    maker_name = 'Maker Admin',
  }) {
    if (!settlement || !settlement.employee_id) {
      throw new Error('Valid gratuity settlement is required for approval submission.');
    }
    if (!maker_id) {
      throw new Error('maker_id is required to submit settlement for approval.');
    }

    const settlementId = `grat_set_${settlement.employee_id}_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const record = {
      settlement_id: settlementId,
      batch_id: batch_id || `GRAT_BATCH_${Date.now()}`,
      employee_id: settlement.employee_id,
      employee_name: employee_profile.employee_name || employee_profile.name || `Employee ${settlement.employee_id}`,
      department: employee_profile.department,
      designation: employee_profile.designation,
      settlement_details: settlement,
      status: 'PENDING_GRATUITY_APPROVAL',
      maker_id: String(maker_id).trim(),
      maker_name,
      maker_timestamp: timestamp,
      checker_id: null,
      checker_name: null,
      checker_timestamp: null,
      checker_notes: null,
      fnf_batch_id: null,
      ledger_entry_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    this.settlementsStore.set(settlementId, record);
    return record;
  }

  /**
   * Stage 2: Independent Checker approves settlement.
   * 4-Eyes Rule: Rejects if maker_id === checker_id.
   * On approval:
   *  1. Posts finalized payable amount to Final Settlement (F&F) batch.
   *  2. Generates corporate liability ledger entry in gratuity_provision_ledgers.
   *
   * @param {Object} params
   * @param {string} params.settlement_id
   * @param {string} params.checker_id
   * @param {string} [params.checker_name='Checker Admin']
   * @param {string} [params.notes='']
   * @param {string} [params.fnf_batch_id]
   * @returns {Object} { settlement_record, fnf_entry, ledger_entry }
   */
  async approveGratuitySettlement({
    settlement_id,
    checker_id,
    checker_name = 'Checker Admin',
    notes = 'Gratuity calculation verified and approved for F&F disbursement',
    fnf_batch_id,
  }) {
    if (!settlement_id) {
      throw new Error('settlement_id is required for approval.');
    }
    if (!checker_id) {
      throw new Error('checker_id is required for approval.');
    }

    const record = this.settlementsStore.get(settlement_id);
    if (!record) {
      throw new Error(`Gratuity settlement record '${settlement_id}' not found.`);
    }

    if (record.status !== 'PENDING_GRATUITY_APPROVAL') {
      throw new Error(`Cannot approve settlement with status '${record.status}'. Expected 'PENDING_GRATUITY_APPROVAL'.`);
    }

    // 4-Eyes Segregation of Duties Check
    const normalizedMakerId = String(record.maker_id).trim().toLowerCase();
    const normalizedCheckerId = String(checker_id).trim().toLowerCase();

    if (normalizedMakerId === normalizedCheckerId) {
      throw new MakerCheckerSecurityViolationError(
        `403 Forbidden: Maker-Checker Security Violation. Admin '${checker_id}' submitted this gratuity settlement (maker_id: '${record.maker_id}') and cannot self-approve. An independent authorized checker is required.`,
        { makerId: record.maker_id, checkerId: checker_id }
      );
    }

    const timestamp = new Date().toISOString();
    const payableAmount = record.settlement_details.payable_gratuity_amount || 0;
    const taxExempt = record.settlement_details.statutory_tax_free_amount || 0;
    const taxable = record.settlement_details.taxable_excess_amount || 0;

    // 1. Post to Final Settlement (F&F) Batch
    const finalFnFBatchId = fnf_batch_id || `FNF_BATCH_${record.batch_id}`;
    const fnfEntryId = `fnf_grat_${record.employee_id}_${Date.now()}`;

    const fnfEntry = {
      fnf_entry_id: fnfEntryId,
      fnf_batch_id: finalFnFBatchId,
      settlement_id: record.settlement_id,
      employee_id: record.employee_id,
      employee_name: record.employee_name,
      disbursement_category: 'STATUTORY_GRATUITY',
      payable_amount: payableAmount,
      tax_exempt_amount: taxExempt,
      taxable_amount: taxable,
      status: 'QUEUED_FOR_DISBURSEMENT',
      queued_at: timestamp,
      approved_by: checker_id,
    };

    let batchList = this.fnfBatchesStore.get(finalFnFBatchId) || [];
    batchList.push(fnfEntry);
    this.fnfBatchesStore.set(finalFnFBatchId, batchList);

    // 2. Post Corporate Gratuity Liability Ledger Entry
    const ledgerEntryId = `ledg_grat_${record.employee_id}_${Date.now()}`;
    const ledgerEntry = {
      ledger_id: ledgerEntryId,
      settlement_id: record.settlement_id,
      employee_id: record.employee_id,
      employee_name: record.employee_name,
      transaction_type: 'GRATUITY_SETTLEMENT_RELEASE',
      amount: payableAmount,
      tax_exempt_amount: taxExempt,
      taxable_amount: taxable,
      debit_account: 'GL-2200 - Provision for Gratuity (Balance Sheet)',
      credit_account: 'GL-1100 - Bank / Payroll Clearing Account (F&F Disbursement)',
      excess_pnl_debit_account: 'GL-6100 - Gratuity Expense (P&L)',
      status: 'POSTED',
      approved_by: checker_id,
      posted_at: timestamp,
    };

    this.ledgersStore.set(ledgerEntryId, ledgerEntry);

    // 3. Advance Settlement State
    record.status = 'POSTED_TO_FNF';
    record.checker_id = String(checker_id).trim();
    record.checker_name = checker_name;
    record.checker_timestamp = timestamp;
    record.checker_notes = notes;
    record.fnf_batch_id = finalFnFBatchId;
    record.ledger_entry_id = ledgerEntryId;
    record.updated_at = timestamp;

    this.settlementsStore.set(settlement_id, record);

    return {
      success: true,
      settlement_record: record,
      fnf_entry: fnfEntry,
      ledger_entry: ledgerEntry,
    };
  }

  /**
   * Rejects a submitted gratuity settlement.
   *
   * @param {Object} params
   * @param {string} params.settlement_id
   * @param {string} params.checker_id
   * @param {string} params.reason
   * @returns {Object} GratuitySettlementRecord
   */
  async rejectGratuitySettlement({
    settlement_id,
    checker_id,
    checker_name = 'Checker Admin',
    reason = 'Rejected for recalculation',
  }) {
    const record = this.settlementsStore.get(settlement_id);
    if (!record) {
      throw new Error(`Gratuity settlement record '${settlement_id}' not found.`);
    }

    const timestamp = new Date().toISOString();
    record.status = 'REJECTED';
    record.checker_id = checker_id;
    record.checker_name = checker_name;
    record.checker_timestamp = timestamp;
    record.checker_notes = reason;
    record.updated_at = timestamp;

    this.settlementsStore.set(settlement_id, record);
    return record;
  }
}
