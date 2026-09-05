/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - FILE GENERATION & PRE-SUBMISSION PIPELINE
 * ============================================================================
 * Module: Pre-Condition Checks, Financial Drift Guard, Scheme Format Compilers,
 *         Cryptographic SHA-256 Checksumming, and Duplicate Submission Guard.
 *
 * Supported Schemes:
 *  1. SALARY -> Generic NEFT/RTGS CSV Banking File
 *  2. PF -> EPFO Electronic Challan cum Return (ECR) File
 *  3. ESIC -> ESIC Monthly Contribution Return CSV
 *  4. NPS -> NSDL CRA Subscriber Contribution File (SCF)
 *
 * Architectural Guarantees:
 *  - Strict state precondition (Batch must be APPROVED)
 *  - Financial Drift Detection (no gross/deduction/net changes post-approval)
 *  - 0 Unresolved BLOCKING validation issues
 *  - Cryptographic SHA-256 digest on compilation
 *  - Submission Guard against format discrepancies, missing hashes, or duplicate signatures
 *
 * @version 1.0.0
 * @author Kylrx AI Senior Backend Systems Team
 */

import crypto from 'node:crypto';

export class PipelinePreconditionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PipelinePreconditionError';
    this.statusCode = 412;
    this.details = details;
  }
}

export class FinancialDriftError extends Error {
  constructor(message, driftDetails = {}) {
    super(message);
    this.name = 'FinancialDriftError';
    this.statusCode = 409;
    this.driftDetails = driftDetails;
  }
}

export class SubmissionSecurityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SubmissionSecurityError';
    this.statusCode = 400;
    this.details = details;
  }
}

export class DuplicateSubmissionError extends Error {
  constructor(message, signatureDetails = {}) {
    super(message);
    this.name = 'DuplicateSubmissionError';
    this.statusCode = 409;
    this.signatureDetails = signatureDetails;
  }
}

/**
 * Computes Cryptographic SHA-256 Digest
 */
