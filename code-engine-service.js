import { db } from "./firebase-config.js";
import { 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    runTransaction,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Employee Code Generation Service
 * Handles concurrent-safe sequence management and unique code generation.
 */
class CodeEngineService {
    async generateCode(employeeId, type, department) {
        return await runTransaction(db, async (transaction) => {
            // 1. Get Engine Config
            const configRef = doc(db, 'system_configs', 'employee_code_engine');
            const configSnap = await transaction.get(configRef);
            
            if (!configSnap.exists()) {
                throw new Error("Code engine not configured. Please visit Admin Settings.");
            }

            const engineConfig = configSnap.data().configs[type] || configSnap.data().configs['full-time'];
            
            // 2. Get/Update Sequence Counter
            const seqRef = doc(db, 'system_counters', `emp_code_${type}`);
            const seqSnap = await transaction.get(seqRef);
            
            let currentSeq = seqSnap.exists() ? seqSnap.data().current : (engineConfig.seqStart || 1);
            
            // 3. Construct Code
            const year = new Date().getFullYear();
            const prefix = engineConfig.prefix || 'EMP';
            const deptCode = engineConfig.deptEnabled ? (department ? department.substring(0,3).toUpperCase() : 'GEN') : '';
            const entity = engineConfig.entity ? `-${engineConfig.entity}` : '';
            const paddedSeq = String(currentSeq).padStart(4, '0');

            let generatedCode = prefix;
            if (deptCode) generatedCode += `-${deptCode}`;
            if (entity) generatedCode += entity;
            generatedCode += `-${year}-${paddedSeq}`;

            // 4. Update Counter for next run
            transaction.set(seqRef, { current: currentSeq + 1 }, { merge: true });

            // 5. Log the Audit Event
            const auditRef = doc(collection(db, 'audit_logs_codes'));
            transaction.set(auditRef, {
                employeeId,
                generatedCode,
                type,
                timestamp: serverTimestamp(),
                operator: 'System'
            });

            return generatedCode;
        });
    }

    /**
     * Check if a code is already assigned to prevent any edge-case collisions
     */
    async isDuplicate(code) {
        const q = query(collection(db, "users"), where("employeeId", "==", code));
        const snap = await getDocs(q);
        return !snap.empty;
    }
}

export const codeEngine = new CodeEngineService();
