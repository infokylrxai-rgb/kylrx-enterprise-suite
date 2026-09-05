/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - EXTERNAL BANK RECONCILIATION PROCESSING ENGINE
 * ============================================================================
 * Module: Bank Settlement Ingestion (CSV / JSON / TXT / XML), 3-Point
 *         Reconciliation Guards, UTR Duplicate Prevention, and Batch State Resolution.
 *
 * Enforces:
 *  1. Multi-Format Ingestion: (txn_id, bank_ref/UTR, employee_id, amount, status, error_code).
 *  2. Three Critical Reconciliation Guards:
 *     - Unmatched payment instruction
 *     - Cleared settlement amount mismatch
 *     - Duplicate external transaction ID or UTR
 *  3. Dynamic Batch State Resolution:
 *     - Progresses batch to 'RECONCILING' during ingestion.
 *     - Advances to 'PAID' on 100% success.
 *     - Resolves to 'PARTIALLY_PAID' on mixed outcomes.
 *     - Resolves to 'FAILED' on 100% failures.
 *  4. Generates discrete remediation tasks for uncredited employees.
 *
 * @version 1.0.0
 * @author Kylrx AI Senior Backend Systems Team
 */

import crypto from 'node:crypto';

export const ReconciliationStatus = Object.freeze({
  RECONCILING: 'RECONCILING',
  PAID: 'PAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  FAILED: 'FAILED',
});

export const ReconciliationExceptionCode = Object.freeze({
  UNMATCHED_INSTRUCTION: 'UNMATCHED_INSTRUCTION',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  DUPLICATE_UTR: 'DUPLICATE_UTR',
  DUPLICATE_TXN_ID: 'DUPLICATE_TXN_ID',
  ACCOUNT_INVALID_OR_BLOCKED: 'ACCOUNT_INVALID_OR_BLOCKED',
  IFSC_BRANCH_NOT_FOUND: 'IFSC_BRANCH_NOT_FOUND',
  NETWORK_TIMEOUT_REVERSED: 'NETWORK_TIMEOUT_REVERSED',
  SETTLEMENT_REJECTED: 'SETTLEMENT_REJECTED',
});

/**
 * External Bank Reconciliation Engine
 */
export class ExternalBankReconciliationEngine {
  constructor(options = {}) {
    this.tolerance = options.tolerance || 0.01;
    this.pastUtrLedger = new Set(options.pastUtrLedger || []); // Historic UTRs
    this.pastTxnIdLedger = new Set(options.pastTxnIdLedger || []); // Historic Txn IDs
  }

