import { db } from "./firebase-config.js";
import { collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Enterprise Exit Workflow Service
 * Chain: Reporting Manager -> Business Head -> HRBP -> HR Admin
 */

export async function initiateExit(employeeId, data) {
    console.log(`[EXIT] Initiating exit for ${employeeId}...`);
    try {
        const exitId = `EXIT-${Date.now()}`;
        const exitRef = doc(db, 'employee_exits', exitId);
        
        const payload = {
            ...data,
            employeeId,
            status: 'Exit Initiated',
            currentStep: 1, 
            steps: [
                { role: 'Reporting Manager', actor: data.initiator, status: 'Approved', timestamp: new Date().toISOString() },
                { role: 'Business Head', actor: data.businessHead, status: 'Pending', timestamp: null },
                { role: 'HRBP', actor: data.hrbp, status: 'Pending', timestamp: null },
                { role: 'HR Admin', actor: data.hrAdmin, status: 'Pending', timestamp: null }
            ],
            checklist: {
                assetReturn: false,
                ndaSigned: false,
                noDuesFinance: false,
                noDuesIT: false,
                exitInterview: false
            },
            history: [{
                event: 'Exit Initiated',
                by: data.initiatorName,
                reason: data.reason,
                timestamp: new Date().toISOString()
            }],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(exitRef, payload);
        
        // Notify Business Head
        await createNotification(data.businessHead, `Exit request for ${data.employeeName} requires your approval.`, 'high');
        
        return { success: true, exitId };
    } catch (err) {
        console.error('[EXIT] Initiation failed:', err);
        throw err;
    }
}

export async function processExitApproval(exitId, actorId, action, comment = '') {
    console.log(`[EXIT] Processing ${action} for ${exitId}...`);
    try {
        const docRef = doc(db, 'employee_exits', exitId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) throw new Error('Exit record not found');
        
        const data = snap.data();
        const stepIdx = data.currentStep; // currentStep is 1-indexed, but Step 0 is already approved

        if (action === 'approve') {
            data.steps[stepIdx].status = 'Approved';
            data.steps[stepIdx].timestamp = new Date().toISOString();
            
            if (stepIdx < 3) {
                data.currentStep += 1;
                const nextActor = data.steps[data.currentStep].actor;
                await createNotification(nextActor, `Exit workflow for ${data.employeeName} is at your stage.`, 'normal');
            } else {
                data.status = 'Notice Period';
                // Trigger Notice Period calculation
            }
        } else {
            data.status = 'Rejected';
            await createNotification(data.initiator, `Exit request for ${data.employeeName} was rejected.`, 'high');
        }

        await updateDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp()
        });

        return { success: true };
    } catch (err) {
        console.error('[EXIT] Approval failed:', err);
        throw err;
    }
}

export async function scheduleExitInterview(exitId, meetingLink, time) {
    const docRef = doc(db, 'employee_exits', exitId);
    await updateDoc(docRef, {
        meetingLink,
        interviewTime: time,
        'checklist.exitInterview': true,
        status: 'Exit Interview Scheduled',
        updatedAt: serverTimestamp()
    });
}

export async function finalizeExit(exitId, employeeId) {
    console.log(`[EXIT] Finalizing exit and closing profile for ${employeeId}...`);
    const exitRef = doc(db, 'employee_exits', exitId);
    const userRef = doc(db, 'users', employeeId);
    
    await updateDoc(exitRef, { status: 'Closed', updatedAt: serverTimestamp() });
    await updateDoc(userRef, { 
        onboardingStatus: 'Exited', 
        exitDate: serverTimestamp(),
        isActive: false 
    });
    
    // Trigger F&F Settlement in Payroll System
    // (In actual system, call generateFullFinal from payroll-doc-service.js)
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
