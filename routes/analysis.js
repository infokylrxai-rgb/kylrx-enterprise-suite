const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { db, rawCollection } = require('../config/firebase');
const { confirmedWrite } = require('../config/firestore-write');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');
const intel = require('../services/analytics-intel-service');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Enterprise Analytics (admin-analysis.html): workforce, productivity, payroll, retention,
 * department and trend figures, the forecast and the manager-change audit trail, all from the
 * caller's organization. The broadcast sends an in-app notification to each chosen member of
 * the organization and responds only after Firestore confirmed it.
 */

const BATCH_SIZE = 450;
const MAX_TEXT = 1000;
const AUDIENCES = {
    all: () => true,
    manager: (u) => /manager|lead/i.test(String(u.role || '')),
    hrms: (u) => /hr/i.test(String(u.role || ''))
};

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorOf(req) {
    const u = req.user || {};
    return { id: u.uid || u.id || 'admin', name: u.name || u.displayName || u.email || 'Administrator' };
}

function sendError(res, err, context) {
    logger.error(`[AnalysisAPI] ${context}:`, err.message);
    res.status(err.status || 500).json({ success: false, firebaseSaved: false, error: err.message, message: err.message });
}

const toIso = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v._seconds !== undefined) return new Date(v._seconds * 1000).toISOString();
    return v;
};

// GET /api/analysis/overview
router.get('/overview', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const [users, exits, metrics, snapshots, eods, profiles, runs, changes] = await Promise.all([
            orgDocs(rawCollection, 'users', orgId, 2000),
            orgDocs(rawCollection, 'employee_exits', orgId, 2000),
            orgDocs(rawCollection, 'performance_metrics', orgId, 2000),
            orgDocs(rawCollection, 'performance_snapshots', orgId, 3000),
            orgDocs(rawCollection, 'employee_eods', orgId, 3000),
            orgDocs(rawCollection, 'payroll_profiles', orgId, 2000),
            orgDocs(rawCollection, 'payroll_runs', orgId, 200),
            orgDocs(rawCollection, 'manager_change_requests', orgId, 500)
        ]);
        const members = users.filter(intel.activeMember);
        const memberIds = new Set(members.flatMap(u => [u.id, u.uid].filter(Boolean)));
        const reviewed = eods.filter(e => /^reviewed$/i.test(String(e.status || '')));

        const prod = intel.productivity(users, metrics);
        const trend = intel.trends({ snapshots, eods: reviewed, memberIds });
        const audit = changes
            .map(c => ({
                id: c.id,
                employeeName: c.employeeName || 'Unknown',
                currentDepartment: c.currentDepartment || 'General',
                newDepartment: c.newDepartment || 'General',
                currentManagerName: c.currentManagerName || 'Unassigned',
                newManagerName: c.newManagerName || 'Unassigned',
                status: c.status || 'Pending',
                createdAt: toIso(c.createdAt),
                completedAt: toIso(c.completedAt)
            }))
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, 15);

        res.json({
            success: true,
            data: {
                workforce: intel.workforce({ users, exits }),
                productivity: { average: prod.average, scored: prod.scored, accuracy: prod.accuracy, accuracyScored: prod.accuracyScored },
                departments: intel.departments(users, prod.scores),
                trend,
                forecast: intel.forecast(trend),
                payroll: intel.payroll({ runs, profiles, users }),
                audit,
                audiences: Object.fromEntries(Object.entries(AUDIENCES).map(([k, fn]) => [k, members.filter(u => u.id !== actorOf(req).id && fn(u)).length])),
                generatedAt: new Date().toISOString()
            }
        });
    } catch (err) {
        sendError(res, err, 'Overview error');
    }
});

// POST /api/analysis/broadcast { text, target: all | manager | hrms }
router.post('/broadcast', async (req, res) => {
    try {
        const text = String(req.body.text || '').trim();
        const target = AUDIENCES[req.body.target] ? req.body.target : null;
        if (!text) return res.status(400).json({ success: false, message: 'Enter the message text.' });
        if (text.length > MAX_TEXT) return res.status(400).json({ success: false, message: `Keep the message under ${MAX_TEXT} characters.` });
        if (!target) return res.status(400).json({ success: false, message: 'Choose who receives the message.' });

        const orgId = orgOf(req);
        const by = actorOf(req);
        const users = await orgDocs(rawCollection, 'users', orgId, 2000);
        const recipients = users.filter(u => intel.activeMember(u) && u.id !== by.id && AUDIENCES[target](u));
        if (!recipients.length) return res.status(409).json({ success: false, message: 'Nobody in your organization matches that audience.' });

        const now = new Date();
        const broadcastRef = rawCollection('broadcasts').doc();
        const title = `Announcement from ${by.name}`;
        const writes = recipients.map(u => [rawCollection('notifications').doc(), {
            orgId, userId: u.id, targetUid: u.id, target: u.id, recipient_id: u.id, recipient_role: String(u.role || 'employee').toLowerCase(),
            title, message: text, text, type: 'broadcast', broadcastId: broadcastRef.id, senderId: by.id,
            read: false, timestamp: now, createdAt: now.toISOString(), source: 'analytics_broadcast'
        }]);
        writes.unshift([broadcastRef, {
            orgId, senderId: by.id, senderName: by.name, text, targetRole: target,
            recipientCount: recipients.length, timestamp: now, createdAt: now.toISOString(), readBy: [by.id]
        }]);
        for (let i = 0; i < writes.length; i += BATCH_SIZE) {
            const batch = db.batch();
            writes.slice(i, i + BATCH_SIZE).forEach(([ref, data]) => batch.set(ref, data));
            await confirmedWrite(() => batch.commit());
        }
        res.json({ success: true, firebaseSaved: true, data: { broadcastId: broadcastRef.id, recipients: recipients.length } });
    } catch (err) {
        sendError(res, err, 'Broadcast error');
    }
});

module.exports = router;
