/**
 * AI assistant for the Automation Builder.
 *
 *  - generateWorkflow(prompt): plain-English description -> builder steps
 *  - suggestNextStep(workflow): proposes the next step for the workflow on the canvas
 *
 * Uses the OpenAI Chat Completions API when OPENAI_API_KEY is set in .env (model from
 * OPENAI_MODEL). Without a key it falls back to the built-in rule-based generator, so the
 * feature still works offline. Output is always validated against the builder's step types
 * and the automation module registry's real trigger/action names.
 */
const crypto = require('crypto');
const logger = require('../utils/logger');
const moduleRegistry = require('./automation-module-registry');
const ruleBasedCreator = require('./ai-workflow-creator-service');
const openai = require('./openai-client');

const MAX_PROMPT_CHARS = 2000;
const MAX_STEPS = 20;

const STEP_TYPES = ['trigger', 'condition', 'branch', 'approval', 'wait', 'escalation', 'action', 'notification', 'end'];

// Short module names used by stored steps (see admin-automation-builder.js resolveModuleId)
const MODULE_ALIASES = {
    exit_offboarding: 'exit',
    leave_attendance: 'leave',
    payroll_disbursement: 'payroll',
    statutory_compliance: 'statutory',
    policy_center: 'policy',
    onboarding: 'onboarding'
};

const aiConfigured = openai.isConfigured;

function catalogSummary() {
    return moduleRegistry.getSchemaCatalog().map(m => ({
        module: MODULE_ALIASES[m.moduleKey] || m.moduleKey,
        name: m.moduleName,
        triggers: m.triggers.map(t => t.name),
        actions: m.actions.map(a => a.actionKey),
        conditionFields: m.conditions.map(c => c.field)
    }));
}

function knownTriggers() {
    return new Set(catalogSummary().flatMap(m => m.triggers));
}

const STEP_SHAPE = `Each step is an object:
{ "type": one of ${STEP_TYPES.join(' | ')},
  "title": short title (max 60 chars),
  "description": one sentence,
  "module": module short name from the catalog, or "core",
  "config": type-specific settings:
    trigger:      { "eventType": "<trigger name from the catalog>", "scope": "all_departments" }
    condition:    { "rules": [{ "field": "...", "operator": "==", "value": "..." }], "matchType": "ALL" | "ANY" }
    branch:       { "conditionField": "...", "branchA": { "label": "...", "next": "..." }, "branchB": { "label": "...", "next": "..." } }
    approval:     { "chain": ["Direct Manager", "HR Operations"], "slaHours": 48, "requireAll": true }
    wait:         { "duration": 2, "unit": "hours" | "days", "waitForEvent": "none" }
    escalation:   { "thresholdHours": 48, "escalateTo": "Head of HR", "escalationAction": "..." }
    action:       { "actionName": "<action from the catalog>", "targetService": "...", "generateDocuments": false }
    notification: { "channels": ["Email", "In-App Portal"], "recipients": ["Employee", "Direct Manager"], "template": "..." }
    end:          { "status": "COMPLETED", "archiveRecord": true, "emitAuditEvent": true } }`;

const callOpenAI = (messages) => openai.chatJson(messages);

/**
 * Makes model (or fallback) output safe for the builder: known step types only, a trigger
 * first with a real event name, an end step last, sane titles and ids.
 */
function normalizeSteps(rawSteps) {
    const triggers = knownTriggers();
    const steps = (Array.isArray(rawSteps) ? rawSteps : [])
        .filter(s => s && STEP_TYPES.includes(s.type))
        .slice(0, MAX_STEPS)
        .map((s, i) => normalizeStep(s, i, triggers));

    if (!steps.length || steps[0].type !== 'trigger') {
        steps.unshift(normalizeStep({ type: 'trigger', title: 'Workflow Started', config: { eventType: 'custom.trigger' } }, 0, triggers));
    }
    if (steps[steps.length - 1].type !== 'end') {
        steps.push(normalizeStep({ type: 'end', title: 'Workflow Completed', module: steps[0].module }, steps.length, triggers));
    }
    return steps;
}

function normalizeStep(s, index, triggers = knownTriggers()) {
    const config = (s.config && typeof s.config === 'object') ? { ...s.config } : {};
    if (s.type === 'trigger') {
        const event = String(config.eventType || 'custom.trigger').replace(/:/g, '.');
        config.eventType = triggers.has(event) ? event : 'custom.trigger';
        config.scope = config.scope || 'all_departments';
    }
    return {
        id: `node-ai-${Date.now()}-${index}-${crypto.randomBytes(2).toString('hex')}`,
        type: s.type,
        title: String(s.title || s.type).slice(0, 80),
        description: String(s.description || '').slice(0, 300),
        module: String(s.module || 'core').slice(0, 40),
        config
    };
}

