import { db } from './firebase-config.js';
import { collection, query, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

export async function getActivePolicies() {
    console.log('[POLICY] Fetching active rollouts...');
    try {
        const q = query(collection(db, 'policies'), orderBy('updatedAt', 'desc'));
        const snap = await getDocs(q);
        const results = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        return results;
    } catch (err) {
        console.error('[POLICY] Error fetching policies:', err);
        return [];
    }
}

export async function getPolicyAuditLogs() {
    console.log('[POLICY] Fetching audit logs...');
    try {
        const q = query(collection(db, 'policy_audit'), orderBy('timestamp', 'desc'), limit(10));
        const snap = await getDocs(q);
        const results = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return results;
    } catch (err) {
        console.error('[POLICY] Error fetching audit logs:', err);
        return [];
    }
}

import { onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

export function listenToAuditLogs(callback) {
    console.log('[POLICY] Starting live audit listener...');
    const q = query(collection(db, 'policy_audit'), orderBy('timestamp', 'desc'), limit(10));
    return onSnapshot(q, (snap) => {
        const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(logs);
    });
}

export async function createPolicy(policyData) {
    console.log('[POLICY] Creating new policy...');
    const policyRef = doc(collection(db, 'policies'));
    await setDoc(policyRef, {
        ...policyData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        signedPercentage: 0
    });
    return policyRef.id;
}

export async function updateAutoAssignConfig(isEnabled) {
    console.log('[POLICY] Updating Auto-Assign config...', isEnabled);
    const configRef = doc(db, 'system_config', 'policy_auto_assign');
    await setDoc(configRef, {
        enabled: isEnabled,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

export async function getAutoAssignConfig() {
    console.log('[POLICY] Fetching Auto-Assign config...');
    try {
        const configRef = doc(db, 'system_config', 'policy_auto_assign');
        const snap = await getDoc(configRef);
        if (snap.exists()) {
            return snap.data().enabled;
        }
        return true; // default
    } catch (err) {
        console.error('[POLICY] Error fetching Auto-Assign config:', err);
        return true;
    }
}

export async function updateSelectiveRouting(selectedDepts) {
    console.log('[POLICY] Updating selective routing...', selectedDepts);
    const configRef = doc(db, 'system_config', 'policy_routing');
    await setDoc(configRef, {
        type: 'Selective',
        departments: selectedDepts,
        updatedAt: serverTimestamp()
    }, { merge: true });
}

export async function createCustomCompliancePlan(planData) {
    console.log('[POLICY] Saving custom compliance plan...', planData);
    const planRef = doc(collection(db, 'compliance_plans'));
    await setDoc(planRef, {
        ...planData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    return planRef.id;
}
export async function getCompliancePulse() {
    console.log('[POLICY] Fetching compliance pulse metrics...');
    try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const totalUsers = usersSnap.size || 1;
        
        const auditSnap = await getDocs(collection(db, 'policy_audit'));
        const signatures = auditSnap.docs.filter(d => d.data().type === 'signature').length;
        const violations = auditSnap.docs.filter(d => d.data().type === 'violation').length;

        // Logic: Overall Compliance = (Signatures / (Signatures + Violations)) or similar
        // For demo/initial connectivity, we'll use a data-driven calculation
        const complianceRate = Math.min(100, Math.round((signatures / (signatures + violations || 1)) * 100));
        
        return {
            overallRate: complianceRate || 0,
            overdueCount: violations,
            blockedCount: Math.ceil(violations / 3)
        };
    } catch (err) {
        console.error('[POLICY] Error fetching compliance pulse:', err);
        return { overallRate: 0, overdueCount: 0, blockedCount: 0 };
    }
}
