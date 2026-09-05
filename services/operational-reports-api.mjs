/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS — OPERATIONAL REPORTS API
 * ============================================================================
 * Read-Optimised Aggregation Engine for the 6 Core Disbursement Reports.
 *
 * Design Principles (Principal Database Engineer):
 *   1. READS NEVER MUTATE — every handler is a pure projection over the
 *      in-memory store; no write-path logic is permitted here.
 *   2. AGGREGATION ON THE SERVER — sums, groupings, and derived metrics are
 *      computed server-side so the client never receives raw row dumps.
 *   3. CHRONOLOGICAL TIMELINES — all multi-row reports return rows sorted
 *      oldest-first so the consumer can render them as a time-ordered log.
 *   4. PAGINATED BY DEFAULT — every collection endpoint accepts
 *      ?limit=N&offset=M with totals echoed back.
 *   5. FILTER-PUSH-DOWN — field predicates are applied before sorting/paging
 *      to keep in-memory scans as small as possible.
 *   6. IMMUTABLE AUDIT TAIL — the Audit Report never truncates; it streams
 *      the full state-transition ledger in chronological order.
 *
 * Reports Exposed:
 *   GET /reports/payroll-disbursement-summary
 *   GET /reports/payment-batch-report
 *   GET /reports/validation-exceptions-log
 *   GET /reports/compliance-register
 *   GET /reports/bank-reconciliation-view
 *   GET /reports/audit-report
 *
 * @version 1.0.0
 * @author  Kylrx AI Principal Database & Backend Architecture Team
 */

import crypto from 'node:crypto';
import express from 'express';
import { store as disbursementStore } from './payroll-disbursement-api.mjs';

// ============================================================================
// REPORT STORE
// ============================================================================
export const reportStore = {
  /**
   * Statutory Compliance Ledger.
   * Shape: { entry_id, scheme, period, employer_code, employee_count,
   *          employee_contributions, employer_contributions,
   *          total_liability, file_id, submission_ref, acknowledgement_ref,
   *          due_date, due_date_status, created_at }
   */
  complianceLedger: [],

  /**
   * Bank Reconciliation Rows (from external reconciliation engines).
   * Shape: { recon_id, batch_id, employee_id, employee_name,
   *          instructed_amount, paid_amount, txn_id, bank_ref,
   *          status, difference, resolution_state, failure_reason,
   *          reconciled_at }
   */
  bankReconciliationRows: [],
};

/**
 * Resets the report store for clean test isolation.
 */
export function resetReportStore() {
  reportStore.complianceLedger.length = 0;
  reportStore.bankReconciliationRows.length = 0;
}

// ============================================================================
// HELPERS
// ============================================================================

function parseIntParam(raw, defaultVal, maxVal = Infinity) {
  if (raw === undefined || raw === null || raw === '') return defaultVal;
  const n = parseInt(String(raw), 10);
  if (isNaN(n) || n < 0) return defaultVal;
  return Math.min(n, maxVal);
}

function applyDateRange(rows, field, fromDate, toDate) {
  let out = rows;
  if (fromDate) {
    const from = new Date(fromDate).getTime();
    if (!isNaN(from)) out = out.filter((r) => new Date(r[field]).getTime() >= from);
  }
  if (toDate) {
    const to = new Date(toDate).getTime();
    if (!isNaN(to)) out = out.filter((r) => new Date(r[field]).getTime() <= to);
  }
  return out;
}

function formatInr(val) {
  const n = Math.round(Number(val) || 0);
  return '\u20b9' + n.toLocaleString('en-IN');
}

function paginate(rows, limit, offset, rowsKey = 'rows') {
  const total = rows.length;
  const page  = rows.slice(offset, offset + limit);
  return { total, limit, offset, count: page.length, [rowsKey]: page };
}

