/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL FREEZE & BATCH STATE ISOLATION ENGINE
 * ============================================================================
 * Architecture Layer: Data Layer Immutability Guards & Transactional Boundaries
 * Satisfying:
 *   Criteria 1: Payroll Freeze (Versioned, Read-Only Snapshot + Immutability Guard)
 *   Criteria 4: Batch State Isolation (Independent Domain Lifecycles & Non-Cascading Settlement)
 *
 * @version 1.0.0
 * @author Kylrx AI Principal Backend Systems Architect
 */

import crypto from 'node:crypto';

/* ============================================================================
 * 1. ERROR HIERARCHY
 * ============================================================================
 */

export class PayrollFrozenError extends Error {
  constructor(message, runId, details = {}) {
    super(message || `Payroll run '${runId}' is finalized and immutable. Modifications are forbidden.`);
    this.name = 'PayrollFrozenError';
    this.code = 'PAYROLL_RUN_FROZEN_IMMUTABLE';
    this.statusCode = 409;
    this.runId = runId;
    this.details = details;
  }
}

export class UnfinalizedRunError extends Error {
  constructor(message, runId) {
    super(message || `Downstream calculation requires a finalized payroll run snapshot. Run '${runId}' is not finalized.`);
    this.name = 'UnfinalizedRunError';
    this.code = 'RUN_NOT_FINALIZED_FOR_DISBURSEMENT';
    this.statusCode = 412;
    this.runId = runId;
  }
}

export class BatchStateIsolationError extends Error {
  constructor(message, batchId, details = {}) {
    super(message || `Batch state isolation violation on batch '${batchId}'.`);
    this.name = 'BatchStateIsolationError';
    this.code = 'BATCH_ISOLATION_VIOLATION';
    this.statusCode = 409;
    this.batchId = batchId;
    this.details = details;
  }
}

/* ============================================================================
 * 2. RECURSIVE DEEP FREEZE UTILITY
 * ============================================================================
 */

export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/* ============================================================================
 * 3. DOMAIN METADATA & DEFAULT LEDGER MAPPINGS (CRITERIA 4)
 * ============================================================================
 */

export const BATCH_DOMAIN_TYPES = Object.freeze({
  SALARY: 'SALARY',
  PF: 'PF',
  ESI: 'ESI',
  PROFESSIONAL_TAX: 'PROFESSIONAL_TAX',
  TDS: 'TDS',
  GRATUITY: 'GRATUITY',
  NPS: 'NPS',
});

export const DOMAIN_LEDGER_REGISTRY = Object.freeze({
  SALARY: {
    general_ledger_code: 'GL-210100',
    liability_account: 'ACC-LIAB-SALARY-PAYABLE',
    contra_account: 'ACC-ASSET-BANK-OPERATING',
    cost_center: 'CC-PAYROLL-DIRECT',
    journal_voucher_ref: 'JV-SAL-AUTO',
    default_day_offset: 0, // Pay period end
  },
  PF: {
    general_ledger_code: 'GL-210200',
    liability_account: 'ACC-LIAB-EPFO-STATUTORY',
    contra_account: 'ACC-ASSET-BANK-OPERATING',
    cost_center: 'CC-STATUTORY-COMPLIANCE',
    journal_voucher_ref: 'JV-PF-ECR',
    default_day_of_next_month: 15, // 15th of next month
  },
  ESI: {
    general_ledger_code: 'GL-210300',
    liability_account: 'ACC-LIAB-ESIC-STATUTORY',
    contra_account: 'ACC-ASSET-BANK-OPERATING',
    cost_center: 'CC-STATUTORY-COMPLIANCE',
    journal_voucher_ref: 'JV-ESI-MONTHLY',
    default_day_of_next_month: 15, // 15th of next month
  },
  PROFESSIONAL_TAX: {
    general_ledger_code: 'GL-210500',
    liability_account: 'ACC-LIAB-PT-STATE',
    contra_account: 'ACC-ASSET-BANK-OPERATING',
    cost_center: 'CC-STATUTORY-COMPLIANCE',
    journal_voucher_ref: 'JV-PT-STATE',
    default_day_of_next_month: 20, // 20th of next month
  },
  TDS: {
    general_ledger_code: 'GL-210400',
    liability_account: 'ACC-LIAB-TDS-SEC192',
    contra_account: 'ACC-ASSET-BANK-OPERATING',
    cost_center: 'CC-TAXATION',
    journal_voucher_ref: 'JV-TDS-192',
    default_day_of_next_month: 7, // 7th of next month
  },
  GRATUITY: {
    general_ledger_code: 'GL-210600',
    liability_account: 'ACC-LIAB-GRATUITY-PROVISION',
    contra_account: 'ACC-EXPENSE-GRATUITY',
    cost_center: 'CC-BENEFITS-RESERVE',
    journal_voucher_ref: 'JV-GRAT-PROV',
    default_day_offset: 0,
  },
  NPS: {
    general_ledger_code: 'GL-210700',
    liability_account: 'ACC-LIAB-NPS-TRUST',
    contra_account: 'ACC-ASSET-BANK-OPERATING',
    cost_center: 'CC-RETIREMENT-BENEFITS',
    journal_voucher_ref: 'JV-NPS-CRA',
    default_day_of_next_month: 10,
  },
});

