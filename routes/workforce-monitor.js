/**
 * Workforce Monitor (tvc-dashboard.html): the signed-in user's organization only.
 *
 * The organization comes from the verified token (req.user.orgId), never from the request.
 * A document belongs to the organization when it is tagged with its orgId, or is untagged and
 * belongs to one of its people (legacy data written before documents carried an orgId).
 * Anything else, including documents with no matching person, is never returned.
 */
const express = require('express');
const router = express.Router();
const { rawCollection } = require('../config/firebase');
const { orgDocs } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES, requireOrg } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');

router.use(verifyToken);
router.use(requireOrg);
router.use(authorize(ADMIN_HR_ROLES));

// shortcut: one page of up to MAX documents per collection, no cursor paging; raise or page it when an organization outgrows it
const MAX = 2000;

// The only user fields the page needs; password hashes, MFA and lock fields never leave the server
const USER_FIELDS = [
    'uid', 'name', 'fullName', 'email', 'role', 'status', 'department', 'departmentId', 'departmentName',
    'designation', 'employeeId', 'managerId', 'managerUid', 'onboardingStatus', 'salary', 'createdAt'
];

const orgOf = (req) => req.user && req.user.orgId;

// Firestore timestamps and dates become ISO strings so the browser can build Dates from the JSON
function plain(v) {
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v && typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
    return v;
}

const pick = (data, fields) => Object.fromEntries(fields.filter(f => data[f] !== undefined).map(f => [f, plain(data[f])]));

// ids that identify one of the organization's people in other collections
function ownerIdsOf(users) {
    const ids = new Set();
    users.forEach(u => [u.id, u.uid, u.employeeId].filter(Boolean).forEach(x => ids.add(String(x))));
    return ids;
}

/**
 * Documents of `name` tagged with orgId, plus untagged ones whose owner (ownerKey) is one of the
 * organization's people. `dateFilter` narrows a day-keyed collection to one date.
 */
async function orgOwnedDocs(name, orgId, ownerIds, ownerKey, dateFilter) {
    const narrow = (q) => (dateFilter ? q.where('date', '==', dateFilter) : q);
    const [tagged, everything] = await Promise.all([
        narrow(rawCollection(name).where('orgId', '==', orgId)).limit(MAX).get(),
        narrow(rawCollection(name)).limit(MAX).get()
    ]);
    const byId = new Map(tagged.docs.map(d => [d.id, d]));
    everything.docs.forEach(d => {
        const data = d.data();
        if (data.orgId) return; // tagged for some organization: already included if it is ours
        if (ownerIds.has(String(ownerKey(d.id, data)))) byId.set(d.id, d);
    });
    return [...byId.values()].map(d => ({ id: d.id, ...plain(d.data()) }));
}

const today = () => new Date().toISOString().split('T')[0];

// GET /api/workforce-monitor - everything the monitor shows, for the caller's organization
router.get('/', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const date = today();

        const allUsers = await orgDocs(rawCollection, 'users', orgId, MAX);
        const ownerIds = ownerIdsOf(allUsers);

        const [activity, attendance, sessions] = await Promise.all([
            orgOwnedDocs('activityStatus', orgId, ownerIds, (id, d) => d.userId || id),
            orgOwnedDocs('attendance', orgId, ownerIds, (id, d) => d.userId || d.employeeId || id.split('_')[0], date),
            orgOwnedDocs('admin_sessions', orgId, ownerIds, (id, d) => d.userId || id.split('_')[0])
        ]);

        res.json({
            success: true,
            date,
            // the page lists employees and managers; admins appear through their own sessions
            users: allUsers
                .filter(u => String(u.role || '').toLowerCase() !== 'admin')
                .map(u => ({ id: u.id, ...pick(u, USER_FIELDS) })),
            activity,
            attendance,
            adminSessions: sessions.filter(s => String(s.id).includes(date))
        });
    } catch (error) {
        logger.error(`[WorkforceMonitor] ${error.message}`);
        res.status(500).json({ success: false, error: 'Could not load the workforce monitor.' });
    }
});

// GET /api/workforce-monitor/attendance/:userId - one person's attendance logs (productivity view)
router.get('/attendance/:userId', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const userId = String(req.params.userId);

        const allUsers = await orgDocs(rawCollection, 'users', orgId, MAX);
        if (!ownerIdsOf(allUsers).has(userId)) {
            return res.status(404).json({ success: false, error: 'Employee not found in your organization.' });
        }

        const [byUser, byEmployee] = await Promise.all([
            rawCollection('attendance').where('userId', '==', userId).limit(400).get(),
            rawCollection('attendance').where('employeeId', '==', userId).limit(400).get()
        ]);
        const logs = new Map();
        [...byUser.docs, ...byEmployee.docs].forEach(d => {
            const data = d.data();
            if (data.orgId && data.orgId !== orgId) return;
            logs.set(d.id, { id: d.id, ...plain(data) });
        });

        res.json({ success: true, logs: [...logs.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) });
    } catch (error) {
        logger.error(`[WorkforceMonitor] attendance: ${error.message}`);
        res.status(500).json({ success: false, error: 'Could not load attendance.' });
    }
});

module.exports = router;