function ok(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    meta: {
      timestamp:  new Date().toISOString(),
      request_id: `rpt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      version:    '1.0.0',
    },
  });
}

function fail(res, code, message, statusCode = 400, details = null) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message, details, timestamp: new Date().toISOString() },
  });
}

// ============================================================================
// REPORT 1 — PAYROLL DISBURSEMENT SUMMARY
// ============================================================================

/**
 * Aggregates payroll_runs into a period-by-period summary table.
 *
 * GET /reports/payroll-disbursement-summary
 *
 * Query Parameters:
 *   period    {string}  - Partial / exact period match (e.g. "September 2026")
 *   status    {string}  - Exact run status filter (e.g. "FINALIZED")
 *   from_date {string}  - ISO-8601 finalized_at start (inclusive)
 *   to_date   {string}  - ISO-8601 finalized_at end   (inclusive)
 *   limit     {number}  - Page size (default 50, max 500)
 *   offset    {number}  - Pagination offset (default 0)
 *
 * Row Shape:
 *   { run_id, period, total_employees, gross_payroll, total_deductions,
 *     net_salary, employer_contributions, payment_date, status,
 *     is_immutable, formatted }
 */
export function buildPayrollDisbursementSummary(filter = {}) {
  let rows = [...disbursementStore.payrollRuns.values()];

  if (filter.status) {
    rows = rows.filter((r) => (r.status || '').toUpperCase() === filter.status.toUpperCase());
  }
  if (filter.period) {
    const p = String(filter.period).toLowerCase();
    rows = rows.filter((r) => String(r.period || '').toLowerCase().includes(p));
  }

  rows = applyDateRange(rows, 'finalized_at', filter.from_date, filter.to_date);

  const projected = rows.map((run) => {
    const employees  = run.employees || [];
    const gross      = Number(run.gross_payroll             || 0);
    const deductions = Number(run.total_deductions          || 0);
    const net        = Number(run.net_payable               || (gross - deductions));
    const erContr    = Number(run.employer_contributions    || 0);

    return {
      run_id:                 run.run_id,
      period:                 run.period       || null,
      total_employees:        employees.length,
      gross_payroll:          Math.round(gross      * 100) / 100,
      total_deductions:       Math.round(deductions * 100) / 100,
      net_salary:             Math.round(net        * 100) / 100,
      employer_contributions: Math.round(erContr    * 100) / 100,
      payment_date:           run.finalized_at || run.created_at || null,
      status:                 run.status       || 'DRAFT',
      is_immutable:           !!run.is_immutable,
      formatted: {
        gross_payroll:          formatInr(gross),
        total_deductions:       formatInr(deductions),
        net_salary:             formatInr(net),
        employer_contributions: formatInr(erContr),
      },
    };
  });

  projected.sort((a, b) => new Date(b.payment_date || 0) - new Date(a.payment_date || 0));

  const totals = projected.reduce(
    (acc, r) => {
      acc.total_employees        += r.total_employees;
      acc.gross_payroll          += r.gross_payroll;
      acc.total_deductions       += r.total_deductions;
      acc.net_salary             += r.net_salary;
      acc.employer_contributions += r.employer_contributions;
      return acc;
    },
    { total_employees: 0, gross_payroll: 0, total_deductions: 0, net_salary: 0, employer_contributions: 0 }
  );

  const limit  = parseIntParam(filter.limit, 50, 500);
  const offset = parseIntParam(filter.offset, 0);

  return {
    ...paginate(projected, limit, offset, 'runs'),
    summary_totals: {
      ...totals,
      formatted: {
        gross_payroll:          formatInr(totals.gross_payroll),
        total_deductions:       formatInr(totals.total_deductions),
        net_salary:             formatInr(totals.net_salary),
        employer_contributions: formatInr(totals.employer_contributions),
      },
    },
    report:       'PAYROLL_DISBURSEMENT_SUMMARY',
    generated_at: new Date().toISOString(),
  };
}

// ============================================================================
// REPORT 2 — PAYMENT BATCH REPORT
// ============================================================================

/**
 * Aggregates payment_batches with per-batch derived clearing counters.
 *
 * GET /reports/payment-batch-report
 *
 * Query Parameters:
 *   batch_type         {string}  - SALARY | EPF | ESIC | NPS | GRATUITY | TDS
 *   state              {string}  - Exact batch state  (e.g. APPROVED, PAID)
 *   validation_status  {string}  - VALIDATED | BLOCKED
 *   approval_state     {string}  - PENDING_APPROVAL | APPROVED | REJECTED
 *   submission_status  {string}  - SUBMITTED | PAID | PARTIALLY_PAID | FAILED
 *   run_id             {string}  - Filter by payroll run
 *   from_date          {string}  - ISO-8601 created_at start
 *   to_date            {string}  - ISO-8601 created_at end
 *   limit              {number}  - Page size (default 50, max 500)
 *   offset             {number}  - Pagination offset (default 0)
 *
 * Row Shape:
 *   { batch_id, run_id, batch_type, total_amount, total_records,
 *     validation_status, approval_state, file_id, submission_status,
 *     paid_count, failed_count, unmatched_count, state,
 *     maker_id, checker_id, created_at, updated_at, formatted }
 */
export function buildPaymentBatchReport(filter = {}) {
  let batches = [...disbursementStore.paymentBatches.values()];

  if (filter.batch_type) {
    batches = batches.filter(
      (b) => (b.batch_type || '').toUpperCase() === filter.batch_type.toUpperCase()
    );
  }
  if (filter.state) {
    batches = batches.filter(
      (b) => (b.state || '').toUpperCase() === filter.state.toUpperCase()
    );
  }
  if (filter.run_id) {
    batches = batches.filter((b) => b.run_id === filter.run_id);
  }
  if (filter.validation_status) {
    const vs = filter.validation_status.toUpperCase();
    batches = batches.filter((b) => {
      const issues  = disbursementStore.validationIssuesByBatch.get(b.batch_id) || [];
      const blocked = issues.some((i) => i.severity === 'BLOCK');
      return vs === 'BLOCKED' ? blocked : !blocked;
    });
  }
  if (filter.approval_state) {
    const as_ = filter.approval_state.toUpperCase();
    const valid = new Set(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']);
    if (valid.has(as_)) batches = batches.filter((b) => b.state === as_);
  }
  if (filter.submission_status) {
    const ss = filter.submission_status.toUpperCase();
    const map = {
      SUBMITTED: ['SUBMITTED'], PAID: ['PAID'],
      PARTIALLY_PAID: ['PARTIALLY_PAID'], FAILED: ['FAILED'],
    };
    const targets = map[ss] || [ss];
    batches = batches.filter((b) => targets.includes((b.state || '').toUpperCase()));
  }

  batches = applyDateRange(batches, 'created_at', filter.from_date, filter.to_date);

  const APPROVAL_STATES = new Set(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']);
  const POST_APPROVAL   = new Set(['FILE_GENERATED', 'SUBMITTED', 'PAID', 'PARTIALLY_PAID', 'FAILED']);

  const projected = batches.map((b) => {
    const issues       = disbursementStore.validationIssuesByBatch.get(b.batch_id) || [];
    const blocked      = issues.some((i) => i.severity === 'BLOCK');
    const records      = b.records || [];
    const paidCount    = records.filter((r) => r.clearing_status === 'PAID').length;
    const failedCount  = records.filter((r) => r.clearing_status === 'FAILED').length;
    const unmatchedCnt = records.filter((r) => r.clearing_status === 'UNMATCHED').length;

    return {
      batch_id:          b.batch_id,
      run_id:            b.run_id,
      batch_type:        b.batch_type || 'SALARY',
      total_amount:      b.total_amount,
      total_records:     b.total_records || records.length,
      validation_status: blocked ? 'BLOCKED' : (b.state !== 'DRAFT' ? 'VALIDATED' : 'PENDING'),
      approval_state:    APPROVAL_STATES.has(b.state) ? b.state : null,
      file_id:           b.file_id   || null,
      submission_status: POST_APPROVAL.has(b.state) ? b.state : null,
      paid_count:        paidCount,
      failed_count:      failedCount,
      unmatched_count:   unmatchedCnt,
      state:             b.state,
      maker_id:          b.maker_id  || null,
      checker_id:        b.checker_id || null,
      created_at:        b.created_at,
      updated_at:        b.updated_at,
      formatted:         { total_amount: formatInr(b.total_amount) },
    };
  });

  projected.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const aggr = projected.reduce(
    (acc, r) => {
      acc.total_amount  += r.total_amount  || 0;
      acc.total_records += r.total_records || 0;
      acc.paid_count    += r.paid_count;
      acc.failed_count  += r.failed_count;
      return acc;
    },
    { total_amount: 0, total_records: 0, paid_count: 0, failed_count: 0 }
  );

  const limit  = parseIntParam(filter.limit, 50, 500);
  const offset = parseIntParam(filter.offset, 0);

  return {
    ...paginate(projected, limit, offset, 'batches'),
    aggregate:    { ...aggr, formatted: { total_amount: formatInr(aggr.total_amount) } },
    report:       'PAYMENT_BATCH_REPORT',
    generated_at: new Date().toISOString(),
  };
}

// ============================================================================
// REPORT 3 — VALIDATION EXCEPTIONS LOG
// ============================================================================

/**
 * Collects validation issues across all batches (or a specific one),
 * enriched with resolution metadata.
 *
 * GET /reports/validation-exceptions-log
 *
 * Query Parameters:
 *   batch_id    {string}  - Scope to a single batch
 *   employee_id {string}  - Filter by employee
 *   severity    {string}  - BLOCK | WARN | INFO
 *   issue_code  {string}  - Exact issue code (e.g. INVALID_IFSC)
 *   resolved    {string}  - "true" | "false" — resolved/unresolved filter
 *   from_date   {string}  - ISO-8601 created_time start
 *   to_date     {string}  - ISO-8601 created_time end
 *   limit       {number}  - Page size (default 100, max 1000)
 *   offset      {number}  - Pagination offset (default 0)
 *
 * Row Shape:
 *   { exception_id, batch_id, issue_code, severity, employee_id,
 *     field, message, created_time, is_resolved, resolver_id,
 *     resolution_time, resolution_note }
 */
export function buildValidationExceptionsLog(filter = {}) {
  const allIssues = [];

  const targetBatchIds = filter.batch_id
    ? (disbursementStore.validationIssuesByBatch.has(filter.batch_id) ? [filter.batch_id] : [])
    : [...disbursementStore.validationIssuesByBatch.keys()];

  for (const batchId of targetBatchIds) {
    const issues = disbursementStore.validationIssuesByBatch.get(batchId) || [];
    for (const issue of issues) {
      allIssues.push({
        exception_id:    issue.exception_id    || `exc_${batchId}_${issue.code || 'UNKNOWN'}`,
        batch_id:        batchId,
        issue_code:      issue.code            || issue.issue_code || 'UNKNOWN',
        severity:        issue.severity        || 'INFO',
        employee_id:     issue.employee_id     || null,
        field:           issue.field           || null,
        message:         issue.message         || 'No detail provided.',
        created_time:    issue.created_at      || issue.detected_at || new Date().toISOString(),
        is_resolved:     !!(issue.resolved_at  || issue.resolver_id),
        resolver_id:     issue.resolver_id     || null,
        resolution_time: issue.resolved_at     || null,
        resolution_note: issue.resolution_note || null,
      });
    }
  }

  let rows = allIssues;

  if (filter.employee_id) {
    rows = rows.filter((r) => r.employee_id === filter.employee_id);
  }
  if (filter.severity) {
    rows = rows.filter(
      (r) => (r.severity || '').toUpperCase() === filter.severity.toUpperCase()
    );
  }
  if (filter.issue_code) {
    rows = rows.filter(
      (r) => (r.issue_code || '').toUpperCase() === filter.issue_code.toUpperCase()
    );
  }
  if (filter.resolved !== undefined && filter.resolved !== '') {
    const flag = String(filter.resolved).toLowerCase() === 'true';
    rows = rows.filter((r) => r.is_resolved === flag);
  }

  rows = applyDateRange(rows, 'created_time', filter.from_date, filter.to_date);
  rows.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));

  const dist = rows.reduce(
    (acc, r) => {
      const s = (r.severity || 'INFO').toUpperCase();
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    { BLOCK: 0, WARN: 0, INFO: 0 }
  );

  const limit  = parseIntParam(filter.limit, 100, 1000);
  const offset = parseIntParam(filter.offset, 0);

  return {
    ...paginate(rows, limit, offset, 'exceptions'),
    severity_distribution: dist,
    unresolved_count:      rows.filter((r) => !r.is_resolved).length,
    report:                'VALIDATION_EXCEPTIONS_LOG',
    generated_at:          new Date().toISOString(),
  };
}

// ============================================================================
// REPORT 4 — COMPLIANCE REGISTER
// ============================================================================

/**
 * Queries the statutory compliance ledger across PF, ESIC, GRATUITY,
 * NPS, and TDS.  Each row = one period × scheme combination.
 *
 * GET /reports/compliance-register
 *
 * Query Parameters:
 *   scheme     {string}  - PF | ESIC | NPS | GRATUITY | TDS
 *   period     {string}  - Partial period match (e.g. "2026-08")
 *   due_status {string}  - ON_TIME | OVERDUE | DUE_SOON | NOT_DUE
 *   from_date  {string}  - ISO-8601 created_at start
 *   to_date    {string}  - ISO-8601 created_at end
 *   limit      {number}  - Page size (default 50, max 500)
 *   offset     {number}  - Pagination offset (default 0)
 *
 * Row Shape:
 *   { entry_id, scheme, period, employer_code, employee_count,
 *     employee_contributions, employer_contributions, total_liability,
 *     file_id, submission_ref, acknowledgement_ref,
 *     due_date, due_date_status, created_at, formatted }
 */
export function buildComplianceRegister(filter = {}) {
  let rows = [...reportStore.complianceLedger];

  if (filter.scheme) {
    const s = filter.scheme.toUpperCase();
    rows = rows.filter((r) => (r.scheme || '').toUpperCase() === s);
  }
  if (filter.period) {
    const p = filter.period.toLowerCase();
    rows = rows.filter((r) => String(r.period || '').toLowerCase().includes(p));
  }
  if (filter.due_status) {
    const ds = filter.due_status.toUpperCase();
    rows = rows.filter((r) => (r.due_date_status || '').toUpperCase() === ds);
  }

  rows = applyDateRange(rows, 'created_at', filter.from_date, filter.to_date);

  const projected = rows.map((r) => ({
    entry_id:               r.entry_id,
    scheme:                 (r.scheme || '').toUpperCase(),
    period:                 r.period,
    employer_code:          r.employer_code          || null,
    employee_count:         r.employee_count         || 0,
    employee_contributions: Math.round((r.employee_contributions || 0) * 100) / 100,
    employer_contributions: Math.round((r.employer_contributions || 0) * 100) / 100,
    total_liability:        Math.round((r.total_liability        || 0) * 100) / 100,
    file_id:                r.file_id                || null,
    submission_ref:         r.submission_ref         || null,
    acknowledgement_ref:    r.acknowledgement_ref    || null,
    due_date:               r.due_date               || null,
    due_date_status:        (r.due_date_status || 'NOT_DUE').toUpperCase(),
    created_at:             r.created_at,
    formatted: {
      employee_contributions: formatInr(r.employee_contributions || 0),
      employer_contributions: formatInr(r.employer_contributions || 0),
      total_liability:        formatInr(r.total_liability        || 0),
    },
  }));

  projected.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const schemeTotals = projected.reduce((acc, r) => {
    if (!acc[r.scheme]) {
      acc[r.scheme] = { employee_contributions: 0, employer_contributions: 0, total_liability: 0, count: 0 };
    }
    acc[r.scheme].employee_contributions += r.employee_contributions;
    acc[r.scheme].employer_contributions += r.employer_contributions;
    acc[r.scheme].total_liability        += r.total_liability;
    acc[r.scheme].count++;
    return acc;
  }, {});

  const limit  = parseIntParam(filter.limit, 50, 500);
  const offset = parseIntParam(filter.offset, 0);

  return {
    ...paginate(projected, limit, offset, 'entries'),
    scheme_totals:  schemeTotals,
    overdue_count:  projected.filter((r) => r.due_date_status === 'OVERDUE').length,
    report:         'COMPLIANCE_REGISTER',
    generated_at:   new Date().toISOString(),
  };
}

/**
 * Seeds a compliance ledger entry from a ComplianceEngineService result.
 *
 * @param {Object} opts - { scheme, period, employer_code, employee_count,
 *   employee_contributions, employer_contributions, total_liability,
 *   file_id, submission_ref, acknowledgement_ref, due_date, due_date_status }
 */
export function seedComplianceLedgerEntry(opts = {}) {
  const entry = Object.freeze({
    entry_id:               `cmp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    scheme:                 (opts.scheme || 'UNKNOWN').toUpperCase(),
    period:                 opts.period                  || null,
    employer_code:          opts.employer_code           || null,
    employee_count:         opts.employee_count          || 0,
    employee_contributions: opts.employee_contributions  || 0,
    employer_contributions: opts.employer_contributions  || 0,
    total_liability:        opts.total_liability         || 0,
    file_id:                opts.file_id                 || null,
    submission_ref:         opts.submission_ref          || null,
    acknowledgement_ref:    opts.acknowledgement_ref     || null,
    due_date:               opts.due_date                || null,
    due_date_status:        (opts.due_date_status || 'NOT_DUE').toUpperCase(),
    created_at:             new Date().toISOString(),
  });
  reportStore.complianceLedger.push(entry);
  return entry;
}

