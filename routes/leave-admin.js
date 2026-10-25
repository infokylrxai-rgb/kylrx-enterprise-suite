const express = require('express');
const router = express.Router();
const { confirmedWrite } = require('../config/firestore-write');
const logger = require('../utils/logger');
const { db, rawCollection } = require('../config/firebase');
const { orgDocs, ownerOrgId, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Admin Leave & Holiday Management
 *
 *   leave_requests/{id}       employee requests { uid, type, startDate, endDate, reason, status }
 *   leave_policies/{id}       leave policies
 *   leave_types/{id}          leave types (built-in set until the organization saves its own)
 *   holidays/{id}             organizational calendar
 *   command_centers/{id}      departments, with week-offs in dept_week_offs/{deptId}
 *   system_config/weekly_off_{orgId}  company weekly off (Kylrx AI also keeps the shared
 *                             system_config/weekly_off that the employee and HR calendars read)
 *
 * Everything is limited to the caller's organization. Writes respond only after Firestore
 * confirmed them (503 otherwise).
 */

const DEFAULT_LEAVE_TYPES = [
    { name: 'Earned Leave', description: 'Standard paid leave', accrualRate: '1.75' },
    { name: 'Sick Leave', description: 'Medical wellness leave', accrualRate: '1.0' },
    { name: 'Casual Leave', description: 'Casual personal leave', accrualRate: '1.0' },
    { name: 'Maternity', description: 'Maternity leave plan', accrualRate: '0.0' }
];
// Balances employees see when none were set yet (employee-leave.html)
const DEFAULT_BALANCES = { paid: 12, sick: 4, comp: 2 };
const WEEKLY_OFF_VALUES = ['sat-sun', 'sun', 'sat', 'fri-sat', 'mon', 'rotational', 'none'];
const HOLIDAY_TYPES = ['National', 'Regional', 'Optional'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IMPORT = 400;

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorOf(req) {
    return (req.user && (req.user.uid || req.user.id)) || 'admin';
}

const toIso = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString()
    : (t && t._seconds !== undefined ? new Date(t._seconds * 1000).toISOString() : t);

function sendError(res, error, context) {
    logger.error(`[LEAVE-ADMIN] ${context}:`, error);
    res.status(error.status || 500).json({ success: false, firebaseSaved: false, message: error.message, error: error.message });
}

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

const text = (value, max) => String(value === undefined || value === null ? '' : value).trim().slice(0, max);

/** Balance bucket a leave type draws from (null: not deducted, e.g. WFH or maternity) */
function balanceKey(type) {
    const t = String(type || '').toLowerCase();
    if (/wfh|work from home|remote/.test(t)) return null;
    if (/sick|medical/.test(t)) return 'sick';
    if (/comp/.test(t)) return 'comp';
    if (/annual|paid|earned|casual|privilege|vacation/.test(t)) return 'paid';
    return null;
}

function isWeeklyOff(date, pattern) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    switch (pattern) {
        case 'sat-sun': return day === 0 || day === 6;
        case 'sun': return day === 0;
        case 'sat': return day === 6;
        case 'fri-sat': return day === 5 || day === 6;
        case 'mon': return day === 1;
        default: return false;
    }
}

/** Working days in a request: weekly offs and holidays are not counted */
function workingDays(startDate, endDate, weeklyOff, holidayDates) {
    let days = 0;
    const end = Date.parse(`${endDate || startDate}T00:00:00Z`);
    for (let t = Date.parse(`${startDate}T00:00:00Z`); t <= end && days < 400; t += 86400000) {
        const d = new Date(t).toISOString().slice(0, 10);
        if (!isWeeklyOff(d, weeklyOff) && !holidayDates.has(d)) days++;
    }
    return days;
}

async function companyWeeklyOff(orgId) {
    const [own, shared] = await Promise.all([
        rawCollection('system_config').doc(`weekly_off_${orgId}`).get(),
        rawCollection('system_config').doc('weekly_off').get()
    ]);
    // The shared document is Kylrx AI's: the Settings page and the calendars use it too
    if (orgId === LEGACY_ORG_ID && shared.exists && shared.data().value) return shared.data().value;
    if (own.exists && own.data().value) return own.data().value;
    return 'sat-sun';
}

/** This organization's leave requests: tagged with orgId, or made by one of its people */
async function orgLeaveRequests(orgId, people) {
    const [tagged, untagged] = await Promise.all([
        rawCollection('leave_requests').where('orgId', '==', orgId).limit(3000).get(),
        rawCollection('leave_requests').limit(3000).get()
    ]);
    const byId = new Map(tagged.docs.map(d => [d.id, d]));
    untagged.docs.forEach(d => {
        const r = d.data();
        if (r.orgId) return;
        const owner = r.uid || r.userId || r.employeeId;
        const known = people.has(owner);
        // Requests from unknown people stay with the legacy organization
        if (known || orgId === LEGACY_ORG_ID) byId.set(d.id, d);
    });
    return [...byId.values()].map(d => ({ id: d.id, ...d.data() }));
}

async function loadOwned(collection, id, orgId, label) {
    const ref = rawCollection(collection).doc(String(id));
    const snap = await ref.get();
    if (!snap.exists || ownerOrgId(snap.data()) !== orgId) throw httpError(404, `${label} not found in your organization.`);
    return { ref, data: snap.data() };
}

async function orgLeaveTypes(orgId) {
    return orgDocs(rawCollection, 'leave_types', orgId);
}

/** Saves the built-in leave types for the organization (in a batch) before it changes them */
function materializeDefaults(batch, orgId, skipName) {
    DEFAULT_LEAVE_TYPES.filter(t => t.name !== skipName).forEach(t => {
        batch.set(rawCollection('leave_types').doc(), { ...t, orgId, createdAt: new Date() });
    });
}

// GET /api/leave-admin/overview?today=YYYY-MM-DD - Everything the page shows, for this organization
router.get('/overview', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const today = DATE_RE.test(String(req.query.today || '')) ? req.query.today : new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

        const users = await orgDocs(rawCollection, 'users', orgId);
        const people = new Map(users.map(u => [u.id, u]));
        const [requests, policies, types, holidays, departments, deptWeekOffs, weeklyOff] = await Promise.all([
            orgLeaveRequests(orgId, people),
            orgDocs(rawCollection, 'leave_policies', orgId),
            orgLeaveTypes(orgId),
            orgDocs(rawCollection, 'holidays', orgId),
            orgDocs(rawCollection, 'command_centers', orgId),
            orgDocs(rawCollection, 'dept_week_offs', orgId),
            companyWeeklyOff(orgId)
        ]);

        const holidayDates = new Set(holidays.map(h => h.date));
        const list = requests.map(r => {
            const uid = r.uid || r.userId || r.employeeId || '';
            const person = people.get(uid) || {};
            return {
                id: r.id,
                uid,
                employeeName: r.employeeName || person.name || person.displayName || person.email || 'Unknown employee',
                department: person.departmentName || person.department || '',
                type: r.type || 'Leave',
                startDate: r.startDate || '',
                endDate: r.endDate || r.startDate || '',
                reason: r.reason || '',
                status: r.status || 'Pending',
                days: r.startDate ? workingDays(r.startDate, r.endDate || r.startDate, weeklyOff, holidayDates) : 0,
                createdAt: toIso(r.createdAt) || null,
                processedAt: toIso(r.processedAt) || null
            };
        });

        const approved = list.filter(r => /^approved$/i.test(r.status));
        const covers = (r, d) => r.startDate <= d && d <= r.endDate;
        const isWfh = (r) => balanceKey(r.type) === null && /wfh|work from home|remote/i.test(r.type);
        const pending = list.filter(r => /^pending$/i.test(r.status))
            .map(r => ({ ...r, overdue: !!(r.createdAt && Date.now() - Date.parse(r.createdAt) > 48 * 3600000) }))
            .sort((a, b) => (b.overdue - a.overdue) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

        const allTypes = types.length ? types : DEFAULT_LEAVE_TYPES.map((t, i) => ({ ...t, id: `default_${i}`, isDefault: true }));
        const earned = allTypes.find(t => /earned/i.test(t.name || ''));

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    onLeaveToday: approved.filter(r => !isWfh(r) && covers(r, today)).length,
                    onLeaveYesterday: approved.filter(r => !isWfh(r) && covers(r, yesterday)).length,
                    pendingApprovals: pending.length,
                    overdue: pending.filter(r => r.overdue).length,
                    wfhToday: approved.filter(r => isWfh(r) && covers(r, today)).length,
                    monthlyAccrual: earned ? String(earned.accrualRate || '0') : '0'
                },
                pending,
                approved: approved.map(r => ({ id: r.id, startDate: r.startDate, endDate: r.endDate, type: r.type })),
                policies: policies
                    .map(p => ({ ...p, createdAt: toIso(p.createdAt), updatedAt: toIso(p.updatedAt) }))
                    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))),
                leaveTypes: allTypes.map(t => ({ id: t.id, name: t.name || '', description: t.description || '', accrualRate: String(t.accrualRate ?? '0'), isDefault: !!t.isDefault }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
                holidays: holidays
                    .map(h => ({ id: h.id, name: h.name || '', date: h.date || '', type: h.type || 'National' }))
                    .sort((a, b) => a.date.localeCompare(b.date)),
                departments: departments
                    .map(d => ({ id: d.id, name: d.name || d.id, description: d.description || d.targetType || '' }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
                deptWeekOffs: Object.fromEntries(deptWeekOffs.map(w => [w.id, w.value])),
                weeklyOff
            }
        });
    } catch (error) {
        sendError(res, error, 'Error loading leave overview');
    }
});

