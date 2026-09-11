import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const workflowService = require('../services/workflow-builder-service.js');

describe('Feature 14: Testing, Versioning & Audit Workflow Engine Suite', () => {

    beforeEach(() => {
        workflowService.resetDefaultWorkflows();
    });

    test('1. Sample Employee Catalog returns realistic enterprise employee profiles', () => {
        const employees = workflowService.getSampleEmployees();
        assert.ok(Array.isArray(employees), 'Employees must be an array');
        assert.ok(employees.length >= 5, 'Should have at least 5 pre-seeded sample employees');

        const alex = employees.find(e => e.name === 'Alex Mercer');
        assert.ok(alex, 'Alex Mercer must exist in sample catalog');
        assert.equal(alex.department, 'Engineering');
        assert.ok(alex.consecutiveAbsences >= 0, 'Should have consecutiveAbsences field');
        assert.ok(alex.ctc > 0, 'Should have positive CTC');
    });

    test('2. Test Mode dry-run simulation evaluates every node and marks testStatus: passed', () => {
        const workflows = workflowService.listWorkflows();
        assert.ok(workflows.length > 0, 'Should have seeded workflows');
        const testWf = workflows[0];

        const simResult = workflowService.testRunWorkflow(testWf.id, {
            mockData: { name: 'Alex Mercer', department: 'Engineering', ctc: 2400000 },
            actor: 'Sneha Rajput'
        });

        assert.equal(simResult.testStatus, 'passed', 'Test status must be passed');
        assert.ok(Array.isArray(simResult.executionTrace), 'Execution trace must be an array of steps');
        assert.ok(simResult.executionTrace.length > 0, 'Trace must contain evaluated steps');

        // Check every node is detailed in trace
        simResult.executionTrace.forEach(step => {
            assert.ok(step.nodeId, 'Step must have nodeId');
            assert.ok(step.nodeType, 'Step must have nodeType');
            assert.ok(step.outcome, 'Step must have outcome');
            assert.ok(step.details, 'Step must have evaluation details');
        });

        // Verify workflow version is marked tested
        const updated = workflowService.getWorkflowById(testWf.id);
        assert.equal(updated.testStatus, 'passed', 'Workflow testStatus must be persisted as passed');
    });

    test('3. Enforce Draft → Test → Approve/Publish lifecycle (Cannot publish untested workflow)', async () => {
        // Create a new draft workflow
        const draftWf = workflowService.saveWorkflow({
            name: 'Strict Gated Workflow',
            description: 'Must test before publish',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Trigger', x: 50, y: 50, config: { event: 'candidate_offer_accepted', entity: 'candidate' } },
                    { id: 'e1', type: 'end', label: 'End Flow', x: 50, y: 200, config: {} }
                ],
                connections: [{ from: 't1', to: 'e1' }]
            }
        }, null, { actor: 'HR Manager' });

        assert.equal(draftWf.status, 'draft', 'Newly created workflow must be in draft state');

        // Attempting to publish without testing must throw error
        await assert.rejects(
            () => workflowService.publishWorkflowVersion(draftWf.id, 1, { actor: 'HR Director' }),
            /untested/i,
            'Publishing untested workflow must fail with "untested" error'
        );

        // Now run test simulation
        const testSim = workflowService.testRunWorkflow(draftWf.id, {
            mockData: { department: 'Engineering', ctc: 2000000 },
            actor: 'HR Tester'
        });
        assert.equal(testSim.testStatus, 'passed', 'Test must be marked as passed');

        // Now publish should succeed
        const published = await workflowService.publishWorkflowVersion(draftWf.id, 1, { actor: 'HR Director' });
        assert.equal(published.status, 'active', 'After test and publish, workflow must be active');
        assert.equal(published.activeVersionNumber, 1, 'Active version number must be 1');
    });

    test('4. Never overwrite a live active version: Editing active workflow forks new draft version', async () => {
        // 1. Create workflow, test and publish v1
        const wf = workflowService.saveWorkflow({
            name: 'Version Protection Flow',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Trigger v1', x: 10, y: 10, config: { event: 'candidate_offer_accepted', entity: 'candidate' } },
                    { id: 'e1', type: 'end', label: 'End Flow v1', x: 10, y: 150, config: {} }
                ],
                connections: [{ from: 't1', to: 'e1' }]
            }
        }, null, { actor: 'Admin' });

        workflowService.testRunWorkflow(wf.id, { mockData: {}, actor: 'Admin' });
        const publishedV1 = await workflowService.publishWorkflowVersion(wf.id, 1, { actor: 'Admin' });
        assert.equal(publishedV1.status, 'active', 'Workflow must be active after publishing');

        // 2. Edit the now-active workflow — service must fork to v2
        const savedV2 = workflowService.saveWorkflow({
            id: wf.id,
            name: 'Version Protection Flow',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Trigger v2', x: 10, y: 10, config: { event: 'candidate_offer_accepted', entity: 'candidate' } },
                    { id: 'a1', type: 'action', label: 'Action Added', x: 10, y: 100, config: { actionType: 'send_email' } },
                    { id: 'e1', type: 'end', label: 'End Flow v2', x: 10, y: 200, config: {} }
                ],
                connections: [{ from: 't1', to: 'a1' }, { from: 'a1', to: 'e1' }]
            }
        }, null, { actor: 'Lead HR' });

        // 3. Verify v1 is preserved and v2 is a draft fork
        const fetched = workflowService.getWorkflowById(wf.id);
        assert.equal(fetched.versions.length, 2, 'Should now have 2 versions');

        const v1 = fetched.versions.find(v => v.versionNumber === 1);
        const v2 = fetched.versions.find(v => v.versionNumber === 2);

        assert.ok(v1, 'Version 1 must still exist');
        assert.equal(v1.status, 'active', 'v1 must remain active and not overwritten');
        assert.ok(v2, 'Version 2 must have been created');
        assert.equal(v2.status, 'draft', 'v2 must be created in draft mode');
        assert.equal(v2.canvas.nodes.length, 3, 'v2 must have updated nodes (3 nodes)');
        assert.equal(fetched.activeVersionNumber, 1, 'Active version pointer must remain v1');
    });

    test('5. Existing in-flight process runs remain pinned to their original version', async () => {
        // Setup workflow with v1 published
        const wf = workflowService.saveWorkflow({
            name: 'In-Flight Pinned Flow',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Trigger', x: 10, y: 10, config: { event: 'employee_absent', entity: 'employee' } },
                    { id: 'e1', type: 'end', label: 'End Flow v1', x: 10, y: 150, config: {} }
                ],
                connections: [{ from: 't1', to: 'e1' }]
            }
        }, null, { actor: 'Tester' });

        workflowService.testRunWorkflow(wf.id, { mockData: {}, actor: 'Tester' });
        await workflowService.publishWorkflowVersion(wf.id, 1, { actor: 'Publisher' });

        // Fork v2 and publish it
        workflowService.saveWorkflow({
            id: wf.id,
            name: 'In-Flight Pinned Flow',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Trigger', x: 10, y: 10, config: { event: 'employee_absent', entity: 'employee' } },
                    { id: 'n1', type: 'notification', label: 'Notify HR', x: 10, y: 80, config: { recipient: 'hr_manager', channel: 'email' } },
                    { id: 'e1', type: 'end', label: 'End Flow v2', x: 10, y: 160, config: {} }
                ],
                connections: [{ from: 't1', to: 'n1' }, { from: 'n1', to: 'e1' }]
            }
        }, null, { actor: 'Tester' });
        workflowService.testRunWorkflow(wf.id, { mockData: {}, actor: 'Tester' });
        await workflowService.publishWorkflowVersion(wf.id, 2, { actor: 'Publisher' });

        // In-flight process started earlier specifies pinnedVersion: 1
        const inFlightRun = await workflowService.executeWorkflow(wf.id, { daysAbsent: 3 }, { actor: 'Legacy Engine', pinnedVersion: 1 });
        assert.equal(inFlightRun.versionNumber, 1, 'In-flight execution must stay pinned to v1');

        // New process run uses active version (v2)
        const newRun = await workflowService.executeWorkflow(wf.id, { daysAbsent: 3 }, { actor: 'Current Engine' });
        assert.equal(newRun.versionNumber, 2, 'New execution must execute on active v2');
    });

    test('6. Rollback workflow restores previous approved version as live', async () => {
        const wf = workflowService.saveWorkflow({
            name: 'Rollback Flow',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Trigger v1', x: 10, y: 10, config: { event: 'candidate_offer_accepted', entity: 'candidate' } },
                    { id: 'e1', type: 'end', label: 'End v1', x: 10, y: 100, config: {} }
                ],
                connections: [{ from: 't1', to: 'e1' }]
            }
        }, null, { actor: 'Admin' });

        workflowService.testRunWorkflow(wf.id, { mockData: {}, actor: 'Tester' });
        await workflowService.publishWorkflowVersion(wf.id, 1, { actor: 'Publisher' });

        // Fork and publish v2
        workflowService.saveWorkflow({
            id: wf.id,
            name: 'Rollback Flow',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Trigger v2', x: 10, y: 10, config: { event: 'candidate_offer_accepted', entity: 'candidate' } },
                    { id: 'e1', type: 'end', label: 'End v2', x: 10, y: 100, config: {} }
                ],
                connections: [{ from: 't1', to: 'e1' }]
            }
        }, null, { actor: 'Admin' });
        workflowService.testRunWorkflow(wf.id, { mockData: {}, actor: 'Tester' });
        await workflowService.publishWorkflowVersion(wf.id, 2, { actor: 'Publisher' });

        // Execute rollback to v1
        const rolledBack = await workflowService.rollbackWorkflow(wf.id, 1, { actor: 'HR SuperAdmin' });
        assert.equal(rolledBack.activeVersionNumber, 1, 'Active version pointer must be restored to 1');
        assert.equal(rolledBack.status, 'active', 'Rolled back workflow must remain active');

        // Verify audit trail logged ROLLBACK
        const auditTrail = workflowService.listAuditLogs(wf.id);
        const rollbackEntry = auditTrail.find(a => a.action === 'ROLLBACK');
        assert.ok(rollbackEntry, 'Audit log must record ROLLBACK action');
        assert.equal(rollbackEntry.actor, 'HR SuperAdmin', 'Audit must record the rollback actor');
    });

    test('7. Execution logs capture success, failure, retry counts, and error reasons', () => {
        const wf = workflowService.listWorkflows()[0];

        // 1. Success execution log
        const successLog = workflowService.recordExecutionLog({
            workflowId: wf.id,
            version: 1,
            actor: 'System Engine',
            triggeredBy: 'event:candidate_offer_accepted',
            status: 'SUCCESS',
            durationMs: 34,
            stepsExecuted: 4,
            trace: [{ step: 1, outcome: 'SUCCESS' }]
        });
        assert.ok(successLog.runId.startsWith('run_'), 'Run ID must be prefixed with run_');
        assert.equal(successLog.status, 'SUCCESS', 'Status must be SUCCESS');

        // 2. Failed execution with retry count and error reason
        const failLog = workflowService.recordExecutionLog({
            workflowId: wf.id,
            version: 1,
            actor: 'Document Worker',
            triggeredBy: 'event:exit_initiated',
            status: 'FAILED',
            durationMs: 120,
            stepsExecuted: 2,
            retryCount: 3,
            errorReason: 'Signee email server timeout after 3 attempts'
        });
        assert.equal(failLog.status, 'FAILED', 'Failed log must have FAILED status');
        assert.equal(failLog.retryCount, 3, 'Must record retry count of 3');
        assert.equal(failLog.errorReason, 'Signee email server timeout after 3 attempts', 'Must record error reason');

        // Retrieve execution logs list
        const logs = workflowService.listExecutionLogs(wf.id);
        assert.ok(logs.length >= 2, 'Should have at least 2 execution log entries');
        assert.ok(logs.some(l => l.status === 'SUCCESS'), 'Should have a SUCCESS log');
        assert.ok(logs.some(l => l.status === 'FAILED' && l.retryCount === 3), 'Should have a FAILED log with retries');
    });

    test('8. Comprehensive audit trail records user identity, action types, and timestamps', () => {
        const wf = workflowService.listWorkflows()[0];
        const initialAuditCount = workflowService.listAuditLogs(wf.id).length;

        // Perform audited actions
        workflowService.recordAudit({
            workflowId: wf.id,
            workflowName: wf.name,
            versionNumber: 1,
            action: 'EDITED',
            actor: 'Priya Nair',
            details: { summary: 'Modified escalation timer from 24h to 48h' }
        });

        workflowService.recordAudit({
            workflowId: wf.id,
            workflowName: wf.name,
            versionNumber: 1,
            action: 'PAUSED',
            actor: 'Vikram Malhotra',
            details: { summary: 'Temporarily paused workflow for payroll freeze window' }
        });

        const auditList = workflowService.listAuditLogs(wf.id);
        assert.equal(auditList.length, initialAuditCount + 2, 'Audit list must have grown by 2');

        const editEntry = auditList.find(a => a.action === 'EDITED' && a.actor === 'Priya Nair');
        assert.ok(editEntry, 'Audit entry for Priya Nair EDITED must exist');
        assert.ok(editEntry.timestamp, 'Timestamp must be present on audit entry');

        const pauseEntry = auditList.find(a => a.action === 'PAUSED' && a.actor === 'Vikram Malhotra');
        assert.ok(pauseEntry, 'Audit entry for Vikram Malhotra PAUSED must exist');
    });

    test('9. Visual Workflow Builder UI HTML contains required Testing, Versioning, and Audit elements', () => {
        const htmlPath = path.join(rootDir, 'admin-workflow-builder.html');
        assert.ok(fs.existsSync(htmlPath), 'admin-workflow-builder.html must exist');
        const content = fs.readFileSync(htmlPath, 'utf8');

        // Versioning elements
        assert.ok(content.includes('id="version-selector"'), 'Must have version-selector dropdown');
        assert.ok(content.includes('id="btn-rollback-version"'), 'Must have btn-rollback-version');

        // Left-panel tabs for Logs & Audit
        assert.ok(content.includes('id="tab-logs-btn"'), 'Must have tab-logs-btn');
        assert.ok(content.includes('id="tab-audit-btn"'), 'Must have tab-audit-btn');
        assert.ok(content.includes('id="tab-logs-content"'), 'Must have tab-logs-content');
        assert.ok(content.includes('id="tab-audit-content"'), 'Must have tab-audit-content');
        assert.ok(content.includes('id="execution-logs-list"'), 'Must have execution-logs-list');
        assert.ok(content.includes('id="audit-trail-list"'), 'Must have audit-trail-list');

        // Test Mode Modal elements
        assert.ok(content.includes('id="test-mode-modal"'), 'Must have test-mode-modal');
        assert.ok(content.includes('id="test-employee-select"'), 'Must have test-employee-select for selecting employee profiles');
        assert.ok(content.includes('id="test-custom-json"'), 'Must have test-custom-json for custom payload');
        assert.ok(content.includes('id="btn-execute-test-mode"'), 'Must have btn-execute-test-mode');
        assert.ok(content.includes('id="dry-run-nodes-list"'), 'Must have dry-run-nodes-list showing every node that will execute before publishing');
        assert.ok(content.includes('id="btn-publish-from-test"'), 'Must have btn-publish-from-test (Approve & Publish gate)');
    });
});