  /**
   * Main Processing Entrypoint
   * Ingests bank response, applies 3-Point Reconciliation Guards, resolves batch state,
   * and generates remediation tasks.
   */
  async processBankResponse({
    batch,
    responseFeed,
    feedFormat = 'CSV', // 'CSV' | 'JSON' | 'TXT' | 'XML'
    operatorId = 'RECONCILIATION_ENGINE',
    ledgerStore = null,
  }) {
    if (!batch || !batch.batch_id) {
      throw new Error('Valid PaymentBatch is required for reconciliation processing.');
    }

    // 1. Transition Batch State to RECONCILING during ingestion
    batch.status = ReconciliationStatus.RECONCILING;
    batch.reconciliation_started_at = new Date().toISOString();

    // 2. Parse and Normalize Response Feed
    const rawRows = this._parseFeed(responseFeed, feedFormat);
    if (!rawRows || rawRows.length === 0) {
      throw new Error('No parseable settlement rows found in bank response feed.');
    }

    // 3. Index Batch Instructions by Payment Reference & Employee ID
    const instructions = batch.records || [];
    const instructionsByRef = new Map();
    const instructionsByEmpId = new Map();

    instructions.forEach((rec) => {
      if (rec.payment_reference) instructionsByRef.set(String(rec.payment_reference).trim(), rec);
      if (rec.ref) instructionsByRef.set(String(rec.ref).trim(), rec);
      if (rec.employee_id) instructionsByEmpId.set(String(rec.employee_id).trim(), rec);
      if (rec.id) instructionsByEmpId.set(String(rec.id).trim(), rec);
    });

    // Tracking state for this ingestion run
    const seenBatchUtrs = new Set();
    const seenBatchTxnIds = new Set();

    let matchedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    let exceptionCount = 0;
    let totalSettledAmount = 0;
    let totalFailedAmount = 0;

    const reconciledLineItems = [];
    const reconciliationExceptions = [];
    const remediationTasks = [];

    // 4. Process Each Bank Response Row Through Reconciliation Guards
    for (const row of rawRows) {
      const txnId = String(row.txn_id || row.transaction_id || row.payment_reference || row.ref || '').trim();
      const utr = String(row.bank_ref || row.utr || row.utr_number || '').trim();
      const empId = String(row.employee_id || row.emp_id || row.beneficiary_id || '').trim();
      const clearedAmount = Number(row.amount || 0);
      const rawStatus = String(row.status || '').toUpperCase();
      const errorCode = row.error_code || row.failure_reason || null;

      // ── GUARD 1: Unmatched Payment Instruction Guard ──
      let instruction = null;
      if (txnId && instructionsByRef.has(txnId)) {
        instruction = instructionsByRef.get(txnId);
      } else if (empId && instructionsByEmpId.has(empId)) {
        instruction = instructionsByEmpId.get(empId);
      }

      if (!instruction) {
        exceptionCount++;
        const exc = {
          exception_id: `EXC-UNMATCHED-${crypto.randomUUID().substring(0, 8)}`,
          code: ReconciliationExceptionCode.UNMATCHED_INSTRUCTION,
          txn_id: txnId,
          utr,
          employee_id: empId,
          amount: clearedAmount,
          reason: `Bank response row (Txn: ${txnId || 'N/A'}, Emp: ${empId || 'N/A'}, UTR: ${utr || 'N/A'}) could not be mapped to any active payment instruction in batch '${batch.batch_id}'.`,
          timestamp: new Date().toISOString(),
        };
        reconciliationExceptions.push(exc);
        continue;
      }

      matchedCount++;
      const expectedAmount = Number(instruction.net_payable_amount ?? instruction.net ?? instruction.amount ?? 0);

      // ── GUARD 2: Cleared Settlement Amount Mismatch Guard ──
      const amountDiff = Math.abs(clearedAmount - expectedAmount);
      let isAmountMismatch = false;

      if (clearedAmount > 0 && amountDiff > this.tolerance) {
        isAmountMismatch = true;
        exceptionCount++;
        const exc = {
          exception_id: `EXC-AMT-${crypto.randomUUID().substring(0, 8)}`,
          code: ReconciliationExceptionCode.AMOUNT_MISMATCH,
          employee_id: instruction.employee_id || instruction.id,
          expected_amount: expectedAmount,
          cleared_amount: clearedAmount,
          discrepancy: Math.round((clearedAmount - expectedAmount) * 100) / 100,
          reason: `Settlement amount mismatch for employee ${instruction.employee_id || instruction.id}. Approved Instruction: ₹${expectedAmount}, Cleared Bank Amount: ₹${clearedAmount}.`,
          timestamp: new Date().toISOString(),
        };
        reconciliationExceptions.push(exc);
      }

      // ── GUARD 3: Duplicate UTR & Duplicate Txn ID Guard ──
      let isDuplicateUtr = false;
      if (utr) {
        if (seenBatchUtrs.has(utr) || this.pastUtrLedger.has(utr)) {
          isDuplicateUtr = true;
          exceptionCount++;
          const exc = {
            exception_id: `EXC-DUP-UTR-${crypto.randomUUID().substring(0, 8)}`,
            code: ReconciliationExceptionCode.DUPLICATE_UTR,
            employee_id: instruction.employee_id || instruction.id,
            utr,
            reason: `Duplicate external UTR '${utr}' detected! This UTR was already registered in this batch or previous settlement ledger.`,
            timestamp: new Date().toISOString(),
          };
          reconciliationExceptions.push(exc);
        } else {
          seenBatchUtrs.add(utr);
          this.pastUtrLedger.add(utr);
        }
      }

      let isDuplicateTxnId = false;
      if (txnId) {
        if (seenBatchTxnIds.has(txnId) || this.pastTxnIdLedger.has(txnId)) {
          isDuplicateTxnId = true;
          exceptionCount++;
          const exc = {
            exception_id: `EXC-DUP-TXN-${crypto.randomUUID().substring(0, 8)}`,
            code: ReconciliationExceptionCode.DUPLICATE_TXN_ID,
            employee_id: instruction.employee_id || instruction.id,
            txn_id: txnId,
            reason: `Duplicate external Transaction ID '${txnId}' detected!`,
            timestamp: new Date().toISOString(),
          };
          reconciliationExceptions.push(exc);
        } else {
          seenBatchTxnIds.add(txnId);
          this.pastTxnIdLedger.add(txnId);
        }
      }

      // Determine Line Item Outcome
      const isCleanSuccess = (rawStatus === 'PAID' || rawStatus === 'SUCCESS') &&
                            !isAmountMismatch &&
                            !isDuplicateUtr &&
                            !isDuplicateTxnId;

      if (isCleanSuccess) {
        successCount++;
        totalSettledAmount += expectedAmount;

        instruction.status = 'PAID';
        instruction.bank_utr = utr || `UTR-${Date.now()}`;
        instruction.settled_at = row.timestamp || new Date().toISOString();
        instruction.settlement_error = null;

        reconciledLineItems.push({
          employee_id: instruction.employee_id || instruction.id,
          employee_name: instruction.employee_name || instruction.name,
          amount: expectedAmount,
          status: 'PAID',
          utr: instruction.bank_utr,
          settled_at: instruction.settled_at,
        });
      } else {
        failureCount++;
        totalFailedAmount += expectedAmount;

        const effectiveFailureCode = isAmountMismatch
          ? ReconciliationExceptionCode.AMOUNT_MISMATCH
          : (isDuplicateUtr
            ? ReconciliationExceptionCode.DUPLICATE_UTR
            : (errorCode || ReconciliationExceptionCode.SETTLEMENT_REJECTED));

        const effectiveReason = row.failure_reason || (isAmountMismatch
          ? `Cleared amount ₹${clearedAmount} does not match instruction ₹${expectedAmount}`
          : (isDuplicateUtr
            ? `Duplicate UTR ${utr}`
            : 'Payment returned or rejected by clearing bank network'));

        instruction.status = 'FAILED';
        instruction.bank_utr = utr || null;
        instruction.settlement_error = effectiveReason;
        instruction.failure_code = effectiveFailureCode;

        reconciledLineItems.push({
          employee_id: instruction.employee_id || instruction.id,
          employee_name: instruction.employee_name || instruction.name,
          amount: expectedAmount,
          status: 'FAILED',
          utr,
          failure_code: effectiveFailureCode,
          failure_reason: effectiveReason,
        });

        // Generate Discrete Remediation Task for Uncredited Employee
        const targetEmpId = instruction.employee_id || instruction.id || empId;
        const task = {
          task_id: `TASK-RECON-${crypto.randomUUID().substring(0, 8).toUpperCase()}`,
          batch_id: batch.batch_id,
          employee_id: targetEmpId,
          employee_name: instruction.employee_name || instruction.name || 'Employee',
          uncredited_amount: expectedAmount,
          ifsc_code: instruction.ifsc_code || instruction.ifsc || '--',
          account_number: instruction.account_number || instruction.accountNumber || '--',
          failure_code: effectiveFailureCode,
          failure_reason: effectiveReason,
          suggested_fix: this._getRemediationFixGuidance(effectiveFailureCode, effectiveReason),
          status: 'OPEN_FOR_REMEDIATION',
          created_at: new Date().toISOString(),
        };

        remediationTasks.push(task);
      }
    }

    // 5. Batch State Resolver
    const totalInstructions = instructions.length;
    let finalBatchState = ReconciliationStatus.RECONCILING;

    if (totalInstructions > 0) {
      if (successCount === totalInstructions && failureCount === 0 && exceptionCount === 0) {
        finalBatchState = ReconciliationStatus.PAID;
      } else if (successCount > 0 && (failureCount > 0 || exceptionCount > 0)) {
        finalBatchState = ReconciliationStatus.PARTIALLY_PAID;
      } else if (successCount === 0 && (failureCount > 0 || exceptionCount > 0)) {
        finalBatchState = ReconciliationStatus.FAILED;
      }
    }

    batch.status = finalBatchState;
    batch.reconciliation_completed_at = new Date().toISOString();
    batch.reconciliation_summary = {
      total_instructions: totalInstructions,
      matched_records_count: matchedCount,
      unmatched_records_count: rawRows.length - matchedCount,
      success_count: successCount,
      failure_count: failureCount,
      exception_count: exceptionCount,
      total_settled_amount: Math.round(totalSettledAmount * 100) / 100,
      total_failed_amount: Math.round(totalFailedAmount * 100) / 100,
      final_state: finalBatchState,
    };

    return {
      batch_id: batch.batch_id,
      final_state: finalBatchState,
      reconciliation_summary: batch.reconciliation_summary,
      reconciled_line_items: reconciledLineItems,
      reconciliation_exceptions: reconciliationExceptions,
      remediation_tasks: remediationTasks,
    };
  }

