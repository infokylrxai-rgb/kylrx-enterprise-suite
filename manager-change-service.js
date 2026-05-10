import { db } from "./firebase-config.js";
import { 
    doc, 
    setDoc, 
    updateDoc, 
    addDoc, 
    collection, 
    serverTimestamp,
    runTransaction 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Manager Hierarchy Governance Service
 * Handles multi-stage BPM approvals and reporting history preservation.
 */
class ManagerChangeService {
    async initiateChange(employeeId, data) {
        const requestData = {
            employeeId,
            employeeName: data.employeeName,
            currentManagerId: data.currentManagerId,
            currentManagerName: data.currentManagerName,
            newManagerId: data.newManagerId,
            newManagerName: data.newManagerName,
            currentStage: 'Business Head',
            status: 'Pending',
            approvals: {
                businessHead: { status: 'Pending', actor: data.businessHeadName },
                hrManager: { status: 'Pending', actor: data.hrManagerName },
                prevManager: { status: 'Pending', actor: data.currentManagerName },
                nextManager: { status: 'Pending', actor: data.newManagerName }
            },
            history: [{
                stage: 'Initiation',
                action: 'Request Created',
                timestamp: new Date(),
                comment: data.reason
            }],
            createdAt: serverTimestamp()
        };

        return await addDoc(collection(db, 'manager_change_requests'), requestData);
    }

    async approveStage(requestId, stage, actorId, comment = '') {
        return await runTransaction(db, async (transaction) => {
            const reqRef = doc(db, 'manager_change_requests', requestId);
            const reqSnap = await transaction.get(reqRef);
            
            if (!reqSnap.exists()) throw new Error("Request not found");
            const data = reqSnap.data();

            const stages = ['Business Head', 'HR Manager', 'Prev. Manager', 'New Manager'];
            const currentIndex = stages.indexOf(data.currentStage);
            
            // Update current stage status
            const updateKey = `approvals.${stage.toLowerCase().replace('. ', '')}.status`;
            const approvalUpdate = {
                [updateKey]: 'Approved',
                [`approvals.${stage.toLowerCase().replace('. ', '')}.timestamp`]: new Date(),
                [`approvals.${stage.toLowerCase().replace('. ', '')}.comment`]: comment
            };

            // Move to next stage or finalize
            if (currentIndex < stages.length - 1) {
                approvalUpdate.currentStage = stages[currentIndex + 1];
            } else {
                approvalUpdate.status = 'Approved';
                approvalUpdate.completedAt = serverTimestamp();
                
                // Finalize Hierarchy Update
                await this.finalizeHierarchy(data.employeeId, data.newManagerId, data.newManagerName);
            }

            // Log History
            const historyItem = {
                stage,
                action: 'Approved',
                actor: actorId,
                timestamp: new Date(),
                comment
            };
            approvalUpdate.history = [...data.history, historyItem];

            transaction.update(reqRef, approvalUpdate);
        });
    }

    async finalizeHierarchy(employeeId, nextManagerId, nextManagerName) {
        const empRef = doc(db, 'users', employeeId);
        const empSnap = await getDoc(empRef);
        const oldData = empSnap.data();

        // Update User Profile
        await updateDoc(empRef, {
            reportingManagerId: nextManagerId,
            reportingManager: nextManagerName,
            managerHistory: [...(oldData.managerHistory || []), {
                from: oldData.reportingManager,
                to: nextManagerName,
                date: new Date()
            }]
        });
    }
}

export const managerChangeService = new ManagerChangeService();
