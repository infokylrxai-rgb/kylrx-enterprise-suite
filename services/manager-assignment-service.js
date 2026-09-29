/**
 * Kylrx.ai - Manager Assignment & Hierarchy Governance Service (PRD Section 14)
 * Implements manual L1 & L2 manager assignment, cycle prevention algorithm,
 * audit logging, and organizational tree resolution.
 */

class ManagerAssignmentService {
    constructor() {}

    /**
     * Retrieve all downstream subordinates (direct and indirect) for a given employee.
     * Prevents selecting any subordinate as an upstream manager.
     */
    getSubordinates(employeeId, allEmployees = []) {
        if (!employeeId || !Array.isArray(allEmployees)) return [];

        const subordinates = new Set();
        const queue = [employeeId];

        while (queue.length > 0) {
            const currentId = queue.shift();
            for (const emp of allEmployees) {
                const empId = emp.employeeId || emp.id || emp.uid;
                if (!empId || empId === employeeId || subordinates.has(empId)) continue;

                const l1 = emp.reportingManagerId || emp.managers?.l1ManagerId || emp['Reporting_Manager_ID'];
                const l2 = emp.secondaryManagerId || emp.managers?.l2ManagerId || emp['Secondary_Manager_ID'];

                if (l1 === currentId || l2 === currentId) {
                    subordinates.add(empId);
                    queue.push(empId);
                }
            }
        }

        return Array.from(subordinates);
    }

    /**
     * Validate manager assignment and prevent circular reporting relationships.
     * Returns { valid: boolean, error?: string }
     */
    validateAssignment(employeeId, newManagerId, managerLevel = 'L1', allEmployees = []) {
        if (!employeeId) {
            return { valid: false, error: 'Employee ID is required for manager assignment.' };
        }

        // Empty / Unassigned is always valid (allows clearing manager)
        if (!newManagerId || newManagerId === '' || newManagerId === 'NONE' || newManagerId === 'SELF') {
            return { valid: true };
        }

        // 1. Self-Assignment Prohibited
        if (String(employeeId).trim().toLowerCase() === String(newManagerId).trim().toLowerCase()) {
            return {
                valid: false,
                error: `Self-reporting prohibited: An employee cannot be selected as their own ${managerLevel} manager.`
            };
        }

        // 2. Transitive Subordinate / Circular Hierarchy Check
        const subordinateIds = this.getSubordinates(employeeId, allEmployees);
        if (subordinateIds.includes(newManagerId)) {
            const subordinate = allEmployees.find(e => (e.employeeId === newManagerId || e.id === newManagerId || e.uid === newManagerId));
            const subName = subordinate?.fullName || subordinate?.name || newManagerId;
            return {
                valid: false,
                error: `Circular reporting detected: ${subName} (${newManagerId}) is a direct or indirect subordinate of this employee.`
            };
        }

        // 3. Upstream Walk Cycle Check
        let curr = newManagerId;
        const visited = new Set([curr]);
        while (curr) {
            if (curr === employeeId) {
                return {
                    valid: false,
                    error: `Circular chain detected: Managerial reporting path leads back to this employee.`
                };
            }
            const managerObj = allEmployees.find(e => (e.employeeId === curr || e.id === curr || e.uid === curr));
            const nextManager = managerObj?.reportingManagerId || managerObj?.managers?.l1ManagerId || managerObj?.['Reporting_Manager_ID'];
            if (!nextManager || visited.has(nextManager)) break;
            visited.add(nextManager);
            curr = nextManager;
        }

        return { valid: true };
    }

    /**
     * Build audit log item for manager change strictly following PRD Section 14
     */
    createAuditEntry({ level = 'L1', oldManagerId = '', newManagerId = '', changedBy = 'superadmin', timestamp = null }) {
        return {
            level,
            oldManagerId: oldManagerId || 'NONE',
            newManagerId: newManagerId || 'NONE',
            changedBy: changedBy || 'admin',
            changedAt: timestamp || new Date().toISOString()
        };
    }

