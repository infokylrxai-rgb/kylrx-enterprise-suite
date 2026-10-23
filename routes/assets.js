const express = require('express');
const router = express.Router();
const { confirmedWrite } = require('../config/firestore-write');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { db, rawCollection } = require('../config/firebase');
const { orgDocs, ownerOrgId, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);

/**
 * Enterprise Asset Management Hub
 *
 * Firestore collections, every document tagged with the owning organization (orgId):
 *   assets               hardware inventory
 *   asset_audit_logs     provisioning / allocation / declaration / issue / return trail
 *   asset_declarations   employee condition declarations ({employeeId}_{assetId})
 *   asset_issue_reports  issues reported by employees
 * Reads are limited to the caller's organization; writes respond only after Firestore
 * confirmed them (503 otherwise), so the page never shows a change that was not saved.
 */

const ADMIN_ONLY = authorize(ADMIN_HR_ROLES);
const STATUSES = ['In Stock', 'Allocated', 'Repair', 'Missing', 'Return Initiated', 'Retired'];

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorOf(req) {
    return (req.user && (req.user.email || req.user.id)) || 'admin';
}

const toIso = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString()
    : (t && t._seconds ? new Date(t._seconds * 1000).toISOString() : t);

function normalizeAsset(a) {
    return {
        ...a,
        status: a.status || 'In Stock',
        declarationStatus: a.declarationStatus || (a.assignedTo ? 'Pending' : 'Unassigned'),
        assignedAt: toIso(a.assignedAt) || null,
        createdAt: toIso(a.createdAt),
        updatedAt: toIso(a.updatedAt)
    };
}

