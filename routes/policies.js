const express = require('express');
const router = express.Router();
const { confirmedWrite } = require('../config/firestore-write');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { db, rawCollection } = require('../config/firebase');
const { orgDocs, ownerOrgId, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Enterprise Policy Center Route Handler
 *
 * Every read comes from Firestore and is limited to the caller's organization:
 *   policies            deployed policies
 *   policy_audit        deployment / signature / violation trail
 *   policy_versions     version archive
 *   compliance_plans    custom compliance plans
 *   policy_settings     per-organization auto-assign & selective routing ({orgId} doc)
 * Writes respond only after Firestore confirmed them (503 otherwise).
 */

const OVERDUE_AFTER_MS = 3 * 86400000;

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorOf(req) {
    return (req.user && (req.user.name || req.user.email)) || 'HR Super Admin';
}


const toIso = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString()
    : (t && t._seconds ? new Date(t._seconds * 1000).toISOString() : t);

function timeAgo(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}

async function orgPolicies(orgId) {
    return (await orgDocs(rawCollection, 'policies', orgId))
        .filter(p => p.status !== 'retired')
        .map(p => ({ ...p, createdAt: toIso(p.createdAt), updatedAt: toIso(p.updatedAt) }))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function orgSettings(orgId) {
    const snap = await rawCollection('policy_settings').doc(orgId).get();
    const data = snap.exists ? snap.data() : {};
    return {
        autoAssignEnabled: data.autoAssignEnabled !== false,
        selectiveDepartments: Array.isArray(data.selectiveDepartments) ? data.selectiveDepartments : []
    };
}

// Older entries recorded policy retirements with type 'violation'; they are not compliance violations
function auditType(a) {
    if (a.type === 'violation' && /^Retired/i.test(String(a.action || ''))) return 'retirement';
    return a.type || 'event';
}

function sendError(res, error, context) {
    logger.error(`[POLICY] ${context}:`, error);
    res.status(error.status || 500).json({ success: false, firebaseSaved: false, message: error.message, error: error.message });
}

// GET /api/policies - This organization's active policies
router.get('/', async (req, res) => {
    try {
        const data = await orgPolicies(orgOf(req));
        res.status(200).json({ success: true, count: data.length, data, source: 'firebase-admin', projectId: 'kylrxai' });
    } catch (error) {
        logger.error('[POLICY] Error listing policies:', error);
        res.status(500).json({ success: false, message: 'Could not load policies from Firebase.' });
    }
});

// POST /api/policies - Deploy a new policy (policy + audit entry + version archive in one batch)
router.post('/', async (req, res) => {
    try {
        const { title, category, scope, version, description } = req.body || {};
        if (!title || !String(title).trim()) {
            return res.status(400).json({ success: false, message: 'Policy title is required.' });
        }
        const orgId = orgOf(req);
        const actor = actorOf(req);
        const now = new Date().toISOString();
        const id = `pol-${crypto.randomBytes(4).toString('hex')}`;
        const newPolicy = {
            id,
            orgId,
            title: String(title).trim().slice(0, 200),
            category: category || 'HR Policies',
            scope: scope || 'Global',
            version: version || '1.0',
            description: description || `Mandatory ${category || 'organizational'} governance mandate.`,
            deployedBy: actor,
            signedPercentage: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now
        };
        const auditItem = {
            id: `aud-${crypto.randomBytes(4).toString('hex')}`,
            orgId,
            type: 'deployment',
            employeeName: actor,
            action: `Deployed new organization policy "${newPolicy.title}" (v${newPolicy.version})`,
            policyId: id,
            timestamp: now
        };
        const verItem = {
            id: `ver-${crypto.randomBytes(4).toString('hex')}`,
            orgId,
            policyId: id,
            title: newPolicy.title,
            category: newPolicy.category,
            scope: newPolicy.scope,
            version: newPolicy.version,
            deployedBy: actor,
            timestamp: now
        };

        const batch = db.batch();
        batch.set(rawCollection('policies').doc(id), newPolicy);
        batch.set(rawCollection('policy_audit').doc(auditItem.id), auditItem);
        batch.set(rawCollection('policy_versions').doc(verItem.id), verItem);
        await confirmedWrite(() => batch.commit());

        logger.info(`[POLICY] Deployed policy "${newPolicy.title}" (${id}) for ${orgId}.`);
        res.status(201).json({
            success: true,
            firebaseSaved: true,
            id,
            message: `Policy "${newPolicy.title}" deployed and saved to Firebase.`,
            data: newPolicy
        });
    } catch (error) {
        sendError(res, error, 'Deployment error');
    }
});

// DELETE /api/policies/:id - Retire and delete one of this organization's policies
router.delete('/:id', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const ref = rawCollection('policies').doc(String(req.params.id));
        const snap = await ref.get();
        if (!snap.exists || ownerOrgId(snap.data()) !== orgId) {
            return res.status(404).json({ success: false, message: `Policy '${req.params.id}' not found.` });
        }
        const title = snap.get('title') || req.params.id;
        const auditItem = {
            id: `aud-${crypto.randomBytes(4).toString('hex')}`,
            orgId,
            type: 'retirement',
            employeeName: actorOf(req),
            action: `Retired & deleted policy "${title}"`,
            policyId: req.params.id,
            timestamp: new Date().toISOString()
        };
        const batch = db.batch();
        batch.delete(ref);
        batch.set(rawCollection('policy_audit').doc(auditItem.id), auditItem);
        await confirmedWrite(() => batch.commit());

        logger.info(`[POLICY] Retired policy ${req.params.id} for ${orgId}`);
        res.status(200).json({ success: true, firebaseSaved: true, message: `Policy "${title}" retired and deleted.` });
    } catch (error) {
        sendError(res, error, 'Error deleting policy');
    }
});