  // ── PARSER IMPLEMENTATIONS ──

  _parseFeed(feed, format) {
    const fmt = String(format || 'CSV').toUpperCase();
    if (typeof feed === 'object' && Array.isArray(feed)) {
      return feed;
    }

    const content = String(feed).trim();
    if (fmt === 'JSON') {
      try {
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : (parsed.records || parsed.transactions || []);
      } catch {
        return [];
      }
    }

    if (fmt === 'XML') {
      return this._parseXmlFeed(content);
    }

    if (fmt === 'TXT') {
      return this._parseDelimitedTxt(content);
    }

    // Standard CSV Parser
    return this._parseCsv(content);
  }

  _parseCsv(csvContent) {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.replace(/["']/g, '').trim().toLowerCase().replace(/[\s-]/g, '_'));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle quoted CSV cells
      const cells = [];
      let inQuote = false;
      let current = '';
      for (let c = 0; c < line.length; c++) {
        const char = line[c];
        if (char === '"') inQuote = !inQuote;
        else if (char === ',' && !inQuote) {
          cells.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current.trim());

      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = cells[idx] ? cells[idx].replace(/^"|"$/g, '').trim() : '';
      });

      rows.push({
        txn_id: rowObj.txn_id || rowObj.transaction_id || rowObj.payment_reference || rowObj.reference || '',
        bank_ref: rowObj.bank_ref || rowObj.utr || rowObj.utr_number || rowObj.bank_reference || '',
        employee_id: rowObj.employee_id || rowObj.emp_id || rowObj.beneficiary_id || '',
        amount: Number(rowObj.amount || rowObj.settled_amount || 0),
        status: (rowObj.status || rowObj.transaction_status || 'PAID').toUpperCase(),
        failure_reason: rowObj.failure_reason || rowObj.error_code || rowObj.remarks || '',
        error_code: rowObj.error_code || rowObj.failure_code || null,
        timestamp: rowObj.payment_date || rowObj.settled_at || rowObj.timestamp || new Date().toISOString(),
      });
    }

    return rows;
  }

