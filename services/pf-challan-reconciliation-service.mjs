/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PF CHALLAN RECONCILIATION & STATE MACHINE SERVICE
 * ============================================================================
 * Implements Section 6 of the Visual Compliance Blueprint:
 *
 * 1. Process Flow Stepper (7 Canonical States):
 *    Payroll Finalized -> PF Calculated -> ECR Validated -> ECR TXT Generated
 *    -> Uploaded to EPFO -> TRRN / Challan Generated -> Payment Completed
 *
 * 2. TRRN Ingestion:
 *    - Ingests official Temporary Return Reference Number (TRRN)
 *    - Challan Generation Date
 *    - Statutory Due Date (15th of the subsequent month)
 *    - Challan Summary Figures:
 *      • Account 1: EPF Wages, EE Share (12%), ER EPF Share (3.67%)
 *      • Account 2: Administrative Charges (0.50% of EPF wages)
 *      • Account 10: EPS Wages & EPS Contribution (8.33% capped at ₹1,250)
 *      • Account 21: EDLI Contribution (0.50% of EDLI wages)
 *      • Account 22: EDLI Administrative Charges (0.00%)
 *      • Total Amount Payable
 *
 * 3. Payment Reconciliation & Accounting:
 *    - Ingests payment confirmation receipts
 *    - Matches TRRN, cleared amount, and bank reference UTR against internal batch
 *    - Updates status to PAYMENT_COMPLETED
 *    - Advances step 7
 *    - Logs immutable audit trail events to compliance_audit_logs via globalComplianceAuditStream
 *
 * @version 6.0.0
 * @author Kylrx AI Lead Compliance Architect
 */

import crypto from 'node:crypto';
import { globalComplianceAuditStream } from './compliance-audit-logger.mjs';

export const PF_STEPPER_RULE_VERSION = 'EPFO_PROCESS_FLOW_V6.0';

/**
 * 7 Canonical Stages of the EPFO Compliance Process Flow
 */
export const PF_PROCESS_STAGES = Object.freeze([
  'PAYROLL_FINALIZED',      // Stage 1
  'PF_CALCULATED',          // Stage 2
  'ECR_VALIDATED',          // Stage 3
  'ECR_TXT_GENERATED',      // Stage 4
  'UPLOADED_TO_EPFO',       // Stage 5
  'CHALLAN_GENERATED',      // Stage 6 (TRRN Ingested)
  'PAYMENT_COMPLETED',      // Stage 7 (Reconciled & Accounted)
]);

export const PF_STAGE_LABELS = Object.freeze({
  PAYROLL_FINALIZED: 'Payroll Finalized',
  PF_CALCULATED: 'PF Calculated',
  ECR_VALIDATED: 'ECR Validated',
  ECR_TXT_GENERATED: 'ECR TXT Generated',
  UPLOADED_TO_EPFO: 'Uploaded to EPFO',
  CHALLAN_GENERATED: 'TRRN / Challan Generated',
  PAYMENT_COMPLETED: 'Payment Completed',
});

export const TRRN_REGEX = /^[A-Za-z0-9]{10,25}$/;
export const BANK_UTR_REGEX = /^[A-Za-z0-9]{12,30}$/;

/**
 * Calculates the statutory compliance due date (15th of the subsequent calendar month).
 * e.g., for period '2026-09' or date in September 2026, returns '2026-10-15'.
 */
export function calculateStatutoryDueDate(periodOrDate) {
  let year;
  let month; // 1-indexed

  if (typeof periodOrDate === 'string' && /^\d{4}[-_/]\d{2}/.test(periodOrDate)) {
    const parts = periodOrDate.split(/[-_/]/);
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  } else {
    const d = new Date(periodOrDate || Date.now());
    year = d.getFullYear();
    month = d.getMonth() + 1;
  }

  // Next month
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  const mm = String(nextMonth).padStart(2, '0');
  return `${nextYear}-${mm}-15`;
}

/** In-memory registries */
export const inMemoryPfSteppers = new Map();
export const inMemoryPfChallans = new Map();

export function clearPfChallanAndStepperStores() {
  inMemoryPfSteppers.clear();
  inMemoryPfChallans.clear();
}

/**
 * ============================================================================
 * 1. PROCESS FLOW STEPPER (STATE MACHINE)
 * ============================================================================
 */