async function orgAssets(orgId) {
    return (await orgDocs(rawCollection, 'assets', orgId))
        .map(normalizeAsset)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

// The asset document, only if it belongs to the caller's organization
async function loadOwnedAsset(req, assetId) {
    const ref = rawCollection('assets').doc(String(assetId));
    const snap = await ref.get();
    if (!snap.exists || ownerOrgId(snap.data()) !== orgOf(req)) return null;
    return { ref, asset: normalizeAsset({ id: snap.id, ...snap.data() }) };
}

function auditEntry(orgId, assetId, employeeId, action, actorId) {
    return {
        id: `log-ast-${crypto.randomBytes(4).toString('hex')}`,
        orgId,
        assetId,
        employeeId: employeeId || 'system',
        action,
        actorId,
        timestamp: new Date().toISOString()
    };
}

function sendError(res, error, context) {
    logger.error(`[ASSET] ${context}:`, error);
    res.status(error.status || 500).json({ success: false, firebaseSaved: false, message: error.message, error: error.message });
}

// GET /api/assets - This organization's inventory
router.get('/', async (req, res) => {
    try {
        const data = await orgAssets(orgOf(req));
        res.status(200).json({ success: true, count: data.length, data, source: 'firebase-admin', projectId: 'kylrxai' });
    } catch (error) {
        logger.error('[ASSET] Error listing assets:', error);
        res.status(500).json({ success: false, message: 'Could not load assets from Firebase.' });
    }
});

// GET /api/assets/stats - Counts for this organization
router.get('/stats', async (req, res) => {
    try {
        const assets = await orgAssets(orgOf(req));
        res.status(200).json({
            success: true,
            total: assets.length,
            allocated: assets.filter(a => a.status === 'Allocated').length,
            inStock: assets.filter(a => a.status === 'In Stock').length,
            repair: assets.filter(a => a.status === 'Repair').length,
            missing: assets.filter(a => a.status === 'Missing').length,
            pendingDeclarations: assets.filter(a => a.status === 'Allocated' && a.declarationStatus !== 'Verified').length
        });
    } catch (error) {
        sendError(res, error, 'Error computing stats');
    }
});

// GET /api/assets/employees - Active people of this organization who can receive assets
router.get('/employees', ADMIN_ONLY, async (req, res) => {
    try {
        const orgId = orgOf(req);
        const [users, employees] = await Promise.all([
            orgDocs(rawCollection, 'users', orgId),
            orgDocs(rawCollection, 'employees', orgId)
        ]);
        const byId = new Map();
        [...employees, ...users].forEach(p => {
            if (/inactive|relieved|exited|resigned|terminated/i.test(String(p.status || p.employmentStatus || ''))) return;
            const name = p.name || p.displayName || p.fullName || p.email;
            if (!name) return;
            byId.set(p.id, { id: p.id, name, department: p.departmentName || p.department || 'Staff' });
        });
        const data = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        sendError(res, error, 'Error loading employees');
    }
});

// GET /api/assets/logs - Latest audit entries for this organization
router.get('/logs', async (req, res) => {
    try {
        const data = (await orgDocs(rawCollection, 'asset_audit_logs', orgOf(req)))
            .map(l => ({ ...l, timestamp: toIso(l.timestamp) }))
            .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
            .slice(0, 15);
        res.status(200).json({ success: true, data });
    } catch (error) {
        sendError(res, error, 'Error loading logs');
    }
});

// POST /api/assets - Provision a new asset (asset tag must be unique within the organization)
router.post('/', ADMIN_ONLY, async (req, res) => {
    try {
        const { name, type, tag } = req.body || {};
        if (!name || !String(name).trim() || !tag || !String(tag).trim()) {
            return res.status(400).json({ success: false, message: 'Name and Tag are required.' });
        }
        const orgId = orgOf(req);
        const cleanTag = String(tag).trim().slice(0, 60);
        const existing = await orgAssets(orgId);
        if (existing.some(a => String(a.tag || '').toLowerCase() === cleanTag.toLowerCase())) {
            return res.status(409).json({ success: false, message: `Asset tag "${cleanTag}" is already in use.` });
        }
        const now = new Date().toISOString();
        const id = `ast-${crypto.randomBytes(4).toString('hex')}`;
        const newAsset = {
            id,
            orgId,
            name: String(name).trim().slice(0, 120),
            type: type || 'Laptop',
            tag: cleanTag,
            status: 'In Stock',
            assignedTo: null,
            assignedToName: null,
            assignedAt: null,
            lastAllocatedBy: null,
            declarationStatus: 'Unassigned',
            createdAt: now,
            updatedAt: now
        };
        const log = auditEntry(orgId, id, null, `Provisioned (${cleanTag})`, actorOf(req));
        const batch = db.batch();
        batch.set(rawCollection('assets').doc(id), newAsset);
        batch.set(rawCollection('asset_audit_logs').doc(log.id), log);
        await confirmedWrite(() => batch.commit());

        logger.info(`[ASSET] Provisioned "${newAsset.name}" (${cleanTag}) for ${orgId}`);
        res.status(201).json({ success: true, firebaseSaved: true, id, message: `Asset "${newAsset.name}" saved to Firebase.`, data: newAsset });
    } catch (error) {
        sendError(res, error, 'Provisioning error');
    }
});

// POST /api/assets/:id/allocate - Assign an asset to an employee of the same organization
router.post('/:id/allocate', ADMIN_ONLY, async (req, res) => {
    try {
        const { employeeId, employeeName } = req.body || {};
        if (!employeeId) return res.status(400).json({ success: false, message: 'Select an employee.' });
        const owned = await loadOwnedAsset(req, req.params.id);
        if (!owned) return res.status(404).json({ success: false, message: 'Asset not found.' });
        if (['Repair', 'Missing', 'Retired'].includes(owned.asset.status)) {
            return res.status(409).json({ success: false, message: `Asset is "${owned.asset.status}" and cannot be allocated.` });
        }

        const orgId = orgOf(req);
        const userSnap = await rawCollection('users').doc(String(employeeId)).get();
        const empSnap = userSnap.exists ? null : await rawCollection('employees').doc(String(employeeId)).get();
        const person = userSnap.exists ? userSnap.data() : (empSnap && empSnap.exists ? empSnap.data() : null);
        if (!person || ownerOrgId(person) !== orgId) {
            return res.status(404).json({ success: false, message: 'Employee not found in your organization.' });
        }

        const now = new Date().toISOString();
        const assignedToName = person.name || person.displayName || employeeName || person.email || employeeId;
        const update = {
            status: 'Allocated',
            assignedTo: String(employeeId),
            assignedToName,
            assignedAt: now,
            lastAllocatedBy: actorOf(req),
            declarationStatus: 'Pending',
            updatedAt: now
        };
        const log = auditEntry(orgId, owned.asset.id, employeeId, `Allocated to ${assignedToName}`, actorOf(req));
        const batch = db.batch();
        batch.update(owned.ref, update);
        batch.set(rawCollection('asset_audit_logs').doc(log.id), log);
        batch.set(rawCollection('notifications').doc(), {
            orgId, target: String(employeeId), targetUid: String(employeeId), title: 'Asset Assigned',
            message: `${owned.asset.name} (${owned.asset.tag}) has been assigned to you. Please confirm its condition.`,
            priority: 'normal', read: false, timestamp: now
        });
        await confirmedWrite(() => batch.commit());

        res.status(200).json({ success: true, firebaseSaved: true, message: `Asset allocated to ${assignedToName}.`, data: { ...owned.asset, ...update } });
    } catch (error) {
        sendError(res, error, 'Allocation error');
    }
});

// DELETE /api/assets/:id - Remove an asset from this organization's inventory
router.delete('/:id', ADMIN_ONLY, async (req, res) => {
    try {
        const owned = await loadOwnedAsset(req, req.params.id);
        if (!owned) return res.status(404).json({ success: false, message: 'Asset not found.' });
        const log = auditEntry(orgOf(req), owned.asset.id, owned.asset.assignedTo, 'Deprovisioned / Retired', actorOf(req));
        const batch = db.batch();
        batch.delete(owned.ref);
        batch.set(rawCollection('asset_audit_logs').doc(log.id), log);
        await confirmedWrite(() => batch.commit());
        res.status(200).json({ success: true, firebaseSaved: true, message: `Asset "${owned.asset.name}" removed from inventory.` });
    } catch (error) {
        sendError(res, error, 'Deletion error');
    }
});

/* ── Employee actions: only the employee the asset is assigned to ───────────── */

function isAssignee(req, asset) {
    const me = req.user && (req.user.id || req.user.uid);
    return !!me && String(asset.assignedTo) === String(me);
}

// POST /api/assets/:id/declaration - Employee confirms the condition of an assigned asset
router.post('/:id/declaration', async (req, res) => {
    try {
        const owned = await loadOwnedAsset(req, req.params.id);
        if (!owned || !isAssignee(req, owned.asset)) return res.status(404).json({ success: false, message: 'Asset not found.' });
        const { condition, signature } = req.body || {};
        const orgId = orgOf(req);
        const employeeId = String(owned.asset.assignedTo);
        const now = new Date().toISOString();
        const batch = db.batch();
        batch.set(rawCollection('asset_declarations').doc(`${employeeId}_${owned.asset.id}`), {
            orgId, employeeId, assetId: owned.asset.id, condition: String(condition || '').slice(0, 200),
            signature: String(signature || '').slice(0, 200), status: 'Verified', timestamp: now
        });
        batch.update(owned.ref, { declarationStatus: 'Verified', lastVerifiedAt: now, updatedAt: now });
        const log = auditEntry(orgId, owned.asset.id, employeeId, 'Declaration Signed', employeeId);
        batch.set(rawCollection('asset_audit_logs').doc(log.id), log);
        await confirmedWrite(() => batch.commit());
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Declaration error');
    }
});

// POST /api/assets/:id/issues - Employee reports damage or another issue
router.post('/:id/issues', async (req, res) => {
    try {
        const owned = await loadOwnedAsset(req, req.params.id);
        if (!owned || !isAssignee(req, owned.asset)) return res.status(404).json({ success: false, message: 'Asset not found.' });
        const { issueType, description } = req.body || {};
        const orgId = orgOf(req);
        const employeeId = String(owned.asset.assignedTo);
        const now = new Date().toISOString();
        const batch = db.batch();
        if (issueType === 'Damage') batch.update(owned.ref, { status: 'Repair', updatedAt: now });
        batch.set(rawCollection('asset_issue_reports').doc(), {
            orgId, assetId: owned.asset.id, employeeId, issueType: issueType || 'Other',
            description: String(description || '').slice(0, 1000), status: 'Open', timestamp: now
        });
        const log = auditEntry(orgId, owned.asset.id, employeeId, `Issue Reported: ${issueType || 'Other'}`, employeeId);
        batch.set(rawCollection('asset_audit_logs').doc(log.id), log);
        await confirmedWrite(() => batch.commit());
        res.status(201).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Issue report error');
    }
});

// POST /api/assets/:id/return - Employee starts returning an asset
router.post('/:id/return', async (req, res) => {
    try {
        const owned = await loadOwnedAsset(req, req.params.id);
        if (!owned || !isAssignee(req, owned.asset)) return res.status(404).json({ success: false, message: 'Asset not found.' });
        const orgId = orgOf(req);
        const employeeId = String(owned.asset.assignedTo);
        const now = new Date().toISOString();
        const batch = db.batch();
        batch.update(owned.ref, { status: 'Return Initiated', updatedAt: now });
        const log = auditEntry(orgId, owned.asset.id, employeeId, 'Return Initiated', employeeId);
        batch.set(rawCollection('asset_audit_logs').doc(log.id), log);
        await confirmedWrite(() => batch.commit());
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Return error');
    }
});

module.exports = router;
module.exports.STATUSES = STATUSES;