// POST /api/leave-admin/requests/:id/decision - Approve or reject a pending leave request
router.post('/requests/:id/decision', async (req, res) => {
    try {
        const { action, comment } = req.body || {};
        if (action !== 'approve' && action !== 'reject') throw httpError(400, 'Choose approve or reject.');
        const orgId = orgOf(req);

        const ref = rawCollection('leave_requests').doc(String(req.params.id));
        const snap = await ref.get();
        if (!snap.exists) throw httpError(404, 'Leave request not found in your organization.');
        const request = snap.data();
        const uid = request.uid || request.userId || request.employeeId;
        const userRef = uid ? rawCollection('users').doc(String(uid)) : null;
        const userSnap = userRef ? await userRef.get() : null;
        const requestOrg = request.orgId || (userSnap && userSnap.exists ? ownerOrgId(userSnap.data()) : LEGACY_ORG_ID);
        if (requestOrg !== orgId) throw httpError(404, 'Leave request not found in your organization.');
        if (!/^pending$/i.test(request.status || 'Pending')) {
            throw httpError(409, `This request was already ${String(request.status).toLowerCase()}.`);
        }

        const now = new Date();
        const batch = db.batch();
        const update = {
            orgId,
            status: action === 'approve' ? 'Approved' : 'Rejected',
            processedBy: actorOf(req),
            processedAt: now,
            ...(text(comment, 500) ? { decisionComment: text(comment, 500) } : {})
        };
        let message;

        if (action === 'approve') {
            const key = balanceKey(request.type);
            const holidays = await orgDocs(rawCollection, 'holidays', orgId);
            const days = workingDays(request.startDate, request.endDate || request.startDate, await companyWeeklyOff(orgId), new Set(holidays.map(h => h.date)));
            update.leaveDays = days;
            if (key && userSnap && userSnap.exists) {
                const balances = { ...DEFAULT_BALANCES, ...(userSnap.data().leaveBalances || {}) };
                const available = Number(balances[key]) || 0;
                if (days > available) {
                    throw httpError(409, `Not enough ${key === 'paid' ? 'paid' : key} leave: ${days} working day(s) requested, ${available} left. Reject it or adjust the balance first.`);
                }
                balances[key] = Math.round((available - days) * 100) / 100;
                batch.set(userRef, { leaveBalances: balances }, { merge: true });
                update.balanceDeducted = { [key]: days };
            }
            message = `Your ${request.type || 'leave'} request (${request.startDate} to ${request.endDate || request.startDate}) has been approved.`;
        } else {
            message = `Your ${request.type || 'leave'} request (${request.startDate} to ${request.endDate || request.startDate}) was rejected${update.decisionComment ? `: "${update.decisionComment}"` : '.'}`;
        }

        batch.update(ref, update);
        if (uid) {
            batch.set(rawCollection('notifications').doc(), {
                orgId, target: uid, targetUid: uid, userId: uid,
                title: action === 'approve' ? 'Leave Approved' : 'Leave Rejected',
                text: message, message, priority: 'high', type: 'leave',
                read: false, timestamp: now, createdAt: now.toISOString()
            });
        }
        await confirmedWrite(() => batch.commit());
        res.status(200).json({ success: true, firebaseSaved: true, data: { status: update.status, leaveDays: update.leaveDays, balanceDeducted: update.balanceDeducted || null } });
    } catch (error) {
        sendError(res, error, 'Error deciding leave request');
    }
});

