/**
 * AI assistance for the Document & Template Engine.
 *
 * - reviewTemplate: checks a template body (tokens, structure, safety, completeness) and
 *   returns a score with issues and suggestions. Rule-based checks always run; with
 *   OPENAI_API_KEY the model adds wording/legal-tone suggestions.
 * - draftTemplate: produces a revised template body from an instruction. With OpenAI the
 *   model rewrites the body; without it, standard clauses matching the instruction
 *   (probation, notice period, confidentiality, ...) are inserted before the closing.
 * - autofillValues: values for a template's tokens from an employee's record (and exit case,
 *   company profile, signed-in signatory). Never reads credentials stored on user records.
 */
const openai = require('./openai-client');

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const SYSTEM_TOKENS = new Set(['date.today', 'date.isoToday', 'company.name', 'company.taxId', 'company.address']);
const PAIRED_TAGS = ['p', 'div', 'strong', 'b', 'em', 'i', 'u', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'span'];

const aiConfigured = () => openai.isConfigured();

const tokensIn = (body) => [...new Set([...String(body || '').matchAll(TOKEN_RE)].map(m => m[1]))];
const tokenOf = (mapping) => String(mapping.token || '').replace(/[{}\s]/g, '');
const stripTags = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function ruleReview(body, fieldMappings = []) {
    const issues = [];
    const suggestions = [];
    const add = (severity, message) => issues.push({ severity, message });
    const html = String(body || '');
    const text = stripTags(html);
    const used = tokensIn(html);
    const mapped = new Set(fieldMappings.map(tokenOf));

    if (!text) add('critical', 'The template body is empty.');

    // Tokens
    const unmapped = used.filter(t => !mapped.has(t) && !SYSTEM_TOKENS.has(t));
    if (unmapped.length) add('high', `Tokens without a field mapping (they print as [token] unless the caller provides them): ${unmapped.map(t => `{{${t}}}`).join(', ')}.`);
    const unusedRequired = fieldMappings.filter(m => m.required && !used.includes(tokenOf(m)));
    if (unusedRequired.length) add('medium', `Required fields not used in the body: ${unusedRequired.map(m => m.label || m.token).join(', ')}.`);
    const broken = html.match(/\{\{[^}]*$|\{\{[^}]*\}(?!\})|(?<!\{)\{[a-zA-Z]+\.[a-zA-Z.]+\}(?!\})/gm);
    if (broken) add('high', `Malformed tokens (use {{group.field}}): ${[...new Set(broken)].slice(0, 5).join(', ')}.`);

    // Structure
    PAIRED_TAGS.forEach(tag => {
        const open = (html.match(new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')) || []).length;
        const close = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
        if (open !== close) add('medium', `Unbalanced <${tag}> tags (${open} opening, ${close} closing) can break the document layout.`);
    });

    // Safety
    if (/<script|javascript:|\son[a-z]+\s*=/i.test(html)) add('critical', 'Scripts or inline event handlers found. Remove them; documents must contain plain formatted content only.');
    if (/<iframe|<object|<embed/i.test(html)) add('high', 'Embedded frames/objects found. Remove them from the document.');

    // Completeness
    if (!used.some(t => t.startsWith('date.')) && !/\b(date|dated)\b/i.test(text)) suggestions.push('Add the issue date, e.g. "Date: {{date.today}}".');
    if (!used.includes('company.name')) suggestions.push('Mention the company with {{company.name}} so the letter carries your organization\'s legal name.');
    if (!/(sincerely|regards|authori[sz]ed signatory|for and on behalf)/i.test(text)) suggestions.push('Add a closing and signatory block (e.g. "For {{company.name}}, Authorized Signatory: {{signatory.name}}").');
    if (/\b(lorem ipsum|tbd|xxx+|\[insert[^\]]*\])/i.test(text)) add('high', 'Placeholder text found (Lorem ipsum / TBD / XXX / [insert ...]). Replace it before approval.');
    const longParagraph = text.split(/(?<=[.!?])\s{2,}|\n/).find(p => p.split(' ').length > 120);
    if (longParagraph) suggestions.push('Some paragraphs are very long; split them for readability.');
    if (text && text.split(' ').length < 25) suggestions.push('The document is very short; check that all required terms are covered.');

    const weights = { critical: 35, high: 15, medium: 8, low: 3 };
    const score = Math.max(0, 100 - issues.reduce((s, i) => s + weights[i.severity], 0) - suggestions.length * 3);
    return { score, issues, suggestions, tokensUsed: used, unmappedTokens: unmapped };
}

async function reviewTemplate({ templateName, templateBody, fieldMappings }) {
    const result = { ...ruleReview(templateBody, fieldMappings), source: 'rules' };
    if (!aiConfigured()) return result;
    const out = await openai.chatJson([
        { role: 'system', content: 'You review HR document templates (HTML with {{group.field}} tokens) for an Indian enterprise. Reply as JSON: {"suggestions": string[] (max 6, concrete wording, tone, legal-completeness improvements; never remove tokens)}.' },
        { role: 'user', content: JSON.stringify({ templateName, templateBody: String(templateBody).slice(0, 20000), fieldMappings: (fieldMappings || []).map(m => m.token) }) }
    ]);
    const extra = Array.isArray(out.suggestions) ? out.suggestions.map(s => String(s).slice(0, 300)).slice(0, 6) : [];
    return { ...result, suggestions: [...result.suggestions, ...extra], source: 'openai' };
}

// Standard clauses for the rule-based drafting fallback: [keywords, clause(number from the instruction)]
const CLAUSES = [
    [/probation/i, (n) => `<p><strong>Probation:</strong> You will be on probation for ${n || '{{probation.periodMonths}}'} months from your date of joining. On successful completion, your employment will be confirmed in writing.</p>`, /(\d+)\s*(month|mo)/i],
    [/notice/i, (n) => `<p><strong>Notice Period:</strong> Either party may end this employment by giving ${n || 60} days' written notice, or salary in lieu of the notice period.</p>`, /(\d+)\s*day/i],
    [/confidential|nda|non-disclosure/i, () => '<p><strong>Confidentiality:</strong> You shall keep all business, client and employee information of {{company.name}} strictly confidential during and after your employment, and sign the company\'s Non-Disclosure Agreement.</p>'],
    [/non[- ]?compete|non[- ]?solicit/i, (n) => `<p><strong>Non-Solicitation:</strong> For ${n || 12} months after leaving, you shall not solicit the company's employees or clients for a competing business.</p>`, /(\d+)\s*(month|mo)/i],
    [/working hours|work hours|timing/i, () => '<p><strong>Working Hours:</strong> Standard working hours are as per the company\'s attendance policy and your assigned shift; reasonable additional hours may be required.</p>'],
    [/background|verification/i, () => '<p><strong>Background Verification:</strong> This offer is subject to satisfactory verification of your education, employment history and identity documents.</p>'],
    [/benefit|insurance|medical/i, () => '<p><strong>Benefits:</strong> You will be covered under the company\'s group medical insurance and other benefits as per policy.</p>'],
    [/leave/i, () => '<p><strong>Leave:</strong> You will be entitled to leave as per the company\'s leave policy in force from time to time.</p>'],
    [/sign|signatory|closing/i, () => '<p>Sincerely,<br>For <strong>{{company.name}}</strong><br>Authorized Signatory: {{signatory.name}}</p>'],
    [/\bdate\b/i, () => '<p>Date: {{date.today}}</p>']
];

function ruleDraft(instruction, baseBody) {
    const added = [];
    let body = String(baseBody || '').trim();
    CLAUSES.forEach(([match, clause, numberRe]) => {
        if (!match.test(instruction)) return;
        const n = numberRe ? (instruction.match(numberRe) || [])[1] : undefined;
        const html = clause(n);
        // Skip clauses the template already has (same heading)
        const heading = (html.match(/<strong>([^<:]+):?<\/strong>/) || [])[1];
        if (heading && new RegExp(heading, 'i').test(stripTags(body))) return;
        added.push({ heading: heading || 'Clause', html });
    });
    if (!added.length) {
        const err = new Error('Without an OpenAI key, AI Draft can add standard clauses: probation, notice period, confidentiality, non-solicitation, working hours, background verification, benefits, leave, signature block or date. Mention one of these in the instruction, or edit the body directly.');
        err.status = 422;
        throw err;
    }
    // Insert before the signature section or closing ("Sincerely"/"Regards"/...), else at the end
    const closingStart = /(sincerely|regards|yours|for\s|authori[sz]ed)/.source;
    let closing = [
        /<div[^>]*class="[^"]*signature/i,
        new RegExp(`<div[^>]*>\\s*<p[^>]*>\\s*${closingStart}`, 'i'),
        new RegExp(`<p[^>]*>\\s*${closingStart}`, 'i')
    ].map(re => body.search(re)).filter(i => i > -1).sort((a, b) => a - b)[0] ?? -1;
    // No closing: insert inside the document, before its trailing closing tags
    if (closing === -1) closing = body.search(/(\s*<\/(div|section|article|body|html)>)+\s*$/i);
    const insert = added.map(a => a.html).join('\n');
    body = closing > -1 ? `${body.slice(0, closing)}\n${insert}\n${body.slice(closing)}` : `${body}\n${insert}`;
    return { templateBody: body, changeNotes: `Added ${added.map(a => a.heading.toLowerCase()).join(', ')} clause${added.length > 1 ? 's' : ''}.`, addedClauses: added.map(a => a.heading) };
}

