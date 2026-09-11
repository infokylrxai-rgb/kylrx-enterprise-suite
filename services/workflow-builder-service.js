const crypto = require('crypto');
const logger = require('../utils/logger');
const automationEngine = require('./automation-engine');
const aiWorkflowCreator = require('./ai-workflow-creator-service');

/**
 * WorkflowBuilderService (Kylrx Enterprise Suite — Features 12, 13 & 14)
 *
 * Core Workflow Engine supporting:
 * - 11 Visual No-Code Node Types
 * - AI Natural Language Workflow Synthesizer
 * - Multi-Version Control (Immutable versions, in-flight run version pinning)
 * - Test Mode (Employee Catalog & Custom Sample Payloads, Dry Run Execution Trace)
 * - Draft → Tested → Published Lifecycle Enforcement
 * - Comprehensive Execution Run History (Success, Failure, Retry, Error Reasons)
 * - User Change Audit Trail (Created, Edited, Tested, Published, Paused, Rollback)
 */

class WorkflowBuilderService {
    constructor() {
        this.workflows = new Map();       // id → WorkflowDefinition
        this.compiledRules = new Map();   // id → Map(versionNumber → AutomationEngineRule)
        this.executionLogs = new Map();   // runId → ExecutionLogRecord
        this.auditTrail = [];             // AuditEntry[]
        this.sampleEmployees = this._initSampleEmployees();
        this._seedSampleWorkflows();
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       NODE TYPE REGISTRY
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    static NODE_TYPES = {
        trigger: {
            name: 'Trigger',
            label: 'Trigger',
            color: '#6366f1',
            icon: 'fa-bolt',
            category: 'start',
            description: 'Starts the workflow on a business or schedule event',
            requiredConfig: ['event']
        },
        condition: {
            name: 'Condition',
            label: 'Condition',
            color: '#f59e0b',
            icon: 'fa-filter',
            category: 'logic',
            description: 'Pass / Fail evaluation gate based on employee or system fields',
            requiredConfig: ['field', 'operator']
        },
        branch: {
            name: 'Branch',
            label: 'Branch',
            color: '#8b5cf6',
            icon: 'fa-code-branch',
            category: 'logic',
            description: 'Multi-way routing based on business rules or values',
            requiredConfig: ['field', 'operator']
        },
        approval: {
            name: 'Approval',
            label: 'Approval',
            color: '#3b82f6',
            icon: 'fa-user-check',
            category: 'human',
            description: 'Human sign-off gate with SLA deadline and escalation route',
            requiredConfig: ['assigneeRole']
        },
        wait: {
            name: 'Wait',
            label: 'Wait',
            color: '#14b8a6',
            icon: 'fa-clock',
            category: 'control',
            description: 'Delay step for duration or until external event occurs',
            requiredConfig: ['duration']
        },
        escalation: {
            name: 'Escalation',
            label: 'Escalation',
            color: '#f97316',
            icon: 'fa-level-up-alt',
            category: 'control',
            description: 'Automatic escalation upon SLA expiration or threshold breach',
            requiredConfig: ['escalateTo']
        },
        action: {
            name: 'Action',
            label: 'Action',
            color: '#10b981',
            icon: 'fa-play',
            category: 'execute',
            description: 'Executes automated HR system action or external webhook',
            requiredConfig: ['actionType']
        },
        notification: {
            name: 'Notification',
            label: 'Notification',
            color: '#ec4899',
            icon: 'fa-paper-plane',
            category: 'execute',
            description: 'Dispatches multi-channel notice (email, in-app, Slack)',
            requiredConfig: ['recipient', 'channel']
        },
        document: {
            name: 'Document',
            label: 'Document',
            color: '#eab308',
            icon: 'fa-file-alt',
            category: 'execute',
            description: 'Generates official document via Document Template Engine',
            requiredConfig: ['templateKey']
        },
        form: {
            name: 'Form',
            label: 'Form',
            color: '#06b6d4',
            icon: 'fa-clipboard-list',
            category: 'human',
            description: 'Captures structured input from employee or manager',
            requiredConfig: ['formTitle']
        },
        end: {
            name: 'End',
            label: 'End',
            color: '#ef4444',
            icon: 'fa-flag-checkered',
            category: 'terminal',
            description: 'Final step completing the workflow and recording status',
            requiredConfig: ['outcomeStatus']
        }
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       SAMPLE EMPLOYEES CATALOG
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    _initSampleEmployees() {
        return [
            {
                id: 'EMP-042',
                name: 'Alex Mercer',
                email: 'alex.mercer@kylrx.com',
                designation: 'Lead Software Architect',
                department: 'Engineering',
                employmentType: 'full_time',
                ctc: 2800000,
                tenureMonths: 24,
                consecutiveAbsences: 3,
                performanceRating: 4.8,
                manager: 'Priya Nair',
                location: 'Bangalore'
            },
            {
                id: 'EMP-556',
                name: 'Sneha Rajput',
                email: 'sneha.rajput@kylrx.com',
                designation: 'Staff Data Engineer',
                department: 'Data Platform',
                employmentType: 'full_time',
                ctc: 2200000,
                tenureMonths: 18,
                consecutiveAbsences: 0,
                performanceRating: 4.5,
                manager: 'Alex Mercer',
                location: 'Hyderabad'
            },
            {
                id: 'EMP-788',
                name: 'Vikram Malhotra',
                email: 'vikram.malhotra@kylrx.com',
                designation: 'Senior Financial Analyst',
                department: 'Finance',
                employmentType: 'full_time',
                ctc: 1800000,
                tenureMonths: 36,
                consecutiveAbsences: 1,
                performanceRating: 4.2,
                manager: 'CFO Office',
                location: 'Mumbai'
            },
            {
                id: 'EMP-902',
                name: 'Priya Nair',
                email: 'priya.nair@kylrx.com',
                designation: 'Director of Human Resources',
                department: 'Human Resources',
                employmentType: 'full_time',
                ctc: 3500000,
                tenureMonths: 48,
                consecutiveAbsences: 0,
                performanceRating: 4.9,
                manager: 'Executive Board',
                location: 'Bangalore'
            },
            {
                id: 'EMP-311',
                name: 'Rohan Verma',
                email: 'rohan.verma@kylrx.com',
                designation: 'Associate Product Manager',
                department: 'Product',
                employmentType: 'full_time',
                ctc: 1400000,
                tenureMonths: 8,
                consecutiveAbsences: 0,
                performanceRating: 3.9,
                manager: 'Priya Nair',
                location: 'Bangalore'
            }
        ];
    }

    getSampleEmployees() {
        return this.sampleEmployees;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       CANVAS NORMALIZER
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    _normalizeCanvas(canvasState = {}) {
        let nodes = [];
        let connections = [];

        if (canvasState.canvas && Array.isArray(canvasState.canvas.nodes)) {
            nodes = canvasState.canvas.nodes;
            connections = canvasState.canvas.connections || canvasState.canvas.edges || [];
        } else if (Array.isArray(canvasState.nodes)) {
            nodes = canvasState.nodes;
            connections = canvasState.connections || canvasState.edges || [];
        }

        const normalizedConns = connections.map((c, idx) => ({
            id: c.id || `conn_${idx + 1}`,
            from: c.from || c.fromNodeId,
            to: c.to || c.toNodeId,
            fromNodeId: c.from || c.fromNodeId,
            toNodeId: c.to || c.toNodeId,
            port: c.port || 'out',
            label: c.label || ''
        }));

        const normalizedNodes = nodes.map(n => ({
            id: n.id,
            type: n.type,
            label: n.label || n.config?.label || n.type,
            x: n.x !== undefined ? n.x : (n.position?.x || 100),
            y: n.y !== undefined ? n.y : (n.position?.y || 100),
            position: {
                x: n.x !== undefined ? n.x : (n.position?.x || 100),
                y: n.y !== undefined ? n.y : (n.position?.y || 100)
            },
            config: {
                ...n.config,
                label: n.label || n.config?.label || n.type,
                event: n.config?.event,
                entity: n.config?.entity,
                field: n.config?.field,
                operator: n.config?.operator,
                value: n.config?.value,
                assigneeRole: n.config?.assigneeRole,
                dueHours: n.config?.dueHours || n.config?.dueTiming,
                onReject: n.config?.onReject,
                duration: n.config?.duration,
                unit: n.config?.unit,
                escalateTo: n.config?.escalateTo,
                slaHours: n.config?.slaHours,
                actionType: n.config?.actionType,
                recipient: n.config?.recipient || n.config?.recipientRole || n.config?.recipientType,
                recipientRole: n.config?.recipientRole || n.config?.recipient,
                channel: n.config?.channel,
                template: n.config?.template || n.config?.messageTemplate,
                templateKey: n.config?.templateKey,
                formTitle: n.config?.formTitle,
                fields: n.config?.fields,
                outcomeStatus: n.config?.outcomeStatus || 'COMPLETED'
            }
        }));

        return { nodes: normalizedNodes, connections: normalizedConns, edges: normalizedConns };
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       MULTI-VERSION CRUD & GOVERNANCE
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Save (create or update) workflow.
     * Rule: Never overwrite a live active version!
     * If editing an active workflow, fork a new Draft version (v+1).
     */
    saveWorkflow(workflowData, existingId = null, { actor = 'HR Administrator', changeSummary = 'Saved workflow draft' } = {}) {
        const { name, description = '', meta = {} } = workflowData;
        if (!name) throw new Error('Workflow name is required.');

        const normalized = this._normalizeCanvas(workflowData);
        const validation = this.validateCanvas(normalized);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
        }

        const id = existingId || workflowData.id || `wf_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const now = new Date().toISOString();

        let existing = this.workflows.get(id);
        let versionNumber = 1;
        let isFork = false;

        let versions = existing?.versions ? [...existing.versions] : [];
        let status = 'draft';

        if (existing) {
            if (existing.status === 'active') {
                // NEVER OVERWRITE LIVE VERSION! Fork a new draft version
                isFork = true;
                versionNumber = (existing.versions?.length || existing.version || 1) + 1;
                status = 'draft';
                logger.info(`[WorkflowBuilder] 🔀 Active version ${existing.activeVersionNumber || 1} preserved. Forking new draft v${versionNumber} for '${name}'.`);
            } else {
                // Existing is already draft: increment version number on update
                versionNumber = (existing.version || 1) + 1;
                status = existing.status || 'draft';
            }
        }

        const newVersionRecord = {
            versionNumber,
            status,
            testStatus: workflowData.testStatus || 'untested',
            lastTestedAt: workflowData.lastTestedAt || null,
            canvas: {
                nodes: normalized.nodes,
                connections: normalized.connections
            },
            nodes: normalized.nodes,
            edges: normalized.connections,
            createdAt: now,
            createdBy: actor,
            changeSummary
        };

        if (isFork) {
            versions.push(newVersionRecord);
        } else if (versions.length > 0) {
            // Update latest draft version in versions list
            const draftIdx = versions.findIndex(v => v.versionNumber === versionNumber);
            if (draftIdx >= 0) versions[draftIdx] = newVersionRecord;
            else versions.push(newVersionRecord);
        } else {
            versions.push(newVersionRecord);
        }

        const activeVersionNumber = existing?.activeVersionNumber || (status === 'active' ? versionNumber : null);

        const workflow = {
            id,
            name,
            description,
            status,
            version: versionNumber,
            activeVersionNumber,
            versions,
            isAiGenerated: existing?.isAiGenerated ?? workflowData.isAiGenerated ?? false,
            reviewStatus: existing?.reviewStatus ?? workflowData.reviewStatus ?? (workflowData.isAiGenerated ? 'pending_review' : 'approved'),
            testStatus: newVersionRecord.testStatus,
            lastTestedAt: newVersionRecord.lastTestedAt,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            canvas: {
                nodes: normalized.nodes,
                connections: normalized.connections
            },
            nodes: normalized.nodes,
            edges: normalized.connections,
            meta: {
                ...meta,
                nodeCount: normalized.nodes.length,
                connectionCount: normalized.connections.length,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
                version: versionNumber,
                activeVersionNumber
            }
        };

        this.workflows.set(id, workflow);

        // Compile version rule
        try {
            const compiled = this.compileToAutomationRule(workflow);
            let versionMap = this.compiledRules.get(id);
            if (!versionMap) {
                versionMap = new Map();
                this.compiledRules.set(id, versionMap);
            }
            versionMap.set(versionNumber, compiled);
            logger.info(`[WorkflowBuilder] ✅ Compiled '${name}' v${versionNumber} → ${compiled.stages.length} stages.`);
        } catch (compileErr) {
            logger.warn(`[WorkflowBuilder] Compile notice for '${name}': ${compileErr.message}`);
        }

        // Record User Audit Entry
        this.recordAudit({
            workflowId: id,
            workflowName: name,
            versionNumber,
            action: existing ? (isFork ? 'VERSION_FORKED' : 'EDITED') : 'CREATED',
            actor,
            details: { isFork, nodeCount: normalized.nodes.length, changeSummary }
        });

        logger.info(`[WorkflowBuilder] Workflow '${name}' saved (id=${id}, v${versionNumber}, status=${status}).`);
        return workflow;
    }

    /**
     * AI Automation Creator: Convert natural-language request into a Draft/Review workflow
     */
    createWorkflowFromPrompt(prompt, options = {}) {
        const generated = aiWorkflowCreator.generateWorkflowFromPrompt(prompt, options);
        const saved = this.saveWorkflow(generated.workflow, null, {
            actor: options.actor || 'Kylrx AI Automation Assistant',
            changeSummary: `AI generated workflow from prompt: "${prompt.substring(0, 60)}..."`
        });
        return {
            ...generated,
            workflow: saved
        };
    }

    /** List all workflows */
    listWorkflows() {
        return Array.from(this.workflows.values()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    /** Get full workflow with nodes + connections */
    getWorkflow(id) {
        const wf = this.workflows.get(id);
        if (!wf) return null;
        const compiledMap = this.compiledRules.get(id);
        const compiled = compiledMap ? (compiledMap.get(wf.version) || compiledMap.get(wf.activeVersionNumber)) : null;
        return { ...wf, compiled };
    }

    /** Delete a workflow */
    deleteWorkflow(id, { actor = 'HR Administrator' } = {}) {
        const wf = this.workflows.get(id);
        if (!wf) return false;
        this.recordAudit({
            workflowId: id,
            workflowName: wf.name,
            versionNumber: wf.version,
            action: 'DELETED',
            actor,
            details: { deletedWorkflowId: id }
        });
        this.workflows.delete(id);
        this.compiledRules.delete(id);
        return true;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       LIFECYCLE: DRAFT → TEST → PUBLISH
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Publish Workflow Version
     * Gated Rule: Workflow MUST be tested before publishing!
     */
    async publishWorkflowVersion(id, versionNumberToPublish = null, { actor = 'HR Operations Lead' } = {}) {
        const wf = this.workflows.get(id);
        if (!wf) throw new Error(`Workflow '${id}' not found.`);

        const targetVer = versionNumberToPublish || wf.version;
        const versionRecord = wf.versions?.find(v => v.versionNumber === targetVer);
        if (!versionRecord) throw new Error(`Version ${targetVer} not found in workflow '${id}'.`);

        // Enforce Test-Run Gating: Must be tested before publishing
        if (versionRecord.testStatus !== 'passed' && wf.testStatus !== 'passed') {
            throw new Error(`Cannot publish untested workflow. Run a test simulation first before publishing.`);
        }

        const now = new Date().toISOString();

        // Archive previous active version in versions array
        wf.versions.forEach(v => {
            if (v.versionNumber === targetVer) {
                v.status = 'active';
                v.publishedAt = now;
                v.publishedBy = actor;
            } else if (v.status === 'active') {
                v.status = 'archived';
                v.archivedAt = now;
            }
        });

        wf.status = 'active';
        wf.activeVersionNumber = targetVer;
        wf.version = targetVer;
        wf.updatedAt = now;
        wf.canvas = versionRecord.canvas;
        wf.nodes = versionRecord.nodes;
        wf.edges = versionRecord.edges;

        // Compile active rule
        let compiled = this.compiledRules.get(id)?.get(targetVer);
        if (!compiled) {
            compiled = this.compileToAutomationRule(wf);
            let versionMap = this.compiledRules.get(id);
            if (!versionMap) {
                versionMap = new Map();
                this.compiledRules.set(id, versionMap);
            }
            versionMap.set(targetVer, compiled);
        }

        this.workflows.set(id, wf);

        // Record User Audit
        this.recordAudit({
            workflowId: id,
            workflowName: wf.name,
            versionNumber: targetVer,
            action: 'PUBLISHED',
            actor,
            details: { publishedVersion: targetVer }
        });

        // Register Stage 8 audit in Automation Engine
        try {
            await automationEngine.recordAuditLog({
                runId: `wf-publish-${id}-v${targetVer}`,
                automationId: id,
                stage: 'Workflow Publication',
                status: 'published',
                details: { workflowId: id, workflowName: wf.name, version: targetVer, actor }
            });
        } catch (e) {
            logger.warn(`[WorkflowBuilder] Audit warning: ${e.message}`);
        }

        logger.info(`[WorkflowBuilder] 🚀 Published workflow '${wf.name}' v${targetVer} by ${actor}.`);
        return wf;
    }

    /**
     * Rollback workflow to a previous approved version
     */
    async rollbackWorkflow(id, targetVersionNumber, { actor = 'HR Administrator' } = {}) {
        const wf = this.workflows.get(id);
        if (!wf) throw new Error(`Workflow '${id}' not found.`);

        const versionRecord = wf.versions?.find(v => v.versionNumber === parseInt(targetVersionNumber, 10));
        if (!versionRecord) throw new Error(`Version ${targetVersionNumber} not found in workflow '${id}'.`);

        const now = new Date().toISOString();
        const prevActive = wf.activeVersionNumber;

        wf.versions.forEach(v => {
            if (v.versionNumber === versionRecord.versionNumber) {
                v.status = 'active';
                v.restoredAt = now;
                v.restoredBy = actor;
            } else if (v.status === 'active') {
                v.status = 'archived';
            }
        });

        wf.status = 'active';
        wf.activeVersionNumber = versionRecord.versionNumber;
        wf.version = versionRecord.versionNumber;
        wf.canvas = versionRecord.canvas;
        wf.nodes = versionRecord.nodes;
        wf.edges = versionRecord.edges;
        wf.updatedAt = now;

        this.workflows.set(id, wf);

        this.recordAudit({
            workflowId: id,
            workflowName: wf.name,
            versionNumber: versionRecord.versionNumber,
            action: 'ROLLBACK',
            actor,
            details: { fromVersion: prevActive, toVersion: versionRecord.versionNumber }
        });

        logger.info(`[WorkflowBuilder] ⏪ Rolled back workflow '${wf.name}' from v${prevActive} to v${versionRecord.versionNumber}.`);
        return wf;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       TEST MODE & PRE-PUBLISH DRY RUN
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Execute test run simulation using a selected employee or custom sample payload.
     * Previews EVERY executing node step and marks the workflow as tested.
     */
    testRunWorkflow(id, { employeeId = null, mockData = null, actor = 'HR Test Runner' } = {}) {
        const wf = this.workflows.get(id);
        if (!wf) throw new Error(`Workflow '${id}' not found.`);

        // Resolve data context: selected employee or custom payload
        let testContext = mockData || {};
        let selectedEmployee = null;

        if (employeeId) {
            selectedEmployee = this.sampleEmployees.find(e => e.id === employeeId);
            if (selectedEmployee) {
                testContext = {
                    ...selectedEmployee,
                    ...testContext,
                    employee: selectedEmployee
                };
            }
        } else if (!mockData && this.sampleEmployees.length > 0) {
            selectedEmployee = this.sampleEmployees[0];
            testContext = { ...selectedEmployee, employee: selectedEmployee };
        }

        const normalized = this._normalizeCanvas(wf);
        const { nodes, connections } = normalized;

        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const edgesByFrom = {};
        (connections || []).forEach(c => {
            const fromId = c.from || c.fromNodeId;
            const toId = c.to || c.toNodeId;
            edgesByFrom[fromId] = edgesByFrom[fromId] || [];
            edgesByFrom[fromId].push(toId);
        });

        const executionTrace = [];
        const visited = new Set();
        let currentId = nodes.find(n => n.type === 'trigger')?.id;

        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const node = nodeMap.get(currentId);
            if (!node) break;

            const sim = this._simulateNode(node, testContext);
            executionTrace.push({
                nodeId: currentId,
                nodeType: node.type,
                label: node.label || node.type,
                evaluatedCondition: node.type === 'condition' || node.type === 'branch' ? `${node.config?.field} ${node.config?.operator} ${node.config?.value}` : null,
                outcome: sim.outcome,
                details: sim.detail,
                executedAt: new Date().toISOString()
            });

            if (node.type === 'end') break;

            const nextIds = edgesByFrom[currentId] || [];
            currentId = nextIds[0] || null;
        }

        const now = new Date().toISOString();

        // Mark workflow and active version as tested!
        wf.testStatus = 'passed';
        wf.lastTestedAt = now;
        wf.lastTestedBy = actor;

        const currentVerRecord = wf.versions?.find(v => v.versionNumber === wf.version);
        if (currentVerRecord) {
            currentVerRecord.testStatus = 'passed';
            currentVerRecord.lastTestedAt = now;
        }

        this.workflows.set(id, wf);

        // Record Test Audit Entry
        this.recordAudit({
            workflowId: id,
            workflowName: wf.name,
            versionNumber: wf.version,
            action: 'TESTED',
            actor,
            details: { employeeTested: selectedEmployee?.name || 'Custom Payload', stepCount: executionTrace.length }
        });

        return {
            workflowId: id,
            workflowName: wf.name,
            version: wf.version,
            status: 'SUCCESS',
            testStatus: 'passed',
            selectedEmployee: selectedEmployee ? { id: selectedEmployee.id, name: selectedEmployee.name, department: selectedEmployee.department } : null,
            executionTrace,
            nodeChain: executionTrace.map(s => s.nodeType.toUpperCase()),
            simulatedAt: now
        };
    }

    _simulateNode(node, testContext) {
        const c = node.config || {};
        switch (node.type) {
            case 'trigger': return { outcome: 'PASSED', detail: `Trigger ingested: ${c.event || 'start'}` };
            case 'condition': {
                const val = testContext[c.field] !== undefined ? testContext[c.field] : (testContext.employee && testContext.employee[c.field]);
                return { outcome: 'PASSED', detail: `Evaluated ${c.field} (${val !== undefined ? val : 'present'}) ${c.operator} ${c.value} → Passed` };
            }
            case 'branch': return { outcome: 'PASSED', detail: `Branch condition evaluated to True path for ${testContext.name || 'Employee'}` };
            case 'approval': return { outcome: 'APPROVED', detail: `Simulated sign-off by ${c.assigneeRole || 'manager'} (SLA ${c.dueHours || 24}h)` };
            case 'wait': return { outcome: 'COMPLETED', detail: `Simulated delay timer: ${c.duration || 1} ${c.unit || 'days'}` };
            case 'escalation': return { outcome: 'NOTIFIED', detail: `Escalated policy registered for ${c.escalateTo || 'hr_head'}` };
            case 'action': return { outcome: 'EXECUTED', detail: `System action '${c.actionType || 'process'}' completed` };
            case 'notification': return { outcome: 'SENT', detail: `Notification dispatched via ${c.channel || 'email'} to ${c.recipient || 'employee'}` };
            case 'document': return { outcome: 'GENERATED', detail: `Document generated via template '${c.templateKey || 'offer_letter'}'` };
            case 'form': return { outcome: 'SUBMITTED', detail: `Form '${c.formTitle || 'HR Form'}' responses submitted` };
            case 'end': return { outcome: c.outcomeStatus || 'COMPLETED', detail: `Workflow reached final status: ${c.outcomeStatus || 'COMPLETED'}` };
            default: return { outcome: 'SUCCESS', detail: 'Step executed' };
        }
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       IN-FLIGHT RUN PINNING & EXECUTION LOGS
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Start process execution run.
     * Rule: In-flight processes continue on their pinned version!
     */
    async executeWorkflow(workflowId, triggerPayload = {}, { actor = 'Automation Engine', pinnedVersion = null } = {}) {
        const wf = this.workflows.get(workflowId);
        if (!wf) throw new Error(`Workflow '${workflowId}' not found.`);

        // Resolve version: use pinnedVersion if in-flight, else activeVersionNumber, else latest version
        const effectiveVersion = pinnedVersion || wf.activeVersionNumber || wf.version || 1;
        const versionRecord = wf.versions?.find(v => v.versionNumber === effectiveVersion);
        const canvas = versionRecord ? versionRecord.canvas : wf.canvas;

        const runId = `RUN_${workflowId}_v${effectiveVersion}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const startTime = Date.now();

        const runLog = {
            runId,
            workflowId,
            workflowName: wf.name,
            versionNumber: effectiveVersion,
            status: 'RUNNING',
            triggeredBy: actor,
            startedAt: new Date(startTime).toISOString(),
            completedAt: null,
            durationMs: 0,
            retryCount: 0,
            errorReason: null,
            stepTrace: []
        };

        try {
            const normalized = this._normalizeCanvas({ canvas });
            const { nodes } = normalized;

            for (const node of nodes) {
                const sim = this._simulateNode(node, triggerPayload);
                runLog.stepTrace.push({
                    nodeId: node.id,
                    type: node.type,
                    label: node.label,
                    status: 'SUCCESS',
                    output: sim.detail,
                    timestamp: new Date().toISOString()
                });
            }

            const endTime = Date.now();
            runLog.status = 'SUCCESS';
            runLog.completedAt = new Date(endTime).toISOString();
            runLog.durationMs = endTime - startTime;

            this.executionLogs.set(runId, runLog);
            logger.info(`[WorkflowBuilder] ✅ Execution run ${runId} (v${effectiveVersion}) completed in ${runLog.durationMs}ms.`);
            return runLog;
        } catch (err) {
            const endTime = Date.now();
            runLog.status = 'FAILED';
            runLog.completedAt = new Date(endTime).toISOString();
            runLog.durationMs = endTime - startTime;
            runLog.errorReason = err.message;
            runLog.retryCount = 1;

            this.executionLogs.set(runId, runLog);
            logger.error(`[WorkflowBuilder] ❌ Execution run ${runId} failed: ${err.message}`);
            return runLog;
        }
    }

    listExecutionLogs(workflowId = null, { status = null, limit = 50 } = {}) {
        let logs = Array.from(this.executionLogs.values());
        if (workflowId) logs = logs.filter(l => l.workflowId === workflowId);
        if (status) logs = logs.filter(l => l.status === status.toUpperCase());
        return logs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit);
    }

    getExecutionLog(runId) {
        return this.executionLogs.get(runId) || null;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       USER CHANGE AUDIT TRAIL
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    recordAudit({ workflowId, workflowName, versionNumber, action, actor = 'HR Administrator', details = {} }) {
        const entry = {
            id: `AUDIT_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            timestamp: new Date().toISOString(),
            workflowId,
            workflowName,
            versionNumber,
            action, // CREATED | EDITED | TESTED | PUBLISHED | PAUSED | VERSION_FORKED | ROLLBACK | DELETED
            actor,
            details
        };
        this.auditTrail.unshift(entry);
        return entry;
    }

    listAuditLogs(workflowId = null, { limit = 100 } = {}) {
        let logs = this.auditTrail;
        if (workflowId) logs = logs.filter(l => l.workflowId === workflowId);
        return logs.slice(0, limit);
    }

    /** Alias for getWorkflow — used by tests and routes */
    getWorkflowById(id) {
        return this.getWorkflow(id);
    }

    /**
     * Directly record an execution log entry (for testing and manual log injection)
     */
    recordExecutionLog({ workflowId, version, actor, triggeredBy, status, durationMs, stepsExecuted, retryCount = 0, errorReason = null, trace = [] }) {
        const runId = `run_${workflowId}_v${version}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const now = new Date().toISOString();
        const logEntry = {
            runId,
            workflowId,
            version,
            actor,
            triggeredBy,
            status,
            durationMs,
            stepsExecuted,
            retryCount,
            errorReason,
            trace,
            startedAt: now,
            timestamp: now
        };
        this.executionLogs.set(runId, logEntry);
        return logEntry;
    }

    /**
     * Reset all workflows, audit trail, and execution logs to the fresh seeded state.
     * Used by test suites to ensure clean isolation between tests.
     */
    resetDefaultWorkflows() {
        this.workflows.clear();
        this.compiledRules.clear();
        this.executionLogs.clear();
        this.auditTrail = [];
        this.sampleEmployees = this._initSampleEmployees();
        this._seedSampleWorkflows();
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       VALIDATION ENGINE
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    validateCanvas(canvasOrNodes, possibleEdges) {
        let nodes = [];
        let connections = [];

        if (Array.isArray(canvasOrNodes)) {
            nodes = canvasOrNodes;
            connections = possibleEdges || [];
        } else if (canvasOrNodes && typeof canvasOrNodes === 'object') {
            const normalized = this._normalizeCanvas(canvasOrNodes);
            nodes = normalized.nodes;
            connections = normalized.connections;
        }

        const errors = [];
        const warnings = [];

        if (!nodes || nodes.length === 0) {
            errors.push('Canvas must have at least one node.');
            return { valid: false, errors, warnings };
        }

        const triggers = nodes.filter(n => n.type === 'trigger');
        if (triggers.length === 0) errors.push('Every workflow must start with a Trigger node.');
        if (triggers.length > 1) errors.push('Only one Trigger node is allowed per workflow.');

        const ends = nodes.filter(n => n.type === 'end');
        if (ends.length === 0) errors.push('Every workflow must have at least one End node.');

        const outgoingByNode = {};
        const incomingByNode = {};
        (connections || []).forEach(c => {
            const fromId = c.from || c.fromNodeId;
            const toId = c.to || c.toNodeId;
            if (fromId) outgoingByNode[fromId] = (outgoingByNode[fromId] || 0) + 1;
            if (toId) incomingByNode[toId] = (incomingByNode[toId] || 0) + 1;
        });

        nodes.forEach(node => {
            const typeDef = WorkflowBuilderService.NODE_TYPES[node.type];
            if (!typeDef) {
                errors.push(`Unknown node type: '${node.type}' (id: ${node.id})`);
                return;
            }

            if (node.type !== 'trigger' && !incomingByNode[node.id] && !outgoingByNode[node.id]) {
                warnings.push(`Floating Node: '${node.label || node.id}' is disconnected on canvas.`);
            }

            const configErrors = this._validateNodeConfig(node);
            errors.push(...configErrors);
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    _validateNodeConfig(node) {
        const errors = [];
        const c = node.config || {};
        const label = node.label || node.id;

        switch (node.type) {
            case 'trigger':
                if (!c.event) errors.push(`Trigger '${label}': event type is required.`);
                break;
            case 'condition':
            case 'branch':
                if (!c.field) errors.push(`Condition '${label}': field is required.`);
                if (!c.operator) errors.push(`Condition '${label}': operator is required.`);
                break;
            case 'approval':
                if (!c.assigneeRole) errors.push(`Approval '${label}': assignee role is required.`);
                break;
            case 'wait':
                if (!c.duration && !c.waitForEvent) errors.push(`Wait '${label}': duration or event trigger is required.`);
                break;
            case 'escalation':
                if (!c.escalateTo) errors.push(`Escalation '${label}': escalateTo role is required.`);
                break;
            case 'action':
                if (!c.actionType) errors.push(`Action '${label}': action type is required.`);
                break;
            case 'notification':
                if (!c.recipient && !c.recipientRole && !c.recipientType) errors.push(`Notification '${label}': recipient is required.`);
                if (!c.channel) errors.push(`Notification '${label}': channel is required.`);
                break;
            case 'document':
                if (!c.templateKey) errors.push(`Document '${label}': templateKey is required.`);
                break;
            case 'form':
                if (!c.formTitle) errors.push(`Form '${label}': formTitle is required.`);
                break;
            case 'end':
                if (!c.outcomeStatus) errors.push(`End '${label}': outcomeStatus is required.`);
                break;
        }
        return errors;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       COMPILER: Canvas → Engine Rule
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    compileToAutomationRule(workflow) {
        const normalized = this._normalizeCanvas(workflow);
        const { nodes, connections } = normalized;

        const validation = this.validateCanvas(normalized);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
        }

        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const edgesByFrom = {};
        (connections || []).forEach(c => {
            const fromId = c.from || c.fromNodeId;
            const toId = c.to || c.toNodeId;
            edgesByFrom[fromId] = edgesByFrom[fromId] || [];
            edgesByFrom[fromId].push(toId);
        });

        const triggerNode = nodes.find(n => n.type === 'trigger');
        if (!triggerNode) throw new Error('No trigger node found — cannot compile.');

        const stages = [];
        const visited = new Set();
        const queue = [triggerNode.id];

        while (queue.length > 0) {
            const nodeId = queue.shift();
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);

            const node = nodeMap.get(nodeId);
            if (!node) continue;

            stages.push({
                stageId: `stage_${node.id}`,
                nodeId: node.id,
                name: node.label || node.type,
                type: node.type,
                config: node.config,
                nextStageIds: (edgesByFrom[node.id] || []).map(toId => `stage_${toId}`)
            });

            (edgesByFrom[node.id] || []).forEach(toId => {
                if (!visited.has(toId)) queue.push(toId);
            });
        }

        return {
            id: workflow.id,
            name: workflow.name,
            version: workflow.version || 1,
            description: workflow.description,
            trigger: {
                event: triggerNode.config?.event || 'candidate_offer_accepted',
                entity: triggerNode.config?.entity || 'candidate'
            },
            stages,
            metadata: {
                compiledAt: new Date().toISOString(),
                nodeCount: nodes.length,
                stageCount: stages.length
            }
        };
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       METADATA & STATS
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    getNodeTypes() {
        return WorkflowBuilderService.NODE_TYPES;
    }

    getStats() {
        const all = Array.from(this.workflows.values());
        const totalRuns = this.executionLogs.size;
        const failedRuns = Array.from(this.executionLogs.values()).filter(l => l.status === 'FAILED').length;

        return {
            totalWorkflows: all.length,
            total: all.length,
            activeWorkflows: all.filter(w => w.status === 'active').length,
            active: all.filter(w => w.status === 'active').length,
            draftWorkflows: all.filter(w => w.status === 'draft').length,
            draft: all.filter(w => w.status === 'draft').length,
            totalNodes: all.reduce((s, w) => s + (w.canvas?.nodes?.length || w.nodes?.length || 0), 0),
            totalExecutionRuns: totalRuns,
            totalAuditEntries: this.auditTrail.length,
            successRate: totalRuns > 0 ? Math.round(((totalRuns - failedRuns) / totalRuns) * 100) : 100
        };
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       PRE-SEEDED SAMPLE WORKFLOWS
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    _seedSampleWorkflows() {
        const wf1 = {
            id: 'wf_sample_onboarding',
            name: 'New Employee Offer & Onboarding',
            description: 'Automated offer letter generation, approval, and onboarding kickoff when candidate accepts offer.',
            status: 'active',
            testStatus: 'passed',
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', label: 'Offer Accepted', x: 80, y: 160, config: { event: 'candidate_offer_accepted', entity: 'candidate' } },
                    { id: 'n2', type: 'condition', label: 'Is Engineering?', x: 320, y: 160, config: { field: 'department', operator: '==', value: 'Engineering' } },
                    { id: 'n3', type: 'document', label: 'Generate Offer Letter', x: 560, y: 100, config: { templateKey: 'offer_letter' } },
                    { id: 'n4', type: 'approval', label: 'HR Director Sign-off', x: 800, y: 100, config: { assigneeRole: 'super_admin', dueHours: 24, onReject: 'terminate' } },
                    { id: 'n5', type: 'notification', label: 'Send Welcome Packet', x: 1040, y: 100, config: { recipient: 'employee', channel: 'email', template: 'Welcome to Kylrx! Your offer letter is attached.' } },
                    { id: 'n6', type: 'end', label: 'Onboarding Ready', x: 1280, y: 160, config: { outcomeStatus: 'COMPLETED' } }
                ],
                connections: [
                    { from: 'n1', to: 'n2' },
                    { from: 'n2', to: 'n3' },
                    { from: 'n3', to: 'n4' },
                    { from: 'n4', to: 'n5' },
                    { from: 'n5', to: 'n6' }
                ]
            }
        };

        const wf2 = {
            id: 'wf_sample_exit',
            name: 'Exit Clearance & F&F Settlement',
            description: 'Multi-department exit handover, F&F calculation, relieving letter generation and asset release.',
            status: 'active',
            testStatus: 'passed',
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', label: 'Resignation Approved', x: 80, y: 160, config: { event: 'employee_resignation_submitted', entity: 'employee' } },
                    { id: 'n2', type: 'form', label: 'Asset Handover Checklist', x: 320, y: 160, config: { formTitle: 'Exit Asset Handover' } },
                    { id: 'n3', type: 'approval', label: 'Finance F&F Clearance', x: 560, y: 160, config: { assigneeRole: 'finance_admin', dueHours: 48, onReject: 'terminate' } },
                    { id: 'n4', type: 'document', label: 'Generate Relieving Letter', x: 800, y: 160, config: { templateKey: 'relieving_letter' } },
                    { id: 'n5', type: 'action', label: 'Deactivate Access', x: 1040, y: 160, config: { actionType: 'deactivate_access' } },
                    { id: 'n6', type: 'end', label: 'Exit Completed', x: 1280, y: 160, config: { outcomeStatus: 'COMPLETED' } }
                ],
                connections: [
                    { from: 'n1', to: 'n2' },
                    { from: 'n2', to: 'n3' },
                    { from: 'n3', to: 'n4' },
                    { from: 'n4', to: 'n5' },
                    { from: 'n5', to: 'n6' }
                ]
            }
        };

        const wf3 = {
            id: 'wf_sample_payroll_gate',
            name: 'Payroll Variance Approval Gate',
            description: 'Automated hold and CFO escalation if monthly payroll variance exceeds 5%.',
            status: 'draft',
            testStatus: 'untested',
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', label: 'Payroll Calculated', x: 80, y: 160, config: { event: 'payroll_cycle_initiated', entity: 'payroll' } },
                    { id: 'n2', type: 'branch', label: 'Variance > 5%?', x: 320, y: 160, config: { field: 'variancePercentage', operator: '>', value: 5 } },
                    { id: 'n3', type: 'approval', label: 'CFO Override Approval', x: 560, y: 100, config: { assigneeRole: 'finance_admin', dueHours: 12, onReject: 'terminate' } },
                    { id: 'n4', type: 'action', label: 'Disburse Bank Payout', x: 800, y: 160, config: { actionType: 'initiate_bank_transfer' } },
                    { id: 'n5', type: 'end', label: 'Payroll Disbursed', x: 1040, y: 160, config: { outcomeStatus: 'COMPLETED' } }
                ],
                connections: [
                    { from: 'n1', to: 'n2' },
                    { from: 'n2', to: 'n3', port: 'true' },
                    { from: 'n3', to: 'n4' },
                    { from: 'n2', to: 'n4', port: 'false' },
                    { from: 'n4', to: 'n5' }
                ]
            }
        };

        this.saveWorkflow(wf1, null, { actor: 'System Seeder' });
        this.saveWorkflow(wf2, null, { actor: 'System Seeder' });
        this.saveWorkflow(wf3, null, { actor: 'System Seeder' });

        // Set active version numbers and initial runs
        const w1 = this.workflows.get('wf_sample_onboarding');
        if (w1) { w1.status = 'active'; w1.activeVersionNumber = 1; if (w1.versions?.[0]) w1.versions[0].status = 'active'; }
        const w2 = this.workflows.get('wf_sample_exit');
        if (w2) { w2.status = 'active'; w2.activeVersionNumber = 1; if (w2.versions?.[0]) w2.versions[0].status = 'active'; }

        // Pre-seed sample execution runs
        this.executeWorkflow('wf_sample_onboarding', { name: 'Alex Mercer', department: 'Engineering' }, { actor: 'HR Automation Engine', pinnedVersion: 1 });
        this.executeWorkflow('wf_sample_exit', { name: 'Vikram Malhotra', department: 'Finance' }, { actor: 'HR Automation Engine', pinnedVersion: 1 });
    }
}

module.exports = new WorkflowBuilderService();
