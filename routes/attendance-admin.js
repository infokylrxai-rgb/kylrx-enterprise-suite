const express = require('express');
const router = express.Router();
const { confirmedWrite } = require('../config/firestore-write');
const logger = require('../utils/logger');
const { db, rawCollection } = require('../config/firebase');
const { orgDocs, ownerOrgId, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');
const { companyWeeklyOff } = require('./leave-admin');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Admin Attendance Monitor
 *
 *   attendance/{userId}_{date}          daily punch log (timeline, sheet, KPIs)
 *   attendance_records/ATT-{date}-{id}  manual adjustments made by admins (console)
 *   attendance_regularizations/{id}     correction requests (queue)
 *   shifts/{id}                         shift definitions
 *   holidays/{id}                       holidays shown on the attendance sheet
 *
 * Everything is limited to the caller's organization. Writes respond only after Firestore
 * confirmed them (503 otherwise), so the page never shows a save that did not happen.
 */

const DEFAULT_SHIFTS = [
    { id: 'default_general', name: 'General Shift', startTime: '09:00', endTime: '18:00', isDefault: true },
    { id: 'default_evening', name: 'Evening Shift', startTime: '14:00', endTime: '23:00', isDefault: true },
    { id: 'default_night', name: 'Night Shift', startTime: '22:00', endTime: '06:00', isDefault: true }
];
const RECORD_STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_DUTY'];
// Daily log status for each manual record status (the timeline and sheet read these)
const LOG_STATUS = { PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half Day', ABSENT: 'Absent', ON_DUTY: 'Present' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorOf(req) {
    return (req.user && (req.user.uid || req.user.id)) || 'admin';
}

const toIso = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString()
    : (t && t._seconds !== undefined ? new Date(t._seconds * 1000).toISOString() : t);

function sendError(res, error, context) {
    logger.error(`[ATTENDANCE-ADMIN] ${context}:`, error);
    res.status(error.status || 500).json({ success: false, firebaseSaved: false, message: error.message, error: error.message });
}

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

/** "09:00", "09:00:00", "9:05 AM" -> minutes after midnight (null when unreadable) */
function minutesOf(value) {
    const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    if (m[3]) {
        const pm = m[3].toLowerCase() === 'pm';
        if (h === 12) h = pm ? 12 : 0;
        else if (pm) h += 12;
    }
    return h < 24 && min < 60 ? h * 60 + min : null;
}

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Instant for a wall-clock time on a date, in the browser's time zone (offset sent by the page) */
function instantOf(date, minutes, tzOffsetMinutes) {
    const utc = Date.parse(`${date}T00:00:00Z`) + (minutes + (Number(tzOffsetMinutes) || 0)) * 60000;
    return new Date(utc);
}

async function orgEmployee(orgId, employeeId) {
    if (!employeeId) return null;
    const snap = await rawCollection('users').doc(String(employeeId)).get();
    if (!snap.exists || ownerOrgId(snap.data()) !== orgId) return null;
    const u = snap.data();
    return {
        id: snap.id,
        name: u.name || u.displayName || u.email || snap.id,
        department: u.departmentName || u.department || 'General'
    };
}

function notification(orgId, target, title, message, priority) {
    return {
        orgId,
        target, targetUid: target, userId: target,
        title, text: message, message, priority,
        read: false,
        timestamp: new Date(),
        createdAt: new Date().toISOString()
    };
}

// GET /api/attendance-admin/overview - Everything the monitor shows, for this organization
router.get('/overview', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const [users, logs, records, regs, shifts, holidays, weeklyOff] = await Promise.all([
            orgDocs(rawCollection, 'users', orgId),
            orgDocs(rawCollection, 'attendance', orgId, 5000),
            orgDocs(rawCollection, 'attendance_records', orgId, 5000),
            orgDocs(rawCollection, 'attendance_regularizations', orgId, 2000),
            orgDocs(rawCollection, 'shifts', orgId),
            orgDocs(rawCollection, 'holidays', orgId),
            companyWeeklyOff(orgId)
        ]);

        const employees = users
            .filter(u => u.name || u.displayName || u.email)
            .map(u => ({
                id: u.id,
                name: u.name || u.displayName || u.email,
                email: String(u.email || '').toLowerCase(),
                employeeCode: u.employeeId || u.employeeCode || '',
                department: u.departmentName || u.department || 'General',
                role: u.role || 'employee',
                active: !(u.isActive === false || /inactive|exited|relieved|terminated/i.test(String(u.employmentStatus || u.status || '')))
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const now = Date.now();
        res.status(200).json({
            success: true,
            data: {
                employees,
                logs: logs
                    .map(l => ({ ...l, punchIn: toIso(l.punchIn) || null, punchOut: toIso(l.punchOut) || null, lastUpdated: toIso(l.lastUpdated) }))
                    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
                records: records
                    .map(r => ({ ...r, attendanceId: r.id, createdAt: toIso(r.createdAt), updatedAt: toIso(r.updatedAt) }))
                    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
                regularizations: regs
                    .map(r => {
                        const requestedAt = toIso(r.requestedAt);
                        // SLA: pending for more than 48 hours
                        const breach = r.status === 'Pending' && (r.isAfterThreshold === true || (requestedAt && now - Date.parse(requestedAt) > 48 * 3600000));
                        return { ...r, requestedAt, updatedAt: toIso(r.updatedAt), approvedAt: toIso(r.approvedAt), rejectedAt: toIso(r.rejectedAt), isAfterThreshold: !!breach };
                    })
                    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
                shifts: (shifts.length ? shifts : DEFAULT_SHIFTS).map(s => ({
                    ...s,
                    time: s.time || [s.startTime, s.endTime].filter(Boolean).join(' - '),
                    createdAt: toIso(s.createdAt)
                })),
                holidays: holidays.map(h => ({ id: h.id, name: h.name || '', date: h.date || '', type: h.type || '' })),
                weeklyOff
            }
        });
    } catch (error) {
        sendError(res, error, 'Error loading attendance overview');
    }
});

// POST /api/attendance-admin/records - Record or adjust one employee's attendance for a day
router.post('/records', async (req, res) => {
    try {
        const { employeeId, date, punchIn, punchOut, shiftCode, status, adminRemark, tzOffsetMinutes } = req.body || {};
        if (!DATE_RE.test(String(date || ''))) throw badRequest('Enter a valid date.');
        const recordStatus = String(status || 'PRESENT').toUpperCase();
        if (!RECORD_STATUSES.includes(recordStatus)) throw badRequest('Choose a valid attendance status.');
        const inMin = recordStatus === 'ABSENT' ? null : minutesOf(punchIn);
        const outMin = recordStatus === 'ABSENT' ? null : minutesOf(punchOut);
        if (recordStatus !== 'ABSENT' && inMin === null) throw badRequest('Enter a valid punch-in time (HH:MM).');
        if (punchOut && recordStatus !== 'ABSENT' && outMin === null) throw badRequest('Enter a valid punch-out time (HH:MM).');

        const orgId = orgOf(req);
        const emp = await orgEmployee(orgId, employeeId);
        if (!emp) return res.status(404).json({ success: false, message: 'Employee not found in your organization.' });

        const lateMinutes = Math.max(0, Math.min(1440, Number(req.body.lateMinutes) || 0));
        let totalHoursWorked = Number(req.body.totalHoursWorked);
        if (!Number.isFinite(totalHoursWorked) || totalHoursWorked < 0 || totalHoursWorked > 24) totalHoursWorked = 0;
        if (recordStatus === 'ABSENT') totalHoursWorked = 0;

        const now = new Date();
        const recordId = `ATT-${date.replace(/-/g, '')}-${emp.id}`;
        const record = {
            orgId,
            attendanceId: recordId,
            employeeId: emp.id,
            employeeName: emp.name,
            department: emp.department,
            date,
            punchIn: inMin === null ? '--:--' : hhmm(inMin),
            punchOut: outMin === null ? '--:--' : hhmm(outMin),
            shiftCode: String(shiftCode || 'SH_GEN_01').slice(0, 40),
            status: recordStatus,
            isLate: recordStatus === 'LATE' || lateMinutes > 15,
            lateMinutes,
            totalHoursWorked: Math.round(totalHoursWorked * 10) / 10,
            isManualEntry: true,
            recordedBy: actorOf(req),
            adminRemark: String(adminRemark || 'Manual adjustment').slice(0, 500),
            updatedAt: now
        };

        const recordRef = rawCollection('attendance_records').doc(recordId);
        const existing = await recordRef.get();
        if (existing.exists && ownerOrgId(existing.data()) !== orgId) {
            return res.status(404).json({ success: false, message: 'Attendance record not found in your organization.' });
        }

        // Same day in the daily log, so the timeline, sheet and KPIs show the adjustment
        const log = {
            orgId,
            userId: emp.id,
            userName: emp.name,
            department: emp.department,
            date,
            status: LOG_STATUS[recordStatus],
            type: recordStatus === 'ON_DUTY' ? 'On Field' : 'Office',
            punchIn: inMin === null ? null : instantOf(date, inMin, tzOffsetMinutes),
            punchOut: outMin === null ? null : instantOf(date, outMin + (outMin < inMin ? 1440 : 0), tzOffsetMinutes),
            durationHours: record.totalHoursWorked,
            isManualOverride: true,
            regularizedBy: actorOf(req),
            lastUpdated: now
        };

        const batch = db.batch();
        batch.set(recordRef, existing.exists ? record : { ...record, createdAt: now }, { merge: true });
        batch.set(rawCollection('attendance').doc(`${emp.id}_${date}`), log, { merge: true });
        await confirmedWrite(() => batch.commit());
        res.status(200).json({ success: true, firebaseSaved: true, data: { ...record, updatedAt: now.toISOString() } });
    } catch (error) {
        sendError(res, error, 'Error recording attendance');
    }
});

// POST /api/attendance-admin/regularizations - Raise a correction request for an employee
router.post('/regularizations', async (req, res) => {
    try {
        const { employeeId, date, type, correctedTime, correctedPunchOut, reason } = req.body || {};
        if (!DATE_RE.test(String(date || ''))) throw badRequest('Enter a valid date.');
        if (minutesOf(correctedTime) === null) throw badRequest('Enter a valid corrected punch-in time.');
        if (correctedPunchOut && minutesOf(correctedPunchOut) === null) throw badRequest('Enter a valid corrected punch-out time.');
        if (!String(reason || '').trim()) throw badRequest('Enter the reason for the correction.');

        const orgId = orgOf(req);
        const emp = await orgEmployee(orgId, employeeId);
        if (!emp) return res.status(404).json({ success: false, message: 'Employee not found in your organization.' });

        const now = new Date();
        const id = `REG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const ageDays = (now - Date.parse(`${date}T00:00:00Z`)) / 86400000;
        const request = {
            orgId,
            id,
            employeeId: emp.id,
            employeeName: emp.name,
            department: emp.department,
            date,
            type: String(type || 'Missing Punch Regularization').slice(0, 80),
            reason: String(reason).trim().slice(0, 1000),
            correctedTime: hhmm(minutesOf(correctedTime)),
            correctedPunchOut: correctedPunchOut ? hhmm(minutesOf(correctedPunchOut)) : '',
            status: 'Pending',
            isAfterThreshold: ageDays > 2,
            raisedBy: actorOf(req),
            requestedAt: now,
            updatedAt: now,
            history: [{ event: 'Requested', by: actorOf(req), timestamp: now.toISOString(), note: 'Raised by administrator' }]
        };

        const batch = db.batch();
        batch.set(rawCollection('attendance_regularizations').doc(id), request);
        batch.set(rawCollection('notifications').doc(), notification(orgId, emp.id, 'Attendance Regularization',
            `An attendance correction for ${date} (${request.type}) was raised for you and is awaiting approval.`, 'normal'));
        await confirmedWrite(() => batch.commit());
        res.status(201).json({ success: true, firebaseSaved: true, data: { ...request, requestedAt: now.toISOString(), updatedAt: now.toISOString() } });
    } catch (error) {
        sendError(res, error, 'Error raising regularization');
    }
});

// POST /api/attendance-admin/regularizations/:id/decision - Approve or reject a pending request
router.post('/regularizations/:id/decision', async (req, res) => {
    try {
        const { action, comment, tzOffsetMinutes } = req.body || {};
        if (action !== 'approve' && action !== 'reject') throw badRequest('Choose approve or reject.');

        const orgId = orgOf(req);
        const ref = rawCollection('attendance_regularizations').doc(String(req.params.id));
        const snap = await ref.get();
        if (!snap.exists || ownerOrgId(snap.data()) !== orgId) {
            return res.status(404).json({ success: false, message: 'Regularization request not found in your organization.' });
        }
        const reg = snap.data();
        if ((reg.status || 'Pending') !== 'Pending') {
            return res.status(409).json({ success: false, message: `This request was already ${String(reg.status).toLowerCase()}.` });
        }

        const now = new Date();
        const actor = actorOf(req);
        const note = String(comment || '').trim().slice(0, 500);
        const history = [...(reg.history || []), { event: action === 'approve' ? 'Approved' : 'Rejected', by: actor, timestamp: now.toISOString(), note }];
        const batch = db.batch();

        if (action === 'approve') {
            const inMin = minutesOf(reg.correctedTime) ?? 540;
            const outMin = minutesOf(reg.correctedPunchOut);
            const hours = outMin === null ? null : Math.round(((outMin - inMin + (outMin < inMin ? 1440 : 0)) / 60) * 10) / 10;
            batch.set(rawCollection('attendance').doc(`${reg.employeeId}_${reg.date}`), {
                orgId,
                userId: reg.employeeId,
                userName: reg.employeeName || 'Employee',
                department: reg.department || 'General',
                date: reg.date,
                status: 'On-Time',
                punchIn: instantOf(reg.date, inMin, tzOffsetMinutes),
                ...(outMin === null ? {} : { punchOut: instantOf(reg.date, outMin + (outMin < inMin ? 1440 : 0), tzOffsetMinutes), durationHours: hours }),
                regularized: true,
                regularizedAt: now,
                regularizedBy: actor,
                lastUpdated: now
            }, { merge: true });
            batch.update(ref, { status: 'Approved', approverId: actor, approvedAt: now, updatedAt: now, approvalNote: note || 'Approved by administrator', history });
            batch.set(rawCollection('notifications').doc(), notification(orgId, reg.employeeId, 'Regularization Approved',
                `Your attendance regularization for ${reg.date} (${reg.type}) has been approved.`, 'high'));
        } else {
            batch.update(ref, { status: 'Rejected', rejectorId: actor, rejectedAt: now, updatedAt: now, rejectionComment: note || 'Rejected by administrator', history });
            batch.set(rawCollection('notifications').doc(), notification(orgId, reg.employeeId, 'Regularization Rejected',
                `Your attendance regularization for ${reg.date} was rejected: "${note || 'Rejected by administrator'}"`, 'high'));
        }

        await confirmedWrite(() => batch.commit());
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error deciding regularization');
    }
});

// POST /api/attendance-admin/shifts - Add a shift definition
router.post('/shifts', async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
        let { startTime, endTime } = req.body || {};
        // "09:00 - 18:00" typed into a single field
        if (!startTime && req.body && req.body.time) [startTime, endTime] = String(req.body.time).split(/\s*(?:-|–|to)\s*/i);
        const startMin = minutesOf(startTime);
        const endMin = minutesOf(endTime);
        if (!name) throw badRequest('Enter a shift name.');
        if (startMin === null || endMin === null) throw badRequest('Enter the shift timing as HH:MM - HH:MM (e.g. 09:00 - 18:00).');

        const orgId = orgOf(req);
        const now = new Date();
        const ref = rawCollection('shifts').doc();
        const shift = { orgId, name, startTime: hhmm(startMin), endTime: hhmm(endMin), active: true, createdBy: actorOf(req), createdAt: now };
        await confirmedWrite(() => ref.set(shift));
        res.status(201).json({ success: true, firebaseSaved: true, data: { ...shift, id: ref.id, time: `${shift.startTime} - ${shift.endTime}`, createdAt: now.toISOString() } });
    } catch (error) {
        sendError(res, error, 'Error adding shift');
    }
});

// DELETE /api/attendance-admin/shifts/:id - Remove a shift definition
router.delete('/shifts/:id', async (req, res) => {
    try {
        if (String(req.params.id).startsWith('default_')) {
            return res.status(400).json({ success: false, message: 'Built-in shifts cannot be deleted. Add your own shifts to replace them.' });
        }
        const ref = rawCollection('shifts').doc(String(req.params.id));
        const snap = await ref.get();
        if (!snap.exists || ownerOrgId(snap.data()) !== orgOf(req)) {
            return res.status(404).json({ success: false, message: 'Shift not found in your organization.' });
        }
        await confirmedWrite(() => ref.delete());
        res.status(200).json({ success: true, firebaseSaved: true });
    } catch (error) {
        sendError(res, error, 'Error deleting shift');
    }
});

module.exports = router;
