/**
 * Operational Dashboard (operational-dashboard.html): payroll runs, payment batches, statutory
 * exceptions, compliance returns, bank reconciliation and the audit log of one organization,
 * normalised to one row shape per report, plus the AI Ops Review.
 *
 * review(): findings ranked by severity, each with the evidence and the next action —
 *   critical/open exceptions, failed or unapproved batches, maker = checker approvals,
 *   reconciliation differences and duplicate bank references, overdue or due-soon returns,
 *   finalised runs without a payment batch and runs whose net pay jumps against the median.
 * anomalies(): per-run flags used on the Disbursement tab.
 * Rule-based; with OPENAI_API_KEY set only the counts and amounts (no names) are sent to the
 * model to word the summary.
 */
const openai = require('./openai-client');

const DAY = 86400000;
const aiConfigured = () => openai.isConfigured();

const toIso = (v) => {
    if (!v) return '';
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v._seconds !== undefined) return new Date(v._seconds * 1000).toISOString();
    return String(v);
};
const toMs = (v) => {
    const t = Date.parse(toIso(v));
    return Number.isFinite(t) ? t : null;
};
const num = (...values) => {
    for (const v of values) {
        const n = Number(v);
        if (v !== undefined && v !== null && v !== '' && Number.isFinite(n)) return n;
    }
    return 0;
};
const upper = (v, fallback = '—') => (v ? String(v).toUpperCase().replace(/\s+/g, '_') : fallback);
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// Test artifacts written by scripts (ids containing TEST/SEED/MOCK, zero-state runs)
function isTestRecord(r) {
    const ids = [r.id, r.run_id, r.batch_id, r.exception_id, r.entry_id].filter(Boolean).map(s => String(s).toUpperCase());
    return ids.some(id => /TEST|SEED|MOCK/.test(id) || /_ZERO$|_FINAI$/.test(id));
}

function normaliseRun(r) {
    const gross = num(r.gross_payroll, r.total_gross, r.totals && r.totals.total_gross_earnings);
    const ded = num(r.total_deductions, r.totals && r.totals.total_employee_deductions);
    return {
        run_id: r.run_id || r.payroll_run_id || r.id,
        period: r.period || '—',
        total_employees: num(r.total_employees, r.employee_count, r.totals && r.totals.total_headcount),
        gross_payroll: gross,
        total_deductions: ded,
        net_salary: num(r.net_salary, r.total_net, r.totals && r.totals.total_net_payable, gross - ded),
        employer_contributions: num(r.employer_contributions, r.totals && r.totals.total_employer_contributions),
        payment_date: toIso(r.payment_date || r.paid_at || r.finalized_at),
        status: upper(r.status, 'DRAFT')
    };
}

function normaliseBatch(b) {
    return {
        batch_id: b.batch_id || b.batchId || b.id,
        run_id: b.run_id || b.runId || b.payrollRunId || '—',
        batch_type: upper(b.batch_type || b.type, 'SALARY'),
        total_amount: num(b.total_amount, b.totalAmount, b.totalNet),
        total_records: num(b.total_records, b.record_count, b.recordCount, b.employeeCount, Array.isArray(b.records) ? b.records.length : undefined),
        validation_status: upper(b.validation_status || b.validationStatus),
        approval_state: upper(b.approval_state || b.approval_status || b.approvalStatus),
        submission_status: upper(b.submission_status || b.submissionStatus),
        paid_count: num(b.paid_count, b.paidCount),
        failed_count: num(b.failed_count, b.failedCount),
        state: upper(b.status || b.state),
        maker_id: b.maker_id || b.makerId || b.createdBy || '',
        checker_id: b.checker_id || b.checkerId || b.approvedBy || '',
        created_at: toIso(b.created_at || b.createdAt || b.file_generated_at)
    };
}

function normaliseException(e) {
    return {
        exception_id: e.exception_id || e.id,
        batch_id: e.batch_id || e.batchId || '—',
        employee_id: e.employee_id || e.employeeId || '—',
        employee_name: e.employee_name || e.employeeName || '—',
        rule_code: e.rule_code || e.ruleCode || e.code || '—',
        severity: upper(e.severity, 'WARNING'),
        message: e.message || e.description || '',
        field: e.field || '—',
        status: upper(e.status, 'OPEN'),
        raised_at: toIso(e.raised_at || e.created_at || e.createdAt || e.timestamp)
    };
}

