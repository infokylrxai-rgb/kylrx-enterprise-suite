import { db } from "./firebase-config.js";
import { collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Enterprise Leave Management Service
 * Handles Accruals, Submissions, Approvals, and SLA Escalations.
 */

export async function submitLeaveRequest(employeeId, leaveData) {
    console.log(`[LEAVE] Submitting request for ${employeeId}...`);
    try {
        const requestId = `LR-${Date.now()}`;
        const leaveRef = doc(db, 'leave_requests', requestId);
        
        const payload = {
            ...leaveData,
            employeeId,
            status: 'Pending',
            requestedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            approvals: [
                { role: 'Reporting Manager', actorId: leaveData.managerId, status: 'Pending', timestamp: null }
            ]
        };

        await setDoc(leaveRef, payload);
        
        // Notify Manager
        await createNotification(leaveData.managerId, `New leave request from ${leaveData.employeeName} requires approval.`, 'normal');
        
        return { success: true, requestId };
    } catch (err) {
        console.error('[LEAVE] Submission failed:', err);
        throw err;
    }
}

export async function processLeaveApproval(requestId, actorId, action, isAdmin = false) {
    console.log(`[LEAVE] Processing ${action} for ${requestId}...`);
    try {
        const docRef = doc(db, 'leave_requests', requestId);
        const snap = await getDoc(docRef);
        
        if (!snap.exists()) throw new Error('Request not found');
        const data = snap.data();

        if (action === 'approve') {
            // Deduct balance
            await deductBalance(data.employeeId, data.type, data.days);
            
            await updateDoc(docRef, {
                status: 'Approved',
                finalApprover: actorId,
                approvedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            
            await createNotification(data.employeeId, `Your leave request for ${data.startDate} has been approved.`, 'high');
        } else {
            await updateDoc(docRef, {
                status: 'Rejected',
                rejectionReason: 'Management decision',
                updatedAt: serverTimestamp()
            });
            
            await createNotification(data.employeeId, `Your leave request for ${data.startDate} was rejected.`, 'high');
        }

        return { success: true };
    } catch (err) {
        console.error('[LEAVE] Approval failed:', err);
        throw err;
    }
}

async function deductBalance(employeeId, leaveType, days) {
    const userRef = doc(db, 'users', employeeId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const balances = userSnap.data().leaveBalances || { Casual: 8, Sick: 6, Earned: 10.5 };
    if (balances[leaveType]) {
        balances[leaveType] -= days;
    } else {
        balances['LOP'] = (balances['LOP'] || 0) + days;
    }

    await updateDoc(userRef, { leaveBalances: balances });
}

export async function runMonthlyAccrual() {
    console.log("[LEAVE] Running monthly accrual engine...");
    // Logic to add 1.75 days to all active employees
    const usersRef = collection(db, 'users');
    const snap = await getDocs(query(usersRef, where('onboardingStatus', '==', 'Active')));
    
    for (const userDoc of snap.docs) {
        const data = userDoc.data();
        const balances = data.leaveBalances || { Casual: 8, Sick: 6, Earned: 10.5 };
        balances.Earned += 1.75; // Corporate standard
        
        await updateDoc(doc(db, 'users', userDoc.id), { leaveBalances: balances });
    }
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