export function computeSha256(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

/**
 * File Generation & Pre-Submission Pipeline
 */
export class FileGenerationSubmissionPipeline {
  constructor(options = {}) {
    this.companyName = options.companyName || 'KYLRX AI TECHNOLOGIES PRIVATE LIMITED';
    this.debitAccountNumber = options.debitAccountNumber || '50200012345678';
    this.submissionLogs = options.submissionLogs || []; // in-memory log store
  }

  /**
   * 1. PRE-CONDITION VERIFICATION
   * Runs before initiating any file compilation.
   */
  static verifyPreCompilationConditions({
    batch,
    currentRecords = [],
    validationIssues = [],
  }) {
    if (!batch) {
      throw new PipelinePreconditionError('Missing batch entity for compilation pre-condition check.');
    }

    // A. Batch State must be strictly APPROVED
    if (batch.status !== 'APPROVED') {
      throw new PipelinePreconditionError(
        `Pre-condition Failed: Batch '${batch.batch_id}' is in state '${batch.status}'. File compilation is only permitted on batches with state strictly 'APPROVED'.`,
        { batch_id: batch.batch_id, current_status: batch.status }
      );
    }

    // B. Zero Unresolved BLOCKING Validation Issues Gate
    const unresolvedBlocking = validationIssues.filter((iss) => {
      const isResolved = iss.resolved === true || Boolean(iss.resolved_at);
      const isBlocking = String(iss.severity || '').toUpperCase() === 'BLOCKING' || String(iss.severity || '').toUpperCase() === 'ERROR';
      return !isResolved && isBlocking;
    });

    if (unresolvedBlocking.length > 0) {
      throw new PipelinePreconditionError(
        `Pre-condition Failed: ${unresolvedBlocking.length} unresolved BLOCKING validation issue(s) detected. File compilation blocked until all issues are remediated.`,
        {
          batch_id: batch.batch_id,
          unresolved_count: unresolvedBlocking.length,
          blocking_issues: unresolvedBlocking.map((i) => i.code || i.id),
        }
      );
    }

    // C. Financial Drift Verification (Gross, Deductions, Net must not have drifted)
    const approvedBaseline = batch.approved_snapshot || batch.summary || {};
    const batchType = String(batch.batch_type || 'SALARY').toUpperCase();

    if (approvedBaseline && (approvedBaseline.total_amount !== undefined || approvedBaseline.net_amount !== undefined)) {
      let currentNetSum = 0;
      let currentGrossSum = 0;
      let currentDedSum = 0;

      if (batchType === 'SALARY') {
        currentNetSum = currentRecords.reduce((sum, r) => {
          let netVal = r.net !== undefined ? Number(r.net) : (
            r.net_payable_amount !== undefined ? Number(r.net_payable_amount) : (
              r.netSalary !== undefined ? Number(r.netSalary) : (
                r.amount !== undefined ? Number(r.amount) : (
                  Number(r.grossSalary ?? r.salary ?? r.gross ?? 0) - Number(r.deductions ?? r.employeeDeductions ?? 0)
                )
              )
            )
          );
          return sum + (isNaN(netVal) ? 0 : netVal);
        }, 0);

        currentGrossSum = currentRecords.reduce((sum, r) => {
          const gross = Number(r.grossSalary ?? r.salary ?? r.gross ?? r.gross_wages ?? 0);
          return sum + (isNaN(gross) ? 0 : gross);
        }, 0);

        currentDedSum = currentRecords.reduce((sum, r) => {
          const ded = Number(r.deductions ?? r.employeeDeductions ?? 0);
          return sum + (isNaN(ded) ? 0 : ded);
        }, 0);
      } else if (batchType === 'PF') {
        currentNetSum = currentRecords.reduce((sum, r) => {
          const gross = Number(r.gross_wages ?? r.grossSalary ?? r.gross ?? 0);
          const epfWages = Math.min(gross, 15000);
          const ee = Math.round(epfWages * 0.12);
          const eps = Math.round(epfWages * 0.0833);
          const erEpf = ee - eps;
          return sum + ee + eps + erEpf;
        }, 0);
      } else if (batchType === 'ESIC') {
        currentNetSum = currentRecords.reduce((sum, r) => {
          const gross = Number(r.gross_wages ?? r.grossSalary ?? r.gross ?? 0);
          const ee = Math.round(gross * 0.0075);
          const er = Math.round(gross * 0.0325);
          return sum + ee + er;
        }, 0);
      } else if (batchType === 'NPS') {
        currentNetSum = currentRecords.reduce((sum, r) => {
          const ee = Number(r.nps_ee_contribution ?? r.ee_contribution ?? 0);
          const er = Number(r.nps_er_contribution ?? r.er_contribution ?? 0);
          return sum + ee + er;
        }, 0);
      } else {
        currentNetSum = currentRecords.reduce((sum, r) => {
          const net = Number(r.net ?? r.net_payable_amount ?? r.amount ?? 0);
          return sum + (isNaN(net) ? 0 : net);
        }, 0);
      }

      const baselineNet = Number(approvedBaseline.total_amount ?? approvedBaseline.net_amount ?? approvedBaseline.net_salary ?? 0);
      const baselineGross = approvedBaseline.gross_payroll !== undefined ? Number(approvedBaseline.gross_payroll) : null;
      const baselineDed = approvedBaseline.employee_deductions !== undefined ? Number(approvedBaseline.employee_deductions) : null;

      const tolerance = 0.01;
      const netDrift = Math.abs(currentNetSum - baselineNet);
      const grossDrift = baselineGross !== null ? Math.abs(currentGrossSum - baselineGross) : 0;
      const dedDrift = baselineDed !== null ? Math.abs(currentDedSum - baselineDed) : 0;

      if (netDrift > tolerance || grossDrift > tolerance || dedDrift > tolerance) {
        throw new FinancialDriftError(
          `Financial Drift Detected: Underlying financial amounts have drifted since checker approval on batch '${batch.batch_id}'. Baseline Net: ₹${baselineNet}, Current Net: ₹${currentNetSum}. Re-approval required.`,
          {
            batch_id: batch.batch_id,
            baseline_net: baselineNet,
            current_net: currentNetSum,
            net_drift: netDrift,
            baseline_gross: baselineGross,
            current_gross: currentGrossSum,
            baseline_deductions: baselineDed,
            current_deductions: currentDedSum,
          }
        );
      }
    }

    return true;
  }

  /**
   * 2. COMPILATION & CHECKSUMMING
   * Produces the target payout file according to scheme rails.
   */
  async compilePayoutFile({
    batch,
    records = [],
    validationIssues = [],
    operatorId = 'PAYROLL_ADMIN',
    payoutDate = new Date().toISOString().split('T')[0],
  }) {
    // 1. Run Pre-condition Checks
    FileGenerationSubmissionPipeline.verifyPreCompilationConditions({
      batch,
      currentRecords: records,
      validationIssues,
    });

    const batchType = String(batch.batch_type || 'SALARY').toUpperCase();
    let content = '';
    let fileExtension = 'csv';
    let mimeType = 'text/csv';
    let totalAmount = 0;

    if (batchType === 'SALARY') {
      const compiled = this._compileSalaryNeftCsv(batch, records, payoutDate);
      content = compiled.content;
      totalAmount = compiled.totalAmount;
      fileExtension = 'csv';
    } else if (batchType === 'PF') {
      const compiled = this._compilePfEcrTxt(batch, records);
      content = compiled.content;
      totalAmount = compiled.totalAmount;
      fileExtension = 'txt';
      mimeType = 'text/plain';
    } else if (batchType === 'ESIC') {
      const compiled = this._compileEsicCsv(batch, records);
      content = compiled.content;
      totalAmount = compiled.totalAmount;
      fileExtension = 'csv';
    } else if (batchType === 'NPS') {
      const compiled = this._compileNpsScfTxt(batch, records);
      content = compiled.content;
      totalAmount = compiled.totalAmount;
      fileExtension = 'txt';
      mimeType = 'text/plain';
    } else {
      // Default to Standard Generic NEFT CSV
      const compiled = this._compileSalaryNeftCsv(batch, records, payoutDate);
      content = compiled.content;
      totalAmount = compiled.totalAmount;
    }

    // Compute Cryptographic SHA-256 Checksum
    const checksum = computeSha256(content);
    const fileId = `FILE-${batch.batch_id}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
    const generatedAt = new Date().toISOString();

    return {
      file_id: fileId,
      batch_id: batch.batch_id,
      batch_type: batchType,
      filename: `KYLRX_${batchType}_DISBURSEMENT_${batch.batch_id}.${fileExtension}`,
      file_extension: fileExtension,
      mime_type: mimeType,
      content,
      record_count: records.length,
      total_amount: Math.round(totalAmount * 100) / 100,
      checksum,
      generated_at: generatedAt,
      generated_by: operatorId,
    };
  }

  /**
   * 3. SUBMISSION GUARD
   * Validates file checksum, structural integrity, and duplicate signature before SUBMITTED state.
   */
  async validateAndExecuteSubmission({
    batch,
    compiledFile,
    requestingUser,
    submissionChannel = 'DIRECT_HOST_TO_HOST',
    pastExecutionLogs = null,
  }) {
    if (!compiledFile || !compiledFile.content) {
      throw new SubmissionSecurityError('Submission Guard Violation: Missing compiled file content.');
    }

    // Guard A: Checksum existence & cryptographic verification
    if (!compiledFile.checksum) {
      throw new SubmissionSecurityError('Submission Guard Violation: Generated file lacks an associated SHA-256 checksum.');
    }

    const liveChecksum = computeSha256(compiledFile.content);
    if (liveChecksum !== compiledFile.checksum) {
      throw new SubmissionSecurityError(
        `Submission Guard Violation: Checksum mismatch! Compiled: ${compiledFile.checksum}, Recomputed: ${liveChecksum}. Potential payload tampering detected.`,
        { compiled_checksum: compiledFile.checksum, computed_checksum: liveChecksum }
      );
    }

    // Guard B: Structural & Format Discrepancy Checks
    if (compiledFile.content.trim().length === 0) {
      throw new SubmissionSecurityError('Submission Guard Violation: File content is completely empty.');
    }

    if (compiledFile.record_count === 0 && compiledFile.total_amount > 0) {
      throw new SubmissionSecurityError('Submission Guard Violation: Record count is 0 but stated amount is greater than 0.');
    }

    // Guard C: Duplicate Submission Signature Check
    const submissionSignature = computeSha256(
      `${batch.batch_id}::${compiledFile.checksum}::${submissionChannel}`
    );

    const logsToCheck = pastExecutionLogs || this.submissionLogs;
    const duplicateLog = logsToCheck.find(
      (log) => log.submission_signature === submissionSignature || (log.batch_id === batch.batch_id && log.checksum === compiledFile.checksum && log.status === 'SUBMITTED')
    );

    if (duplicateLog) {
      throw new DuplicateSubmissionError(
        `Duplicate Submission Detected: Batch '${batch.batch_id}' with checksum '${compiledFile.checksum.substring(0, 12)}...' has already been submitted on channel '${submissionChannel}' at ${duplicateLog.submitted_at}. Duplicate execution rejected.`,
        {
          batch_id: batch.batch_id,
          submission_signature: submissionSignature,
          original_submission_timestamp: duplicateLog.submitted_at,
          original_transaction_ref: duplicateLog.transaction_reference,
        }
      );
    }

    // Generate Submission Audit Record
    const submissionLog = {
      submission_id: `SUB-${crypto.randomUUID()}`,
      batch_id: batch.batch_id,
      batch_type: batch.batch_type,
      submission_signature: submissionSignature,
      checksum: compiledFile.checksum,
      record_count: compiledFile.record_count,
      total_amount: compiledFile.total_amount,
      submission_channel: submissionChannel,
      submitted_by: requestingUser?.user_id || 'OPERATOR',
      submitted_at: new Date().toISOString(),
      status: 'SUBMITTED',
      transaction_reference: `TXN-SUB-${batch.batch_id.replace(/[^A-Z0-9]/gi, '')}-${Date.now()}`,
    };

    if (Array.isArray(this.submissionLogs)) {
      this.submissionLogs.push(submissionLog);
    }

    return {
      success: true,
      new_batch_state: 'SUBMITTED',
      submission_log: submissionLog,
    };
  }

  // ── SCHEME-SPECIFIC COMPILERS ──

  _compileSalaryNeftCsv(batch, records, payoutDate) {
    const header = 'Transaction Reference,Beneficiary Name,Beneficiary Account Number,IFSC Code,Amount,Payment Date,Remarks';
    let totalAmount = 0;
    const lines = [header];

    records.forEach((rec, idx) => {
      let netVal = rec.net !== undefined ? Number(rec.net) : (
        rec.net_payable_amount !== undefined ? Number(rec.net_payable_amount) : (
          rec.netSalary !== undefined ? Number(rec.netSalary) : (
            rec.amount !== undefined ? Number(rec.amount) : (
              Number(rec.grossSalary ?? rec.salary ?? rec.gross ?? 0) - Number(rec.deductions ?? rec.employeeDeductions ?? 0)
            )
          )
        )
      );
      const cleanNet = isNaN(netVal) ? 0 : netVal;
      totalAmount += cleanNet;

      const empId = rec.employee_id || rec.id || `EMP${String(idx + 1).padStart(3, '0')}`;
      const name = String(rec.employee_name || rec.name || 'Employee').replace(/[,"]/g, '').trim();
      const account = String(rec.account_number || rec.accountNumber || '').trim();
      const ifsc = String(rec.ifsc_code || rec.ifsc || '').trim().toUpperCase();
      const ref = rec.payment_reference || `SAL-SEP-${empId.replace(/[^0-9]/g, '') || String(idx + 1).padStart(3, '0')}`;
      const remarks = rec.remarks || 'Salary Payout';

      lines.push(`${ref},"${name}",${account},${ifsc},${cleanNet.toFixed(2)},${payoutDate},"${remarks}"`);
    });

    return { content: lines.join('\n'), totalAmount };
  }

  _compilePfEcrTxt(batch, records) {
    // Standard EPFO ECR Format: UAN#~#MEMBER_NAME#~#GROSS#~#EPF_WAGES#~#EPS_WAGES#~#EDLI_WAGES#~#EE_SHARE#~#EPS_SHARE#~#ER_EPF_SHARE#~#NCP_DAYS#~#ADV_REFUND
    const lines = [];
    let totalAmount = 0;

    records.forEach((rec) => {
      const uan = String(rec.uan || rec.pf_uan || '100900800700').trim();
      const name = String(rec.employee_name || rec.name || 'Staff').replace(/[#~]/g, '').trim();
      const gross = Number(rec.gross_wages || rec.grossSalary || rec.gross || 0);
      const epfWages = Math.min(gross, 15000);
      const epsWages = epfWages;
      const edliWages = epfWages;

      const eeShare = Math.round(epfWages * 0.12);
      const epsShare = Math.round(epsWages * 0.0833);
      const erEpfShare = eeShare - epsShare;
      const ncpDays = rec.ncp_days || 0;
      const advRefund = 0;

      totalAmount += eeShare + epsShare + erEpfShare;

      lines.push(`${uan}#~#${name}#~#${gross}#~#${epfWages}#~#${epsWages}#~#${edliWages}#~#${eeShare}#~#${epsShare}#~#${erEpfShare}#~#${ncpDays}#~#${advRefund}`);
    });

    return { content: lines.join('\n'), totalAmount };
  }

  _compileEsicCsv(batch, records) {
    const header = 'IP Number,IP Name,No of Days for which wages paid,Total Monthly Wages,Reason Code for Zero Working Days,Last Working Day';
    const lines = [header];
    let totalAmount = 0;

    records.forEach((rec) => {
      const ipNo = String(rec.esic_ip_number || rec.ip_number || rec.ipNo || '').trim();
      const name = String(rec.employee_name || rec.name || 'Staff').replace(/[,"]/g, '').trim();
      const gross = Number(rec.gross_wages || rec.grossSalary || rec.gross || 0);
      const days = rec.days_worked !== undefined ? rec.days_worked : 30;
      const reason = days === 0 ? '1' : '';
      const lastDay = rec.last_working_day || '';

      const eeShare = Math.round(gross * 0.0075);
      const erShare = Math.round(gross * 0.0325);
      totalAmount += eeShare + erShare;

      lines.push(`${ipNo},"${name}",${days},${gross.toFixed(2)},${reason},${lastDay}`);
    });

    return { content: lines.join('\n'), totalAmount };
  }

  _compileNpsScfTxt(batch, records) {
    // NSDL CRA Header (FH), Batch Header (BH), Subscriber Detail (SD), File Trailer (FT)
    const lines = [];
    let totalAmount = 0;
    const nowStr = new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14);

    lines.push(`FH^NPS^KYLRX_CORP^${nowStr}^1.0`);
    lines.push(`BH^1^${records.length}^KYLRX_NPS_SEP2026`);

    records.forEach((rec, idx) => {
      const pran = String(rec.pran || rec.nps_pran || '110099887766').trim();
      const name = String(rec.employee_name || rec.name || 'Staff').replace(/[\^]/g, '').trim();
      const eeContr = Number(rec.nps_ee_contribution || rec.ee_contribution || 5000);
      const erContr = Number(rec.nps_er_contribution || rec.er_contribution || 5000);
      const totalContr = eeContr + erContr;
      totalAmount += totalContr;

      lines.push(`SD^${idx + 1}^${pran}^${name}^${eeContr}^${erContr}^${totalContr}`);
    });

    lines.push(`FT^1^${records.length}^${totalAmount}`);
    return { content: lines.join('\n'), totalAmount };
  }
}
