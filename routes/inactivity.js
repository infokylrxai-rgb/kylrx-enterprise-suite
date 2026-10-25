const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { admin, db, rawCollection } = require('../config/firebase');
const { confirmedWrite } = require('../config/firestore-write');
const { orgDocs, ownerOrgId, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');
const inactivityAi = require('../services/inactivity-ai-service');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Employee Inactivity Radar (admin-inactivity-monitor.html).
 *
 * "Inactive" = invited (users.invite_status 'sent' or 'pending') and never signed in. Sign-in
 * is read from Firebase Authentication (last sign-in time) and the user record; nothing in
 * Authentication is changed. The automation keeps its own state on the user record
 * (inactivityStatus: Suspended / Trash / Deleted, with timestamps) so other modules are not
 * affected, and logs every action to `inactivity_logs`. Rules are per organization
 * (system_configs/inactivity_rules_{orgId}). Everything is limited to the caller's
 * organization; changes respond only after Firestore confirmed them.
 */

const DEFAULT_RULES = { thresholdSuspendHours: 3, thresholdTrashDays: 2, trashRetentionDays: 30, emailReminders: true, escalations: true };
const HOUR = 3600000;

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorOf(req) {
    const u = req.user || {};
    return { id: u.uid || u.id || 'admin', name: u.name || u.displayName || u.email || 'Administrator' };
}

function sendError(res, err, context) {
    logger.error(`[InactivityAPI] ${context}:`, err.message);
    res.status(err.status || 500).json({ success: false, firebaseSaved: false, error: err.message, message: err.message });
}

const httpError = (status, message) => Object.assign(new Error(message), { status });
const toMs = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v._seconds !== undefined) return v._seconds * 1000;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
};

async function loadRules(orgId) {
    const own = await rawCollection('system_configs').doc(`inactivity_rules_${orgId}`).get();
    let stored = own.exists ? own.data() : null;
    if (!stored && orgId === LEGACY_ORG_ID) {
        // Rules saved before they were kept per organization
        const shared = await rawCollection('system_configs').doc('inactivity_rules').get();
        stored = shared.exists ? shared.data() : null;
    }
    const r = { ...DEFAULT_RULES, ...(stored || {}) };
    return {
        thresholdSuspendHours: Number(r.thresholdSuspendHours) || DEFAULT_RULES.thresholdSuspendHours,
        thresholdTrashDays: Number(r.thresholdTrashDays) || DEFAULT_RULES.thresholdTrashDays,
        trashRetentionDays: Number(r.trashRetentionDays) || DEFAULT_RULES.trashRetentionDays,
        emailReminders: r.emailReminders !== false,
        escalations: r.escalations !== false,
        updatedAt: toMs(r.updatedAt) ? new Date(toMs(r.updatedAt)).toISOString() : null
    };
}

/** Last sign-in per auth uid (Firebase Authentication; read-only) */
async function signIns(uids) {
    const map = new Map();
    for (let i = 0; i < uids.length; i += 100) {
        try {
            const { users } = await admin.auth().getUsers(uids.slice(i, i + 100).map(uid => ({ uid })));
            users.forEach(u => { if (u.metadata && u.metadata.lastSignInTime) map.set(u.uid, Date.parse(u.metadata.lastSignInTime)); });
        } catch (err) {
            logger.warn(`[InactivityAPI] Sign-in lookup notice: ${err.message}`);
        }
    }
    return map;
}

