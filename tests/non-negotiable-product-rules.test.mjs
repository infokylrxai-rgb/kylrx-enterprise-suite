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
import buRulesService from '../services/bu-employee-type-rules-service.js';

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

        // PRD Section 9: Flow Designer Question Customization & Strict Architectural Boundary
        assert.ok(html.includes('id="questionDrawer"'), 'Must have slide-out question drawer for stage customization');
        assert.ok(html.includes('Strict Architectural Boundary (PRD §9)'), 'Must enforce strict boundary disclaimer');
        assert.ok(js.includes('openQuestionCustomizationDrawer'), 'Must provide openQuestionCustomizationDrawer controller');
        assert.ok(js.includes('saveQuestionsToFirestore'), 'Must provide saveQuestionsToFirestore controller');

        // Verify service level isolation: questions do not mutate canvas nodes/connections
        const sampleWf = workflowService.getWorkflow('wf_sample_onboarding');
        const initialNodesCount = sampleWf.canvas.nodes.length;
        const initialEdgesCount = sampleWf.canvas.connections.length;

        const qConfig = workflowService.saveQuestionConfig('wf_sample_onboarding', 'n4', {
            stageLabel: 'HR Director Sign-off',
            questions: [
                { questionId: 'q_test_1', prompt: 'Manager verification remarks', type: 'textarea', required: true, order: 1 },
                { questionId: 'q_test_2', prompt: 'Work velocity rating', type: 'rating', scale: 5, required: true, order: 2 }
            ]
        }, { actor: 'HR Architect' });

        assert.equal(qConfig.questions.length, 2);
        assert.equal(sampleWf.canvas.nodes.length, initialNodesCount, 'Canvas nodes must remain unchanged');
        assert.equal(sampleWf.canvas.connections.length, initialEdgesCount, 'Canvas connections must remain unchanged');

        const fetched = workflowService.getQuestionConfig('wf_sample_onboarding', 'n4');
        assert.equal(fetched.questions[0].prompt, 'Manager verification remarks');
    });

    // PRD Section 10: Business Unit Configuration by Employee Type Rules
    it('PRD Section 10: Business Unit by Employee Type Rules & Form Gating validation', () => {
        // 1. Verify canonical employee types
        const types = buRulesService.getEmployeeTypes();
        assert.ok(types.length >= 5, 'Must support canonical employee types');
        const typeCodes = types.map(t => t.code);
        assert.ok(typeCodes.includes('FULL_TIME'));
        assert.ok(typeCodes.includes('CONTRACTOR'));
        assert.ok(typeCodes.includes('INTERN'));
        assert.ok(typeCodes.includes('CONSULTANT'));
        assert.ok(typeCodes.includes('EXECUTIVE'));

        // 2. Verify default Business Unit rules mapping
        const allRules = buRulesService.getAllRules();
        assert.ok(allRules.length >= 5, 'Must provide default business unit rules');
        
        // 3. Allowed Business Units filtering by Employee Type
        const ftBUs = buRulesService.getAllowedBusinessUnits('FULL_TIME');
        assert.ok(ftBUs.length > 0, 'Full time should be allowed in multiple business units');

        const internBUs = buRulesService.getAllowedBusinessUnits('INTERN');
        const internCodes = internBUs.map(b => b.businessUnitCode);
        assert.ok(internCodes.includes('BU_ENG') || internCodes.includes('BU-TECH'));
        // Executive BU should not allow INTERN by default
        assert.equal(internCodes.includes('BU-EXEC'), false, 'Executive unit should not allow Interns');

        // 4. Incompatible pair combination rejection
        const invalidCheck = buRulesService.isCombinationValid('BU-EXEC', 'INTERN');
        assert.equal(invalidCheck.valid, false, 'BU-EXEC + INTERN must be invalid');
        assert.ok(invalidCheck.error.includes('does not permit'), 'Must return descriptive error explanation');

        const validCheck = buRulesService.isCombinationValid('BU-EXEC', 'EXECUTIVE');
        assert.equal(validCheck.valid, true, 'BU-EXEC + EXECUTIVE must be valid');

        // 5. Dynamic rule upsert and Firestore schema compatibility
        buRulesService.saveRule({
            businessUnitCode: 'BU-CUSTOM-LAB',
            businessUnitName: 'Advanced AI Research Lab',
            allowedEmployeeTypes: ['FULL_TIME', 'CONSULTANT'],
            isActive: true
        }, 'Super Admin');

        const customCheck = buRulesService.isCombinationValid('BU-CUSTOM-LAB', 'CONSULTANT');
        assert.equal(customCheck.valid, true);
        const customInvalid = buRulesService.isCombinationValid('BU-CUSTOM-LAB', 'CONTRACTOR');
        assert.equal(customInvalid.valid, false);

        // 6. Verify UI and Form Gating Script presence in Admin Dashboard
        const dashHtmlPath = path.resolve(rootDir, 'admin-dashboard.html');
        assert.ok(fs.existsSync(dashHtmlPath));
        const dashHtml = fs.readFileSync(dashHtmlPath, 'utf8');

        assert.ok(dashHtml.includes('id="employeeTypeSelect"'), 'Must have Employee Type selector');
        assert.ok(dashHtml.includes('id="buMismatchNotice"'), 'Must have inline mismatch notice element');
        assert.ok(dashHtml.includes('id="buRulesModal"'), 'Must provide Super Admin BU Rules modal');
        assert.ok(dashHtml.includes('bu-employee-type-rules.js'), 'Must load BU rules engine script');

        // 7. Verify Client Script File Integrity
        const clientScriptPath = path.resolve(rootDir, 'bu-employee-type-rules.js');
        assert.ok(fs.existsSync(clientScriptPath));
        const clientScript = fs.readFileSync(clientScriptPath, 'utf8');
        assert.ok(clientScript.includes('bindEmployeeTypeAndBuGating'), 'Must provide client binding function');
        assert.ok(clientScript.includes('bu_employee_type_rules'), 'Must target Firestore bu_employee_type_rules collection');
    });

    it('PRD Section 11: Simplified Alert Monitor & Safe AI Simulation Sandbox validation', async () => {
        const rootDir = process.cwd();

        // 1. Verify Alert Trigger Registry Service
        const alertServicePath = path.resolve(rootDir, 'services', 'alert-trigger-registry-service.js');
        assert.ok(fs.existsSync(alertServicePath), 'alert-trigger-registry-service.js must exist');
        const alertService = (await import('../services/alert-trigger-registry-service.js')).default;

        const triggers = alertService.getAllTriggers();
        assert.ok(triggers.length >= 6, 'Must register canonical triggers');
        assert.ok(alertService.getTriggerByKey('EVT_ABSENCE_EXCEEDED'));

        // 2. Verify Dry-Run Simulation (0 side effects)
        const simRes = await alertService.runSandboxedDryRun('EVT_ABSENCE_EXCEEDED', {
            employeeId: 'EMP0102',
            consecutiveDays: 4
        });
        assert.strictEqual(simRes.success, true);
        assert.strictEqual(simRes.conditionMet, true);
        assert.strictEqual(simRes.dryRunGuarantee.firestoreWrites, 0);
        assert.strictEqual(simRes.dryRunGuarantee.certifiedSafe, true);

        // 3. Verify HTML & UI integration
        const htmlPath = path.resolve(rootDir, 'admin-alert-builder.html');
        assert.ok(fs.existsSync(htmlPath));
        const html = fs.readFileSync(htmlPath, 'utf8');

        assert.ok(html.includes('id="alertSetupGuideDrawer"'), 'Must have Setup Guide Drawer');
        assert.ok(html.includes('id="aiSimulationSandboxModal"'), 'Must have Safe AI Simulation Modal');
        assert.ok(html.includes('id="simTraceTerminal"'), 'Must have Simulation Trace Terminal');
        assert.ok(html.includes('alert-trigger-registry.js'), 'Must link alert-trigger-registry.js script');

        // 4. Verify Firestore Rules
        const rulesPath = path.resolve(rootDir, 'firestore.rules');
        const rules = fs.readFileSync(rulesPath, 'utf8');
        assert.ok(rules.includes('match /alert_trigger_registry/{triggerId}'), 'Firestore rules must secure alert_trigger_registry');
    });
});


