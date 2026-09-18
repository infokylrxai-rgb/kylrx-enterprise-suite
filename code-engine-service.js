import { 
    db,
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    runTransaction,
    serverTimestamp,
    isQuotaActive
} from "./firebase-config.js";


/**
 * Employee Code Generation Service
 * Handles concurrent-safe sequence management and unique code generation.
 */
class CodeEngineService {
    async generateCode(employeeId, type = 'full-time', department = 'General') {
        const normalizedType = String(type || 'full-time').toLowerCase().trim();
        const cleanDept = department ? department.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() : 'GEN';
        const year = new Date().getFullYear();

        const DEFAULT_CONFIGS = {
            'full-time': { prefix: 'FTE', seqStart: 1050, deptEnabled: true, entity: 'CORP' },
            'intern': { prefix: 'INT', seqStart: 205, deptEnabled: true, entity: 'CORP' },
            'consultant': { prefix: 'CNS', seqStart: 500, deptEnabled: true, entity: 'CORP' },
            'contractor': { prefix: 'CON', seqStart: 8000, deptEnabled: true, entity: 'CORP' },
            'contracting': { prefix: 'CON', seqStart: 8000, deptEnabled: true, entity: 'CORP' }
        };

        // Tier 1: Try Backend Node.js API (Uses Admin SDK - immune to client 429 rate limit)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch('http://localhost:3000/api/hr-os/generate-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeId, type: normalizedType, department: cleanDept }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                if (data && data.newEmpId) {
                    return data.newEmpId;
                }
            }
        } catch (_) {}

        // Tier 2: Try Client-side Firestore Transaction (bypassed if quota limit active)
        if (!isQuotaActive()) {
            try {
                return await runTransaction(db, async (transaction) => {
                // ALL READS FIRST
                const configRef = doc(db, 'system_configs', 'employee_code_engine');
                const configSnap = await transaction.get(configRef);
                const counterKey = `emp_code_${normalizedType.replace(/[^a-z0-9]/g, '_')}`;
                const seqRef = doc(db, 'system_counters', counterKey);
                const seqSnap = await transaction.get(seqRef);
                
                let engineConfig = null;
                if (!configSnap.exists() || !configSnap.data()?.configs) {
                    engineConfig = DEFAULT_CONFIGS[normalizedType] || DEFAULT_CONFIGS['full-time'];
                    transaction.set(configRef, { configs: DEFAULT_CONFIGS }, { merge: true });
                } else {
                    const configs = configSnap.data().configs || {};
                    engineConfig = configs[normalizedType] || DEFAULT_CONFIGS[normalizedType] || configs['full-time'] || DEFAULT_CONFIGS['full-time'];
                }
                
                let currentSeq = seqSnap.exists() && typeof seqSnap.data().current === 'number' 
                    ? seqSnap.data().current 
                    : (engineConfig.seqStart || 1000);
                
                // 3. Construct Code
                const prefix = engineConfig.prefix || 'EMP';
                const deptCode = engineConfig.deptEnabled !== false ? (cleanDept || 'GEN') : '';
                const entity = engineConfig.entity ? `-${engineConfig.entity}` : '';
                const paddedSeq = String(currentSeq).padStart(4, '0');

                let generatedCode = prefix;
                if (deptCode) generatedCode += `-${deptCode}`;
                if (entity) generatedCode += entity;
                generatedCode += `-${year}-${paddedSeq}`;

                // 4. Update Counter for next run
                transaction.set(seqRef, { current: currentSeq + 1, lastAssigned: generatedCode, updatedAt: serverTimestamp() }, { merge: true });

                // 5. Log the Audit Event
                const auditRef = doc(collection(db, 'audit_logs_codes'));
                transaction.set(auditRef, {
                    employeeId: employeeId || 'SYSTEM',
                    generatedCode,
                    type: normalizedType,
                    department: cleanDept,
                    timestamp: serverTimestamp(),
                    operator: 'Lifecycle-Hub'
                });

                return generatedCode;
            });
            } catch (err) {}
        }

        // Tier 3: Resilient Local Sequence Generator (Offline / 429 Quota Exceeded fallback)
        const prefixMap = { 'full-time': 'FTE', 'intern': 'INT', 'consultant': 'CNS', 'contractor': 'CON', 'contracting': 'CON' };
            const prefix = prefixMap[normalizedType] || 'EMP';
            const startSeqMap = { 'full-time': 1050, 'intern': 205, 'consultant': 500, 'contractor': 8000, 'contracting': 8000 };
            
            const storageKey = `fs_seq_${normalizedType.replace(/[^a-z0-9]/g, '_')}`;
            let currentSeq = parseInt(localStorage.getItem(storageKey) || '0', 10);
            if (!currentSeq || isNaN(currentSeq)) {
                currentSeq = startSeqMap[normalizedType] || 1000;
            }

            const paddedSeq = String(currentSeq).padStart(4, '0');
            const generatedCode = `${prefix}-${cleanDept}-CORP-${year}-${paddedSeq}`;

            try {
                localStorage.setItem(storageKey, String(currentSeq + 1));
            } catch (_) {}

            return generatedCode;
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
