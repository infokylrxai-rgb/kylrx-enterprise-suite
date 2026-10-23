/**
 * AI assistant for the Assignment Hub (admin-assignment-matrix.html).
 *
 * "What if" questions in plain English, e.g. "What changes if this employee becomes a
 * contractor in Mumbai?": the assistant turns the question into prospective assignment
 * attributes (only values offered by the page), the Central Assignment Engine computes the
 * real impact diff, and the assistant explains it in plain language.
 *
 * Uses ChatGPT when OPENAI_API_KEY is set; otherwise keyword matching + a templated summary.
 */
const openai = require('./openai-client');
const engine = require('./central-assignment-engine');

const DIMENSIONS = ['legalEntity', 'businessUnit', 'employeeType', 'location', 'department', 'grade'];
const MAX_QUESTION_CHARS = 1000;

// Extra words people use for an option (matched case-insensitively)
const SYNONYMS = {
    'Contractor': ['contract', 'consultant', 'freelance'],
    'Full Time': ['full-time', 'fulltime', 'permanent', 'regular'],
    'Intern': ['internship', 'trainee'],
    'Sales & Marketing': ['sales', 'marketing'],
    'Operations': ['ops', 'operations'],
    'Kylrx US Inc': ['usa', 'united states', 'america', 'us entity'],
    'Kylrx Technologies India Pvt Ltd': ['india'],
    'Remote': ['remote', 'work from home', 'wfh']
};

function sanitizeOptions(options) {
    const clean = {};
    for (const dim of DIMENSIONS) {
        clean[dim] = Array.isArray(options && options[dim])
            ? options[dim].map(String).filter(Boolean).slice(0, 50)
            : [];
    }
    return clean;
}

function sanitizeAttributes(attrs) {
    const clean = {};
    for (const dim of DIMENSIONS) {
        if (attrs && attrs[dim] !== undefined && attrs[dim] !== null) clean[dim] = String(attrs[dim]).slice(0, 100);
    }
    return clean;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Keyword fallback: pick, per dimension, an offered value mentioned in the question (whole words only)
function extractByKeywords(question, current, options) {
    const q = question.toLowerCase();
    const mentions = (word) => new RegExp(`(^|[^a-z0-9])${escapeRegex(word.trim().toLowerCase())}(?=[^a-z0-9]|$)`).test(q);
    const prospective = { ...current };
    for (const dim of DIMENSIONS) {
        const match = options[dim].find(value => [value, ...(SYNONYMS[value] || [])].some(mentions));
        if (match) prospective[dim] = match;
    }
    return prospective;
}

function templatedSummary(impact) {
    const changed = Object.entries(impact.categories || {}).filter(([, c]) => c.status === 'MODIFIED');
    if (!changed.length) return 'This change does not alter any assignments: the same rule and settings still apply.';
    const lines = changed.slice(0, 6).map(([category, c]) => `${category}: ${(c.changes || [])[0] || 'settings change'}`);
    return `The matched rule changes from "${impact.matchedRuleBefore}" to "${impact.matchedRuleAfter}". ${changed.length} area(s) change: ${lines.join('; ')}.`;
}

async function answerScenario({ question, current, options }) {
    const text = String(question || '').trim();
    if (!text) {
        const err = new Error('Type a question, for example: "What changes if this employee becomes a contractor?"');
        err.status = 400;
        throw err;
    }
    if (text.length > MAX_QUESTION_CHARS) {
        const err = new Error(`Question is too long (max ${MAX_QUESTION_CHARS} characters).`);
        err.status = 400;
        throw err;
    }
    const currentAttrs = sanitizeAttributes(current);
    const allowed = sanitizeOptions(options);

    let prospective;
    let source = 'rule-based';
    if (openai.isConfigured()) {
        const out = await openai.chatJson([
            {
                role: 'system',
                content: `You map HR "what if" questions to employee assignment attributes for the Kylrx Assignment Hub.
Return JSON: { "prospective": { ${DIMENSIONS.map(d => `"${d}": string`).join(', ')} } }.
Start from the current attributes and change only what the question asks for. Every value MUST be one of the allowed values for that dimension.
Allowed values: ${JSON.stringify(allowed)}`
            },
            { role: 'user', content: JSON.stringify({ current: currentAttrs, question: text }) }
        ]);
        prospective = { ...currentAttrs };
        for (const dim of DIMENSIONS) {
            const value = out.prospective && out.prospective[dim];
            if (value && (!allowed[dim].length || allowed[dim].includes(value))) prospective[dim] = value;
        }
        source = 'openai';
    } else {
        prospective = extractByKeywords(text, currentAttrs, allowed);
    }

    const impact = engine.calculateConfigurationImpact(currentAttrs, prospective);
    const changedAttributes = DIMENSIONS.filter(d => currentAttrs[d] !== prospective[d]);

    let summary = templatedSummary(impact);
    if (source === 'openai') {
        const brief = Object.fromEntries(Object.entries(impact.categories || {})
            .filter(([, c]) => c.status === 'MODIFIED')
            .map(([k, c]) => [k, (c.changes || []).slice(0, 6)]));
        const out = await openai.chatJson([
            {
                role: 'system',
                content: 'You explain HR assignment changes to an HR administrator. Return JSON: { "summary": string } with 3-6 short plain-English sentences covering what changes for the employee (pay, statutory, policies, documents, leave, approvals) and anything HR must do. Do not invent changes that are not listed.'
            },
            { role: 'user', content: JSON.stringify({ question: text, ruleBefore: impact.matchedRuleBefore, ruleAfter: impact.matchedRuleAfter, changes: brief }) }
        ]);
        if (out.summary) summary = String(out.summary).slice(0, 2000);
    }

    return { source, prospective, changedAttributes, summary, impact };
}

module.exports = { answerScenario };
