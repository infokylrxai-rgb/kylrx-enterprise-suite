import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const workflowService = require(path.join(rootDir, 'services', 'workflow-builder-service.js'));
const workflowRoutes = require(path.join(rootDir, 'routes', 'workflow-builder.js'));

test('PRD Section 12: Direct Automation and Workflow Integration Suite', async (t) => {

    await t.test('1. Backend Service: saveAutomationConfig aligns with PRD Section 12 & Workflow Sheet Schema', async () => {
        // Seed or get existing workflow
        const workflows = workflowService.listWorkflows();
        assert.ok(workflows.length > 0, 'Should have seeded workflows');
        const targetWf = workflows[0];

        const payload = {
            workflowCode: 'WF_LEAVE_APPROVAL',
            module: 'leave_attendance',
            transactionType: 'LEAVE_REQUEST',
            stepNo: 1,
            triggerEventKey: 'EVT_LEAVE_SUBMITTED',
            automationConfig: {
                enabled: true,
                actionType: 'NOTIFY_AND_ROUTE',
                targetApprover: 'L1_MANAGER',
                approverRoleCode: 'MGR_L1',
                slaHours: 24,
                isMandatory: true,
                emailTemplate: 'Leave request pending review for {{employeeName}}',
                escalationAction: 'AUTO_ESCALATE_TO_L2',
                retryRules: {
                    maxRetries: 3,
                    retryIntervalMinutes: 15
                }
            }
        };

        const savedRecord = workflowService.saveAutomationConfig(targetWf.id, 'stage_approval_1', payload, {
            actor: 'Super Admin'
        });

        assert.ok(savedRecord, 'Saved automation config record must exist');
        assert.equal(savedRecord.workflowCode, 'WF_LEAVE_APPROVAL', 'Must persist workflowCode');
        assert.equal(savedRecord.stepNo, 1, 'Must persist stepNo');
        assert.equal(savedRecord.triggerEventKey, 'EVT_LEAVE_SUBMITTED', 'Must wire triggerEventKey');
        assert.equal(savedRecord.approverType, 'L1_MANAGER', 'Must align approverType with Workflow sheet');
        assert.equal(savedRecord.approverRoleCode, 'MGR_L1', 'Must align approverRoleCode');
        assert.equal(savedRecord.slaHours, 24, 'Must persist SLA hours');
        assert.equal(savedRecord.mandatory, true, 'Must persist mandatory flag');
        assert.equal(savedRecord.automationConfig.actionType, 'NOTIFY_AND_ROUTE');
        assert.equal(savedRecord.automationConfig.escalationAction, 'AUTO_ESCALATE_TO_L2');

        // Verify top-level workflow document schema sync for Firestore workflows/{workflowId}
        const updatedWf = workflowService.getWorkflow(targetWf.id);
        assert.equal(updatedWf.workflowCode, 'WF_LEAVE_APPROVAL');
        assert.equal(updatedWf.stepNo, 1);
        assert.equal(updatedWf.triggerEventKey, 'EVT_LEAVE_SUBMITTED');
        assert.equal(updatedWf.automationConfig.actionType, 'NOTIFY_AND_ROUTE');
        assert.equal(updatedWf.automationConfig.targetApprover, 'L1_MANAGER');
        assert.equal(updatedWf.automationConfig.slaHours, 24);
        assert.equal(updatedWf.automationConfig.isMandatory, true);
    });

    await t.test('2. Backend Service: getAutomationConfig and listAutomationConfigs retrieve saved configs', async () => {
        const workflows = workflowService.listWorkflows();
        const targetWf = workflows[0];

        const config = workflowService.getAutomationConfig(targetWf.id, 'stage_approval_1');
        assert.ok(config, 'getAutomationConfig should retrieve record');
        assert.equal(config.stageId, 'stage_approval_1');
        assert.equal(config.triggerEventKey, 'EVT_LEAVE_SUBMITTED');

        const allConfigs = workflowService.listAutomationConfigs(targetWf.id);
        assert.ok(allConfigs['stage_approval_1'], 'listAutomationConfigs should contain stage_approval_1');
    });

    await t.test('3. REST API Endpoints: GET and POST /api/workflow-builder/:id/automations', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/workflow-builder', workflowRoutes);

        const server = http.createServer(app);
        await new Promise(resolve => server.listen(0, resolve));
        const port = server.address().port;
        const baseUrl = `http://127.0.0.1:${port}/api/workflow-builder`;

        try {
            const workflows = workflowService.listWorkflows();
            const targetWf = workflows[0];

            // POST automation
            const postRes = await fetch(`${baseUrl}/${targetWf.id}/automations/stage_webhook_2`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflowCode: 'WF_EXIT_CLEARANCE',
                    module: 'exit_offboarding',
                    stepNo: 2,
                    triggerEventKey: 'EVT_EXIT_PENDING',
                    actionType: 'TRIGGER_WEBHOOK',
                    approverType: 'HR_OPERATIONS',
                    approverRoleCode: 'HR_OPS_LEAD',
                    slaHours: 48,
                    isMandatory: false,
                    emailTemplate: 'Exit task scheduled for {{employeeName}}',
                    escalationAction: 'NOTIFY_ADMIN',
                    webhookConfig: {
                        url: 'https://hooks.slack.com/services/T00/B00/workflow-events',
                        headers: { 'Content-Type': 'application/json' }
                    }
                })
            });
            const postBody = await postRes.json();

            assert.equal(postRes.status, 200);
            assert.equal(postBody.success, true);
            assert.equal(postBody.automationConfig.workflowCode, 'WF_EXIT_CLEARANCE');
            assert.equal(postBody.automationConfig.automationConfig.actionType, 'TRIGGER_WEBHOOK');

            // GET specific stage automation
            const getStageRes = await fetch(`${baseUrl}/${targetWf.id}/automations/stage_webhook_2`);
            const getStageBody = await getStageRes.json();
            assert.equal(getStageRes.status, 200);
            assert.equal(getStageBody.automationConfig.triggerEventKey, 'EVT_EXIT_PENDING');

            // GET list of automations
            const getListRes = await fetch(`${baseUrl}/${targetWf.id}/automations`);
            const getListBody = await getListRes.json();
            assert.equal(getListRes.status, 200);
            assert.ok(getListBody.automationConfigs['stage_webhook_2']);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    await t.test('4. HTML Deliverables: admin-workflow-builder.html toolbar button and drawer components', async () => {
        const htmlPath = path.join(rootDir, 'admin-workflow-builder.html');
        assert.ok(fs.existsSync(htmlPath), 'admin-workflow-builder.html must exist');
        const html = fs.readFileSync(htmlPath, 'utf8');

        // Prominent toolbar button
        assert.ok(html.includes('id="btn-automation-drawer"'), 'Toolbar must include #btn-automation-drawer');
        assert.ok(html.includes('window.openAutomationDrawer()'), 'Toolbar button must trigger openAutomationDrawer()');

        // Slide-out Drawer Markup
        assert.ok(html.includes('id="automationDrawerOverlay"'), 'Must have #automationDrawerOverlay');
        assert.ok(html.includes('id="automationDrawer"'), 'Must have #automationDrawer');
        assert.ok(html.includes('id="ad-tab-action"'), 'Must have Action & Routing tab');
        assert.ok(html.includes('id="ad-tab-template"'), 'Must have Payload & Templates tab');
        assert.ok(html.includes('id="ad-tab-sla"'), 'Must have SLA & Retry Policies tab');

        // Structured Form Fields
        assert.ok(html.includes('id="ad-input-stage"'), 'Must have Target Stage dropdown');
        assert.ok(html.includes('id="ad-input-trigger-key"'), 'Must have Trigger Event Key input');
        assert.ok(html.includes('id="ad-trigger-key-list"'), 'Must have Trigger Event Key datalist with canonical keys');
        assert.ok(html.includes('EVT_LEAVE_SUBMITTED'), 'Datalist must include EVT_LEAVE_SUBMITTED');
        assert.ok(html.includes('EVT_ABSENCE_EXCEEDED'), 'Datalist must include EVT_ABSENCE_EXCEEDED');
        assert.ok(html.includes('EVT_PROBATION_EXPIRY'), 'Datalist must include EVT_PROBATION_EXPIRY');
        assert.ok(html.includes('id="ad-input-workflow-code"'), 'Must have Workflow Code field');
        assert.ok(html.includes('id="ad-input-step-no"'), 'Must have Step No field');
        assert.ok(html.includes('id="ad-input-action-type"'), 'Must have Action Type dropdown');
        assert.ok(html.includes('NOTIFY_AND_ROUTE'), 'Action type must include NOTIFY_AND_ROUTE');
        assert.ok(html.includes('DISPATCH_ALERT'), 'Action type must include DISPATCH_ALERT');
        assert.ok(html.includes('ASSIGN_TASK'), 'Action type must include ASSIGN_TASK');
        assert.ok(html.includes('TRIGGER_WEBHOOK'), 'Action type must include TRIGGER_WEBHOOK');
        assert.ok(html.includes('CALENDAR_REMINDER'), 'Action type must include CALENDAR_REMINDER');
        assert.ok(html.includes('UPDATE_RECORD_STATUS'), 'Action type must include UPDATE_RECORD_STATUS');

        // Approver & SLA Fields
        assert.ok(html.includes('id="ad-input-approver-type"'), 'Must have Approver Type dropdown');
        assert.ok(html.includes('id="ad-input-role-code"'), 'Must have Approver Role Code input');
        assert.ok(html.includes('id="ad-input-sla-hours"'), 'Must have SLA Hours input');
        assert.ok(html.includes('id="ad-input-escalation-action"'), 'Must have Escalation Action dropdown');
        assert.ok(html.includes('id="ad-input-retry-count"'), 'Must have Retry Attempts input');

        // Dynamic Variable Placeholders
        assert.ok(html.includes('insertVariableIntoTemplate(\'{{employeeName}}\')'), 'Must have {{employeeName}} chip');
        assert.ok(html.includes('insertVariableIntoTemplate(\'{{department}}\')'), 'Must have {{department}} chip');
        assert.ok(html.includes('insertVariableIntoTemplate(\'{{approvalLink}}\')'), 'Must have {{approvalLink}} chip');

        // Save & Reset Buttons
        assert.ok(html.includes('id="ad-btn-save-firestore"'), 'Must have Save to Firestore button');
        assert.ok(html.includes('saveAutomationToFirestore()'), 'Save button must invoke saveAutomationToFirestore()');
    });

    await t.test('5. JavaScript Controller: admin-workflow-builder.js handlers & visual node badges', async () => {
        const jsPath = path.join(rootDir, 'admin-workflow-builder.js');
        assert.ok(fs.existsSync(jsPath), 'admin-workflow-builder.js must exist');
        const js = fs.readFileSync(jsPath, 'utf8');

        // Controller exports/functions
        assert.ok(js.includes('window.openAutomationDrawer = function'), 'Must define openAutomationDrawer');
        assert.ok(js.includes('window.closeAutomationDrawer = function'), 'Must define closeAutomationDrawer');
        assert.ok(js.includes('window.switchAdTab = function'), 'Must define switchAdTab');
        assert.ok(js.includes('window.handleAdActionTypeChange = function'), 'Must define handleAdActionTypeChange');
        assert.ok(js.includes('window.handleAdApproverTypeChange = function'), 'Must define handleAdApproverTypeChange');
        assert.ok(js.includes('window.insertVariableIntoTemplate = function'), 'Must define insertVariableIntoTemplate');
        assert.ok(js.includes('window.resetAutomationForm = function'), 'Must define resetAutomationForm');
        assert.ok(js.includes('window.saveAutomationToFirestore = async function'), 'Must define saveAutomationToFirestore');

        // Canvas node badge visual linking
        assert.ok(js.includes('node-automation-badge'), 'Must render .node-automation-badge on canvas nodes');
        assert.ok(js.includes('node-automation-add-link'), 'Must render .node-automation-add-link on canvas nodes');

        // Inspector config panel integration
        assert.ok(js.includes('stage-automation-customizer-box'), 'Must render .stage-automation-customizer-box in properties panel');

        // Direct Cloud Firestore client write pattern
        assert.ok(js.includes('doc(fb.db, \'workflows\', workflowId)'), 'Must write to workflows/{workflowId}');
        assert.ok(js.includes('doc(fb.db, \'workflows\', workflowId, \'automation_configs\', stageId)'), 'Must write to subcollection');
    });

    await t.test('6. Cloud Firestore Security Rules: firestore.rules covers /workflows and subcollections', async () => {
        const rulesPath = path.join(rootDir, 'firestore.rules');
        assert.ok(fs.existsSync(rulesPath), 'firestore.rules must exist');
        const rules = fs.readFileSync(rulesPath, 'utf8');

        assert.ok(rules.includes('match /workflows/{workflowId}'), 'Must secure /workflows/{workflowId}');
        assert.ok(rules.includes('match /automation_configs/{stageId}'), 'Must secure /automation_configs/{stageId}');
    });
});