// GET /api/policies/audit-logs - Recent audit events for this organization
router.get('/audit-logs', async (req, res) => {
    try {
        const data = (await orgDocs(rawCollection, 'policy_audit', orgOf(req)))
            .map(a => ({ ...a, type: auditType(a), timestamp: toIso(a.timestamp) }))
            .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
            .slice(0, 100)
            .map(a => ({ ...a, timeAgo: timeAgo(a.timestamp) }));
        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        sendError(res, error, 'Error loading audit logs');
    }
});

// GET /api/policies/compliance-pulse - Compliance metrics computed from this organization's data
router.get('/compliance-pulse', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const [policies, users, audits] = await Promise.all([
            orgPolicies(orgId),
            orgDocs(rawCollection, 'users', orgId),
            orgDocs(rawCollection, 'policy_audit', orgId)
        ]);
        const totalEmployees = users.filter(u => !/inactive|relieved|exited/i.test(String(u.status || ''))).length;
        const overallRate = policies.length
            ? Math.round(policies.reduce((sum, p) => sum + (Number(p.signedPercentage) || 0), 0) / policies.length)
            : 0;
        // Unsigned acknowledgements still open 3+ days after the policy was deployed
        const overdueCount = policies.reduce((sum, p) => {
            const age = Date.now() - Date.parse(p.createdAt);
            if (!(age > OVERDUE_AFTER_MS)) return sum;
            const unsigned = Math.round(totalEmployees * (100 - (Number(p.signedPercentage) || 0)) / 100);
            return sum + unsigned;
        }, 0);
        const blockedCount = audits.filter(a => auditType(a) === 'violation').length;
        res.status(200).json({ success: true, data: { overallRate, overdueCount, blockedCount, totalEmployees, totalPolicies: policies.length } });
    } catch (error) {
        sendError(res, error, 'Error computing compliance pulse');
    }
});

// GET /api/policies/auto-assign - This organization's auto-assignment setting
router.get('/auto-assign', async (req, res) => {
    try {
        const settings = await orgSettings(orgOf(req));
        res.status(200).json({ success: true, enabled: settings.autoAssignEnabled, departments: settings.selectiveDepartments });
    } catch (error) {
        sendError(res, error, 'Error loading auto-assign setting');
    }
});

// POST /api/policies/auto-assign - Update the auto-assignment toggle
router.post('/auto-assign', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const enabled = !!(req.body && req.body.enabled);
        await confirmedWrite(() => rawCollection('policy_settings').doc(orgId).set({
            orgId, autoAssignEnabled: enabled, updatedAt: new Date().toISOString(), updatedBy: actorOf(req)
        }, { merge: true }));
        res.status(200).json({ success: true, firebaseSaved: true, enabled });
    } catch (error) {
        sendError(res, error, 'Error saving auto-assign setting');
    }
});

// POST /api/policies/selective-routing - Apply selective departmental routing
router.post('/selective-routing', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const departments = Array.isArray(req.body && req.body.departments) ? req.body.departments.map(String).slice(0, 100) : [];
        await confirmedWrite(() => rawCollection('policy_settings').doc(orgId).set({
            orgId, routingType: 'Selective', selectiveDepartments: departments, updatedAt: new Date().toISOString(), updatedBy: actorOf(req)
        }, { merge: true }));
        res.status(200).json({ success: true, firebaseSaved: true, message: 'Selective routing saved to Firebase.' });
    } catch (error) {
        sendError(res, error, 'Error saving selective routing');
    }
});

// POST /api/policies/custom-plan - Save a custom compliance plan
router.post('/custom-plan', async (req, res) => {
    try {
        const { name, entity, logic } = req.body || {};
        if (!name) return res.status(400).json({ success: false, message: 'Plan name is required.' });
        const orgId = orgOf(req);
        const planId = `plan-${crypto.randomBytes(4).toString('hex')}`;
        await confirmedWrite(() => rawCollection('compliance_plans').doc(planId).set({
            id: planId,
            orgId,
            name: String(name).slice(0, 200),
            entity: entity || '',
            logic: Array.isArray(logic) ? logic : [],
            createdBy: actorOf(req),
            createdAt: new Date().toISOString()
        }));
        res.status(201).json({ success: true, firebaseSaved: true, id: planId, message: 'Compliance plan saved to Firebase.' });
    } catch (error) {
        sendError(res, error, 'Error saving compliance plan');
    }
});

// GET /api/policies/versions - Version archive for this organization
router.get('/versions', async (req, res) => {
    try {
        const data = (await orgDocs(rawCollection, 'policy_versions', orgOf(req)))
            .map(v => ({ ...v, timestamp: toIso(v.timestamp) }))
            .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        sendError(res, error, 'Error loading versions');
    }
});

module.exports = router;
