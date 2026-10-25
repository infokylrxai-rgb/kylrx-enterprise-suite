/**
 * AI assistance for bulk messages (Bulk Trigger page).
 *
 * - composeMessage: subject + body from a short description, personalised with {{name}} /
 *   {{department}}. With OPENAI_API_KEY the model writes it; otherwise a matching standard
 *   message (reminder, deadline, training, policy, holiday, meeting, payroll, ...) is filled in.
 * - planAudience: turns "everyone in Cybersecurity except managers" into a filter over the
 *   organization's departments and roles, then applies it on the server. The model (when
 *   configured) only sees department and role names, never people's details.
 * - reviewMessage: checks a message and its audience before sending (tokens, length, tone,
 *   sensitive data requests, links, audience size and exclusions) and returns a score.
 */
const openai = require('./openai-client');

const TOKENS = ['name', 'department'];
const aiConfigured = () => openai.isConfigured();
const clip = (s, n) => String(s || '').trim().slice(0, n);

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ COMPOSE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "by Friday", "on 30 Nov", "before 5 pm tomorrow", "by 2026-11-30" -> readable phrase */
function deadlineOf(text) {
    const t = text.toLowerCase();
    const m = t.match(new RegExp(`\\b(by|before|on|until|till|due)\\s+((?:end of (?:day|week|month))|today|tomorrow|(?:this |next )?(?:${WEEKDAYS.join('|')})|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS.join('|')})[a-z]*(?:\\s+\\d{4})?|(?:${MONTHS.join('|')})[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{4}-\\d{2}-\\d{2})(?:\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))?`));
    if (!m) return '';
    const original = text.slice(m.index, m.index + m[0].length);
    return original.replace(/^\w+\s+/, (w) => w.toLowerCase());
}

const INTENTS = [
    { key: 'timesheet', re: /timesheet|time sheet|hours log/i, subject: 'Reminder: Submit Your Timesheet', body: (d) => `Please submit your timesheet${d ? ` ${d}` : ' at the earliest'} so that attendance and payroll can be processed on time.` },
    { key: 'training', re: /training|course|module|certification|learning|e-?learning/i, subject: (topic) => `Action Required: Complete ${topic || 'Your Assigned Training'}`, body: (d, topic) => `You have been assigned ${topic ? `the "${topic}"` : 'a mandatory training'} module. Please complete it${d ? ` ${d}` : ' at the earliest'}.` },
    { key: 'survey', re: /survey|feedback|poll|questionnaire/i, subject: 'We Value Your Feedback', body: (d) => `We'd like to hear from you. Please take a few minutes to share your feedback${d ? ` ${d}` : ''}. Your responses help us improve the workplace for everyone.` },
    { key: 'policy', re: /policy|handbook|code of conduct|guideline/i, subject: (topic) => `Policy Update: ${topic || 'Please Review'}`, body: (d, topic) => `${topic ? `The ${topic} has` : 'A company policy has'} been updated. Please read it carefully and acknowledge it${d ? ` ${d}` : ''}. Reach out to HR if you have any questions.` },
    { key: 'holiday', re: /holiday|diwali|christmas|new year|festival|day off|office closed/i, subject: (topic) => `Holiday Announcement${topic ? `: ${topic}` : ''}`, body: (d, topic) => `Please note that the office will remain closed${d ? ` ${d}` : ''}${topic ? ` for ${topic}` : ''}. Plan your work accordingly. Wishing you and your family a joyful time!` },
    { key: 'meeting', re: /meeting|town ?hall|all[- ]hands|session|webinar/i, subject: (topic) => `Invitation: ${topic || 'Team Meeting'}`, body: (d, topic) => `You are invited to ${topic ? `the ${topic}` : 'an upcoming meeting'}${d ? ` ${d}` : ''}. Please plan to attend and block the time on your calendar.` },
    { key: 'payroll', re: /payslip|salary|payroll|reimbursement|tax declaration|investment proof/i, subject: (topic) => `Payroll: ${topic || 'Action Needed'}`, body: (d, topic) => `${topic ? `Regarding ${topic}: ` : ''}please review the details in your employee portal${d ? ` ${d}` : ''}. For any discrepancy, contact the payroll team through the portal (never share bank details or passwords by email).` },
    { key: 'maintenance', re: /maintenance|downtime|outage|upgrade|system update/i, subject: 'Scheduled System Maintenance', body: (d) => `Some systems will be unavailable during scheduled maintenance${d ? ` ${d}` : ''}. Please save your work beforehand. We apologise for any inconvenience.` },
    { key: 'welcome', re: /welcome|onboard|joined|new joiner/i, subject: 'Welcome to the Team!', body: () => 'We are delighted to have you with us. Your onboarding tasks are available in your employee portal; your manager and HR are here to help.' },
    { key: 'compliance', re: /compliance|security|audit|acknowledg|declaration|verification/i, subject: (topic) => `Action Required: ${topic || 'Compliance Acknowledgement'}`, body: (d, topic) => `Please complete ${topic ? `the ${topic}` : 'your compliance acknowledgement'}${d ? ` ${d}` : ' at the earliest'}. This is mandatory for all employees.` }
];

