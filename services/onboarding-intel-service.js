/**
 * Onboarding intelligence for the AI Command Center (admin-onboarding-ai.html).
 *
 * buildFacts: activation, profile completeness, sentiment and weekly sign-ins for an
 *   organization's people (Firestore users + Firebase Authentication sign-in times + reviewed
 *   EODs).
 * buildInsights: bottlenecks found in those facts, each with the affected people and an
 *   action; planFrom: the action plan derived from the insights.
 * answer: the assistant's reply to an admin question, from the facts (rule-based intents;
 *   with OPENAI_API_KEY the model phrases an answer from an aggregate summary only — no names,
 *   emails or identifiers are sent).
 */
const openai = require('./openai-client');

const aiConfigured = () => openai.isConfigured();
const HOUR = 3600000;

const PROFILE_FIELDS = [
    ['department', u => u.departmentName || u.department],
    ['designation', u => u.designation],
    ['joining date', u => u.joiningDate],
    ['phone', u => u.phone || u.mobile],
    ['PAN', u => u.pan || u.PAN || u.panNumber],
    ['UAN', u => u.uan || u.UAN || u.uanNumber],
    ['bank details', u => {
        const b = u.bankDetails || {};
        return b.accountNumber || b.account_number || b.ifsc || b.IFSC;
    }]
];

const toMs = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v._seconds !== undefined) return v._seconds * 1000;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
};

const isActiveRecord = (u) => (u.name || u.displayName || u.email)
    && !(u.isActive === false || /exited|relieved|inactive|terminated/i.test(String(u.employmentStatus || u.status || '')))
    && !/^(Trash|Deleted)$/.test(String(u.inactivityStatus || ''));

/**
 * users: the organization's user records; signIns: Map(authUid -> last sign-in ms);
 * eods: reviewed EOD records (managerScore 0-5).
 */
function buildFacts({ users, signIns, eods, now = Date.now() }) {
    const people = users.filter(isActiveRecord).map(u => {
        const lastSignIn = signIns.get(u.uid || u.id) || toMs(u.lastLoginAt) || null;
        const activated = Boolean(lastSignIn) || u.must_change_password === false || u.is_temporary_password === false;
        const missing = PROFILE_FIELDS.filter(([, get]) => !get(u)).map(([label]) => label);
        const invitedAt = toMs(u.invitationSentAt) || toMs(u.createdAt);
        const joining = toMs(u.joiningDate);
        return {
            id: u.id,
            name: u.name || u.displayName || u.email,
            email: u.email || '',
            department: u.departmentName || u.department || '',
            role: u.role || 'employee',
            hasManager: Boolean(u.managerId || u.reportingManager || u.managerName),
            inviteStatus: u.invite_status || '',
            activated,
            lastSignIn,
            hoursSinceInvite: invitedAt ? (now - invitedAt) / HOUR : null,
            joiningInDays: joining ? Math.floor((joining - now) / 86400000) : null,
            missing,
            completeness: Math.round(((PROFILE_FIELDS.length - missing.length) / PROFILE_FIELDS.length) * 100)
        };
    });

    const activatedCount = people.filter(p => p.activated).length;
    const weekStart = now - 7 * 86400000;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekly = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    people.forEach(p => { if (p.lastSignIn && p.lastSignIn >= weekStart) weekly[days[new Date(p.lastSignIn).getDay()]]++; });

    const scores = eods.map(e => Number(e.managerScore)).filter(n => Number.isFinite(n) && n > 0);
    const departments = {};
    people.forEach(p => {
        const d = p.department || 'No department';
        departments[d] = departments[d] || { total: 0, activated: 0 };
        departments[d].total++;
        if (p.activated) departments[d].activated++;
    });

    return {
        people,
        total: people.length,
        activated: activatedCount,
        awaiting: people.length - activatedCount,
        activationRate: people.length ? Math.round((activatedCount / people.length) * 1000) / 10 : 0,
        avgCompleteness: people.length ? Math.round(people.reduce((s, p) => s + p.completeness, 0) / people.length) : 0,
        sentiment: scores.length ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10 : null,
        sentimentCount: scores.length,
        weekly,
        departments
    };
}

