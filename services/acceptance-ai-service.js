/**
 * AI assistance for the Controls, Acceptance & Client Sign-Off hub.
 *
 * - companyFacts: what the organization actually has (people, managers, admins, departments,
 *   templates, configured email/SMS/AI providers). Read from Firestore and the server
 *   environment; no personal data leaves the server.
 * - adviseDecision: a recommendation for one client decision from those facts, always one of
 *   the decision's own options, with reasons and things to check.
 * - readiness: a go-live readiness score from the acceptance results, open decisions and the
 *   sign-off, with risks and next actions.
 * With OPENAI_API_KEY the model may refine the wording/choice (still limited to the listed
 * options and given only the facts summary); otherwise the rules below decide.
 */
const openai = require('./openai-client');

const aiConfigured = () => openai.isConfigured();
const has = (name) => Boolean(process.env[name] && String(process.env[name]).trim());

function companyFacts({ users = [], templates = [] }) {
    const active = users.filter(u => !(u.isActive === false || /exited|relieved|inactive|terminated/i.test(String(u.employmentStatus || u.status || ''))));
    const roleOf = (u) => String(u.role || '').toLowerCase().replace(/[\s_-]+/g, '');
    const managers = active.filter(u => /manager|lead|head/.test(roleOf(u)) || /manager|lead|head/i.test(u.designation || ''));
    const admins = active.filter(u => /superadmin|admin|hrms|hradmin|hrpayroll|hr/.test(roleOf(u)));
    const departments = [...new Set(active.map(u => u.departmentName || u.department).filter(Boolean))];
    const modules = [...new Set(templates.map(t => t.module).filter(Boolean))];
    return {
        people: active.length,
        exited: users.length - active.length,
        managers: managers.length,
        adminsAndHr: admins.length,
        departments: departments.length,
        departmentNames: departments,
        templateModules: modules,
        emailProvider: (has('SMTP_USER') && has('SMTP_PASS')) || has('RESEND_API_KEY') || has('SENDGRID_API_KEY'),
        smsProvider: has('TWILIO_ACCOUNT_SID') && has('TWILIO_AUTH_TOKEN'),
        whatsappProvider: has('WHATSAPP_TOKEN') || has('WHATSAPP_API_KEY'),
        aiModel: aiConfigured(),
        payrollProviderKeys: has('RAZORPAYX_KEY') || has('RAZORPAY_KEY_ID') || has('STRIPE_SECRET_KEY'),
        erpConnector: has('WORKDAY_API_KEY') || has('SAP_SF_API_KEY')
    };
}

const pick = (decision, matcher) => decision.options.find(o => matcher.test(o)) || decision.recommendedOption;

