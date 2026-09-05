/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS — OPERATIONAL REPORTS API TEST SUITE
 * ============================================================================
 * Comprehensive coverage for all 6 read-optimised report handlers:
 *   R1 — Payroll Disbursement Summary
 *   R2 — Payment Batch Report
 *   R3 — Validation Exceptions Log
 *   R4 — Compliance Register
 *   R5 — Bank Reconciliation View
 *   R6 — Audit Report
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  store,
  resetDisbursementMicroserviceStores,
  recordStateTransition,
  PayrollService,
  PaymentBatchService,
  ValidationService,
  ApprovalService,
  FileService,
  BankIntegrationService,
} from './payroll-disbursement-api.mjs';

import {
  reportStore,
  resetReportStore,
  buildPayrollDisbursementSummary,
  buildPaymentBatchReport,
  buildValidationExceptionsLog,
  buildComplianceRegister,
  buildBankReconciliationView,
  buildAuditReport,
  seedComplianceLedgerEntry,
  seedBankReconciliationRow,
  createReportsRouter,
} from './operational-reports-api.mjs';

// ─── Shared seed helpers ──────────────────────────────────────────────────────

function seedPayrollRun(id, overrides = {}) {
  store.payrollRuns.set(id, {
    run_id:           id,
    period:           overrides.period           || 'September 2026',
    status:           overrides.status           || 'DRAFT',
    gross_payroll:    overrides.gross_payroll    || 500000,
    total_deductions: overrides.total_deductions || 50000,
    net_payable:      overrides.net_payable      || 450000,
    employer_contributions: overrides.employer_contributions || 30000,
    employees:        overrides.employees        || [
      { employee_id: 'EMP_01', gross: 250000, deductions: 25000, net: 225000 },
      { employee_id: 'EMP_02', gross: 250000, deductions: 25000, net: 225000 },
    ],
    finalized_at:     overrides.finalized_at     || null,
    is_immutable:     overrides.is_immutable     || false,
    created_at:       overrides.created_at       || new Date().toISOString(),
  });
}