function buildInsights(facts) {
    const insights = [];
    const names = (list) => list.map(p => ({ id: p.id, name: p.name, department: p.department, detail: p.detail || '' }));
    const undelivered = facts.people.filter(p => !p.activated && /^pending$/i.test(p.inviteStatus));
    if (undelivered.length) insights.push({
        id: 'undelivered_invites', type: 'bottleneck',
        title: `${undelivered.length} invitation(s) never delivered`,
        description: 'The welcome email failed, so these people cannot sign in. Fix the email setup or address and resend from the Inactivity Radar.',
        people: names(undelivered), action: { kind: 'link', label: 'Open Inactivity Radar', href: 'admin-inactivity-monitor.html' }
    });
    const silent = facts.people.filter(p => !p.activated && /^sent$/i.test(p.inviteStatus) && (p.hoursSinceInvite || 0) >= 48)
        .map(p => ({ ...p, detail: `${Math.floor(p.hoursSinceInvite / 24)} days since invite` }));
    if (silent.length) insights.push({
        id: 'not_signed_in', type: 'bottleneck',
        title: `${silent.length} invited ${silent.length === 1 ? 'person has' : 'people have'} not signed in for 2+ days`,
        description: 'They received their login details but have not activated their account.',
        people: names(silent), action: { kind: 'notify', label: 'Ask HR to follow up' }
    });
    const joiningSoon = facts.people.filter(p => !p.activated && p.joiningInDays !== null && p.joiningInDays >= 0 && p.joiningInDays <= 7)
        .map(p => ({ ...p, detail: `joins in ${p.joiningInDays} day(s)` }));
    if (joiningSoon.length) insights.push({
        id: 'joining_soon', type: 'reminder',
        title: `${joiningSoon.length} joiner(s) start within 7 days without an active account`,
        description: 'Make sure they can sign in before day one.',
        people: names(joiningSoon), action: { kind: 'notify', label: 'Ask HR to follow up' }
    });
    const noIds = facts.people.filter(p => p.missing.includes('PAN') || p.missing.includes('UAN'))
        .map(p => ({ ...p, detail: `missing ${p.missing.filter(m => m === 'PAN' || m === 'UAN').join(' & ')}` }));
    if (noIds.length) insights.push({
        id: 'missing_statutory_ids', type: 'reminder',
        title: `${noIds.length} ${noIds.length === 1 ? 'person is' : 'people are'} missing PAN or UAN`,
        description: 'PAN is needed for TDS (Form 24Q) and UAN for the PF ECR. Collect them before the next payroll.',
        people: names(noIds), action: { kind: 'notify', label: 'Ask HR to collect IDs' }
    });
    const noBank = facts.people.filter(p => p.missing.includes('bank details'));
    if (noBank.length) insights.push({
        id: 'missing_bank', type: 'reminder',
        title: `${noBank.length} ${noBank.length === 1 ? 'person has' : 'people have'} no bank details`,
        description: 'Salary cannot be paid without verified bank details.',
        people: names(noBank), action: { kind: 'notify', label: 'Ask HR to collect bank details' }
    });
    const noManager = facts.people.filter(p => /^employee$/i.test(p.role) && !p.hasManager);
    if (noManager.length) insights.push({
        id: 'no_manager', type: 'suggestion',
        title: `${noManager.length} employee(s) without a reporting manager`,
        description: 'Assign managers so approvals (leave, attendance, goals) reach someone.',
        people: names(noManager), action: { kind: 'link', label: 'Open Manager Governance', href: 'admin-manager-change.html' }
    });
    const noDept = facts.people.filter(p => !p.department);
    if (noDept.length) insights.push({
        id: 'no_department', type: 'suggestion',
        title: `${noDept.length} ${noDept.length === 1 ? 'person has' : 'people have'} no department`,
        description: 'Department drives policies, week-offs and reporting.',
        people: names(noDept), action: { kind: 'notify', label: 'Ask HR to assign departments' }
    });
    return insights;
}

function planFrom(insights) {
    return insights.map(i => ({ id: i.id, text: `${i.title} — ${i.action.label}`, count: i.people.length }));
}

/* ━━━━━━━━━━━━━━━━━━━━ Assistant ━━━━━━━━━━━━━━━━━━━━ */

const list = (people, max = 8) => people.slice(0, max).map(p => `• **${p.name}**${p.department ? ` (${p.department})` : ''}${p.detail ? ` — ${p.detail}` : ''}`).join('\n')
    + (people.length > max ? `\n• …and ${people.length - max} more` : '');