async function draftTemplate({ templateName, instruction, baseBody, fieldMappings }) {
    const ask = String(instruction || '').trim().slice(0, 1000);
    if (!ask) {
        const err = new Error('Describe what to change, e.g. "Add a 6-month probation clause and a confidentiality clause".');
        err.status = 400;
        throw err;
    }
    if (!aiConfigured()) return { ...ruleDraft(ask, baseBody), source: 'rules' };

    const out = await openai.chatJson([
        { role: 'system', content: 'You edit HR document templates written in simple HTML (p, strong, br, table, ul, li only) with {{group.field}} tokens. Keep every existing token unless asked to remove it; use only tokens from the provided list plus {{date.today}}, {{company.name}}, {{signatory.name}}. No scripts or styles. Reply as JSON: {"templateBody": string, "changeNotes": string (one sentence)}.' },
        { role: 'user', content: JSON.stringify({ templateName, instruction: ask, availableTokens: (fieldMappings || []).map(m => m.token), currentBody: String(baseBody || '').slice(0, 20000) }) }
    ], { temperature: 0.3 });
    const templateBody = String(out.templateBody || '').trim();
    if (!templateBody) {
        const err = new Error('The AI did not return a template. Please rephrase the instruction.');
        err.status = 502;
        throw err;
    }
    return { templateBody, changeNotes: String(out.changeNotes || 'AI-assisted revision').slice(0, 300), source: 'openai' };
}