/** Rule-based advice per decision: [chosen option, reasons, things to check] */
const ADVISORS = {
    dec_modules_templates: (d, f) => {
        const big = f.departments >= 6 || f.people >= 250;
        return [
            big ? pick(d, /Fully Configurable/i) : d.recommendedOption,
            [
                `You have ${f.people} active people in ${f.departments} department(s).`,
                big ? 'With many units, per-unit templates avoid one-size-fits-all letters.' : 'The standard 5 modules cover onboarding to exit without extra setup for a team of this size.',
                f.templateModules.length ? `Templates already exist for: ${f.templateModules.join(', ')}.` : 'No module templates exist yet.'
            ],
            ['Confirm whether Leave & Attendance and Exit need their own letters in your process.']
        ];
    },
    dec_manager_template_publish: (d, f) => [
        d.recommendedOption,
        [
            f.managers ? `${f.managers} manager(s) could publish templates; HR approval keeps letters consistent and compliant.` : 'No managers are set up yet, so HR/administrator approval is the practical default.',
            f.adminsAndHr >= 2 ? `${f.adminsAndHr} HR/admin users are available to review.` : 'Only one HR/admin user exists — approvals will queue on one person.'
        ],
        f.adminsAndHr < 2 ? ['Add a second HR/admin reviewer, or accept a single approver.'] : []
    ],
    dec_goals_scope: (d, f) => {
        const tiny = f.people < 8 || f.managers === 0;
        return [
            tiny ? pick(d, /Personal Goals Only/i) : d.recommendedOption,
            [
                tiny ? `With ${f.people} people and ${f.managers} manager(s), cascading team targets add overhead; start with personal goals.` : `${f.managers} manager(s) can set team targets that cascade to their people.`
            ],
            ['You can move to cascading goals later without losing personal goals.']
        ];
    },
    dec_bulk_triggering_channels: (d, f) => {
        const limited = !f.emailProvider && !f.smsProvider;
        return [
            limited ? pick(d, /Email & In-App Alerts Only/i) : d.recommendedOption,
            [
                f.emailProvider ? 'An email provider is configured.' : 'No email provider is configured (SMTP password / Resend key missing): bulk "email" currently creates in-app notifications only.',
                f.smsProvider ? 'An SMS provider is configured for OTP.' : 'No SMS provider is configured, so OTP codes cannot be delivered yet.'
            ],
            limited ? ['Configure SMTP or Resend before promising email delivery; add OTP channels when a provider is chosen.'] : []
        ];
    },
    dec_batch_size_figures: (d, f) => [
        d.recommendedOption,
        [
            `Your company has ${f.people} people: at 20 per batch that is ${Math.max(1, Math.ceil(f.people / 20))} batch(es).`,
            'Keeping the size admin-tunable lets you match provider rate limits later.'
        ],
        []
    ],
    dec_otp_channel_provider: (d, f) => {
        const choice = f.smsProvider && f.emailProvider ? d.recommendedOption
            : f.smsProvider ? pick(d, /SMS Only/i)
            : f.whatsappProvider ? pick(d, /WhatsApp/i)
            : pick(d, /Email Only/i);
        return [
            choice,
            [
                f.smsProvider ? 'Twilio credentials are present.' : 'No Twilio (SMS) credentials are configured.',
                f.emailProvider ? 'An email provider is configured.' : 'SMTP_USER is set but no SMTP password / API key, so email OTP needs one more setting.',
                'Email is the lowest-cost starting channel; SMS can be added as the primary channel later.'
            ],
            ['Budget for SMS costs per OTP if SMS becomes primary.', 'Set SMTP_PASS (Gmail app password) or RESEND_API_KEY to enable email delivery.']
        ];
    },
    dec_ai_builder_priority: (d, f) => [
        d.recommendedOption,
        [
            'Alerts give quick value from data you already have (attendance, leave, payroll events).',
            f.aiModel ? 'An AI model is configured.' : 'No AI model key is configured; builders run on rule-based suggestions until OPENAI_API_KEY is set.'
        ],
        []
    ],
    dec_deduction_note_meaning: (d) => [
        d.recommendedOption,
        [
            'A reminder notice never moves money, so a wrong reminder cannot cause a wrong debit.',
            'Direct banking execution would need banking agreements, approvals and audit far beyond a notification feature.'
        ],
        []
    ],
    dec_account_view_scope: (d) => [
        d.recommendedOption,
        [
            'Employees see only their own data with bank and tax identifiers masked — this follows data-minimisation (DPDP Act 2023).',
            'Company ledgers belong in the finance system, not the employee portal.'
        ],
        []
    ],
    dec_payroll_approval_rules: (d, f) => {
        const choice = f.payrollProviderKeys ? pick(d, /RazorpayX|Stripe/i) : f.erpConnector ? pick(d, /ERP/i) : d.recommendedOption;
        return [
            choice,
            [
                f.payrollProviderKeys ? 'Payroll provider API keys are configured.' : 'No external payroll provider keys are configured; the internal ledger with NACH export needs no new contracts.',
                f.adminsAndHr >= 2 ? `${f.adminsAndHr} HR/admin users exist, so maker-checker (creator cannot self-approve) is workable.` : 'Maker-checker needs at least two HR/admin users; you currently have fewer.'
            ],
            f.adminsAndHr < 2 ? ['Add a second payroll approver before go-live.'] : []
        ];
    }
};

