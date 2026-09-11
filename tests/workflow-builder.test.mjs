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

const workflowBuilderService = require('../services/workflow-builder-service.js');

const API_BASE = 'http://localhost:3000/api/workflow-builder';

test('No-Code Visual Workflow Builder - Service & Schema Suite', async (t) => {
    
    await t.test('Initial state contains 3 pre-seeded production workflows', () => {
        const workflows = workflowBuilderService.listWorkflows();
        assert.ok(workflows.length >= 3, 'Must have at least 3 workflows seeded');
        
        const onboardingWf = workflows.find(w => w.name.includes('Offer & Onboarding'));
        assert.ok(onboardingWf, 'Must include Offer & Onboarding workflow');
        assert.equal(onboardingWf.status, 'active', 'Onboarding workflow must be active');
        assert.ok(onboardingWf.canvas.nodes.length >= 5, 'Onboarding canvas must have >= 5 nodes');

        const exitWf = workflows.find(w => w.name.includes('Exit Clearance'));
        assert.ok(exitWf, 'Must include Exit Clearance workflow');
        assert.equal(exitWf.status, 'active');

        const payrollWf = workflows.find(w => w.name.includes('Payroll Variance'));
        assert.ok(payrollWf, 'Must include Payroll Variance workflow');
        assert.equal(payrollWf.status, 'draft');
    });

    await t.test('Exposes all 11 prompt-mandated node types with zero code requirement', () => {
        const nodeTypes = workflowBuilderService.getNodeTypes();
        const expectedTypes = [
            'trigger', 'condition', 'branch', 'approval',
            'wait', 'escalation', 'action', 'notification',
            'document', 'form', 'end'
        ];

        for (const type of expectedTypes) {
            assert.ok(nodeTypes[type], `Node type '${type}' must be defined`);
            assert.ok(nodeTypes[type].name, `Node type '${type}' must have a name`);
            assert.ok(nodeTypes[type].category, `Node type '${type}' must have a category`);
            assert.ok(Array.isArray(nodeTypes[type].requiredConfig), `Node type '${type}' must specify requiredConfig array`);
        }
        assert.equal(Object.keys(nodeTypes).length, 11, 'Must define exactly 11 node types');
    });

    await t.test('Saves new workflow in draft mode with generated ID and timestamps', () => {
        const newWf = {
            name: 'Contractor SOW Renewal Flow',
            description: 'Automated 30-day SOW renewal approval for contractors',
            canvas: {
                nodes: [
                    { id: 'node_trig_1', type: 'trigger', label: 'Contract Expiry Approaching', config: { event: 'contract_expiry_due', entity: 'employee' }, x: 100, y: 100 },
                    { id: 'node_appr_1', type: 'approval', label: 'Manager Sign-off', config: { assigneeRole: 'manager', dueHours: 48 }, x: 100, y: 220 },
                    { id: 'node_end_1', type: 'end', label: 'Completed', config: { outcomeStatus: 'COMPLETED' }, x: 100, y: 340 }
                ],
                connections: [
                    { from: 'node_trig_1', to: 'node_appr_1', port: 'out' },
                    { from: 'node_appr_1', to: 'node_end_1', port: 'out' }
                ]
            }
        };

        const saved = workflowBuilderService.saveWorkflow(newWf);
        assert.ok(saved.id.startsWith('wf_'), 'ID must start with wf_');
        assert.equal(saved.status, 'draft', 'New workflows must be created as draft');
        assert.equal(saved.version, 1);
        assert.ok(saved.createdAt);
        assert.ok(saved.updatedAt);
    });

    await t.test('Updates existing workflow and increments version number', () => {
        const workflows = workflowBuilderService.listWorkflows();
        const target = workflows[0];
        const prevVersion = target.version;

        const updated = workflowBuilderService.saveWorkflow({
            id: target.id,
            name: target.name,
            description: 'Updated description for testing',
            canvas: target.canvas
        });

        assert.equal(updated.id, target.id);
        assert.equal(updated.version, prevVersion + 1, 'Version must increment on update');
        assert.equal(updated.description, 'Updated description for testing');
    });

    await t.test('Deletes a workflow by ID', () => {
        const tempWf = workflowBuilderService.saveWorkflow({
            name: 'Temporary Workflow To Delete',
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', config: { event: 'candidate_offer_accepted' } },
                    { id: 'n2', type: 'end', config: { outcomeStatus: 'COMPLETED' } }
                ],
                connections: [{ from: 'n1', to: 'n2' }]
            }
        });
        assert.ok(workflowBuilderService.getWorkflow(tempWf.id));

        const deleted = workflowBuilderService.deleteWorkflow(tempWf.id);
        assert.equal(deleted, true);
        assert.equal(workflowBuilderService.getWorkflow(tempWf.id), null);
    });
});

