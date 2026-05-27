import { db } from "./firebase-config.js";
import { collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Attendance Regularization Service
 * Handles Correction Requests, Approvals, and SLA Monitoring.
 */

export async function submitRegularization(employeeId, data) {
    console.log(`[ATTENDANCE] Submitting regularization for ${employeeId}...`);
    try {
        const requestId = `REG-${Date.now()}`;
        const regRef = doc(db, 'attendance_regularizations', requestId);
        
        // Threshold check: Is it within 2 days?
        const logDate = new Date(data.date);
        const now = new Date();
        const diffDays = Math.ceil((now - logDate) / (1000 * 60 * 60 * 24));
        
        const payload = {
            ...data,
            employeeId,
            status: 'Pending',
            isAfterThreshold: diffDays > 2,
            requestedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            history: [{
                event: 'Requested',
                by: employeeId,
                timestamp: new Date().toISOString()
            }]
        };

        await setDoc(regRef, payload);
        
        // Notify Manager
        await createNotification(data.managerId, `Attendance regularization request from ${data.employeeName} for ${data.date}.`, 'normal');
        
        return { success: true, requestId };
    } catch (err) {
        console.error('[ATTENDANCE] Submission failed:', err);
        throw err;
    }
}

export async function processRegularization(requestId, actorId, action, comment = '') {
    console.log(`[ATTENDANCE] Processing ${action} for ${requestId}...`);
    try {
        const docRef = doc(db, 'attendance_regularizations', requestId);
        const snap = await getDoc(docRef);
        
        if (!snap.exists()) throw new Error('Request not found');
        const data = snap.data();

        if (action === 'approve') {
            // Update the primary attendance log
            await syncAttendanceLog(data.employeeId, data.date, data.correctedTime, data.type);
            
            await updateDoc(docRef, {
                status: 'Approved',
                approverId: actorId,
                approvedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            
            await createNotification(data.employeeId, `Your attendance regularization for ${data.date} has been approved.`, 'high');
        } else {
            await updateDoc(docRef, {
                status: 'Rejected',
                rejectionComment: comment,
                updatedAt: serverTimestamp()
            });
            
            await createNotification(data.employeeId, `Your attendance regularization for ${data.date} was rejected.`, 'high');
        }

        return { success: true };
    } catch (err) {
        console.error('[ATTENDANCE] Approval failed:', err);
        throw err;
    }
}

async function syncAttendanceLog(employeeId, date, time, type) {
    console.log(`[ATTENDANCE] Syncing log: ${employeeId} | ${date} | ${time}`);
    // Simulated log sync
    const logId = `${employeeId}_${date.replace(/-/g, '')}`;
    const logRef = doc(db, 'attendance_logs', logId);
    
    await setDoc(logRef, {
        employeeId,
        date,
        [type === 'Punch In' ? 'clockIn' : 'clockOut']: time,
        regularized: true,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

async function createNotification(target, message, priority) {
    await addDoc(collection(db, 'notifications'), {
        target,
        message,
        priority,
        read: false,
        timestamp: serverTimestamp()
    });
}

export async function checkRegularizationSLA() {
    console.log("[ATTENDANCE] Scanning for SLA breaches...");
    const q = query(collection(db, 'attendance_regularizations'), where('status', '==', 'Pending'));
    const snap = await getDocs(q);
    
    const now = new Date();
    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const requestedAt = data.requestedAt.toDate();
        const diffHours = (now - requestedAt) / (1000 * 60 * 60);
        
        if (diffHours > 48 && data.status !== 'Escalated') {
            await updateDoc(doc(db, 'attendance_regularizations', docSnap.id), {
                status: 'Escalated',
                updatedAt: serverTimestamp()
            });
            await createNotification('admin_hr', `CRITICAL: Attendance regularization for ${data.employeeName} has breached 48h SLA.`, 'high');
        }
    }
}

export async function getPendingRegularizations() {
    console.log('[ATTENDANCE] Fetching pending requests...');
    const q = query(collection(db, 'attendance_regularizations'), where('status', '==', 'Pending'));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getAllAttendanceLogs() {
    console.log('[ATTENDANCE] Fetching all logs...');
    const q = query(collection(db, 'attendance'));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getAttendanceStats() {
    console.log('[ATTENDANCE] Fetching accurate stats...');
    const todayStr = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'attendance'), where('date', '==', todayStr));
    const snap = await getDocs(q);
    
    let activeLogin = 0;
    let lateLogin = 0;
    let missingPunch = 0;
    let onFieldWfh = 0;

    snap.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data.punchIn && !data.punchOut) activeLogin++;
        if (data.status === 'Late') lateLogin++;
        if (data.status === 'Missing') missingPunch++;
        if (data.type === 'On Field' || data.type === 'WFH') onFieldWfh++;
    });

    return {
        activeLogin,
        lateLogin,
        missingPunch,
        onFieldWfh
    };
}

export async function getShifts() {
    console.log('[ATTENDANCE] Fetching shifts...');
    const snap = await getDocs(collection(db, 'shifts'));
    if (snap.empty) {
        return [
            { id: 'default_a', name: 'Shift A (General)', time: '09:00 - 18:00' },
            { id: 'default_b', name: 'Shift B (Evening)', time: '14:00 - 23:00' }
        ];
    }
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function addShift(shiftData) {
    console.log('[ATTENDANCE] Adding new shift...');
    const docRef = await addDoc(collection(db, 'shifts'), shiftData);
    return { id: docRef.id, ...shiftData };
}

export async function deleteShift(shiftId) {
    console.log('[ATTENDANCE] Deleting shift...', shiftId);
    if (!shiftId.startsWith('default_')) {
        await deleteDoc(doc(db, 'shifts', shiftId));
    }
}