/** Invited people of the organization with their inactivity state */
async function radar(req) {
    const orgId = orgOf(req);
    const [users, rules] = await Promise.all([orgDocs(rawCollection, 'users', orgId, 2000), loadRules(orgId)]);
    const me = actorOf(req).id;
    const invited = users.filter(u => /^(sent|pending)$/i.test(String(u.invite_status || '')) && u.id !== me && (u.name || u.email));
    const lastSignIn = await signIns([...new Set(invited.map(u => u.uid || u.id))]);
    const managers = users.filter(u => /manager|lead/i.test(String(u.role || '')));
    const now = Date.now();
    const respondedHours = [];

    const people = invited.map(u => {
        const invitedAt = toMs(u.invitationSentAt) || toMs(u.inviteSentAt) || toMs(u.invitedAt) || toMs(u.createdAt) || now;
        const signedInAt = lastSignIn.get(u.uid || u.id) || toMs(u.lastLoginAt) || null;
        const responded = Boolean(signedInAt && signedInAt >= invitedAt - HOUR) || u.must_change_password === false || u.is_temporary_password === false;
        if (responded && signedInAt && signedInAt >= invitedAt) respondedHours.push((signedInAt - invitedAt) / HOUR);
        const department = u.departmentName || u.department || '';
        const manager = managers.find(m => m.id !== u.id && (m.departmentName || m.department) === department);
        const joining = toMs(u.joiningDate);
        return {
            id: u.id,
            name: u.name || u.displayName || u.email,
            email: u.email || '',
            phone: u.phone || '',
            department,
            role: u.role || 'employee',
            joiningDate: u.joiningDate ? String(u.joiningDate).slice(0, 10) : '',
            joiningInDays: joining ? Math.floor((joining - now) / 86400000) : null,
            inviteDelivered: /^sent$/i.test(u.invite_status),
            invitedAt: new Date(invitedAt).toISOString(),
            hoursSinceInvite: Math.max(0, (now - invitedAt) / HOUR),
            responded,
            lastSignInAt: signedInAt ? new Date(signedInAt).toISOString() : null,
            status: u.inactivityStatus || (responded ? 'Active' : 'Pending'),
            forcedActive: u.inactivityStatus === 'Active' && Boolean(u.inactivityOverrideAt),
            suspendedAt: toMs(u.inactivitySuspendedAt) ? new Date(toMs(u.inactivitySuspendedAt)).toISOString() : null,
            trashedAt: toMs(u.inactivityTrashedAt) ? new Date(toMs(u.inactivityTrashedAt)).toISOString() : null,
            retentionExpiry: toMs(u.inactivityRetentionExpiry) ? new Date(toMs(u.inactivityRetentionExpiry)).toISOString() : null,
            remindersSent: Number(u.inactivityRemindersSent) || 0,
            managerName: manager ? manager.name : '',
            managerId: manager ? manager.id : ''
        };
    });
    return { orgId, rules, people, respondedHours };
}

const visible = (p) => !p.responded && p.status !== 'Deleted' && !p.forcedActive;

// GET /api/inactivity/overview
router.get('/overview', async (req, res) => {
    try {
        const { orgId, rules, people } = await radar(req);
        const logs = (await orgDocs(rawCollection, 'inactivity_logs', orgId, 500))
            .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
            .slice(0, 30);
        const open = people.filter(visible);
        res.json({
            success: true,
            data: {
                rules,
                counts: {
                    pending: open.filter(p => p.status === 'Pending').length,
                    suspended: open.filter(p => p.status === 'Suspended').length,
                    trash: open.filter(p => p.status === 'Trash').length,
                    undelivered: open.filter(p => !p.inviteDelivered).length,
                    responded: people.filter(p => p.responded).length,
                    invited: people.length
                },
                people: open.map(p => ({ ...p, risk: inactivityAi.assessCandidate(p, rules) }))
                    .sort((a, b) => b.risk.score - a.risk.score || b.hoursSinceInvite - a.hoursSinceInvite),
                logs: logs.map(l => ({ action: l.action, details: l.details, by: l.by, timestamp: l.timestamp })),
                lastSyncAt: (logs.find(l => l.action === 'SYNC') || {}).timestamp || null
            }
        });
    } catch (err) {
        sendError(res, err, 'Overview error');
    }
});

function logDoc(orgId, action, details, by, targetId = null) {
    return { orgId, action, details: String(details).slice(0, 500), targetId, by: by.name, byId: by.id, timestamp: new Date().toISOString() };
}

