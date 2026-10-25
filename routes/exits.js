const express = require('express');
const router = express.Router();
const { confirmedWrite } = require('../config/firestore-write');
const logger = require('../utils/logger');
const { admin, db, rawCollection } = require('../config/firebase');
const { orgDocs, ownerOrgId, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Exit & Offboarding Management
 *
 * employee_exits/{exitId}: one offboarding case per employee, tagged with orgId.
 * Pipeline: Exit Initiated -> Notice Period -> Clearance Pending -> F&F Pending -> Closed.
 * Reads are limited to the caller's organization; writes respond only after Firestore
 * confirmed them (503 otherwise).
 */

const STAGES = ['Exit Initiated', 'Notice Period', 'Clearance Pending', 'F&F Pending'];
const CHECKLIST_FIELDS = ['exitInterview', 'assetReturn', 'ndaSigned', 'accessRevoked', 'noDuesFinance', 'noDuesIT'];
const INACTIVE = /inactive|relieved|exited|resigned|terminated/i;

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorOf(req) {
    return (req.user && (req.user.name || req.user.email || req.user.id)) || 'HR Admin';
}

const toIso = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString()
    : (t && t._seconds ? new Date(t._seconds * 1000).toISOString() : t);

const selfId = (req) => req.user && (req.user.uid || req.user.id);

// "SUPER_ADMIN", "super_admin", "manager Lead", "hrms" -> "Super Admin", "Manager Lead", "HR"
const ROLE_LABELS = { hrms: 'HR', hr: 'HR', hr_admin: 'HR Admin', ceo: 'CEO', cto: 'CTO', cfo: 'CFO' };
function roleLabel(role) {
    const key = String(role || 'employee').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ROLE_LABELS[key] || key.split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Only staff with the Employee role are offboarded here (not admins, HR or managers)
const isEmployeeRole = (p) => String(p.role || 'employee').trim().toLowerCase() === 'employee';

/**
 * Role from each account's Firebase Auth claims, keyed by uid. The sign-in role wins over the
 * users/{uid}.role field, which can be out of date (e.g. a super admin still stored as "Employee").
 * People without a login account are simply absent.
 */
async function loginRoles(ids) {
    const roles = new Map();
    for (let i = 0; i < ids.length; i += 100) {
        try {
            const { users } = await admin.auth().getUsers(ids.slice(i, i + 100).map(uid => ({ uid })));
            users.forEach(u => {
                const c = u.customClaims || {};
                const role = c.role || ((c.super_admin || c.superadmin) && 'super_admin') || (c.admin && 'admin');
                if (role) roles.set(u.uid, role);
            });
        } catch (err) {
            logger.warn(`[EXIT] Could not read login roles: ${err.message}`);
        }
    }
    return roles;
}

const withLoginRole = (user, roles) => (roles.has(user.id) ? { ...user, role: roles.get(user.id) } : user);

const isDepartedPerson = (p) => p.onboardingStatus === 'Exited' || p.isActive === false || INACTIVE.test(String(p.employmentStatus || p.status || ''));

async function orgExits(orgId) {
    return (await orgDocs(rawCollection, 'employee_exits', orgId))
        .map(e => ({ ...e, createdAt: toIso(e.createdAt), updatedAt: toIso(e.updatedAt) }))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

async function loadOwnedExit(req, exitId) {
    const ref = rawCollection('employee_exits').doc(String(exitId));
    const snap = await ref.get();
    if (!snap.exists || ownerOrgId(snap.data()) !== orgOf(req)) return null;
    return { ref, exit: { id: snap.id, ...snap.data() } };
}

function historyEntry(event, by, extra = {}) {
    return { event, by, timestamp: new Date().toISOString(), ...extra };
}

function sendError(res, error, context) {
    logger.error(`[EXIT] ${context}:`, error);
    res.status(error.status || 500).json({ success: false, firebaseSaved: false, message: error.message, error: error.message });
}

// GET /api/exits - This organization's offboarding cases
router.get('/', async (req, res) => {
    try {
        const data = await orgExits(orgOf(req));
        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        sendError(res, error, 'Error listing exits');
    }
});

// GET /api/exits/employees - Active employees who can be offboarded
router.get('/employees', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const [users, exits] = await Promise.all([orgDocs(rawCollection, 'users', orgId), orgExits(orgId)]);
        const inProgress = new Set(exits.filter(e => e.status !== 'Closed' && e.status !== 'Rejected').map(e => e.employeeId));
        const roles = await loginRoles(users.map(u => u.id));
        const data = users.map(u => withLoginRole(u, roles))
            // The signed-in admin cannot offboard themselves
            .filter(u => u.id !== selfId(req) && isEmployeeRole(u) && !isDepartedPerson(u) && (u.name || u.displayName || u.email))
            .map(u => ({
                id: u.id,
                name: u.name || u.displayName || u.email,
                role: u.role || 'employee',
                roleLabel: roleLabel(u.role),
                email: String(u.email || '').toLowerCase(),
                employeeCode: u.employeeId || u.employeeCode || '',
                department: u.departmentName || u.department || '',
                exitInProgress: inProgress.has(u.id)
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        sendError(res, error, 'Error loading employees');
    }
});

// GET /api/exits/analytics - Figures computed from this organization's exits
router.get('/analytics', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const [exits, users] = await Promise.all([orgExits(orgId), orgDocs(rawCollection, 'users', orgId)]);
        const userById = new Map(users.map(u => [u.id, u]));

        const reasons = {};
        exits.forEach(e => { const r = e.reason || 'Not Specified'; reasons[r] = (reasons[r] || 0) + 1; });
        const sorted = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
        const pct = (n) => (exits.length ? Math.round((n / exits.length) * 100) : 0);

        // Retention: joining date (or account creation) until the last working day
        const tenures = exits.map(e => {
            const u = userById.get(e.employeeId) || {};
            const joined = Date.parse(u.joiningDate || toIso(u.createdAt));
            const left = Date.parse(e.lwd);
            return Number.isFinite(joined) && Number.isFinite(left) && left > joined ? (left - joined) / (365.25 * 86400000) : null;
        }).filter(v => v !== null);

        // Sentiment only from recorded exit-interview ratings (1-5); no rating means no figure
        const ratings = exits.map(e => Number(e.interviewRating)).filter(r => r >= 1 && r <= 5);
        const positive = ratings.filter(r => r >= 4).length;

        res.status(200).json({
            success: true,
            data: {
                totalExits: exits.length,
                totalUnderReview: exits.filter(e => e.status === 'Exit Initiated').length,
                totalNoticePeriod: exits.filter(e => e.status === 'Notice Period').length,
                totalClearance: exits.filter(e => e.status === 'Clearance Pending').length,
                totalSettlement: exits.filter(e => e.status === 'F&F Pending').length,
                totalClosed: exits.filter(e => e.status === 'Closed').length,
                primaryReason: sorted.length ? `${sorted[0][0]} (${pct(sorted[0][1])}%)` : 'No exits yet',
                avgRetention: tenures.length ? `${(tenures.reduce((a, b) => a + b, 0) / tenures.length).toFixed(1)} Years` : 'Not enough data',
                sentiment: ratings.length ? `${Math.round((positive / ratings.length) * 100)}% positive (${ratings.length} interview${ratings.length === 1 ? '' : 's'})` : 'No interviews recorded',
                distribution: sorted.slice(0, 3).map(([label, n]) => ({ label, percent: pct(n) }))
            }
        });
    } catch (error) {
        sendError(res, error, 'Error computing exit analytics');
    }
});

// POST /api/exits - Start an exit for an employee of this organization
router.post('/', async (req, res) => {
    try {
        const { employeeId, lwd, type, reason } = req.body || {};
        if (!employeeId) return res.status(400).json({ success: false, message: 'Select an employee.' });
        if (!lwd || !Number.isFinite(Date.parse(lwd))) return res.status(400).json({ success: false, message: 'Enter a valid last working day.' });

        if (String(employeeId) === selfId(req)) return res.status(400).json({ success: false, message: 'You cannot start an exit for your own account.' });
        const orgId = orgOf(req);
        const userSnap = await rawCollection('users').doc(String(employeeId)).get();
        if (!userSnap.exists || ownerOrgId(userSnap.data()) !== orgId) {
            return res.status(404).json({ success: false, message: 'Employee not found in your organization.' });
        }
        const user = withLoginRole({ id: userSnap.id, ...userSnap.data() }, await loginRoles([userSnap.id]));
        if (!isEmployeeRole(user)) return res.status(400).json({ success: false, message: 'Exits can only be started for employees.' });
        if (isDepartedPerson(user)) return res.status(409).json({ success: false, message: 'This employee has already exited.' });
        const open = (await orgExits(orgId)).find(e => e.employeeId === String(employeeId) && e.status !== 'Closed' && e.status !== 'Rejected');
        if (open) return res.status(409).json({ success: false, message: `An exit is already in progress for ${open.employeeName || 'this employee'} (${open.status}).` });

        const now = new Date().toISOString();
        const exitId = `EXIT-${Date.now()}`;
        const actor = actorOf(req);
        const employeeName = user.name || user.displayName || user.email || String(employeeId);
        const record = {
            orgId,
            employeeId: String(employeeId),
            employeeName,
            department: user.departmentName || user.department || '',
            lwd: new Date(lwd).toISOString().slice(0, 10),
            type: type || 'Resignation',
            reason: reason || 'Not Specified',
            status: STAGES[0],
            checklist: Object.fromEntries(CHECKLIST_FIELDS.map(f => [f, false])),
            history: [historyEntry('Exit Initiated', actor, { reason: reason || 'Not Specified' })],
            initiatedBy: actor,
            createdAt: now,
            updatedAt: now
        };
        const batch = db.batch();
        batch.set(rawCollection('employee_exits').doc(exitId), record);
        batch.set(rawCollection('notifications').doc(), {
            orgId, target: String(employeeId), targetUid: String(employeeId), title: 'Offboarding Started',
            message: `Your offboarding has started. Last working day: ${record.lwd}.`, priority: 'high', read: false, timestamp: now
        });
        await confirmedWrite(() => batch.commit());
        res.status(201).json({ success: true, firebaseSaved: true, exitId, data: { id: exitId, ...record } });
    } catch (error) {
        sendError(res, error, 'Error initiating exit');
    }
});

// POST /api/exits/:id/advance - Move to the next pipeline stage
router.post('/:id/advance', async (req, res) => {
    try {
        const owned = await loadOwnedExit(req, req.params.id);
        if (!owned) return res.status(404).json({ success: false, message: 'Exit not found.' });
        const idx = STAGES.indexOf(owned.exit.status);
        if (idx === -1 || idx === STAGES.length - 1) {
            return res.status(409).json({ success: false, message: `Exit is "${owned.exit.status}" and cannot be advanced. Use Finalize for F&F Pending.` });
        }
        const next = STAGES[idx + 1];
        const history = [...(owned.exit.history || []), historyEntry(`Moved to ${next}`, actorOf(req))];
        await confirmedWrite(() => owned.ref.update({ status: next, history, updatedAt: new Date().toISOString() }));
        res.status(200).json({ success: true, firebaseSaved: true, status: next });
    } catch (error) {
        sendError(res, error, 'Error advancing exit');
    }
});

// PATCH /api/exits/:id/checklist - Tick or untick one clearance item
router.patch('/:id/checklist', async (req, res) => {
    try {
        const { field, checked } = req.body || {};
        if (!CHECKLIST_FIELDS.includes(field)) return res.status(400).json({ success: false, message: 'Unknown checklist item.' });
        const owned = await loadOwnedExit(req, req.params.id);
        if (!owned) return res.status(404).json({ success: false, message: 'Exit not found.' });
        await confirmedWrite(() => owned.ref.update({ [`checklist.${field}`]: !!checked, updatedAt: new Date().toISOString() }));
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error updating checklist');
    }
});

// POST /api/exits/:id/finalize - Close the case and mark the employee as exited
router.post('/:id/finalize', async (req, res) => {
    try {
        const owned = await loadOwnedExit(req, req.params.id);
        if (!owned) return res.status(404).json({ success: false, message: 'Exit not found.' });
        if (owned.exit.status !== 'F&F Pending') {
            return res.status(409).json({ success: false, message: 'Only exits at "F&F Pending" can be finalized.' });
        }
        const now = new Date().toISOString();
        const batch = db.batch();
        batch.update(owned.ref, {
            status: 'Closed',
            closedAt: now,
            history: [...(owned.exit.history || []), historyEntry('Exit Finalized', actorOf(req))],
            updatedAt: now
        });
        // Same fields the analytics and exit loaders look for
        batch.set(rawCollection('users').doc(owned.exit.employeeId), {
            onboardingStatus: 'Exited',
            employmentStatus: 'Exited',
            isActive: false,
            status: 'inactive',
            relievedAt: owned.exit.lwd || now,
            exitReason: owned.exit.reason || null,
            exitDate: now
        }, { merge: true });
        await confirmedWrite(() => batch.commit());
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error finalizing exit');
    }
});

module.exports = router;