function seedValidatedBatch(runId, options = {}) {
  const batchId = options.batchId || `BATCH_TEST_${Date.now()}`;
  store.paymentBatches.set(batchId, {
    batch_id:     batchId,
    run_id:       runId,
    batch_type:   options.batch_type || 'SALARY',
    state:        options.state      || 'VALIDATED',
    total_amount: options.total_amount || 450000,
    total_records: 2,
    records: options.records || [
      { employee_id: 'EMP_01', net_payable: 225000, clearing_status: null },
      { employee_id: 'EMP_02', net_payable: 225000, clearing_status: null },
    ],
    maker_id:  options.maker_id  || 'maker@test.com',
    checker_id: null,
    created_at: options.created_at || new Date().toISOString(),
    updated_at: options.updated_at || new Date().toISOString(),
  });
  if (options.issues) {
    store.validationIssuesByBatch.set(batchId, options.issues);
  }
  return batchId;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

test('🗂  KYLRX AI OPERATIONAL REPORTS API — FULL TEST SUITE', async (t) => {

  t.beforeEach(() => {
    resetDisbursementMicroserviceStores();
    resetReportStore();
  });

  // ==========================================================================
  // R1 — PAYROLL DISBURSEMENT SUMMARY
  // ==========================================================================
  await t.test('R1. Payroll Disbursement Summary', async (t2) => {

    await t2.test('Returns empty result when no payroll runs exist', () => {
      const result = buildPayrollDisbursementSummary();
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.runs.length, 0);
      assert.strictEqual(result.report, 'PAYROLL_DISBURSEMENT_SUMMARY');
      assert.ok(result.generated_at);
    });

    await t2.test('Projects correct financial fields for a single run', () => {
      seedPayrollRun('RUN_R1_01', {
        gross_payroll: 600000, total_deductions: 60000,
        net_payable: 540000, employer_contributions: 36000,
        employees: [{ id: 'E1' }, { id: 'E2' }, { id: 'E3' }],
        status: 'FINALIZED', finalized_at: new Date().toISOString(),
      });

      const result = buildPayrollDisbursementSummary();
      assert.strictEqual(result.total, 1);
      const row = result.runs[0];
      assert.strictEqual(row.run_id, 'RUN_R1_01');
      assert.strictEqual(row.total_employees, 3);
      assert.strictEqual(row.gross_payroll, 600000);
      assert.strictEqual(row.total_deductions, 60000);
      assert.strictEqual(row.net_salary, 540000);
      assert.strictEqual(row.employer_contributions, 36000);
      assert.strictEqual(row.status, 'FINALIZED');
      // INR formatting
      assert.ok(row.formatted.gross_payroll.startsWith('₹'), 'formatted gross must use ₹ symbol');
      assert.ok(row.formatted.net_salary.startsWith('₹'));
    });

    await t2.test('Status filter is case-insensitive', () => {
      seedPayrollRun('RUN_FIN', { status: 'FINALIZED' });
      seedPayrollRun('RUN_DRAFT', { status: 'DRAFT' });

      const fin   = buildPayrollDisbursementSummary({ status: 'finalized' });
      const draft = buildPayrollDisbursementSummary({ status: 'DRAFT' });

      assert.strictEqual(fin.total,   1, 'finalized filter must return 1');
      assert.strictEqual(draft.total, 1, 'draft filter must return 1');
    });

    await t2.test('Period filter is a partial case-insensitive match', () => {
      seedPayrollRun('RUN_SEP', { period: 'September 2026' });
      seedPayrollRun('RUN_AUG', { period: 'August 2026' });

      const sep = buildPayrollDisbursementSummary({ period: 'sep' });
      assert.strictEqual(sep.total, 1);
      assert.strictEqual(sep.runs[0].run_id, 'RUN_SEP');
    });

    await t2.test('summary_totals correctly sums across all runs', () => {
      seedPayrollRun('RUN_A', { gross_payroll: 200000, total_deductions: 20000, net_payable: 180000, employer_contributions: 12000 });
      seedPayrollRun('RUN_B', { gross_payroll: 300000, total_deductions: 30000, net_payable: 270000, employer_contributions: 18000 });

      const result = buildPayrollDisbursementSummary();
      const totals = result.summary_totals;
      assert.strictEqual(totals.gross_payroll,    500000);
      assert.strictEqual(totals.net_salary,       450000);
      assert.strictEqual(totals.total_deductions, 50000);
      assert.strictEqual(totals.employer_contributions, 30000);
      assert.ok(totals.formatted.gross_payroll.startsWith('₹'));
    });

    await t2.test('Pagination: limit and offset are respected', () => {
      for (let i = 1; i <= 5; i++) seedPayrollRun(`RUN_PAGE_${i}`);

      const p1 = buildPayrollDisbursementSummary({ limit: 2, offset: 0 });
      const p2 = buildPayrollDisbursementSummary({ limit: 2, offset: 2 });

      assert.strictEqual(p1.total, 5);
      assert.strictEqual(p1.count, 2);
      assert.strictEqual(p2.count, 2);

      const ids1 = p1.runs.map((r) => r.run_id);
      const ids2 = p2.runs.map((r) => r.run_id);
      assert.strictEqual(ids1.filter((id) => ids2.includes(id)).length, 0, 'pages must not overlap');
    });
  });

  // ==========================================================================
  // R2 — PAYMENT BATCH REPORT
  // ==========================================================================
  await t.test('R2. Payment Batch Report', async (t2) => {

    await t2.test('Returns empty result when no batches exist', () => {
      const result = buildPaymentBatchReport();
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.report, 'PAYMENT_BATCH_REPORT');
    });

    await t2.test('Projects correct batch fields and derives clearing counters', () => {
      const batchId = seedValidatedBatch('RUN_R2', {
        state: 'PAID',
        records: [
          { employee_id: 'EMP_A', net_payable: 100000, clearing_status: 'PAID' },
          { employee_id: 'EMP_B', net_payable: 100000, clearing_status: 'FAILED' },
          { employee_id: 'EMP_C', net_payable: 100000, clearing_status: 'PAID' },
        ],
      });

      const result = buildPaymentBatchReport();
      assert.strictEqual(result.total, 1);
      const row = result.batches[0];
      assert.strictEqual(row.batch_id, batchId);
      assert.strictEqual(row.paid_count, 2);
      assert.strictEqual(row.failed_count, 1);
      assert.strictEqual(row.unmatched_count, 0);
      assert.strictEqual(row.state, 'PAID');
      assert.strictEqual(row.submission_status, 'PAID');
      assert.ok(row.formatted.total_amount.startsWith('₹'));
    });

    await t2.test('batch_type filter is case-insensitive', () => {
      seedValidatedBatch('RUN_T1', { batchId: 'B_SALARY', batch_type: 'SALARY' });
      seedValidatedBatch('RUN_T2', { batchId: 'B_ESIC',   batch_type: 'ESIC'   });

      assert.strictEqual(buildPaymentBatchReport({ batch_type: 'salary' }).total, 1);
      assert.strictEqual(buildPaymentBatchReport({ batch_type: 'ESIC'   }).total, 1);
    });

    await t2.test('validation_status BLOCKED filter works via stored issues', () => {
      const bId = seedValidatedBatch('RUN_VS', {
        batchId: 'B_BLOCKED',
        issues: [{ code: 'BAD_IFSC', severity: 'BLOCK', employee_id: 'EMP_X', message: 'Bad IFSC' }],
      });

      const blocked = buildPaymentBatchReport({ validation_status: 'BLOCKED' });
      assert.strictEqual(blocked.total, 1);
      assert.strictEqual(blocked.batches[0].validation_status, 'BLOCKED');
    });

    await t2.test('approval_state filter returns only PENDING_APPROVAL batches', () => {
      seedValidatedBatch('RUN_AP1', { batchId: 'B_PEND', state: 'PENDING_APPROVAL' });
      seedValidatedBatch('RUN_AP2', { batchId: 'B_APP',  state: 'APPROVED' });

      const pend = buildPaymentBatchReport({ approval_state: 'PENDING_APPROVAL' });
      assert.strictEqual(pend.total, 1);
      assert.strictEqual(pend.batches[0].batch_id, 'B_PEND');
    });

    await t2.test('aggregate totals reflect all visible batches', () => {
      seedValidatedBatch('RUN_AG1', { batchId: 'B_AG1', total_amount: 100000, records: [] });
      seedValidatedBatch('RUN_AG2', { batchId: 'B_AG2', total_amount: 200000, records: [] });

      const result = buildPaymentBatchReport();
      assert.strictEqual(result.aggregate.total_amount, 300000);
    });
  });

  // ==========================================================================
  // R3 — VALIDATION EXCEPTIONS LOG
  // ==========================================================================
  await t.test('R3. Validation Exceptions Log', async (t2) => {

    await t2.test('Returns empty when no validation issues exist', () => {
      const result = buildValidationExceptionsLog();
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.report, 'VALIDATION_EXCEPTIONS_LOG');
    });

    await t2.test('Collects issues across all batches', () => {
      store.validationIssuesByBatch.set('BATCH_V1', [
        { code: 'INVALID_IFSC', severity: 'BLOCK', employee_id: 'EMP_1', message: 'Bad IFSC' },
      ]);
      store.validationIssuesByBatch.set('BATCH_V2', [
        { code: 'NAME_MISMATCH', severity: 'WARN', employee_id: 'EMP_2', message: 'Name mismatch' },
        { code: 'LOW_AMOUNT',    severity: 'INFO', employee_id: 'EMP_3', message: 'Amount < threshold' },
      ]);

      const result = buildValidationExceptionsLog();
      assert.strictEqual(result.total, 3);
      assert.strictEqual(result.severity_distribution.BLOCK, 1);
      assert.strictEqual(result.severity_distribution.WARN,  1);
      assert.strictEqual(result.severity_distribution.INFO,  1);
      assert.strictEqual(result.unresolved_count, 3);
    });

    await t2.test('batch_id filter scopes to a single batch', () => {
      store.validationIssuesByBatch.set('BATCH_SCOPE', [
        { code: 'ISSUE_A', severity: 'BLOCK', employee_id: 'E1', message: 'A' },
      ]);
      store.validationIssuesByBatch.set('BATCH_OTHER', [
        { code: 'ISSUE_B', severity: 'WARN', employee_id: 'E2', message: 'B' },
      ]);

      const result = buildValidationExceptionsLog({ batch_id: 'BATCH_SCOPE' });
      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.exceptions[0].issue_code, 'ISSUE_A');
    });

    await t2.test('severity filter is case-insensitive', () => {
      store.validationIssuesByBatch.set('BV', [
        { code: 'X', severity: 'BLOCK', employee_id: 'E', message: 'm' },
        { code: 'Y', severity: 'WARN',  employee_id: 'E', message: 'm' },
      ]);

      assert.strictEqual(buildValidationExceptionsLog({ severity: 'block' }).total, 1);
      assert.strictEqual(buildValidationExceptionsLog({ severity: 'WARN'  }).total, 1);
    });

    await t2.test('resolved filter separates resolved vs unresolved', () => {
      store.validationIssuesByBatch.set('BR', [
        { code: 'Z', severity: 'BLOCK', employee_id: 'E1', message: 'm', resolver_id: 'admin@test.com', resolved_at: new Date().toISOString() },
        { code: 'W', severity: 'WARN',  employee_id: 'E2', message: 'm' },
      ]);

      const resolved   = buildValidationExceptionsLog({ resolved: 'true'  });
      const unresolved = buildValidationExceptionsLog({ resolved: 'false' });
      assert.strictEqual(resolved.total,   1);
      assert.strictEqual(unresolved.total, 1);
      assert.strictEqual(resolved.exceptions[0].is_resolved, true);
      assert.strictEqual(resolved.exceptions[0].resolver_id, 'admin@test.com');
    });

    await t2.test('Pagination (limit/offset) works on exception log', () => {
      const issues = Array.from({ length: 6 }, (_, i) => ({
        code: `CODE_${i}`, severity: 'INFO', employee_id: `EMP_${i}`, message: 'x',
      }));
      store.validationIssuesByBatch.set('BP', issues);

      const p1 = buildValidationExceptionsLog({ limit: 3, offset: 0 });
      const p2 = buildValidationExceptionsLog({ limit: 3, offset: 3 });
      assert.strictEqual(p1.total, 6);
      assert.strictEqual(p1.count, 3);
      assert.strictEqual(p2.count, 3);
    });
  });

  // ==========================================================================
  // R4 — COMPLIANCE REGISTER
  // ==========================================================================
  await t.test('R4. Compliance Register', async (t2) => {

    await t2.test('Returns empty when ledger is empty', () => {
      const result = buildComplianceRegister();
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.report, 'COMPLIANCE_REGISTER');
    });

    await t2.test('seedComplianceLedgerEntry seeds a frozen, valid entry', () => {
      const entry = seedComplianceLedgerEntry({
        scheme: 'ESIC', period: '08/2026', employer_code: '31000123',
        employee_count: 45, employee_contributions: 15000,
        employer_contributions: 65000, total_liability: 80000,
        submission_ref: 'SUB_ESIC_AUG26',
        acknowledgement_ref: 'ACK_ESIC_AUG26',
        due_date: '2026-08-15', due_date_status: 'ON_TIME',
      });

      assert.ok(entry.entry_id.startsWith('cmp_'), 'entry_id must start with cmp_');
      assert.strictEqual(entry.scheme, 'ESIC');
      assert.strictEqual(entry.employee_count, 45);
      assert.strictEqual(entry.total_liability, 80000);
      assert.strictEqual(entry.due_date_status, 'ON_TIME');

      // Immutability check
      assert.throws(() => { entry.scheme = 'TAMPERED'; }, /Cannot assign/);
    });

    await t2.test('scheme filter is exact and case-insensitive', () => {
      seedComplianceLedgerEntry({ scheme: 'NPS',      period: '2026-08', total_liability: 12000 });
      seedComplianceLedgerEntry({ scheme: 'GRATUITY', period: '2026-08', total_liability: 50000 });
      seedComplianceLedgerEntry({ scheme: 'ESIC',     period: '2026-08', total_liability: 8000  });

      assert.strictEqual(buildComplianceRegister({ scheme: 'nps'      }).total, 1);
      assert.strictEqual(buildComplianceRegister({ scheme: 'GRATUITY' }).total, 1);
      assert.strictEqual(buildComplianceRegister({ scheme: 'ESIC'     }).total, 1);
    });

    await t2.test('due_status OVERDUE filter and overdue_count', () => {
      seedComplianceLedgerEntry({ scheme: 'PF', period: '2026-07', total_liability: 30000, due_date_status: 'OVERDUE' });
      seedComplianceLedgerEntry({ scheme: 'PF', period: '2026-08', total_liability: 30000, due_date_status: 'ON_TIME' });

      const result   = buildComplianceRegister({ due_status: 'OVERDUE' });
      const allResult = buildComplianceRegister();

      assert.strictEqual(result.total, 1);
      assert.strictEqual(allResult.overdue_count, 1);
    });

    await t2.test('scheme_totals correctly aggregates by scheme', () => {
      seedComplianceLedgerEntry({ scheme: 'NPS', period: '2026-07', employee_contributions: 6000, employer_contributions: 6000, total_liability: 12000 });
      seedComplianceLedgerEntry({ scheme: 'NPS', period: '2026-08', employee_contributions: 7000, employer_contributions: 7000, total_liability: 14000 });
      seedComplianceLedgerEntry({ scheme: 'ESIC', period: '2026-07', employee_contributions: 3000, employer_contributions: 13000, total_liability: 16000 });

      const result = buildComplianceRegister();
      assert.ok(result.scheme_totals.NPS);
      assert.strictEqual(result.scheme_totals.NPS.total_liability, 26000);
      assert.strictEqual(result.scheme_totals.NPS.count, 2);
      assert.ok(result.scheme_totals.ESIC);
      assert.strictEqual(result.scheme_totals.ESIC.total_liability, 16000);
    });

    await t2.test('Pagination works on compliance register', () => {
      for (let i = 0; i < 6; i++) seedComplianceLedgerEntry({ scheme: 'TDS', period: `2026-0${i + 1}`, total_liability: 5000 });

      const p1 = buildComplianceRegister({ limit: 3, offset: 0 });
      const p2 = buildComplianceRegister({ limit: 3, offset: 3 });
      assert.strictEqual(p1.total, 6);
      assert.strictEqual(p1.count, 3);
      assert.strictEqual(p2.count, 3);
    });
  });

  // ==========================================================================
  // R5 — BANK RECONCILIATION VIEW
  // ==========================================================================
  await t.test('R5. Bank Reconciliation View', async (t2) => {

    await t2.test('Returns empty when no cleared records or external rows exist', () => {
      // Batch exists but records have no clearing_status or txn_id
      seedValidatedBatch('RUN_BR', {
        batchId: 'BATCH_UNCLEARED',
        records: [{ employee_id: 'E1', net_payable: 50000 }],
      });

      const result = buildBankReconciliationView();
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.report, 'BANK_RECONCILIATION_VIEW');
    });

    await t2.test('Inline PAID rows: difference = 0, resolution_state = RESOLVED', () => {
      seedValidatedBatch('RUN_BRC', {
        batchId: 'BATCH_CLEARED',
        records: [
          { employee_id: 'EMP_P1', net_payable: 100000, clearing_status: 'PAID', txn_id: 'TXN_001', bank_ref: 'UTR_001' },
          { employee_id: 'EMP_P2', net_payable:  50000, clearing_status: 'FAILED', txn_id: null,      clearing_reason: 'INVALID_ACCOUNT_NUMBER' },
        ],
        state: 'PAID',
      });

      const result = buildBankReconciliationView({ batch_id: 'BATCH_CLEARED' });
      assert.strictEqual(result.total, 2);

      const paidRow = result.records.find((r) => r.employee_id === 'EMP_P1');
      assert.ok(paidRow, 'PAID row must be present');
      assert.strictEqual(paidRow.paid_amount,      100000);
      assert.strictEqual(paidRow.instructed_amount, 100000);
      assert.strictEqual(paidRow.difference,       0);
      assert.strictEqual(paidRow.resolution_state, 'RESOLVED');
      assert.ok(paidRow.formatted.difference.startsWith('₹'));

      const failedRow = result.records.find((r) => r.employee_id === 'EMP_P2');
      assert.ok(failedRow, 'FAILED row must be present');
      assert.strictEqual(failedRow.difference,       50000);
      assert.strictEqual(failedRow.resolution_state, 'UNRESOLVED');
      assert.strictEqual(failedRow.failure_reason,   'INVALID_ACCOUNT_NUMBER');
    });

    await t2.test('External rows seeded via seedBankReconciliationRow are surfaced', () => {
      const row = seedBankReconciliationRow({
        batch_id:    'BATCH_EXT',
        employee_id: 'EMP_EXT',
        instructed_amount: 75000,
        paid_amount:       75000,
        txn_id:    'TXN_EXT_001',
        bank_ref:  'UTR_EXT_001',
        status:    'PAID',
        resolution_state: 'RESOLVED',
      });

      const result = buildBankReconciliationView({ batch_id: 'BATCH_EXT' });
      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.records[0].employee_id, 'EMP_EXT');
      assert.strictEqual(result.records[0].bank_ref, 'UTR_EXT_001');
      // Immutability
      assert.throws(() => { row.status = 'TAMPERED'; }, /Cannot assign/);
    });

    await t2.test('Inline rows take precedence over external duplicates on recon_id', () => {
      seedValidatedBatch('RUN_DUP', {
        batchId: 'BATCH_DUP',
        records: [
          { employee_id: 'EMP_DUP', net_payable: 60000, clearing_status: 'PAID', txn_id: 'TXN_DUP' },
        ],
        state: 'PAID',
      });

      // External row with same recon_id — should be de-duped out
      seedBankReconciliationRow({
        recon_id:   `rcn_BATCH_DUP_EMP_DUP`, // matches inline row's generated id
        batch_id:   'BATCH_DUP',
        employee_id: 'EMP_DUP',
        instructed_amount: 99999, // different amount — should NOT appear
        paid_amount: 99999,
        status: 'PAID',
      });

      const result = buildBankReconciliationView({ batch_id: 'BATCH_DUP' });
      assert.strictEqual(result.total, 1, 'duplicate recon_id must be de-duped');
      assert.strictEqual(result.records[0].instructed_amount, 60000, 'inline row must win');
    });

    await t2.test('status filter works', () => {
      seedBankReconciliationRow({ batch_id: 'BF', employee_id: 'E1', instructed_amount: 50000, paid_amount: 50000, status: 'PAID' });
      seedBankReconciliationRow({ batch_id: 'BF', employee_id: 'E2', instructed_amount: 40000, paid_amount: 0,     status: 'FAILED' });

      const paid   = buildBankReconciliationView({ batch_id: 'BF', status: 'paid'   });
      const failed = buildBankReconciliationView({ batch_id: 'BF', status: 'FAILED' });
      assert.strictEqual(paid.total,   1);
      assert.strictEqual(failed.total, 1);
    });

    await t2.test('Aggregate totals are correct', () => {
      seedBankReconciliationRow({ batch_id: 'BG', employee_id: 'E1', instructed_amount: 100000, paid_amount: 100000, status: 'PAID' });
      seedBankReconciliationRow({ batch_id: 'BG', employee_id: 'E2', instructed_amount:  50000, paid_amount:      0, status: 'FAILED' });

      const result = buildBankReconciliationView({ batch_id: 'BG' });
      assert.strictEqual(result.aggregate.total_instructed, 150000);
      assert.strictEqual(result.aggregate.total_paid,       100000);
      assert.strictEqual(result.aggregate.total_difference,  50000);
      assert.strictEqual(result.aggregate.paid_count,   1);
      assert.strictEqual(result.aggregate.failed_count, 1);
    });
  });

  // ==========================================================================
  // R6 — AUDIT REPORT
  // ==========================================================================
  await t.test('R6. Audit Report', async (t2) => {

    await t2.test('Returns empty when no audit events exist', () => {
      const result = buildAuditReport();
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.report, 'AUDIT_REPORT');
    });

    await t2.test('Projects canonical shape with old_state / new_state / rule_version_applied', () => {
      recordStateTransition({
        entity: 'payment_batch', entityId: 'BATCH_AU1',
        from: 'DRAFT', to: 'VALIDATED', actorId: 'sys_validator',
        correlationId: 'corr_audit_test',
      });

      const result = buildAuditReport();
      assert.ok(result.total >= 1);
      const row = result.events.find((e) => e.entity_id === 'BATCH_AU1');
      assert.ok(row, 'event for BATCH_AU1 must be present');
      assert.strictEqual(row.old_state,  'DRAFT');
      assert.strictEqual(row.new_state,  'VALIDATED');
      assert.strictEqual(row.actor_id,   'sys_validator');
      assert.strictEqual(row.correlation_id, 'corr_audit_test');
      assert.ok(row.rule_version_applied, 'rule_version_applied must be present');
      assert.ok(row.audit_id,             'audit_id must be present');
      assert.ok(row.timestamp,            'timestamp must be present');
    });

    await t2.test('entity_type filter is case-insensitive', () => {
      recordStateTransition({ entity: 'payroll_run',    entityId: 'RUN_ATYP',  from: 'DRAFT', to: 'FINALIZED', actorId: 'admin' });
      recordStateTransition({ entity: 'payment_batch',  entityId: 'BATCH_ATYP', from: 'DRAFT', to: 'VALIDATED', actorId: 'sys' });

      const runs    = buildAuditReport({ entity_type: 'payroll_run' });
      const batches = buildAuditReport({ entity_type: 'PAYMENT_BATCH' });
      assert.ok(runs.events.every((e)    => e.entity_type === 'PAYROLL_RUN'));
      assert.ok(batches.events.every((e) => e.entity_type === 'PAYMENT_BATCH'));
    });

    await t2.test('from_state and to_state filters work', () => {
      recordStateTransition({ entity: 'payment_batch', entityId: 'B_FSM1', from: 'DRAFT',     to: 'VALIDATED',        actorId: 'sys' });
      recordStateTransition({ entity: 'payment_batch', entityId: 'B_FSM2', from: 'VALIDATED', to: 'PENDING_APPROVAL', actorId: 'maker' });
      recordStateTransition({ entity: 'payment_batch', entityId: 'B_FSM3', from: 'PENDING_APPROVAL', to: 'APPROVED',  actorId: 'checker' });

      const fromDraft     = buildAuditReport({ from_state: 'DRAFT' });
      const toApproved    = buildAuditReport({ to_state:   'APPROVED' });
      const fromToPending = buildAuditReport({ from_state: 'VALIDATED', to_state: 'PENDING_APPROVAL' });

      assert.ok(fromDraft.events.every((e)     => e.old_state === 'DRAFT'));
      assert.ok(toApproved.events.every((e)    => e.new_state === 'APPROVED'));
      assert.ok(fromToPending.events.every((e) => e.old_state === 'VALIDATED' && e.new_state === 'PENDING_APPROVAL'));
    });

    await t2.test('actor_id filter works', () => {
      recordStateTransition({ entity: 'payment_batch', entityId: 'B_ACT', from: 'DRAFT', to: 'VALIDATED',  actorId: 'maker_x' });
      recordStateTransition({ entity: 'payment_batch', entityId: 'B_ACT', from: 'VALIDATED', to: 'APPROVED', actorId: 'checker_y' });

      const maker   = buildAuditReport({ actor_id: 'maker_x' });
      const checker = buildAuditReport({ actor_id: 'checker_y' });
      assert.ok(maker.events.length   >= 1, 'maker_x events expected');
      assert.ok(checker.events.length >= 1, 'checker_y events expected');
      assert.ok(maker.events.every((e)   => e.actor_id === 'maker_x'));
      assert.ok(checker.events.every((e) => e.actor_id === 'checker_y'));
    });

    await t2.test('correlation_id filter returns exact match only', () => {
      recordStateTransition({ entity: 'payment_batch', entityId: 'BCORR', from: 'DRAFT', to: 'VALIDATED',  actorId: 'sys', correlationId: 'corr_UNIQUE_XYZ' });
      recordStateTransition({ entity: 'payment_batch', entityId: 'BCORR', from: 'VALIDATED', to: 'APPROVED', actorId: 'sys', correlationId: 'corr_OTHER' });

      const result = buildAuditReport({ correlation_id: 'corr_UNIQUE_XYZ' });
      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.events[0].correlation_id, 'corr_UNIQUE_XYZ');
    });

    await t2.test('actor_distribution correctly counts per actor', () => {
      recordStateTransition({ entity: 'payment_batch', entityId: 'B1', from: 'DRAFT', to: 'V', actorId: 'actor_A' });
      recordStateTransition({ entity: 'payment_batch', entityId: 'B2', from: 'DRAFT', to: 'V', actorId: 'actor_A' });
      recordStateTransition({ entity: 'payment_batch', entityId: 'B3', from: 'DRAFT', to: 'V', actorId: 'actor_B' });

      const result = buildAuditReport();
      assert.ok(result.actor_distribution['actor_A'] >= 2, 'actor_A must appear >= 2 times');
      assert.ok(result.actor_distribution['actor_B'] >= 1, 'actor_B must appear >= 1 time');
    });

    await t2.test('Full lifecycle audit trail is chronologically ordered', async () => {
      const runId = 'RUN_LIFECYCLE';
      store.payrollRuns.set(runId, {
        run_id: runId,
        employees: [{ employee_id: 'EMP_L', gross: 80000, deductions: 8000, net: 72000 }],
      });

      const batch = await PaymentBatchService.createBatch({ run_id: runId, maker_id: 'mk_lifecycle' });
      await ValidationService.validateBatch(batch.batch_id);
      await ApprovalService.submitApproval(batch.batch_id);
      await ApprovalService.approveBatch(batch.batch_id, { checker_id: 'ck_lifecycle' });
      await FileService.generateFile(batch.batch_id);

      const result = buildAuditReport({ entity_id: batch.batch_id });
      assert.ok(result.total >= 5, 'At least 5 FSM events expected');

      // Verify chronological order
      const timestamps = result.events.map((e) => new Date(e.timestamp).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        assert.ok(timestamps[i] >= timestamps[i - 1], `Event ${i} must not be older than event ${i - 1}`);
      }

      // Verify deduplication — no repeated audit_id
      const audIds = result.events.map((e) => e.audit_id);
      const uniqueIds = new Set(audIds);
      assert.strictEqual(uniqueIds.size, audIds.length, 'No duplicate audit_ids must appear');
    });

    await t2.test('Pagination with limit / offset works on audit events', () => {
      for (let i = 0; i < 8; i++) {
        recordStateTransition({ entity: 'payment_batch', entityId: `BPAG_${i}`, from: 'DRAFT', to: 'VALIDATED', actorId: 'pager' });
      }

      const p1 = buildAuditReport({ actor_id: 'pager', limit: 3, offset: 0 });
      const p2 = buildAuditReport({ actor_id: 'pager', limit: 3, offset: 3 });

      assert.strictEqual(p1.total, 8);
      assert.strictEqual(p1.count, 3);
      assert.strictEqual(p2.count, 3);

      const ids1 = p1.events.map((e) => e.audit_id);
      const ids2 = p2.events.map((e) => e.audit_id);
      assert.strictEqual(ids1.filter((id) => ids2.includes(id)).length, 0, 'pages must not overlap');
    });
  });

  // ==========================================================================
  // ROUTER INTEGRATION
  // ==========================================================================
  await t.test('Router Integration: createReportsRouter mounts all endpoints', () => {
    const router = createReportsRouter();
    assert.ok(router, 'router must be truthy');
    assert.strictEqual(typeof router, 'function', 'router must be an Express middleware function');

    // Verify all 8 routes are registered (including 2 seed routes)
    const registeredRoutes = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

    const expected = [
      'GET /payroll-disbursement-summary',
      'GET /payment-batch-report',
      'GET /validation-exceptions-log',
      'GET /compliance-register',
      'POST /compliance-register/seed',
      'GET /bank-reconciliation-view',
      'POST /bank-reconciliation-view/seed',
      'GET /audit-report',
    ];

    for (const route of expected) {
      assert.ok(
        registeredRoutes.includes(route),
        `Route "${route}" must be registered on the reports router`
      );
    }
  });

});