// PUT /api/inactivity/rules
router.put('/rules', async (req, res) => {
    try {
        const b = req.body || {};
        const hours = Number(b.thresholdSuspendHours);
        const days = Number(b.thresholdTrashDays);
        const retention = b.trashRetentionDays === undefined ? undefined : Number(b.trashRetentionDays);
        if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw httpError(400, 'Suspend after: enter whole hours from 1 to 720.');
        if (!Number.isInteger(days) || days < 1 || days > 90) throw httpError(400, 'Move to trash after: enter whole days from 1 to 90.');
        if (days * 24 <= hours) throw httpError(400, 'The trash limit must be longer than the suspend limit.');
        if (retention !== undefined && (!Number.isInteger(retention) || retention < 1 || retention > 365)) throw httpError(400, 'Trash retention: enter whole days from 1 to 365.');
        const orgId = orgOf(req);
        const by = actorOf(req);
        const rules = {
            orgId,
            thresholdSuspendHours: hours,
            thresholdTrashDays: days,
            ...(retention !== undefined ? { trashRetentionDays: retention } : {}),
            emailReminders: b.emailReminders !== false,
            escalations: b.escalations !== false,
            updatedAt: new Date(),
            updatedBy: by
        };
        const batch = db.batch();
        batch.set(rawCollection('system_configs').doc(`inactivity_rules_${orgId}`), rules, { merge: true });
        batch.set(rawCollection('inactivity_logs').doc(), logDoc(orgId, 'RULE_UPDATE', `Suspend after ${hours}h, trash after ${days}d${retention ? `, keep trash ${retention}d` : ''}`, by));
        await confirmedWrite(() => batch.commit());
        res.json({ success: true, firebaseSaved: true, data: await loadRules(orgId) });
    } catch (err) {
        sendError(res, err, 'Rules error');
    }
});

// POST /api/inactivity/sync - Apply the rules now
router.post('/sync', async (req, res) => {
    try {
        const { orgId, rules, people } = await radar(req);
        const by = actorOf(req);
        const now = new Date();
        const changes = [];
        people.filter(visible).forEach(p => {
            // Undelivered invites are not penalised: the person never got the email
            if (!p.inviteDelivered) return;
            if ((p.status === 'Pending' || p.status === 'Suspended') && p.hoursSinceInvite >= rules.thresholdTrashDays * 24) {
                changes.push({ p, to: 'Trash' });
            } else if (p.status === 'Pending' && p.hoursSinceInvite >= rules.thresholdSuspendHours) {
                changes.push({ p, to: 'Suspended' });
            }
        });
        // Trash past its retention period is purged
        const expired = people.filter(p => p.status === 'Trash' && p.retentionExpiry && Date.parse(p.retentionExpiry) <= now.getTime());

        const writes = [];
        changes.forEach(({ p, to }) => {
            const update = to === 'Suspended'
                ? { inactivityStatus: 'Suspended', inactivitySuspendedAt: now }
                : { inactivityStatus: 'Trash', inactivityTrashedAt: now, inactivityRetentionExpiry: new Date(now.getTime() + rules.trashRetentionDays * 86400000) };
            writes.push(['set', rawCollection('users').doc(p.id), { ...update, inactivityUpdatedBy: 'inactivity-automation' }]);
            writes.push(['set', rawCollection('inactivity_logs').doc(), logDoc(orgId, to === 'Suspended' ? 'SUSPENDED' : 'TRASHED',
                `${p.name}: no sign-in ${Math.floor(p.hoursSinceInvite)}h after invite (${to === 'Suspended' ? `${rules.thresholdSuspendHours}h` : `${rules.thresholdTrashDays}d`} limit)`, by, p.id)]);
        });
        expired.forEach(p => {
            writes.push(['set', rawCollection('users').doc(p.id), { inactivityStatus: 'Deleted', inactivityDeletedAt: now }]);
            writes.push(['set', rawCollection('inactivity_logs').doc(), logDoc(orgId, 'PURGED', `${p.name}: trash retention ended`, by, p.id)]);
        });
        writes.push(['set', rawCollection('inactivity_logs').doc(), logDoc(orgId, 'SYNC',
            `Checked ${people.filter(visible).length} invited people: ${changes.filter(c => c.to === 'Suspended').length} suspended, ${changes.filter(c => c.to === 'Trash').length} moved to trash, ${expired.length} purged`, by)]);

        for (let i = 0; i < writes.length; i += 400) {
            const batch = db.batch();
            writes.slice(i, i + 400).forEach(([, ref, data]) => batch.set(ref, data, { merge: true }));
            await confirmedWrite(() => batch.commit());
        }
        res.json({
            success: true,
            firebaseSaved: true,
            data: {
                suspended: changes.filter(c => c.to === 'Suspended').map(c => c.p.name),
                trashed: changes.filter(c => c.to === 'Trash').map(c => c.p.name),
                purged: expired.map(p => p.name),
                skippedUndelivered: people.filter(p => visible(p) && !p.inviteDelivered).map(p => p.name)
            }
        });
    } catch (err) {
        sendError(res, err, 'Sync error');
    }
});