function ruleAnswer(question, facts, insights) {
    const q = question.toLowerCase();
    const pending = facts.people.filter(p => !p.activated);
    if (/report|summary|insight|bottleneck|risk|daily/.test(q)) {
        return `**Onboarding report**\n• **Activation:** ${facts.activated} of ${facts.total} people signed in (${facts.activationRate}%)\n• **Profile completeness:** ${facts.avgCompleteness}% on average\n• **Sentiment:** ${facts.sentiment !== null ? `${facts.sentiment}/5 from ${facts.sentimentCount} reviewed EOD(s)` : 'no reviewed EODs yet'}\n\n**Issues**\n${insights.length ? insights.map(i => `• ${i.title}`).join('\n') : '• None found'}\n\n**Next actions**\n${insights.length ? insights.slice(0, 4).map(i => `• ${i.action.label}`).join('\n') : '• Nothing urgent'}`;
    }
    if (/who|which|list|names?/.test(q) && /(not|n't|pending|waiting|inactive|sign)/.test(q)) {
        return pending.length
            ? `**${pending.length} ${pending.length === 1 ? 'person has' : 'people have'} not signed in yet:**\n${list(pending.map(p => ({ ...p, detail: /^pending$/i.test(p.inviteStatus) ? 'invite not delivered' : p.hoursSinceInvite ? `${Math.floor(p.hoursSinceInvite / 24)} day(s) since invite` : '' })))}`
            : 'Everyone has signed in. 🎉';
    }
    if (/document|pan|uan|bank|kyc|aadhaar|missing|profile|complete/.test(q)) {
        const incomplete = facts.people.filter(p => p.missing.length).sort((a, b) => b.missing.length - a.missing.length);
        return incomplete.length
            ? `**Average profile completeness: ${facts.avgCompleteness}%.** Missing details:\n${list(incomplete.map(p => ({ ...p, detail: p.missing.join(', ') })))}\n\n(Aadhaar is not stored in profiles, so it is not checked.)`
            : 'All profiles have department, designation, joining date, phone, PAN, UAN and bank details.';
    }
    if (/department|team|unit/.test(q)) {
        const rows = Object.entries(facts.departments).sort((a, b) => b[1].total - a[1].total);
        return `**By department** (signed in / total):\n${rows.map(([d, s]) => `• **${d}:** ${s.activated}/${s.total}`).join('\n')}`;
    }
    if (/sentiment|mood|eod|happy/.test(q)) {
        return facts.sentiment !== null
            ? `Average manager score on reviewed EODs is **${facts.sentiment}/5** (${facts.sentimentCount} review(s)).`
            : 'No EODs have been reviewed yet, so there is no sentiment score.';
    }
    if (/status|percent|progress|how many|count|pending|overview/.test(q)) {
        return `**Onboarding status**\n• **People:** ${facts.total}\n• **Signed in:** ${facts.activated} (${facts.activationRate}%)\n• **Awaiting activation:** ${facts.awaiting}\n• **Profile completeness:** ${facts.avgCompleteness}%\n${insights.length ? `• **Open issues:** ${insights.length} — ask me for the report` : ''}`;
    }
    return 'I can answer from your live onboarding data. Try: **status**, **who has not signed in**, **missing documents**, **by department**, **sentiment** or **daily report**.';
}

async function answer(question, facts, insights) {
    const text = String(question || '').trim().slice(0, 500);
    if (!text) return { message: 'Please type a question.', source: 'rules' };
    const ruleReply = ruleAnswer(text, facts, insights);
    if (!aiConfigured()) return { message: ruleReply, source: 'rules' };
    // Only aggregates go to the model; names and identifiers stay on the server
    const summary = {
        total: facts.total, activated: facts.activated, activationRate: facts.activationRate, awaiting: facts.awaiting,
        avgCompleteness: facts.avgCompleteness, sentiment: facts.sentiment, departments: facts.departments,
        issues: insights.map(i => ({ title: i.title, affected: i.people.length, action: i.action.label }))
    };
    try {
        const out = await openai.chatJson([
            { role: 'system', content: 'You are an HR onboarding assistant. Answer only from the JSON facts given; if the facts do not cover the question, say so. Use short bullet points with **bold** labels. Reply as JSON: {"message": string}.' },
            { role: 'user', content: JSON.stringify({ question: text, facts: summary }) }
        ], { temperature: 0.2 });
        // Questions about specific people are answered with the rule-based lists (names stay local)
        if (/who|which|list|names?/.test(text.toLowerCase())) return { message: ruleReply, source: 'rules' };
        return { message: String(out.message || ruleReply).slice(0, 3000), source: 'openai' };
    } catch (_) {
        return { message: ruleReply, source: 'rules' };
    }
}

module.exports = { aiConfigured, buildFacts, buildInsights, planFrom, answer };
