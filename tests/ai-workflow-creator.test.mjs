import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import services via CommonJS createRequire
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const aiWorkflowCreatorService = require('../services/ai-workflow-creator-service.js');
const workflowBuilderService = require('../services/workflow-builder-service.js');

const API_BASE = 'http://localhost:3000/api/workflow-builder';
const AI_API_BASE = 'http://localhost:3000/api/ai';

test('AI Automation Creator - Natural Language Intent Parsing & Flow Synthesis', async (t) => {

    await t.test('1. Mandated Prompt: 3-Day Absenteeism → Trigger → Condition → Notification → Wait → Escalation → End', () => {
        const prompt = "If an employee is absent for three consecutive working days, notify the manager and HR. If there is no response within two days, escalate to the HR Head.";
        const result = aiWorkflowCreatorService.generateWorkflowFromPrompt(prompt);

        assert.ok(result.workflow, 'Must generate a workflow object');
        assert.equal(result.workflow.status, 'draft', 'Must strictly default to draft mode');
        assert.equal(result.workflow.isAiGenerated, true, 'Must flag as AI-generated');
        assert.equal(result.workflow.reviewStatus, 'pending_review', 'Must require human review');

        const nodeTypes = result.workflow.canvas.nodes.map(n => n.type);
        assert.deepEqual(
            nodeTypes,
            ['trigger', 'condition', 'notification', 'wait', 'escalation', 'end'],
            'Node sequence must exactly match prompt specifications'
        );

        // Verify Node Configurations
        const trigNode = result.workflow.canvas.nodes[0];
        assert.equal(trigNode.type, 'trigger');
        assert.ok(trigNode.config.event.includes('absent') || trigNode.config.event.includes('consecutive'));

        const condNode = result.workflow.canvas.nodes[1];
        assert.equal(condNode.type, 'condition');
        assert.equal(condNode.config.value, 3, 'Condition must check for 3 days absence');

        const notifNode = result.workflow.canvas.nodes[2];
        assert.equal(notifNode.type, 'notification');
        assert.ok(notifNode.config.recipient === 'manager' || notifNode.config.recipientRole === 'hr_ops');

        const waitNode = result.workflow.canvas.nodes[3];
        assert.equal(waitNode.type, 'wait');
        assert.equal(waitNode.config.duration, 2, 'Wait timer must be 2 days');

        const escNode = result.workflow.canvas.nodes[4];
        assert.equal(escNode.type, 'escalation');
        assert.equal(escNode.config.escalateTo, 'hr_head', 'Must escalate to HR Head');

        // Verify Connections
        const connections = result.workflow.canvas.connections;
        assert.equal(connections.length, 5, 'Must generate 5 sequential flow connections');
        assert.equal(connections[0].from, trigNode.id);
        assert.equal(connections[0].to, condNode.id);
        assert.equal(connections[1].from, condNode.id);
        assert.equal(connections[1].to, notifNode.id);
        assert.equal(connections[2].from, notifNode.id);
        assert.equal(connections[2].to, waitNode.id);
        assert.equal(connections[3].from, waitNode.id);
        assert.equal(connections[3].to, escNode.id);
    });

    await t.test('2. Onboarding Prompt: Offer Accepted → Condition → Document → Approval → Notification → End', () => {
        const prompt = "When a candidate accepts an offer, check if department is valid, generate the offer letter, request HR Director approval, provision IT assets, and send the welcome packet.";
        const result = aiWorkflowCreatorService.generateWorkflowFromPrompt(prompt);

        assert.ok(result.workflow);
        assert.equal(result.workflow.status, 'draft');
        assert.equal(result.workflow.isAiGenerated, true);

        const types = result.workflow.canvas.nodes.map(n => n.type);
        assert.ok(types.includes('trigger'));
        assert.ok(types.includes('condition'));
        assert.ok(types.includes('document'));
        assert.ok(types.includes('approval'));
        assert.ok(types.includes('notification'));
        assert.ok(types.includes('end'));

        const docNode = result.workflow.canvas.nodes.find(n => n.type === 'document');
        assert.equal(docNode.config.templateKey, 'offer_letter');
    });

    await t.test('3. Exit Clearance Prompt: Resignation → Form → Approval → Document → Action → End', () => {
        const prompt = "When an employee submits resignation, send asset handover form, request Finance clearance within 48 hours, generate relieving letter, and deactivate system access.";
        const result = aiWorkflowCreatorService.generateWorkflowFromPrompt(prompt);

        assert.ok(result.workflow);
        const types = result.workflow.canvas.nodes.map(n => n.type);
        assert.ok(types.includes('trigger'));
        assert.ok(types.includes('form'));
        assert.ok(types.includes('approval'));
        assert.ok(types.includes('document'));
        assert.ok(types.includes('action'));
        assert.ok(types.includes('end'));

        const docNode = result.workflow.canvas.nodes.find(n => n.type === 'document');
        assert.equal(docNode.config.templateKey, 'relieving_letter');
    });

    await t.test('4. Payroll Variance Prompt: Payroll Initiated → Branch → Approval → Action → End', () => {
        const prompt = "If payroll variance exceeds 5%, hold payout, request CFO override approval, and initiate bank transfer upon approval.";
        const result = aiWorkflowCreatorService.generateWorkflowFromPrompt(prompt);

        assert.ok(result.workflow);
        const types = result.workflow.canvas.nodes.map(n => n.type);
        assert.ok(types.includes('trigger'));
        assert.ok(types.includes('branch'));
        assert.ok(types.includes('approval'));
        assert.ok(types.includes('action'));
        assert.ok(types.includes('end'));
    });

    await t.test('5. Empty or missing prompt throws descriptive error', () => {
        assert.throws(() => {
            aiWorkflowCreatorService.generateWorkflowFromPrompt('');
        }, /prompt is required/);

        assert.throws(() => {
            aiWorkflowCreatorService.generateWorkflowFromPrompt(null);
        }, /prompt is required/);
    });
});