export class PfProcessFlowStepper {
  constructor(batchId, initialData = {}) {
    this.batch_id = String(batchId).trim();
    this.period = initialData.period || initialData.wage_month || '2026-09';
    this.current_stage = initialData.initial_stage || 'PAYROLL_FINALIZED';
    this.created_at = initialData.created_at || new Date().toISOString();
    this.updated_at = new Date().toISOString();
    this.is_completed = this.current_stage === 'PAYMENT_COMPLETED';
    this.blocking_exceptions_count = initialData.blocking_exceptions_count || 0;
    this.rule_version = PF_STEPPER_RULE_VERSION;

    this.history = initialData.history || [
      {
        stage: this.current_stage,
        timestamp: this.created_at,
        actor: initialData.actor || 'SYSTEM_PAYROLL_SERVICE',
        comment: 'Process flow stepper initialized on payroll run',
      },
    ];
  }

  getCurrentStageIndex() {
    return PF_PROCESS_STAGES.indexOf(this.current_stage);
  }

  /**
   * Validates whether advancing to targetStage is permissible under state rules
   */
  canAdvanceTo(targetStage, options = {}) {
    const currentIdx = this.getCurrentStageIndex();
    const targetIdx = PF_PROCESS_STAGES.indexOf(targetStage);

    if (targetIdx === -1) {
      return { allowed: false, reason: `Unknown stage '${targetStage}'` };
    }

    // Must be next sequential stage or re-entry if specified
    if (targetIdx !== currentIdx + 1 && !options.allow_jump) {
      return {
        allowed: false,
        reason: `Cannot jump from ${this.current_stage} to ${targetStage}. Expected sequential stage: ${PF_PROCESS_STAGES[currentIdx + 1] || 'None'}.`,
      };
    }

    // Gate: ECR_VALIDATED requires zero blocking exceptions
    if (targetStage === 'ECR_VALIDATED' && (options.blocking_exceptions_count > 0 || this.blocking_exceptions_count > 0)) {
      const count = options.blocking_exceptions_count ?? this.blocking_exceptions_count;
      return {
        allowed: false,
        reason: `Gatekeeper Blocked: ${count} unresolved blocking exceptions (missing/invalid UAN or Member ID).`,
      };
    }

    // Gate: CHALLAN_GENERATED requires valid TRRN details
    if (targetStage === 'CHALLAN_GENERATED' && !options.has_trrn) {
      return {
        allowed: false,
        reason: 'Gatekeeper Blocked: Official TRRN and Challan Summary figures must be ingested first.',
      };
    }

    // Gate: PAYMENT_COMPLETED requires successful payment reconciliation
    if (targetStage === 'PAYMENT_COMPLETED' && !options.has_reconciled_payment) {
      return {
        allowed: false,
        reason: 'Gatekeeper Blocked: Payment confirmation receipt matching TRRN and cleared amount is required.',
      };
    }

    return { allowed: true };
  }

  /**
   * Advances the stepper to targetStage
   */
  advance(targetStage, meta = {}) {
    const check = this.canAdvanceTo(targetStage, meta);
    if (!check.allowed) {
      const err = new Error(check.reason);
      err.code = 'STEPPER_TRANSITION_BLOCKED';
      err.status = 422;
      throw err;
    }

    const previousStage = this.current_stage;
    this.current_stage = targetStage;
    this.updated_at = new Date().toISOString();
    this.is_completed = targetStage === 'PAYMENT_COMPLETED';

    const transitionRecord = {
      from_stage: previousStage,
      to_stage: targetStage,
      timestamp: this.updated_at,
      actor: meta.actor || meta.actor_id || 'COMPLIANCE_OPERATIONS',
      comment: meta.comment || `Advanced from ${previousStage} to ${targetStage}`,
      metadata: meta.details || {},
    };

    this.history.push(transitionRecord);

    // Immutable Audit Log Event
    let auditEvent = null;
    try {
      auditEvent = globalComplianceAuditStream.appendEvent({
        entity_type: 'ComplianceReturn',
        entity_id: this.batch_id,
        from_state: previousStage,
        to_state: targetStage,
        actor_id: meta.actor || meta.actor_id || 'COMPLIANCE_OPERATIONS',
        actor_role: meta.actor_role || 'COMPLIANCE_OFFICER',
        rule_version_applied: this.rule_version,
        correlation_id: meta.correlation_id || `corr_pf_${this.batch_id}_${Date.now()}`,
      });
    } catch (e) {
      // Stream logging fallback
    }

    this.last_audit_event = auditEvent;
    return this;
  }