/** Topic words of the request: "remind everyone about the POSH training by Friday" -> "POSH Training" */
function topicOf(text) {
    const cleaned = text
        .replace(/\b(by|before|on|until|till|due)\b.*$/i, '')
        .replace(/\b(please|kindly|send|write|draft|create|a|an|the|to|all|everyone|employees?|staff|team|people|remind(?:er)?|them|us|about|regarding|for|of|message|email|notification|announce(?:ment)?|inform|tell|let|know|that|complete|submit|attend|invite|invitation|join|new)\b/gi, ' ')
        .replace(/[^\w&/' -]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned || cleaned.split(' ').length > 6) return '';
    return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

function ruleCompose(intentText, tone) {
    const intent = INTENTS.find(i => i.re.test(intentText));
    const d = deadlineOf(intentText);
    // Holidays are named after the occasion ("... for Diwali"), not the rest of the sentence
    const occasion = (intentText.match(/\b(diwali|deepavali|christmas|new year|holi|eid|pongal|onam|ugadi|dussehra|independence day|republic day|gandhi jayanti|good friday)\b/i) || [])[1];
    const topic = intent && intent.key === 'holiday'
        ? (occasion ? occasion.replace(/\b\w/g, c => c.toUpperCase()) : '')
        : topicOf(intentText);
    const friendly = tone === 'friendly';
    const greeting = friendly ? 'Hi {{name}},' : 'Dear {{name}},';
    const closing = friendly ? 'Thanks so much!\nPeople Team' : 'Regards,\nHR Team';
    if (intent) {
        const subject = typeof intent.subject === 'function' ? intent.subject(topic) : intent.subject;
        return { subject, body: `${greeting}\n\n${intent.body(d, topic)}\n\n${closing}`, intent: intent.key };
    }
    // Generic: the request itself, as a short notice
    const sentence = intentText.replace(/^(please\s+)?(send|write|draft|create)\s+(an?\s+)?(message|email|notification)\s+(to\s+\w+\s+)?(about|regarding|on)?\s*/i, '').trim().replace(/\.$/, '');
    // "the new parking rules" (a topic) vs. "the canteen opens at 8 am" (a statement)
    const isStatement = /\b(is|are|will|has|have|opens?|closes?|starts?|ends?|must|should|can)\b/i.test(sentence);
    const body = !sentence
        ? 'Please take note of the following update.'
        : isStatement
            ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. Please plan accordingly.`
            : `Please take note of ${/^(the|our|your)\b/i.test(sentence) ? '' : 'the '}${sentence}. Details are available in the employee portal; reach out to HR if you have any questions.`;
    return { subject: topic || 'Important Update', body: `${greeting}\n\n${body}\n\n${closing}`, intent: 'general' };
}

async function composeMessage({ intent, tone, action }) {
    const text = clip(intent, 600);
    if (!text) {
        const err = new Error('Describe the message, e.g. "Remind everyone to complete the POSH training by Friday".');
        err.status = 400;
        throw err;
    }
    const style = tone === 'friendly' ? 'friendly' : 'formal';
    if (!aiConfigured()) return { ...ruleCompose(text, style), source: 'rules' };

    const out = await openai.chatJson([
        { role: 'system', content: `You write short internal HR messages for an Indian company's employees. Use {{name}} for the recipient's first name and optionally {{department}}; no other placeholders. Tone: ${style}. Never ask for passwords, OTPs or bank details. Reply as JSON: {"subject": string (max 70 chars), "body": string (plain text, max 900 chars, greeting + 1-3 short paragraphs + sign-off from "HR Team")}.` },
        { role: 'user', content: JSON.stringify({ request: text, channel: action || 'EMAIL_NOTIFICATION' }) }
    ], { temperature: 0.4 });
    const subject = clip(out.subject, 120);
    const body = clip(out.body, 2000);
    if (!subject || !body) {
        const err = new Error('The AI did not return a message. Please rephrase.');
        err.status = 502;
        throw err;
    }
    return { subject, body, intent: 'ai', source: 'openai' };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ AUDIENCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ROLE_GROUPS = {
    manager: /manager|lead|head/i,
    hr: /hr|human resources|people/i,
    admin: /admin/i,
    employee: /^employee$|associate|staff|member/i
};
const ROLE_WORDS = [
    ['manager', /\bmanagers?\b|\bleads?\b|\bheads?\b/],
    ['hr', /\bhr\b|\bhuman resources\b|\bpeople team\b/],
    ['admin', /\badmins?\b|\badministrators?\b|\bsuper ?admins?\b/],
    ['employee', /\bemployees?\b|\bstaff\b|\bassociates?\b/]
];

const roleGroupsOf = (person) => Object.entries(ROLE_GROUPS)
    .filter(([, re]) => re.test(String(person.role || '')) || (person.designation && re.test(person.designation)))
    .map(([g]) => g);

/** Rule-based parse of an audience description into include/exclude departments and role groups */
function ruleAudiencePlan(text, departments) {
    const t = ` ${text.toLowerCase()} `;
    const [includePart, ...exceptParts] = t.split(/\b(?:except|excluding|but not|other than|apart from|without)\b/);
    const excludePart = exceptParts.join(' ');
    const deptsIn = (part) => departments.filter(d => d && new RegExp(`\\b${d.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(part));
    const rolesIn = (part) => ROLE_WORDS.filter(([, re]) => re.test(part)).map(([g]) => g);
    const plan = {
        includeDepartments: deptsIn(includePart),
        excludeDepartments: deptsIn(excludePart),
        includeRoles: rolesIn(includePart).filter(r => !(r === 'employee' && /\beveryone|all\b/.test(includePart))),
        excludeRoles: rolesIn(excludePart),
        includeExited: /\b(exited|former|ex-?employees?|relieved)\b/.test(includePart)
    };
    // "HR" as a department name and as a role: prefer the department when it exists
    if (plan.includeDepartments.some(d => /human resources|hr/i.test(d))) plan.includeRoles = plan.includeRoles.filter(r => r !== 'hr');
    return plan;
}

async function planAudience({ description, people }) {
    const text = clip(description, 400);
    if (!text) {
        const err = new Error('Describe who should receive it, e.g. "everyone in Cybersecurity except managers".');
        err.status = 400;
        throw err;
    }
    const departments = [...new Set(people.map(p => p.department).filter(Boolean))].sort();
    let plan = ruleAudiencePlan(text, departments);
    let source = 'rules';
    if (aiConfigured()) {
        // Only department and role names are sent to the model
        const out = await openai.chatJson([
            { role: 'system', content: `Turn an HR audience description into a filter. Departments available: ${JSON.stringify(departments)}. Role groups: manager, hr, admin, employee. Reply as JSON: {"includeDepartments": string[], "excludeDepartments": string[], "includeRoles": string[], "excludeRoles": string[], "includeExited": boolean}. Empty include lists mean "everyone".` },
            { role: 'user', content: text }
        ]);
        const pick = (list, allowed) => (Array.isArray(list) ? list : []).filter(x => allowed.includes(x));
        const roles = Object.keys(ROLE_GROUPS);
        plan = {
            includeDepartments: pick(out.includeDepartments, departments),
            excludeDepartments: pick(out.excludeDepartments, departments),
            includeRoles: pick(out.includeRoles, roles),
            excludeRoles: pick(out.excludeRoles, roles),
            includeExited: out.includeExited === true
        };
        source = 'openai';
    }

    const selected = people.filter(p => {
        const groups = roleGroupsOf(p);
        if (!plan.includeExited && p.consentStatus === 'opted_out') return false;
        if (plan.includeDepartments.length && !plan.includeDepartments.includes(p.department)) return false;
        if (plan.includeRoles.length && !plan.includeRoles.some(r => groups.includes(r))) return false;
        if (plan.excludeDepartments.includes(p.department)) return false;
        if (plan.excludeRoles.some(r => groups.includes(r))) return false;
        return true;
    });

    const parts = [];
    parts.push(plan.includeDepartments.length ? `in ${plan.includeDepartments.join(', ')}` : 'in all departments');
    if (plan.includeRoles.length) parts.push(`with role ${plan.includeRoles.join(' / ')}`);
    if (plan.excludeDepartments.length) parts.push(`excluding ${plan.excludeDepartments.join(', ')}`);
    if (plan.excludeRoles.length) parts.push(`excluding ${plan.excludeRoles.join(' / ')}s`);
    if (!plan.includeExited) parts.push('active people only');
    return { plan, explanation: `People ${parts.join(', ')}.`, recipients: selected, matched: selected.length, of: people.length, source };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ REVIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function reviewMessage({ subject, body, action, recipients = [], validCount, invalidCount }) {
    const issues = [];
    const suggestions = [];
    const add = (severity, message) => issues.push({ severity, message });
    const s = String(subject || '');
    const b = String(body || '');
    const text = `${s}\n${b}`;

    if (action === 'EMAIL_NOTIFICATION' || action === 'TEMPLATE_SETUP_DISPATCH') {
        if (!s.trim()) add('high', 'The subject line is empty.');
        else if (s.length > 78) suggestions.push(`Shorten the subject (${s.length} characters); most inboxes cut it off after about 70.`);
        if (!b.trim()) add('high', 'The message body is empty.');
    }

    // Tokens
    const used = [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]);
    const unknown = [...new Set(used.filter(t => !TOKENS.includes(t)))];
    if (unknown.length) add('high', `Unsupported placeholders (they would be sent as typed): ${unknown.map(t => `{{${t}}}`).join(', ')}. Only {{name}} and {{department}} are filled in.`);
    if (/(?<!\{)\{[a-z]+\}(?!\})|\[\s*name\s*\]|<name>/i.test(text)) add('medium', 'A placeholder looks mistyped; use {{name}} or {{department}}.');
    if (b.trim() && !used.includes('name')) suggestions.push('Personalise the greeting with {{name}} (e.g. "Dear {{name}},").');

    // Safety and tone
    if (/\b(password|passcode|otp|one[- ]time password|pin|cvv|bank account|account number|ifsc|aadhaar|aadhar|pan (card|number))\b/i.test(text)
        && /\b(share|send|reply|provide|enter|confirm|update)\b/i.test(text)) {
        add('critical', 'The message asks recipients to share credentials or financial/identity details. Legitimate HR messages never do; this looks like phishing and trains people to fall for it.');
    }
    const links = text.match(/https?:\/\/[^\s)]+/gi) || [];
    if (links.some(l => l.startsWith('http://'))) add('medium', 'A link uses http:// (not secure); use https://.');
    if (links.some(l => /bit\.ly|tinyurl|goo\.gl|t\.co\//i.test(l))) add('medium', 'Shortened links hide where they lead; use the full company link.');
    const capsWords = (text.match(/\b[A-Z]{4,}\b/g) || []).filter(w => !['FY26', 'FY27', 'POSH', 'HRMS', 'PF', 'ESIC', 'TDS', 'GST'].includes(w));
    if (capsWords.length >= 3) suggestions.push('Several words are in ALL CAPS; this reads as shouting and can trigger spam filters.');
    if (/!{2,}/.test(text)) suggestions.push('Avoid repeated exclamation marks.');
    if (/\b(click here|act now|winner|free money|limited time|congratulations you)\b/i.test(text)) add('medium', 'Spam-like phrases found ("click here", "act now", ...); rephrase so the message is not filtered or mistaken for phishing.');
    if (b.length > 1500) suggestions.push('The message is long; keep bulk messages short and link to details in the portal.');
    if (b.trim() && b.trim().split(/\s+/).length < 8) suggestions.push('The message is very short; say what is needed and by when.');
    if ((action === 'EMAIL_NOTIFICATION') && b && !/\b(by|before|on|until|due|deadline|today|tomorrow)\b/i.test(b) && /\b(complete|submit|review|acknowledge|update|fill)\b/i.test(b)) {
        suggestions.push('It asks people to act but gives no deadline; add one (e.g. "by Friday, 31 Oct").');
    }

    // Audience
    const total = recipients.length;
    if (!total) add('high', 'No recipients are selected.');
    if (Number.isFinite(invalidCount) && invalidCount > 0) suggestions.push(`${invalidCount} selected recipient(s) will be skipped (invalid email, opted out or exited).`);
    if (Number.isFinite(validCount) && validCount >= 200) suggestions.push(`This goes to ${validCount} people; send a test to yourself first.`);
    if (action === 'OTP_VERIFICATION') suggestions.push('OTP jobs issue codes only; codes are not delivered by SMS/email until a provider is configured.');

    const weights = { critical: 40, high: 18, medium: 8 };
    const score = Math.max(0, 100 - issues.reduce((sum, i) => sum + weights[i.severity], 0) - suggestions.length * 3);
    return { score, verdict: issues.some(i => i.severity === 'critical' || i.severity === 'high') ? 'fix' : (score >= 85 ? 'ready' : 'review'), issues, suggestions, source: 'rules' };
}

module.exports = { aiConfigured, composeMessage, planAudience, reviewMessage };
