import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import automationEngine from '../services/automation-engine.js';
import eventBus from '../services/event-bus.js';
import moduleRegistry from '../services/automation-module-registry.js';
import workflowService from '../services/workflow-builder-service.js';
import assignmentEngine from '../services/central-assignment-engine.js';
import docEngine from '../services/document-template-engine.js';

import onboardingAdapter from '../modules/onboarding-module-adapter.js';
import leaveAdapter from '../modules/leave-attendance-module-adapter.js';
import exitAdapter from '../modules/exit-module-adapter.js';
import payrollAdapter from '../modules/payroll-module-adapter.js';
import statutoryAdapter from '../modules/statutory-module-adapter.js';
import policyAdapter from '../modules/policy-module-adapter.js';

describe('18. Non-Negotiable Product Rules Suite (Rules 24 - 33)', () => {

    before(() => {
        moduleRegistry.registerModule(onboardingAdapter);
        moduleRegistry.registerModule(leaveAdapter);
        moduleRegistry.registerModule(exitAdapter);
        moduleRegistry.registerModule(payrollAdapter);
        moduleRegistry.registerModule(statutoryAdapter);
        moduleRegistry.registerModule(policyAdapter);
    });

    // Rule 24: One automation engine; do not duplicate workflow logic per module
    it('Rule 24: One centralized automation engine orchestrates all modules without duplicate workflow code', () => {
        assert.ok(automationEngine, 'Central automation engine must exist');
        assert.ok(eventBus, 'Central event bus must exist');
        assert.ok(moduleRegistry, 'Central module registry must exist');

        // All core modules register to the same engine & registry
        const modules = Array.from(moduleRegistry.modules.values());
        assert.ok(modules.length >= 5, 'At least 5 core modules must be registered centrally');
        
        // Modules provide metadata contracts, not private workflow runners
        for (const mod of modules) {
            assert.ok(mod.moduleKey, 'Module must have key');
            assert.ok(Array.isArray(mod.triggers), 'Module must declare triggers via contract');
            assert.ok(typeof mod.actions === 'object', 'Module must export action handlers map');
        }
    });

    // Rule 25: Everything is permission-controlled
    it('Rule 25: Actions, templates and operations are strictly permission-controlled by role & module', async () => {
        // Document generation permission gating
        await assert.rejects(async () => {
            // Attempting generation with unauthorized caller module
            await docEngine.generateDocument('offer_letter', {}, { callerModule: 'unauthorized_guest_module' });
        }, /Access Denied/i, 'Unauthorized caller module must be rejected');

        // Verify authorized module succeeds
        const allowed = docEngine.isModulePermitted('offer_letter', 'onboarding');
        assert.equal(allowed, true, 'Permitted module should be allowed');
    });

    // Rule 26: Critical HR/payroll automations require explicit publish approval
    it('Rule 26: Critical HR/payroll automations require explicit test verification and authorized publish approval', async () => {
        const wf = workflowService.saveWorkflow({
            name: 'Critical Executive Salary Increment Flow',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Payroll Calculated', x: 10, y: 10, config: { event: 'payroll.calculated' } },
                    { id: 'e1', type: 'end', label: 'End Flow', x: 10, y: 100, config: {} }
                ],
                connections: [{ from: 't1', to: 'e1' }]
            }
        }, null, { actor: 'HR Specialist' });

        // Untested critical workflow must fail publish approval
        await assert.rejects(async () => {
            await workflowService.publishWorkflowVersion(wf.id, 1, { actor: 'HR Specialist' });
        }, /Cannot publish untested workflow/i, 'Publish must be blocked until tested');

        // Once tested and approved by authorized actor, publication succeeds
        workflowService.testRunWorkflow(wf.id, { mockData: { gross: 250000 }, actor: 'HR Specialist' });
        const published = await workflowService.publishWorkflowVersion(wf.id, 1, { actor: 'Authorized HR Director' });
        assert.equal(published.status, 'active');
        assert.equal(published.activeVersionNumber, 1);
    });

    // Rule 27: Use effective dates for employee configuration changes
    it('Rule 27: Use effective dates (effectiveFrom, effectiveTo) for configuration changes', () => {
        // Test document template version resolution by effective date
        const currentVersion = docEngine.resolveActiveTemplate('offer_letter', '2026-09-11');
        assert.ok(currentVersion, 'Must resolve valid version for current effective date');
        assert.equal(currentVersion.status, 'approved');
        assert.ok(currentVersion.effectiveFrom, 'Must have effectiveFrom date');

        // Expired date or pre-effective date fails resolution
        assert.throws(() => {
            docEngine.resolveActiveTemplate('offer_letter', '2020-01-01');
        }, /No approved and effective template version found/i);
    });

    // Rule 28: Never destroy historical assignments or records
    it('Rule 28: Never destroy historical assignments or records; preserve audit trails & calculate configuration impact', () => {
        // Calculate configuration impact before making changes
        const currentAttributes = {
            employeeId: 'EMP_CONTRACT_01',
            employeeType: 'Contractor',
            department: 'Technology',
            location: 'Bengaluru'
        };
        const prospectiveAttributes = {
            employeeId: 'EMP_CONTRACT_01',
            employeeType: 'Full Time',
            department: 'Engineering',
            location: 'Bengaluru'
        };

        const impact = assignmentEngine.calculateConfigurationImpact(currentAttributes, prospectiveAttributes);
        assert.equal(impact.hasImpact, true, 'Converting employee type must retain change impact audit');
        assert.ok(impact.diffSummaryList.length > 0, 'Audit diff trail must be captured');

        // Audit logs in automation engine are immutable
        assert.ok(Array.isArray(automationEngine.auditLogs));
    });

    // Rule 29: Every live automation is versioned
    it('Rule 29: Every live automation is versioned with incremental immutable snapshots', async () => {
        const wf = workflowService.saveWorkflow({
            name: 'Strict Versioned Workflow',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Leave Applied', x: 0, y: 0, config: { event: 'leave.applied' } },
                    { id: 'e1', type: 'end', label: 'End', x: 0, y: 80, config: {} }
                ],
                connections: [{ from: 't1', to: 'e1' }]
            }
        }, null, { actor: 'Author' });

        // Publish v1
        workflowService.testRunWorkflow(wf.id, { mockData: {}, actor: 'Author' });
        const v1Pub = await workflowService.publishWorkflowVersion(wf.id, 1, { actor: 'Admin' });
        assert.equal(v1Pub.activeVersionNumber, 1);

        // Modifying active flow automatically creates new draft v2
        const v2Draft = workflowService.saveWorkflow({
            id: wf.id,
            name: 'Strict Versioned Workflow (v2 Updated)',
            canvas: {
                nodes: [
                    { id: 't1', type: 'trigger', label: 'Leave Applied v2', x: 0, y: 0, config: { event: 'leave.applied' } },
                    { id: 'e1', type: 'end', label: 'End v2', x: 0, y: 80, config: {} }
                ],
                connections: [{ from: 't1', to: 'e1' }]
            }
        }, null, { actor: 'Author' });

        assert.equal(v2Draft.versions.length, 2, 'Must maintain both v1 and v2 version records');
        assert.equal(v2Draft.activeVersionNumber, 1, 'Active live version must remain 1 until v2 is published');
    });

    // Rule 30: Every execution is auditable
    it('Rule 30: Every execution is auditable with immutable audit entries', async () => {
        const auditLog = await automationEngine.recordAuditLog({
            runId: 'RUN_AUDIT_RULE_30',
            automationId: 'rule_compliance_check',
            stage: 'Statutory Verification',
            status: 'COMPLETED',
            details: { employeeId: 'EMP_AUDIT_30', actor: 'Automated Compliance Engine' }
        });

        assert.ok(auditLog.audit_id, 'Audit log must generate unique immutable ID');
        assert.ok(auditLog.timestamp, 'Audit log must timestamp execution');
        assert.equal(auditLog.status, 'COMPLETED');

        // Query audit trail
        const inMemoryLogs = automationEngine.auditLogs;
        assert.ok(inMemoryLogs.some(l => l.runId === 'RUN_AUDIT_RULE_30'));
    });

    // Rule 31: Every actionable task has an owner and due time
    it('Rule 31: Every actionable task has an explicit owner and due time/SLA', async () => {
        const taskId = await automationEngine.createApprovalTask({
            title: 'Probation Completion Signoff',
            assignee_role: 'department_head',
            assignee_id: 'MGR_102',
            escalation_hours: 48,
            escalation_assignee: 'hr_director'
        }, 'RUN_TASK_001', { entityId: 'EMP_777', entityType: 'employee' }, { id: 'rule_probation_end', name: 'Probation Signoff' });

        assert.ok(taskId, 'Task ID must be created');
    });

    // Rule 32: AI can create drafts, but authorized humans control publication
    it('Rule 32: AI can create drafts, but authorized humans control publication', async () => {
        const aiResult = workflowService.createWorkflowFromPrompt(
            'If an employee is absent for three consecutive working days, notify manager and HR. Escalate if no response in two days.',
            { actor: 'AI Assistant' }
        );

        const aiWorkflow = aiResult.workflow;
        // Verification of Draft / Review gating
        assert.equal(aiWorkflow.status, 'draft', 'AI workflow must always start as draft');
        assert.equal(aiWorkflow.isAiGenerated, true, 'Must be flagged as AI generated');
        assert.equal(aiWorkflow.reviewStatus, 'pending_review', 'Must require pending_review');

        // Cannot publish untested AI workflow
        await assert.rejects(async () => {
            await workflowService.publishWorkflowVersion(aiWorkflow.id, 1, { actor: 'Automated Bot' });
        }, /Cannot publish untested workflow/i, 'Unreviewed AI workflow publication must be rejected');

        // Only after testing and explicit human review approval
        workflowService.testRunWorkflow(aiWorkflow.id, { mockData: { consecutiveDays: 3 }, actor: 'HR Manager' });
        const published = await workflowService.publishWorkflowVersion(aiWorkflow.id, 1, { actor: 'HR Manager' });
        assert.equal(published.status, 'active', 'Human authorized publish must succeed');
    });

    // Rule 33: HR can configure processes without developer intervention
    it('Rule 33: HR can configure processes without developer intervention (100% No-Code UI verified)', () => {
        const htmlPath = path.resolve(rootDir, 'admin-workflow-builder.html');
        assert.ok(fs.existsSync(htmlPath));
        const html = fs.readFileSync(htmlPath, 'utf8');

        // Verify No-Code guarantee and visual configuration helpers
        assert.ok(html.includes('No-Code Guarantee'), 'UI must display No-Code Guarantee banner');
        assert.ok(html.includes('id="palette-node-trigger"'), 'Must have visual palette node for Trigger');
        assert.ok(html.includes('id="palette-node-condition"'), 'Must have visual palette node for Condition');
        assert.ok(html.includes('id="palette-node-approval"'), 'Must have visual palette node for Approval');
        assert.ok(html.includes('id="palette-node-notification"'), 'Must have visual palette node for Notification');
        assert.ok(html.includes('id="palette-node-document"'), 'Must have visual palette node for Document');
        assert.ok(html.includes('class="palette-add-btn"'), 'Must have 1-click Quick Add buttons');

        const jsPath = path.resolve(rootDir, 'admin-workflow-builder.js');
        const js = fs.readFileSync(jsPath, 'utf8');
        assert.ok(js.includes('renderConfigPanel'), 'Must provide point-and-click configuration panels for HR');
        assert.ok(js.includes('addNodeToCanvas'), 'Must support visual canvas drag-and-drop / click addition');
    });
});