    /**
     * Prepare atomic Firestore update payload adhering to PRD §14 and 'Employee Details' schema
     */
    prepareAssignmentUpdate(currentEmployee = {}, { l1ManagerId, l2ManagerId, changedBy = 'superadmin' }) {
        const empId = currentEmployee.employeeId || currentEmployee.id || currentEmployee.uid;
        const previousL1 = currentEmployee.reportingManagerId || currentEmployee.managers?.l1ManagerId || currentEmployee['Reporting_Manager_ID'] || '';
        const previousL2 = currentEmployee.secondaryManagerId || currentEmployee.managers?.l2ManagerId || currentEmployee['Secondary_Manager_ID'] || '';

        const newL1 = l1ManagerId !== undefined ? (l1ManagerId || '') : previousL1;
        const newL2 = l2ManagerId !== undefined ? (l2ManagerId || '') : previousL2;

        const history = Array.isArray(currentEmployee.managerAssignmentHistory) 
            ? [...currentEmployee.managerAssignmentHistory] 
            : [];

        const auditEntries = [];

        // Check L1 change
        if (newL1 !== previousL1) {
            const entry = this.createAuditEntry({
                level: 'L1',
                oldManagerId: previousL1,
                newManagerId: newL1,
                changedBy
            });
            history.unshift(entry);
            auditEntries.push({
                employeeId: empId,
                previousManagerId: previousL1,
                newManagerId: newL1,
                assignedBy: changedBy,
                managerLevel: 'L1',
                timestamp: entry.changedAt,
                action: 'MANAGER_ASSIGNMENT_CHANGED'
            });
        }

        // Check L2 change
        if (newL2 !== previousL2) {
            const entry = this.createAuditEntry({
                level: 'L2',
                oldManagerId: previousL2,
                newManagerId: newL2,
                changedBy
            });
            history.unshift(entry);
            auditEntries.push({
                employeeId: empId,
                previousManagerId: previousL2,
                newManagerId: newL2,
                assignedBy: changedBy,
                managerLevel: 'L2',
                timestamp: entry.changedAt,
                action: 'MANAGER_ASSIGNMENT_CHANGED'
            });
        }

        return {
            payload: {
                reportingManagerId: newL1,
                reportingManager: newL1,
                'Reporting_Manager_ID': newL1,
                secondaryManagerId: newL2,
                secondaryManager: newL2,
                'Secondary_Manager_ID': newL2,
                managers: {
                    l1ManagerId: newL1,
                    l2ManagerId: newL2
                },
                managerAssignmentHistory: history,
                updatedAt: new Date().toISOString()
            },
            auditEntries,
            hasChanged: auditEntries.length > 0
        };
    }

    /**
     * Resolve hierarchical organization chart tree
     */
    buildOrgTree(allEmployees = []) {
        if (!Array.isArray(allEmployees)) return [];

        const nodeMap = new Map();
        const roots = [];

        // Initialize nodes
        for (const emp of allEmployees) {
            const id = emp.employeeId || emp.id || emp.uid;
            nodeMap.set(id, {
                id,
                employeeId: id,
                name: emp.fullName || emp.name || id,
                designation: emp.designation || emp.designationCode || emp.jobDetails?.designationCode || 'Staff',
                department: emp.departmentName || emp.department || emp.departmentId || 'General',
                role: emp.role || 'employee',
                l1ManagerId: emp.reportingManagerId || emp.managers?.l1ManagerId || emp['Reporting_Manager_ID'] || '',
                l2ManagerId: emp.secondaryManagerId || emp.managers?.l2ManagerId || emp['Secondary_Manager_ID'] || '',
                directReportsCount: 0,
                children: []
            });
        }

        // Build parent-child relationships
        for (const emp of allEmployees) {
            const id = emp.employeeId || emp.id || emp.uid;
            const node = nodeMap.get(id);
            const parentId = node.l1ManagerId;

            if (parentId && nodeMap.has(parentId) && parentId !== id) {
                const parentNode = nodeMap.get(parentId);
                parentNode.children.push(node);
                parentNode.directReportsCount++;
            } else {
                roots.push(node);
            }
        }

        return roots;
    }
}

const serviceInstance = new ManagerAssignmentService();
serviceInstance.ManagerAssignmentService = ManagerAssignmentService;
module.exports = serviceInstance;
