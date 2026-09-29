import { 
    db, 
    collection, 
    doc, 
    setDoc, 
    updateDoc, 
    serverTimestamp, 
    getDoc, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    deleteDoc, 
    onSnapshot, 
    orderBy 
} from "./firebase-config.js";

/**
 * Attendance Regularization & Workforce Monitoring Service
 * Connects directly to Firebase Firestore for Real-Time Synchronization,
 * SLA Monitoring, Attendance Log Corrections, and Shift Management.
 */

// 1. Submit Regularization Request
export async function submitRegularization(employeeId, data) {
    console.log(`[ATTENDANCE] Submitting regularization for ${employeeId}...`);
    try {
        const requestId = data.id || `REG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const regRef = doc(db, 'attendance_regularizations', requestId);
        
        // Threshold check: Is it older than 2 days?
        const logDate = data.date ? new Date(data.date) : new Date();
        const now = new Date();
        const diffDays = Math.ceil((now - logDate) / (1000 * 60 * 60 * 24));
        const isAfterThreshold = diffDays > 2;
        
        const payload = {
            id: requestId,
            employeeId: employeeId || data.employeeId || 'EMP_UNKNOWN',
            employeeName: data.employeeName || data.userName || 'Employee',
            department: data.department || 'General',
            date: data.date || new Date().toISOString().split('T')[0],
            type: data.type || 'Missing Punch Regularization',
            reason: data.reason || 'Punch regularization submitted',
            correctedTime: data.correctedTime || '09:00 AM',
            correctedPunchOut: data.correctedPunchOut || '06:00 PM',
            shift: data.shift || 'Shift A (General)',
            status: 'Pending',
            isAfterThreshold,
            requestedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            history: [{
                event: 'Requested',
                by: employeeId || 'Employee',
                timestamp: new Date().toISOString(),
                note: data.reason || 'Initial submission'
            }]
        };

        await setDoc(regRef, payload, { merge: true });
        
        // Notify Manager / HR
        const targetManager = data.managerId || 'admin_hr';
        await createNotification(
            targetManager, 
            `New attendance regularization from ${payload.employeeName} for ${payload.date} (${payload.type}).`, 
            isAfterThreshold ? 'urgent' : 'normal',
            'Attendance Regularization'
        );
        
        return { success: true, requestId, data: payload };
    } catch (err) {
        console.error('[ATTENDANCE] Submission failed:', err);
        throw err;
    }
}

// 2. Process Regularization Request (Approve or Reject)
export async function processRegularization(requestId, actorId, action, comment = '') {
    console.log(`[ATTENDANCE] Processing ${action} for request ${requestId}...`);
    try {
        const docRef = doc(db, 'attendance_regularizations', requestId);
        const snap = await getDoc(docRef);
        
        if (!snap.exists()) {
            throw new Error(`Regularization request '${requestId}' not found in Firebase.`);
        }
        const data = snap.data();

        if (action === 'approve') {
            // Synchronize the master attendance record in Firebase
            await syncAttendanceLog(data.employeeId, data.date, data.correctedTime || '09:00 AM', data.type, {
                employeeName: data.employeeName,
                department: data.department,
                punchOutTime: data.correctedPunchOut || '06:00 PM',
                actorId
            });
            
            await updateDoc(docRef, {
                status: 'Approved',
                approverId: actorId || 'admin',
                approvedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                approvalNote: comment || 'Regularization approved by administrator'
            });
            
            await createNotification(
                data.employeeId, 
                `Your attendance regularization for ${data.date} (${data.type}) has been approved.`, 
                'high',
                'Regularization Approved'
            );
        } else {
            await updateDoc(docRef, {
                status: 'Rejected',
                rejectorId: actorId || 'admin',
                rejectionComment: comment || 'Correction request rejected by management',
                rejectedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            
            await createNotification(
                data.employeeId, 
                `Your attendance regularization for ${data.date} was rejected: "${comment || 'Ineligible correction'}"`, 
                'high',
                'Regularization Rejected'
            );
        }

        return { success: true };
    } catch (err) {
        console.error('[ATTENDANCE] Action failed:', err);
        throw err;
    }
}

// 3. Sync primary Attendance collection in Firebase
async function syncAttendanceLog(employeeId, date, correctedInTime, type, meta = {}) {
    console.log(`[ATTENDANCE] Syncing master log for ${employeeId} on ${date}...`);
    const dateStr = date || new Date().toISOString().split('T')[0];
    const docId = `${employeeId}_${dateStr}`;
    const attRef = doc(db, 'attendance', docId);
    
    // Parse times to realistic timestamp representation
    const punchInDate = new Date(`${dateStr}T09:00:00`);
    const punchOutDate = new Date(`${dateStr}T18:00:00`);
    
    const updatePayload = {
        userId: employeeId,
        userName: meta.employeeName || 'Employee',
        department: meta.department || 'General',
        date: dateStr,
        status: 'On-Time',
        punchIn: punchInDate,
        punchOut: punchOutDate,
        durationHours: 9.0,
        type: 'Office',
        regularized: true,
        regularizedAt: serverTimestamp(),
        regularizedBy: meta.actorId || 'admin',
        lastUpdated: serverTimestamp()
    };
    
    // Write to primary 'attendance' collection
    await setDoc(attRef, updatePayload, { merge: true });
    
    // Also write to legacy 'attendance_logs' collection for cross-system compatibility
    try {
        const legacyRef = doc(db, 'attendance_logs', `${employeeId}_${dateStr.replace(/-/g, '')}`);
        await setDoc(legacyRef, {
            ...updatePayload,
            clockIn: correctedInTime,
            clockOut: meta.punchOutTime || '06:00 PM'
        }, { merge: true });
    } catch (_) {}
}

// 4. Notifications creation in Firebase
async function createNotification(target, message, priority = 'normal', title = 'Attendance Hub') {
    try {
        await addDoc(collection(db, 'notifications'), {
            target: target || 'all',
            targetUid: target || 'all',
            userId: target || 'all',
            title,
            text: message,
            message,
            priority,
            read: false,
            timestamp: serverTimestamp(),
            createdAt: new Date().toISOString()
        });
    } catch (e) {
        console.warn('[ATTENDANCE] Failed to create notification:', e);
    }
}

// 5. Real-Time Listener: Pending Regularizations
export function listenToPendingRegularizations(callback) {
    console.log('[ATTENDANCE] Listening to pending regularizations...');
    const q = query(
        collection(db, 'attendance_regularizations'), 
        where('status', '==', 'Pending')
    );
    
    return onSnapshot(q, (snapshot) => {
        const requests = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Calculate dynamic SLA
            let isAfterThreshold = data.isAfterThreshold;
            if (data.requestedAt) {
                const reqDate = data.requestedAt.toDate ? data.requestedAt.toDate() : new Date(data.requestedAt);
                const diffHours = (Date.now() - reqDate.getTime()) / (1000 * 60 * 60);
                if (diffHours > 48) isAfterThreshold = true;
            }
            requests.push({ id: docSnap.id, ...data, isAfterThreshold });
        });
        
        // Sort with SLA breach first, then newer requests
        requests.sort((a, b) => {
            if (a.isAfterThreshold && !b.isAfterThreshold) return -1;
            if (!a.isAfterThreshold && b.isAfterThreshold) return 1;
            return (b.date || '').localeCompare(a.date || '');
        });
        
        callback(requests);
    }, (err) => {
        console.error('[ATTENDANCE] Pending regularizations listener error:', err);
    });
}

// 6. Real-Time Listener: All Regularizations (For View All Modal)
export function listenToAllRegularizations(callback) {
    const q = collection(db, 'attendance_regularizations');
    return onSnapshot(q, (snapshot) => {
        const requests = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            requests.push({ id: docSnap.id, ...data });
        });
        requests.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        callback(requests);
    }, (err) => {
        console.error('[ATTENDANCE] All regularizations listener error:', err);
    });
}

// 7. Real-Time Listener: Master Attendance Logs
export function listenToAttendanceLogs(callback) {
    console.log('[ATTENDANCE] Listening to attendance logs...');
    const q = collection(db, 'attendance');
    
    return onSnapshot(q, (snapshot) => {
        const logs = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            logs.push({ id: docSnap.id, ...data });
        });
        logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        callback(logs);
    }, (err) => {
        console.error('[ATTENDANCE] Attendance logs listener error:', err);
    });
}

// 8. One-time Fetch: All Attendance Logs
export async function getAllAttendanceLogs() {
    console.log('[ATTENDANCE] Fetching all attendance logs...');
    try {
        const q = collection(db, 'attendance');
        const snap = await getDocs(q);
        const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return logs;
    } catch (err) {
        console.error('[ATTENDANCE] Failed to fetch logs:', err);
        return [];
    }
}

// 9. Real-Time Listener: Top Summary KPI Stats
export function listenToAttendanceStats(callback) {
    const todayStr = new Date().toISOString().split('T')[0];
    const q = collection(db, 'attendance');
    
    return onSnapshot(q, (snapshot) => {
        let activeLogin = 0;
        let lateLogin = 0;
        let missingPunch = 0;
        let onFieldWfh = 0;

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Count for today or recent active day
            if (data.date === todayStr || !data.punchOut) {
                if (data.punchIn && !data.punchOut) activeLogin++;
                if (data.status === 'Late') lateLogin++;
                if (data.status === 'Missing' || (!data.punchIn && !data.punchOut)) missingPunch++;
                if (data.type === 'On Field' || data.type === 'WFH') onFieldWfh++;
            }
        });

        callback({ activeLogin, lateLogin, missingPunch, onFieldWfh });
    });
}

// 10. One-time Stats calculation
export async function getAttendanceStats() {
    try {
        const logs = await getAllAttendanceLogs();
        const todayStr = new Date().toISOString().split('T')[0];
        
        let activeLogin = 0;
        let lateLogin = 0;
        let missingPunch = 0;
        let onFieldWfh = 0;

        logs.forEach(data => {
            if (data.date === todayStr || !data.punchOut) {
                if (data.punchIn && !data.punchOut) activeLogin++;
                if (data.status === 'Late') lateLogin++;
                if (data.status === 'Missing' || (!data.punchIn && !data.punchOut)) missingPunch++;
                if (data.type === 'On Field' || data.type === 'WFH') onFieldWfh++;
            }
        });

        return { activeLogin, lateLogin, missingPunch, onFieldWfh };
    } catch (err) {
        console.error('[ATTENDANCE] Stats calculation error:', err);
        return { activeLogin: 0, lateLogin: 0, missingPunch: 0, onFieldWfh: 0 };
    }
}

// 11. Real-Time Listener: Shift Configurations
export function listenToShifts(callback) {
    console.log('[ATTENDANCE] Listening to shifts...');
    const q = collection(db, 'shifts');
    return onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            callback([
                { id: 'default_a', name: 'Shift A (General)', time: '09:00 - 18:00', default: true },
                { id: 'default_b', name: 'Shift B (Evening)', time: '14:00 - 23:00', default: true },
                { id: 'default_c', name: 'Shift C (Night)', time: '22:00 - 06:00', default: true }
            ]);
        } else {
            const shifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(shifts);
        }
    });
}

export async function getShifts() {
    console.log('[ATTENDANCE] Fetching shifts...');
    try {
        const snap = await getDocs(collection(db, 'shifts'));
        if (snap.empty) {
            return [
                { id: 'default_a', name: 'Shift A (General)', time: '09:00 - 18:00' },
                { id: 'default_b', name: 'Shift B (Evening)', time: '14:00 - 23:00' },
                { id: 'default_c', name: 'Shift C (Night)', time: '22:00 - 06:00' }
            ];
        }
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error('[ATTENDANCE] Error fetching shifts:', err);
        return [];
    }
}

export async function addShift(shiftData) {
    console.log('[ATTENDANCE] Adding new shift to Firebase:', shiftData);
    const docRef = await addDoc(collection(db, 'shifts'), {
        ...shiftData,
        createdAt: serverTimestamp()
    });
    return { id: docRef.id, ...shiftData };
}

export async function deleteShift(shiftId) {
    console.log('[ATTENDANCE] Deleting shift from Firebase:', shiftId);
    if (!shiftId.startsWith('default_')) {
        await deleteDoc(doc(db, 'shifts', shiftId));
    }
}

// 12. Auto-Seed Initial Regularizations if collection is empty
export async function seedSampleRegularizationsIfEmpty() {
    try {
        const snap = await getDocs(collection(db, 'attendance_regularizations'));
        if (snap.empty) {
            console.log('[ATTENDANCE] Seeding initial regularization requests into Firebase...');
            const samples = [
                {
                    id: 'REG-SLA-BREACH-01',
                    employeeId: 'EMP_1789230184645',
                    employeeName: 'Marry Doe',
                    department: 'Cybersecurity Employee',
                    date: '2026-09-15',
                    type: 'Late Login Regularization',
                    reason: 'Internet ISP fiber link cut in the sector. Logged in initially through mobile hotspot at 09:42 AM.',
                    correctedTime: '09:00 AM',
                    correctedPunchOut: '06:00 PM',
                    shift: 'Shift A (General)',
                    status: 'Pending',
                    isAfterThreshold: true, // SLA Breach (>48h)
                    requestedAt: new Date(Date.now() - 72 * 60 * 60 * 1000), // 3 days ago
                    updatedAt: new Date(Date.now() - 72 * 60 * 60 * 1000)
                },
                {
                    id: 'REG-PENDING-02',
                    employeeId: 'EMP_1789151730443',
                    employeeName: 'John Doe',
                    department: 'Cybersecurity Manager',
                    date: '2026-09-18',
                    type: 'Missing Punch Regularization',
                    reason: 'Forgot to swipe NFC badge when exiting the server laboratory for client briefing.',
                    correctedTime: '09:15 AM',
                    correctedPunchOut: '06:30 PM',
                    shift: 'Shift A (General)',
                    status: 'Pending',
                    isAfterThreshold: false,
                    requestedAt: new Date(Date.now() - 14 * 60 * 60 * 1000), // 14 hours ago
                    updatedAt: new Date(Date.now() - 14 * 60 * 60 * 1000)
                },
                {
                    id: 'REG-PENDING-03',
                    employeeId: 'w2XWBkvIgkS9xonTqVM5wPNckav2',
                    employeeName: 'jame',
                    department: 'Cybersecurity',
                    date: '2026-09-17',
                    type: 'Short Hours Correction',
                    reason: 'System crash and battery drain during remote deployment. Full 8 hours worked on local terminal.',
                    correctedTime: '09:00 AM',
                    correctedPunchOut: '05:45 PM',
                    shift: 'Shift A (General)',
                    status: 'Pending',
                    isAfterThreshold: false,
                    requestedAt: new Date(Date.now() - 28 * 60 * 60 * 1000),
                    updatedAt: new Date(Date.now() - 28 * 60 * 60 * 1000)
                }
            ];

            for (const s of samples) {
                await setDoc(doc(db, 'attendance_regularizations', s.id), s);
            }
            console.log('[ATTENDANCE] Initial regularizations seeded successfully.');
        }
    } catch (e) {
        console.warn('[ATTENDANCE] Seeding regularizations skipped or errored:', e);
    }
}

// 13. Auto-Seed Default Shifts if empty
export async function seedDefaultShiftsIfEmpty() {
    try {
        const snap = await getDocs(collection(db, 'shifts'));
        if (snap.empty) {
            console.log('[ATTENDANCE] Seeding default shifts into Firebase...');
            const defaultShifts = [
                { name: 'Shift A (General)', time: '09:00 - 18:00' },
                { name: 'Shift B (Evening)', time: '14:00 - 23:00' },
                { name: 'Shift C (Night)', time: '22:00 - 06:00' }
            ];
            for (const s of defaultShifts) {
                await addDoc(collection(db, 'shifts'), { ...s, createdAt: serverTimestamp() });
            }
        }
    } catch (e) {
        console.warn('[ATTENDANCE] Seeding shifts skipped:', e);
    }
}

// 14. Auto-Seed Today Attendance Logs if empty
export async function seedSampleAttendanceIfEmpty() {
    try {
        const snap = await getDocs(collection(db, 'attendance'));
        const todayStr = new Date().toISOString().split('T')[0];
        const hasToday = snap.docs.some(d => d.data().date === todayStr);
        
        if (!hasToday) {
            console.log('[ATTENDANCE] Seeding today attendance records for live demonstration...');
            const records = [
                {
                    userId: 'EMP_1789151730443',
                    userName: 'John Doe',
                    department: 'Cybersecurity Manager',
                    date: todayStr,
                    punchIn: new Date(`${todayStr}T09:02:00`),
                    punchOut: null, // Active
                    status: 'On-Time',
                    type: 'Office',
                    durationHours: 6.2,
                    lastUpdated: serverTimestamp()
                },
                {
                    userId: 'EMP_1789230184645',
                    userName: 'Marry Doe',
                    department: 'Cybersecurity Employee',
                    date: todayStr,
                    punchIn: new Date(`${todayStr}T09:48:00`),
                    punchOut: null,
                    status: 'Late',
                    type: 'Office',
                    durationHours: 5.4,
                    lastUpdated: serverTimestamp()
                },
                {
                    userId: 'w2XWBkvIgkS9xonTqVM5wPNckav2',
                    userName: 'jame',
                    department: 'Cybersecurity',
                    date: todayStr,
                    punchIn: new Date(`${todayStr}T08:55:00`),
                    punchOut: null,
                    status: 'On-Time',
                    type: 'WFH',
                    durationHours: 6.3,
                    lastUpdated: serverTimestamp()
                },
                {
                    userId: 'EMP_1789286607504',
                    userName: 'Savitha',
                    department: 'General (HRMS)',
                    date: todayStr,
                    punchIn: null,
                    punchOut: null,
                    status: 'Missing',
                    type: 'Office',
                    durationHours: 0,
                    lastUpdated: serverTimestamp()
                }
            ];

            for (const r of records) {
                await setDoc(doc(db, 'attendance', `${r.userId}_${todayStr}`), r, { merge: true });
            }
            console.log('[ATTENDANCE] Live attendance records seeded for today.');
        }
    } catch (e) {
        console.warn('[ATTENDANCE] Seeding attendance skipped:', e);
    }
}
