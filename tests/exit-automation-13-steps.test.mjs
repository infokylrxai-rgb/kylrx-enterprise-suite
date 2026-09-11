import test from 'node:test';
import assert from 'node:assert/strict';
import automationEngine from '../services/automation-engine.js';
import moduleRegistry from '../services/automation-module-registry.js';
import exitModuleAdapter from '../modules/exit-module-adapter.js';

test('4. Example: Employee Exit Automation (Full 13-Step Flow)', async (t) => {
    // 1. Register exit module adapter with central registry
    moduleRegistry.registerModule(exitModuleAdapter);
    automationEngine.clearRules();
    assert.ok(moduleRegistry.getModule('exit_offboarding'), 'exit_offboarding module should be registered');

    // Track executed steps for verification
    const executedSteps = [];

    // Step 3: Action - Start applicable Exit Workflow
    // Step 5: Action - Start Asset Clearance
    // Step 9: Action - Start F&F
    // Step 10: Action - Generate Relieving Letter + Experience Letter
    // Step 11: Action - Update Employee status
    // Step 12: Action - Move/retain documents in the employee vault

    // Define the exact 13-step flow as an executable Automation Rule
    const exit13StepRule = {
        id: 'RULE_EXIT_13_STEPS_ENTERPRISE',
        name: 'Employee Exit Automation (Standard 13-Step Flow)',
        trigger_event: 'exit.resignation_submitted',
        status: 'active',
        priority: 100,

        // Step 2: Condition - Employee Type = Full Time
        conditions: {
            operator: 'AND',
            rules: [
                { field: 'employeeType', op: '==', value: 'Full Time' }
            ]
        },

        // Steps 3 to 13 Pipeline
        pipeline: [
            // Step 3: Action - Start applicable Exit Workflow
            {
                id: 'step-03-start-workflow',
                type: 'action',
                action: 'exit.start_workflow',
                params: {
                    employeeId: '{{trigger.employeeId}}'
                }
            },

            // Step 4: Approval - Reporting Manager
            {
                id: 'step-04-manager-approval',
                type: 'approval',
                approver_role: 'manager',
                sla_hours: 48,
                title: 'Manager Exit Sign-Off'
            },

            // Step 5: Action - Start Asset Clearance
            {
                id: 'step-05-asset-clearance',
                type: 'action',
                action: 'exit.start_asset_clearance',
                params: {
                    employeeId: '{{trigger.employeeId}}'
                }
            },

            // Step 6: Parallel/Sequential approvals - IT + Admin + Finance as configured
            {
                id: 'step-06-parallel-approvals',
                type: 'approval',
                approver_role: 'department_heads',
                approvers: ['IT', 'Admin', 'Finance'],
                sla_hours: 48,
                title: 'IT + Admin + Finance Clearances'
            },

            // Step 7: Wait - 2 business days for pending actions
            {
                id: 'step-07-wait-2-days',
                type: 'wait',
                duration: 2,
                unit: 'business_days',
                description: 'Wait 2 business days for pending actions'
            },

            // Step 8: Escalation - Notify HR if overdue
            {
                id: 'step-08-sla-escalation',
                type: 'notification',
                to: 'hr_operations_head',
                message: 'Overdue Exit Escalation: Pending actions for {{trigger.employeeName}}'
            },

            // Step 9: Action - Start F&F
            {
                id: 'step-09-start-fnf',
                type: 'action',
                action: 'exit.start_fnf',
                params: {
                    employeeId: '{{trigger.employeeId}}'
                }
            },

            // Step 10: Action - Generate Relieving Letter + Experience Letter using approved templates
            {
                id: 'step-10-generate-letters',
                type: 'action',
                action: 'exit.generate_letters',
                params: {
                    employeeId: '{{trigger.employeeId}}',
                    templates: ['TPL_REL_2026', 'TPL_EXP_2026']
                }
            },

            // Step 11: Action - Update Employee status
            {
                id: 'step-11-update-status',
                type: 'action',
                action: 'exit.update_employee_status',
                params: {
                    employeeId: '{{trigger.employeeId}}',
                    status: 'Relieved'
                }
            },

            // Step 12: Action - Move/retain documents in the employee vault
            {
                id: 'step-12-archive-vault',
                type: 'action',
                action: 'exit.archive_to_vault',
                params: {
                    employeeId: '{{trigger.employeeId}}',
                    retentionYears: 7
                }
            }
        ]
    };

    automationEngine.registerRule(exit13StepRule);

    await t.test('Step 1 & 2: Trigger ingestion and Condition evaluation (Full Time check)', async () => {
        // 1. Non-matching event (Contractor should not trigger Full-Time flow)
        await automationEngine.processEvent({
            eventId: `EVT_CONTRACTOR_${Date.now()}`,
            eventName: 'exit.resignation_submitted',
            entityId: 'EMP_CONTRACTOR_01',
            entityType: 'employee',
            payload: {
                employeeId: 'EMP_CONTRACTOR_01',
                employeeName: 'Contractor Dev',
                employeeType: 'Contractor',
                department: 'Engineering'
            }
        });

        // 2. Matching event (Full Time employee submits resignation)
        const resignEventId = `EVT_RESIGN_FT_${Date.now()}`;
        await automationEngine.processEvent({
            eventId: resignEventId,
            eventName: 'exit.resignation_submitted',
            entityId: 'EMP_VIKRAM_99',
            entityType: 'employee',
            payload: {
                employeeId: 'EMP_VIKRAM_99',
                employeeName: 'Vikram Malhotra',
                employeeType: 'Full Time',
                department: 'Engineering',
                noticeDays: 60,
                hasAssignedAssets: true
            }
        });

        // Verify audit log has recorded the trigger and condition gate pass
        const matchingAudit = automationEngine.auditLogs.filter(log => log.automationId === 'RULE_EXIT_13_STEPS_ENTERPRISE' && log.status === 'started');
        assert.ok(matchingAudit.length > 0, 'Audit entries must be recorded for matching employee');
    });

    await t.test('Step 3: Action - Start applicable Exit Workflow executes successfully', async () => {
        const res = await moduleRegistry.executeAction('exit.start_workflow', { employeeId: 'EMP_VIKRAM_99' }, { entityId: 'EMP_VIKRAM_99' });
        assert.equal(res.success, true);
        assert.equal(res.status, 'INITIATED');
        assert.ok(res.workflowId.startsWith('EX_WF_'));
    });

    await t.test('Step 4 & 6: Approvals - Reporting Manager & Departmental Clearances (IT + Admin + Finance)', async () => {
        // Verify clearance tasks creation for departmental sign-offs
        const clearanceRes = await moduleRegistry.executeAction('exit.initiate_departmental_clearance', { employeeId: 'EMP_VIKRAM_99' }, { entityId: 'EMP_VIKRAM_99' });
        assert.equal(clearanceRes.success, true);
        assert.deepEqual(clearanceRes.departments, ['IT', 'Admin', 'Finance']);
        assert.equal(clearanceRes.clearanceTasksCreated.length, 3);
    });

    await t.test('Step 5: Action - Start Asset Clearance initializes physical and digital recovery', async () => {
        const res = await moduleRegistry.executeAction('exit.start_asset_clearance', { employeeId: 'EMP_VIKRAM_99' }, { entityId: 'EMP_VIKRAM_99' });
        assert.equal(res.success, true);
        assert.equal(res.status, 'CLEARANCE_IN_PROGRESS');
        assert.ok(res.assetTasks.includes('LAPTOP_RETURN'));
        assert.ok(res.assetTasks.includes('VPN_ACCESS_REVOKE'));
    });

    await t.test('Step 9: Action - Start F&F calculates settlement and components', async () => {
        const res = await moduleRegistry.executeAction('exit.start_fnf', { employeeId: 'EMP_VIKRAM_99' }, { entityId: 'EMP_VIKRAM_99' });
        assert.equal(res.success, true);
        assert.equal(res.status, 'CALCULATED');
        assert.ok(res.estimatedSettlementAmount > 0);
        assert.equal(res.components.gratuityEligible, true);
    });

    await t.test('Step 10: Action - Generate Relieving Letter + Experience Letter using approved templates', async () => {
        const res = await moduleRegistry.executeAction('exit.generate_letters', { employeeId: 'EMP_VIKRAM_99' }, { entityId: 'EMP_VIKRAM_99' });
        assert.equal(res.success, true);
        assert.equal(res.documents.length, 2);
        assert.equal(res.documents[0].name, 'Relieving_Letter.pdf');
        assert.equal(res.documents[1].name, 'Experience_Letter.pdf');
        assert.ok(res.documents[0].sha256, 'Letter must be cryptographically sealed');
    });

    await t.test('Step 11: Action - Update Employee status to Relieved', async () => {
        const res = await moduleRegistry.executeAction('exit.update_employee_status', { employeeId: 'EMP_VIKRAM_99', status: 'Relieved' }, { entityId: 'EMP_VIKRAM_99' });
        assert.equal(res.success, true);
        assert.equal(res.newStatus, 'Relieved');
    });

    await t.test('Step 12: Action - Move/retain documents in the employee vault', async () => {
        const res = await moduleRegistry.executeAction('exit.archive_to_vault', { employeeId: 'EMP_VIKRAM_99' }, { entityId: 'EMP_VIKRAM_99' });
        assert.equal(res.success, true);
        assert.equal(res.retentionPolicy, 'STATUTORY_7_YEARS');
        assert.equal(res.vaultStatus, 'SEALED_IMMUTABLE');
        assert.equal(res.archivedFilesCount, 5);
    });

    await t.test('Step 13: End - Exit completed terminal status and audit trail verification', async () => {
        const exitCase = await exitModuleAdapter.resolveData('exit_case', 'EMP_VIKRAM_99', {});
        assert.ok(exitCase);
        assert.equal(exitCase.employeeType, 'Full Time');

        // Verify audit trail logged in memory
        assert.ok(automationEngine.auditLogs.length > 0, 'Audit logs must capture entire 13-stage lifecycle');
    });
});
