const express = require('express');
const router = express.Router();
const controlsAcceptanceService = require('../services/controls-acceptance-service');
const customTemplateEngine = require('../services/custom-template-engine');
const TenantEngineStore = require('../services/tenant-engine-store');
const acceptanceAi = require('../services/acceptance-ai-service');
const logger = require('../utils/logger');
const { rawCollection } = require('../config/firebase');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * PRD Section 4: Controls, Acceptance & Client Sign-Off.
 *
 * Every organization has its own client decisions and sign-off certificates, saved to
 * Firestore (`acceptance_decisions`, `acceptance_signoffs`) with its orgId; changes respond
 * only after Firestore confirmed them (503 otherwise). The acceptance matrix runs on
 * throwaway copies of the engines and creates no data. The acting user is the signed-in
 * user, not a name sent by the browser.
 */

const store = new TenantEngineStore({
    name: 'ControlsAcceptance',
    createEngine: () => new controlsAcceptanceService.constructor(),
    maps: [
        { field: 'clientDecisions', collection: 'acceptance_decisions', idOf: d => d.id, put: (engine, d) => engine.clientDecisions.set(d.id, d) },
        {
            field: 'signOffRecords',
            collection: 'acceptance_signoffs',
            idOf: r => r.certificateId,
            put: (engine, r) => {
                engine.signOffRecords.push(r);
                engine.signOffRecords.sort((a, b) => String(b.sealedAt || '').localeCompare(String(a.sealedAt || '')));
            }
        }
    ]
});

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorOf(req, organization) {
    const u = req.user || {};
    return {
        id: u.uid || u.id || 'admin',
        name: u.name || u.displayName || u.email || 'Administrator',
        role: u.role || 'admin',
        email: u.email || '',
        organization
    };
}

function sendError(res, err, context, status = 500) {
    logger.error(`[ControlsAcceptanceAPI] ${context}:`, err.message);
    res.status(err.status || status).json({ success: false, firebaseSaved: false, error: err.message, message: err.message });
}

/** The organization's legal/display name from its profile */
async function organizationName(orgId) {
    try {
        const snap = await rawCollection('organizations').doc(orgId).get();
        const o = snap.exists ? snap.data() : {};
        return o.legalName || o.Legal_Name || o.displayName || o.Display_Name || o.name || '';
    } catch (_) {
        return '';
    }
}

async function factsFor(req) {
    const users = await orgDocs(rawCollection, 'users', orgOf(req), 2000);
    return acceptanceAi.companyFacts({ users, templates: customTemplateEngine.listTemplates({}) });
}

/**
 * 4.1 Common Platform Requirements Overview & Telemetry
 * GET /api/controls-acceptance/platform-controls
 */
router.get('/platform-controls', (req, res) => {
    try {
        res.json({ success: true, data: controlsAcceptanceService.getPlatformRequirementsSummary() });
    } catch (err) {
        sendError(res, err, 'Platform controls error');
    }
});

/**
 * 4.2 Acceptance Criteria Live Verification Matrix
 * GET /api/controls-acceptance/criteria-matrix (self-test; creates no data)
 */
router.get('/criteria-matrix', async (req, res) => {
    try {
        res.json({ success: true, data: await controlsAcceptanceService.verifyAcceptanceCriteria() });
    } catch (err) {
        sendError(res, err, 'Criteria matrix error');
    }
});

/**
 * 4.3 Client Decisions Required Management
 * GET /api/controls-acceptance/decisions
 */
router.get('/decisions', async (req, res) => {
    try {
        res.json({ success: true, data: await store.read(orgOf(req), engine => engine.getAllClientDecisions()) });
    } catch (err) {
        sendError(res, err, 'Decisions error');
    }
});

/**
 * POST /api/controls-acceptance/decisions/batch-confirm
 * (registered before /decisions/:id)
 */
router.post('/decisions/batch-confirm', async (req, res) => {
    try {
        const organization = await organizationName(orgOf(req));
        const confirmed = await store.change(orgOf(req), engine => engine.batchConfirmAllRecommendations(actorOf(req, organization)));
        res.json({ success: true, firebaseSaved: true, message: `All ${confirmed.length} recommendations confirmed and saved.`, data: confirmed });
    } catch (err) {
        sendError(res, err, 'Batch confirm error');
    }
});

/**
 * GET /api/controls-acceptance/decisions/:id
 */
router.get('/decisions/:id', async (req, res) => {
    try {
        const decision = await store.read(orgOf(req), engine => engine.getClientDecisionById(req.params.id));
        if (!decision) {
            return res.status(404).json({ success: false, error: `Decision '${req.params.id}' not found.` });
        }
        res.json({ success: true, data: decision });
    } catch (err) {
        sendError(res, err, 'Decision error');
    }
});

/**
 * POST /api/controls-acceptance/decisions/:id
 */
