/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - BANK DISBURSEMENT FILE GENERATION ENGINE
 * ============================================================================
 * Module: Configurable NEFT/RTGS Bank File Formatter, Cryptographic SHA-256
 *         Checksums, Account Masking Guard, and Immutable Disbursement Locking.
 *
 * Supported Banking Rails:
 *  1. HDFC E-Net Corporate Banking (CSV format)
 *  2. ICICI Corporate Internet Banking - CIB (CSV/Delimited format)
 *  3. SBI Corporate Multi-Payment - CMP (CSV format)
 *  4. Standard RBI Banking CSV
 *
 * @version 2.4.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

import crypto from 'node:crypto';

export const BankLayout = Object.freeze({
  HDFC_ENET: 'HDFC_ENET',
  ICICI_CIB: 'ICICI_CIB',
  SBI_CMP: 'SBI_CMP',
  STANDARD_CSV: 'STANDARD_CSV',
  STANDARD_TXT: 'STANDARD_TXT',
  GENERIC_NEFT_RTGS_CSV: 'GENERIC_NEFT_RTGS_CSV',
  GENERIC_NEFT_RTGS_TXT: 'GENERIC_NEFT_RTGS_TXT',
});

/**
 * Account Number Masking Utility
 * Masks all digits except the last 4 characters for secure UI rendering.
 * Example: '50100456789012' -> '••••••••••9012'
 */
export function maskAccountNumber(rawAccount, maskChar = '•', visibleEndChars = 4) {
  if (!rawAccount) return '';
  const clean = String(rawAccount).trim();
  if (clean.length <= visibleEndChars) return clean;
  const maskedSection = maskChar.repeat(Math.max(0, clean.length - visibleEndChars));
  const visibleSection = clean.slice(-visibleEndChars);
  return `${maskedSection}${visibleSection}`;
}

/**
 * Computes SHA-256 Hex Digest of string or buffer content.
 */
export function computeSha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Bank Disbursement File Generation Engine
 */
export class BankDisbursementFileEngine {
  constructor(options = {}) {
    this.debitAccountNumber = options.debitAccountNumber || '50200012345678';
    this.companyName = options.companyName || 'KYLRX AI TECHNOLOGIES PRIVATE LIMITED';
  }

