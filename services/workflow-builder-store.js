/**
 * Firestore persistence + organization isolation for the Workflow Builder.
 *
 * WorkflowBuilderService keeps its state in memory. This store gives every organization its
 * own service instance, loaded from Firestore on first use, and after each mutating API
 * request writes the changes back:
 *
 *   workflow_builder_workflows/{workflowId}   full workflow (versions, stage configs) as JSON
 *   workflow_builder_audit/{auditId}          change audit trail
 *   workflow_builder_runs/{runId}             test / execution run history
 *
 * Every document carries orgId. If Firestore does not confirm the write (quota exhausted,
 * offline), the in-memory state is rolled back to before the request and the API answers 503,
 * so the UI never shows a change that was not saved.
 */
const logger = require('../utils/logger');
const { rawCollection, db } = require('../config/firebase');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const sharedService = require('./workflow-builder-service');
const { confirmedWrite } = require('../config/firestore-write');

const WorkflowBuilderService = sharedService.constructor;
const COLLECTIONS = {
    workflows: 'workflow_builder_workflows',
    audit: 'workflow_builder_audit',
    runs: 'workflow_builder_runs'
};
const BATCH_LIMIT = 450;
const HISTORY_LIMIT = 500;

const contexts = new Map(); // orgId -> Promise<{ service, persisted }>
const locks = new Map();    // orgId -> Promise (serializes requests per org)

const docId = (id) => String(id).replace(/\//g, '_');

function rebuildDerivedState(service) {
    service.questionConfigs = new Map();
    service.automationConfigs = new Map();
    service.compiledRules = new Map();
    for (const wf of service.workflows.values()) {
        for (const [stageId, record] of Object.entries(wf.questionConfigs || {})) {
            service.questionConfigs.set(`${wf.id}_${stageId}`, record);
        }
        for (const [stageId, record] of Object.entries(wf.automationConfigs || {})) {
            service.automationConfigs.set(`${wf.id}_${stageId}`, record);
        }
        try {
            const compiled = service.compileToAutomationRule(wf);
            const versions = new Map([[wf.version, compiled]]);
            if (wf.activeVersionNumber) versions.set(wf.activeVersionNumber, compiled);
            service.compiledRules.set(wf.id, versions);
        } catch (err) {
            logger.warn(`[WorkflowBuilderStore] Could not compile '${wf.name}': ${err.message}`);
        }
    }
}

async function loadContext(orgId) {
    const service = new WorkflowBuilderService();
    const [workflowDocs, auditDocs, runDocs] = await Promise.all([
        orgDocs(rawCollection, COLLECTIONS.workflows, orgId, HISTORY_LIMIT),
        orgDocs(rawCollection, COLLECTIONS.audit, orgId, HISTORY_LIMIT),
        orgDocs(rawCollection, COLLECTIONS.runs, orgId, HISTORY_LIMIT)
    ]);

    const persisted = { workflows: new Map(), audit: new Set(), runs: new Set() };

    if (workflowDocs.length || orgId !== LEGACY_ORG_ID) {
        // Stored workflows replace the built-in samples. Other organizations start empty;
        // the samples remain only for the original (Kylrx AI) organization until it saves.
        service.workflows.clear();
        service.executionLogs.clear();
        service.auditTrail = [];
    }
    for (const d of workflowDocs) {
        try {
            const wf = JSON.parse(d.data);
            service.workflows.set(wf.id, wf);
            persisted.workflows.set(wf.id, d.data);
        } catch (err) {
            logger.warn(`[WorkflowBuilderStore] Skipping unreadable workflow ${d.id}: ${err.message}`);
        }
    }
    for (const d of auditDocs.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))) {
        try {
            const entry = JSON.parse(d.data);
            service.auditTrail.push(entry);
            persisted.audit.add(entry.id);
        } catch (_) {}
    }
    for (const d of runDocs) {
        try {
            const run = JSON.parse(d.data);
            service.executionLogs.set(run.runId, run);
            persisted.runs.add(run.runId);
        } catch (_) {}
    }
    rebuildDerivedState(service);
    logger.info(`[WorkflowBuilderStore] Loaded ${service.workflows.size} workflows for ${orgId} from Firestore.`);
    return { orgId, service, persisted };
}

