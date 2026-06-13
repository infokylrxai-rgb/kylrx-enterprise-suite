import { db } from "./firebase-config.js";
import { 
    doc, 
    setDoc, 
    updateDoc, 
    addDoc, 
    getDoc,
    getDocs,
    query,
    where,
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
            currentDepartment: data.currentDepartment || 'General',
            currentDesignation: data.currentDesignation || 'Staff',
            newManagerId: data.newManagerId,
            newManagerName: data.newManagerName,
            newDepartment: data.newDepartment || 'General',
            newDesignation: data.newDesignation || 'Staff',
            currentStage: 'Business Head',
            status: 'Pending',
            approvals: {
                businessHead: { status: 'Pending', actor: data.businessHeadName || 'Business Head' },
                hrManager: { status: 'Pending', actor: data.hrManagerName || 'HR Manager' },
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

            const stages = ['Business Head', 'HR Manager'];
            if (data.currentManagerName && data.currentManagerName !== 'Unassigned') {
                stages.push('Prev. Manager');
            }
            stages.push('New Manager');
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
                
                // Finalize Hierarchy and Department/Designation Update
                await this.finalizeHierarchy(
                    data.employeeId, 
                    data.newManagerId, 
                    data.newManagerName,
                    data.newDepartment,
                    data.newDesignation
                );
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

    async approveAndExecute(requestId, actorId, comment = '') {
        return await runTransaction(db, async (transaction) => {
            const reqRef = doc(db, 'manager_change_requests', requestId);
            const reqSnap = await transaction.get(reqRef);
            
            if (!reqSnap.exists()) throw new Error("Request not found");
            const data = reqSnap.data();

            const approvalUpdate = {
                status: 'Approved',
                completedAt: serverTimestamp()
            };

            await this.finalizeHierarchy(
                data.employeeId, 
                data.newManagerId, 
                data.newManagerName,
                data.newDepartment,
                data.newDesignation
            );

            const historyItem = {
                stage: 'Admin Decision',
                action: 'Approved & Executed',
                actor: actorId,
                timestamp: new Date(),
                comment
            };
            approvalUpdate.history = [...(data.history || []), historyItem];

            transaction.update(reqRef, approvalUpdate);
        });
    }

    async rejectRequest(requestId, actorId, comment = '') {
        const reqRef = doc(db, 'manager_change_requests', requestId);
        const reqSnap = await getDoc(reqRef);
        if (!reqSnap.exists()) throw new Error("Request not found");
        const data = reqSnap.data();

        await updateDoc(reqRef, {
            status: 'Rejected',
            completedAt: serverTimestamp(),
            history: [...(data.history || []), {
                stage: data.currentStage,
                action: 'Rejected',
                actor: actorId,
                timestamp: new Date(),
                comment
            }]
        });
    }

    async finalizeHierarchy(employeeId, nextManagerId, nextManagerName, nextDept = null, nextDesg = null) {
        const empRef = doc(db, 'users', employeeId);
        const empSnap = await getDoc(empRef);
        if (!empSnap.exists()) return;
        const oldData = empSnap.data();

        const updates = {
            reportingManagerId: nextManagerId,
            reportingManager: nextManagerName,
            reportingManagerName: nextManagerName,
            managerHistory: [...(oldData.managerHistory || []), {
                from: oldData.reportingManager || 'Unassigned',
                to: nextManagerName,
                date: new Date()
            }]
        };

        if (nextDept) {
            updates.department = nextDept;
            updates.departmentName = nextDept;
            
            // Query for an existing Command Center of the appropriate type
            const targetType = (oldData.role || 'employee').toLowerCase() === 'manager' ? 'Manager Suite' : 'Employee Portal';
            const ccQuery = query(
                collection(db, 'command_centers'),
                where('name', '==', nextDept),
                where('targetType', '==', targetType)
            );
            const ccSnap = await getDocs(ccQuery);
            
            if (!ccSnap.empty) {
                updates.departmentId = ccSnap.docs[0].id;
            } else {
                // Create a new Command Center config dynamically to guarantee cross-reference integrity
                const prefix = nextDept.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'CC');
                const unitId = `UNIT-${prefix}-${Math.floor(100 + Math.random() * 900)}`;
                const newCC = await addDoc(collection(db, 'command_centers'), {
                    name: nextDept,
                    targetType: targetType,
                    unitId: unitId,
                    icon: 'layers',
                    status: 'Live',
                    createdAt: serverTimestamp(),
                    lastModified: serverTimestamp(),
                    activeUsers: 0,
                    aiInsights: 0,
                    apps: []
                });
                updates.departmentId = newCC.id;
            }

            updates.departmentHistory = [...(oldData.departmentHistory || []), {
                from: oldData.department || oldData.departmentName || 'General',
                to: nextDept,
                date: new Date()
            }];
        }

        if (nextDesg) {
            updates.designation = nextDesg;
            // Preserving system role unless nextDesg matches a system authorization name
            const systemRoles = ['admin', 'manager', 'employee', 'hrms'];
            if (systemRoles.includes(nextDesg.toLowerCase())) {
                updates.role = nextDesg.toLowerCase();
            }
            updates.designationHistory = [...(oldData.designationHistory || []), {
                from: oldData.designation || 'Staff',
                to: nextDesg,
                date: new Date()
            }];
        }

        // Update User Profile in Firestore
        await updateDoc(empRef, updates);
    }
}

export const managerChangeService = new ManagerChangeService();