  toJSON() {
    return {
      batch_id: this.batch_id,
      period: this.period,
      current_stage: this.current_stage,
      current_stage_label: PF_STAGE_LABELS[this.current_stage],
      stage_index: this.getCurrentStageIndex() + 1,
      total_stages: PF_PROCESS_STAGES.length,
      is_completed: this.is_completed,
      stages: PF_PROCESS_STAGES.map((s, idx) => ({
        stage_key: s,
        stage_number: idx + 1,
        stage_label: PF_STAGE_LABELS[s],
        status: idx < this.getCurrentStageIndex() ? 'COMPLETED' : idx === this.getCurrentStageIndex() ? 'CURRENT' : 'PENDING',
      })),
      blocking_exceptions_count: this.blocking_exceptions_count,
      rule_version: this.rule_version,
      updated_at: this.updated_at,
      created_at: this.created_at,
      history: this.history,
    };
  }
}

/**
 * ============================================================================
 * 2. CHALLAN RECONCILIATION & ACCOUNTING ENGINE
 * ============================================================================
 */
export class PfChallanReconciliationEngine {
  constructor(options = {}) {
    this.firestoreDb = options.firestoreDb || null;
  }

  /**
   * Retrieves or initializes a stepper instance for the batch
   */
  getOrCreateStepper(batchId, initialData = {}) {
    const cleanId = String(batchId).trim();
    if (!inMemoryPfSteppers.has(cleanId)) {
      const stepper = new PfProcessFlowStepper(cleanId, initialData);
      inMemoryPfSteppers.set(cleanId, stepper);
    }
    return inMemoryPfSteppers.get(cleanId);
  }

  /**
   * Retrieves stepper by batch ID
   */
  getStepper(batchId) {
    return inMemoryPfSteppers.get(String(batchId).trim()) || null;
  }

  /**
   * Retrieves challan by batch ID
   */
  getChallan(batchId) {
    return inMemoryPfChallans.get(String(batchId).trim()) || null;
  }

  /**
   * Retrieves all challans
   */
  getAllChallans() {
    return Array.from(inMemoryPfChallans.values());
  }