const fmtDate = (value) => {
    const d = value && typeof value.toDate === 'function' ? value.toDate() : (value ? new Date(value) : null);
    return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
};
const inr = (value) => {
    const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 1 ? `₹${n.toLocaleString('en-IN')}` : '';
};

/**
 * Values for the template's tokens from the employee's record. Returns { values: {token: value},
 * filled: [tokens], missing: [tokens] }; only fields the record actually has are filled.
 */
function autofillValues({ fieldMappings, user, exit, company, signatoryName }) {
    const name = user.name || user.displayName || '';
    const department = user.departmentName || user.department || '';
    const source = {
        'employee.name': name, 'candidate.name': name,
        'employee.email': user.email, 'candidate.email': user.email,
        'employee.code': user.employeeId || user.employeeCode,
        'employee.designation': user.designation, 'job.title': user.designation, 'promotion.previousTitle': user.designation,
        'employee.department': department, 'job.department': department,
        'employee.joiningDate': fmtDate(user.joiningDate), 'offer.joiningDate': fmtDate(user.joiningDate),
        'job.location': user.workLocation || user.location || user.city,
        'compensation.annualCtc': inr(user.salary || user.ctc), 'compensation.previousCtc': inr(user.salary || user.ctc),
        'exit.resignationDate': exit && fmtDate(exit.createdAt),
        'exit.lastWorkingDay': exit && fmtDate(exit.lwd), 'exit.relievingDate': exit && fmtDate(exit.lwd || user.relievedAt),
        'termination.reason': exit && /termination/i.test(exit.type || '') ? exit.reason : '',
        'signatory.name': signatoryName,
        'company.name': company && company.name
    };
    const values = {};
    const filled = [];
    const missing = [];
    (fieldMappings || []).forEach(m => {
        const token = tokenOf(m);
        const value = source[token];
        if (value !== undefined && value !== null && String(value).trim()) {
            values[m.token] = String(value).trim();
            filled.push(m.token);
        } else {
            missing.push(m.label || m.token);
        }
    });
    return { values, filled, missing };
}

module.exports = { aiConfigured, reviewTemplate, draftTemplate, autofillValues, ruleReview };
