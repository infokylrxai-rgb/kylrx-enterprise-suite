import { db } from "./firebase-config.js";
import { doc, setDoc, updateDoc, serverTimestamp, collection, addDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Bank Verification Workflow Service
 */
export async function submitBankDetails(employeeId, details) {
    console.log(`[BANK] Submitting details for ${employeeId}...`);
    try {
        const verificationRef = doc(db, 'bank_verifications', employeeId);
        await setDoc(verificationRef, {
            ...details,
            employeeId,
            status: 'Under Review',
            submittedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });

        // Add to audit log
        await addDoc(collection(db, 'audit_logs'), {
            action: 'BANK_SUBMISSION',
            employeeId,
            performedBy: employeeId,
            timestamp: serverTimestamp(),
            details: 'Bank verification details submitted for review.'
        });

        // Notify Admin (Mock)
        await createNotification('admin', `New bank verification submitted by ${employeeId}`, 'high');
        
        return { success: true };
    } catch (err) {
        console.error('[BANK] Submission failed:', err);
        throw err;
    }
}

export async function processBankApproval(employeeId, action, adminId, reason = '') {
    console.log(`[BANK] Processing ${action} for ${employeeId} by ${adminId}...`);
    try {
        const verificationRef = doc(db, 'bank_verifications', employeeId);
        const status = action === 'approve' ? 'Approved' : 'Rejected';

        await updateDoc(verificationRef, {
            status,
            adminFeedback: reason,
            reviewedBy: adminId,
            reviewedAt: serverTimestamp()
        });

        // Audit Log
        await addDoc(collection(db, 'audit_logs'), {
            action: action === 'approve' ? 'BANK_APPROVAL' : 'BANK_REJECTION',
            employeeId,
            performedBy: adminId,
            timestamp: serverTimestamp(),
            details: action === 'approve' ? 'Bank details approved.' : `Bank details rejected. Reason: ${reason}`
        });

        if (action === 'approve') {
            await syncToPayroll(employeeId);
        }

        // Notify Employee
        await createNotification(employeeId, `Your bank verification was ${status.toLowerCase()}.`, 'normal');

        return { success: true };
    } catch (err) {
        console.error('[BANK] Approval process failed:', err);
        throw err;
    }
}

async function syncToPayroll(employeeId) {
    const verificationSnap = await getDoc(doc(db, 'bank_verifications', employeeId));
    if (verificationSnap.exists()) {
        const details = verificationSnap.data();
        const payrollRef = doc(db, 'payroll_profiles', employeeId);
        await updateDoc(payrollRef, {
            bankName: details.bankName,
            accountNumber: details.accountNum,
            routingCode: details.routingCode,
            bankVerificationStatus: 'Verified',
            lastUpdated: serverTimestamp()
        });
        console.log(`[BANK] Successfully synced to payroll for ${employeeId}`);
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
