import { db } from "./firebase-config.js";
import { doc, setDoc, updateDoc, serverTimestamp, collection, addDoc, getDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Manager Change Workflow Service
 * Chain: Business Head -> HR Manager -> Previous Manager -> Upcoming Manager
 */

export async function initiateManagerChange(requestId, data) {
    console.log(`[BPM] Initiating manager change for ${data.employeeName}...`);
    try {
        const workflowRef = doc(db, 'manager_changes', requestId);
        
        const workflowData = {
            ...data,
            status: 'In Progress',
            currentStep: 1, 
            isEscalated: false,
            slaDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 Hour SLA
            steps: [
                { role: 'Business Head', actor: data.businessHead, status: 'Pending', timestamp: null },
                { role: 'HR Manager', actor: data.hrManager, status: 'Pending', timestamp: null },
                { role: 'Previous Manager', actor: data.prevManager, status: 'Pending', timestamp: null },
                { role: 'Upcoming Manager', actor: data.newManager, status: 'Pending', timestamp: null }
            ],
            history: [{
                event: 'Workflow Initiated',
                by: 'System Admin',
                timestamp: new Date().toISOString()
            }],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(workflowRef, workflowData);
        await createNotification(data.businessHead, `URGENT: Transfer request for ${data.employeeName} requires approval.`, 'high');

        return { success: true, requestId };
    } catch (err) {
        console.error('[BPM] Initiation failed:', err);
        throw err;
    }
}

export async function checkEscalations() {
    console.log("[BPM] Scanning for SLA breaches...");
    const q = query(collection(db, 'manager_changes'), where('status', '==', 'In Progress'), where('isEscalated', '==', false));
    const snap = await getDocs(q);
    
    const now = new Date();
    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const deadline = new Date(data.slaDeadline);
        
        if (now > deadline) {
            await escalateWorkflow(docSnap.id, data);
        }
    }
}

async function escalateWorkflow(requestId, data) {
    console.warn(`[BPM] ESCALATING workflow ${requestId} for ${data.employeeName}`);
    const docRef = doc(db, 'manager_changes', requestId);
    
    await updateDoc(docRef, {
        isEscalated: true,
        updatedAt: serverTimestamp(),
        history: [...data.history, {
            event: 'SLA BREACH: Workflow Escalated',
            by: 'System',
            timestamp: new Date().toISOString()
        }]
    });

    // Notify HR Admin
    await createNotification('admin_hr', `CRITICAL: Manager change for ${data.employeeName} has breached SLA.`, 'high');
}

export async function processApprovalStep(requestId, actorId, action, comment = '') {
    console.log(`[BPM] Processing ${action} for ${requestId} by ${actorId}...`);
    try {
        const docRef = doc(db, 'manager_changes', requestId);
        const snap = await getDoc(docRef);
        
        if (!snap.exists()) throw new Error('Request not found');
        
        const data = snap.data();
        const currentStepIdx = data.currentStep - 1;
        
        if (action === 'approve') {
            data.steps[currentStepIdx].status = 'Approved';
            data.steps[currentStepIdx].timestamp = new Date().toISOString();
            data.steps[currentStepIdx].comment = comment;
            
            data.history.push({
                event: `${data.steps[currentStepIdx].role} Approved`,
                by: actorId,
                comment,
                timestamp: new Date().toISOString()
            });

            if (data.currentStep < 4) {
                data.currentStep += 1;
                const nextActor = data.steps[data.currentStep - 1].actor;
                await createNotification(nextActor, `Transfer request for ${data.employeeName} is now at your stage.`, 'normal');
            } else {
                data.status = 'Completed';
                await syncHierarchy(data.employeeId, data.newManagerId);
            }
        } else {
            data.status = 'Rejected';
            data.history.push({
                event: 'Workflow Rejected',
                by: actorId,
                comment,
                timestamp: new Date().toISOString()
            });
            await createNotification(data.initiatorId, `Transfer request for ${data.employeeName} was rejected.`, 'high');
        }

        await updateDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp()
        });

        return { success: true };
    } catch (err) {
        console.error('[BPM] Approval processing failed:', err);
        throw err;
    }
}

async function syncHierarchy(employeeId, newManagerId) {
    console.log(`[BPM] Syncing hierarchy for ${employeeId} -> ${newManagerId}`);
    const userRef = doc(db, 'users', employeeId);
    await updateDoc(userRef, {
        reportingManagerId: newManagerId,
        lastHierarchyUpdate: serverTimestamp()
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
