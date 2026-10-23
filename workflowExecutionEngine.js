/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - RUNTIME WORKFLOW ORCHESTRATION ENGINE
 * ============================================================================
 * 
 * Dynamic multi-step routing, approver entity resolution, anti-cycle self-approval
 * prevention, delegation, immutable audit trail, and SLA tracking & escalation
 * matching PRD Sections 1, 9, 12, 14, & 18.
 * 
 * Target Firestore Collections:
 * - Workflow Definitions: `organizations/{orgId}/workflows/{workflowCode}`
 * - Workflow Execution Runs: `organizations/{orgId}/workflow_instances/{instanceId}`
 * - Pending Approvals Task Queue: `organizations/{orgId}/approval_tasks/{taskId}`
 * 
 * @version 1.0.0
 * @author Principal Workflow & Distributed Systems Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxWorkflowExecutionEngine = factory();
        root.workflowExecutionEngine = root.KylrxWorkflowExecutionEngine;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const WORKFLOW_STATUS = {
        DRAFT: 'DRAFT',
        PENDING: 'PENDING',
        IN_PROGRESS: 'IN_PROGRESS',
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED',
        ESCALATED: 'ESCALATED',
        CANCELLED: 'CANCELLED'
    };

    const STEP_ACTIONS = {
        APPROVE: 'APPROVED',
        REJECT: 'REJECTED',
        DELEGATE: 'DELEGATED',
        ESCALATE: 'AUTO_ESCALATED'
    };

    const APPROVER_TYPES = {
        REPORTING_MANAGER: 'Reporting_Manager',
        SECONDARY_MANAGER: 'Secondary_Manager',
        DEPARTMENT_HEAD: 'Department_Head',
        SPECIFIC_EMPLOYEE: 'Specific_Employee',
        ROLE_BASED: 'Role_Based'
    };

    /**
     * Compute exact SLA Deadline ISO timestamp
     */
    function computeSLADeadline(startTimestamp, slaHours = 24) {
        const start = startTimestamp ? new Date(startTimestamp).getTime() : Date.now();
        const durationMs = Math.max(1, Number(slaHours) || 24) * 3600 * 1000;
        return new Date(start + durationMs).toISOString();
    }

    /**
     * Dynamic Approver Entity Resolution
     * 
     * Resolves the target approver(s) for a given workflow step based on
     * initiator metadata and organizational context directory.
     * 
     * @param {Object} step - Step definition { stepNo, approverType, approverEmployeeId, approverRoleCode, slaHours }
     * @param {Object} initiator - Initiator context { employeeId, reportingManagerId, secondaryManagerId, departmentId, departmentHeadId, businessUnitId, locationId }
     * @param {Object} directory - Optional directory { employees: [], departments: [], roles: [], users: [] }
     * @returns {Object} Resolution result: { approverType, targetId, targetType, targetLabel, candidateIds, isResolved }
     */
    function resolveApproverEntity(step, initiator = {}, directory = {}) {
        const initiatorId = initiator.employeeId || initiator.id || initiator.userId;
        const approverType = step.approverType;

        switch (approverType) {
            case APPROVER_TYPES.REPORTING_MANAGER: {
                const targetId = initiator.reportingManagerId || initiator.Reporting_Manager_ID || initiator.managerId;
                return {
                    approverType,
                    targetType: 'EMPLOYEE',
                    targetId: targetId || null,
                    targetLabel: targetId ? `Reporting Manager (${targetId})` : 'Unassigned Reporting Manager',
                    candidateIds: targetId ? [targetId] : [],
                    isResolved: Boolean(targetId)
                };
            }

            case APPROVER_TYPES.SECONDARY_MANAGER: {
                const targetId = initiator.secondaryManagerId || initiator.Secondary_Manager_ID || initiator.skipManagerId;
                return {
                    approverType,
                    targetType: 'EMPLOYEE',
                    targetId: targetId || null,
                    targetLabel: targetId ? `Secondary Manager (${targetId})` : 'Unassigned Secondary Manager',
                    candidateIds: targetId ? [targetId] : [],
                    isResolved: Boolean(targetId)
                };
            }

            case APPROVER_TYPES.DEPARTMENT_HEAD: {
                let targetId = initiator.departmentHeadId || initiator.departmentHeadEmployeeId || initiator.Department_Head_Employee_ID;
                if (!targetId && initiator.departmentId && directory.departments && Array.isArray(directory.departments)) {
                    const dept = directory.departments.find(d => {
                        const code = d.departmentCode || d.Department_Code || d.id;
                        return String(code).toUpperCase() === String(initiator.departmentId).toUpperCase();
                    });
                    if (dept) {
                        targetId = dept.departmentHeadEmployeeId || dept.headEmployeeId || dept.Owner_Employee_ID || dept.Department_Head_Employee_ID;
                    }
                }
                return {
                    approverType,
                    targetType: 'EMPLOYEE',
                    targetId: targetId || null,
                    targetLabel: targetId ? `Department Head (${targetId})` : 'Department Head',
                    candidateIds: targetId ? [targetId] : [],
                    isResolved: Boolean(targetId)
                };
            }

            case APPROVER_TYPES.SPECIFIC_EMPLOYEE: {
                const targetId = step.approverEmployeeId;
                return {
                    approverType,
                    targetType: 'EMPLOYEE',
                    targetId: targetId || null,
                    targetLabel: targetId ? `Specific Approver (${targetId})` : 'Specific Approver',
                    candidateIds: targetId ? [targetId] : [],
                    isResolved: Boolean(targetId)
                };
            }

            case APPROVER_TYPES.ROLE_BASED: {
                const roleCode = step.approverRoleCode || 'ROLE_HR_EXEC';
                let candidateIds = [];

                if (directory.users && Array.isArray(directory.users)) {
                    candidateIds = directory.users
                        .filter(u => {
                            const uRole = u.roleCode || u.role || u.Role_Code;
                            const matchesRole = String(uRole).toUpperCase() === String(roleCode).toUpperCase();
                            const isActive = u.active !== false && u.isActive !== false;
                            return matchesRole && isActive;
                        })
                        .map(u => u.employeeId || u.userId || u.id);
                }

                if (candidateIds.length === 0 && directory.employees && Array.isArray(directory.employees)) {
                    candidateIds = directory.employees
                        .filter(e => {
                            const eRole = e.roleCode || e.role || e.Role_Code;
                            return String(eRole).toUpperCase() === String(roleCode).toUpperCase();
                        })
                        .map(e => e.employeeId || e.id);
                }

                return {
                    approverType,
                    targetType: 'ROLE',
                    targetRoleCode: roleCode,
                    targetId: roleCode,
                    targetLabel: `Role Pool [${roleCode}]`,
                    candidateIds,
                    isResolved: true
                };
            }

            default:
                return {
                    approverType,
                    targetType: 'UNKNOWN',
                    targetId: null,
                    targetLabel: 'Unknown Approver Type',
                    candidateIds: [],
                    isResolved: false
                };
        }
    }

    /**
     * Anti-Cycle & Self-Approval Prevention Check
     * 
     * If the initiator is identical to the resolved approver:
     * Automatically escalates to:
     * 1. Secondary Manager (if available and different from initiator)
     * 2. Department Head (if available and different from initiator)
     * 3. Super Admin Queue (fallback fail-safe)
     * 
     * @returns {Object} { isSelfApproval: boolean, finalTargetId: string, finalTargetType: string, isEscalated: boolean, reason: string }
     */
    function evaluateAntiCycle(stepResolution, initiator = {}) {
        const initiatorId = String(initiator.employeeId || initiator.id || initiator.userId || '').trim().toUpperCase();
        if (!initiatorId) {
            return {
                isSelfApproval: false,
                isEscalated: false,
                finalTargetId: stepResolution.targetId,
                finalTargetType: stepResolution.targetType,
                candidateIds: stepResolution.candidateIds
            };
        }

        // Check if resolved target matches initiator
        const isSelfMatch = stepResolution.targetType === 'EMPLOYEE' &&
            stepResolution.targetId &&
            String(stepResolution.targetId).trim().toUpperCase() === initiatorId;

        // For Role-based, check if candidate list only contains initiator
        const isSoleRoleCandidate = stepResolution.targetType === 'ROLE' &&
            stepResolution.candidateIds.length === 1 &&
            String(stepResolution.candidateIds[0]).trim().toUpperCase() === initiatorId;

        if (isSelfMatch || isSoleRoleCandidate) {
            // Initiate Anti-Cycle Escalation Ladder
            const secMgr = String(initiator.secondaryManagerId || initiator.Secondary_Manager_ID || '').trim().toUpperCase();
            const deptHead = String(initiator.departmentHeadId || initiator.departmentHeadEmployeeId || '').trim().toUpperCase();

            if (secMgr && secMgr !== initiatorId) {
                return {
                    isSelfApproval: true,
                    isEscalated: true,
                    escalationLevel: 'SECONDARY_MANAGER',
                    finalTargetId: secMgr,
                    finalTargetType: 'EMPLOYEE',
                    candidateIds: [secMgr],
                    reason: `Anti-cycle: Initiator '${initiatorId}' cannot approve own request. Auto-escalated to Secondary Manager (${secMgr}).`
                };
            }

            if (deptHead && deptHead !== initiatorId) {
                return {
                    isSelfApproval: true,
                    isEscalated: true,
                    escalationLevel: 'DEPARTMENT_HEAD',
                    finalTargetId: deptHead,
                    finalTargetType: 'EMPLOYEE',
                    candidateIds: [deptHead],
                    reason: `Anti-cycle: Initiator '${initiatorId}' cannot approve own request. Auto-escalated to Department Head (${deptHead}).`
                };
            }

            // Super Admin fail-safe
            return {
                isSelfApproval: true,
                isEscalated: true,
                escalationLevel: 'SUPER_ADMIN_QUEUE',
                finalTargetId: 'ROLE_SUPER_ADMIN',
                finalTargetType: 'ROLE',
                candidateIds: ['ROLE_SUPER_ADMIN'],
                reason: `Anti-cycle: Initiator '${initiatorId}' cannot approve own request. No higher manager tier found; routed to Super Admin queue.`
            };
        }

        return {
            isSelfApproval: false,
            isEscalated: false,
            finalTargetId: stepResolution.targetId,
            finalTargetType: stepResolution.targetType,
            candidateIds: stepResolution.candidateIds
        };
    }

    /**
     * Check if a specific actor has active delegation rights for the original approver
     */
    function resolveDelegation(originalApproverId, actorId, activeDelegations = []) {
        if (!originalApproverId || !actorId) return null;
        if (String(originalApproverId).toUpperCase() === String(actorId).toUpperCase()) return null;

        const now = new Date();
        const delegation = activeDelegations.find(d => {
            const matchesFrom = String(d.delegatedBy || d.delegatorId || d.fromEmployeeId).toUpperCase() === String(originalApproverId).toUpperCase();
            const matchesTo = String(d.delegatedTo || d.delegateeId || d.toEmployeeId).toUpperCase() === String(actorId).toUpperCase();
            const activeFlag = d.active !== false && d.isActive !== false;

            let withinTime = true;
            if (d.startDate) {
                withinTime = withinTime && (new Date(d.startDate) <= now);
            }
            if (d.endDate) {
                withinTime = withinTime && (new Date(d.endDate) >= now);
            }

            return matchesFrom && matchesTo && activeFlag && withinTime;
        });

        return delegation || null;
    }

    /**
     * SLA Monitor: Evaluate SLA status for an approval task or workflow instance
     * 
     * @param {Object} task - Task or step object containing { slaDeadline, requestTimestamp, slaHours }
     * @param {Date|string|number} currentTime - Current reference time
     * @param {number} warningThresholdHours - Hours before deadline to trigger warning (default 4h)
     * @returns {Object} SLA evaluation status
     */
    function evaluateSLAStatus(task, currentTime = new Date(), warningThresholdHours = 4) {
        if (!task) {
            return { isBreached: false, isWarning: false, hoursRemaining: 0, hoursOverdue: 0 };
        }

        const now = new Date(currentTime).getTime();
        const deadline = task.slaDeadline ? new Date(task.slaDeadline).getTime() : (now + 24 * 3600 * 1000);
        const diffMs = deadline - now;
        const hoursRemaining = diffMs / (3600 * 1000);
        const isBreached = diffMs < 0;
        const hoursOverdue = isBreached ? Math.abs(diffMs) / (3600 * 1000) : 0;

        const slaHours = Number(task.slaHours) || 24;
        const dynamicWarningWindow = Math.min(warningThresholdHours, slaHours * 0.25);
        const isWarning = !isBreached && (hoursRemaining <= dynamicWarningWindow);

        return {
            isBreached,
            isWarning,
            slaDeadline: new Date(deadline).toISOString(),
            hoursRemaining: Number(hoursRemaining.toFixed(2)),
            hoursOverdue: Number(hoursOverdue.toFixed(2)),
            statusBadge: isBreached ? 'BREACHED' : (isWarning ? 'WARNING' : 'ON_TRACK')
        };
    }

    /**
     * Initialize a new execution instance for a workflow definition
     */
    function initiateWorkflowInstance(workflowDoc, initiator, payload = {}, directory = {}) {
        if (!workflowDoc || !Array.isArray(workflowDoc.steps) || workflowDoc.steps.length === 0) {
            throw new Error(`Invalid workflow definition: Missing steps.`);
        }

        const sortedSteps = workflowDoc.steps.slice().sort((a, b) => a.stepNo - b.stepNo);
        const firstStep = sortedSteps[0];
        const nowIso = new Date().toISOString();

        // 1. Resolve Approver Entity
        const rawResolution = resolveApproverEntity(firstStep, initiator, directory);

        // 2. Anti-cycle Self-Approval Prevention
        const antiCycle = evaluateAntiCycle(rawResolution, initiator);

        const currentApproverId = antiCycle.finalTargetId;
        const slaHours = Number(firstStep.slaHours) || 24;
        const slaDeadline = computeSLADeadline(nowIso, slaHours);

        const instanceId = `RUN_${workflowDoc.workflowCode}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const auditTrail = [
            {
                stepNo: 0,
                action: 'INITIATED',
                actorId: initiator.employeeId || initiator.id || initiator.userId,
                actorRole: initiator.roleCode || 'EMPLOYEE',
                timestamp: nowIso,
                comments: `Workflow instance started for transaction '${workflowDoc.transactionType}'.`
            }
        ];

        if (antiCycle.isEscalated) {
            auditTrail.push({
                stepNo: 1,
                action: STEP_ACTIONS.ESCALATE,
                actorId: 'SYSTEM_ANTI_CYCLE',
                originalApproverId: rawResolution.targetId,
                escalatedTo: currentApproverId,
                timestamp: nowIso,
                comments: antiCycle.reason
            });
        }

        return {
            instanceId,
            workflowCode: workflowDoc.workflowCode,
            module: workflowDoc.module,
            transactionType: workflowDoc.transactionType,
            initiatorId: initiator.employeeId || initiator.id || initiator.userId,
            initiatorContext: {
                departmentId: initiator.departmentId,
                businessUnitId: initiator.businessUnitId,
                reportingManagerId: initiator.reportingManagerId,
                secondaryManagerId: initiator.secondaryManagerId
            },
            payload,
            status: WORKFLOW_STATUS.IN_PROGRESS,
            currentStepNo: 1,
            totalSteps: sortedSteps.length,
            currentStepDefinition: {
                ...firstStep,
                assignedApproverId: currentApproverId,
                assignedApproverType: antiCycle.finalTargetType,
                candidateIds: antiCycle.candidateIds,
                isSelfApprovalPrevented: antiCycle.isSelfApproval
            },
            slaHours,
            slaDeadline,
            startedAt: nowIso,
            updatedAt: nowIso,
            completedAt: null,
            auditTrail
        };
    }

    /**
     * Process Step Action (Approve, Reject, Delegate, Escalate)
     * 
     * Transitions workflow to the next step, marks as approved/rejected,
     * checks permissions, records immutable audit trail, and computes next SLA.
     */
    function processStepAction(instance, stepNo, actor, action, comments = '', context = {}) {
        if (!instance) throw new Error('Missing workflow instance.');
        if (instance.status !== WORKFLOW_STATUS.IN_PROGRESS) {
            throw new Error(`Workflow is not in progress (Current Status: ${instance.status}).`);
        }
        if (Number(stepNo) !== Number(instance.currentStepNo)) {
            throw new Error(`Step mismatch: Provided step ${stepNo}, current step is ${instance.currentStepNo}.`);
        }

        const nowIso = new Date().toISOString();
        const actorId = String(actor.employeeId || actor.id || actor.userId || '').trim().toUpperCase();
        const assignedTarget = String(instance.currentStepDefinition.assignedApproverId || '').trim().toUpperCase();
        const isSuperAdmin = actor.isSuperAdmin === true || String(actor.roleCode || '').toUpperCase() === 'ROLE_SUPER_ADMIN';

        // Check if actor is delegated
        const activeDelegations = context.delegations || [];
        const delegation = resolveDelegation(assignedTarget, actorId, activeDelegations);

        // Authorization check: Actor must be assigned approver, delegated proxy, in candidateIds, role match, or Super Admin
        const actorRole = String(actor.roleCode || actor.role || actor.Role_Code || '').trim().toUpperCase();
        const targetRole = String(instance.currentStepDefinition.targetRoleCode || instance.currentStepDefinition.approverRoleCode || assignedTarget).trim().toUpperCase();
        
        let isAuthorized = isSuperAdmin || (actorId === assignedTarget) || Boolean(delegation);
        
        if (!isAuthorized && (instance.currentStepDefinition.assignedApproverType === 'ROLE' || instance.currentStepDefinition.approverType === 'Role_Based')) {
            if (actorRole && actorRole === targetRole) {
                isAuthorized = true;
            }
        }

        if (!isAuthorized && Array.isArray(instance.currentStepDefinition.candidateIds)) {
            isAuthorized = instance.currentStepDefinition.candidateIds.some(cid => String(cid).toUpperCase() === actorId);
        }

        if (!isAuthorized) {
            throw new Error(`Unauthorized: Actor '${actorId}' cannot approve Step ${stepNo} assigned to '${assignedTarget}'.`);
        }

        const normalizedAction = String(action).toUpperCase();

        // 1. Immutable Audit Trail Entry
        const auditEntry = {
            stepNo: Number(stepNo),
            action: normalizedAction,
            actorId,
            originalApproverId: assignedTarget,
            delegatedBy: delegation ? delegation.delegatedBy : null,
            delegatedTo: delegation ? actorId : null,
            isSuperAdminOverride: isSuperAdmin && (actorId !== assignedTarget),
            timestamp: nowIso,
            comments: comments || (normalizedAction === 'APPROVED' ? 'Step approved' : 'Step rejected')
        };
        instance.auditTrail.push(auditEntry);
        instance.updatedAt = nowIso;

        // 2. Action Routing
        if (normalizedAction === 'REJECTED') {
            instance.status = WORKFLOW_STATUS.REJECTED;
            instance.completedAt = nowIso;
            return instance;
        }

        if (normalizedAction === 'APPROVED') {
            const workflowDoc = context.workflowDoc;
            const steps = (workflowDoc && Array.isArray(workflowDoc.steps))
                ? workflowDoc.steps.slice().sort((a, b) => a.stepNo - b.stepNo)
                : null;

            const nextStepNo = Number(stepNo) + 1;
            const nextStepDef = steps ? steps.find(s => s.stepNo === nextStepNo) : null;

            if (!nextStepDef || nextStepNo > instance.totalSteps) {
                // All steps completed!
                instance.status = WORKFLOW_STATUS.APPROVED;
                instance.completedAt = nowIso;
                return instance;
            }

            // Advance to Next Step
            const initiator = {
                employeeId: instance.initiatorId,
                ...instance.initiatorContext
            };

            const rawResolution = resolveApproverEntity(nextStepDef, initiator, context.directory || {});
            const antiCycle = evaluateAntiCycle(rawResolution, initiator);
            const slaDeadline = computeSLADeadline(nowIso, nextStepDef.slaHours);

            instance.currentStepNo = nextStepNo;
            instance.slaHours = Number(nextStepDef.slaHours) || 24;
            instance.slaDeadline = slaDeadline;
            instance.currentStepDefinition = {
                ...nextStepDef,
                assignedApproverId: antiCycle.finalTargetId,
                assignedApproverType: antiCycle.finalTargetType,
                candidateIds: antiCycle.candidateIds,
                isSelfApprovalPrevented: antiCycle.isSelfApproval
            };

            if (antiCycle.isEscalated) {
                instance.auditTrail.push({
                    stepNo: nextStepNo,
                    action: STEP_ACTIONS.ESCALATE,
                    actorId: 'SYSTEM_ANTI_CYCLE',
                    originalApproverId: rawResolution.targetId,
                    escalatedTo: antiCycle.finalTargetId,
                    timestamp: nowIso,
                    comments: antiCycle.reason
                });
            }

            return instance;
        }

        throw new Error(`Unsupported action '${action}'. Allowed: APPROVED, REJECTED.`);
    }

    /**
     * Delegate Step to another employee
     */
    function delegateStep(instance, stepNo, delegator, delegateeId, comments = '') {
        if (!instance) throw new Error('Missing workflow instance.');
        const delegatorId = String(delegator.employeeId || delegator.id || delegator.userId).toUpperCase();
        const currentTarget = String(instance.currentStepDefinition.assignedApproverId).toUpperCase();
        const isSuperAdmin = delegator.isSuperAdmin === true || String(delegator.roleCode || '').toUpperCase() === 'ROLE_SUPER_ADMIN';

        if (!isSuperAdmin && delegatorId !== currentTarget) {
            throw new Error(`Only assigned approver '${currentTarget}' or Super Admin can delegate this step.`);
        }

        const nowIso = new Date().toISOString();
        instance.currentStepDefinition.assignedApproverId = delegateeId;
        instance.currentStepDefinition.candidateIds = [delegateeId];
        instance.updatedAt = nowIso;

        instance.auditTrail.push({
            stepNo: Number(stepNo),
            action: STEP_ACTIONS.DELEGATE,
            actorId: delegatorId,
            originalApproverId: currentTarget,
            delegatedBy: delegatorId,
            delegatedTo: delegateeId,
            timestamp: nowIso,
            comments: comments || `Delegated step authority to ${delegateeId}`
        });

        return instance;
    }

    /**
     * Periodic SLA Scanner and Escalation Dispatcher
     * 
     * Scans active tasks/instances and triggers escalation hooks for breached or warning items.
     */
    function scanAndEscalateSLAs(instances = [], currentTime = new Date(), escalationHook = null) {
        const results = {
            scannedCount: instances.length,
            breachedTasks: [],
            warningTasks: [],
            onTrackTasks: []
        };

        for (const inst of instances) {
            if (inst.status !== WORKFLOW_STATUS.IN_PROGRESS) continue;

            const evaluation = evaluateSLAStatus(inst, currentTime);
            const enriched = {
                instanceId: inst.instanceId,
                workflowCode: inst.workflowCode,
                module: inst.module,
                currentStepNo: inst.currentStepNo,
                assignedApproverId: inst.currentStepDefinition ? inst.currentStepDefinition.assignedApproverId : null,
                ...evaluation
            };

            if (evaluation.isBreached) {
                results.breachedTasks.push(enriched);
                if (typeof escalationHook === 'function') {
                    try {
                        escalationHook({
                            event: 'SLA_BREACHED',
                            task: enriched,
                            instance: inst
                        });
                    } catch (err) {
                        console.error('Escalation hook error:', err);
                    }
                }
            } else if (evaluation.isWarning) {
                results.warningTasks.push(enriched);
                if (typeof escalationHook === 'function') {
                    try {
                        escalationHook({
                            event: 'SLA_WARNING',
                            task: enriched,
                            instance: inst
                        });
                    } catch (err) {
                        console.error('Escalation hook error:', err);
                    }
                }
            } else {
                results.onTrackTasks.push(enriched);
            }
        }

        return results;
    }

    return {
        WORKFLOW_STATUS,
        STEP_ACTIONS,
        APPROVER_TYPES,
        computeSLADeadline,
        resolveApproverEntity,
        evaluateAntiCycle,
        resolveDelegation,
        evaluateSLAStatus,
        initiateWorkflowInstance,
        processStepAction,
        delegateStep,
        scanAndEscalateSLAs
    };
}));
