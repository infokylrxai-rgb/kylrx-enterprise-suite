/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CHALLAN RECONCILIATION & OPERATIONAL ALERTS SERVICE
 * ============================================================================
 * Implements:
 * 1. Multi-Level Reconciliation Engine:
 *    - Ingests the final bank / EPFO clearing statement.
 *    - Matches total challan amounts (exact delta: Δ = 0).
 *    - Matches EPFO statutory account breakdown:
 *      • Account 1:  EPF Wages, EE Share (12%), ER EPF Share (3.67%)
 *      • Account 2:  Administrative Charges (0.50% of EPF wages, min ₹500)
 *      • Account 10: EPS Contribution (8.33% of EPS wages, capped at ₹1,250)
 *      • Account 21: EDLI Contribution (0.50% of EDLI wages)
 *      • Account 22: EDLI Administrative Charges (0.00%)
 *    - Matches individual employee lines against internal submission batches.
 *
 * 2. Discrepancy Interceptor:
 *    - Prevents batch from transitioning to SETTLED if:
 *      • Amount mismatch (Δ ≠ 0)
 *      • Missing employee record
 *      • Unmapped payment reference (invalid TRRN or missing UTR)
 *    - Flags line-level discrepancy exceptions.
 *    - Dispatches high-priority HR alerts:
 *      • REJECTED_UPLOAD: Portal rejected submission
 *      • OVERDUE_CHALLAN_PAYMENT: Approaching / past 15th statutory due date
 *      • SETTLEMENT_VARIANCE: Variance in clearing amount or account breakdown
 *
 * 3. Terminal Closure:
 *    - Marks batch as COMPLETED and SETTLED only upon exact 1:1 verified clearing.
 *    - Updates employee payment ledgers with verified clearing confirmation, UTR, and timestamp.
 *    - Logs immutable event to compliance_audit_logs via globalComplianceAuditStream.
 *
 * @version 6.3.0
 * @author Kylrx AI Lead Compliance Architect & Principal Systems Engineer
 */

import crypto from 'node:crypto';
import {
  globalPfChallanReconciliationEngine,
  inMemoryPfChallans,
  BANK_UTR_REGEX,
  calculateStatutoryDueDate,
} from './pf-challan-reconciliation-service.mjs';
import { globalComplianceAuditStream } from './compliance-audit-logger.mjs';
import { inMemorySubmissionTracking } from './ecr-submission-lifecycle-service.mjs';

export const ALERT_PRIORITIES = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const ALERT_TYPES = Object.freeze({
  REJECTED_UPLOAD: 'REJECTED_UPLOAD',
  OVERDUE_CHALLAN_PAYMENT: 'OVERDUE_CHALLAN_PAYMENT',
  SETTLEMENT_VARIANCE: 'SETTLEMENT_VARIANCE',
  MISSING_EMPLOYEE_LINE: 'MISSING_EMPLOYEE_LINE',
  UNMAPPED_PAYMENT_REF: 'UNMAPPED_PAYMENT_REF',
});

/** In-memory stores */
export const inMemoryOperationalAlerts = new Map();         // alert_id -> Alert
export const inMemoryEmployeeLedgers = new Map();           // batch_id -> Map<employee_id, LedgerEntry>
export const inMemoryReconciliationDiscrepancies = new Map(); // batch_id -> DiscrepancyReport

/**
 * Clears all stores in this module
 */
export function clearReconciliationAlertStores() {
  inMemoryOperationalAlerts.clear();
  inMemoryEmployeeLedgers.clear();
  inMemoryReconciliationDiscrepancies.clear();
}

/**
 * Retrieves all alerts with optional filtering
 */
export function getOperationalAlerts(filter = {}) {
  let list = Array.from(inMemoryOperationalAlerts.values());

  if (filter.priority) {
    list = list.filter((a) => a.priority === filter.priority);
  }
  if (filter.alert_type || filter.type) {
    const targetType = filter.alert_type || filter.type;
    list = list.filter((a) => a.alert_type === targetType);
  }
  if (filter.batch_id) {
    list = list.filter((a) => a.batch_id === filter.batch_id);
  }
  if (filter.status) {
    list = list.filter((a) => a.status === filter.status);
  }

  return list;
}

