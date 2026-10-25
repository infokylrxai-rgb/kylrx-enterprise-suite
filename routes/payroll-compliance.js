const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { rawCollection } = require('../config/firebase');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Statutory Compliance tab (admin-payroll-documents.html#compliance).
 *
 * Reads this organization's statutory engine output — pf/esic/nps compliance batches,
 * gratuity settlements and finalized payroll runs — and reports, per month:
 *   - PF, ESIC, NPS, PT, TDS and gratuity amounts exactly as the batches/runs hold them
 *   - batch status, ECR/contribution file names and blocking exceptions
 *   - a reconciliation of each batch against the payroll run's employee lines
 * plus a check of the statutory identifiers on record (TAN/PAN/ESIC code, employee UAN/PAN/
 * ESIC IP) and the data for a filing-pack export. Nothing here writes to Firestore.
 */

const DATE_KEY = (d) => String(d.updated_at || d.created_at || d.finalized_at || '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const PERIOD_RE = /^\d{4}-\d{2}$/;

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function sendError(res, err, context) {
    logger.error(`[PayrollComplianceAPI] ${context}:`, err.message);
    res.status(err.status || 500).json({ success: false, error: err.message, message: err.message });
}

/** The most recently updated record for a period */
function latestFor(list, period) {
    return list.filter(x => x.period === period).sort((a, b) => DATE_KEY(b).localeCompare(DATE_KEY(a)))[0] || null;
}

async function loadSources(orgId) {
    const [pf, esic, nps, gratuity, runs] = await Promise.all([
        orgDocs(rawCollection, 'pf_compliance_batches', orgId),
        orgDocs(rawCollection, 'esic_compliance_batches', orgId),
        orgDocs(rawCollection, 'nps_compliance_batches', orgId),
        orgDocs(rawCollection, 'gratuity_settlements', orgId),
        orgDocs(rawCollection, 'payroll_runs', orgId)
    ]);
    return { pf, esic, nps, gratuity, runs: runs.filter(r => /final|approved|disbursed|locked|frozen/i.test(String(r.status || ''))) };
}

/** Employee lines of a payroll run, with the field names the payroll engines use */
function runLines(run) {
    return (run && Array.isArray(run.employees) ? run.employees : []).map(e => ({
        id: e.employee_id || e.id,
        name: e.employee_name || e.name || '',
        pfEe: num(e.pf_employee_share ?? e.pf_ee),
        pfEr: num(e.pf_employer_share ?? e.pf_er),
        esicEe: num(e.esic_employee_share ?? e.esic_ee),
        esicEr: num(e.esic_employer_share ?? e.esic_er),
        npsEe: num(e.nps_employee_share ?? e.nps_ee),
        npsEr: num(e.nps_employer_share ?? e.nps_er),
        pt: num(e.professional_tax ?? e.pt),
        tds: num(e.tds_deduction ?? e.tds),
        gratuity: num(e.gratuity_provision ?? e.gratuity_accrual)
    }));
}

const sum = (lines, key) => lines.reduce((s, l) => s + l[key], 0);
const covered = (lines, ...keys) => lines.filter(l => keys.some(k => l[k] > 0)).length;

function head({ key, name, act, body, batch, employer, employee, total, members, file, reference, run, runTotal, notes }) {
    const processed = Boolean(batch);
    const difference = processed && run ? Math.round((total - runTotal) * 100) / 100 : null;
    return {
        key, name, act, body,
        processed,
        status: batch ? String(batch.status || batch.current_stage || 'PROCESSED').toUpperCase() : (run ? 'NOT PROCESSED' : 'NO PAYROLL'),
        batchId: batch ? batch.batch_id || batch.id : null,
        members,
        employerShare: Math.round(employer * 100) / 100,
        employeeShare: Math.round(employee * 100) / 100,
        total: Math.round(total * 100) / 100,
        file: file || null,
        reference: reference || null,
        blocking: batch ? num(batch.unresolved_blocking_count ?? (batch.is_blocked ? 1 : 0)) : 0,
        exceptions: batch ? num(batch.exceptions_count) : 0,
        reconciliation: difference === null ? null : { payrollRunTotal: Math.round(runTotal * 100) / 100, difference, matches: Math.abs(difference) < 1 },
        notes: notes || []
    };
}

function buildPeriod(sources, period) {
    const pf = latestFor(sources.pf, period);
    const esic = latestFor(sources.esic, period);
    const nps = latestFor(sources.nps, period);
    const grat = latestFor(sources.gratuity, period);
    const run = latestFor(sources.runs, period);
    const lines = runLines(run);

    const heads = [
        head({
            key: 'pf', name: 'Provident Fund (EPF & EPS)', act: 'EPF Act 1952 · ECR monthly', body: 'EPFO',
            batch: pf,
            employer: pf ? num(pf.total_er_epf_share) + num(pf.total_eps_share) + num(pf.total_edli_charges) + num(pf.total_admin_charges) : sum(lines, 'pfEr'),
            employee: pf ? num(pf.total_ee_share) : sum(lines, 'pfEe'),
            total: pf ? num(pf.total_challan_amount) : sum(lines, 'pfEe') + sum(lines, 'pfEr'),
            members: pf ? num(pf.total_subscribers) : covered(lines, 'pfEe', 'pfEr'),
            file: pf && pf.file_manifest ? pf.file_manifest.file_name : null,
            reference: pf ? pf.trrn || pf.trrn_number || pf.challan_number || null : null,
            run, runTotal: sum(lines, 'pfEe') + sum(lines, 'pfEr'),
            notes: pf ? ['Employer share includes EPS, EDLI and admin charges.'] : []
        }),
        head({
            key: 'esic', name: 'Employee State Insurance (ESI)', act: 'ESI Act 1948 · monthly', body: 'ESIC',
            batch: esic,
            employer: esic ? num(esic.total_employer_amount) : sum(lines, 'esicEr'),
            employee: esic ? num(esic.total_employee_amount) : sum(lines, 'esicEe'),
            total: esic ? num(esic.total_contribution_amount ?? esic.total_challan) : sum(lines, 'esicEe') + sum(lines, 'esicEr'),
            members: esic ? num(esic.total_subscribers ?? esic.covered_count) : covered(lines, 'esicEe', 'esicEr'),
            file: esic && esic.file_manifest ? esic.file_manifest.txt_file_name || esic.file_manifest.file_name : null,
            reference: esic ? esic.challan_number || esic.challan_id || null : null,
            run, runTotal: sum(lines, 'esicEe') + sum(lines, 'esicEr'),
            notes: esic && esic.employer_code ? [`Employer code ${esic.employer_code}.`] : []
        }),
        head({
            key: 'nps', name: 'National Pension System (NPS)', act: 'PFRDA · corporate NPS', body: 'PFRDA / NSDL',
            batch: nps,
            employer: nps ? num(nps.total_employer_amount) : sum(lines, 'npsEr'),
            employee: nps ? num(nps.total_employee_amount) : sum(lines, 'npsEe'),
            total: nps ? num(nps.total_contribution_amount ?? nps.total_contribution) : sum(lines, 'npsEe') + sum(lines, 'npsEr'),
            members: nps ? num(nps.total_subscribers ?? nps.subscribers_count) : covered(lines, 'npsEe', 'npsEr'),
            reference: nps ? nps.prn_acknowledgement_token || null : null,
            run, runTotal: sum(lines, 'npsEe') + sum(lines, 'npsEr')
        }),
        // PT and TDS are deducted in the payroll run (no separate batch)
        {
            ...head({
                key: 'pt', name: 'Professional Tax (PT)', act: 'State PT Act · monthly/annual return', body: 'State Commercial Taxes',
                batch: run, employer: 0, employee: sum(lines, 'pt'), total: sum(lines, 'pt'),
                members: covered(lines, 'pt'), run: null, runTotal: 0,
                notes: ['Deducted from employees in the payroll run; PT has no employer share.']
            }),
            status: run ? 'DEDUCTED IN PAYROLL' : 'NO PAYROLL'
        },
        {
            ...head({
                key: 'tds', name: 'TDS on Salary (Form 24Q)', act: 'Income Tax Act s.192 · quarterly 24Q', body: 'Income Tax Department',
                batch: run, employer: 0, employee: sum(lines, 'tds'), total: sum(lines, 'tds'),
                members: covered(lines, 'tds'), run: null, runTotal: 0,
                notes: ['Deducted in the payroll run; deposit by the 7th of next month and file 24Q quarterly.']
            }),
            status: run ? 'DEDUCTED IN PAYROLL' : 'NO PAYROLL'
        },
        head({
            key: 'gratuity', name: 'Gratuity', act: 'Payment of Gratuity Act 1972', body: 'Internal provision / trust',
            batch: grat,
            employer: grat ? num(grat.total_gratuity_payable ?? grat.total_gratuity_amount) : sum(lines, 'gratuity'),
            employee: 0,
            total: grat ? num(grat.total_gratuity_payable ?? grat.total_gratuity_amount) : sum(lines, 'gratuity'),
            members: grat ? num(grat.total_eligible_count ?? grat.eligible_count) : covered(lines, 'gratuity'),
            run: null, runTotal: 0,
            notes: grat ? [grat.is_maker_checker_approved || grat.is_approved ? 'Approved by a checker.' : 'Awaiting maker-checker approval.'] : []
        })
    ];

    return {
        period,
        payrollRun: run ? { id: run.payroll_run_id || run.run_id || run.id, status: run.status, employees: lines.length, finalizedAt: run.finalized_at || null } : null,
        heads,
        totals: {
            employer: Math.round(heads.reduce((s, h) => s + h.employerShare, 0) * 100) / 100,
            employee: Math.round(heads.reduce((s, h) => s + h.employeeShare, 0) * 100) / 100,
            total: Math.round(heads.reduce((s, h) => s + h.total, 0) * 100) / 100
        },
        employeeLines: lines
    };
}

function periodsOf(sources) {
    const set = new Set();
    [...sources.pf, ...sources.esic, ...sources.nps, ...sources.gratuity, ...sources.runs].forEach(x => { if (PERIOD_RE.test(String(x.period || ''))) set.add(x.period); });
    return [...set].sort().reverse();
}

// GET /api/payroll-compliance/overview?period=YYYY-MM
router.get('/overview', async (req, res) => {
    try {
        const sources = await loadSources(orgOf(req));
        const periods = periodsOf(sources);
        const period = PERIOD_RE.test(String(req.query.period || '')) ? req.query.period : periods[0];
        if (!period) {
            return res.json({ success: true, data: { periods: [], period: null, heads: [], totals: { employer: 0, employee: 0, total: 0 }, payrollRun: null } });
        }
        const { employeeLines, ...data } = buildPeriod(sources, period);
        res.json({ success: true, data: { periods, ...data } });
    } catch (err) {
        sendError(res, err, 'Overview error');
    }
});

// GET /api/payroll-compliance/filing-pack?period=YYYY-MM - Everything for the month's export
router.get('/filing-pack', async (req, res) => {
    try {
        const period = String(req.query.period || '');
        if (!PERIOD_RE.test(period)) return res.status(400).json({ success: false, error: 'Choose a month (YYYY-MM).' });
        const sources = await loadSources(orgOf(req));
        const data = buildPeriod(sources, period);
        res.json({ success: true, data: { ...data, generatedAt: new Date().toISOString() } });
    } catch (err) {
        sendError(res, err, 'Filing pack error');
    }
});

const FORMATS = {
    PAN: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    TAN: /^[A-Z]{4}[0-9]{5}[A-Z]$/,
    GSTIN: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    UAN: /^[0-9]{12}$/,
    ESIC_IP: /^[0-9]{10}$/,
    ESIC_EMPLOYER: /^[0-9]{17}$/
};
const first = (o, keys) => { for (const k of keys) { if (o && o[k] !== undefined && String(o[k]).trim()) return String(o[k]).trim().toUpperCase(); } return ''; };

// GET /api/payroll-compliance/identifiers - Statutory identifiers on record and their format
router.get('/identifiers', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const [orgSnap, users, esicBatches] = await Promise.all([
            rawCollection('organizations').doc(orgId).get(),
            orgDocs(rawCollection, 'users', orgId, 2000),
            orgDocs(rawCollection, 'esic_compliance_batches', orgId)
        ]);
        const org = orgSnap.exists ? orgSnap.data() : {};
        const check = (label, value, format, required = true) => ({
            label,
            value: value ? (label.includes('PAN') || label.includes('TAN') ? `${value.slice(0, 3)}•••${value.slice(-2)}` : value) : null,
            status: !value ? (required ? 'missing' : 'not set') : (format && !format.test(value) ? 'invalid format' : 'ok')
        });
        const esicCode = first(org, ['esicEmployerCode', 'esic_employer_code', 'ESIC_Code']) || (esicBatches.find(b => b.employer_code) || {}).employer_code || '';
        const company = [
            check('Company PAN', first(org, ['pan', 'PAN']), FORMATS.PAN),
            check('TAN (for TDS / 24Q)', first(org, ['tan', 'TAN']), FORMATS.TAN),
            check('GSTIN', first(org, ['gstin', 'GSTIN']), FORMATS.GSTIN, false),
            check('EPF establishment code', first(org, ['pfEstablishmentCode', 'epfEstablishmentCode', 'pf_code', 'PF_Code']), null),
            check('ESIC employer code', String(esicCode).toUpperCase(), FORMATS.ESIC_EMPLOYER),
            check('PT registration (state)', first(org, ['ptRegistrationNumber', 'pt_registration', 'PT_Registration']), null, false)
        ];

        // Active people with a name or email (placeholder records are not employees)
        const active = users.filter(u => (u.name || u.displayName || u.email)
            && !(u.isActive === false || /exited|relieved|inactive|terminated/i.test(String(u.employmentStatus || u.status || ''))));
        const employees = active.map(u => {
            const uan = first(u, ['uan', 'UAN', 'uanNumber']);
            const pan = first(u, ['pan', 'PAN', 'panNumber']);
            const esicIp = first(u, ['esicIp', 'esic_ip', 'esicNumber', 'esic_ip_number']);
            const issues = [];
            if (!pan) issues.push('PAN missing'); else if (!FORMATS.PAN.test(pan)) issues.push('PAN format invalid');
            if (!uan) issues.push('UAN missing'); else if (!FORMATS.UAN.test(uan)) issues.push('UAN must be 12 digits');
            if (esicIp && !FORMATS.ESIC_IP.test(esicIp)) issues.push('ESIC IP must be 10 digits');
            return { id: u.id, name: u.name || u.displayName || u.email, department: u.departmentName || u.department || '', issues };
        }).sort((a, b) => b.issues.length - a.issues.length || String(a.name).localeCompare(String(b.name)));

        const withIssues = employees.filter(e => e.issues.length).length;
        res.json({
            success: true,
            data: {
                company,
                employees,
                summary: {
                    companyOk: company.filter(c => c.status === 'ok').length,
                    companyChecked: company.length,
                    employeesChecked: employees.length,
                    employeesWithIssues: withIssues
                },
                checkedAt: new Date().toISOString()
            }
        });
    } catch (err) {
        sendError(res, err, 'Identifiers error');
    }
});

module.exports = router;
