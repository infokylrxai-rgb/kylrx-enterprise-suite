import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, updateDoc, increment, serverTimestamp, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * HRFlow Employee Code Generation & Activation Engine
 */
export async function generateEmployeeCodeAndActivate(employeeId, employeeData) {
    console.log(`[ENGINE] Starting activation for ${employeeId}...`);

    try {
        // 1. Fetch Configuration for the specific dept/type
        const dept = (employeeData.department || 'all').toLowerCase();
        const type = (employeeData.employeeType || 'full-time').toLowerCase();
        const flowId = `flow_all_all`; // For demo, using global. Real app would use flow_${dept}_${type}
        
        const flowSnap = await getDoc(doc(db, 'onboarding_configs', flowId));
        const config = flowSnap.exists() ? flowSnap.data() : { codeFormat: "{TYPE}-{DEPT}-{YEAR}-{SEQ}" };
        
        // 2. Get Next Sequence Number (Atomic increment to prevent duplicates)
        const counterRef = doc(db, 'system_counters', `emp_code_${dept}`);
        await setDoc(counterRef, { lastSeq: increment(1) }, { merge: true });
        const counterSnap = await getDoc(counterRef);
        const seqNum = counterSnap.data().lastSeq;
        
        // 3. Format the Code
        const year = new Date().getFullYear();
        const typeMap = { 'full-time': 'FT', 'contractor': 'CON', 'intern': 'INT', 'consultant': 'CSL' };
        const typeCode = typeMap[type] || 'EMP';
        const deptCode = dept.substring(0,3).toUpperCase();
        const seqFormatted = seqNum.toString().padStart(4, '0');

        const finalCode = config.codeFormat
            .replace('{TYPE}', typeCode)
            .replace('{DEPT}', deptCode)
            .replace('{YEAR}', year)
            .replace('{SEQ}', seqFormatted);

        console.log(`[ENGINE] Generated Code: ${finalCode}`);

        // 4. Create Employee Profile & Activate Dashboard
        const profileRef = doc(db, 'users', employeeId);
        await updateDoc(profileRef, {
            employeeCode: finalCode,
            status: 'Active',
            onboardingCompleted: true,
            activatedAt: serverTimestamp(),
            dashboardEnabled: true
        });

        // 5. Initialize Payroll Profile
        await setDoc(doc(db, 'payroll_profiles', employeeId), {
            employeeCode: finalCode,
            baseSalary: 0, // To be configured by HR
            currency: 'USD',
            status: 'Initialized',
            lastUpdated: serverTimestamp()
        });

        // 6. Audit Logging
        await addDoc(collection(db, 'audit_logs'), {
            action: 'EMPLOYEE_ACTIVATION',
            employeeId: employeeId,
            employeeCode: finalCode,
            performedBy: 'SYSTEM_ENGINE',
            timestamp: serverTimestamp(),
            details: `Onboarding completed. Employee code ${finalCode} generated and profile activated.`
        });

        return finalCode;
    } catch (err) {
        console.error('[ENGINE] Activation failed:', err);
        throw err;
    }
}