router.post('/decisions/:id', async (req, res) => {
    try {
        const { selectedOption, notes } = req.body || {};
        const organization = await organizationName(orgOf(req));
        const updated = await store.change(orgOf(req), engine => {
            const decision = engine.getClientDecisionById(req.params.id);
            if (!decision) {
                const err = new Error(`Decision '${req.params.id}' not found.`);
                err.status = 404;
                throw err;
            }
            if (selectedOption !== undefined && !decision.options.includes(selectedOption)) {
                const err = new Error('Choose one of the listed options.');
                err.status = 400;
                throw err;
            }
            return engine.recordClientDecision(req.params.id, {
                selectedOption,
                notes: notes === undefined ? undefined : String(notes).slice(0, 2000)
            }, actorOf(req, organization));
        });
        res.json({ success: true, firebaseSaved: true, message: `Decision '${req.params.id}' confirmed and saved.`, data: updated });
    } catch (err) {
        sendError(res, err, 'Decision update error', 400);
    }
});

/**
 * 4.4 Delivery Phasing & Recommended Next Steps
 * GET /api/controls-acceptance/delivery-roadmap
 */
router.get('/delivery-roadmap', (req, res) => {
    try {
        res.json({ success: true, data: controlsAcceptanceService.getDeliveryRoadmap() });
    } catch (err) {
        sendError(res, err, 'Roadmap error');
    }
});

/**
 * POST /api/controls-acceptance/sign-off
 * Records formal client approval and generates tamper-evident certificate
 */
router.post('/sign-off', async (req, res) => {
    try {
        const { representativeName, representativeTitle, organization, signatureDate, clientComments, signOffScope } = req.body || {};
        const orgName = await organizationName(orgOf(req));
        const record = await store.change(orgOf(req), engine => {
            const approval = engine.recordClientApproval({
                representativeName,
                representativeTitle,
                organization: organization || orgName || undefined,
                signatureDate,
                clientComments: clientComments === undefined ? undefined : String(clientComments).slice(0, 2000),
                signOffScope
            });
            // Who recorded it in the system (the representative may be someone else)
            const u = actorOf(req);
            approval.recordedBy = { id: u.id, name: u.name, email: u.email, role: u.role };
            return approval;
        });
        res.status(201).json({ success: true, firebaseSaved: true, message: 'Formal client sign-off registered, sealed and saved.', data: record });
    } catch (err) {
        sendError(res, err, 'Sign-off error', 400);
    }
});

/**
 * GET /api/controls-acceptance/sign-off/status
 */
router.get('/sign-off/status', async (req, res) => {
    try {
        const { latest, all } = await store.read(orgOf(req), engine => ({ latest: engine.getLatestSignOff(), all: engine.getAllSignOffRecords() }));
        res.json({ success: true, data: { isSigned: Boolean(latest), latestCertificate: latest, allSignOffs: all } });
    } catch (err) {
        sendError(res, err, 'Sign-off status error');
    }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━ AI ASSIST ━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// GET /api/controls-acceptance/ai/status
router.get('/ai/status', (req, res) => {
    res.json({ success: true, data: { aiConfigured: acceptanceAi.aiConfigured() } });
});

// GET /api/controls-acceptance/ai/facts - What the advice is based on
router.get('/ai/facts', async (req, res) => {
    try {
        const [facts, organization] = await Promise.all([factsFor(req), organizationName(orgOf(req))]);
        res.json({ success: true, data: { ...facts, organization } });
    } catch (err) {
        sendError(res, err, 'Facts error');
    }
});

// POST /api/controls-acceptance/ai/advise/:id - Recommendation for one decision (not saved)
router.post('/ai/advise/:id', async (req, res) => {
    try {
        const decision = await store.read(orgOf(req), engine => engine.getClientDecisionById(req.params.id));
        if (!decision) return res.status(404).json({ success: false, error: `Decision '${req.params.id}' not found.` });
        res.json({ success: true, data: await acceptanceAi.adviseDecision({ decision, facts: await factsFor(req) }) });
    } catch (err) {
        sendError(res, err, 'AI advise error');
    }
});

// POST /api/controls-acceptance/ai/readiness - Go-live readiness from checks, decisions and sign-off
router.post('/ai/readiness', async (req, res) => {
    try {
        const [matrix, { decisions, signOff }, facts] = await Promise.all([
            controlsAcceptanceService.verifyAcceptanceCriteria(),
            store.read(orgOf(req), engine => ({ decisions: engine.getAllClientDecisions(), signOff: engine.getLatestSignOff() })),
            factsFor(req)
        ]);
        res.json({ success: true, data: acceptanceAi.readiness({ matrix, decisions, signOff, facts }) });
    } catch (err) {
        sendError(res, err, 'AI readiness error');
    }
});

module.exports = router;