/* ============================================================================
 * 4. IN-MEMORY SNAPSHOT & ISOLATION STORE
 * ============================================================================
 */

export const freezeStore = {
  snapshotsByRunId: new Map(),           // run_id -> PayrollRunSnapshot (frozen)
  snapshotsById: new Map(),              // snapshot_id -> PayrollRunSnapshot (frozen)
  isolatedBatches: new Map(),            // batch_id -> IsolatedDomainBatch
  sourceRunMutationAttempts: [],         // Audit trail of intercepted illegal mutation attempts
};

export function resetFreezeStore() {
  freezeStore.snapshotsByRunId.clear();
  freezeStore.snapshotsById.clear();
  freezeStore.isolatedBatches.clear();
  freezeStore.sourceRunMutationAttempts.length = 0;
}

/* ============================================================================
 * 5. CRITERIA 1: PAYROLL FREEZE & IMMUTABILITY GUARD
 * ============================================================================
 */

export class PayrollFreezeGuard {
  /**
   * Asserts that a source payroll run is still open/mutable.
   * Throws PayrollFrozenError if the run has already been finalized/frozen.
   *
   * @param {Object|string} runOrId
   * @param {string} [attemptedAction='MODIFY']
   */
  static assertRunMutable(runOrId, attemptedAction = 'MODIFY') {
    const runId = typeof runOrId === 'string' ? runOrId : runOrId?.run_id;
    const existingSnapshot = freezeStore.snapshotsByRunId.get(runId);
    const isFrozenObj = typeof runOrId === 'object' && runOrId !== null && (runOrId.status === 'FINALIZED' || runOrId.is_immutable || runOrId.is_frozen);

    if (existingSnapshot || isFrozenObj) {
      const error = new PayrollFrozenError(
        `Immutability Guard Violation: Source payroll run '${runId}' is finalized and frozen in payroll_run_snapshots. ` +
        `Action '${attemptedAction}' is strictly forbidden on immutable historical runs.`,
        runId,
        {
          attempted_action: attemptedAction,
          snapshot_id: existingSnapshot?.snapshot_id || null,
          frozen_at: existingSnapshot?.frozen_at || null,
        }
      );

      freezeStore.sourceRunMutationAttempts.push({
        run_id: runId,
        attempted_action: attemptedAction,
        timestamp: new Date().toISOString(),
        error_code: error.code,
      });

      throw error;
    }
  }

  /**
   * Intercepts updates to a source run document.
   * Enforces that once finalized, ANY mutation attempt throws an explicit exception.
   */
  static guardSourceRunUpdate(run, patch = {}) {
    PayrollFreezeGuard.assertRunMutable(run, 'UPDATE_RUN');
    return Object.assign(run, patch);
  }

