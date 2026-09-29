/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ATOMIC SEQUENTIAL EMPLOYEE ID SERVICE
 * ============================================================================
 * 
 * Enforces strict, gapless, contiguous Employee ID generation (e.g. EMP0001, EMP0002)
 * using Firestore distributed counters and atomic transactions.
 * 
 * Guarantees that whether an employee is added manually or uploaded via bulk spreadsheet,
 * the sequence advances without interruption, race conditions, or duplicate IDs.
 * 
 * @version 1.0.0
 * @author Senior Full-Stack Firebase Engineer
 */

/**
 * Allocates sequential, gapless Employee IDs inside an atomic Firestore transaction.
 * 
 * @param {import("firebase/firestore").Firestore} db - Firestore database instance
 * @param {Function} runTransaction - Firestore runTransaction function
 * @param {Function} doc - Firestore doc reference function
 * @param {Function} serverTimestamp - Firestore serverTimestamp function
 * @param {string} orgId - Organization ID (e.g. 'org_kylrx')
 * @param {number} count - Number of IDs to allocate (1 for manual, N for bulk)
 * @param {Object} options - { prefix: 'EMP', padLength: 4 }
 * @returns {Promise<{ assignedIds: string[], startSeq: number, endSeq: number }>}
 */
export async function allocateAtomicEmployeeIds(db, runTransaction, doc, serverTimestamp, orgId, count = 1, options = {}) {
    if (!orgId) throw new Error("Organization ID (orgId) is required for atomic ID allocation.");
    if (count < 1) throw new Error("Allocation count must be at least 1.");

    const prefix = (options.prefix || 'EMP').toUpperCase();
    const padLength = Number(options.padLength || 4); // EMP0001 (4 digits)
    const counterRef = doc(db, 'organizations', orgId, 'counters', 'employees');

    return await runTransaction(db, async (transaction) => {
        const counterSnap = await transaction.get(counterRef);
        let currentSeq = 0;
        let effectivePrefix = prefix;
        let effectivePadLength = padLength;

        if (counterSnap.exists()) {
            const data = counterSnap.data();
            currentSeq = Number(data.currentSequence || 0);
            effectivePrefix = data.prefix || prefix;
            effectivePadLength = Number(data.padLength || padLength);
        }

        const startSeq = currentSeq + 1;
        const endSeq = currentSeq + count;
        const assignedIds = [];

        for (let seq = startSeq; seq <= endSeq; seq++) {
            const formattedId = `${effectivePrefix}${String(seq).padStart(effectivePadLength, '0')}`;
            assignedIds.push(formattedId);
        }

        // Atomically update the counter document inside transaction
        transaction.set(counterRef, {
            currentSequence: endSeq,
            prefix: effectivePrefix,
            padLength: effectivePadLength,
            lastAllocatedRange: { start: startSeq, end: endSeq },
            lastBatchSize: count,
            updatedAt: serverTimestamp()
        }, { merge: true });

        return {
            assignedIds,
            startSeq,
            endSeq,
            count
        };
    });
}