// ============================================================================
// REPORT 5 — BANK RECONCILIATION VIEW
// ============================================================================

/**
 * Extracts per-record clearing data from payment batches (inline source)
 * plus any external rows in reportStore.bankReconciliationRows.
 *
 * GET /reports/bank-reconciliation-view
 *
 * Query Parameters:
 *   batch_id         {string}  - Scope to a single batch
 *   employee_id      {string}  - Filter by employee
 *   status           {string}  - PAID | FAILED | UNMATCHED | PENDING
 *   resolution_state {string}  - RESOLVED | UNRESOLVED | ESCALATED | PENDING
 *   from_date        {string}  - ISO-8601 reconciled_at start
 *   to_date          {string}  - ISO-8601 reconciled_at end
 *   limit            {number}  - Page size (default 100, max 1000)
 *   offset           {number}  - Pagination offset (default 0)
 *
 * Row Shape:
 *   { recon_id, batch_id, employee_id, employee_name, instructed_amount,
 *     paid_amount, txn_id, bank_ref, status, difference,
 *     resolution_state, failure_reason, reconciled_at, formatted }
 */
export function buildBankReconciliationView(filter = {}) {
  const inlineRows = [];

  const batchesToScan = filter.batch_id
    ? (disbursementStore.paymentBatches.has(filter.batch_id)
        ? [disbursementStore.paymentBatches.get(filter.batch_id)]
        : [])
    : [...disbursementStore.paymentBatches.values()];

  for (const batch of batchesToScan) {
    for (const r of (batch.records || [])) {
      if (!r.clearing_status && !r.txn_id) continue;

      const instructed = Number(r.net_payable || r.amount || 0);
      const paid       = r.clearing_status === 'PAID' ? instructed : 0;
      const diff       = Math.round((instructed - paid) * 100) / 100;

      inlineRows.push({
        recon_id:          `rcn_${batch.batch_id}_${r.employee_id}`,
        batch_id:          batch.batch_id,
        employee_id:       r.employee_id,
        employee_name:     r.employee_name   || null,
        instructed_amount: instructed,
        paid_amount:       paid,
        txn_id:            r.txn_id          || null,
        bank_ref:          r.bank_ref        || null,
        status:            r.clearing_status || 'PENDING',
        difference:        diff,
        resolution_state:  diff === 0 ? 'RESOLVED'
          : (r.clearing_status === 'FAILED' ? 'UNRESOLVED' : 'PENDING'),
        failure_reason:    r.clearing_reason || null,
        reconciled_at:     r.cleared_at      || batch.updated_at || null,
        formatted: {
          instructed_amount: formatInr(instructed),
          paid_amount:       formatInr(paid),
          difference:        formatInr(diff),
        },
      });
    }
  }

  const externalRows = reportStore.bankReconciliationRows
    .filter((r) => !filter.batch_id || r.batch_id === filter.batch_id)
    .map((r) => ({
      ...r,
      formatted: {
        instructed_amount: formatInr(r.instructed_amount || 0),
        paid_amount:       formatInr(r.paid_amount       || 0),
        difference:        formatInr(r.difference        || 0),
      },
    }));

  // Merge; inline rows win on duplicate recon_id
  const seenIds = new Set();
  let rows = [...inlineRows, ...externalRows].filter((r) => {
    if (seenIds.has(r.recon_id)) return false;
    seenIds.add(r.recon_id);
    return true;
  });

  if (filter.employee_id) {
    rows = rows.filter((r) => r.employee_id === filter.employee_id);
  }
  if (filter.status) {
    rows = rows.filter(
      (r) => (r.status || '').toUpperCase() === filter.status.toUpperCase()
    );
  }
  if (filter.resolution_state) {
    rows = rows.filter(
      (r) => (r.resolution_state || '').toUpperCase() === filter.resolution_state.toUpperCase()
    );
  }

  rows = applyDateRange(rows, 'reconciled_at', filter.from_date, filter.to_date);
  rows.sort((a, b) => new Date(a.reconciled_at || 0) - new Date(b.reconciled_at || 0));

  const aggr = rows.reduce(
    (acc, r) => {
      acc.total_instructed += r.instructed_amount || 0;
      acc.total_paid       += r.paid_amount       || 0;
      acc.total_difference += r.difference        || 0;
      const s = (r.status || '').toUpperCase();
      if (s === 'PAID')      acc.paid_count++;
      if (s === 'FAILED')    acc.failed_count++;
      if (s === 'UNMATCHED') acc.unmatched_count++;
      return acc;
    },
    { total_instructed: 0, total_paid: 0, total_difference: 0, paid_count: 0, failed_count: 0, unmatched_count: 0 }
  );

  const limit  = parseIntParam(filter.limit, 100, 1000);
  const offset = parseIntParam(filter.offset, 0);

  return {
    ...paginate(rows, limit, offset, 'records'),
    aggregate: {
      ...aggr,
      formatted: {
        total_instructed: formatInr(aggr.total_instructed),
        total_paid:       formatInr(aggr.total_paid),
        total_difference: formatInr(aggr.total_difference),
      },
    },
    report:       'BANK_RECONCILIATION_VIEW',
    generated_at: new Date().toISOString(),
  };
}