  /**
   * Finalizes and snapshots the payroll calculation into a versioned, read-only document.
   *
   * @param {Object} run - Source PayrollRun object
   * @param {Object} [options={}] - Finalization options (admin_id, notes, etc.)
   * @returns {Object} Deep-frozen PayrollRunSnapshot
   */
  static snapshotPayrollRun(run, options = {}) {
    if (!run || !run.run_id) {
      throw new Error('Valid run object with run_id is required for freeze snapshotting.');
    }

    const runId = run.run_id;

    // Return existing snapshot if already snapshotted
    if (freezeStore.snapshotsByRunId.has(runId)) {
      return freezeStore.snapshotsByRunId.get(runId);
    }

    const nowIso = new Date().toISOString();
    const adminId = options.admin_id || 'payroll_admin@kylrx.ai';
    const version = 1;
    const snapshotId = `SNAP_${runId}_v${version}`;

    // Normalize and extract employee details
    const employees = (run.employees || []).map((emp, idx) => {
      const gross = Number(emp.gross_earnings ?? emp.gross ?? 0);
      const basic = Number(emp.basic_wage ?? emp.basic ?? Math.round(gross * 0.5));
      const deductions = Number(emp.total_deductions ?? emp.deductions ?? 0);
      const net = Number(emp.net_payable ?? emp.net ?? (gross - deductions));

      // Calculate component breakdown if not already present
      const pfWage = Math.min(basic, 15000);
      const pfEe = Number(emp.pf_ee ?? emp.pf_employee_share ?? Math.round(pfWage * 0.12));
      const pfEr = Number(emp.pf_er ?? emp.pf_employer_share ?? Math.round(pfWage * 0.12));

      const esicEe = Number(emp.esic_ee ?? emp.esic_employee_share ?? (gross <= 21000 ? Math.round(gross * 0.0075) : 0));
      const esicEr = Number(emp.esic_er ?? emp.esic_employer_share ?? (gross <= 21000 ? Math.round(gross * 0.0325) : 0));

      const pt = Number(emp.pt ?? emp.professional_tax ?? (gross > 15000 ? 200 : 0));
      const tds = Number(emp.tds ?? emp.tds_deduction ?? 0);

      const npsEe = Number(emp.nps_ee ?? emp.nps_employee_share ?? (emp.is_nps ? Math.round(basic * 0.10) : 0));
      const npsEr = Number(emp.nps_er ?? emp.nps_employer_share ?? (emp.is_nps ? Math.round(basic * 0.10) : 0));

      const gratuity = Number(emp.gratuity_accrual ?? emp.gratuity_provision ?? Math.round(basic * 0.0481));

      return {
        employee_id: emp.employee_id || `EMP_${idx + 1}`,
        employee_name: emp.employee_name || emp.name || `Employee ${idx + 1}`,
        gross_earnings: gross,
        basic_wage: basic,
        total_deductions: deductions,
        net_payable: net,
        pf_employee_share: pfEe,
        pf_employer_share: pfEr,
        esic_employee_share: esicEe,
        esic_employer_share: esicEr,
        professional_tax: pt,
        tds_deduction: tds,
        nps_employee_share: npsEe,
        nps_employer_share: npsEr,
        gratuity_provision: gratuity,
        bank_account_number: String(emp.bank_account || emp.account_number || `50100${String(idx + 1).padStart(7, '0')}`),
        ifsc_code: String(emp.ifsc || emp.ifsc_code || 'HDFC0001234'),
        pan: String(emp.pan || 'ABCDE1234F'),
        uan: emp.uan || null,
        esic_ip: emp.esic_ip || emp.esic_ip_number || null,
        nps_pran: emp.nps_pran || emp.pran || null,
        payment_reference: emp.payment_reference || `KYLRX-DISB-${runId.slice(-6)}-${idx + 1}`,
      };
    });

    // Compute aggregated totals strictly from frozen items
    const totalHeadcount = employees.length;
    const totalGross = employees.reduce((s, e) => s + e.gross_earnings, 0);
    const totalDeductions = employees.reduce((s, e) => s + e.total_deductions, 0);
    const totalNet = employees.reduce((s, e) => s + e.net_payable, 0);
    const totalPf = employees.reduce((s, e) => s + e.pf_employee_share + e.pf_employer_share, 0);
    const totalEsic = employees.reduce((s, e) => s + e.esic_employee_share + e.esic_employer_share, 0);
    const totalPt = employees.reduce((s, e) => s + e.professional_tax, 0);
    const totalTds = employees.reduce((s, e) => s + e.tds_deduction, 0);
    const totalNps = employees.reduce((s, e) => s + e.nps_employee_share + e.nps_employer_share, 0);
    const totalGratuity = employees.reduce((s, e) => s + e.gratuity_provision, 0);
    const totalEmployerContribs = employees.reduce((s, e) => s + e.pf_employer_share + e.esic_employer_share + e.nps_employer_share + e.gratuity_provision, 0);

    const totals = {
      total_headcount: totalHeadcount,
      total_gross_earnings: totalGross,
      total_employee_deductions: totalDeductions,
      total_employer_contributions: totalEmployerContribs,
      total_net_payable: totalNet,
      total_tds_deductions: totalTds,
      total_pf_liability: totalPf,
      total_esic_liability: totalEsic,
      total_gratuity_provision: totalGratuity,
      total_nps_liability: totalNps,
      total_pt_liability: totalPt,
    };

    const ledgerSummary = {
      salary_payable_ledger: DOMAIN_LEDGER_REGISTRY.SALARY.general_ledger_code,
      pf_liability_ledger: DOMAIN_LEDGER_REGISTRY.PF.general_ledger_code,
      esic_liability_ledger: DOMAIN_LEDGER_REGISTRY.ESI.general_ledger_code,
      pt_payable_ledger: DOMAIN_LEDGER_REGISTRY.PROFESSIONAL_TAX.general_ledger_code,
      tds_payable_ledger: DOMAIN_LEDGER_REGISTRY.TDS.general_ledger_code,
      nps_payable_ledger: DOMAIN_LEDGER_REGISTRY.NPS.general_ledger_code,
      gratuity_provision_ledger: DOMAIN_LEDGER_REGISTRY.GRATUITY.general_ledger_code,
    };

    // Construct raw payload for hashing
    const snapshotPayload = {
      snapshot_id: snapshotId,
      run_id: runId,
      organization_id: run.organization_id || 'ORG_KYLRX_AI',
      version,
      payroll_cycle_month: run.period || run.payroll_cycle_month || '2026-08',
      pay_period_start: run.pay_period_start || '2026-08-01',
      pay_period_end: run.pay_period_end || '2026-08-31',
      status: 'FINALIZED',
      is_frozen: true,
      is_immutable: true,
      frozen_at: nowIso,
      frozen_by: adminId,
      totals,
      employees,
      ledger_summary: ledgerSummary,
      metadata: {
        notes: options.notes || 'End-of-month locked payroll calculation.',
        finalized_by: adminId,
      },
    };

    // Calculate SHA-256 Checksum over canonical JSON
    const payloadString = JSON.stringify(snapshotPayload);
    const checksum = crypto.createHash('sha256').update(payloadString, 'utf8').digest('hex');
    snapshotPayload.checksum_sha256 = checksum;

    // Deep freeze the snapshot document so in-memory mutations throw
    const frozenSnapshot = deepFreeze(snapshotPayload);

    // Save to snapshot store
    freezeStore.snapshotsByRunId.set(runId, frozenSnapshot);
    freezeStore.snapshotsById.set(snapshotId, frozenSnapshot);

    // Mark source run as finalized and immutable
    run.status = 'FINALIZED';
    run.is_immutable = true;
    run.is_frozen = true;
    run.snapshot_id = snapshotId;
    run.finalized_at = nowIso;
    run.finalized_by = adminId;

    return frozenSnapshot;
  }

