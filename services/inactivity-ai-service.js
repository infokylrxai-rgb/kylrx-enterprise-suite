/**
 * AI assistance for the Inactivity Radar (invited people who have not signed in yet).
 *
 * - assessCandidate: a non-response risk score (0-100) and the next best action for one
 *   person, from how long the invite has been waiting, whether it was delivered, the email
 *   type, how close the joining date is and reminders already sent.
 * - adviseRules: suggested suspend/trash thresholds from how quickly this organization's
 *   people actually signed in after being invited.
 * - composeNudge: a short, personal reminder (copy for WhatsApp/phone, or send by email when
 *   a provider is configured). With OPENAI_API_KEY the model writes it; otherwise a template.
 */
const openai = require('./openai-client');

const aiConfigured = () => openai.isConfigured();
const PERSONAL_DOMAINS = /@(gmail|yahoo|outlook|hotmail|live|icloud|proton|rediffmail)\./i;

function assessCandidate(c, rules) {
    let score = 0;
    const reasons = [];
    const h = c.hoursSinceInvite;

    if (!c.inviteDelivered) {
        score += 45;
        reasons.push('The invitation email was never delivered.');
    }
    if (h >= rules.thresholdTrashDays * 24) { score += 35; reasons.push(`Waiting ${Math.floor(h / 24)} days — past the ${rules.thresholdTrashDays}-day trash limit.`); }
    else if (h >= 72) { score += 30; reasons.push(`No response for ${Math.floor(h / 24)} days.`); }
    else if (h >= 24) { score += 20; reasons.push(`No response for ${Math.floor(h)} hours.`); }
    else if (h >= rules.thresholdSuspendHours) { score += 10; reasons.push(`Past the ${rules.thresholdSuspendHours}-hour response window.`); }

    if (c.email && PERSONAL_DOMAINS.test(c.email)) { score += 8; reasons.push('Invite went to a personal mailbox (often filtered as promotions/spam).'); }
    if (!c.email) { score += 20; reasons.push('No email address on record.'); }
    if (!c.phone) { score += 5; reasons.push('No phone number to follow up.'); }
    if (c.remindersSent >= 2) { score += 10; reasons.push(`${c.remindersSent} reminders already sent without a response.`); }
    if (c.joiningInDays !== null && c.joiningInDays <= 3 && c.joiningInDays >= -30) {
        score += 10;
        reasons.push(c.joiningInDays < 0 ? `Joining date passed ${Math.abs(c.joiningInDays)} day(s) ago.` : `Joins in ${c.joiningInDays} day(s).`);
    }
    score = Math.min(100, score);

    let action;
    if (!c.inviteDelivered) action = { key: 'resend', label: 'Resend the invitation', detail: 'The first email failed; fix the address or email setup and resend.' };
    else if (c.joiningInDays !== null && c.joiningInDays >= 0 && c.joiningInDays <= 3 && c.phone) action = { key: 'call', label: 'Call before the joining date', detail: `Phone ${c.phone}; confirm they received the login details.` };
    else if (c.joiningInDays !== null && c.joiningInDays < 0 && c.phone) action = { key: 'call', label: 'Call — joining date has passed', detail: `Phone ${c.phone}; check whether they joined and still need portal access.` };
    else if (h >= 48 && c.managerName) action = { key: 'escalate', label: `Ask ${c.managerName} to follow up`, detail: 'A message from their manager usually gets a faster response.' };
    else if (h >= 24 || c.remindersSent >= 1) action = { key: 'contact', label: 'Contact the department', detail: 'Let the department reach out personally.' };
    else action = { key: 'nudge', label: 'Send a friendly reminder', detail: 'A short personal reminder is usually enough at this stage.' };

    return {
        score,
        level: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
        reasons,
        action
    };
}