// Rule-based fallback: map the existing generator's canvas nodes onto builder steps
function fallbackGenerate(prompt) {
    const result = ruleBasedCreator.generateWorkflowFromPrompt(prompt);
    const typeMap = { trigger: 'trigger', condition: 'condition', approval: 'approval', wait: 'wait', delay: 'wait', notification: 'notification', notify: 'notification', email: 'notification', end: 'end', escalation: 'escalation' };
    const nodes = (result.workflow && result.workflow.canvas && result.workflow.canvas.nodes) || [];
    const lower = prompt.toLowerCase();
    const module = /resign|exit|offboard/.test(lower) ? 'exit'
        : /leave|attendance|absen/.test(lower) ? 'leave'
        : /payroll|salary|payslip/.test(lower) ? 'payroll'
        : /onboard|hire|joining|candidate/.test(lower) ? 'onboarding'
        : /policy/.test(lower) ? 'policy' : 'core';
    const eventByModule = { exit: 'exit.resignation_submitted', leave: 'leave.applied', payroll: 'payroll.run_initiated', onboarding: 'onboarding.candidate_invited', policy: 'policy.acknowledgement_pending' };
    const steps = nodes.map(n => ({
        type: typeMap[n.type] || 'action',
        title: n.label,
        description: n.label,
        module,
        config: n.type === 'trigger' ? { eventType: eventByModule[module] || 'custom.trigger' } : (n.config || {})
    }));
    return {
        name: (result.workflow && result.workflow.name) || 'AI Generated Workflow',
        description: (result.workflow && result.workflow.description) || prompt,
        module,
        steps: normalizeSteps(steps),
        explanation: result.explanation || 'Generated by the built-in rule-based assistant.',
        source: 'rule-based'
    };
}

async function generateWorkflow(prompt) {
    const text = String(prompt || '').trim();
    if (!text) {
        const err = new Error('Describe the workflow you want to build.');
        err.status = 400;
        throw err;
    }
    if (text.length > MAX_PROMPT_CHARS) {
        const err = new Error(`Description is too long (max ${MAX_PROMPT_CHARS} characters).`);
        err.status = 400;
        throw err;
    }
    if (!aiConfigured()) return fallbackGenerate(text);

    const out = await callOpenAI([
        {
            role: 'system',
            content: `You design HR automation workflows for the Kylrx HRMS Automation Builder.
Return JSON: { "name": string, "description": string, "module": string, "explanation": string, "steps": [step, ...] }.
${STEP_SHAPE}
Rules: the first step is exactly one trigger; the last step is an end step; use only trigger and action names from this catalog; keep it to the steps the user described (typically 4-12).
Catalog: ${JSON.stringify(catalogSummary())}`
        },
        { role: 'user', content: text }
    ]);

    return {
        name: String(out.name || 'AI Generated Workflow').slice(0, 100),
        description: String(out.description || text).slice(0, 500),
        module: String(out.module || 'core').slice(0, 40),
        steps: normalizeSteps(out.steps),
        explanation: String(out.explanation || '').slice(0, 1000),
        source: 'openai'
    };
}

// Heuristic next step used without an API key
function fallbackSuggest(steps) {
    const types = steps.map(s => s.type);
    const has = (t) => types.includes(t);
    const module = (steps[0] && steps[0].module) || 'core';
    let type = 'action';
    let reason = 'Add the main action this workflow should perform.';
    if (!has('trigger')) { type = 'trigger'; reason = 'Every workflow needs a trigger that starts it.'; }
    else if (!has('approval')) { type = 'approval'; reason = 'Most HR workflows need a manager or HR sign-off.'; }
    else if (!has('escalation')) { type = 'escalation'; reason = 'Escalate if the approval is not actioned within its SLA.'; }
    else if (!has('notification')) { type = 'notification'; reason = 'Inform the employee and stakeholders of the outcome.'; }
    return { step: normalizeStep({ type, title: '', module, config: {} }, 0), reason, source: 'rule-based' };
}

async function suggestNextStep(workflow) {
    const steps = (workflow && Array.isArray(workflow.steps) ? workflow.steps : []).slice(0, MAX_STEPS).map(s => ({
        type: s.type, title: s.title, module: s.module, config: s.config
    }));
    if (!aiConfigured()) return fallbackSuggest(steps);

    const out = await callOpenAI([
        {
            role: 'system',
            content: `You help build HR automation workflows in the Kylrx Automation Builder.
Given the current steps, propose the single most useful next step to insert before the final end step.
Return JSON: { "step": step, "reason": one sentence explaining why }.
${STEP_SHAPE}
Do not propose another trigger or end step. Catalog: ${JSON.stringify(catalogSummary())}`
        },
        { role: 'user', content: JSON.stringify({ name: workflow && workflow.name, steps }) }
    ]);

    const raw = out.step && STEP_TYPES.includes(out.step.type) && !['trigger', 'end'].includes(out.step.type)
        ? out.step
        : { type: 'action', title: 'Next Action' };
    return { step: normalizeStep(raw, 0), reason: String(out.reason || '').slice(0, 300), source: 'openai' };
}

module.exports = { generateWorkflow, suggestNextStep, aiConfigured, normalizeSteps };

if (!aiConfigured()) {
    logger.info('[AutomationAI] OPENAI_API_KEY not set: Automation Builder AI uses the rule-based fallback.');
}