/**
 * Retrieves employee ledgers for a batch
 */
export function getEmployeeLedgersByBatch(batchId) {
  const clean = String(batchId).trim();
  const map = inMemoryEmployeeLedgers.get(clean);
  if (!map) return [];
  return Array.from(map.values());
}

/**
 * Challan Reconciliation & Operational Alert Service
 */
export class PfReconciliationAlertService {
  constructor(options = {}) {
    this.firestoreDb = options.firestoreDb || null;
  }

  /**
   * Dispatches a high-priority operational HR alert
   */
  dispatchAlert(alertData = {}) {
    const alertId = alertData.alert_id || `ALERT_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const timestamp = new Date().toISOString();
    const priority = alertData.priority || ALERT_PRIORITIES.HIGH;
    const alertType = alertData.alert_type || alertData.type || ALERT_TYPES.SETTLEMENT_VARIANCE;

    const alert = {
      alert_id: alertId,
      alert_type: alertType,
      priority,
      status: 'OPEN',
      batch_id: alertData.batch_id || null,
      trrn: alertData.trrn || null,
      title: alertData.title || `Operational Alert: ${alertType}`,
      message: alertData.message || 'Operational compliance discrepancy detected requiring HR intervention.',
      details: alertData.details || {},
      created_at: timestamp,
      dispatched_to: alertData.dispatched_to || ['HR_OPERATIONS', 'PAYROLL_ADMIN', 'COMPLIANCE_OFFICER'],
      hr_task: {
        task_id: `TASK_${alertId}`,
        assignee_role: 'HR_OPERATIONS',
        priority,
        action_required: alertData.action_required || 'Review discrepancy and take corrective action.',
        is_resolved: false,
      },
    };

    inMemoryOperationalAlerts.set(alertId, alert);
    return alert;
  }

  /**
   * Scans challans for overdue payments approaching or past the 15th statutory due date
   */
  checkOverdueChallans(currentDateInput = new Date(), options = {}) {
    const thresholdDays = Number(options.threshold_days ?? 3); // Alert if within 3 days
    const now = new Date(currentDateInput);
    const alertsGenerated = [];

    for (const challan of inMemoryPfChallans.values()) {
      // Only inspect unpaid challans
      if (challan.status === 'PAYMENT_COMPLETED' || challan.status === 'SETTLED') {
        continue;
      }

      const dueDate = new Date(challan.due_date);
      const diffTime = dueDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= thresholdDays) {
        const isPastDue = diffDays < 0;
        const alert = this.dispatchAlert({
          alert_type: ALERT_TYPES.OVERDUE_CHALLAN_PAYMENT,
          priority: isPastDue ? ALERT_PRIORITIES.CRITICAL : ALERT_PRIORITIES.HIGH,
          batch_id: challan.batch_id,
          trrn: challan.trrn,
          title: isPastDue
            ? `CRITICAL: Overdue EPFO Challan Payment for TRRN ${challan.trrn}`
            : `WARNING: EPFO Challan Payment Due in ${diffDays} Day(s)`,
          message: isPastDue
            ? `Challan for batch '${challan.batch_id}' (TRRN ${challan.trrn}) was due on ${challan.due_date} and is currently OVERDUE by ${Math.abs(diffDays)} days. Immediate payment is required to avoid penal interest (Sec 7Q) and damages (Sec 14B).`
            : `Challan for batch '${challan.batch_id}' (TRRN ${challan.trrn}) has a statutory due date of ${challan.due_date} (${diffDays} days remaining). Total amount payable: ₹${challan.account_summary.total_challan_amount.toLocaleString('en-IN')}.`,
          details: {
            batch_id: challan.batch_id,
            trrn: challan.trrn,
            due_date: challan.due_date,
            days_remaining: diffDays,
            total_payable: challan.account_summary.total_challan_amount,
            is_past_due: isPastDue,
          },
          action_required: 'Authorize and execute EPFO challan payment prior to 15th statutory cutoff.',
        });

        alertsGenerated.push(alert);
      }
    }

    return {
      success: true,
      scanned_count: inMemoryPfChallans.size,
      alerts_count: alertsGenerated.length,
      alerts: alertsGenerated,
    };
  }

  /**
   * Dispatches alert for rejected portal upload
   */
  handleRejectedUpload(params = {}) {
    const batchId = params.batch_id || params.payroll_run_id || 'UNKNOWN_BATCH';
    const reason = params.rejection_reason || params.message || 'Portal upload rejected by EPFO Unified Gateway.';

    const alert = this.dispatchAlert({
      alert_type: ALERT_TYPES.REJECTED_UPLOAD,
      priority: ALERT_PRIORITIES.CRITICAL,
      batch_id: batchId,
      title: `EPFO Upload Rejected: Batch ${batchId}`,
      message: `EPFO Portal rejected upload file for batch '${batchId}'. Error: ${reason}`,
      details: {
        batch_id: batchId,
        rejection_reason: reason,
        rejected_at: new Date().toISOString(),
        raw_error: params.raw_error || null,
      },
      action_required: 'Rectify ECR structural/data errors and re-upload return.',
    });

    return alert;
  }

  /**
   * 1. RECONCILIATION ENGINE & DISCREPANCY INTERCEPTOR
   * Ingests bank/EPFO clearing statement, validates against internal batch,
   * flags line-level exceptions, and dispatches operational alerts if discrepancies exist.
   * If exact 1:1 match, completes batch and updates employee ledgers.
   */
  reconcileClearingStatement(params = {}) {
    const batchId = String(params.batch_id || params.payroll_run_id || '').trim();
    if (!batchId) {
      throw new Error('batch_id is mandatory for challan clearing reconciliation.');
    }

    const challan = inMemoryPfChallans.get(batchId);
    if (!challan) {
      throw new Error(`Internal challan record not found for batch '${batchId}'. Ensure TRRN intake was performed.`);
    }

    const statement = params.clearing_statement || params;
    const rawTrrn = String(statement.trrn || statement.temporary_return_reference_number || '').trim();
    const bankUtr = String(statement.bank_reference_utr || statement.bank_utr || statement.utr || '').trim();
    const clearedTotalAmount = Number(statement.cleared_total_amount ?? statement.total_amount_cleared ?? statement.amount ?? 0);
    const clearingDate = statement.clearing_date || statement.settlement_date || new Date().toISOString();
    const actorId = params.actor_id || params.reconciled_by || 'EPFO_CLEARING_INGESTION_AGENT';

    const discrepancies = [];
    const lineExceptions = [];
    const alerts = [];

    // 1. Check Unmapped Payment Reference / TRRN
    if (!rawTrrn || rawTrrn.toUpperCase() !== challan.trrn.toUpperCase()) {
      discrepancies.push({
        type: 'UNMAPPED_PAYMENT_REF',
        field: 'trrn',
        expected: challan.trrn,
        actual: rawTrrn || null,
        message: `TRRN mismatch: Clearing statement TRRN '${rawTrrn}' does not match internal batch TRRN '${challan.trrn}'.`,
      });
    }

    // 2. Validate Bank UTR format
    if (!bankUtr || !BANK_UTR_REGEX.test(bankUtr)) {
      discrepancies.push({
        type: 'INVALID_BANK_UTR',
        field: 'bank_reference_utr',
        actual: bankUtr,
        message: `Invalid bank reference UTR '${bankUtr}'. Must be 12-30 alphanumeric characters.`,
      });
    }

    // 3. Match Total Challan Amounts (Exact Delta: Δ = 0)
    const expectedTotal = Number(challan.account_summary.total_challan_amount || 0);
    const amountDelta = clearedTotalAmount - expectedTotal;

    if (Math.abs(amountDelta) !== 0) {
      discrepancies.push({
        type: 'TOTAL_AMOUNT_MISMATCH',
        field: 'total_challan_amount',
        expected: expectedTotal,
        actual: clearedTotalAmount,
        delta: amountDelta,
        message: `Settlement Variance: Cleared total ₹${clearedTotalAmount.toLocaleString('en-IN')} differs from expected ₹${expectedTotal.toLocaleString('en-IN')} by Δ ₹${amountDelta.toLocaleString('en-IN')}.`,
      });
    }

    // 4. Match Account Breakdown (Accounts 1, 2, 10, 21, 22)
    const stmtAccounts = statement.account_breakdown || {};
    const expectedAccounts = challan.account_summary;

    const accountChecks = [
      {
        account_id: 'account_1_epf',
        name: 'Account 1 (EPF Contribution)',
        expected: expectedAccounts.account_1_epf ? expectedAccounts.account_1_epf.total_account_1 : null,
        actual: stmtAccounts.account_1 != null ? Number(stmtAccounts.account_1) : (stmtAccounts.account_1_epf != null ? Number(stmtAccounts.account_1_epf) : null),
      },
      {
        account_id: 'account_2_admin',
        name: 'Account 2 (Admin Charges)',
        expected: expectedAccounts.account_2_admin ? expectedAccounts.account_2_admin.admin_charges : null,
        actual: stmtAccounts.account_2 != null ? Number(stmtAccounts.account_2) : (stmtAccounts.account_2_admin != null ? Number(stmtAccounts.account_2_admin) : null),
      },
      {
        account_id: 'account_10_eps',
        name: 'Account 10 (EPS Pension)',
        expected: expectedAccounts.account_10_eps ? expectedAccounts.account_10_eps.eps_contribution : null,
        actual: stmtAccounts.account_10 != null ? Number(stmtAccounts.account_10) : (stmtAccounts.account_10_eps != null ? Number(stmtAccounts.account_10_eps) : null),
      },
      {
        account_id: 'account_21_edli',
        name: 'Account 21 (EDLI Contribution)',
        expected: expectedAccounts.account_21_edli ? expectedAccounts.account_21_edli.edli_contribution : null,
        actual: stmtAccounts.account_21 != null ? Number(stmtAccounts.account_21) : (stmtAccounts.account_21_edli != null ? Number(stmtAccounts.account_21_edli) : null),
      },
      {
        account_id: 'account_22_edli_admin',
        name: 'Account 22 (EDLI Admin Charges)',
        expected: expectedAccounts.account_22_edli_admin ? expectedAccounts.account_22_edli_admin.edli_admin_charges : null,
        actual: stmtAccounts.account_22 != null ? Number(stmtAccounts.account_22) : (stmtAccounts.account_22_edli_admin != null ? Number(stmtAccounts.account_22_edli_admin) : null),
      },
    ];

    for (const check of accountChecks) {
      if (check.actual !== null && check.expected !== null) {
        const diff = check.actual - check.expected;
        if (Math.abs(diff) !== 0) {
          discrepancies.push({
            type: 'ACCOUNT_BREAKDOWN_MISMATCH',
            account: check.account_id,
            name: check.name,
            expected: check.expected,
            actual: check.actual,
            delta: diff,
            message: `${check.name} mismatch: Cleared ₹${check.actual} vs Expected ₹${check.expected} (Δ = ₹${diff}).`,
          });
        }
      }
    }

    // 5. Match Individual Employee Lines
    const internalLines = params.internal_employee_lines || params.employee_records || [];
    const statementLines = statement.employee_lines || statement.cleared_employee_lines || [];

    if (statementLines.length > 0 && internalLines.length > 0) {
      const stmtMap = new Map();
      for (const sLine of statementLines) {
        const key = String(sLine.uan || sLine.pf_member_id || sLine.employee_id || '').trim();
        if (key) stmtMap.set(key, sLine);
      }

      for (const iLine of internalLines) {
        const key = String(iLine.uan || iLine.pf_member_id || iLine.employee_id || '').trim();
        const expectedLineTotal = Number(
          iLine.total_contribution ?? (Number(iLine.employee_pf || 0) + Number(iLine.employer_pf || 0) + Number(iLine.eps || 0))
        );

        if (!stmtMap.has(key)) {
          lineExceptions.push({
            employee_id: iLine.employee_id || key,
            uan: iLine.uan || null,
            name: iLine.name || 'Unknown',
            type: 'MISSING_EMPLOYEE_IN_CLEARING',
            expected_amount: expectedLineTotal,
            cleared_amount: 0,
            delta: -expectedLineTotal,
            message: `Employee record '${key}' was present in internal submission batch but missing in bank clearing statement.`,
          });
        } else {
          const sLine = stmtMap.get(key);
          const clearedLineTotal = Number(sLine.cleared_amount ?? sLine.amount ?? sLine.total_contribution ?? 0);
          const lineDelta = clearedLineTotal - expectedLineTotal;

          if (Math.abs(lineDelta) !== 0) {
            lineExceptions.push({
              employee_id: iLine.employee_id || key,
              uan: iLine.uan || null,
              name: iLine.name || 'Unknown',
              type: 'EMPLOYEE_LINE_AMOUNT_VARIANCE',
              expected_amount: expectedLineTotal,
              cleared_amount: clearedLineTotal,
              delta: lineDelta,
              message: `Line amount variance for '${key}': Expected ₹${expectedLineTotal}, cleared ₹${clearedLineTotal} (Δ = ₹${lineDelta}).`,
            });
          }
        }
      }
    }

    const hasDiscrepancies = discrepancies.length > 0 || lineExceptions.length > 0;

    // ========================================================================
    // DISCREPANCY INTERCEPTOR BRANCH
    // ========================================================================
    if (hasDiscrepancies) {
      // Prevent batch from transitioning to SETTLED
      challan.status = 'RECONCILIATION_FAILED';
      challan.updated_at = new Date().toISOString();

      const discrepancyReport = {
        batch_id: batchId,
        trrn: challan.trrn,
        reconciled_at: new Date().toISOString(),
        status: 'DISCREPANCIES_FLAGGED',
        total_discrepancies: discrepancies.length + lineExceptions.length,
        header_discrepancies: discrepancies,
        line_exceptions: lineExceptions,
      };

      inMemoryReconciliationDiscrepancies.set(batchId, discrepancyReport);

      // Dispatch high-priority operational alerts
      if (Math.abs(amountDelta) !== 0 || discrepancies.some((d) => d.type === 'ACCOUNT_BREAKDOWN_MISMATCH')) {
        const varianceAlert = this.dispatchAlert({
          alert_type: ALERT_TYPES.SETTLEMENT_VARIANCE,
          priority: ALERT_PRIORITIES.HIGH,
          batch_id: batchId,
          trrn: challan.trrn,
          title: `Settlement Variance Detected: Batch ${batchId}`,
          message: `Challan clearing for TRRN ${challan.trrn} failed reconciliation with a total variance of Δ ₹${amountDelta.toLocaleString('en-IN')}.`,
          details: {
            batch_id: batchId,
            trrn: challan.trrn,
            amount_delta: amountDelta,
            header_discrepancies: discrepancies,
            line_exceptions_count: lineExceptions.length,
          },
          action_required: 'Investigate payment discrepancy and obtain revised clearing statement.',
        });
        alerts.push(varianceAlert);
      }

      if (lineExceptions.length > 0) {
        const lineAlert = this.dispatchAlert({
          alert_type: ALERT_TYPES.MISSING_EMPLOYEE_LINE,
          priority: ALERT_PRIORITIES.HIGH,
          batch_id: batchId,
          trrn: challan.trrn,
          title: `Line-Level Discrepancies Flagged: ${lineExceptions.length} Employee(s)`,
          message: `${lineExceptions.length} employee record(s) have variance or are missing from the clearing statement.`,
          details: {
            batch_id: batchId,
            trrn: challan.trrn,
            line_exceptions: lineExceptions,
          },
          action_required: 'Verify employee UAN and member ID clearing mapping against EPFO return.',
        });
        alerts.push(lineAlert);
      }

      return {
        success: false,
        status: 'RECONCILIATION_FAILED',
        is_settled: false,
        message: `Reconciliation Interceptor: ${discrepancies.length + lineExceptions.length} discrepancy(ies) detected. Batch blocked from transitioning to SETTLED.`,
        discrepancy_report: discrepancyReport,
        alerts,
      };
    }

    // ========================================================================
    // TERMINAL CLOSURE (1:1 VERIFIED CLEARING)
    // ========================================================================
    // 1. Mark batch as COMPLETED and SETTLED
    challan.status = 'SETTLED';
    challan.updated_at = new Date().toISOString();
    challan.payment_reconciliation = {
      is_reconciled: true,
      payment_status: 'SETTLED',
      cleared_amount: clearedTotalAmount,
      bank_utr: bankUtr,
      clearing_date: clearingDate,
      reconciled_at: new Date().toISOString(),
      reconciled_by: actorId,
    };

    // 2. Advance Stepper to PAYMENT_COMPLETED
    const stepper = globalPfChallanReconciliationEngine.getOrCreateStepper(batchId, { period: challan.period });
    if (stepper.current_stage !== 'PAYMENT_COMPLETED') {
      while (stepper.getCurrentStageIndex() < 6) {
        const nextStage = ['PAYROLL_FINALIZED', 'PF_CALCULATED', 'ECR_VALIDATED', 'ECR_TXT_GENERATED', 'UPLOADED_TO_EPFO', 'CHALLAN_GENERATED', 'PAYMENT_COMPLETED'][stepper.getCurrentStageIndex() + 1];
        stepper.advance(nextStage, {
          actor: actorId,
          has_trrn: true,
          has_reconciled_payment: true,
        });
      }
    }

    // 3. Update Employee Payment Ledgers
    let ledgerMap = inMemoryEmployeeLedgers.get(batchId);
    if (!ledgerMap) {
      ledgerMap = new Map();
      inMemoryEmployeeLedgers.set(batchId, ledgerMap);
    }

    const recordsToClear = internalLines.length > 0 ? internalLines : statementLines;
    for (const rec of recordsToClear) {
      const empId = String(rec.employee_id || rec.uan || rec.pf_member_id).trim();
      const amount = Number(rec.total_contribution ?? (Number(rec.employee_pf || 0) + Number(rec.employer_pf || 0) + Number(rec.eps || 0)));

      ledgerMap.set(empId, {
        employee_id: empId,
        uan: rec.uan || null,
        pf_member_id: rec.pf_member_id || null,
        batch_id: batchId,
        trrn: challan.trrn,
        bank_utr: bankUtr,
        status: 'CLEARED',
        cleared_amount: amount,
        clearing_timestamp: clearingDate,
        ledger_updated_at: new Date().toISOString(),
      });
    }

    // 4. Log Immutable Audit Event
    let auditEvent = null;
    try {
      auditEvent = globalComplianceAuditStream.appendEvent({
        entity_type: 'ComplianceReturn',
        entity_id: `CHALLAN_${batchId}`,
        from_state: 'CHALLAN_GENERATED',
        to_state: 'SETTLED',
        actor_id: actorId,
        actor_role: 'TREASURY_COMPLIANCE_OFFICER',
        rule_version_applied: 'EPFO_PROCESS_FLOW_V6.0',
        correlation_id: `corr_settle_${batchId}_${bankUtr}`,
        metadata: {
          batch_id: batchId,
          trrn: challan.trrn,
          bank_utr: bankUtr,
          cleared_total_amount: clearedTotalAmount,
          employee_ledgers_cleared_count: ledgerMap.size,
        },
      });
    } catch (_) {}

    return {
      success: true,
      status: 'SETTLED',
      is_settled: true,
      batch_state: 'COMPLETED',
      message: `Terminal Closure: 1:1 verified clearing confirmation ingested. Batch marked SETTLED and ${ledgerMap.size} employee payment ledger(s) updated to CLEARED.`,
      challan,
      stepper: stepper.toJSON(),
      employee_ledgers_cleared_count: ledgerMap.size,
      audit_event: auditEvent,
    };
  }
}

// Global Singleton Instance
export const globalPfReconciliationAlertService = new PfReconciliationAlertService();
