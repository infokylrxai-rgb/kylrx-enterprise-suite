import { db } from "./firebase-config.js";
import { collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, addDoc, limit, orderBy } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Enterprise Performance Management (PMS) Service
 * Handles Tasks, EOD Summaries, Scoring, and Productivity Engine.
 */

export async function submitTask(employeeId, taskData) {
    console.log(`[PMS] Adding task for ${employeeId}: ${taskData.title}...`);
    try {
        const taskId = `TASK-${Date.now()}`;
        const taskRef = doc(db, 'employee_tasks', taskId);
        
        const payload = {
            ...taskData,
            employeeId,
            taskId,
            status: 'Active',
            progress: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(taskRef, payload);
        return { success: true, taskId };
    } catch (err) {
        console.error('[PMS] Task submission failed:', err);
        throw err;
    }
}

export async function submitEOD(employeeId, summary, tasksCompleted) {
    console.log(`[PMS] Submitting EOD for ${employeeId}...`);
    try {
        const eodId = `EOD-${Date.now()}`;
        const eodRef = doc(db, 'employee_eods', eodId);
        
        const payload = {
            employeeId,
            summary,
            tasksCompleted,
            status: 'Pending Review',
            submittedAt: serverTimestamp(),
            managerScore: 0,
            managerComments: ''
        };

        await setDoc(eodRef, payload);
        
        // Notify Reporting Manager
        const userSnap = await getDoc(doc(db, 'users', employeeId));
        const managerId = userSnap.data().reportingManager;
        if (managerId) {
            await createNotification(managerId, `EOD summary submitted by ${userSnap.data().name}. Review pending.`, 'normal');
        }

        return { success: true, eodId };
    } catch (err) {
        console.error('[PMS] EOD submission failed:', err);
        throw err;
    }
}

export async function scorePerformance(eodId, score, comments, adminId) {
    console.log(`[PMS] Scoring EOD ${eodId} with score ${score}...`);
    const eodRef = doc(db, 'employee_eods', eodId);
    
    await updateDoc(eodRef, {
        status: 'Reviewed',
        managerScore: score,
        managerComments: comments,
        scoredBy: adminId,
        scoredAt: serverTimestamp()
    });

    // Update global productivity score for the user
    const eodSnap = await getDoc(eodRef);
    const empId = eodSnap.data().employeeId;
    await updateProductivityEngine(empId, score);
}

async function updateProductivityEngine(employeeId, newScore) {
    const perfRef = doc(db, 'performance_metrics', employeeId);
    const snap = await getDoc(perfRef);
    
    if (snap.exists()) {
        const currentData = snap.data();
        const avgScore = (currentData.overallScore + newScore) / 2; // Simple running average
        await updateDoc(perfRef, {
            overallScore: avgScore,
            lastUpdated: serverTimestamp()
        });
    } else {
        await setDoc(perfRef, {
            employeeId,
            overallScore: newScore,
            lastUpdated: serverTimestamp()
        });
    }
}

export async function getDepartmentLeaderboard(deptId) {
    const q = query(
        collection(db, 'performance_metrics'),
        orderBy('overallScore', 'desc'),
        limit(10)
    );
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
