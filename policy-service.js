import { db } from "./firebase-config.js";
import { collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Enterprise Policy Management Service
 * Handles Assignments, Digital Signatures, and Compliance Tracking.
 */

export async function createPolicy(policyData) {
    console.log(`[POLICY] Creating new policy: ${policyData.title}...`);
    try {
        const policyId = `POL-${Date.now()}`;
        const policyRef = doc(db, 'policies', policyId);
        
        const payload = {
            ...policyData,
            policyId,
            version: '1.0',
            status: 'Active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(policyRef, payload);
        
        // Auto-assign if targeting New Joiners
        if (policyData.target === 'New Joiners') {
            await assignToNewJoiners(policyId);
        }

        return { success: true, policyId };
    } catch (err) {
        console.error('[POLICY] Creation failed:', err);
        throw err;
    }
}

export async function acknowledgePolicy(employeeId, policyId, signature) {
    console.log(`[POLICY] Acknowledging ${policyId} by ${employeeId}...`);
    try {
        const ackId = `${employeeId}_${policyId}`;
        const ackRef = doc(db, 'policy_acknowledgements', ackId);
        
        const payload = {
            employeeId,
            policyId,
            signature,
            status: 'Signed',
            ipAddress: '192.168.1.1',
            userAgent: navigator.userAgent,
            signedAt: serverTimestamp()
        };

        await setDoc(ackRef, payload);
        
        // Log to Audit Trail
        await logAudit(employeeId, `Signed Policy: ${policyId}`);
        
        // Notify HR
        await createNotification('admin_hr', `Policy ${policyId} acknowledged by employee ${employeeId}.`, 'normal');
        
        return { success: true };
    } catch (err) {
        console.error('[POLICY] Acknowledgement failed:', err);
        throw err;
    }
}

async function assignToNewJoiners(policyId) {
    // Logic to flag this policy for any future onboarding employees
}

export async function checkComplianceSLA() {
    console.log("[POLICY] Scanning for compliance breaches...");
    const q = query(collection(db, 'policy_acknowledgements'), where('status', '==', 'Pending'));
    const snap = await getDocs(q);
    
    const now = new Date();
    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const assignedAt = data.assignedAt.toDate();
        const diffHours = (now - assignedAt) / (1000 * 60 * 60);
        
        if (diffHours > 72) { // 3 Day SLA
            await escalateBreach(docSnap.id, data);
        }
    }
}

async function escalateBreach(ackId, data) {
    console.warn(`[POLICY] SLA BREACH: ${ackId}`);
    // Simulate system access block for critical policies
    if (data.isCritical) {
        const userRef = doc(db, 'users', data.employeeId);
        await updateDoc(userRef, { systemAccessBlocked: true, blockReason: 'Policy Non-Compliance' });
    }
    
    await createNotification(data.employeeId, `URGENT: Your system access is at risk. Please sign the mandatory policy immediately.`, 'high');
}

async function logAudit(userId, action) {
    await addDoc(collection(db, 'policy_audit_logs'), {
        userId,
        action,
        timestamp: serverTimestamp()
    });
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