test('No-Code Visual Workflow Builder - Canvas Structural Validation', async (t) => {

    await t.test('Fails validation if Trigger node is missing', () => {
        const canvas = {
            nodes: [
                { id: 'node_appr_1', type: 'approval', label: 'Manager Sign-off', config: { assigneeRole: 'manager' } },
                { id: 'node_end_1', type: 'end', label: 'End', config: { outcomeStatus: 'COMPLETED' } }
            ],
            connections: [{ from: 'node_appr_1', to: 'node_end_1' }]
        };

        const result = workflowBuilderService.validateCanvas(canvas);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('Trigger')));
    });

    await t.test('Fails validation if End node is missing', () => {
        const canvas = {
            nodes: [
                { id: 'node_trig_1', type: 'trigger', label: 'Start', config: { event: 'candidate_offer_accepted' } },
                { id: 'node_appr_1', type: 'approval', label: 'Sign-off', config: { assigneeRole: 'manager' } }
            ],
            connections: [{ from: 'node_trig_1', to: 'node_appr_1' }]
        };

        const result = workflowBuilderService.validateCanvas(canvas);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('End')));
    });

    await t.test('Fails validation if required configuration fields are missing', () => {
        const canvas = {
            nodes: [
                { id: 'node_trig_1', type: 'trigger', label: 'Start', config: {} }, // missing 'event'
                { id: 'node_doc_1', type: 'document', label: 'Gen Doc', config: {} }, // missing 'templateKey'
                { id: 'node_end_1', type: 'end', label: 'End', config: { outcomeStatus: 'COMPLETED' } }
            ],
            connections: [
                { from: 'node_trig_1', to: 'node_doc_1' },
                { from: 'node_doc_1', to: 'node_end_1' }
            ]
        };

        const result = workflowBuilderService.validateCanvas(canvas);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('event')), 'Must flag missing trigger event');
        assert.ok(result.errors.some(e => e.includes('templateKey')), 'Must flag missing document templateKey');
    });

    await t.test('Detects disconnected orphan nodes on canvas', () => {
        const canvas = {
            nodes: [
                { id: 'node_trig_1', type: 'trigger', label: 'Start', config: { event: 'candidate_offer_accepted' } },
                { id: 'node_orphan', type: 'notification', label: 'Floating Node', config: { recipient: 'employee', channel: 'email' } },
                { id: 'node_end_1', type: 'end', label: 'End', config: { outcomeStatus: 'COMPLETED' } }
            ],
            connections: [{ from: 'node_trig_1', to: 'node_end_1' }]
        };

        const result = workflowBuilderService.validateCanvas(canvas);
        assert.ok(result.warnings.some(w => w.includes('Floating Node')), 'Must warn on orphan node');
    });

    await t.test('Valid flow passes validation without errors', () => {
        const canvas = {
            nodes: [
                { id: 'n1', type: 'trigger', label: 'Trigger', config: { event: 'candidate_offer_accepted' } },
                { id: 'n2', type: 'condition', label: 'Condition', config: { field: 'department', operator: '==', value: 'Engineering' } },
                { id: 'n3', type: 'document', label: 'Gen Offer', config: { templateKey: 'offer_letter' } },
                { id: 'n4', type: 'end', label: 'Complete', config: { outcomeStatus: 'COMPLETED' } }
            ],
            connections: [
                { from: 'n1', to: 'n2' },
                { from: 'n2', to: 'n3' },
                { from: 'n3', to: 'n4' }
            ]
        };

        const result = workflowBuilderService.validateCanvas(canvas);
        assert.equal(result.valid, true);
        assert.equal(result.errors.length, 0);
    });
});

