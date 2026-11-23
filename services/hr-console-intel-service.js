/**
 * Strategic HR Console intelligence (admin-hr-console.html).
 *
 * workforceMetrics: turnover (last 12 months), headcount, hires (90 days) and a talent health
 *   score with the reasons behind it — from the organization's users, exit cases and EODs.
 * assessCandidate: Recruitment Copilot — priority score and next step per candidate from
 *   time in stage, interview ratings, missing details and source.
 * retentionRisks: employees showing flight-risk signals (open exit case, low EOD scores, no
 *   manager, long time without signing in, early tenure).
 * pipelineInsights: stage conversion and stale-candidate bottlenecks.
 * All rule-based on the organization's own records; nothing is sent to an external model.
 */
const DAY = 86400000;
const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
const STALE_DAYS = { Applied: 7, Screening: 7, Interview: 10, Offer: 7 };

const toMs = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v._seconds !== undefined) return v._seconds * 1000;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
};
const exitedRecord = (u) => u.isActive === false || /exited|relieved|terminated|inactive/i.test(String(u.employmentStatus || u.status || ''));
const named = (u) => u.name || u.displayName || u.email;

function workforceMetrics({ users, exits, eods, signIns, now = Date.now() }) {
    const people = users.filter(named);
    const active = people.filter(u => !exitedRecord(u) && !/^(Trash|Deleted)$/.test(String(u.inactivityStatus || '')));
    const yearAgo = now - 365 * DAY;
    const exitedLastYear = people.filter(u => exitedRecord(u) && (toMs(u.exitDate) || toMs(u.relievedAt) || 0) >= yearAgo);
    const closedCases = exits.filter(e => e.status === 'Closed' && (toMs(e.closedAt) || toMs(e.updatedAt) || 0) >= yearAgo);
    const leavers = Math.max(exitedLastYear.length, closedCases.length);
    const avgHeadcount = (active.length + (active.length + leavers)) / 2 || 1;
    const turnover = Math.round((leavers / avgHeadcount) * 1000) / 10;
    const hires90 = active.filter(u => (toMs(u.joiningDate) || 0) >= now - 90 * DAY && (toMs(u.joiningDate) || 0) <= now).length;
    const openExits = exits.filter(e => e.status !== 'Closed' && e.status !== 'Rejected').length;

    const signedIn = active.filter(u => signIns.get(u.uid || u.id) || toMs(u.lastLoginAt)).length;
    const withManager = active.filter(u => u.managerId || u.reportingManager || u.managerName || /manager|lead|admin|hr/i.test(String(u.role || ''))).length;
    const complete = active.filter(u => (u.departmentName || u.department) && u.designation && u.joiningDate).length;
    const scores = eods.map(e => Number(e.managerScore)).filter(n => Number.isFinite(n) && n > 0);
    const sentiment = scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null;

    // Health score: start at 100 and subtract for each weak signal (with the reason)
    const reasons = [];
    let score = 100;
    const pct = (n) => (active.length ? n / active.length : 1);
    if (turnover > 15) { score -= 25; reasons.push(`Turnover ${turnover}% in 12 months is high.`); }
    else if (turnover > 8) { score -= 12; reasons.push(`Turnover ${turnover}% in 12 months is above 8%.`); }
    if (pct(signedIn) < 0.8) { score -= 15; reasons.push(`${active.length - signedIn} of ${active.length} people have never signed in.`); }
    if (pct(withManager) < 0.9) { score -= 10; reasons.push(`${active.length - withManager} employee(s) have no reporting manager.`); }
    if (pct(complete) < 0.8) { score -= 10; reasons.push(`${active.length - complete} profile(s) lack department, designation or joining date.`); }
    if (openExits) { score -= Math.min(15, openExits * 5); reasons.push(`${openExits} exit case(s) in progress.`); }
    if (sentiment !== null && sentiment < 3) { score -= 15; reasons.push(`Average manager EOD score is ${sentiment.toFixed(1)}/5.`); }
    if (sentiment === null) reasons.push('No reviewed EODs yet, so engagement is not measured.');
    score = Math.max(0, score);
    const label = score >= 85 ? 'High' : score >= 65 ? 'Moderate' : 'Low';

    return {
        headcount: active.length,
        leavers,
        turnover,
        hires90,
        openExits,
        talentScore: { score, label, reasons: reasons.length ? reasons : ['No weak signals found in workforce data.'] }
    };
}