function policyFrom(body) {
    const title = text(body.title, 120);
    if (!title) throw httpError(400, 'Enter a policy title.');
    const limit = body.limit === '' || body.limit === undefined ? '' : Number(body.limit);
    if (limit !== '' && (!Number.isFinite(limit) || limit < 0 || limit > 366)) throw httpError(400, 'Enter a valid annual limit (0-366 days).');
    return {
        title,
        type: text(body.type, 80) || 'Leave',
        limit: limit === '' ? '' : String(limit),
        accrual: text(body.accrual, 1000),
        details: text(body.accrual, 1000) || (limit !== '' ? `Annual Limit: ${limit} days` : ''),
        autoApprove: body.autoApprove === true,
        status: 'Active'
    };
}

// POST /api/leave-admin/policies - Create a policy
router.post('/policies', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const now = new Date();
        const ref = rawCollection('leave_policies').doc();
        const policy = { ...policyFrom(req.body || {}), orgId, createdBy: actorOf(req), createdAt: now, updatedAt: now };
        await confirmedWrite(() => ref.set(policy));
        res.status(201).json({ success: true, firebaseSaved: true, data: { id: ref.id } });
    } catch (error) {
        sendError(res, error, 'Error creating policy');
    }
});

// PUT /api/leave-admin/policies/:id - Edit a policy
router.put('/policies/:id', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const { ref } = await loadOwned('leave_policies', req.params.id, orgId, 'Policy');
        await confirmedWrite(() => ref.set({ ...policyFrom(req.body || {}), orgId, updatedBy: actorOf(req), updatedAt: new Date() }, { merge: true }));
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error updating policy');
    }
});