function normaliseReturn(c, now) {
    const ee = num(c.employee_contributions, c.employeeContribution);
    const er = num(c.employer_contributions, c.employerContribution);
    const due = toIso(c.due_date || c.dueDate);
    const filed = !!(c.acknowledgement_ref || c.ackRef || /filed|submitted|acknowledged|paid/i.test(String(c.status || '')));
    const dueMs = toMs(due);
    // Status from the due date when the record does not carry one
    const derived = filed ? 'FILED' : dueMs === null ? 'PENDING' : dueMs < now ? 'OVERDUE' : dueMs - now <= 7 * DAY ? 'DUE_SOON' : 'ON_TIME';
    return {
        entry_id: c.entry_id || c.return_id || c.id,
        scheme: c.scheme || c.type || '—',
        period: c.period || c.wage_month || '—',
        employer_code: c.employer_code || c.establishment_code || '—',
        employee_count: num(c.employee_count, c.member_count),
        employee_contributions: ee,
        employer_contributions: er,
        total_liability: num(c.total_liability, c.totalLiability, ee + er),
        due_date: due,
        due_date_status: c.due_date_status ? upper(c.due_date_status) : derived,
        acknowledgement_ref: c.acknowledgement_ref || c.ackRef || ''
    };
}

function normaliseRecon(r) {
    const instructed = num(r.instructed_amount, r.instructedAmount);
    const paid = num(r.paid_amount, r.paidAmount);
    const diff = num(r.difference, paid - instructed);
    return {
        recon_id: r.recon_id || r.reconciliation_id || r.id,
        batch_id: r.batch_id || r.batchId || '—',
        employee_id: r.employee_id || r.employeeId || '—',
        employee_name: r.employee_name || r.employeeName || '—',
        instructed_amount: instructed,
        paid_amount: paid,
        difference: diff,
        txn_id: r.txn_id || r.transaction_id || '—',
        bank_ref: r.bank_ref || r.utr || '',
        status: upper(r.status, diff !== 0 ? 'DISCREPANCY' : 'PAID'),
        resolution_state: upper(r.resolution_state, diff === 0 ? 'CLEARED' : 'OPEN'),
        failure_reason: r.failure_reason || '',
        reconciled_at: toIso(r.reconciled_at || r.updatedAt)
    };
}

function normaliseAudit(a) {
    return {
        timestamp: toIso(a.timestamp || a.createdAt || a.created_at),
        actor: a.actor || a.performedBy || a.user || a.userEmail || '—',
        actor_role: a.actor_role || a.role || '—',
        entity: a.entity || (a.employeeId ? 'Employee' : '—'),
        entity_id: a.entity_id || a.employeeId || a.id,
        action: a.action || '—',
        from_state: a.from_state || a.fromType || '',
        to_state: a.to_state || a.toType || '',
        ip_address: a.ip_address || a.ip || '',
        notes: a.notes || a.message || a.employeeName || ''
    };
}

function normalise(raw, now = Date.now()) {
    const hidden = {};
    const keep = (name, list) => list.filter(r => {
        if (!isTestRecord(r)) return true;
        hidden[name] = (hidden[name] || 0) + 1;
        return false;
    });
    const newest = (field) => (a, b) => String(b[field] || '').localeCompare(String(a[field] || ''));
    const audit = keep('audit', raw.audit).map(normaliseAudit).sort(newest('timestamp'));
    audit.forEach((a, i) => { a.seq = audit.length - i; });
    return {
        disbursement: keep('disbursement', raw.runs).map(normaliseRun).sort(newest('period')),
        batch: keep('batch', raw.batches).map(normaliseBatch).sort(newest('created_at')),
        exceptions: keep('exceptions', raw.exceptions).map(normaliseException).sort(newest('raised_at')),
        compliance: keep('compliance', raw.returns).map(c => normaliseReturn(c, now)).sort(newest('due_date')),
        reconciliation: keep('reconciliation', raw.recons).map(normaliseRecon).sort(newest('reconciled_at')),
        audit,
        hidden
    };
}