/** A person of this organization, or 404 */
async function ownedPerson(req) {
    const snap = await rawCollection('users').doc(String(req.params.id)).get();
    if (!snap.exists || ownerOrgId(snap.data()) !== orgOf(req)) throw httpError(404, 'Person not found in your organization.');
    return { ref: snap.ref, data: snap.data() };
}

const del = () => admin.firestore.FieldValue.delete();

// POST /api/inactivity/people/:id/restore - Back to the radar as Pending (clock restarts)
router.post('/people/:id/restore', async (req, res) => {
    try {
        const { ref, data } = await ownedPerson(req);
        const orgId = orgOf(req);
        const batch = db.batch();
        batch.set(ref, {
            inactivityStatus: 'Pending', inactivitySuspendedAt: del(), inactivityTrashedAt: del(), inactivityRetentionExpiry: del(),
            invitationSentAt: new Date(), inactivityRestoredAt: new Date()
        }, { merge: true });
        batch.set(rawCollection('inactivity_logs').doc(), logDoc(orgId, 'RESTORED', `${data.name || data.email} restored; response window restarted`, actorOf(req), ref.id));
        await confirmedWrite(() => batch.commit());
        res.json({ success: true, firebaseSaved: true });
    } catch (err) {
        sendError(res, err, 'Restore error');
    }
});

// POST /api/inactivity/people/:id/mark-active - Admin confirms the person is active (e.g. reached by phone)
router.post('/people/:id/mark-active', async (req, res) => {
    try {
        const { ref, data } = await ownedPerson(req);
        const reason = String((req.body && req.body.reason) || '').trim().slice(0, 300) || 'Confirmed active by administrator';
        const batch = db.batch();
        batch.set(ref, { inactivityStatus: 'Active', inactivityOverrideAt: new Date(), inactivityOverrideReason: reason, inactivitySuspendedAt: del(), inactivityTrashedAt: del(), inactivityRetentionExpiry: del() }, { merge: true });
        batch.set(rawCollection('inactivity_logs').doc(), logDoc(orgOf(req), 'FORCED_ACTIVE', `${data.name || data.email}: ${reason}`, actorOf(req), ref.id));
        await confirmedWrite(() => batch.commit());
        res.json({ success: true, firebaseSaved: true });
    } catch (err) {
        sendError(res, err, 'Mark active error');
    }
});

// POST /api/inactivity/people/:id/contact-dept - In-app message to the department's manager (or HR)
router.post('/people/:id/contact-dept', async (req, res) => {
    try {
        const { ref, data } = await ownedPerson(req);
        const orgId = orgOf(req);
        const users = await orgDocs(rawCollection, 'users', orgId, 2000);
        const dept = data.departmentName || data.department || '';
        let targets = users.filter(u => u.id !== ref.id && /manager|lead/i.test(String(u.role || '')) && (u.departmentName || u.department) === dept);
        if (!targets.length) targets = users.filter(u => /hr|admin/i.test(String(u.role || '')) && u.id !== actorOf(req).id);
        if (!targets.length) throw httpError(409, 'No manager or HR person found to contact.');
        const now = new Date();
        const message = `${data.name || data.email} (${dept || 'no department'}) has not signed in since their invite. Please contact them${data.phone ? ` at ${data.phone}` : ''} and help them sign in.`;
        const batch = db.batch();
        targets.slice(0, 10).forEach(t => batch.set(rawCollection('notifications').doc(), {
            orgId, userId: t.id, targetUid: t.id, target: t.id, title: 'New joiner has not signed in', text: message, message,
            type: 'inactivity', priority: 'high', read: false, timestamp: now, createdAt: now.toISOString()
        }));
        batch.set(ref, { inactivityRemindersSent: admin.firestore.FieldValue.increment(1), inactivityLastContactAt: now }, { merge: true });
        batch.set(rawCollection('inactivity_logs').doc(), logDoc(orgId, 'DEPT_CONTACTED', `${data.name || data.email}: notified ${targets.slice(0, 10).map(t => t.name || t.email).join(', ')}`, actorOf(req), ref.id));
        await confirmedWrite(() => batch.commit());
        res.json({ success: true, firebaseSaved: true, data: { notified: targets.slice(0, 10).map(t => t.name || t.email) } });
    } catch (err) {
        sendError(res, err, 'Contact department error');
    }
});