  /**
   * Generates bank disbursement file, computes cryptographic checksum,
   * locks PaymentBatch state, and produces immutable disbursement audit log.
   */
  async generateAndLockBankFile({
    batch,
    payrollRun = null,
    bankLayout = BankLayout.GENERIC_NEFT_RTGS_CSV,
    operatorId = 'SYSTEM_AUTO',
    operatorEmail = 'payroll@kylrx.ai',
    ipAddress = '127.0.0.1',
    storageRepository = null,
  }) {
    // 1. Validate Batch Pre-requisites
    if (!batch) {
      throw new Error('PaymentBatch object is required');
    }

    if (batch.status !== 'APPROVED' && batch.status !== 'CHECKER_APPROVED') {
      throw new Error(
        `Cannot generate bank file for batch '${batch.batch_id}' in '${batch.status}' state. Batch must be APPROVED by Checker first.`
      );
    }

    const records = batch.records || [];
    if (records.length === 0) {
      throw new Error(`PaymentBatch '${batch.batch_id}' contains 0 records. Cannot generate empty bank file.`);
    }

    // 2. Format File Content based on Selected Banking Rail
    let fileContent = '';
    let fileExtension = 'csv';
    let fileName = '';
    const dateStamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

    switch (bankLayout) {
      case BankLayout.HDFC_ENET:
        fileContent = this._formatHdfcEnet(batch, records);
        fileName = `HDFC_SALARY_${batch.batch_id}_${dateStamp}.csv`;
        fileExtension = 'csv';
        break;

      case BankLayout.ICICI_CIB:
        fileContent = this._formatIciciCib(batch, records);
        fileName = `ICICI_CIB_SALARY_${batch.batch_id}_${dateStamp}.csv`;
        fileExtension = 'csv';
        break;

      case BankLayout.SBI_CMP:
        fileContent = this._formatSbiCmp(batch, records);
        fileName = `SBI_CMP_SALARY_${batch.batch_id}_${dateStamp}.csv`;
        fileExtension = 'csv';
        break;

      case BankLayout.STANDARD_TXT:
      case BankLayout.GENERIC_NEFT_RTGS_TXT:
        fileContent = this._formatGenericNeftRtgsTxt(batch, records);
        fileName = `BANK_DISBURSEMENT_NEFT_RTGS_${batch.batch_id}_${dateStamp}.txt`;
        fileExtension = 'txt';
        break;

      case BankLayout.GENERIC_NEFT_RTGS_CSV:
      case BankLayout.STANDARD_CSV:
      default:
        fileContent = this._formatGenericNeftRtgsCsv(batch, records);
        fileName = `BANK_DISBURSEMENT_NEFT_RTGS_${batch.batch_id}_${dateStamp}.csv`;
        fileExtension = 'csv';
        break;
    }

    // 3. Compute Cryptographic Checksum & File Metadata
    const checksumSha256 = computeSha256(fileContent);
    const fileSizeBytes = Buffer.byteLength(fileContent, 'utf8');
    const fileId = `BF-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const generationTime = new Date().toISOString();

    const bankFileDoc = {
      file_id: fileId,
      batch_id: batch.batch_id,
      payroll_run_id: batch.payroll_run_id,
      bank_layout: bankLayout,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
      checksum_sha256: checksumSha256,
      record_count: records.length,
      total_disbursed_amount: batch.summary?.total_amount || 0,
      generation_time: generationTime,
      generated_by: {
        user_id: operatorId,
        email: operatorEmail,
        ip_address: ipAddress,
      },
      file_content: fileContent,
      is_locked: true,
    };

    // 4. State Locking of PaymentBatch
    batch.status = 'FILE_GENERATED';
    batch.bank_file_id = fileId;
    batch.bank_layout = bankLayout;
    batch.is_locked = true;
    batch.locked_at = generationTime;
    batch.updated_at = generationTime;

    // Mask records in batch object for safe state serialization/UI sync
    batch.records = records.map((rec) => {
      const raw = rec.account_number_raw || rec.account_number || '';
      return {
        ...rec,
        account_number_masked: maskAccountNumber(raw),
        account_number_raw: undefined, // Strip raw plain text from serialized batch state
      };
    });

    // 5. Lock PayrollRun if provided
    if (payrollRun) {
      payrollRun.status = 'LOCKED';
      payrollRun.locked_at = generationTime;
      payrollRun.updated_at = generationTime;
    }

    // 6. Generate Immutable Audit Log Entry for disbursement_logs
    const logId = `LOG-DISB-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const disbursementLog = {
      log_id: logId,
      timestamp: generationTime,
      batch_id: batch.batch_id,
      payroll_run_id: batch.payroll_run_id,
      bank_file_id: fileId,
      bank_layout: bankLayout,
      file_name: fileName,
      record_count: records.length,
      total_amount: batch.summary?.total_amount || 0,
      checksum_sha256: checksumSha256,
      operator_id: operatorId,
      operator_email: operatorEmail,
      ip_address: ipAddress,
      action: 'BANK_DISBURSEMENT_FILE_GENERATED_AND_LOCKED',
      status: 'SUCCESS',
      is_immutable: true,
    };

    // 7. Persist if Storage Repository supplied
    if (storageRepository) {
      if (storageRepository.saveBankFile) await storageRepository.saveBankFile(bankFileDoc);
      if (storageRepository.savePaymentBatch) await storageRepository.savePaymentBatch(batch);
      if (storageRepository.savePayrollRun && payrollRun) await storageRepository.savePayrollRun(payrollRun);
      if (storageRepository.appendDisbursementLog) await storageRepository.appendDisbursementLog(disbursementLog);
    }

    return {
      bank_file: bankFileDoc,
      payment_batch: batch,
      payroll_run: payrollRun,
      disbursement_log: disbursementLog,
      file_content: fileContent,
    };
  }

  // ==========================================================================
  // BANK LAYOUT FORMATTERS (Memory-only plain data compilation)
  // ==========================================================================