function daysInStage(c, now) {
    const history = Array.isArray(c.stageHistory) ? c.stageHistory : [];
    const last = [...history].reverse().find(h => h.stage === (c.stage || 'Applied'));
    const since = toMs(last && last.at) || toMs(c.updatedAt) || toMs(c.createdAt);
    return since ? Math.floor((now - since) / DAY) : null;
}

function assessCandidate(c, interviews, now = Date.now()) {
    const stage = STAGES.includes(c.stage) ? c.stage : 'Applied';
    const days = daysInStage(c, now);
    const ratings = interviews.map(i => Number(i.rating)).filter(n => Number.isFinite(n) && n > 0);
    const avgRating = ratings.length ? ratings.reduce((s, n) => s + n, 0) / ratings.length : null;
    const pendingFeedback = interviews.filter(i => /completed|done/i.test(String(i.status || '')) && !i.feedback).length;
    const upcoming = interviews.filter(i => /scheduled/i.test(String(i.status || '')) && toMs(i.scheduledAt) > now).length;
    const reasons = [];
    let priority = 40;

    if (stage === 'Hired' || stage === 'Rejected') {
        return { priority: 0, level: 'done', days, avgRating, reasons: [`${stage}.`], next: stage === 'Hired' ? 'Hand over to onboarding' : 'No action' };
    }
    const staleAfter = STALE_DAYS[stage];
    if (days !== null && days > staleAfter) { priority += 25; reasons.push(`${days} days in ${stage} (over ${staleAfter}).`); }
    if (avgRating !== null) {
        if (avgRating >= 4) { priority += 25; reasons.push(`Strong interview rating ${avgRating.toFixed(1)}/5.`); }
        else if (avgRating < 2.5) { priority -= 15; reasons.push(`Weak interview rating ${avgRating.toFixed(1)}/5.`); }
    }
    if (pendingFeedback) { priority += 15; reasons.push(`${pendingFeedback} interview(s) without feedback.`); }
    if (!c.email && !c.phone) { priority += 10; reasons.push('No contact details.'); }
    if (/referral/i.test(String(c.source || ''))) { priority += 5; reasons.push('Referral candidate.'); }
    if (!c.resumeUrl) reasons.push('No resume uploaded.');

    let next;
    if (!c.email && !c.phone) next = 'Add contact details';
    else if (pendingFeedback) next = 'Collect interview feedback';
    else if (stage === 'Applied') next = 'Screen the application';
    else if (stage === 'Screening') next = upcoming ? 'Interview is scheduled' : 'Schedule the first interview';
    else if (stage === 'Interview') next = avgRating !== null && avgRating >= 4 ? 'Move to Offer' : (upcoming ? 'Await the scheduled interview' : avgRating !== null && avgRating < 2.5 ? 'Consider rejecting' : 'Schedule the next round');
    else if (stage === 'Offer') next = days !== null && days > STALE_DAYS.Offer ? 'Follow up on the offer' : 'Await offer acceptance';

    priority = Math.max(0, Math.min(100, priority));
    return { priority, level: priority >= 70 ? 'high' : priority >= 45 ? 'medium' : 'low', days, avgRating: avgRating !== null ? Math.round(avgRating * 10) / 10 : null, reasons, next };
}

