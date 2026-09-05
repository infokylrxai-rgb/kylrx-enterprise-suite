/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - AUTOMATED BANK RECONCILIATION SERVICE
 * ============================================================================
 * Module: Bank Settlement Response Ingestion (CSV / XML / TXT), Transactional
 *         Matching, UTR Binding, Reprocessing Queue Dispatch, and State Terminalization.
 *
 * Supported Response Formats:
 *  1. Bank Standard CSV (txn_id, bank_ref/utr, employee_id, amount, status, failure_reason)
 *  2. XML Bank Settlement Response (ISO 20022 camt.054 / proprietary XML)
 *  3. Tab/Pipe/Caret Delimited TXT
 *
 * @version 2.4.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

export const TransactionStatus = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
  REVERSED: 'REVERSED',
});

export const BatchSettlementStatus = Object.freeze({
  PAID: 'PAID',                           // 100% of lines successfully PAID
  SETTLED: 'SETTLED',                     // Alias for PAID
  PARTIALLY_PAID: 'PARTIALLY_PAID',       // Mixed success and failures
  PARTIALLY_SETTLED: 'PARTIALLY_SETTLED', // Alias for PARTIALLY_PAID
  FAILED: 'FAILED',                       // 100% lines failed or batch rejected
  PROCESSING: 'PROCESSING',               // Partial response received; not all lines terminal
});

export const FailureReasonCode = Object.freeze({
  INVALID_ACCOUNT_NUMBER: 'INVALID_ACCOUNT_NUMBER',
  ACCOUNT_CLOSED_OR_BLOCKED: 'ACCOUNT_CLOSED_OR_BLOCKED',
  BENEFICIARY_NAME_MISMATCH: 'BENEFICIARY_NAME_MISMATCH',
  IFSC_BRANCH_NOT_FOUND: 'IFSC_BRANCH_NOT_FOUND',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  NETWORK_TIMEOUT_REVERSED: 'NETWORK_TIMEOUT_REVERSED',
  OTHER: 'OTHER',
});

/**
 * Automated Bank Reconciliation Service
 */
export class BankReconciliationService {
  constructor(options = {}) {
    this.tolerance = options.tolerance || 0.01;
  }

