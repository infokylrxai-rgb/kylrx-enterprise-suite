const express = require('express');
const router = express.Router();
const bulkTriggerEngine = require('../services/bulk-trigger-engine');
const otpVerificationService = require('../services/otp-verification-service');
const aiAssistedBuilderService = require('../services/ai-assisted-builder-service');
const TenantEngineStore = require('../services/tenant-engine-store');
const bulkMessageAi = require('../services/bulk-message-ai-service');
const logger = require('../utils/logger');
const { rawCollection } = require('../config/firebase');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * 2. Bulk Triggering and AI-Assisted Builder REST API (PRD §2)
 *
 * Endpoints:
 * - POST /api/bulk-trigger/validate          - Validates selection, permissions, data, consent & returns count preview
 * - POST /api/bulk-trigger/execute           - Executes batch processing job (queued -> processing -> completed)
 * - GET  /api/bulk-trigger/jobs/:jobId       - Real-time job progress, batch status & failed items review
 * - POST /api/bulk-trigger/jobs/:jobId/retry - Safe retry for failed items avoiding duplicate actions
 * - GET  /api/bulk-trigger/config            - View configurable batch size & provider limits
 * - PUT  /api/bulk-trigger/config            - Administrator updates batch size & rate limits
 * - POST /api/bulk-trigger/otp/generate      - Separate OTP engine: generate secure OTP with TTL & attempt limits
 * - POST /api/bulk-trigger/otp/verify        - Separate OTP engine: verify single-use OTP with attempt counters
 * - GET  /api/bulk-trigger/otp/status/:otpId - Query sanitized OTP status
 * - GET  /api/bulk-trigger/audit-logs        - Immutable audit trail: initiator, time, count, outcome
 *
 * Every organization has its own engine (settings, jobs, audit trail) and its own AI builder
 * configurations, loaded from and saved to Firestore with its orgId. Saves are confirmed
 * (503 when Firestore refuses). Recipients are limited to the organization's own people, and
 * the acting user is the signed-in user rather than an "actor" sent by the browser.
 */

const MAX_RECIPIENTS = 2000;

// orgId -> BulkTriggerEngine for that organization
const engines = new Map();
async function engineFor(req) {
    const orgId = orgOf(req);
    if (!engines.has(orgId)) engines.set(orgId, new bulkTriggerEngine.constructor({ orgId }));
    const engine = engines.get(orgId);
    try {
        await engine.ready;
    } catch (err) {
        engines.delete(orgId);
        throw err;
    }
    return engine;
}

// AI builder drafts/configurations per organization (Firestore `bulk_ai_configs`)
const aiStore = new TenantEngineStore({
    name: 'BulkAiBuilder',
    createEngine: () => new aiAssistedBuilderService.constructor({ sync: false }),
    maps: [{ field: 'configurations', collection: 'bulk_ai_configs', idOf: c => c.id, put: (engine, c) => engine.configurations.set(c.id, c) }]
});

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

/** Engine actor for the signed-in user (super admins act as super_admin, other admins as hr_admin) */
function actorOf(req) {
    const u = req.user || {};
    const role = String(u.role || '').toLowerCase().replace(/[\s_-]+/g, '');
    return {
        id: u.uid || u.id || 'admin',
        name: u.name || u.displayName || u.email || 'Administrator',
        role: role === 'superadmin' || u.super_admin === true || u.superadmin === true ? 'super_admin' : 'hr_admin'
    };
}

function sendError(res, err, context, status = 400) {
    logger.error(`[BulkTriggerAPI] ${context}:`, err.message);
    res.status(err.status || status).json({ success: false, firebaseSaved: false, error: err.message, message: err.message });
}

/** Lets the engine accept only this organization's people as recipients */
async function withMembers(engine, req) {
    const users = await orgDocs(rawCollection, 'users', orgOf(req), MAX_RECIPIENTS);
    engine.memberIds = new Set(users.map(u => String(u.id)));
}

function checkRecipients(recipients) {
    if (!Array.isArray(recipients)) return [];
    if (recipients.length > MAX_RECIPIENTS) {
        const err = new Error(`Select at most ${MAX_RECIPIENTS} recipients per job.`);
        err.status = 400;
        throw err;
    }
    return recipients;
}

// 1. Validate Selection & Count Preview (PRD §2.1)
router.post('/validate', async (req, res) => {
    try {
        const { action, recipients, payload } = req.body || {};
        const engine = await engineFor(req);
        await withMembers(engine, req);
        const validation = engine.validateSelection({
            action,
            recipients: checkRecipients(recipients),
            payload: payload || {},
            actor: actorOf(req)
        });

        res.status(200).json({
            success: true,
            data: validation,
            message: `Validated ${validation.totalSelected} items: ${validation.validCount} valid (${validation.estimatedBatches} batches of ${validation.batchSize}), ${validation.invalidCount} invalid.`
        });
    } catch (err) {
        sendError(res, err, 'Validation error');
    }
});