  /**
   * Step 5 -> 6: Ingests TRRN, Challan Generation Date, Due Date, and Account Breakdown
   */
  ingestTrrn(batchId, trrnData = {}) {
    const cleanBatchId = String(batchId).trim();
    const rawTrrn = String(trrnData.trrn || trrnData.temporary_return_reference_number || '').trim();

    if (!rawTrrn || !TRRN_REGEX.test(rawTrrn)) {
      const err = new Error(`Invalid TRRN format: '${rawTrrn}'. TRRN must be a 10-25 character alphanumeric string.`);
      err.code = 'INVALID_TRRN_SYNTAX';
      err.status = 400;
      throw err;
    }

    const period = trrnData.period || trrnData.wage_month || '2026-09';
    const challanDate = trrnData.challan_generation_date || trrnData.generation_date || new Date().toISOString().slice(0, 10);
    const statutoryDueDate = trrnData.due_date || calculateStatutoryDueDate(period);

    // Compute / Parse Challan Summary Figures across standard EPFO Accounts
    const epfWages = Math.round(Number(trrnData.epf_wages || 0));
    const epsWages = Math.round(Number(trrnData.eps_wages || 0));
    const edliWages = Math.round(Number(trrnData.edli_wages || epfWages));

    // Account 1: EPF Contributions
    const eeContribution = Math.round(Number(trrnData.ee_contribution ?? trrnData.employee_share ?? (epfWages * 0.12)));
    const erEpfContribution = Math.round(Number(trrnData.er_epf_contribution ?? trrnData.employer_epf_share ?? (epfWages * 0.0367)));
    const account1Total = eeContribution + erEpfContribution;

    // Account 2: Admin Charges (0.50% of EPF wages, default min ₹500 or calculated)
    const adminCharges = Math.round(Number(trrnData.admin_charges ?? trrnData.administrative_charges ?? Math.max(500, epfWages * 0.005)));

    // Account 10: EPS Contribution (8.33% of EPS wages, capped at ₹1,250)
    const epsContribution = Math.round(Number(trrnData.eps_contribution ?? trrnData.er_eps_share ?? (epsWages > 0 ? Math.min(1250, epsWages * 0.0833) : 0)));

    // Account 21: EDLI Contribution (0.50% of EDLI wages)
    const edliContribution = Math.round(Number(trrnData.edli_contribution ?? (edliWages * 0.005)));

    // Account 22: EDLI Admin Charges (Statutory 0.00%)
    const edliAdminCharges = Math.round(Number(trrnData.edli_admin_charges || 0));

    // Total Challan Payable
    const totalChallanPayable = account1Total + adminCharges + epsContribution + edliContribution + edliAdminCharges;

    const challanRecord = {
      challan_id: `CHALLAN_${cleanBatchId}`,
      batch_id: cleanBatchId,
      trrn: rawTrrn,
      period,
      establishment_id: trrnData.establishment_id || 'MH_BAN_0012345',
      challan_generation_date: challanDate,
      due_date: statutoryDueDate,
      status: 'CHALLAN_GENERATED',
      account_summary: {
        account_1_epf: {
          epf_wages: epfWages,
          ee_contribution: eeContribution,
          er_contribution: erEpfContribution,
          total_account_1: account1Total,
        },
        account_2_admin: {
          admin_charges: adminCharges,
          rate_percentage: 0.50,
        },
        account_10_eps: {
          eps_wages: epsWages,
          eps_contribution: epsContribution,
          rate_percentage: 8.33,
        },
        account_21_edli: {
          edli_wages: edliWages,
          edli_contribution: edliContribution,
          rate_percentage: 0.50,
        },
        account_22_edli_admin: {
          edli_admin_charges: edliAdminCharges,
          rate_percentage: 0.0,
        },
        total_challan_amount: totalChallanPayable,
      },
      payment_reconciliation: {
        is_reconciled: false,
        payment_status: 'UNPAID',
        cleared_amount: 0,
        bank_utr: null,
        reconciled_at: null,
        reconciled_by: null,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ingested_by: trrnData.actor || trrnData.admin_id || 'COMPLIANCE_MAKER',
    };

    inMemoryPfChallans.set(cleanBatchId, challanRecord);

    // Advance stepper state
    const stepper = this.getOrCreateStepper(cleanBatchId, { period });
    // If currently earlier than CHALLAN_GENERATED, fast-forward sequentially or advance
    while (stepper.getCurrentStageIndex() < PF_PROCESS_STAGES.indexOf('CHALLAN_GENERATED')) {
      const nextIdx = stepper.getCurrentStageIndex() + 1;
      const nextStage = PF_PROCESS_STAGES[nextIdx];
      stepper.advance(nextStage, {
        actor: challanRecord.ingested_by,
        has_trrn: true,
        comment: `Automated progression to ${nextStage} during TRRN intake`,
        details: { trrn: rawTrrn, totalChallanPayable },
      });
    }

    // Persist to Firestore if configured
    if (this.firestoreDb && typeof this.firestoreDb.collection === 'function') {
      try {
        const p = this.firestoreDb.collection('pf_challans').doc(cleanBatchId).set(challanRecord, { merge: true });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
    }

    return {
      success: true,
      data: challanRecord,
      stepper: stepper.toJSON(),
    };
  }

  /**
   * Step 6 -> 7: Ingests payment confirmation receipt, matches TRRN, cleared amount,
   * bank UTR, advances stepper to PAYMENT_COMPLETED, and logs immutable audit trail.
   */
  reconcilePayment(batchId, receiptData = {}) {
    const cleanBatchId = String(batchId).trim();
    const challan = inMemoryPfChallans.get(cleanBatchId);

    if (!challan) {
      const err = new Error(`Challan not found for batch '${cleanBatchId}'. TRRN must be ingested prior to payment reconciliation.`);
      err.code = 'CHALLAN_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const receiptTrrn = String(receiptData.trrn || '').trim();
    const receiptUtr = String(receiptData.bank_utr || receiptData.utr || receiptData.bank_reference_number || '').trim();
    const clearedAmount = Number(receiptData.cleared_amount ?? receiptData.amount_paid ?? receiptData.amount ?? 0);
    const expectedAmount = challan.account_summary.total_challan_amount;

    // 1. TRRN Match
    if (!receiptTrrn || receiptTrrn.toUpperCase() !== challan.trrn.toUpperCase()) {
      const err = new Error(`TRRN Mismatch: Receipt TRRN '${receiptTrrn}' does not match batch TRRN '${challan.trrn}'.`);
      err.code = 'TRRN_MISMATCH';
      err.status = 422;
      throw err;
    }

    // 2. Bank UTR Syntax Validation
    if (!receiptUtr || !BANK_UTR_REGEX.test(receiptUtr)) {
      const err = new Error(`Invalid Bank Reference UTR: '${receiptUtr}'. Must be 12-30 alphanumeric characters.`);
      err.code = 'INVALID_BANK_UTR';
      err.status = 400;
      throw err;
    }

    // 3. Amount Reconciliation
    const tolerance = Number(receiptData.tolerance || 0);
    const amountDifference = Math.abs(clearedAmount - expectedAmount);
    if (amountDifference > tolerance) {
      const err = new Error(
        `Payment Amount Mismatch: Cleared amount ₹${clearedAmount.toLocaleString('en-IN')} does not match expected challan amount ₹${expectedAmount.toLocaleString('en-IN')}. Difference: ₹${amountDifference}.`
      );
      err.code = 'AMOUNT_MISMATCH';
      err.status = 422;
      throw err;
    }

    // 4. Update Challan Record
    const reconciledAt = receiptData.payment_date || new Date().toISOString();
    const actor = receiptData.actor || receiptData.reconciled_by || 'FINANCE_TREASURY_OFFICER';

    challan.status = 'PAYMENT_COMPLETED';
    challan.updated_at = new Date().toISOString();
    challan.payment_reconciliation = {
      is_reconciled: true,
      payment_status: 'PAID',
      cleared_amount: clearedAmount,
      bank_utr: receiptUtr,
      payment_mode: receiptData.payment_mode || 'EPFO_PORTAL_INTERNET_BANKING',
      bank_name: receiptData.bank_name || 'State Bank of India',
      payment_date: reconciledAt,
      reconciled_at: new Date().toISOString(),
      reconciled_by: actor,
      receipt_id: receiptData.receipt_id || `RCPT_${receiptUtr}_${Date.now()}`,
    };

    // 5. Advance Stepper to Stage 7 (PAYMENT_COMPLETED)
    const auditCorrelationId = `corr_reconcile_${cleanBatchId}_${receiptUtr}`;
    const stepper = this.getOrCreateStepper(cleanBatchId, { period: challan.period });
    stepper.advance('PAYMENT_COMPLETED', {
      actor,
      actor_role: 'FINANCE_TREASURY',
      correlation_id: auditCorrelationId,
      has_reconciled_payment: true,
      comment: `Payment successfully reconciled with Bank UTR ${receiptUtr}. Challan cleared in full.`,
      details: {
        trrn: challan.trrn,
        bank_utr: receiptUtr,
        cleared_amount: clearedAmount,
      },
    });

    const auditEvent = stepper.last_audit_event;

    // Persist to Firestore if configured
    if (this.firestoreDb && typeof this.firestoreDb.collection === 'function') {
      try {
        const p1 = this.firestoreDb.collection('pf_challans').doc(cleanBatchId).set(challan, { merge: true });
        if (p1 && typeof p1.catch === 'function') p1.catch(() => {});

        if (auditEvent) {
          const p2 = this.firestoreDb.collection('compliance_audit_logs').doc(auditEvent.event_id).set(auditEvent, { merge: true });
          if (p2 && typeof p2.catch === 'function') p2.catch(() => {});
        }
      } catch (e) {}
    }

    return {
      success: true,
      message: 'Payment confirmation receipt reconciled and accounted successfully. Batch advanced to PAYMENT_COMPLETED.',
      challan,
      stepper: stepper.toJSON(),
      audit_event: auditEvent,
    };
  }
}

export const globalPfChallanReconciliationEngine = new PfChallanReconciliationEngine();