  _parseDelimitedTxt(txtContent) {
    const lines = txtContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const rows = [];

    lines.forEach((line) => {
      // Check delimiter (pipe, caret, tab)
      let delimiter = '|';
      if (line.includes('^')) delimiter = '^';
      else if (line.includes('\t')) delimiter = '\t';

      const parts = line.split(delimiter).map((p) => p.trim());
      if (parts.length >= 4) {
        rows.push({
          txn_id: parts[0],
          bank_ref: parts[1],
          employee_id: parts[2],
          amount: Number(parts[3] || 0),
          status: (parts[4] || 'PAID').toUpperCase(),
          failure_reason: parts[5] || '',
        });
      }
    });

    return rows;
  }

  _parseXmlFeed(xmlContent) {
    const rows = [];
    const txMatches = xmlContent.match(/<Transaction>[\s\S]*?<\/Transaction>/gi) || [];

    txMatches.forEach((tx) => {
      const getTag = (tag) => {
        const m = tx.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return m ? m[1].trim() : '';
      };

      rows.push({
        txn_id: getTag('TxnId') || getTag('PaymentReference') || getTag('Reference'),
        bank_ref: getTag('BankRef') || getTag('UTR') || getTag('UtrNumber'),
        employee_id: getTag('EmployeeId') || getTag('EmpId'),
        amount: Number(getTag('Amount') || getTag('SettledAmount') || 0),
        status: (getTag('Status') || 'PAID').toUpperCase(),
        failure_reason: getTag('FailureReason') || getTag('Reason') || '',
        error_code: getTag('ErrorCode') || null,
      });
    });

    return rows;
  }

  _getRemediationFixGuidance(code, reason) {
    switch (code) {
      case ReconciliationExceptionCode.AMOUNT_MISMATCH:
        return 'Verify clearing bank deductions vs gross instruction. Adjust journal or re-issue delta difference.';
      case ReconciliationExceptionCode.DUPLICATE_UTR:
        return 'Investigate duplicate UTR in bank portal ledger. Verify if funds were already credited in separate batch.';
      case ReconciliationExceptionCode.ACCOUNT_INVALID_OR_BLOCKED:
        return 'Request updated active bank account details from employee and re-run bank verification gate.';
      case ReconciliationExceptionCode.IFSC_BRANCH_NOT_FOUND:
        return 'Update merged bank branch IFSC code in employee master record and re-queue.';
      case ReconciliationExceptionCode.NETWORK_TIMEOUT_REVERSED:
        return 'Automatic bank reversal detected. Re-queue payment instruction in next settlement clearing cycle.';
      default:
        return 'Review bank settlement exception logs and execute REOPENED_FOR_RETRY workflow.';
    }
  }
}