// POST /api/leave-admin/policies/:id/duplicate - Copy a policy
router.post('/policies/:id/duplicate', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const { data } = await loadOwned('leave_policies', req.params.id, orgId, 'Policy');
        const now = new Date();
        const ref = rawCollection('leave_policies').doc();
        await confirmedWrite(() => ref.set({ ...data, orgId, title: `${data.title || 'Policy'} (Copy)`, createdBy: actorOf(req), createdAt: now, updatedAt: now }));
        res.status(201).json({ success: true, firebaseSaved: true, data: { id: ref.id } });
    } catch (error) {
        sendError(res, error, 'Error duplicating policy');
    }
});

// DELETE /api/leave-admin/policies/:id - Decommission a policy
router.delete('/policies/:id', async (req, res) => {
    try {
        const { ref } = await loadOwned('leave_policies', req.params.id, orgOf(req), 'Policy');
        await confirmedWrite(() => ref.delete());
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error deleting policy');
    }
});

function leaveTypeFrom(item, existingNames) {
    const name = text(item.name, 80);
    if (!name) throw httpError(400, 'Enter a leave type name.');
    const accrual = Number(item.accrualRate === undefined || item.accrualRate === '' ? 0 : item.accrualRate);
    if (!Number.isFinite(accrual) || accrual < 0 || accrual > 366) throw httpError(400, `Accrual rate for "${name}" must be a number from 0 to 366.`);
    if (existingNames.has(name.toLowerCase())) throw httpError(409, `A leave type named "${name}" already exists.`);
    existingNames.add(name.toLowerCase());
    return { name, description: text(item.description, 300) || 'Custom Leave', accrualRate: String(accrual) };
}

// POST /api/leave-admin/leave-types - Add one ({name,...}) or many ({items:[...]}) leave types
router.post('/leave-types', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [req.body || {}];
        if (!items.length) throw httpError(400, 'Nothing to import.');
        if (items.length > MAX_IMPORT) throw httpError(400, `Import at most ${MAX_IMPORT} leave types at a time.`);

        const existing = await orgLeaveTypes(orgId);
        const names = new Set((existing.length ? existing : DEFAULT_LEAVE_TYPES).map(t => String(t.name || '').toLowerCase()));
        const clean = items.map(item => leaveTypeFrom(item, names));

        const now = new Date();
        const batch = db.batch();
        if (!existing.length) materializeDefaults(batch, orgId);
        clean.forEach(t => batch.set(rawCollection('leave_types').doc(), { ...t, orgId, createdBy: actorOf(req), createdAt: now }));
        await confirmedWrite(() => batch.commit());
        res.status(201).json({ success: true, firebaseSaved: true, count: clean.length });
    } catch (error) {
        sendError(res, error, 'Error saving leave types');
    }
});

// DELETE /api/leave-admin/leave-types/:id - Remove a leave type
router.delete('/leave-types/:id', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const id = String(req.params.id);
        if (id.startsWith('default_')) {
            // Built-in list: keep the others as the organization's own types
            const removed = DEFAULT_LEAVE_TYPES[Number(id.slice(8))];
            if (!removed || (await orgLeaveTypes(orgId)).length) throw httpError(404, 'Leave type not found.');
            const batch = db.batch();
            materializeDefaults(batch, orgId, removed.name);
            await confirmedWrite(() => batch.commit());
        } else {
            const { ref } = await loadOwned('leave_types', id, orgId, 'Leave type');
            await confirmedWrite(() => ref.delete());
        }
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error deleting leave type');
    }
});