function median(list) {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Per-run flags: zero headcount, net above gross, and net pay far from the median of other runs. */
function anomalies(runs) {
    const flags = {};
    const add = (id, text) => { (flags[id] = flags[id] || []).push(text); };
    runs.forEach(r => {
        if (/FINAL/.test(r.status) && r.total_employees === 0) add(r.run_id, 'Finalised with 0 employees');
        if (r.net_salary > r.gross_payroll && r.gross_payroll > 0) add(r.run_id, 'Net pay is higher than gross');
        const others = runs.filter(o => o !== r && o.net_salary > 0).map(o => o.net_salary);
        const mid = median(others);
        if (others.length >= 2 && mid && r.net_salary > 0) {
            const change = (r.net_salary - mid) / mid;
            if (Math.abs(change) >= 0.25) add(r.run_id, `Net pay ${change > 0 ? '+' : ''}${Math.round(change * 100)}% against the usual ${inr(mid)}`);
        }
    });
    return flags;
}

function review(data, now = Date.now()) {
    const findings = [];
    const push = (severity, area, title, evidence, action, tab) => findings.push({ severity, area, title, evidence, action, tab });

    const openExc = data.exceptions.filter(e => !/RESOLVED|CLOSED|WAIVED/.test(e.status));
    const critical = openExc.filter(e => e.severity === 'CRITICAL');
    if (critical.length) push('critical', 'Exceptions', `${critical.length} critical exception(s) open`, [...new Set(critical.map(e => e.rule_code))].slice(0, 4).join(', '), 'Resolve these before the next payment batch is released.', 'exceptions');
    else if (openExc.length) push('warning', 'Exceptions', `${openExc.length} exception(s) open`, `Oldest raised ${new Date(Math.min(...openExc.map(e => toMs(e.raised_at) || now))).toLocaleDateString('en-IN')}`, 'Review and resolve or waive with a reason.', 'exceptions');

    const failedBatches = data.batch.filter(b => /FAIL|REJECT/.test(b.state) || b.failed_count > 0);
    if (failedBatches.length) push('critical', 'Payments', `${failedBatches.length} batch(es) with failed payments`, `${failedBatches.reduce((s, b) => s + b.failed_count, 0)} failed record(s) in ${failedBatches.slice(0, 3).map(b => b.batch_id).join(', ')}`, 'Correct the bank details and re-submit the failed records.', 'batch');
    const awaiting = data.batch.filter(b => /PENDING|AWAIT|DRAFT/.test(b.approval_state) && !/PAID|FAIL/.test(b.state));
    if (awaiting.length) push('warning', 'Payments', `${awaiting.length} batch(es) awaiting approval`, inr(awaiting.reduce((s, b) => s + b.total_amount, 0)) + ' not yet released', 'A checker other than the maker should approve them.', 'batch');
    const emptyBatches = data.batch.filter(b => b.total_records === 0 && b.total_amount === 0);
    if (emptyBatches.length) push('warning', 'Payments', `${emptyBatches.length} batch(es) with no payments in them`, emptyBatches.slice(0, 3).map(b => `${b.batch_id} (${b.state})`).join(', '), 'An empty bank file pays nobody; regenerate it from the finalised run.', 'batch');
    const selfApproved = data.batch.filter(b => b.maker_id && b.checker_id && b.maker_id === b.checker_id);
    if (selfApproved.length) push('critical', 'Controls', `${selfApproved.length} batch(es) approved by their own maker`, selfApproved.slice(0, 3).map(b => b.batch_id).join(', '), 'Maker-checker was bypassed; have a second approver re-check these batches.', 'batch');

    const disc = data.reconciliation.filter(r => r.status !== 'PAID' && !/CLEARED|RESOLVED/.test(r.resolution_state));
    if (disc.length) push(disc.some(r => r.status === 'FAILED') ? 'critical' : 'warning', 'Reconciliation', `${disc.length} unreconciled payment(s)`, `Net difference ${inr(Math.abs(disc.reduce((s, r) => s + r.difference, 0)))}`, 'Match these against the bank statement and record a resolution.', 'reconciliation');
    const refs = new Map();
    data.reconciliation.forEach(r => { if (r.bank_ref) refs.set(r.bank_ref, (refs.get(r.bank_ref) || 0) + 1); });
    const dupes = [...refs].filter(([, n]) => n > 1);
    if (dupes.length) push('critical', 'Reconciliation', `${dupes.length} bank reference(s) used on more than one payment`, dupes.slice(0, 3).map(([ref, n]) => `${ref} ×${n}`).join(', '), 'A UTR belongs to one transfer; check for duplicate postings.', 'reconciliation');

    const overdue = data.compliance.filter(c => c.due_date_status === 'OVERDUE');
    const dueSoon = data.compliance.filter(c => c.due_date_status === 'DUE_SOON');
    if (overdue.length) push('critical', 'Compliance', `${overdue.length} statutory return(s) overdue`, overdue.slice(0, 4).map(c => `${c.scheme} ${c.period}`).join(', ') + ` · ${inr(overdue.reduce((s, c) => s + c.total_liability, 0))} liability`, 'File and pay now; interest and damages accrue daily.', 'compliance');
    if (dueSoon.length) push('warning', 'Compliance', `${dueSoon.length} return(s) due within 7 days`, dueSoon.slice(0, 4).map(c => `${c.scheme} ${c.period}`).join(', '), 'Prepare the challans this week.', 'compliance');

    const batchedRuns = new Set(data.batch.map(b => b.run_id));
    const unpaid = data.disbursement.filter(r => /FINAL|APPROVED|LOCKED/.test(r.status) && r.net_salary > 0 && !batchedRuns.has(r.run_id));
    if (unpaid.length) push('warning', 'Payments', `${unpaid.length} finalised run(s) without a payment batch`, unpaid.slice(0, 3).map(r => `${r.period} (${inr(r.net_salary)})`).join(', '), 'Create the disbursement batch so salaries are paid.', 'batch');

    const flags = anomalies(data.disbursement);
    const flagged = Object.entries(flags);
    if (flagged.length) push('warning', 'Payroll', `${flagged.length} payroll run(s) look unusual`, flagged.slice(0, 3).map(([id, f]) => `${id}: ${f[0]}`).join('; '), 'Check headcount and pay changes before paying.', 'disbursement');

    const lastAudit = data.audit[0] && toMs(data.audit[0].timestamp);
    if (data.disbursement.length && (!lastAudit || now - lastAudit > 30 * DAY)) push('info', 'Audit', 'No audit entries in the last 30 days', lastAudit ? `Last entry ${new Date(lastAudit).toLocaleDateString('en-IN')}` : 'The audit log is empty', 'Confirm payroll actions are being logged.', 'audit');

    const order = { critical: 0, warning: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    const score = Math.max(0, 100 - findings.reduce((s, f) => s + (f.severity === 'critical' ? 25 : f.severity === 'warning' ? 10 : 3), 0));
    const empty = !data.disbursement.length && !data.batch.length && !data.exceptions.length && !data.compliance.length && !data.reconciliation.length;
    return {
        score,
        label: empty ? 'No data' : score >= 85 ? 'Healthy' : score >= 60 ? 'Needs attention' : 'At risk',
        findings,
        flags,
        summary: empty
            ? 'No payroll runs, payment batches, exceptions, returns or reconciliation records yet. Findings appear as payroll is processed.'
            : findings.length
                ? `${findings.filter(f => f.severity === 'critical').length} critical and ${findings.filter(f => f.severity === 'warning').length} warning finding(s). Start with: ${findings[0].title.toLowerCase()}.`
                : 'No issues found across runs, batches, exceptions, returns and reconciliation.',
        source: 'rules'
    };
}

/** Optional model wording of the summary from counts only. */
async function summarise(result) {
    if (!aiConfigured() || !result.findings.length) return result;
    try {
        const out = await openai.chatJson([
            { role: 'system', content: 'You are a payroll operations analyst. Write a 2-sentence summary for a finance admin from the findings given. Do not invent facts. Reply as JSON: {"summary": string}.' },
            { role: 'user', content: JSON.stringify({ score: result.score, findings: result.findings.map(f => ({ severity: f.severity, area: f.area, title: f.title, action: f.action })) }) }
        ]);
        if (out && typeof out.summary === 'string' && out.summary.trim()) return { ...result, summary: out.summary.trim().slice(0, 500), source: 'openai' };
    } catch (_) { /* rule summary stays */ }
    return result;
}

module.exports = { aiConfigured, normalise, anomalies, review, summarise, isTestRecord };