function getContext(orgId) {
    if (!contexts.has(orgId)) {
        const pending = loadContext(orgId).catch(err => {
            contexts.delete(orgId); // retry on the next request
            throw err;
        });
        contexts.set(orgId, pending);
    }
    return contexts.get(orgId);
}

async function acquire(orgId) {
    const previous = locks.get(orgId) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    locks.set(orgId, previous.then(() => current));
    await previous;
    let released = false;
    return () => {
        if (!released) {
            released = true;
            release();
        }
    };
}

function snapshot(service) {
    return {
        workflows: structuredClone([...service.workflows]),
        executionLogs: structuredClone([...service.executionLogs]),
        auditTrail: structuredClone(service.auditTrail)
    };
}

function restore(service, snap) {
    service.workflows = new Map(snap.workflows);
    service.executionLogs = new Map(snap.executionLogs);
    service.auditTrail = snap.auditTrail;
    rebuildDerivedState(service);
}


/** Writes everything that changed since the last successful save. */
async function persist(ctx) {
    const { service, persisted, orgId } = ctx;
    const ops = [];
    const now = new Date().toISOString();

    const workflowJson = new Map();
    for (const [id, wf] of service.workflows) {
        const json = JSON.stringify(wf);
        workflowJson.set(id, json);
        if (persisted.workflows.get(id) !== json) {
            ops.push(b => b.set(rawCollection(COLLECTIONS.workflows).doc(docId(id)), {
                orgId, workflowId: id, name: wf.name || '', status: wf.status || 'draft', updatedAt: now, data: json
            }));
        }
    }
    for (const id of persisted.workflows.keys()) {
        if (!service.workflows.has(id)) ops.push(b => b.delete(rawCollection(COLLECTIONS.workflows).doc(docId(id))));
    }
    const newAudit = service.auditTrail.filter(e => e && e.id && !persisted.audit.has(e.id));
    for (const e of newAudit) {
        ops.push(b => b.set(rawCollection(COLLECTIONS.audit).doc(docId(e.id)), {
            orgId, workflowId: e.workflowId || '', timestamp: e.timestamp || now, data: JSON.stringify(e)
        }));
    }
    const newRuns = [...service.executionLogs.values()].filter(r => r && r.runId && !persisted.runs.has(r.runId));
    for (const r of newRuns) {
        ops.push(b => b.set(rawCollection(COLLECTIONS.runs).doc(docId(r.runId)), {
            orgId, workflowId: r.workflowId || '', timestamp: r.timestamp || now, data: JSON.stringify(r)
        }));
    }
    if (!ops.length) return;

    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        ops.slice(i, i + BATCH_LIMIT).forEach(op => op(batch));
        await confirmedWrite(() => batch.commit());
    }
    persisted.workflows = workflowJson;
    newAudit.forEach(e => persisted.audit.add(e.id));
    newRuns.forEach(r => persisted.runs.add(r.runId));
}

/**
 * Express middleware: sets req.wfService to the caller's organization's service. For
 * POST/PUT/DELETE requests, successful responses are only sent after Firestore confirmed
 * the changes; failed requests are rolled back.
 */
async function attach(req, res, next) {
    const orgId = req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
    const release = await acquire(orgId);
    res.on('finish', release);
    res.on('close', release);

    let ctx;
    try {
        ctx = await getContext(orgId);
    } catch (err) {
        release();
        logger.error(`[WorkflowBuilderStore] Could not load workflows for ${orgId}: ${err.message}`);
        return res.status(503).json({ success: false, error: 'Could not load workflows from Firebase. Please try again.' });
    }
    req.wfService = ctx.service;

    // GETs and the canvas validator never change data
    if (req.method === 'GET' || req.path === '/validate') return next();

    const before = snapshot(ctx.service);
    const sendJson = res.json.bind(res);
    res.json = (body) => {
        if (res.statusCode >= 300) {
            restore(ctx.service, before); // undo any partial change from a failed request
            return sendJson(body);
        }
        persist(ctx)
            .then(() => sendJson(body))
            .catch(err => {
                restore(ctx.service, before);
                logger.warn(`[WorkflowBuilderStore] Save failed for ${orgId}: ${err.message}`);
                res.status(503);
                sendJson({ success: false, error: err.message, firebaseSaved: false });
            });
        return res;
    };
    next();
}

module.exports = { attach, persist, getContext, COLLECTIONS };
