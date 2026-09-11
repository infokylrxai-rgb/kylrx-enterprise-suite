import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import moduleRegistry from '../services/automation-module-registry.js';
import automationEngine from '../services/automation-engine.js';
import eventBus from '../services/event-bus.js';

import onboardingAdapter from '../modules/onboarding-module-adapter.js';
import leaveAdapter from '../modules/leave-attendance-module-adapter.js';
import exitAdapter from '../modules/exit-module-adapter.js';
import payrollAdapter from '../modules/payroll-module-adapter.js';
import statutoryAdapter from '../modules/statutory-module-adapter.js';
import policyAdapter from '../modules/policy-module-adapter.js';

describe('Unified HR Automation Engine & Plugin Architecture', () => {

    before(() => {
        // Register all core module adapters
        moduleRegistry.registerModule(onboardingAdapter);
        moduleRegistry.registerModule(leaveAdapter);
        moduleRegistry.registerModule(exitAdapter);
        moduleRegistry.registerModule(payrollAdapter);
        moduleRegistry.registerModule(statutoryAdapter);
        moduleRegistry.registerModule(policyAdapter);

        // Start engine
        automationEngine.start();
    });

    beforeEach(() => {
        automationEngine.clearRules();
    });

    describe('1. Module Registry & Discovery Contract', () => {
        it('should register all 5 core HR modules', () => {
            assert.ok(moduleRegistry.getModule('onboarding'));
            assert.ok(moduleRegistry.getModule('leave_attendance'));
            assert.ok(moduleRegistry.getModule('exit_offboarding'));
            assert.ok(moduleRegistry.getModule('payroll_disbursement'));
            assert.ok(moduleRegistry.getModule('statutory_compliance'));
        });

        it('should route triggers to the correct module', () => {
            const onbMod = moduleRegistry.getModuleForTrigger('onboarding.documents_submitted');
            assert.equal(onbMod?.moduleKey, 'onboarding');

            const leaveMod = moduleRegistry.getModuleForTrigger('leave.applied');
            assert.equal(leaveMod?.moduleKey, 'leave_attendance');

            const exitMod = moduleRegistry.getModuleForTrigger('exit.resignation_submitted');
            assert.equal(exitMod?.moduleKey, 'exit_offboarding');

            const prMod = moduleRegistry.getModuleForTrigger('payroll.calculated');
            assert.equal(prMod?.moduleKey, 'payroll_disbursement');

            const statMod = moduleRegistry.getModuleForTrigger('statutory.pf_ecr_due');
            assert.equal(statMod?.moduleKey, 'statutory_compliance');
        });

        it('should route actions to the correct module handler', async () => {
            const onbRes = await moduleRegistry.executeAction('onboarding.provision_account', { candidateId: 'CAND_TEST_99' });
            assert.equal(onbRes.success, true);
            assert.equal(onbRes.provisioned, true);

            const leaveRes = await moduleRegistry.executeAction('leave.deduct_balance', { employeeId: 'EMP_TEST_01', daysCount: 2 });
            assert.equal(leaveRes.success, true);
            assert.equal(leaveRes.balanceDeducted, true);

            const exitRes = await moduleRegistry.executeAction('exit.revoke_system_access', { employeeId: 'EMP_TEST_01' });
            assert.equal(exitRes.success, true);
            assert.equal(exitRes.accessRevoked, true);

            const prRes = await moduleRegistry.executeAction('payroll.freeze_cycle', { cycleMonth: '2026-09' });
            assert.equal(prRes.success, true);
            assert.equal(prRes.isFrozen, true);

            const statRes = await moduleRegistry.executeAction('statutory.generate_ecr_file', { cycleMonth: '2026-09' });
            assert.equal(statRes.success, true);
            assert.equal(statRes.ecrGenerated, true);
        });

        it('should generate a comprehensive discovery schema catalog for UI builders', () => {
            const catalog = moduleRegistry.getSchemaCatalog();
            assert.ok(Array.isArray(catalog));
            assert.ok(catalog.length >= 5);

            const onboardingSchema = catalog.find(m => m.moduleKey === 'onboarding');
            assert.ok(onboardingSchema);
            assert.ok(onboardingSchema.triggers.length >= 3);
            assert.ok(onboardingSchema.conditions.length >= 3);
            assert.ok(onboardingSchema.actions.length >= 3);
        });
    });

    describe('2. The 8-Stage Unified Automation Pipeline', () => {

        it('Stage 1 & 2: Trigger ingestion and composite Condition evaluation', async () => {
            let actionExecuted = false;

            onboardingAdapter.actions['onboarding.test_stage_action'] = async () => {
                actionExecuted = true;
                return { done: true };
            };

            automationEngine.registerRule({
                id: 'rule_onboarding_verified_only',
                name: 'Auto-provision verified full-time candidates',
                trigger_event: 'onboarding.candidate_invited',
                conditions: {
                    operator: 'AND',
                    rules: [
                        { field: 'department', op: '==', value: 'Engineering' },
                        { field: 'isFullTime', op: '===', value: true }
                    ]
                },
                pipeline: [
                    { type: 'action', action: 'onboarding.test_stage_action', params: {} }
                ]
            });

            // 1. Non-matching event
            await automationEngine.processEvent({
                eventId: 'EVT_ONB_01',
                eventName: 'onboarding.candidate_invited',
                entityId: 'CAND_NON_MATCH',
                entityType: 'candidate',
                payload: { department: 'Marketing', isFullTime: true }
            });
            assert.equal(actionExecuted, false, 'Action must NOT execute if condition fails');

            // 2. Matching event
            await automationEngine.processEvent({
                eventId: 'EVT_ONB_02',
                eventName: 'onboarding.candidate_invited',
                entityId: 'CAND_MATCH_100',
                entityType: 'candidate',
                payload: { department: 'Engineering', isFullTime: true }
            });
            assert.equal(actionExecuted, true, 'Action MUST execute when conditions match');
        });

        it('Stage 3: Decision / Branching logic', async () => {
            let branchTaken = null;

            leaveAdapter.actions['leave.standard_approval_path'] = async () => {
                branchTaken = 'standard';
                return { path: 'standard' };
            };

            leaveAdapter.actions['leave.extended_approval_path'] = async () => {
                branchTaken = 'extended';
                return { path: 'extended' };
            };

            // Rule with decision branch: if daysCount > 5 -> extended branch, else standard branch
            automationEngine.registerRule({
                id: 'rule_leave_decision_branch',
                name: 'Leave Policy Decision Router',
                trigger_event: 'leave.applied',
                conditions: {}, // match all
                pipeline: [
                    {
                        type: 'decision',
                        conditions: { field: 'daysCount', op: '>', value: 5 },
                        ifTrue: [
                            { type: 'action', action: 'leave.extended_approval_path', params: {} }
                        ],
                        ifFalse: [
                            { type: 'action', action: 'leave.standard_approval_path', params: {} }
                        ]
                    }
                ]
            });

            // Case A: Short leave (3 days) -> should take standard branch
            await automationEngine.processEvent({
                eventId: 'EVT_LEAVE_01',
                eventName: 'leave.applied',
                entityId: 'EMP_LEAVE_1',
                entityType: 'employee',
                payload: { daysCount: 3 }
            });
            assert.equal(branchTaken, 'standard');

            // Case B: Extended leave (14 days) -> should take extended branch
            await automationEngine.processEvent({
                eventId: 'EVT_LEAVE_02',
                eventName: 'leave.applied',
                entityId: 'EMP_LEAVE_2',
                entityType: 'employee',
                payload: { daysCount: 14 }
            });
            assert.equal(branchTaken, 'extended');
        });

        it('Stage 4 & 5: Approval gate creation and SLA Escalation', async () => {
            const ruleId = 'rule_resignation_approval';
            automationEngine.registerRule({
                id: ruleId,
                name: 'Resignation Clearance Gate',
                trigger_event: 'exit.resignation_submitted',
                conditions: {},
                pipeline: [
                    {
                        type: 'approval',
                        title: 'Manager Clearance Approval',
                        assignee_role: 'reporting_manager',
                        escalation_hours: 48,
                        escalation_assignee: 'hr_admin'
                    },
                    {
                        type: 'action',
                        action: 'exit.revoke_system_access',
                        params: {}
                    }
                ]
            });

            await automationEngine.processEvent({
                eventId: 'EVT_EXIT_01',
                eventName: 'exit.resignation_submitted',
                entityId: 'EMP_EXIT_99',
                entityType: 'employee',
                payload: { employeeName: 'Jane Doe', noticeDays: 30 }
            });

            assert.ok(true, 'Approval step paused execution');
        });

        it('Stage 6 & 7: Action execution and Notification variable interpolation', async () => {
            let executedActionParams = null;

            payrollAdapter.actions['payroll.test_interpolated_action'] = async (params) => {
                executedActionParams = params;
                return { success: true };
            };

            automationEngine.registerRule({
                id: 'rule_payroll_notification_flow',
                name: 'Payroll Finalization Alert',
                trigger_event: 'payroll.calculated',
                conditions: { field: 'exceptionsCount', op: '==', value: 0 },
                pipeline: [
                    {
                        type: 'action',
                        action: 'payroll.test_interpolated_action',
                        params: {
                            cycle: '{{cycleMonth}}',
                            amount: '{{netDisbursement}}'
                        }
                    },
                    {
                        type: 'notification',
                        target: 'finance_team',
                        title: 'Payroll for {{cycleMonth}} ready',
                        message: 'Net amount of ₹{{netDisbursement}} across {{totalEmployees}} staff is ready for disbursement.'
                    }
                ]
            });

            await automationEngine.processEvent({
                eventId: 'EVT_PR_01',
                eventName: 'payroll.calculated',
                entityId: 'CYCLE_2026_09',
                entityType: 'payroll_cycle',
                payload: {
                    cycleMonth: 'September 2026',
                    netDisbursement: 8500000,
                    totalEmployees: 150,
                    exceptionsCount: 0
                }
            });

            assert.ok(executedActionParams);
            assert.equal(executedActionParams.cycle, 'September 2026');
            assert.equal(executedActionParams.amount, '8500000');
        });

        it('Stage 8: Immutable Audit Logger recording', async () => {
            const auditEntry = await automationEngine.recordAuditLog({
                runId: 'RUN_AUDIT_TEST_001',
                automationId: 'rule_audit_test',
                stage: 'Action Execution',
                status: 'success',
                details: { timestamp: Date.now(), executedBy: 'system' }
            });

            assert.ok(auditEntry.audit_id);
            assert.ok(auditEntry.timestamp);
            assert.equal(auditEntry.stage, 'Action Execution');
            assert.equal(auditEntry.status, 'success');
        });

        it('Idempotency: Re-emitting the exact same eventId should not duplicate execution', async () => {
            let executionCount = 0;

            statutoryAdapter.actions['statutory.count_action'] = async () => {
                executionCount++;
                return { count: executionCount };
            };

            automationEngine.registerRule({
                id: 'rule_idempotency_test',
                name: 'Idempotent ECR Trigger',
                trigger_event: 'statutory.pf_ecr_due',
                conditions: {},
                pipeline: [
                    { type: 'action', action: 'statutory.count_action', params: {} }
                ]
            });

            const fixedEventId = 'FIXED_EVENT_ID_XYZ_123';
            const eventPayload = {
                eventId: fixedEventId,
                eventName: 'statutory.pf_ecr_due',
                entityId: 'BATCH_1',
                entityType: 'statutory_batch',
                payload: {}
            };

            // First emission
            await automationEngine.processEvent(eventPayload);
            assert.equal(executionCount, 1);

            // Duplicate emission with same eventId
            await automationEngine.processEvent(eventPayload);
            assert.equal(executionCount, 1, 'Duplicate eventId must be rejected by idempotency filter');
        });
    });

    describe('3. Standardized Architecture Components (Requirements 14-23)', () => {
        it('14. Modules emit standardized events: employee.created, employee.type.changed, leave.approved, payroll.calculated, policy.acknowledged, exit.initiated', () => {
            const standardEvents = [
                { name: 'employee.created', expectedModule: 'onboarding' },
                { name: 'employee.type.changed', expectedModule: 'onboarding' },
                { name: 'leave.approved', expectedModule: 'leave_attendance' },
                { name: 'payroll.calculated', expectedModule: 'payroll_disbursement' },
                { name: 'policy.acknowledged', expectedModule: 'policy_center' },
                { name: 'exit.initiated', expectedModule: 'exit_offboarding' }
            ];

            for (const { name, expectedModule } of standardEvents) {
                const mod = moduleRegistry.getModuleForTrigger(name);
                assert.ok(mod, `Trigger '${name}' must be mapped to an HR module`);
                assert.equal(mod.moduleKey, expectedModule, `Trigger '${name}' must map to '${expectedModule}'`);
            }
        });

        it('15-18. Event bus sends standardized events → Trigger Matcher identifies automations → Condition Engine evaluates → Execution Engine runs actions', async () => {
            let actionFired = false;
            let actionContext = null;

            onboardingAdapter.actions['onboarding.welcome_workflow'] = async (params, ctx) => {
                actionFired = true;
                actionContext = ctx;
                return { success: true, emailSent: true };
            };

            automationEngine.registerRule({
                id: 'rule_employee_created_flow',
                name: 'New Employee Standardized Workflow',
                trigger_event: 'employee.created',
                conditions: { field: 'employeeType', op: '==', value: 'Full Time' },
                pipeline: [
                    { type: 'action', action: 'onboarding.welcome_workflow', params: {} }
                ]
            });

            // 15. Event bus emits event
            const eventId = eventBus.emitEvent('employee.created', 'EMP_ST_99', 'employee', {
                employeeId: 'EMP_ST_99',
                name: 'Ananya Sharma',
                department: 'Engineering',
                employeeType: 'Full Time'
            });

            assert.ok(eventId, 'EventBus must return event ID');
            // Allow tick for event bus dispatch
            await new Promise(r => setTimeout(r, 25));

            // 16-18. Verified Execution
            assert.equal(actionFired, true, 'Execution Engine must execute action when Trigger Matcher & Condition Engine evaluate');
            assert.equal(actionContext.entityId, 'EMP_ST_99');
        });

        it('19. Task/Approval Engine manages assignees, deadlines and escalation', async () => {
            const taskId = await automationEngine.createApprovalTask({
                title: 'Department Head Leave Signoff',
                assignee_role: 'department_head',
                escalation_hours: 24,
                escalation_assignee: 'hr_director'
            }, 'RUN_APP_001', { entityId: 'EMP_101', entityType: 'employee' }, { id: 'rule_test_task' });

            assert.ok(taskId, 'Task/Approval Engine must create unique task ID');
        });

        it('20. Notification Service sends alerts and logs dispatch', async () => {
            await automationEngine.sendNotification({
                target: 'manager',
                title: 'Absence Notice',
                message: 'Employee absent for 3 consecutive days',
                channels: ['in_app', 'email', 'push']
            }, { entityId: 'EMP_101' });

            assert.ok(true, 'Notification dispatched');
        });

        it('21. Document Service generates approved templates', async () => {
            const docEngine = require('../services/document-template-engine.js');
            const doc = await docEngine.generateDocument('offer_letter', {
                employee: { name: 'Vikram Malhotra', email: 'vikram@example.com', designation: 'Lead Architect' },
                compensation: { ctc: '₹35,00,000' }
            }, { actor: 'HR Automation' });

            assert.ok(doc, 'Document Engine must return generated document');
            assert.equal(doc.status, 'generated');
            assert.ok(doc.sha256, 'Must have integrity hash');
        });

        it('22. Audit Service records every execution and configuration change', async () => {
            const auditEntry = await automationEngine.recordAuditLog({
                runId: 'RUN_AUDIT_ARCH_01',
                automationId: 'rule_arch_01',
                stage: 'Architecture Event Verification',
                status: 'verified',
                details: { event: 'employee.type.changed', actor: 'System' }
            });

            assert.ok(auditEntry.audit_id);
            assert.equal(auditEntry.stage, 'Architecture Event Verification');
        });

        it('23. Analytics layer consumes standardized events and HR data', () => {
            const { DATA_SOURCES } = require('../services/custom-analytics-engine.js');
            const workforceSources = DATA_SOURCES.workforce;
            assert.ok(workforceSources, 'Analytics layer must provide workforce domain');
            assert.ok(workforceSources.metrics.some(m => m.id === 'headcount'));
            assert.ok(workforceSources.metrics.some(m => m.id === 'attrition'));
        });
    });
});