const median = (list) => {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** responseHours: hours from invite to first sign-in for people who did respond */
function adviseRules(responseHours, rules) {
    const n = responseHours.length;
    if (n < 3) {
        return {
            basedOn: n,
            suggestion: null,
            message: n === 0
                ? 'No one has signed in after an invite yet, so there is no response history to learn from. Keep the current rules.'
                : `Only ${n} response(s) on record — too few to recommend new thresholds. Keep the current rules for now.`
        };
    }
    const sorted = [...responseHours].sort((a, b) => a - b);
    const p80 = sorted[Math.min(n - 1, Math.floor(n * 0.8))];
    const suspendHours = Math.max(2, Math.min(72, Math.ceil(p80)));
    const trashDays = Math.max(2, Math.min(30, Math.ceil((sorted[n - 1] * 1.5) / 24)));
    const med = median(sorted);
    return {
        basedOn: n,
        medianHours: Math.round(med * 10) / 10,
        p80Hours: Math.round(p80 * 10) / 10,
        suggestion: { thresholdSuspendHours: suspendHours, thresholdTrashDays: trashDays },
        message: `${n} people signed in after their invite: half within ${Math.round(med * 10) / 10}h, 80% within ${Math.round(p80 * 10) / 10}h. Suspending after ${suspendHours}h would wait for 80% of responders`
            + (suspendHours > rules.thresholdSuspendHours ? ` (your current ${rules.thresholdSuspendHours}h suspends people who would still have replied).` : '.')
    };
}

function templateNudge(c, tone, companyName) {
    const first = String(c.name || '').split(' ')[0] || 'there';
    const company = companyName || 'our company';
    const waited = c.hoursSinceInvite >= 24 ? `${Math.floor(c.hoursSinceInvite / 24)} day(s)` : `${Math.max(1, Math.floor(c.hoursSinceInvite))} hour(s)`;
    const joining = c.joiningInDays !== null && c.joiningInDays >= 0 && c.joiningInDays <= 14 ? ` before your joining date${c.joiningDate ? ` (${c.joiningDate})` : ''}` : '';
    if (tone === 'formal') {
        return {
            subject: `Action needed: activate your ${company} account`,
            body: `Dear ${first},\n\nWe sent your login details for the ${company} employee portal ${waited} ago and noticed you have not signed in yet. Please sign in${joining} and set your own password to complete your onboarding.\n\nIf you did not receive the email, please check your spam folder or reply to this message and we will resend it.\n\nRegards,\nHR Team`
        };
    }
    return {
        subject: `Quick reminder to activate your ${company} account`,
        body: `Hi ${first}! 👋\n\nJust checking in — your ${company} portal login was sent ${waited} ago. Could you sign in${joining} and set your password? It only takes a minute.\n\nCan't find the email? Check spam, or just reply and we'll resend it.\n\nThanks!\nHR Team`
    };
}

async function composeNudge({ candidate, tone, companyName }) {
    const style = tone === 'formal' ? 'formal' : 'friendly';
    if (!aiConfigured()) return { ...templateNudge(candidate, style, companyName), source: 'template' };
    const out = await openai.chatJson([
        { role: 'system', content: `Write a short ${style} reminder from HR asking a new joiner to sign in to the employee portal and set their password. Never include passwords, links to unknown sites or requests for personal data. Reply as JSON: {"subject": string (max 70 chars), "body": string (max 600 chars, plain text)}.` },
        { role: 'user', content: JSON.stringify({ firstName: String(candidate.name || '').split(' ')[0], company: companyName, hoursSinceInvite: Math.floor(candidate.hoursSinceInvite), joiningInDays: candidate.joiningInDays }) }
    ], { temperature: 0.5 });
    const subject = String(out.subject || '').slice(0, 120);
    const body = String(out.body || '').slice(0, 1500);
    if (!subject || !body) return { ...templateNudge(candidate, style, companyName), source: 'template' };
    return { subject, body, source: 'openai' };
}

module.exports = { aiConfigured, assessCandidate, adviseRules, composeNudge };
