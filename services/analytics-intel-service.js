/**
 * Enterprise Analytics (admin-analysis.html): workforce, productivity, payroll and retention
 * figures from one organization's records, plus a trend forecast.
 *
 * Scores are stored on different scales (EOD manager scores 1–5, PMS running averages 0–1,
 * percentages), so every score is normalised to 0–100 before it is averaged.
 * The forecast is a least-squares line over the months that have scores; with fewer than two
 * such months there is no forecast. Rule-based; nothing is sent to an external model.
 */
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toMs = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v._seconds !== undefined) return v._seconds * 1000;
    const t = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(t) ? t : null;
};
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const named = (u) => u.name || u.displayName || u.email;
const exitedRecord = (u) => u.isActive === false || /exited|relieved|terminated|inactive/i.test(String(u.employmentStatus || u.status || ''));
const activeMember = (u) => named(u) && !exitedRecord(u) && !/^(Trash|Deleted)$/.test(String(u.inactivityStatus || ''));
const round1 = (n) => Math.round(n * 10) / 10;

function percentScore(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    if (n <= 1) return n * 100;
    if (n <= 5) return n * 20;
    return Math.min(n, 100);
}

function average(list) {
    return list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;
}

function workforce({ users, exits, now = Date.now() }) {
    const people = users.filter(named);
    const active = people.filter(activeMember);
    const yearAgo = now - 365 * DAY;
    const exitedLastYear = people.filter(u => exitedRecord(u) && (toMs(u.exitDate) || toMs(u.relievedAt) || toMs(u.updatedAt) || 0) >= yearAgo);
    const closedCases = exits.filter(e => e.status === 'Closed' && (toMs(e.closedAt) || toMs(e.updatedAt) || 0) >= yearAgo);
    const leavers = Math.max(exitedLastYear.length, closedCases.length);
    const leadership = active.filter(u => /admin|manager|lead|hr|ceo|director/i.test(String(u.role || ''))).length;
    return {
        headcount: active.length,
        employees: active.length - leadership,
        leadership,
        leavers,
        retention: active.length + leavers ? round1((active.length / (active.length + leavers)) * 100) : null
    };
}

/** Latest score per member (PMS metric, else the user record), normalised to 0–100. */
function memberScores(users, metrics) {
    const byId = new Map(metrics.map(m => [m.employeeId || m.id, m]));
    const scores = new Map();
    users.filter(activeMember).forEach(u => {
        const m = byId.get(u.id) || byId.get(u.uid);
        const s = percentScore(m ? m.overallScore : u.productivity);
        if (s !== null) scores.set(u.id, s);
    });
    return scores;
}

function productivity(users, metrics) {
    const scores = memberScores(users, metrics);
    const accuracy = users.filter(activeMember).map(u => percentScore(u.accuracy ?? u.performanceScore)).filter(n => n !== null);
    const avg = average([...scores.values()]);
    const acc = average(accuracy);
    return {
        average: avg === null ? null : round1(avg),
        scored: scores.size,
        accuracy: acc === null ? null : round1(acc),
        accuracyScored: accuracy.length,
        scores
    };
}

function departments(users, scores) {
    const map = new Map();
    users.filter(activeMember).forEach(u => {
        const name = u.departmentName || u.department || 'Unassigned';
        const d = map.get(name) || { name, headcount: 0, values: [] };
        d.headcount++;
        if (scores.has(u.id)) d.values.push(scores.get(u.id));
        map.set(name, d);
    });
    return [...map.values()].map(d => ({
        name: d.name,
        headcount: d.headcount,
        scored: d.values.length,
        score: d.values.length ? round1(average(d.values)) : null
    })).sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name));
}