test('No-Code Visual Workflow Builder - Flow Compilation to AutomationEngine Rule', async (t) => {

    await t.test('Compiles canvas into structured AutomationEngine rule format', () => {
        const wf = workflowBuilderService.listWorkflows().find(w => w.name.includes('Offer & Onboarding'));
        assert.ok(wf);

        const rule = workflowBuilderService.compileToAutomationRule(wf);
        assert.equal(rule.id, wf.id);
        assert.equal(rule.name, wf.name);
        assert.equal(rule.trigger.event, 'candidate_offer_accepted');
        assert.equal(rule.trigger.entity, 'candidate');
        assert.ok(Array.isArray(rule.stages), 'Compiled rule must contain stages array');
        assert.ok(rule.stages.length >= 4, 'Compiled rule must have multiple ordered stages');
        assert.ok(rule.metadata.compiledAt);
    });

    await t.test('Compilation fails if workflow canvas is structurally invalid', () => {
        const invalidWf = {
            id: 'wf_broken',
            name: 'Broken Flow',
            canvas: {
                nodes: [{ id: 'n1', type: 'trigger', config: {} }],
                connections: []
            }
        };

        assert.throws(() => {
            workflowBuilderService.compileToAutomationRule(invalidWf);
        }, /Validation failed/);
    });
});

test('No-Code Visual Workflow Builder - Simulation & Test Run Engine', async (t) => {

    await t.test('Simulates complete execution path and generates node execution trace', () => {
        const wf = workflowBuilderService.listWorkflows().find(w => w.name.includes('Exit Clearance'));
        assert.ok(wf);

        const simulation = workflowBuilderService.testRunWorkflow(wf.id, {
            department: 'Engineering',
            lastWorkingDay: '2026-09-30'
        });

        assert.equal(simulation.workflowId, wf.id);
        assert.equal(simulation.status, 'SUCCESS');
        assert.ok(Array.isArray(simulation.executionTrace), 'Must return execution trace');
        assert.ok(simulation.executionTrace.length > 0, 'Trace must contain executed steps');
        
        const firstStep = simulation.executionTrace[0];
        assert.equal(firstStep.nodeType, 'trigger');
        assert.equal(firstStep.outcome, 'PASSED');
        assert.ok(firstStep.executedAt);

        const hasDocStep = simulation.executionTrace.some(s => s.nodeType === 'document');
        assert.ok(hasDocStep, 'Trace must execute document generation step');
    });
});

test('No-Code Visual Workflow Builder - REST API Endpoints', async (t) => {
    let server;
    t.before(async () => {
        try {
            const check = await fetch(`${API_BASE}/node-types`).catch(() => null);
            if (!check || !check.ok) {
                const express = require('express');
                const app = express();
                app.use(express.json());
                app.use('/api/workflow-builder', require('../routes/workflow-builder.js'));
                await new Promise((resolve) => {
                    server = app.listen(3000, () => resolve());
                });
                if (server.unref) server.unref();
            }
        } catch (e) {
            // port might be bound, ignore
        }
    });

    t.after(() => {
        if (server) {
            try { server.closeAllConnections?.(); } catch(e){}
            try { server.close(); } catch(e){}
        }
    });

    await t.test('GET /api/workflow-builder/node-types returns 200 and all 11 types', async () => {
        const res = await fetch(`${API_BASE}/node-types`);
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(Object.keys(json.nodeTypes).length, 11);
    });

    await t.test('GET /api/workflow-builder/stats returns workflow counts', async () => {
        const res = await fetch(`${API_BASE}/stats`);
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.ok(json.stats.totalWorkflows >= 3);
        assert.ok(json.stats.activeWorkflows >= 2);
    });

    await t.test('GET /api/workflow-builder returns all workflows', async () => {
        const res = await fetch(`${API_BASE}`);
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.ok(Array.isArray(json.workflows));
        assert.ok(json.workflows.length >= 3);
    });

    await t.test('POST /api/workflow-builder creates a new workflow via REST', async () => {
        const payload = {
            name: 'API Test Workflow',
            description: 'Created via test runner',
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', label: 'Trigger', config: { event: 'leave_application_filed', entity: 'leave' }, x: 50, y: 50 },
                    { id: 'n2', type: 'end', label: 'End', config: { outcomeStatus: 'COMPLETED' }, x: 50, y: 150 }
                ],
                connections: [{ from: 'n1', to: 'n2' }]
            }
        };

        const res = await fetch(`${API_BASE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        assert.equal(res.status, 201);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.workflow.name, 'API Test Workflow');
        assert.equal(json.workflow.status, 'draft');

        // Test GET /:id
        const getRes = await fetch(`${API_BASE}/${json.workflow.id}`);
        assert.equal(getRes.status, 200);
        const getJson = await getRes.json();
        assert.equal(getJson.workflow.id, json.workflow.id);

        // Test POST /:id/test-run (Dry-run simulation must pass before publish)
        const simRes = await fetch(`${API_BASE}/${json.workflow.id}/test-run`, { method: 'POST' });
        assert.equal(simRes.status, 200);
        const simJson = await simRes.json();
        assert.equal(simJson.success, true);
        assert.equal(simJson.simulation.status, 'SUCCESS');

        // Test POST /:id/activate
        const actRes = await fetch(`${API_BASE}/${json.workflow.id}/activate`, { method: 'POST' });
        assert.equal(actRes.status, 200);
        const actJson = await actRes.json();
        assert.equal(actJson.success, true);
        assert.equal(actJson.workflow.status, 'active');
    });

    await t.test('POST /api/workflow-builder/validate validates raw canvas', async () => {
        const validCanvas = {
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', config: { event: 'candidate_offer_accepted' } },
                    { id: 'n2', type: 'end', config: { outcomeStatus: 'COMPLETED' } }
                ],
                connections: [{ from: 'n1', to: 'n2' }]
            }
        };

        const res = await fetch(`${API_BASE}/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validCanvas)
        });

        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.validation.valid, true);
    });
});