  /**
   * Main entrypoint: Ingests raw file content, parses records, coordinates
   * transactional matching with PaymentBatch, updates records, and triggers reprocessing queue.
   */
  async processSettlementFile({
    batch,
    fileContent,
    fileFormat = 'CSV', // 'CSV' | 'XML' | 'TXT'
    fileName = 'bank_response.csv',
    operatorId = 'SYSTEM_RECON_BOT',
    storageRepository = null,
  }) {
    if (!batch) {
      throw new Error('PaymentBatch is required for reconciliation');
    }

    if (!fileContent || fileContent.trim().length === 0) {
      throw new Error('Empty bank response file content');
    }

    // 1. Parse File Content based on format
    const parsedRows = this._parseResponseFile(fileContent, fileFormat);
    if (parsedRows.length === 0) {
      throw new Error(`Failed to parse any valid settlement records from ${fileName}`);
    }

    // 2. Build In-Memory Lookup Index from PaymentBatch records
    // Index by: txn_id / payment_reference OR employee_id
    const internalRecords = batch.records || [];
    const internalByRef = new Map();
    const internalByEmpId = new Map();

    for (const rec of internalRecords) {
      if (rec.payment_reference) {
        internalByRef.set(rec.payment_reference.trim(), rec);
      }
      if (rec.employee_id) {
        internalByEmpId.set(rec.employee_id.trim(), rec);
      }
    }

    // 3. Match and Reconcile Line Items
    let matchedCount = 0;
    let unmatchedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    let totalSettledAmount = 0;
    let totalFailedAmount = 0;

    const matchedRecords = [];
    const reprocessingQueueItems = [];
    const unmatchedResponseRows = [];

    for (const row of parsedRows) {
      // Find matching internal record
      let targetRecord = null;
      if (row.txn_id && internalByRef.has(row.txn_id.trim())) {
        targetRecord = internalByRef.get(row.txn_id.trim());
      } else if (row.employee_id && internalByEmpId.has(row.employee_id.trim())) {
        targetRecord = internalByEmpId.get(row.employee_id.trim());
      }

      if (!targetRecord) {
        unmatchedCount++;
        unmatchedResponseRows.push(row);
        continue;
      }

      matchedCount++;

      // Verify amount consistency
      const expectedAmount = Number(targetRecord.net_payable_amount || targetRecord.amount || 0);
      const settledAmount = Number(row.amount || expectedAmount);
      const amountDiff = Math.abs(expectedAmount - settledAmount);

      const isPaid = (row.status === 'PAID' || row.status === 'SUCCESS') && amountDiff <= this.tolerance;

      if (isPaid) {
        successCount++;
        totalSettledAmount += settledAmount;

        targetRecord.status = TransactionStatus.SUCCESS;
        targetRecord.bank_utr = row.bank_ref || row.utr || 'UTR-ACK-' + Date.now();
        targetRecord.failure_reason = null;
        targetRecord.settled_at = row.timestamp || new Date().toISOString();
      } else {
        failureCount++;
        totalFailedAmount += expectedAmount;

        const failureCode = this._categorizeFailure(row.failure_reason || row.status);
        targetRecord.status = TransactionStatus.FAILED;
        targetRecord.bank_utr = row.bank_ref || row.utr || null;
        targetRecord.failure_code = failureCode;
        targetRecord.failure_reason = row.failure_reason || 'Transaction rejected by clearing network';
        targetRecord.settled_at = row.timestamp || new Date().toISOString();

        // Push to automated Reprocessing Queue
        reprocessingQueueItems.push({
          queue_id: `RETRY-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
          batch_id: batch.batch_id,
          employee_id: targetRecord.employee_id,
          employee_name: targetRecord.employee_name,
          net_payable_amount: expectedAmount,
          ifsc_code: targetRecord.ifsc_code,
          account_number_masked: targetRecord.account_number_masked,
          failure_code: failureCode,
          failure_reason: targetRecord.failure_reason,
          suggested_action: this._getSuggestedAction(failureCode),
          created_at: new Date().toISOString(),
          status: 'PENDING_HR_CORRECTION',
        });
      }

      matchedRecords.push(targetRecord);
    }

    // 4. Determine Batch-Level Terminal State
    // Check if ALL records in the batch have reached a terminal state
    const allRecordsCount = internalRecords.length;
    const settledTerminalCount = internalRecords.filter(
      (r) => r.status === TransactionStatus.SUCCESS || r.status === TransactionStatus.FAILED
    ).length;

    const isAllTerminal = settledTerminalCount === allRecordsCount && allRecordsCount > 0;

    let finalBatchStatus = BatchSettlementStatus.PROCESSING;
    if (isAllTerminal) {
      if (failureCount === 0 && successCount === allRecordsCount) {
        finalBatchStatus = BatchSettlementStatus.PAID;
      } else if (successCount > 0 && failureCount > 0) {
        finalBatchStatus = BatchSettlementStatus.PARTIALLY_PAID;
      } else if (successCount === 0 && failureCount === allRecordsCount) {
        finalBatchStatus = BatchSettlementStatus.FAILED;
      }
    }

    batch.status = finalBatchStatus;
    batch.settlement_status = finalBatchStatus;
    batch.settlement_summary = {
      total_records: allRecordsCount,
      matched_records_count: matchedCount,
      unmatched_records_count: unmatchedCount,
      success_count: successCount,
      failure_count: failureCount,
      total_settled_amount: Math.round(totalSettledAmount * 100) / 100,
      total_failed_amount: Math.round(totalFailedAmount * 100) / 100,
      is_terminal: isAllTerminal,
      reconciled_at: new Date().toISOString(),
      reconciled_by: operatorId,
    };

    // 5. Construct Dashboard Exception Alerts
    const exceptionAlerts = reprocessingQueueItems.map((item) => ({
      alert_id: `ALT-${Date.now()}-${item.employee_id}`,
      severity: 'CRITICAL',
      title: `Disbursement Failed: ${item.employee_name} (${item.employee_id})`,
      message: `Bank rejected payout of ₹${item.net_payable_amount}. Return code: ${item.failure_code}. ${item.failure_reason}`,
      suggested_action: item.suggested_action,
      batch_id: batch.batch_id,
      employee_id: item.employee_id,
      created_at: new Date().toISOString(),
    }));

    // 6. Construct BankResponse Manifest Document
    const reconciliationId = `REC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const bankResponseDoc = {
      reconciliation_id: reconciliationId,
      batch_id: batch.batch_id,
      uploaded_file_name: fileName,
      file_format: fileFormat,
      parsed_records_count: parsedRows.length,
      matched_records_count: matchedCount,
      unmatched_records_count: unmatchedCount,
      success_count: successCount,
      failure_count: failureCount,
      total_settled_amount: Math.round(totalSettledAmount * 100) / 100,
      total_failed_amount: Math.round(totalFailedAmount * 100) / 100,
      unmatched_response_rows: unmatchedResponseRows,
      reprocessing_queue_count: reprocessingQueueItems.length,
      exception_alerts_count: exceptionAlerts.length,
      reconciled_by: operatorId,
      created_at: new Date().toISOString(),
    };

    // 7. Persist via Storage Repository if provided
    if (storageRepository) {
      if (storageRepository.saveBankResponse) await storageRepository.saveBankResponse(bankResponseDoc);
      if (storageRepository.savePaymentBatch) await storageRepository.savePaymentBatch(batch);
      if (storageRepository.enqueueReprocessingItems && reprocessingQueueItems.length > 0) {
        await storageRepository.enqueueReprocessingItems(reprocessingQueueItems);
      }
      if (storageRepository.saveExceptionAlerts && exceptionAlerts.length > 0) {
        await storageRepository.saveExceptionAlerts(exceptionAlerts);
      }
    }

    return {
      reconciliation_id: reconciliationId,
      batch_status: finalBatchStatus,
      is_all_terminal: isAllTerminal,
      bank_response: bankResponseDoc,
      payment_batch: batch,
      reprocessing_queue: reprocessingQueueItems,
      exception_alerts: exceptionAlerts,
      unmatched_rows: unmatchedResponseRows,
    };
  }

  // ==========================================================================
  // PARSING ENGINE (CSV, XML, TXT)
  // ==========================================================================

  _parseResponseFile(content, format) {
    const fmt = (format || 'CSV').toUpperCase();
    if (fmt === 'XML') {
      return this._parseXmlResponse(content);
    } else if (fmt === 'TXT' || fmt === 'DELIMITED') {
      return this._parseDelimitedText(content);
    }
    return this._parseCsvResponse(content);
  }

  /**
   * Parses standard Bank Settlement CSV:
   * Header variants supported:
   * txn_id | payment_ref | transaction_id
   * bank_ref | utr | bank_utr
   * employee_id | emp_id | beneficiary_id
   * amount | settled_amount
   * status | txn_status (PAID / SUCCESS / FAILED / REVERSED)
   * failure_reason | return_reason | error_desc
   */
  _parseCsvResponse(content) {
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) return [];

    const headerTokens = lines[0].split(',').map((h) => h.replace(/["\r]/g, '').trim().toLowerCase());
    
    // Map column indices
    const colTxnId = headerTokens.findIndex((h) => h.includes('txn') || h.includes('ref') || h.includes('cust_ref'));
    const colBankRef = headerTokens.findIndex((h) => h.includes('bank_ref') || h.includes('utr') || h.includes('rrn'));
    const colEmpId = headerTokens.findIndex((h) => h.includes('emp') || h.includes('beneficiary'));
    const colAmount = headerTokens.findIndex((h) => h.includes('amount'));
    const colStatus = headerTokens.findIndex((h) => h.includes('status'));
    const colReason = headerTokens.findIndex((h) => h.includes('reason') || h.includes('error') || h.includes('reject') || h.includes('remark') || h.includes('return') || h.includes('code') || h.includes('desc'));

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Split preserving quotes
      const rawCols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim());

      const txnId = colTxnId !== -1 ? rawCols[colTxnId] : '';
      const bankRef = colBankRef !== -1 ? rawCols[colBankRef] : '';
      const empId = colEmpId !== -1 ? rawCols[colEmpId] : '';
      const amount = colAmount !== -1 ? parseFloat(rawCols[colAmount]) : 0;
      const rawStatus = colStatus !== -1 ? (rawCols[colStatus] || '').toUpperCase() : 'SUCCESS';
      const reason = colReason !== -1 ? rawCols[colReason] : '';

      if (txnId || empId || bankRef) {
        rows.push({
          txn_id: txnId,
          bank_ref: bankRef,
          employee_id: empId,
          amount: isNaN(amount) ? 0 : amount,
          status: rawStatus.includes('PAID') || rawStatus.includes('SUCCESS') ? 'PAID' : 'FAILED',
          failure_reason: reason,
        });
      }
    }

    return rows;
  }

  /**
   * Parses XML Settlement / Bank Statement feed (e.g., ISO 20022 or XML Tag format)
   */
  _parseXmlResponse(content) {
    const rows = [];
    const itemRegex = /<(?:Transaction|Record|NtfctnAcctItem)>([\s\S]*?)<\/(?:Transaction|Record|NtfctnAcctItem)>/gi;
    let match;

    while ((match = itemRegex.exec(content)) !== null) {
      const block = match[1];

      const txnId = this._extractXmlTag(block, ['TxnId', 'payment_reference', 'EndToEndId', 'RefNumber']);
      const bankRef = this._extractXmlTag(block, ['BankRef', 'UTR', 'AcctServicerRef', 'bank_utr']);
      const empId = this._extractXmlTag(block, ['EmployeeId', 'EmpId', 'BeneficiaryId']);
      const amountStr = this._extractXmlTag(block, ['Amount', 'Amt', 'SettledAmount']);
      const statusStr = this._extractXmlTag(block, ['Status', 'TxnStatus', 'CdtDbtInd']);
      const reason = this._extractXmlTag(block, ['FailureReason', 'RsnDesc', 'RejectReason']);

      const amount = parseFloat(amountStr || '0');
      const status = (statusStr || '').toUpperCase().includes('FAIL') || (statusStr || '').toUpperCase().includes('RJCT')
        ? 'FAILED'
        : 'PAID';

      rows.push({
        txn_id: txnId,
        bank_ref: bankRef,
        employee_id: empId,
        amount: isNaN(amount) ? 0 : amount,
        status,
        failure_reason: reason,
      });
    }

    return rows;
  }

  _extractXmlTag(block, tags) {
    for (const tag of tags) {
      const rgx = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const match = rgx.exec(block);
      if (match) return match[1].trim();
    }
    return '';
  }

  /**
   * Parses Tab / Pipe Delimited TXT feeds
   */
  _parseDelimitedText(content) {
    const delimiter = content.includes('\t') ? '\t' : '|';
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return [];

    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('HEADER') || line.startsWith('TRAILER')) continue;
      const parts = line.split(delimiter).map((p) => p.trim());
      const offset = parts[0].toUpperCase() === 'DETAIL' ? 1 : 0;
      if (parts.length >= 4 + offset) {
        rows.push({
          txn_id: parts[offset + 0],
          bank_ref: parts[offset + 1],
          employee_id: parts[offset + 2],
          amount: parseFloat(parts[offset + 3]) || 0,
          status: (parts[offset + 4] || 'SUCCESS').toUpperCase().includes('FAIL') ? 'FAILED' : 'PAID',
          failure_reason: parts[offset + 5] || '',
        });
      }
    }
    return rows;
  }

  _categorizeFailure(rawReason = '') {
    const text = String(rawReason).trim().toUpperCase();
    if (FailureReasonCode[text]) {
      return FailureReasonCode[text];
    }
    if (text.includes('CLOSED') || text.includes('BLOCKED') || text.includes('DORMANT')) {
      return FailureReasonCode.ACCOUNT_CLOSED_OR_BLOCKED;
    }
    if (text.includes('NAME') || text.includes('MISMATCH')) {
      return FailureReasonCode.BENEFICIARY_NAME_MISMATCH;
    }
    if (text.includes('ACCOUNT') || text.includes('INVALID') || text.includes('FORMAT')) {
      return FailureReasonCode.INVALID_ACCOUNT_NUMBER;
    }
    if (text.includes('IFSC') || text.includes('BRANCH')) {
      return FailureReasonCode.IFSC_BRANCH_NOT_FOUND;
    }
    if (text.includes('LIMIT') || text.includes('EXCEED')) {
      return FailureReasonCode.LIMIT_EXCEEDED;
    }
    if (text.includes('TIMEOUT') || text.includes('REVERS')) {
      return FailureReasonCode.NETWORK_TIMEOUT_REVERSED;
    }
    return FailureReasonCode.OTHER;
  }

  _getSuggestedAction(code) {
    switch (code) {
      case FailureReasonCode.ACCOUNT_CLOSED_OR_BLOCKED:
        return 'Request updated active salary account details from employee and re-verify.';
      case FailureReasonCode.BENEFICIARY_NAME_MISMATCH:
        return 'Verify beneficiary account title with bank statement or perform penny-drop verification.';
      case FailureReasonCode.IFSC_BRANCH_NOT_FOUND:
        return 'Update IFSC code to current merged bank branch code.';
      case FailureReasonCode.LIMIT_EXCEEDED:
        return 'Split payment across multiple batches or route via RTGS.';
      default:
        return 'Contact bank operations desk with transaction reference.';
    }
  }
}