// 2. Execute Bulk Triggering Job (PRD §2.1 & §2.2)
router.post('/execute', async (req, res) => {
    try {
        const { action, recipients, payload, options } = req.body || {};
        const engine = await engineFor(req);
        await withMembers(engine, req);
        const jobResult = await engine.executeBulkTrigger({
            action,
            recipients: checkRecipients(recipients),
            payload: payload || {},
            actor: actorOf(req),
            // Batch size comes from the saved settings; test-only failure simulation is not accepted
            options: { skipDelay: Boolean(options && options.skipDelay) }
        });

        res.status(200).json({
            success: true,
            firebaseSaved: jobResult.firebaseSaved !== false,
            data: jobResult,
            message: `Job ${jobResult.jobId} processed: ${jobResult.successCount} succeeded, ${jobResult.failureCount} failed of ${jobResult.totalItems} total.`
                + (jobResult.firebaseSaved === false ? ` Warning: the job result could not be saved (${jobResult.saveError}).` : '')
        });
    } catch (err) {
        sendError(res, err, 'Execution error');
    }
});

// 2.9 Get Latest Job (PRD §2.2: Live monitoring auto-reconnect)
router.get('/jobs/latest', async (req, res) => {
    try {
        const job = (await engineFor(req)).getLatestJob();
        if (!job) {
            return res.status(200).json({ success: true, data: null, message: 'No bulk trigger jobs executed yet.' });
        }
        res.status(200).json({ success: true, data: job });
    } catch (err) {
        sendError(res, err, 'Latest job error', 500);
    }
});

// 2.95 Get Recent Jobs List (PRD §2.2)
router.get('/jobs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
        const jobs = (await engineFor(req)).getRecentJobs(limit);
        res.status(200).json({ success: true, data: jobs });
    } catch (err) {
        sendError(res, err, 'Jobs list error', 500);
    }
});

// 3. Get Job Progress & Results (PRD §2.1 & §2.2)
router.get('/jobs/:jobId', async (req, res) => {
    try {
        const engine = await engineFor(req);
        const { jobId } = req.params;
        if (jobId === 'latest') {
            return res.status(200).json({ success: true, data: engine.getLatestJob() });
        }
        const job = engine.getJobStatus(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: `Job '${jobId}' not found.` });
        }
        res.status(200).json({ success: true, data: job });
    } catch (err) {
        sendError(res, err, 'Job status error', 500);
    }
});

// 4. Safe Retry Failed Items (PRD §2.1: Retries should avoid duplicate actions)
router.post('/jobs/:jobId/retry', async (req, res) => {
    try {
        const engine = await engineFor(req);
        const updatedJob = await engine.retryFailedItems(req.params.jobId, actorOf(req), {});
        res.status(200).json({
            success: true,
            firebaseSaved: updatedJob.firebaseSaved !== false,
            data: updatedJob,
            message: `Retry completed for job ${req.params.jobId}. Current status: ${updatedJob.status}.`
        });
    } catch (err) {
        sendError(res, err, 'Retry error', /not found/.test(err.message) ? 404 : 400);
    }
});

// 5. Config: View Engine Controls (PRD §2.2: Batch size configurable by admin)
router.get('/config', async (req, res) => {
    try {
        res.status(200).json({ success: true, data: (await engineFor(req)).getConfig() });
    } catch (err) {
        sendError(res, err, 'Config error', 500);
    }
});

// 6. Config: Administrator Update Batch Size & Limits (PRD §2.2)
router.put('/config', async (req, res) => {
    try {
        const { batchSize, interBatchDelayMs, maxEmailsPerSecond, strictConsentRequired } = req.body || {};
        const engine = await engineFor(req);
        const result = await engine.updateConfigConfirmed({ batchSize, interBatchDelayMs, maxEmailsPerSecond, strictConsentRequired }, actorOf(req));
        res.status(200).json({ success: true, firebaseSaved: true, data: result.config, message: 'Bulk Trigger configuration saved.' });
    } catch (err) {
        sendError(res, err, 'Config update error', /Unauthorized/.test(err.message) ? 403 : 400);
    }
});