  /**
   * HDFC E-Net Corporate Layout:
   * Columns: Transaction Type, Beneficiary Account No, Amount, Beneficiary Name,
   *          Client Reference No, IFSC Code, Debit Account No, Value Date, Email
   */
  _formatHdfcEnet(batch, records) {
    const headers = [
      'Transaction Type',
      'Beneficiary Account Number',
      'Amount',
      'Beneficiary Name',
      'Client Reference Number',
      'IFSC Code',
      'Debit Account Number',
      'Value Date',
      'Beneficiary Email',
    ];

    const todayDate = new Date().toISOString().slice(0, 10).split('-').reverse().join('/'); // DD/MM/YYYY

    const rows = records.map((r, index) => {
      const amount = Number(r.net_payable_amount || r.amount || 0);
      const paymentRail = amount >= 200000 ? 'R' : 'N'; // R = RTGS, N = NEFT
      const rawAccount = r.account_number_raw || r.account_number || '';
      const ref = r.payment_reference || `KYLRX-${batch.batch_id}-${index + 1}`;
      const ifsc = (r.ifsc_code || '').trim().toUpperCase();
      const name = (r.employee_name || '').replace(/[,"]/g, '').trim();
      const email = r.email || '';

      return [
        paymentRail,
        `"${rawAccount}"`,
        amount.toFixed(2),
        `"${name}"`,
        `"${ref}"`,
        ifsc,
        `"${this.debitAccountNumber}"`,
        todayDate,
        `"${email}"`,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\r\n');
  }

  /**
   * ICICI CIB (Corporate Internet Banking) Layout:
   * Columns: Payment Mode, Debit Account Number, Beneficiary Account Number,
   *          Beneficiary Name, Amount, Currency, IFSC Code, Customer Reference Number, Remarks
   */
  _formatIciciCib(batch, records) {
    const headers = [
      'Payment Mode',
      'Debit Account Number',
      'Beneficiary Account Number',
      'Beneficiary Name',
      'Amount',
      'Currency',
      'IFSC Code',
      'Customer Reference Number',
      'Remarks',
    ];

    const rows = records.map((r, index) => {
      const amount = Number(r.net_payable_amount || r.amount || 0);
      const paymentMode = amount >= 200000 ? 'RTGS' : 'NEFT';
      const rawAccount = r.account_number_raw || r.account_number || '';
      const ref = r.payment_reference || `ICICI-SAL-${batch.batch_id}-${index + 1}`;
      const ifsc = (r.ifsc_code || '').trim().toUpperCase();
      const name = (r.employee_name || '').replace(/[,"]/g, '').trim();
      const remarks = `Salary ${batch.batch_name || batch.batch_id}`.slice(0, 30);

      return [
        paymentMode,
        `"${this.debitAccountNumber}"`,
        `"${rawAccount}"`,
        `"${name}"`,
        amount.toFixed(2),
        'INR',
        ifsc,
        `"${ref}"`,
        `"${remarks}"`,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\r\n');
  }

  /**
   * SBI CMP (Corporate Multi-Payment) Layout:
   * Columns: Transaction Type, Debit Account, Beneficiary Name, Account Number,
   *          Amount, IFSC, Client Reference, Beneficiary Mobile/Email
   */
  _formatSbiCmp(batch, records) {
    const headers = [
      'Txn Type',
      'Debit Account No',
      'Beneficiary Name',
      'Beneficiary Account No',
      'Amount',
      'IFSC Code',
      'Payment Reference',
      'Email ID',
    ];

    const rows = records.map((r, index) => {
      const amount = Number(r.net_payable_amount || r.amount || 0);
      const txnType = amount >= 200000 ? 'RTGS' : 'NEFT';
      const rawAccount = r.account_number_raw || r.account_number || '';
      const ref = r.payment_reference || `SBI-CMP-${batch.batch_id}-${index + 1}`;
      const ifsc = (r.ifsc_code || '').trim().toUpperCase();
      const name = (r.employee_name || '').replace(/[,"]/g, '').trim();
      const email = r.email || '';

      return [
        txnType,
        `"${this.debitAccountNumber}"`,
        `"${name}"`,
        `"${rawAccount}"`,
        amount.toFixed(2),
        ifsc,
        `"${ref}"`,
        `"${email}"`,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\r\n');
  }

  /**
   * Standard RBI Banking CSV Layout:
   * Columns: Beneficiary Name, Account Number, IFSC Code, Amount, Payment Reference, Remarks
   */
  _formatStandardCsv(batch, records) {
    const headers = [
      'Beneficiary Name',
      'Account Number',
      'IFSC Code',
      'Amount',
      'Payment Reference',
      'Remarks',
    ];

    const rows = records.map((r, index) => {
      const amount = Number(r.net_payable_amount || r.amount || 0);
      const rawAccount = r.account_number_raw || r.account_number || '';
      const ref = r.payment_reference || `KYLRX-${batch.batch_id}-${index + 1}`;
      const ifsc = (r.ifsc_code || '').trim().toUpperCase();
      const name = (r.employee_name || '').replace(/[,"]/g, '').trim();
      const remarks = `Salary Disbursement ${batch.batch_id}`;

      return [
        `"${name}"`,
        `"${rawAccount}"`,
        ifsc,
        amount.toFixed(2),
        `"${ref}"`,
        `"${remarks}"`,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\r\n');
  }

  /**
   * Generic NEFT / RTGS Standard Banking CSV Layout:
   * Header: Payment Mode,Debit Account,Beneficiary Name,Beneficiary Account Number,IFSC Code,Amount,Currency,Payment Reference,Payment Date,Remarks
   */
  _formatGenericNeftRtgsCsv(batch, records) {
    const headers = [
      'Payment Mode',
      'Debit Account Number',
      'Beneficiary Name',
      'Beneficiary Account Number',
      'IFSC Code',
      'Amount',
      'Currency',
      'Payment Reference',
      'Payment Date',
      'Remarks',
    ];

    const todayIso = new Date().toISOString().slice(0, 10);

    const rows = records.map((r, index) => {
      const amount = Number(r.net_payable_amount || r.amount || 0);
      const paymentMode = amount >= 200000 ? 'RTGS' : 'NEFT';
      const rawAccount = r.account_number_raw || r.account_number || '';
      const ref = r.payment_reference || `KYLRX-${batch.batch_id}-${index + 1}`;
      const ifsc = (r.ifsc_code || '').trim().toUpperCase();
      const name = (r.employee_name || '').replace(/[,"]/g, '').trim();
      const remarks = `Salary Payout ${batch.batch_id}`;

      return [
        paymentMode,
        `"${this.debitAccountNumber}"`,
        `"${name}"`,
        `"${rawAccount}"`,
        ifsc,
        amount.toFixed(2),
        'INR',
        `"${ref}"`,
        todayIso,
        `"${remarks}"`,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\r\n');
  }

  /**
   * Generic NEFT / RTGS Standard Pipe-Delimited Bank Clearance TXT Layout:
   * Columns: RECORD_TYPE|PAYMENT_MODE|DEBIT_ACC|BENEFICIARY_NAME|BENEFICIARY_ACC|IFSC|AMOUNT|CURRENCY|PAYMENT_REF|VALUE_DATE|REMARKS
   */
  _formatGenericNeftRtgsTxt(batch, records) {
    const headerLine = 'HEADER|KYLRX_AI_HRMS|NEFT_RTGS_BATCH|' + batch.batch_id + '|' + records.length;
    const todayFormatted = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const detailLines = records.map((r, index) => {
      const amount = Number(r.net_payable_amount || r.amount || 0);
      const paymentMode = amount >= 200000 ? 'RTGS' : 'NEFT';
      const rawAccount = r.account_number_raw || r.account_number || '';
      const ref = r.payment_reference || `KYLRX-${batch.batch_id}-${index + 1}`;
      const ifsc = (r.ifsc_code || '').trim().toUpperCase();
      const name = (r.employee_name || '').replace(/[|"]/g, '').trim();
      const remarks = `Salary Payout ${batch.batch_id}`.replace(/[|"]/g, '');

      return [
        'DETAIL',
        paymentMode,
        this.debitAccountNumber,
        name,
        rawAccount,
        ifsc,
        amount.toFixed(2),
        'INR',
        ref,
        todayFormatted,
        remarks,
      ].join('|');
    });

    const totalAmount = records.reduce((sum, r) => sum + Number(r.net_payable_amount || r.amount || 0), 0);
    const trailerLine = `TRAILER|${records.length}|${totalAmount.toFixed(2)}`;

    return [headerLine, ...detailLines, trailerLine].join('\r\n');
  }
}

