import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import kylrxHROS from '../services/kylrx-hr-os.js';
import eventBus from '../services/event-bus.js';
import automationEngine from '../services/automation-engine.js';
import moduleRegistry from '../services/automation-module-registry.js';
import workflowBuilderService from '../services/workflow-builder-service.js';
import documentTemplateEngine from '../services/document-template-engine.js';
import notificationActionCenterService from '../services/notification-action-center-service.js';
import centralAssignmentEngine from '../services/central-assignment-engine.js';
import customAnalyticsEngine from '../services/custom-analytics-engine.js';

describe('20. The One-Sentence Requirement: Kylrx AI Configurable HR Operating System Suite', () => {

    test('1. Core Operating System Manifest & 4-Pillar Architecture Definition', () => {
        const manifest = kylrxHROS.getOperatingSystemManifest();

        assert.equal(manifest.system, 'Kylrx AI HR Operating System');
        assert.equal(manifest.motto, 'Configure Once → Automate Everything → Track Everything → Preserve History');
        assert.equal(manifest.status, 'operational');

        // Verify 4 Pillars
        assert.ok(manifest.pillars.configureOnce, 'Configure Once pillar must exist');
        assert.ok(manifest.pillars.automateEverything, 'Automate Everything pillar must exist');
        assert.ok(manifest.pillars.trackEverything, 'Track Everything pillar must exist');
        assert.ok(manifest.pillars.preserveHistory, 'Preserve History pillar must exist');

        // Verify 6 Core Capabilities powered by the single engine
        const expectedCapabilities = ['workflows', 'alerts', 'approvals', 'documents', 'employee_assignments', 'analytics'];
        for (const cap of expectedCapabilities) {
            assert.ok(manifest.capabilities.includes(cap), `Subsystem capability '${cap}' must be powered by the single engine`);
        }

        // Verify module connectivity
        assert.ok(manifest.modules.count >= 6, 'Should register at least 6 HR module adapters');
        assert.ok(manifest.subsystems.documents.templateCount >= 10, 'Document template engine should provide pre-approved enterprise templates');
    });

    test('2. Pillar 1: "Configure Once" - Unified Central Configuration Across Modules', async () => {
        // Multi-dimensional assignment rules configured once
        const profile = {
            id: 'EMP_HROS_001',
            name: 'Priya Sharma',
            employeeType: 'Full-Time',
            department: 'Engineering',
            businessUnit: 'Cloud Platform',
            grade: 'L5',
            location: 'Bangalore'
        };

        const assignment = centralAssignmentEngine.resolveAssignments(profile);
        assert.ok(assignment, 'Central assignment evaluation must resolve packages');
        assert.ok(assignment.assignments, 'Assignments dictionary must be returned');
        assert.ok(assignment.assignments.payrollStructure, 'Payroll structure assigned');
        assert.ok(assignment.assignments.statutoryConfig, 'Statutory config assigned');

        const offerTemplate = documentTemplateEngine.getTemplate('offer_letter');
        assert.ok(offerTemplate, 'Offer letter template configured centrally');
        const activeVer = documentTemplateEngine.resolveActiveTemplate('offer_letter');
        assert.ok(activeVer.fieldMappings.some(f => f.token === '{{candidate.name}}'), 'Template contains candidate.name token mapping');

        // Workflow builder node types configured once
        const nodeTypes = workflowBuilderService.getNodeTypes();
        assert.equal(Object.keys(nodeTypes).length, 11, 'All 11 visual node types must be available uniformly');
    });

    test('3. Pillar 2: "Automate Everything" - Single Reusable Event-Driven Engine across All Modules', async () => {
        const receivedEvents = [];
        const testHandler = (ev) => receivedEvents.push(ev);
        eventBus.on('leave.approved', testHandler);

        // Dispatch HR event through HROS
        const result = await kylrxHROS.dispatchHREvent('leave.approved', {
            leaveId: 'LV_999',
            employeeId: 'EMP_HROS_001',
            leaveType: 'Privilege Leave',
            days: 2
        }, {
            actor: 'Manager John',
            sourceModule: 'leave_attendance'
        });

        assert.equal(result.dispatched, true);
        assert.ok(result.eventId.startsWith('ev_hros_'));
        assert.ok(receivedEvents.length >= 1, 'EventBus must broadcast event to subscribers');
        assert.equal(receivedEvents[0].eventName, 'leave.approved');

        eventBus.removeListener('leave.approved', testHandler);
    });

    test('4. Pillar 3: "Track Everything" - Stage 8 Audit Logs & Telemetry Querying', async () => {
        // Ensure audit log is recorded on execution
        const auditEntry = await automationEngine.recordAuditLog({
            runId: `run_hros_${Date.now()}`,
            workflowId: 'wf_hros_audit_test',
            version: 1,
            nodeId: 'node_test_audit',
            nodeType: 'action',
            status: 'completed',
            actor: 'HR Automation Admin',
            executionTimeMs: 12,
            inputPayload: { action: 'test_track_everything' },
            outputResult: { success: true }
        });

        assert.ok(auditEntry.audit_id, 'Audit entry must generate unique audit_id');
        assert.equal(auditEntry.status, 'completed');
        assert.equal(auditEntry.actor, 'HR Automation Admin');

        // Query telemetry via Custom Analytics
        const analyticsResult = customAnalyticsEngine.executeCustomQuery({
            dataSource: 'workforce',
            metric: 'headcount',
            grouping: 'department'
        });
        assert.equal(analyticsResult.success, true);
        assert.ok(analyticsResult.summary.total > 0, 'Custom analytics layer must consume and return data telemetry');
    });

    test('5. Pillar 4: "Preserve History" - Version Immutability, Draft Forking & Effective Dates', async () => {
        // 1. Create and save workflow in draft
        const workflow = workflowBuilderService.saveWorkflow({
            name: 'HROS Immutability Test Flow',
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', label: 'Trigger', x: 20, y: 20, config: { event: 'employee.onboarded' } },
                    { id: 'n2', type: 'end', label: 'End', x: 20, y: 150, config: {} }
                ],
                connections: [{ from: 'n1', to: 'n2' }]
            }
        }, null, { actor: 'Architect' });

        // 2. Run simulation test to satisfy draft->test->publish governance
        const testRes = workflowBuilderService.testRunWorkflow(workflow.id, {
            mockData: { id: 'EMP_001', name: 'Test' },
            actor: 'QA Engineer'
        });
        assert.equal(testRes.testStatus, 'passed');

        // 3. Publish v1
        const published = await workflowBuilderService.publishWorkflowVersion(workflow.id, 1, { actor: 'Release Manager' });
        assert.equal(published.status, 'active');
        assert.equal(published.activeVersionNumber, 1);

        // 4. Modifying the active workflow must NOT overwrite v1; it forks v2 as draft
        const modified = workflowBuilderService.saveWorkflow({
            id: workflow.id,
            name: 'HROS Immutability Test Flow',
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', label: 'Trigger v2', x: 20, y: 20, config: { event: 'employee.onboarded' } },
                    { id: 'n2', type: 'end', label: 'End v2', x: 20, y: 150, config: {} }
                ],
                connections: [{ from: 'n1', to: 'n2' }]
            }
        }, workflow.id, { actor: 'Architect' });

        assert.equal(modified.version, 2, 'Must fork new draft version v2');
        assert.equal(modified.status, 'draft', 'Forked version must be draft');

        // Check that original v1 is still active
        const reloaded = workflowBuilderService.getWorkflowById(workflow.id);
        assert.equal(reloaded.activeVersionNumber, 1, 'Active version must remain v1 while v2 is in draft');

        // 5. Effective date resolution in document template engine
        const activeDocVersion = documentTemplateEngine.resolveActiveTemplate('offer_letter', '2026-09-11');
        assert.ok(activeDocVersion, 'Must resolve template active as of given effective date');
    });

    test('6. Unified HR Lifecycle Demonstration (All 6 Subsystems in a Single Coordinated Run)', async () => {
        const profile = {
            id: `EMP_RUN_${Date.now()}`,
            name: 'Rohan Verma',
            employeeType: 'Full-Time',
            department: 'Engineering',
            role: 'Lead Architect',
            salary: 3200000,
            location: 'Bangalore HQ',
            managerId: 'MGR_TECH_01'
        };

        const result = await kylrxHROS.executeUnifiedHRLifecycle(profile);

        assert.equal(result.success, true);
        assert.equal(result.subsystemsExecuted, 6);
        assert.equal(result.motto, 'Configure Once → Automate Everything → Track Everything → Preserve History');

        // Verify execution of each subsystem in audit trail
        const subsystems = result.auditTrail.map(a => a.subsystem);
        assert.ok(subsystems.includes('employee_assignments'), 'Employee assignment executed');
        assert.ok(subsystems.includes('documents'), 'Document generated');
        assert.ok(subsystems.includes('approvals'), 'Approval task with SLA created');
        assert.ok(subsystems.includes('alerts'), 'Alert/notification dispatched');
        assert.ok(subsystems.includes('workflows'), 'Workflow event triggered');
        assert.ok(subsystems.includes('analytics'), 'Analytics telemetry evaluated');
    });

    test('7. Pillar Self-Verification Engine', () => {
        const verification = kylrxHROS.verifyPillars();
        assert.equal(verification.verified, true);
        assert.equal(verification.pillars.configureOnce.passed, true);
        assert.equal(verification.pillars.automateEverything.passed, true);
        assert.equal(verification.pillars.trackEverything.passed, true);
        assert.equal(verification.pillars.preserveHistory.passed, true);
    });

    test('8. REST API /api/hr-os Integration Endpoints', async () => {
        // 1. GET /api/hr-os/manifest
        const manifestRes = await fetch('http://localhost:3000/api/hr-os/manifest');
        assert.equal(manifestRes.status, 200);
        const manifestData = await manifestRes.json();
        assert.equal(manifestData.success, true);
        assert.equal(manifestData.manifest.system, 'Kylrx AI HR Operating System');

        // 2. GET /api/hr-os/status
        const statusRes = await fetch('http://localhost:3000/api/hr-os/status');
        assert.equal(statusRes.status, 200);
        const statusData = await statusRes.json();
        assert.equal(statusData.success, true);
        assert.equal(statusData.status, 'operational');
        assert.equal(statusData.motto, 'Configure Once → Automate Everything → Track Everything → Preserve History');

        // 3. GET /api/hr-os/verify-pillars
        const verifyRes = await fetch('http://localhost:3000/api/hr-os/verify-pillars');
        assert.equal(verifyRes.status, 200);
        const verifyData = await verifyRes.json();
        assert.equal(verifyData.success, true);
        assert.equal(verifyData.verified, true);

        // 4. POST /api/hr-os/event
        const eventRes = await fetch('http://localhost:3000/api/hr-os/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventName: 'employee.type.changed',
                payload: { employeeId: 'EMP_TEST_007', newType: 'Executive' },
                metadata: { actor: 'HR VP' }
            })
        });
        assert.equal(eventRes.status, 200);
        const eventData = await eventRes.json();
        assert.equal(eventData.success, true);
        assert.equal(eventData.dispatched, true);
    });
});