// 7. OTP Generation (PRD §2.3: Separate OTP engine, expire, attempt limits)
router.post('/otp/generate', (req, res) => {
    try {
        const { identifier, purpose, ttlSeconds, maxAttempts, metadata } = req.body || {};
        const otpRecord = otpVerificationService.generateOtp({
            identifier,
            purpose: purpose || 'verification',
            ttlSeconds: ttlSeconds ? parseInt(ttlSeconds, 10) : 300,
            maxAttempts: maxAttempts ? parseInt(maxAttempts, 10) : 3,
            metadata: { ...(metadata || {}), orgId: orgOf(req), issuedBy: actorOf(req).id }
        });

        res.status(200).json({
            success: true,
            data: {
                otpId: otpRecord.otpId,
                identifier: otpRecord.identifier,
                purpose: otpRecord.purpose,
                expiresAt: otpRecord.expiresAt,
                maxAttempts: otpRecord.maxAttempts,
                attemptsRemaining: otpRecord.attemptsRemaining,
                // The code is shown only outside production (test page / local development)
                code: (process.env.NODE_ENV !== 'production' && req.query.devMode === 'true') ? otpRecord.code : undefined
            },
            message: `OTP issued successfully. Valid for ${otpRecord.ttlSeconds}s (max ${otpRecord.maxAttempts} attempts).`
        });
    } catch (err) {
        sendError(res, err, 'OTP generation error');
    }
});

// 8. OTP Verification (PRD §2.3: Single-use, attempt counter, expiry check)
router.post('/otp/verify', (req, res) => {
    try {
        const { otpId, identifier, purpose, code } = req.body || {};
        const result = otpVerificationService.verifyOtp({ otpId, identifier, purpose, code, actor: actorOf(req) });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                reason: result.reason,
                message: result.message,
                attemptsRemaining: result.attemptsRemaining
            });
        }
        res.status(200).json({ success: true, data: result, message: result.message });
    } catch (err) {
        sendError(res, err, 'OTP verify error', 500);
    }
});

// 9. OTP Status Lookup
router.get('/otp/status/:otpId', (req, res) => {
    try {
        const status = otpVerificationService.getOtpStatus(req.params.otpId);
        if (!status) {
            return res.status(404).json({ success: false, error: `OTP '${req.params.otpId}' not found.` });
        }
        res.status(200).json({ success: true, data: status });
    } catch (err) {
        sendError(res, err, 'OTP status error', 500);
    }
});

// 10. Audit Trail: Initiator, Time, Count, Outcome (PRD §2.2)
router.get('/audit-logs', async (req, res) => {
    try {
        const { limit, action, status } = req.query;
        const logs = (await engineFor(req)).getAuditLogs({
            limit: limit ? Math.min(parseInt(limit, 10) || 50, 500) : 50,
            action,
            status
        });
        res.status(200).json({ success: true, data: logs, total: logs.length });
    } catch (err) {
        sendError(res, err, 'Audit log error', 500);
    }
});