test('No-Code Visual Workflow Builder - UI & Navigation Verification', async (t) => {
    const adminPages = [
        'admin-central-dashboard.html',
        'admin-notification-center.html',
        'admin-alert-builder.html',
        'admin-automation-builder.html',
        'admin-assignment-matrix.html',
        'admin-analytics-builder.html',
        'admin-dashboard.html',
        'admin-document-templates.html',
        'admin-workflow-builder.html'
    ];

    await t.test('All admin pages contain link to admin-workflow-builder.html', () => {
        for (const page of adminPages) {
            const filePath = path.join(__dirname, '..', page);
            assert.ok(fs.existsSync(filePath), `Page '${page}' must exist on disk`);
            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(
                content.includes('admin-workflow-builder.html'),
                `Page '${page}' must contain a navigation link to 'admin-workflow-builder.html'`
            );
        }
    });

    await t.test('admin-workflow-builder.html has all required UI element IDs', () => {
        const filePath = path.join(__dirname, '..', 'admin-workflow-builder.html');
        const content = fs.readFileSync(filePath, 'utf8');

        const requiredIds = [
            'workflow-name-input',
            'workflow-desc-input',
            'workflow-status-badge',
            'btn-new-workflow',
            'btn-save',
            'btn-validate',
            'btn-test-run',
            'btn-activate',
            'btn-export',
            'stat-total',
            'stat-active',
            'stat-draft',
            'stat-nodes',
            'workflow-canvas',
            'svg-canvas',
            'config-panel',
            'config-panel-body',
            'btn-delete-node',
            'test-run-panel',
            'test-run-trace',
            'toast-container',
            'workflow-list'
        ];

        for (const id of requiredIds) {
            assert.ok(content.includes(`id="${id}"`), `admin-workflow-builder.html must have element with id="${id}"`);
        }
    });

    await t.test('admin-workflow-builder.html defines draggable palette items for all 11 types', () => {
        const filePath = path.join(__dirname, '..', 'admin-workflow-builder.html');
        const content = fs.readFileSync(filePath, 'utf8');

        const nodeTypes = [
            'trigger', 'condition', 'branch', 'approval',
            'wait', 'escalation', 'action', 'notification',
            'document', 'form', 'end'
        ];

        for (const type of nodeTypes) {
            assert.ok(
                content.includes(`data-node-type="${type}"`),
                `admin-workflow-builder.html palette must contain item with data-node-type="${type}"`
            );
        }
    });

    await t.test('admin-workflow-builder.html references the JS controller file', () => {
        const filePath = path.join(__dirname, '..', 'admin-workflow-builder.html');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes('admin-workflow-builder.js'), 'Must load admin-workflow-builder.js');
    });
});