function holidayFrom(item) {
    const name = text(item.name, 120);
    const date = text(item.date, 10);
    if (!name) throw httpError(400, 'Enter the holiday name.');
    if (!DATE_RE.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) throw httpError(400, `Enter a valid date for "${name}".`);
    const type = HOLIDAY_TYPES.includes(item.type) ? item.type : 'National';
    return { name, date, type };
}

// POST /api/leave-admin/holidays - Add one ({name,date,type}) or many ({items:[...]}) holidays
router.post('/holidays', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [req.body || {}];
        if (!items.length) throw httpError(400, 'Nothing to import.');
        if (items.length > MAX_IMPORT) throw httpError(400, `Import at most ${MAX_IMPORT} holidays at a time.`);
        const clean = items.map(holidayFrom);

        // A date already on the calendar is updated instead of added twice
        const existing = new Map((await orgDocs(rawCollection, 'holidays', orgId)).map(h => [h.date, h.id]));
        const now = new Date();
        const batch = db.batch();
        clean.forEach(h => {
            const id = existing.get(h.date);
            const ref = id ? rawCollection('holidays').doc(id) : rawCollection('holidays').doc();
            batch.set(ref, { ...h, orgId, status: 'Upcoming', updatedAt: now, ...(id ? {} : { createdAt: now.toISOString(), createdBy: actorOf(req) }) }, { merge: true });
            existing.set(h.date, ref.id);
        });
        await confirmedWrite(() => batch.commit());
        res.status(201).json({ success: true, firebaseSaved: true, count: clean.length });
    } catch (error) {
        sendError(res, error, 'Error saving holidays');
    }
});

// PUT /api/leave-admin/holidays/:id - Edit a holiday
router.put('/holidays/:id', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const { ref } = await loadOwned('holidays', req.params.id, orgId, 'Holiday');
        const holiday = holidayFrom(req.body || {});
        const clash = (await orgDocs(rawCollection, 'holidays', orgId)).find(h => h.date === holiday.date && h.id !== ref.id);
        if (clash) throw httpError(409, `${holiday.date} already has a holiday (${clash.name}).`);
        await confirmedWrite(() => ref.set({ ...holiday, orgId, updatedAt: new Date() }, { merge: true }));
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error updating holiday');
    }
});

// DELETE /api/leave-admin/holidays/:id - Remove a holiday
router.delete('/holidays/:id', async (req, res) => {
    try {
        const { ref } = await loadOwned('holidays', req.params.id, orgOf(req), 'Holiday');
        await confirmedWrite(() => ref.delete());
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error deleting holiday');
    }
});

// PUT /api/leave-admin/weekly-off - Company weekly off
router.put('/weekly-off', async (req, res) => {
    try {
        const value = String((req.body && req.body.value) || '');
        if (!WEEKLY_OFF_VALUES.includes(value)) throw httpError(400, 'Choose a valid weekly off.');
        const orgId = orgOf(req);
        const now = new Date();
        const batch = db.batch();
        batch.set(rawCollection('system_config').doc(`weekly_off_${orgId}`), { orgId, value, updatedBy: actorOf(req), updatedAt: now }, { merge: true });
        if (orgId === LEGACY_ORG_ID) {
            // Shared settings the employee/HR calendars and Settings page read
            batch.set(rawCollection('system_config').doc('weekly_off'), { value, updatedAt: now }, { merge: true });
            batch.set(rawCollection('system_config').doc('onboarding_hr'), { default_weekoff: value, updatedAt: now.toISOString() }, { merge: true });
        }
        await confirmedWrite(() => batch.commit());
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error updating weekly off');
    }
});

// PUT /api/leave-admin/departments/:id/week-off - A department's week off
router.put('/departments/:id/week-off', async (req, res) => {
    try {
        const value = String((req.body && req.body.value) || '');
        if (!WEEKLY_OFF_VALUES.includes(value)) throw httpError(400, 'Choose a valid week off.');
        const orgId = orgOf(req);
        await loadOwned('command_centers', req.params.id, orgId, 'Department');
        await confirmedWrite(() => rawCollection('dept_week_offs').doc(String(req.params.id))
            .set({ orgId, value, updatedBy: actorOf(req), updatedAt: new Date() }, { merge: true }));
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error updating department week off');
    }
});

module.exports = router;
module.exports.companyWeeklyOff = companyWeeklyOff;