// 10.5 Firebase Backend Status & Live Connectivity Check
router.get('/firebase-status', async (req, res) => {
    try {
        const { db } = require('../config/firebase');
        res.status(200).json({
            success: true,
            online: true,
            firebaseReady: Boolean(db && typeof db.collection === 'function'),
            localTestDatabase: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
            projectId: process.env.FIREBASE_PROJECT_ID || 'kylrxai',
            collections: {
                jobs: 'bulk_trigger_jobs',
                auditLogs: 'bulk_trigger_audit_logs',
                otps: 'otp_verifications',
                aiConfigs: 'bulk_ai_configs'
            },
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        sendError(res, err, 'Status error', 500);
    }
});

// 10.6 Retrieve this organization's people as recipients
router.get('/recipients/from-firestore', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 500, MAX_RECIPIENTS);
        const result = await (await engineFor(req)).fetchRecipientsFromFirestore(limit);
        res.status(200).json({ success: true, source: result.source, count: result.count, data: result.recipients });
    } catch (err) {
        sendError(res, err, 'Fetch recipients error', 500);
    }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AI ASSIST FOR BULK MESSAGES (compose, audience, pre-send check)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// GET /api/bulk-trigger/ai/status - Whether a language model is configured
router.get('/ai/status', (req, res) => {
    res.status(200).json({ success: true, data: { aiConfigured: bulkMessageAi.aiConfigured() } });
});

// POST /api/bulk-trigger/ai/compose - Subject and body from a short description (not saved)
router.post('/ai/compose', async (req, res) => {
    try {
        const { intent, tone, action } = req.body || {};
        res.status(200).json({ success: true, data: await bulkMessageAi.composeMessage({ intent, tone, action }) });
    } catch (err) {
        sendError(res, err, 'AI compose error');
    }
});

// POST /api/bulk-trigger/ai/audience - This organization's people matching a description
router.post('/ai/audience', async (req, res) => {
    try {
        const { description } = req.body || {};
        const people = (await (await engineFor(req)).fetchOrgRecipients(MAX_RECIPIENTS)).recipients;
        res.status(200).json({ success: true, data: await bulkMessageAi.planAudience({ description, people }) });
    } catch (err) {
        sendError(res, err, 'AI audience error');
    }
});

// POST /api/bulk-trigger/ai/review - Pre-send check of the message and the selected audience
router.post('/ai/review', async (req, res) => {
    try {
        const { subject, body, action, recipients } = req.body || {};
        const list = checkRecipients(recipients);
        let validCount;
        let invalidCount;
        if (list.length) {
            const engine = await engineFor(req);
            await withMembers(engine, req);
            const v = engine.validateSelection({ action: action || 'EMAIL_NOTIFICATION', recipients: list, payload: {}, actor: actorOf(req) });
            validCount = v.validCount;
            invalidCount = v.invalidCount;
        }
        res.status(200).json({ success: true, data: bulkMessageAi.reviewMessage({ subject, body, action: String(action || 'EMAIL_NOTIFICATION').toUpperCase(), recipients: list, validCount, invalidCount }) });
    } catch (err) {
        sendError(res, err, 'AI review error');
    }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SECTION 2.4: AI-ASSISTED BUILDER (PRD §2.4)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// 11. AI Suggestion: User describes alert, AI suggests triggers, conditions, recipients, and message text
// Output strictly remains in draft status
router.post('/ai-builder/suggest', async (req, res) => {
    try {
        const { prompt, context } = req.body || {};
        const draft = await aiStore.change(orgOf(req), engine => engine.generateAlertDraft(prompt, context || {}, actorOf(req)));
        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: draft,
            message: `AI recommendation draft generated and saved. Status: ${draft.status}. User approval required before activation.`
        });
    } catch (err) {
        sendError(res, err, 'AI suggest error');
    }
});

// 12. User Edit Suggestions: Modify fields before activation
router.put('/ai-builder/drafts/:draftId', async (req, res) => {
    try {
        const { edits } = req.body || {};
        const updatedDraft = await aiStore.change(orgOf(req), engine => engine.updateDraft(req.params.draftId, edits || {}, actorOf(req)));
        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: updatedDraft,
            message: `Draft '${req.params.draftId}' saved. Current status: ${updatedDraft.status}. Valid: ${updatedDraft.validationStatus.isValid}.`
        });
    } catch (err) {
        sendError(res, err, 'Draft update error');
    }
});

// 13. User Reject Suggestions
router.post('/ai-builder/drafts/:draftId/reject', async (req, res) => {
    try {
        const { reason } = req.body || {};
        const rejected = await aiStore.change(orgOf(req), engine => engine.rejectDraft(req.params.draftId, reason || 'Rejected by user', actorOf(req)));
        res.status(200).json({ success: true, firebaseSaved: true, data: rejected, message: `Suggestion '${req.params.draftId}' rejected and archived.` });
    } catch (err) {
        sendError(res, err, 'Draft reject error');
    }
});

// 14. System Validation Gate: Validates final setup
router.post('/ai-builder/validate', async (req, res) => {
    try {
        const { configuration } = req.body || {};
        const validation = await aiStore.read(orgOf(req), engine => engine.validateConfiguration(configuration || {}));
        res.status(200).json({
            success: true,
            data: validation,
            message: validation.isValid ? 'Configuration passed system validation gate.' : 'Configuration failed validation.'
        });
    } catch (err) {
        sendError(res, err, 'System validation error');
    }
});

// 15. Authorised Activation: Only authorised users activate the configuration
router.post('/ai-builder/drafts/:draftId/activate', async (req, res) => {
    try {
        const activated = await aiStore.change(orgOf(req), engine => engine.activateConfiguration(req.params.draftId, actorOf(req)));
        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: activated,
            message: `Configuration '${req.params.draftId}' activated by ${activated.activatedBy.name} and saved. Status: active.`
        });
    } catch (err) {
        sendError(res, err, 'Activation error', 403);
    }
});

// 16. Get All Configurations
router.get('/ai-builder/drafts', async (req, res) => {
    try {
        const { status, module, severity } = req.query;
        const configs = await aiStore.read(orgOf(req), engine => engine.getAllConfigurations({ status, module, severity }));
        res.status(200).json({ success: true, data: configs, total: configs.length });
    } catch (err) {
        sendError(res, err, 'Configurations list error', 500);
    }
});

// 17. Get Single Configuration by ID
router.get('/ai-builder/drafts/:draftId', async (req, res) => {
    try {
        const config = await aiStore.read(orgOf(req), engine => engine.getConfigurationById(req.params.draftId));
        if (!config) {
            return res.status(404).json({ success: false, error: `Configuration '${req.params.draftId}' not found.` });
        }
        res.status(200).json({ success: true, data: config });
    } catch (err) {
        sendError(res, err, 'Configuration error', 500);
    }
});

module.exports = router;