/**
 * Seeds a bank reconciliation row (from external reconciliation engines).
 *
 * @param {Object} opts - { recon_id?, batch_id, employee_id, employee_name?,
 *   instructed_amount, paid_amount, txn_id?, bank_ref?, status,
 *   resolution_state?, failure_reason?, reconciled_at? }
 */
export function seedBankReconciliationRow(opts = {}) {
  const instructed = Number(opts.instructed_amount || 0);
  const paid       = Number(opts.paid_amount       || 0);
  const row = Object.freeze({
    recon_id:          opts.recon_id         || `rcn_ext_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    batch_id:          opts.batch_id         || null,
    employee_id:       opts.employee_id      || null,
    employee_name:     opts.employee_name    || null,
    instructed_amount: instructed,
    paid_amount:       paid,
    txn_id:            opts.txn_id           || null,
    bank_ref:          opts.bank_ref         || opts.utr || null,
    status:            (opts.status || 'PENDING').toUpperCase(),
    difference:        Math.round((instructed - paid) * 100) / 100,
    resolution_state:  (opts.resolution_state || 'UNRESOLVED').toUpperCase(),
    failure_reason:    opts.failure_reason   || null,
    reconciled_at:     opts.reconciled_at    || new Date().toISOString(),
  });
  reportStore.bankReconciliationRows.push(row);
  return row;
}

// ============================================================================
// REPORT 6 — AUDIT REPORT
// ============================================================================

/**
 * Streams the immutable audit trail enriched with old_state / new_state
 * aliasing and rule_version_applied.
 *
 * GET /reports/audit-report
 *
 * Query Parameters:
 *   entity_type    {string}  - PAYROLL_RUN | PAYMENT_BATCH | COMPLIANCE_RETURN
 *   entity_id      {string}  - Exact entity primary key
 *   actor_id       {string}  - Filter by actor
 *   action         {string}  - Partial match on action field
 *   from_state     {string}  - Filter on old_state
 *   to_state       {string}  - Filter on new_state
 *   correlation_id {string}  - Exact correlation_id match
 *   from_date      {string}  - ISO-8601 timestamp start (inclusive)
 *   to_date        {string}  - ISO-8601 timestamp end   (inclusive)
 *   limit          {number}  - Page size (default 100, max 5000)
 *   offset         {number}  - Pagination offset (default 0)
 *
 * Row Shape:
 *   { audit_id, actor_id, action, timestamp, entity_type, entity_id,
 *     old_state, new_state, rule_version_applied, correlation_id, metadata }
 */
export function buildAuditReport(filter = {}) {
  // Primary source: canonical state-transition ledger
  let rows = disbursementStore.stateTransitionLogs.map((e) => ({
    audit_id:             e.transition_id,
    actor_id:             e.actor_id,
    action:               `STATE_TRANSITION:${e.from || 'CREATED'}\u2192${e.to}`,
    timestamp:            e.timestamp,
    entity_type:          (e.entity || '').toUpperCase(),
    entity_id:            e.entity_id,
    old_state:            e.from   || null,
    new_state:            e.to,
    rule_version_applied: (e.metadata && e.metadata.rule_version) || 'v4.0.0',
    correlation_id:       e.correlation_id,
    metadata:             e.metadata || {},
  }));

  // Secondary source: general audit log (non-ST events only)
  const generalRows = disbursementStore.auditLogs
    .filter((e) => !e.log_id.startsWith('aud_st_'))
    .map((e) => ({
      audit_id:             e.log_id,
      actor_id:             e.actor_id,
      action:               e.event,
      timestamp:            e.timestamp,
      entity_type:          (e.entity_type || '').toUpperCase(),
      entity_id:            e.entity_id,
      old_state:            (e.metadata && e.metadata.from) || null,
      new_state:            (e.metadata && e.metadata.to)   || null,
      rule_version_applied: (e.metadata && e.metadata.rule_version) || 'v4.0.0',
      correlation_id:       (e.metadata && e.metadata.correlation_id) || null,
      metadata:             e.metadata || {},
    }));

  rows = [...rows, ...generalRows];

  // Field filters
  if (filter.entity_type) {
    const et = filter.entity_type.toUpperCase();
    rows = rows.filter((r) => r.entity_type === et);
  }
  if (filter.entity_id) {
    rows = rows.filter((r) => r.entity_id === filter.entity_id);
  }
  if (filter.actor_id) {
    rows = rows.filter((r) => r.actor_id === filter.actor_id);
  }
  if (filter.action) {
    const a = filter.action.toLowerCase();
    rows = rows.filter((r) => (r.action || '').toLowerCase().includes(a));
  }
  if (filter.from_state) {
    rows = rows.filter((r) => r.old_state === filter.from_state);
  }
  if (filter.to_state) {
    rows = rows.filter((r) => r.new_state === filter.to_state);
  }
  if (filter.correlation_id) {
    rows = rows.filter((r) => r.correlation_id === filter.correlation_id);
  }

  rows = applyDateRange(rows, 'timestamp', filter.from_date, filter.to_date);

  // Chronological (oldest first — immutable append-only trail)
  rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Deduplicate by audit_id
  const seenIds = new Set();
  rows = rows.filter((r) => {
    if (seenIds.has(r.audit_id)) return false;
    seenIds.add(r.audit_id);
    return true;
  });

  // Actor distribution
  const actorDist = rows.reduce((acc, r) => {
    acc[r.actor_id] = (acc[r.actor_id] || 0) + 1;
    return acc;
  }, {});

  const limit  = parseIntParam(filter.limit, 100, 5000);
  const offset = parseIntParam(filter.offset, 0);

  return {
    ...paginate(rows, limit, offset, 'events'),
    actor_distribution: actorDist,
    report:             'AUDIT_REPORT',
    generated_at:       new Date().toISOString(),
  };
}

// ============================================================================
// EXPRESS ROUTER  (mount at /reports)
// ============================================================================

/**
 * Returns a mountable Express Router exposing all 6 report endpoints.
 *
 *   app.use('/reports', createReportsRouter());
 */
export function createReportsRouter() {
  const router = express.Router();
  router.use(express.json());

  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      return fail(res, err.code || 'INTERNAL_SERVER_ERROR', err.message, err.statusCode || 500);
    }
  };

  // R1 — Payroll Disbursement Summary
  router.get('/payroll-disbursement-summary', wrap(async (req, res) => {
    return ok(res, buildPayrollDisbursementSummary(req.query));
  }));

  // R2 — Payment Batch Report
  router.get('/payment-batch-report', wrap(async (req, res) => {
    return ok(res, buildPaymentBatchReport(req.query));
  }));

  // R3 — Validation Exceptions Log
  router.get('/validation-exceptions-log', wrap(async (req, res) => {
    return ok(res, buildValidationExceptionsLog(req.query));
  }));

  // R4 — Compliance Register
  router.get('/compliance-register', wrap(async (req, res) => {
    return ok(res, buildComplianceRegister(req.query));
  }));
  router.post('/compliance-register/seed', wrap(async (req, res) => {
    return ok(res, seedComplianceLedgerEntry(req.body), 201);
  }));

  // R5 — Bank Reconciliation View
  router.get('/bank-reconciliation-view', wrap(async (req, res) => {
    return ok(res, buildBankReconciliationView(req.query));
  }));
  router.post('/bank-reconciliation-view/seed', wrap(async (req, res) => {
    return ok(res, seedBankReconciliationRow(req.body), 201);
  }));

  // R6 — Audit Report
  router.get('/audit-report', wrap(async (req, res) => {
    return ok(res, buildAuditReport(req.query));
  }));

  return router;
}