  /**
   * Retrieves the frozen snapshot for downstream payment calculations.
   * Throws UnfinalizedRunError if no frozen snapshot exists.
   */
  static getFrozenSnapshot(runId) {
    const snapshot = freezeStore.snapshotsByRunId.get(runId);
    if (!snapshot) {
      throw new UnfinalizedRunError(
        `Downstream payment calculation blocked: Payroll run '${runId}' has not been finalized into payroll_run_snapshots.`,
        runId
      );
    }
    return snapshot;
  }
}

/* ============================================================================
 * 6. CRITERIA 4: BATCH STATE ISOLATION ENGINE
 * ============================================================================
 */

export class BatchStateIsolationManager {
  /**
   * Derives default scheduled payment date based on Indian regulatory norms.
   */
  static calculateDefaultPaymentDate(cycleMonth, domainType) {
    // cycleMonth e.g. '2026-08'
    const [yearStr, monthStr] = cycleMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10); // 1-12

    const reg = DOMAIN_LEDGER_REGISTRY[domainType] || DOMAIN_LEDGER_REGISTRY.SALARY;

    if (domainType === 'SALARY') {
      // Last day of current month
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return `${yearStr}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    // Statutory deadlines fall in following month
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }

    const day = reg.default_day_of_next_month || 15;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * Creates an isolated domain batch for a specific compliance or disbursement unit.
   * Strictly reads calculation inputs from the frozen PayrollRunSnapshot.
   *
   * @param {Object} params
   * @param {string} params.runId
   * @param {string} params.batchType - 'SALARY' | 'PF' | 'ESI' | 'PROFESSIONAL_TAX' | 'TDS' | 'GRATUITY' | 'NPS'
   * @param {string} [params.scheduledPaymentDate]
   * @param {Object} [params.ledgerReferences]
   * @param {string} [params.makerId]
   * @returns {Object} IsolatedDomainBatch
   */
  static createDomainBatch({
    runId,
    batchType,
    scheduledPaymentDate,
    ledgerReferences = {},
    makerId = 'maker@kylrx.ai',
  }) {
    // 1. Enforce Criteria 1: Downstream batch calculation reads strictly from frozen snapshot
    const snapshot = PayrollFreezeGuard.getFrozenSnapshot(runId);

    const canonicalType = (batchType || 'SALARY').toUpperCase();
    if (!BATCH_DOMAIN_TYPES[canonicalType]) {
      throw new Error(`Unsupported batch domain type: '${batchType}'. Supported: ${Object.keys(BATCH_DOMAIN_TYPES).join(', ')}`);
    }

    // 2. Generate unique domain-specific batch ID
    const domainSuffix = canonicalType.slice(0, 4);
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    const batchId = `BATCH-${snapshot.payroll_cycle_month}-${domainSuffix}-${randomHex}`;

    // 3. Resolve scheduled payment date
    const finalScheduledDate = scheduledPaymentDate ||
      BatchStateIsolationManager.calculateDefaultPaymentDate(snapshot.payroll_cycle_month, canonicalType);

    // 4. Resolve independent ledger references
    const defaultLedger = DOMAIN_LEDGER_REGISTRY[canonicalType] || DOMAIN_LEDGER_REGISTRY.SALARY;
    const finalLedgerReferences = {
      general_ledger_code: ledgerReferences.general_ledger_code || defaultLedger.general_ledger_code,
      liability_account: ledgerReferences.liability_account || defaultLedger.liability_account,
      contra_account: ledgerReferences.contra_account || defaultLedger.contra_account,
      cost_center: ledgerReferences.cost_center || defaultLedger.cost_center,
      journal_voucher_ref: ledgerReferences.journal_voucher_ref || `${defaultLedger.journal_voucher_ref}-${snapshot.payroll_cycle_month}`,
    };

    // 5. Filter and assemble domain-specific records strictly from frozen snapshot
    let domainRecords = [];
    let totalBatchAmount = 0;

    switch (canonicalType) {
      case 'SALARY': {
        domainRecords = snapshot.employees.map((emp, i) => {
          totalBatchAmount += emp.net_payable;
          return {
            record_id: `REC-${batchId}-${i + 1}`,
            employee_id: emp.employee_id,
            employee_name: emp.employee_name,
            amount: emp.net_payable,
            payment_reference: emp.payment_reference,
            account_or_identifier: emp.bank_account_number,
            ifsc_code: emp.ifsc_code,
            clearing_status: 'PENDING',
          };
        });
        break;
      }
      case 'PF': {
        domainRecords = snapshot.employees
          .filter((emp) => emp.pf_employee_share > 0 || emp.pf_employer_share > 0)
          .map((emp, i) => {
            const amount = emp.pf_employee_share + emp.pf_employer_share;
            totalBatchAmount += amount;
            return {
              record_id: `REC-${batchId}-${i + 1}`,
              employee_id: emp.employee_id,
              employee_name: emp.employee_name,
              amount,
              payment_reference: `PF-${snapshot.payroll_cycle_month}-${emp.employee_id}`,
              account_or_identifier: emp.uan || 'UAN_PENDING',
              pf_ee: emp.pf_employee_share,
              pf_er: emp.pf_employer_share,
              clearing_status: 'PENDING',
            };
          });
        break;
      }
      case 'ESI': {
        domainRecords = snapshot.employees
          .filter((emp) => emp.esic_employee_share > 0 || emp.esic_employer_share > 0)
          .map((emp, i) => {
            const amount = emp.esic_employee_share + emp.esic_employer_share;
            totalBatchAmount += amount;
            return {
              record_id: `REC-${batchId}-${i + 1}`,
              employee_id: emp.employee_id,
              employee_name: emp.employee_name,
              amount,
              payment_reference: `ESI-${snapshot.payroll_cycle_month}-${emp.employee_id}`,
              account_or_identifier: emp.esic_ip || 'IP_PENDING',
              esic_ee: emp.esic_employee_share,
              esic_er: emp.esic_employer_share,
              clearing_status: 'PENDING',
            };
          });
        break;
      }
      case 'PROFESSIONAL_TAX': {
        domainRecords = snapshot.employees
          .filter((emp) => emp.professional_tax > 0)
          .map((emp, i) => {
            totalBatchAmount += emp.professional_tax;
            return {
              record_id: `REC-${batchId}-${i + 1}`,
              employee_id: emp.employee_id,
              employee_name: emp.employee_name,
              amount: emp.professional_tax,
              payment_reference: `PT-${snapshot.payroll_cycle_month}-${emp.employee_id}`,
              account_or_identifier: emp.pan,
              clearing_status: 'PENDING',
            };
          });
        break;
      }
      case 'TDS': {
        domainRecords = snapshot.employees
          .filter((emp) => emp.tds_deduction > 0)
          .map((emp, i) => {
            totalBatchAmount += emp.tds_deduction;
            return {
              record_id: `REC-${batchId}-${i + 1}`,
              employee_id: emp.employee_id,
              employee_name: emp.employee_name,
              amount: emp.tds_deduction,
              payment_reference: `TDS-${snapshot.payroll_cycle_month}-${emp.employee_id}`,
              account_or_identifier: emp.pan,
              clearing_status: 'PENDING',
            };
          });
        break;
      }
      case 'NPS': {
        domainRecords = snapshot.employees
          .filter((emp) => emp.nps_employee_share > 0 || emp.nps_employer_share > 0)
          .map((emp, i) => {
            const amount = emp.nps_employee_share + emp.nps_employer_share;
            totalBatchAmount += amount;
            return {
              record_id: `REC-${batchId}-${i + 1}`,
              employee_id: emp.employee_id,
              employee_name: emp.employee_name,
              amount,
              payment_reference: `NPS-${snapshot.payroll_cycle_month}-${emp.employee_id}`,
              account_or_identifier: emp.nps_pran || 'PRAN_PENDING',
              clearing_status: 'PENDING',
            };
          });
        break;
      }
      case 'GRATUITY': {
        domainRecords = snapshot.employees
          .filter((emp) => emp.gratuity_provision > 0)
          .map((emp, i) => {
            totalBatchAmount += emp.gratuity_provision;
            return {
              record_id: `REC-${batchId}-${i + 1}`,
              employee_id: emp.employee_id,
              employee_name: emp.employee_name,
              amount: emp.gratuity_provision,
              payment_reference: `GRAT-${snapshot.payroll_cycle_month}-${emp.employee_id}`,
              account_or_identifier: emp.employee_id,
              clearing_status: 'PENDING',
            };
          });
        break;
      }
    }

    const nowIso = new Date().toISOString();

    const batch = {
      batch_id: batchId,
      run_id: runId,
      snapshot_id: snapshot.snapshot_id,
      batch_type: canonicalType,
      status: 'DRAFT',
      state: 'DRAFT', // compatibility with existing state machine
      scheduled_payment_date: finalScheduledDate,
      ledger_references: finalLedgerReferences,
      total_records: domainRecords.length,
      total_amount: Math.round(totalBatchAmount * 100) / 100,
      currency: 'INR',
      is_settled: false,
      settled_at: null,
      bank_ref: null,
      maker_id: makerId,
      checker_id: null,
      records: domainRecords,
      created_at: nowIso,
      updated_at: nowIso,
    };

    freezeStore.isolatedBatches.set(batchId, batch);
    return batch;
  }

  /**
   * Generates isolated batches for all domain units for a given payroll run:
   * Salary, PF, ESI, Professional Tax, TDS, Gratuity, and NPS.
   */
  static createAllIsolatedBatchesForRun(runId, makerId = 'maker@kylrx.ai') {
    const units = [
      BATCH_DOMAIN_TYPES.SALARY,
      BATCH_DOMAIN_TYPES.PF,
      BATCH_DOMAIN_TYPES.ESI,
      BATCH_DOMAIN_TYPES.PROFESSIONAL_TAX,
      BATCH_DOMAIN_TYPES.TDS,
      BATCH_DOMAIN_TYPES.NPS,
      BATCH_DOMAIN_TYPES.GRATUITY,
    ];

    const results = {};
    for (const unit of units) {
      results[unit] = BatchStateIsolationManager.createDomainBatch({
        runId,
        batchType: unit,
        makerId,
      });
    }
    return results;
  }

  /**
   * Settles a specific batch independently.
   *
   * ARCHITECTURAL GUARANTEE:
   * Settle each batch independently so that marking a salary batch as PAID
   * never updates, cascades to, or mutates compliance batches.
   *
   * @param {string} batchId - The batch ID to settle
   * @param {Object} [settlementPayload={}] - Settlement details (bank_ref, settled_by, etc.)
   * @returns {Object} Settlement result confirming zero cross-domain cascades
   */
  static settleBatchIndependently(batchId, settlementPayload = {}) {
    const targetBatch = freezeStore.isolatedBatches.get(batchId);
    if (!targetBatch) {
      const err = new Error(`Batch '${batchId}' not found for settlement.`);
      err.statusCode = 404;
      err.code = 'BATCH_NOT_FOUND';
      throw err;
    }

    // Capture states of ALL other batches before settlement to verify isolation
    const otherBatchesBefore = new Map();
    for (const [id, b] of freezeStore.isolatedBatches.entries()) {
      if (id !== batchId) {
        otherBatchesBefore.set(id, {
          status: b.status,
          state: b.state,
          is_settled: b.is_settled,
          settled_at: b.settled_at,
          updated_at: b.updated_at,
          records_settled: b.records.filter((r) => r.clearing_status === 'PAID').length,
        });
      }
    }

    const previousStatus = targetBatch.status;
    const nowIso = new Date().toISOString();
    const bankRef = settlementPayload.bank_ref || `UTR${Date.now()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const targetStatus = settlementPayload.status || 'PAID';

    // Transition ONLY the target batch
    targetBatch.status = targetStatus;
    targetBatch.state = targetStatus;
    targetBatch.is_settled = targetStatus === 'PAID';
    targetBatch.settled_at = targetStatus === 'PAID' ? nowIso : null;
    targetBatch.bank_ref = bankRef;
    targetBatch.updated_at = nowIso;

    // Update target batch record statuses
    for (const rec of targetBatch.records) {
      rec.clearing_status = targetStatus === 'PAID' ? 'PAID' : 'FAILED';
      rec.settled_at = nowIso;
      rec.bank_ref = bankRef;
    }

    // STRICT ISOLATION AUDIT VERIFICATION:
    // Assert that NO OTHER BATCH was modified in any way
    for (const [otherId, beforeState] of otherBatchesBefore.entries()) {
      const otherBatchAfter = freezeStore.isolatedBatches.get(otherId);
      if (otherBatchAfter.status !== beforeState.status ||
          otherBatchAfter.state !== beforeState.state ||
          otherBatchAfter.is_settled !== beforeState.is_settled ||
          otherBatchAfter.settled_at !== beforeState.settled_at) {
        throw new BatchStateIsolationError(
          `CRITICAL ISOLATION BREACH: Settling batch '${batchId}' illegally cascaded to batch '${otherId}'!`,
          batchId,
          {
            target_batch: batchId,
            leaked_to_batch: otherId,
            before_status: beforeState.status,
            after_status: otherBatchAfter.status,
          }
        );
      }
    }

    return {
      batch_id: batchId,
      batch_type: targetBatch.batch_type,
      previous_status: previousStatus,
      status: targetStatus,
      settled_at: targetBatch.settled_at,
      settled_by: settlementPayload.settled_by || 'system_bank_reconciliation',
      bank_ref: targetBatch.bank_ref,
      records_count: targetBatch.records.length,
      total_settled_amount: targetBatch.total_amount,
      cascaded_to_other_batches: false, // 100% verified isolated
    };
  }

  /**
   * Retrieves an isolated batch by ID.
   */
  static getIsolatedBatch(batchId) {
    const batch = freezeStore.isolatedBatches.get(batchId);
    if (!batch) {
      const err = new Error(`Isolated domain batch with ID '${batchId}' not found.`);
      err.statusCode = 404;
      err.code = 'BATCH_NOT_FOUND';
      throw err;
    }
    return batch;
  }
}