function retentionRisks({ users, exits, eods, signIns, now = Date.now() }) {
    const active = users.filter(u => named(u) && !exitedRecord(u) && !/^(Trash|Deleted)$/.test(String(u.inactivityStatus || '')));
    const openExit = new Set(exits.filter(e => e.status !== 'Closed' && e.status !== 'Rejected').map(e => e.employeeId));
    const eodBy = new Map();
    eods.forEach(e => {
        const id = e.employeeId || e.userId || e.uid;
        const n = Number(e.managerScore);
        if (!id || !Number.isFinite(n) || n <= 0) return;
        eodBy.set(id, [...(eodBy.get(id) || []), n]);
    });
    return active.map(u => {
        const signals = [];
        let score = 0;
        if (openExit.has(u.id)) { score += 50; signals.push('Exit case in progress'); }
        const s = eodBy.get(u.id) || eodBy.get(u.uid);
        if (s && s.length >= 2) {
            const avg = s.reduce((a, b) => a + b, 0) / s.length;
            if (avg < 2.5) { score += 25; signals.push(`Low EOD scores (${avg.toFixed(1)}/5)`); }
        }
        if (/^employee$/i.test(String(u.role || 'employee')) && !(u.managerId || u.reportingManager || u.managerName)) { score += 10; signals.push('No reporting manager'); }
        const last = signIns.get(u.uid || u.id) || toMs(u.lastLoginAt);
        if (last && now - last > 30 * DAY) { score += 15; signals.push(`No sign-in for ${Math.floor((now - last) / DAY)} days`); }
        const joined = toMs(u.joiningDate);
        if (joined && joined <= now && now - joined < 90 * DAY) { score += 10; signals.push('First 90 days (early-tenure risk)'); }
        return { id: u.id, name: named(u), department: u.departmentName || u.department || '', score: Math.min(100, score), signals };
    }).filter(r => r.score >= 20).sort((a, b) => b.score - a.score);
}

function pipelineInsights(candidates, assessments) {
    const counts = Object.fromEntries(STAGES.map(s => [s, 0]));
    candidates.forEach(c => { counts[STAGES.includes(c.stage) ? c.stage : 'Applied']++; });
    const insights = [];
    const reached = (stage) => candidates.filter(c => (Array.isArray(c.stageHistory) ? c.stageHistory : []).some(h => h.stage === stage) || c.stage === stage).length;
    const interviewed = reached('Interview');
    const offered = reached('Offer');
    const hired = reached('Hired');
    if (candidates.length >= 3) {
        // Acceptance counts only offers that were decided (hired, or rejected after an offer)
        const declined = candidates.filter(c => c.stage === 'Rejected' && (Array.isArray(c.stageHistory) ? c.stageHistory : []).some(h => h.stage === 'Offer')).length;
        const decided = hired + declined;
        insights.push(`${Math.round((interviewed / candidates.length) * 100)}% of candidates reached interview and ${interviewed ? Math.round((offered / interviewed) * 100) : 0}% of those got an offer`
            + (decided ? `; ${Math.round((hired / decided) * 100)}% of decided offers were accepted.` : `; ${offered - hired} offer(s) still awaiting a decision.`));
        if (decided >= 2 && hired / decided < 0.5) insights.push('Fewer than half of offers are accepted — review compensation or offer speed.');
    }
    const stale = assessments.filter(a => a.reasons.some(r => /days in/.test(r)));
    if (stale.length) insights.push(`${stale.length} candidate(s) are stuck in a stage longer than usual.`);
    const noFeedback = assessments.filter(a => a.next === 'Collect interview feedback').length;
    if (noFeedback) insights.push(`${noFeedback} candidate(s) are waiting on interview feedback.`);
    if (!candidates.length) insights.push('No candidates in the pipeline yet. Add candidates from the Manager Console recruitment tab.');
    return { counts, insights };
}

module.exports = { STAGES, workforceMetrics, assessCandidate, retentionRisks, pipelineInsights };