// POST /api/inactivity/people/:id/resend - Resend the invitation email (existing invite service)
router.post('/people/:id/resend', async (req, res, next) => {
    try {
        await ownedPerson(req);
        const adminController = require('../controllers/adminController');
        // Delegate to the employee invite endpoint (it emails the login details and marks invite_status 'sent')
        await adminController.triggerEmailInvite(req, res, (err) => sendError(res, err || httpError(500, 'Invite failed'), 'Resend error'));
        if (res.statusCode < 400) {
            await rawCollection('inactivity_logs').add(logDoc(orgOf(req), 'INVITE_RESENT', `Invitation resent to ${req.params.id}`, actorOf(req), req.params.id)).catch(() => {});
        }
    } catch (err) {
        sendError(res, err, 'Resend error');
    }
});

// POST /api/inactivity/trash/empty - Purge everything in trash now
router.post('/trash/empty', async (req, res) => {
    try {
        const { orgId, people } = await radar(req);
        const inTrash = people.filter(p => p.status === 'Trash');
        if (!inTrash.length) return res.json({ success: true, firebaseSaved: true, data: { purged: 0 } });
        const now = new Date();
        const batch = db.batch();
        inTrash.forEach(p => batch.set(rawCollection('users').doc(p.id), { inactivityStatus: 'Deleted', inactivityDeletedAt: now }, { merge: true }));
        batch.set(rawCollection('inactivity_logs').doc(), logDoc(orgId, 'PURGED', `Trash emptied: ${inTrash.map(p => p.name).join(', ')}`, actorOf(req)));
        await confirmedWrite(() => batch.commit());
        res.json({ success: true, firebaseSaved: true, data: { purged: inTrash.length } });
    } catch (err) {
        sendError(res, err, 'Empty trash error');
    }
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━ AI ━━━━━━━━━━━━━━━━━━━━━━━━━━ */

router.get('/ai/status', (req, res) => res.json({ success: true, data: { aiConfigured: inactivityAi.aiConfigured() } }));

// GET /api/inactivity/ai/rules-advice - Thresholds from this organization's response history
router.get('/ai/rules-advice', async (req, res) => {
    try {
        const { rules, respondedHours } = await radar(req);
        res.json({ success: true, data: { current: rules, ...inactivityAi.adviseRules(respondedHours, rules) } });
    } catch (err) {
        sendError(res, err, 'Rules advice error');
    }
});

// POST /api/inactivity/ai/nudge/:id - A personal reminder (text only; not sent)
router.post('/ai/nudge/:id', async (req, res) => {
    try {
        const { people } = await radar(req);
        const candidate = people.find(p => p.id === req.params.id);
        if (!candidate) throw httpError(404, 'Person not found on the inactivity radar.');
        const orgSnap = await rawCollection('organizations').doc(orgOf(req)).get();
        const o = orgSnap.exists ? orgSnap.data() : {};
        const nudge = await inactivityAi.composeNudge({ candidate, tone: req.body && req.body.tone, companyName: o.displayName || o.Display_Name || o.legalName || '' });
        res.json({ success: true, data: { ...nudge, to: { name: candidate.name, email: candidate.email, phone: candidate.phone } } });
    } catch (err) {
        sendError(res, err, 'Nudge error');
    }
});

module.exports = router;