/** Monthly average score for the last six months, from PMS snapshots and reviewed EODs. */
function trends({ snapshots, eods, memberIds, now = Date.now() }) {
    const points = [];
    snapshots.forEach(s => { if (memberIds.has(s.employeeId)) points.push([toMs(s.timestamp) || toMs(s.date), percentScore(s.score)]); });
    eods.forEach(e => {
        const id = e.employeeId || e.userId || e.uid;
        if (memberIds.has(id)) points.push([toMs(e.scoredAt) || toMs(e.submittedAt), percentScore(e.managerScore)]);
    });
    const today = new Date(now);
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, values: [] });
    }
    points.forEach(([at, score]) => {
        if (!at || score === null) return;
        const d = new Date(at);
        const m = months.find(x => x.key === `${d.getFullYear()}-${d.getMonth()}`);
        if (m) m.values.push(score);
    });
    return months.map(m => ({ label: m.label, score: m.values.length ? round1(average(m.values)) : null, samples: m.values.length }));
}

function forecast(trend) {
    const pts = trend.map((t, i) => [i, t.score]).filter(([, s]) => s !== null);
    if (pts.length < 2) {
        return { available: false, current: pts.length ? pts[0][1] : null, slope: 0, note: pts.length ? 'Only one month has scores, so there is no trend to project yet.' : 'No performance scores yet, so there is nothing to project.' };
    }
    const n = pts.length;
    const mx = average(pts.map(p => p[0]));
    const my = average(pts.map(p => p[1]));
    const slope = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
    const last = trend.length - 1;
    const current = Math.max(0, Math.min(100, my + slope * (last - mx)));
    return {
        available: true,
        current: round1(current),
        slope: round1(slope),
        note: `Trend over ${n} month(s) with scores: ${slope >= 0 ? '+' : ''}${round1(slope)} points per month.`
    };
}

/** Monthly payroll composition: the latest finalised run, else payroll profiles, else salaries on record. */
function payroll({ runs, profiles, users }) {
    const finalised = runs
        .filter(r => /final/i.test(String(r.status || '')) && num(r.total_gross || (r.totals && r.totals.total_gross_earnings)) > 0)
        .sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')))[0];
    const memberIds = new Set(users.flatMap(u => [u.id, u.uid, u.employeeId].filter(Boolean)));

    if (profiles.length) {
        let fixed = 0, variable = 0, incentives = 0, tax = 0;
        profiles.forEach(p => {
            const s = p.salaryStructure || {};
            const base = num(s.baseSalary || s.base || p.salary);
            const variablePay = num(s.variablePay || p.variablePay);
            fixed += base;
            // variablePay up to 100 is a percentage of base, above that an amount
            variable += variablePay <= 100 ? base * variablePay / 100 : variablePay;
            incentives += num(s.incentives || p.monthlyBonus) + num(s.shiftAllowance);
            tax += num(s.taxDeductions || p.taxDeductions);
        });
        const unlinked = profiles.filter(p => !memberIds.has(p.employeeId) && !memberIds.has(p.id)).length;
        return {
            source: 'profiles',
            profiles: profiles.length,
            unlinked,
            fixed: Math.round(fixed), variable: Math.round(variable), incentives: Math.round(incentives), tax: Math.round(tax),
            total: Math.round(fixed + variable + incentives),
            run: finalised ? { period: finalised.period, gross: num(finalised.total_gross || finalised.totals.total_gross_earnings), employees: num(finalised.employee_count) } : null
        };
    }
    if (finalised) {
        const gross = num(finalised.total_gross || finalised.totals.total_gross_earnings);
        return { source: 'run', profiles: 0, unlinked: 0, fixed: gross, variable: 0, incentives: 0, tax: 0, total: gross, run: { period: finalised.period, gross, employees: num(finalised.employee_count) } };
    }
    // Salaries below ₹1,000 are placeholders, not pay
    const salaries = users.filter(activeMember).map(u => num(u.salary)).filter(n => n >= 1000);
    const total = salaries.reduce((s, n) => s + n, 0);
    return { source: salaries.length ? 'salaries' : 'none', profiles: 0, unlinked: 0, salaried: salaries.length, fixed: total, variable: 0, incentives: 0, tax: 0, total, run: null };
}

module.exports = { percentScore, workforce, productivity, departments, trends, forecast, payroll, activeMember };