test('AI Automation Creator - WorkflowBuilderService Integration & Review Gating', async (t) => {

    await t.test('createWorkflowFromPrompt automatically saves workflow in Draft/Review mode', () => {
        const prompt = "If an employee is absent for three consecutive working days, notify manager and HR. If no response in 2 days, escalate to HR Head.";
        const result = workflowBuilderService.createWorkflowFromPrompt(prompt);

        assert.ok(result.workflow.id);
        assert.equal(result.workflow.status, 'draft', 'Must save in draft status');
        assert.equal(result.workflow.isAiGenerated, true);
        assert.equal(result.workflow.reviewStatus, 'pending_review');

        // Check it is retrievable by ID from workflow builder service
        const stored = workflowBuilderService.getWorkflow(result.workflow.id);
        assert.ok(stored, 'Workflow must be persisted in service storage');
        assert.equal(stored.id, result.workflow.id);
        assert.equal(stored.status, 'draft');
    });

    await t.test('AI-generated workflow strictly remains in Draft/Review until tested and published by authorized user', async () => {
        const prompt = "If an employee is absent for three consecutive working days, notify the manager and HR. If there is no response within two days, escalate to the HR Head.";
        const result = workflowBuilderService.createWorkflowFromPrompt(prompt);

        assert.equal(result.workflow.status, 'draft');
        assert.equal(result.workflow.reviewStatus, 'pending_review');
        assert.equal(result.workflow.isAiGenerated, true);

        // Attempting to publish without explicit testing must be rejected
        await assert.rejects(
            () => workflowBuilderService.publishWorkflowVersion(result.workflow.id, 1, { actor: 'Authorized HR Director' }),
            /untested/i,
            'Untested AI workflow must reject publish attempt'
        );

        // Authorized user conducts test-run simulation
        const testRun = workflowBuilderService.testRunWorkflow(result.workflow.id, {
            mockData: { consecutiveAbsences: 3 },
            actor: 'Authorized HR Director'
        });
        assert.equal(testRun.testStatus, 'passed', 'Test dry-run simulation must pass');

        // Now authorized user explicitly publishes the workflow
        const published = await workflowBuilderService.publishWorkflowVersion(result.workflow.id, 1, { actor: 'Authorized HR Director' });
        assert.equal(published.status, 'active', 'Workflow must transition to active');
        assert.equal(published.activeVersionNumber, 1);
    });
});

test('AI Automation Creator - REST API Endpoints', async (t) => {

    await t.test('POST /api/workflow-builder/ai-generate generates flow from prompt', async () => {
        const payload = {
            prompt: "If an employee is absent for three consecutive working days, notify the manager and HR. If there is no response within two days, escalate to the HR Head."
        };

        const res = await fetch(`${API_BASE}/ai-generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.ok(json.workflow);
        assert.equal(json.workflow.status, 'draft');
        assert.equal(json.workflow.isAiGenerated, true);
        assert.ok(Array.isArray(json.nodeChain));
        assert.deepEqual(json.nodeChain, ['TRIGGER', 'CONDITION', 'NOTIFICATION', 'WAIT', 'ESCALATION', 'END']);
        assert.ok(json.explanation);
        assert.ok(json.confidence >= 0.8);
    });

    await t.test('POST /api/workflow-builder/ai-generate fails with 400 when prompt is omitted', async () => {
        const res = await fetch(`${API_BASE}/ai-generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.success, false);
    });

    await t.test('POST /api/ai/generate-workflow alternate endpoint works', async () => {
        const payload = {
            prompt: "When candidate accepts offer, verify department, generate offer letter, require HR Director approval, and notify employee"
        };

        const res = await fetch(`${AI_API_BASE}/generate-workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.status, 'success');
        assert.ok(json.workflow);
        assert.equal(json.workflow.status, 'draft');
    });
});

test('AI Automation Creator - UI DOM Elements Verification', async (t) => {
    const htmlPath = path.join(__dirname, '..', 'admin-workflow-builder.html');
    const content = fs.readFileSync(htmlPath, 'utf8');

    await t.test('admin-workflow-builder.html contains all AI Creator modal elements', () => {
        const requiredIds = [
            'btn-ai-creator',
            'ai-creator-modal',
            'btn-close-ai-modal',
            'ai-prompt-input',
            'btn-generate-ai-flow',
            'btn-apply-ai-workflow',
            'ai-preview-container',
            'ai-explanation',
            'ai-preview-chain',
            'ai-confidence-badge',
            'ai-review-banner'
        ];

        for (const id of requiredIds) {
            assert.ok(content.includes(`id="${id}"`), `admin-workflow-builder.html must include id="${id}"`);
        }
    });

    await t.test('admin-workflow-builder.html contains mandated prompt sample chip', () => {
        assert.ok(
            content.includes('If an employee is absent for three consecutive working days'),
            'Must contain sample chip with mandated prompt'
        );
    });
});