async function adviseDecision({ decision, facts }) {
    const advisor = ADVISORS[decision.id];
    let [option, rationale, considerations] = advisor
        ? advisor(decision, facts)
        : [decision.recommendedOption, ['This is the standard recommendation for this question.'], []];
    let source = 'rules';

    if (aiConfigured()) {
        const out = await openai.chatJson([
            { role: 'system', content: 'You advise an HR software client on one scoping decision. Choose exactly one of the given options. Use only the facts provided. Reply as JSON: {"option": string (copied exactly from options), "rationale": string[] (max 3), "considerations": string[] (max 2)}.' },
            { role: 'user', content: JSON.stringify({ question: decision.question, context: decision.context, options: decision.options, defaultRecommendation: decision.recommendedOption, facts: { ...facts, departmentNames: undefined } }) }
        ]);
        if (decision.options.includes(out.option)) {
            option = out.option;
            rationale = (Array.isArray(out.rationale) ? out.rationale : rationale).map(s => String(s).slice(0, 300)).slice(0, 3);
            considerations = (Array.isArray(out.considerations) ? out.considerations : considerations).map(s => String(s).slice(0, 300)).slice(0, 2);
            source = 'openai';
        }
    }

    return {
        decisionId: decision.id,
        recommendedOption: option,
        matchesStandardRecommendation: option === decision.recommendedOption,
        differsFromCurrentSelection: option !== decision.selectedOption,
        rationale,
        considerations,
        source
    };
}

function readiness({ matrix, decisions, signOff, facts }) {
    const criteria = (matrix && matrix.criteria) || [];
    const passed = criteria.filter(c => c.passed).length;
    const confirmed = decisions.filter(d => d.status === 'confirmed').length;
    const criteriaScore = criteria.length ? passed / criteria.length : 0;
    const decisionScore = decisions.length ? confirmed / decisions.length : 0;
    const score = Math.round(criteriaScore * 50 + decisionScore * 30 + (signOff ? 20 : 0));

    const risks = [];
    const nextActions = [];
    criteria.filter(c => !c.passed).forEach(c => {
        risks.push({ severity: 'high', message: `${c.feature} check failed: ${c.evidence}` });
        nextActions.push(`Fix "${c.feature}" (${c.condition}) and re-run the acceptance matrix.`);
    });
    const pending = decisions.filter(d => d.status !== 'confirmed');
    if (pending.length) {
        risks.push({ severity: 'medium', message: `${pending.length} client decision(s) not confirmed: ${pending.map(d => `Q${d.questionNumber}`).join(', ')}.` });
        nextActions.push('Review the pending decisions (use AI Advise on each) and confirm them.');
    }
    if (!facts.emailProvider) {
        risks.push({ severity: 'medium', message: 'No email provider is configured: bulk email and email OTP only create in-app notifications.' });
        nextActions.push('Set SMTP_PASS (or RESEND_API_KEY) in the server settings to enable real email delivery.');
    }
    if (!facts.smsProvider) risks.push({ severity: 'low', message: 'No SMS provider is configured, so SMS OTP is not available.' });
    if (facts.adminsAndHr < 2) {
        risks.push({ severity: 'medium', message: 'Fewer than two HR/admin users: maker-checker approvals cannot be separated.' });
        nextActions.push('Add a second HR/admin approver.');
    }
    if (!facts.aiModel) risks.push({ severity: 'low', message: 'No AI model key configured; AI features use rule-based assistance.' });
    if (!signOff) nextActions.push(pending.length ? 'After confirming decisions, record the formal client sign-off.' : 'Record the formal client sign-off.');
    if (signOff && pending.length) risks.push({ severity: 'medium', message: 'A sign-off exists but decisions were still open when it was recorded or changed afterwards.' });

    const status = score >= 90 && !risks.some(r => r.severity === 'high') ? 'Ready for go-live'
        : score >= 60 ? 'Nearly ready'
            : 'Not ready yet';
    const headline = `${status}: ${passed}/${criteria.length} acceptance checks passed, ${confirmed}/${decisions.length} decisions confirmed, ${signOff ? 'signed off' : 'not signed off'}.`;
    return {
        score,
        status,
        headline,
        breakdown: { acceptance: `${passed}/${criteria.length}`, decisions: `${confirmed}/${decisions.length}`, signedOff: Boolean(signOff) },
        risks,
        nextActions: [...new Set(nextActions)].slice(0, 8),
        source: 'rules'
    };
}

module.exports = { aiConfigured, companyFacts, adviseDecision, readiness };
