/**
 * No-Code Visual Workflow Builder Controller
 * Pure SVG + Vanilla JavaScript Canvas & Configuration Engine
 * Zero Code Required for HR Automation
 */

const API_HOST = window.location.port === '3000' 
    ? '' 
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3000' 
        : '');

const API_BASE = `${API_HOST}/api/workflow-builder`;

// Color map for node types
const NODE_COLORS = {
    trigger: '#6366f1',
    condition: '#f59e0b',
    branch: '#8b5cf6',
    approval: '#3b82f6',
    wait: '#14b8a6',
    escalation: '#f97316',
    action: '#10b981',
    notification: '#ec4899',
    document: '#eab308',
    form: '#06b6d4',
    end: '#ef4444'
};

const NODE_ICONS = {
    trigger: 'fa-bolt',
    condition: 'fa-filter',
    branch: 'fa-code-branch',
    approval: 'fa-user-check',
    wait: 'fa-clock',
    escalation: 'fa-level-up-alt',
    action: 'fa-play',
    notification: 'fa-paper-plane',
    document: 'fa-file-alt',
    form: 'fa-clipboard-list',
    end: 'fa-flag-checkered'
};

const DEFAULT_NODE_TYPES = {
    trigger: { name: "Trigger", label: "Trigger", color: "#6366f1", icon: "fa-bolt", category: "start", description: "Starts the workflow on a business or schedule event", requiredConfig: ["event"] },
    condition: { name: "Condition", label: "Condition", color: "#f59e0b", icon: "fa-filter", category: "logic", description: "Pass / Fail evaluation gate based on employee or system fields", requiredConfig: ["field","operator"] },
    branch: { name: "Branch", label: "Branch", color: "#8b5cf6", icon: "fa-code-branch", category: "logic", description: "Multi-way routing based on business rules or values", requiredConfig: ["field","operator"] },
    approval: { name: "Approval", label: "Approval", color: "#3b82f6", icon: "fa-user-check", category: "human", description: "Human sign-off gate with SLA deadline and escalation route", requiredConfig: ["assigneeRole"] },
    wait: { name: "Wait", label: "Wait", color: "#14b8a6", icon: "fa-clock", category: "control", description: "Delay step for duration or until external event occurs", requiredConfig: ["duration"] },
    escalation: { name: "Escalation", label: "Escalation", color: "#f97316", icon: "fa-level-up-alt", category: "control", description: "Automatic escalation upon SLA expiration or threshold breach", requiredConfig: ["escalateTo"] },
    action: { name: "Action", label: "Action", color: "#10b981", icon: "fa-play", category: "execute", description: "Executes automated HR system action or external webhook", requiredConfig: ["actionType"] },
    notification: { name: "Notification", label: "Notification", color: "#ec4899", icon: "fa-paper-plane", category: "execute", description: "Dispatches multi-channel notice (email, in-app, Slack)", requiredConfig: ["recipient","channel"] },
    document: { name: "Document", label: "Document", color: "#eab308", icon: "fa-file-alt", category: "execute", description: "Generates official document via Document Template Engine", requiredConfig: ["templateKey"] },
    form: { name: "Form", label: "Form", color: "#06b6d4", icon: "fa-clipboard-list", category: "human", description: "Captures structured input from employee or manager", requiredConfig: ["formTitle"] },
    end: { name: "End", label: "End", color: "#ef4444", icon: "fa-flag-checkered", category: "terminal", description: "Final step completing the workflow and recording status", requiredConfig: ["outcomeStatus"] }
};

const DEFAULT_WORKFLOWS = [
    {
        id: "wf_sample_onboarding",
        name: "New Employee Offer & Onboarding",
        description: "Automated offer letter generation, approval, and onboarding kickoff when candidate accepts offer.",
        status: "active",
        version: 1,
        activeVersionNumber: 1,
        canvas: {
            nodes: [
                { id: "n1", type: "trigger", label: "Offer Accepted", x: 80, y: 160, position: { x: 80, y: 160 }, config: { event: "candidate_offer_accepted", entity: "candidate", label: "Offer Accepted", outcomeStatus: "COMPLETED" } },
                { id: "n2", type: "condition", label: "Is Engineering?", x: 320, y: 160, position: { x: 320, y: 160 }, config: { field: "department", operator: "==", value: "Engineering", label: "Is Engineering?", outcomeStatus: "COMPLETED" } },
                { id: "n3", type: "document", label: "Generate Offer Letter", x: 560, y: 100, position: { x: 560, y: 100 }, config: { templateKey: "offer_letter", label: "Generate Offer Letter", outcomeStatus: "COMPLETED" } },
                { id: "n4", type: "approval", label: "HR Director Sign-off", x: 800, y: 100, position: { x: 800, y: 100 }, config: { assigneeRole: "super_admin", dueHours: 24, onReject: "terminate", label: "HR Director Sign-off", outcomeStatus: "COMPLETED" } },
                { id: "n5", type: "notification", label: "Send Welcome Packet", x: 1040, y: 100, position: { x: 1040, y: 100 }, config: { recipient: "employee", channel: "email", template: "Welcome to Kylrx! Your offer letter is attached.", label: "Send Welcome Packet", outcomeStatus: "COMPLETED" } },
                { id: "n6", type: "end", label: "Onboarding Ready", x: 1280, y: 160, position: { x: 1280, y: 160 }, config: { outcomeStatus: "COMPLETED", label: "Onboarding Ready" } }
            ],
            connections: [
                { id: "conn_1", from: "n1", to: "n2", fromNodeId: "n1", toNodeId: "n2", port: "out", label: "" },
                { id: "conn_2", from: "n2", to: "n3", fromNodeId: "n2", toNodeId: "n3", port: "out", label: "" },
                { id: "conn_3", from: "n3", to: "n4", fromNodeId: "n3", toNodeId: "n4", port: "out", label: "" },
                { id: "conn_4", from: "n4", to: "n5", fromNodeId: "n4", toNodeId: "n5", port: "out", label: "" },
                { id: "conn_5", from: "n5", to: "n6", fromNodeId: "n5", toNodeId: "n6", port: "out", label: "" }
            ]
        }
    }
];

// Application State
const state = {
    currentWorkflow: {
        id: null,
        name: 'New Workflow',
        description: 'Automated multi-stage HR process',
        status: 'draft',
        canvas: {
            nodes: [],
            connections: []
        }
    },
    workflows: [...DEFAULT_WORKFLOWS],
    nodeTypes: { ...DEFAULT_NODE_TYPES },
    sampleEmployees: [],
    versions: [],
    selectedVersionNumber: 1,
    selectedNodeId: null,
    scale: 1,
    panX: 0,
    panY: 0,
    isDraggingCanvas: false,
    dragStart: { x: 0, y: 0 },
    connectingFromNodeId: null,
    connectingFromPort: null
};

// Switch left panel tab
window.switchLeftTab = function(tabName) {
    const tabs = ['palette', 'workflows', 'logs', 'audit'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}-btn`);
        const content = document.getElementById(`tab-${t}-content`);
        if (btn) {
            if (t === tabName) btn.classList.add('active');
            else btn.classList.remove('active');
        }
        if (content) {
            content.style.display = t === tabName ? 'block' : 'none';
        }
    });

    if (tabName === 'workflows') {
        loadWorkflowsList();
    } else if (tabName === 'logs') {
        loadExecutionLogs();
    } else if (tabName === 'audit') {
        loadAuditTrail();
    }
};

// Toast notification helper
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
    toast.innerHTML = `<i class="fas fa-${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Set AI prompt from chip click
window.setAiPrompt = function(promptText) {
    const input = document.getElementById('ai-prompt-input');
    if (input) {
        input.value = promptText;
        input.focus();
    }
};

// ─── INITIALIZATION ───
document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
    setupCanvasEvents();
    setupPaletteDragEvents();
    setupToolbarEvents();
    setupAiCreatorEvents();
    setupTestModeEvents();
    await fetchNodeTypes();
    await fetchStats();
    await fetchSampleEmployees();
    await loadWorkflowsList();
    
    // Auto-load first workflow if available, else new workflow
    if (state.workflows.length > 0) {
        await loadWorkflow(state.workflows[0].id);
    } else {
        newWorkflow();
    }
});

// ─── API CALLS ───
async function fetchSampleEmployees() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${API_BASE}/sample-employees`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.employees) {
                state.sampleEmployees = json.employees;
                populateEmployeeSelector(json.employees);
                return;
            }
        }
    } catch (err) {
        // Backend offline - use resilient fallback employees
    }
    
    // Fallback catalog
    const fallbackEmployees = [
        { id: 'emp_01', name: 'Aarav Sharma', role: 'Senior Full Stack Engineer', department: 'Engineering' },
        { id: 'emp_02', name: 'Priya Nair', role: 'Product Operations Lead', department: 'Product' },
        { id: 'emp_03', name: 'Rohan Gupta', role: 'DevOps & Cloud Specialist', department: 'Infrastructure' }
    ];
    state.sampleEmployees = fallbackEmployees;
    populateEmployeeSelector(fallbackEmployees);
}

function populateEmployeeSelector(employees) {
    const selectEl = document.getElementById('test-employee-select');
    if (selectEl) {
        selectEl.innerHTML = '<option value="">-- Choose Sample Employee --</option>';
        employees.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = `${emp.name} — ${emp.role} (${emp.department})`;
            selectEl.appendChild(opt);
        });
    }
}

async function fetchNodeTypes() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${API_BASE}/node-types`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.nodeTypes) {
                state.nodeTypes = json.nodeTypes;
                return;
            }
        }
    } catch (err) {
        // Quiet fallback to built-in node types
    }
    state.nodeTypes = { ...DEFAULT_NODE_TYPES };
}

async function fetchStats() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${API_BASE}/stats`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.stats) {
                const stats = json.stats;
                const totalEl = document.getElementById('stat-total');
                const activeEl = document.getElementById('stat-active');
                const draftEl = document.getElementById('stat-draft');
                if (totalEl) totalEl.textContent = stats.totalWorkflows || stats.total || state.workflows.length;
                if (activeEl) activeEl.textContent = stats.activeWorkflows || stats.active || 0;
                if (draftEl) draftEl.textContent = stats.draftWorkflows || stats.draft || 0;
                return;
            }
        }
    } catch (err) {
        // Quiet fallback
    }
    const totalEl = document.getElementById('stat-total');
    const activeEl = document.getElementById('stat-active');
    const draftEl = document.getElementById('stat-draft');
    if (totalEl) totalEl.textContent = state.workflows.length;
    if (activeEl) activeEl.textContent = state.workflows.filter(w => w.status === 'active').length;
    if (draftEl) draftEl.textContent = state.workflows.filter(w => w.status !== 'active').length;
}

async function loadWorkflowsList() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${API_BASE}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.workflows) {
                state.workflows = json.workflows;
                renderWorkflowList();
                return;
            }
        }
    } catch (err) {
        // Fallback to local workflows
    }
    if (!state.workflows || state.workflows.length === 0) {
        state.workflows = [...DEFAULT_WORKFLOWS];
    }
    renderWorkflowList();
}

function renderWorkflowList() {
    const list = document.getElementById('workflow-list');
    if (!list) return;
    list.innerHTML = '';

    if (state.workflows.length === 0) {
        list.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px;">No workflows found</div>';
        return;
    }

    state.workflows.forEach(wf => {
        const item = document.createElement('div');
        item.className = `workflow-item ${state.currentWorkflow.id === wf.id ? 'active' : ''}`;
        item.innerHTML = `
            <div class="workflow-item-header">
                <div class="workflow-item-name">${wf.name}</div>
                <span class="status-badge ${wf.status}">${wf.status}</span>
            </div>
            <div class="workflow-item-desc">${wf.description || 'No description'}</div>
            <div class="workflow-item-footer">
                <span>${wf.canvas?.nodes?.length || 0} nodes</span>
                <span>v${wf.version || wf.activeVersionNumber || 1}</span>
            </div>
        `;
        item.onclick = () => loadWorkflow(wf.id);
        list.appendChild(item);
    });
}

async function loadWorkflow(id) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`${API_BASE}/${id}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const json = await res.json();
            if (json.success && json.workflow) {
                state.currentWorkflow = json.workflow;
                document.getElementById('workflow-name-input').value = json.workflow.name;
                document.getElementById('workflow-desc-input').value = json.workflow.description || '';
                
                const badge = document.getElementById('workflow-status-badge');
                badge.className = `status-badge ${json.workflow.status}`;
                badge.textContent = json.workflow.status;

                // Toggle AI Review Mode Banner
                const reviewBanner = document.getElementById('ai-review-banner');
                if (reviewBanner) {
                    reviewBanner.style.display = (json.workflow.isAiGenerated && json.workflow.status === 'draft') ? 'flex' : 'none';
                }

                // Populate Version Selector
                populateVersionSelector(json.workflow);

                state.selectedNodeId = null;
                renderCanvas();
                renderWorkflowList();
                renderConfigPanel();
                showToast(`Loaded "${json.workflow.name}"`, 'info');
                return;
            }
        }
    } catch (err) {
        // Fallback local matching
    }
    
    // Check local fallback
    const local = state.workflows.find(w => w.id === id);
    if (local) {
        state.currentWorkflow = local;
        document.getElementById('workflow-name-input').value = local.name;
        document.getElementById('workflow-desc-input').value = local.description || '';
        const badge = document.getElementById('workflow-status-badge');
        if (badge) {
            badge.className = `status-badge ${local.status}`;
            badge.textContent = local.status;
        }
        populateVersionSelector(local);
        state.selectedNodeId = null;
        renderCanvas();
        renderWorkflowList();
        renderConfigPanel();
        showToast(`Loaded "${local.name}"`, 'info');
    } else {
        showToast('Workflow not found', 'error');
    }
}

function populateVersionSelector(workflow) {
    const versionSelect = document.getElementById('version-selector');
    const rollbackBtn = document.getElementById('btn-rollback-version');
    if (!versionSelect) return;

    versionSelect.innerHTML = '';
    const versions = workflow.versions && workflow.versions.length > 0
        ? workflow.versions
        : [{ versionNumber: workflow.version || 1, status: workflow.status || 'draft' }];

    state.versions = versions;
    const currentVer = workflow.version || workflow.activeVersionNumber || 1;
    state.selectedVersionNumber = currentVer;

    versions.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.versionNumber;
        const isCurrentActive = v.versionNumber === workflow.activeVersionNumber;
        opt.textContent = `v${v.versionNumber} (${capitalize(v.status || 'draft')}${isCurrentActive ? ' - Live' : ''})`;
        if (v.versionNumber === currentVer) opt.selected = true;
        versionSelect.appendChild(opt);
    });

    if (rollbackBtn) {
        rollbackBtn.style.display = (currentVer < (workflow.activeVersionNumber || 1)) ? 'inline-flex' : 'none';
    }
}

async function loadExecutionLogs() {
    const container = document.getElementById('execution-logs-list');
    if (!container) return;

    if (!state.currentWorkflow || !state.currentWorkflow.id) {
        container.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:15px;">Save workflow to view execution logs</div>';
        return;
    }

    container.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:15px;"><i class="fas fa-spinner fa-spin"></i> Loading execution runs...</div>';

    try {
        const res = await fetch(`${API_BASE}/${state.currentWorkflow.id}/execution-logs`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.success) {
            const logs = json.executionLogs || [];
            if (logs.length === 0) {
                container.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:15px;">No execution runs recorded yet</div>';
                return;
            }

            container.innerHTML = '';
            logs.forEach(log => {
                const item = document.createElement('div');
                item.className = 'log-item';
                const statusClass = log.status === 'SUCCESS' ? 'badge-success' 
                    : log.status === 'FAILED' ? 'badge-failed' 
                    : log.status === 'RETRY' ? 'badge-retry' : 'badge-running';
                
                const timeStr = new Date(log.startedAt || log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <div>
                            <span class="item-badge ${statusClass}">${log.status}</span>
                            <span style="font-size:10px; color:var(--accent-purple); font-weight:700; margin-left:4px;">v${log.version || 1}</span>
                        </div>
                        <span style="font-size:10px; color:var(--text-muted);">${timeStr}</span>
                    </div>
                    <div style="font-weight:600; color:var(--text-primary); margin-bottom:2px;">
                        ${log.runId} <span style="font-weight:400; font-size:10.5px; color:var(--text-secondary);">&bull; by ${log.actor || 'System'}</span>
                    </div>
                    <div style="color:var(--text-secondary); font-size:10.5px;">
                        Steps: ${log.stepsExecuted || 0} &bull; Duration: ${log.durationMs || 0}ms
                        ${log.retryCount ? ` &bull; <strong style="color:var(--accent-gold);">Retries: ${log.retryCount}</strong>` : ''}
                    </div>
                    ${log.errorReason ? `<div style="margin-top:4px; font-size:10.5px; color:var(--accent-red); background:rgba(239,68,68,0.1); padding:4px 6px; border-radius:4px;">Error: ${log.errorReason}</div>` : ''}
                `;
                container.appendChild(item);
            });
        }
    } catch (err) {
        container.innerHTML = `<div style="color:var(--accent-red);font-size:11.5px;padding:10px;">Failed to load logs: ${err.message}</div>`;
    }
}

async function loadAuditTrail() {
    const container = document.getElementById('audit-trail-list');
    if (!container) return;

    if (!state.currentWorkflow || !state.currentWorkflow.id) {
        container.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:15px;">Save workflow to view audit history</div>';
        return;
    }

    container.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:15px;"><i class="fas fa-spinner fa-spin"></i> Loading audit trail...</div>';

    try {
        const res = await fetch(`${API_BASE}/${state.currentWorkflow.id}/audit-trail`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.success) {
            const audits = json.auditTrail || [];
            if (audits.length === 0) {
                container.innerHTML = '<div style="font-size:11.5px;color:var(--text-muted);text-align:center;padding:15px;">No audit events recorded yet</div>';
                return;
            }

            container.innerHTML = '';
            audits.forEach(audit => {
                const item = document.createElement('div');
                item.className = 'audit-item';
                const timeStr = new Date(audit.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <div>
                            <span class="item-badge badge-action">${audit.action}</span>
                            <span style="font-size:10px; color:var(--accent-purple); font-weight:700; margin-left:4px;">v${audit.version || 1}</span>
                        </div>
                        <span style="font-size:10px; color:var(--text-muted);">${timeStr}</span>
                    </div>
                    <div style="color:var(--text-primary); font-size:11px; margin-bottom:2px;">
                        ${audit.details || 'Workflow updated'}
                    </div>
                    <div style="color:var(--text-muted); font-size:10px;">
                        Actor: <strong style="color:var(--text-secondary);">${audit.actor || 'System'}</strong> &bull; ${new Date(audit.timestamp).toLocaleDateString()}
                    </div>
                `;
                container.appendChild(item);
            });
        }
    } catch (err) {
        container.innerHTML = `<div style="color:var(--accent-red);font-size:11.5px;padding:10px;">Failed to load audit: ${err.message}</div>`;
    }
}

function newWorkflow() {
    state.currentWorkflow = {
        id: null,
        name: 'New Workflow',
        description: 'Automated multi-stage HR process',
        status: 'draft',
        isAiGenerated: false,
        canvas: {
            nodes: [
                {
                    id: 'node_' + Math.random().toString(36).substr(2, 6),
                    type: 'trigger',
                    label: 'Workflow Trigger',
                    x: 100,
                    y: 120,
                    config: { event: 'candidate_offer_accepted', entity: 'candidate' }
                }
            ],
            connections: []
        }
    };
    document.getElementById('workflow-name-input').value = state.currentWorkflow.name;
    document.getElementById('workflow-desc-input').value = state.currentWorkflow.description;
    const badge = document.getElementById('workflow-status-badge');
    badge.className = 'status-badge draft';
    badge.textContent = 'draft';

    const reviewBanner = document.getElementById('ai-review-banner');
    if (reviewBanner) reviewBanner.style.display = 'none';

    state.selectedNodeId = state.currentWorkflow.canvas.nodes[0].id;
    renderCanvas();
    renderConfigPanel();
    showToast('Created new canvas', 'info');
}

// ─── CANVAS RENDERING & INTERACTION ───
function renderCanvas() {
    const nodesLayer = document.getElementById('nodes-layer');
    const svgCanvas = document.getElementById('svg-canvas');
    if (!nodesLayer || !svgCanvas) return;

    nodesLayer.innerHTML = '';
    svgCanvas.innerHTML = '';

    const nodes = state.currentWorkflow.canvas.nodes || [];
    const connections = state.currentWorkflow.canvas.connections || [];

    // Update node count in stats bar
    const nodeCountEl = document.getElementById('stat-nodes');
    if (nodeCountEl) nodeCountEl.textContent = nodes.length;

    // Render Connections (SVG Bezier curves)
    connections.forEach(conn => {
        const fromNode = nodes.find(n => n.id === conn.from);
        const toNode = nodes.find(n => n.id === conn.to);
        if (fromNode && toNode) {
            renderConnection(fromNode, toNode, conn);
        }
    });

    // Render Node Cards
    nodes.forEach(node => {
        const card = createNodeElement(node);
        nodesLayer.appendChild(card);
    });
}

function renderConnection(fromNode, toNode, conn) {
    const svgCanvas = document.getElementById('svg-canvas');
    
    let fromX = fromNode.x + 110;
    let fromY = fromNode.y + 70; // bottom center
    if (conn.port === 'true') fromX = fromNode.x + 66;
    if (conn.port === 'false') fromX = fromNode.x + 154;

    const toX = toNode.x + 110;
    const toY = toNode.y; // top center

    const dx = Math.abs(toX - fromX);
    const dy = Math.max(Math.abs(toY - fromY), 50);
    const cpY1 = fromY + Math.max(dy * 0.5, 40);
    const cpY2 = toY - Math.max(dy * 0.5, 40);

    const pathData = `M ${fromX} ${fromY} C ${fromX} ${cpY1}, ${toX} ${cpY2}, ${toX} ${toY}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let lineClass = 'flow-line';
    if (conn.port === 'true') lineClass += ' branch-true';
    if (conn.port === 'false') lineClass += ' branch-false';
    path.setAttribute('class', lineClass);
    path.setAttribute('d', pathData);
    path.setAttribute('id', `conn_${conn.from}_${conn.to}`);

    // Click to delete connection
    path.addEventListener('click', (e) => {
        e.stopPropagation();
        state.currentWorkflow.canvas.connections = state.currentWorkflow.canvas.connections.filter(c => c !== conn);
        renderCanvas();
        showToast('Connection removed', 'info');
    });

    svgCanvas.appendChild(path);
}

function createNodeElement(node) {
    const card = document.createElement('div');
    card.className = `canvas-node ${state.selectedNodeId === node.id ? 'selected' : ''}`;
    card.id = `canvas_node_${node.id}`;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;

    const icon = NODE_ICONS[node.type] || 'fa-cog';
    const color = NODE_COLORS[node.type] || '#6366f1';

    let summaryText = getNodeSummary(node);

    let portsHtml = '';
    // Input port (top) - except triggers
    if (node.type !== 'trigger') {
        portsHtml += `<div class="node-port node-port-in" data-port="in" title="Incoming Flow"></div>`;
    }
    // Output ports (bottom)
    if (node.type === 'branch') {
        portsHtml += `<div class="node-port node-port-out-true" data-port="true" title="True / Yes Path"></div>`;
        portsHtml += `<div class="node-port node-port-out-false" data-port="false" title="False / No Path"></div>`;
    } else if (node.type !== 'end') {
        portsHtml += `<div class="node-port node-port-out" data-port="out" title="Next Step"></div>`;
    }

    card.innerHTML = `
        ${portsHtml}
        <div class="canvas-node-header" style="background: rgba(${hexToRgb(color)}, 0.12)">
            <div class="canvas-node-icon" style="background: ${color};"><i class="fas ${icon}"></i></div>
            <div style="flex:1;min-width:0;">
                <div class="canvas-node-type-label">${node.type}</div>
                <div class="canvas-node-label">${node.label}</div>
            </div>
        </div>
        <div class="canvas-node-body">${summaryText}</div>
    `;

    // Drag Node Repositioning
    let isDragging = false;
    let startX = 0, startY = 0;
    let nodeStartX = 0, nodeStartY = 0;

    card.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('node-port')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        nodeStartX = node.x;
        nodeStartY = node.y;
        selectNode(node.id);
        e.stopPropagation();

        const onMouseMove = (moveEvent) => {
            if (!isDragging) return;
            const dx = (moveEvent.clientX - startX) / state.scale;
            const dy = (moveEvent.clientY - startY) / state.scale;
            // Snap to 10px grid
            node.x = Math.round((nodeStartX + dx) / 10) * 10;
            node.y = Math.round((nodeStartY + dy) / 10) * 10;
            card.style.left = `${node.x}px`;
            card.style.top = `${node.y}px`;
            renderConnectionsOnly();
        };

        const onMouseUp = () => {
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });

    // Port Connection Click / Drag
    card.querySelectorAll('.node-port').forEach(portEl => {
        portEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const portType = portEl.getAttribute('data-port');
            if (portType === 'in') {
                if (state.connectingFromNodeId && state.connectingFromNodeId !== node.id) {
                    // Create connection
                    addConnection(state.connectingFromNodeId, node.id, state.connectingFromPort);
                    state.connectingFromNodeId = null;
                    state.connectingFromPort = null;
                    renderCanvas();
                }
            } else {
                state.connectingFromNodeId = node.id;
                state.connectingFromPort = portType;
                showToast(`Connecting from ${node.label}... Click target node input port`, 'info');
            }
        });
    });

    return card;
}

function renderConnectionsOnly() {
    const svgCanvas = document.getElementById('svg-canvas');
    if (!svgCanvas) return;
    svgCanvas.innerHTML = '';
    const nodes = state.currentWorkflow.canvas.nodes || [];
    const connections = state.currentWorkflow.canvas.connections || [];
    connections.forEach(conn => {
        const fromNode = nodes.find(n => n.id === conn.from);
        const toNode = nodes.find(n => n.id === conn.to);
        if (fromNode && toNode) {
            renderConnection(fromNode, toNode, conn);
        }
    });
}

function getNodeSummary(node) {
    const cfg = node.config || {};
    switch (node.type) {
        case 'trigger':
            return `Event: <strong>${cfg.event || 'None'}</strong>`;
        case 'condition':
            return `Check: <code>${cfg.field || 'field'} ${cfg.operator || '=='} ${cfg.value || 'val'}</code>`;
        case 'branch':
            return `Branch: <code>${cfg.field || 'field'} ${cfg.operator || '=='} ${cfg.value || 'val'}</code>`;
        case 'approval':
            return `Approver: <strong>${cfg.assigneeRole || 'manager'}</strong> (${cfg.dueHours || 24}h)`;
        case 'wait':
            return `Delay: <strong>${cfg.duration || 1} ${cfg.unit || 'days'}</strong>`;
        case 'escalation':
            return `Escalate to: <strong>${cfg.escalateTo || 'hr_head'}</strong> (SLA ${cfg.slaHours || 48}h)`;
        case 'action':
            return `Task: <strong>${cfg.actionType || 'execute'}</strong>`;
        case 'notification':
            return `Notify: <strong>${cfg.recipient || 'employee'}</strong> (${cfg.channel || 'email'})`;
        case 'document':
            return `Generate: <strong>${cfg.templateKey || 'offer_letter'}</strong>`;
        case 'form':
            return `Capture: <strong>${cfg.formTitle || 'HR Form'}</strong>`;
        case 'end':
            return `Outcome: <strong>${cfg.outcomeStatus || 'COMPLETED'}</strong>`;
        default:
            return 'Configured';
    }
}

function addConnection(fromId, toId, port = 'out') {
    const exists = state.currentWorkflow.canvas.connections.some(c => c.from === fromId && c.to === toId && c.port === port);
    if (!exists) {
        state.currentWorkflow.canvas.connections.push({ from: fromId, to: toId, port: port });
        showToast('Nodes connected', 'success');
    }
}

function selectNode(nodeId) {
    state.selectedNodeId = nodeId;
    document.querySelectorAll('.canvas-node').forEach(el => el.classList.remove('selected'));
    const target = document.getElementById(`canvas_node_${nodeId}`);
    if (target) target.classList.add('selected');
    renderConfigPanel();
}

// ─── NO-CODE CONFIGURATION PANEL GENERATOR ───
function renderConfigPanel() {
    const panelBody = document.getElementById('config-panel-body');
    const panelHeading = document.getElementById('config-panel-heading');
    const iconEl = document.getElementById('config-node-icon');
    if (!panelBody) return;

    if (!state.selectedNodeId) {
        panelHeading.textContent = 'Node Properties';
        panelBody.innerHTML = `
            <div class="config-empty-state">
                <i class="fas fa-mouse-pointer"></i>
                <p>Select any node on the canvas to configure properties</p>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
                    100% No-Code: Point & click setup.<br>HR never writes Firebase, Python, JS or API code.
                </div>
            </div>
        `;
        return;
    }

    const node = state.currentWorkflow.canvas.nodes.find(n => n.id === state.selectedNodeId);
    if (!node) return;

    const color = NODE_COLORS[node.type] || '#6366f1';
    const icon = NODE_ICONS[node.type] || 'fa-cog';
    iconEl.style.background = color;
    iconEl.innerHTML = `<i class="fas ${icon}"></i>`;
    panelHeading.textContent = `${node.type.toUpperCase()}: ${node.label}`;

    // Zero-Code Assurance Banner
    let formHtml = `
        <div class="no-code-indicator">
            <i class="fas fa-shield-alt" style="color:#10b981; font-size:14px;"></i>
            <div>
                <strong>HR No-Code Mode Active</strong>
                <div style="font-size:10px; color:var(--text-muted);">Visual configuration only. No Firebase, Python, JS or API code.</div>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">Step Label</label>
            <input type="text" class="form-control" id="cfg-node-label" value="${node.label || ''}" />
        </div>
    `;

    const cfg = node.config || {};

    if (node.type === 'trigger') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Trigger Event</label>
                <select class="form-control" id="cfg-trigger-event">
                    <option value="candidate_offer_accepted" ${cfg.event === 'candidate_offer_accepted' ? 'selected' : ''}>Candidate Offer Accepted</option>
                    <option value="employee_resignation_submitted" ${cfg.event === 'employee_resignation_submitted' ? 'selected' : ''}>Employee Resignation Submitted</option>
                    <option value="payroll_cycle_initiated" ${cfg.event === 'payroll_cycle_initiated' ? 'selected' : ''}>Payroll Cycle Initiated</option>
                    <option value="leave_application_filed" ${cfg.event === 'leave_application_filed' ? 'selected' : ''}>Leave Application Filed</option>
                    <option value="probation_review_due" ${cfg.event === 'probation_review_due' ? 'selected' : ''}>Probation Review Due</option>
                    <option value="statutory_filing_deadline" ${cfg.event === 'statutory_filing_deadline' ? 'selected' : ''}>Statutory Filing Deadline</option>
                    <option value="appraisal_cycle_launched" ${cfg.event === 'appraisal_cycle_launched' ? 'selected' : ''}>Appraisal Cycle Launched</option>
                    <option value="consecutive_absence_flagged" ${cfg.event === 'consecutive_absence_flagged' ? 'selected' : ''}>3 Consecutive Absent Days Flagged</option>
                    <option value="new_hire_joined" ${cfg.event === 'new_hire_joined' ? 'selected' : ''}>New Hire First Day</option>
                    <option value="contract_expiry_due" ${cfg.event === 'contract_expiry_due' ? 'selected' : ''}>Contract / SOW Expiry Approaching</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Target Entity</label>
                <select class="form-control" id="cfg-trigger-entity">
                    <option value="employee" ${cfg.entity === 'employee' ? 'selected' : ''}>Employee Master Record</option>
                    <option value="candidate" ${cfg.entity === 'candidate' ? 'selected' : ''}>Candidate Profile</option>
                    <option value="payroll" ${cfg.entity === 'payroll' ? 'selected' : ''}>Payroll Disbursement Batch</option>
                    <option value="leave" ${cfg.entity === 'leave' ? 'selected' : ''}>Leave Application</option>
                    <option value="compliance" ${cfg.entity === 'compliance' ? 'selected' : ''}>Statutory / PF Compliance Record</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Scope Filter</label>
                <select class="form-control" id="cfg-trigger-scope">
                    <option value="all" ${cfg.scope === 'all' ? 'selected' : ''}>All Departments & Locations</option>
                    <option value="engineering" ${cfg.scope === 'engineering' ? 'selected' : ''}>Engineering & Product</option>
                    <option value="sales" ${cfg.scope === 'sales' ? 'selected' : ''}>Sales & Marketing</option>
                    <option value="operations" ${cfg.scope === 'operations' ? 'selected' : ''}>Operations & Support</option>
                    <option value="full_time" ${cfg.scope === 'full_time' ? 'selected' : ''}>Full-Time Staff Only</option>
                </select>
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-bolt" style="color:var(--node-trigger);"></i> Workflow triggers automatically upon event detection. Zero webhooks or API coding needed.
            </div>
        `;
    } else if (node.type === 'condition' || node.type === 'branch') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Evaluation Field</label>
                <select class="form-control" id="cfg-cond-field">
                    <option value="designation" ${cfg.field === 'designation' ? 'selected' : ''}>Designation / Role</option>
                    <option value="department" ${cfg.field === 'department' ? 'selected' : ''}>Department</option>
                    <option value="employmentType" ${cfg.field === 'employmentType' ? 'selected' : ''}>Employment Type</option>
                    <option value="ctc" ${cfg.field === 'ctc' ? 'selected' : ''}>CTC / Compensation</option>
                    <option value="variancePercentage" ${cfg.field === 'variancePercentage' ? 'selected' : ''}>Payroll Variance %</option>
                    <option value="tenureMonths" ${cfg.field === 'tenureMonths' ? 'selected' : ''}>Tenure (Months)</option>
                    <option value="performanceRating" ${cfg.field === 'performanceRating' ? 'selected' : ''}>Performance Rating (1-5)</option>
                    <option value="consecutiveAbsences" ${cfg.field === 'consecutiveAbsences' ? 'selected' : ''}>Consecutive Absences (Days)</option>
                    <option value="probationStatus" ${cfg.field === 'probationStatus' ? 'selected' : ''}>Probation Clearance</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Operator</label>
                <select class="form-control" id="cfg-cond-op">
                    <option value="==" ${cfg.operator === '==' ? 'selected' : ''}>Equals (==)</option>
                    <option value="!=" ${cfg.operator === '!=' ? 'selected' : ''}>Not Equals (!=)</option>
                    <option value=">" ${cfg.operator === '>' ? 'selected' : ''}>Greater Than (&gt;)</option>
                    <option value="<" ${cfg.operator === '<' ? 'selected' : ''}>Less Than (&lt;)</option>
                    <option value=">=" ${cfg.operator === '>=' ? 'selected' : ''}>Greater Than or Equal (&gt;=)</option>
                    <option value="<=" ${cfg.operator === '<=' ? 'selected' : ''}>Less Than or Equal (&lt;=)</option>
                    <option value="contains" ${cfg.operator === 'contains' ? 'selected' : ''}>Contains Text</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Comparison Value</label>
                <input type="text" class="form-control" id="cfg-cond-val" value="${cfg.value !== undefined ? cfg.value : ''}" placeholder="e.g. Engineering or 5" />
                <div class="preset-chips">
                    <span class="preset-chip" onclick="setPresetValue('Engineering')">Engineering</span>
                    <span class="preset-chip" onclick="setPresetValue('Sales')">Sales</span>
                    <span class="preset-chip" onclick="setPresetValue('5')">5%</span>
                    <span class="preset-chip" onclick="setPresetValue('2000000')">₹20L</span>
                    <span class="preset-chip" onclick="setPresetValue('3')">3 Days</span>
                    <span class="preset-chip" onclick="setPresetValue('Full-Time')">Full-Time</span>
                </div>
            </div>
        `;
        if (node.type === 'branch') {
            formHtml += `
                <div class="form-group">
                    <label class="form-label">True / Yes Route Label</label>
                    <input type="text" class="form-control" id="cfg-branch-true" value="${cfg.trueLabel || 'True / Yes'}" />
                </div>
                <div class="form-group">
                    <label class="form-label">False / No Route Label</label>
                    <input type="text" class="form-control" id="cfg-branch-false" value="${cfg.falseLabel || 'False / No'}" />
                </div>
                <div class="no-code-pill-info">
                    <i class="fas fa-code-branch" style="color:var(--node-branch);"></i> Connect other nodes to the green True or orange False output ports.
                </div>
            `;
        } else {
            formHtml += `
                <div class="no-code-pill-info">
                    <i class="fas fa-filter" style="color:var(--node-condition);"></i> Evaluates condition automatically against live employee attributes.
                </div>
            `;
        }
    } else if (node.type === 'approval') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Assignee Role</label>
                <select class="form-control" id="cfg-appr-role">
                    <option value="manager" ${cfg.assigneeRole === 'manager' ? 'selected' : ''}>Reporting Manager</option>
                    <option value="department_head" ${cfg.assigneeRole === 'department_head' ? 'selected' : ''}>Department Head / VP</option>
                    <option value="hr_manager" ${cfg.assigneeRole === 'hr_manager' ? 'selected' : ''}>HR Operations Manager</option>
                    <option value="finance_admin" ${cfg.assigneeRole === 'finance_admin' ? 'selected' : ''}>Finance / Payroll Lead</option>
                    <option value="super_admin" ${cfg.assigneeRole === 'super_admin' ? 'selected' : ''}>Super Admin / Director</option>
                    <option value="cfo" ${cfg.assigneeRole === 'cfo' ? 'selected' : ''}>Chief Financial Officer</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">SLA Due Time (Hours)</label>
                <input type="number" class="form-control" id="cfg-appr-due" value="${cfg.dueHours || 24}" min="1" max="168" />
                <div class="preset-chips">
                    <span class="preset-chip" onclick="setSlaHours(12)">12h</span>
                    <span class="preset-chip" onclick="setSlaHours(24)">24h</span>
                    <span class="preset-chip" onclick="setSlaHours(48)">48h</span>
                    <span class="preset-chip" onclick="setSlaHours(72)">72h</span>
                    <span class="preset-chip" onclick="setSlaHours(120)">5 Days</span>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Action on Rejection</label>
                <select class="form-control" id="cfg-appr-reject">
                    <option value="terminate" ${cfg.onReject === 'terminate' ? 'selected' : ''}>Terminate Workflow</option>
                    <option value="reassign" ${cfg.onReject === 'reassign' ? 'selected' : ''}>Reassign to Alternate Approver</option>
                    <option value="notify" ${cfg.onReject === 'notify' ? 'selected' : ''}>Notify Initiator Only</option>
                    <option value="return_remarks" ${cfg.onReject === 'return_remarks' ? 'selected' : ''}>Return with Rejection Remarks</option>
                </select>
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-user-check" style="color:var(--node-approval);"></i> Generates an interactive approval card in the assigned manager's portal.
            </div>
        `;
    } else if (node.type === 'wait') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Duration</label>
                <input type="number" class="form-control" id="cfg-wait-dur" value="${cfg.duration || 1}" min="1" />
            </div>
            <div class="form-group">
                <label class="form-label">Unit</label>
                <select class="form-control" id="cfg-wait-unit">
                    <option value="hours" ${cfg.unit === 'hours' ? 'selected' : ''}>Hours</option>
                    <option value="days" ${cfg.unit === 'days' ? 'selected' : ''}>Days</option>
                    <option value="business_days" ${cfg.unit === 'business_days' ? 'selected' : ''}>Business Days (Excl. Weekends)</option>
                </select>
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-clock" style="color:var(--node-wait);"></i> The engine pauses execution for the configured interval before advancing.
            </div>
        `;
    } else if (node.type === 'escalation') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Escalate To</label>
                <select class="form-control" id="cfg-esc-to">
                    <option value="hr_head" ${cfg.escalateTo === 'hr_head' ? 'selected' : ''}>Head of Human Resources</option>
                    <option value="vp_operations" ${cfg.escalateTo === 'vp_operations' ? 'selected' : ''}>VP of People Operations</option>
                    <option value="cfo" ${cfg.escalateTo === 'cfo' ? 'selected' : ''}>Chief Financial Officer</option>
                    <option value="ceo" ${cfg.escalateTo === 'ceo' ? 'selected' : ''}>Chief Executive Officer</option>
                    <option value="escalation_board" ${cfg.escalateTo === 'escalation_board' ? 'selected' : ''}>Executive Escalation Board</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">SLA Breach Threshold (Hours)</label>
                <input type="number" class="form-control" id="cfg-esc-sla" value="${cfg.slaHours || 48}" min="1" />
            </div>
            <div class="form-group">
                <label class="form-label">Urgency Level</label>
                <select class="form-control" id="cfg-esc-urgency">
                    <option value="high" ${cfg.urgency === 'high' ? 'selected' : ''}>High Priority Alert</option>
                    <option value="critical" ${cfg.urgency === 'critical' ? 'selected' : ''}>Critical (Immediate Push Alert)</option>
                    <option value="blocker" ${cfg.urgency === 'blocker' ? 'selected' : ''}>Blocker (Executive SMS / Email)</option>
                </select>
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-level-up-alt" style="color:var(--node-escalation);"></i> Automatically reassigns stalled tasks and notifies executive leadership.
            </div>
        `;
    } else if (node.type === 'action') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Action Type</label>
                <select class="form-control" id="cfg-act-type">
                    <option value="provision_it_assets" ${cfg.actionType === 'provision_it_assets' ? 'selected' : ''}>Provision IT & Email Account</option>
                    <option value="deactivate_access" ${cfg.actionType === 'deactivate_access' ? 'selected' : ''}>Deactivate Enterprise Access</option>
                    <option value="update_employee_status" ${cfg.actionType === 'update_employee_status' ? 'selected' : ''}>Update Employee Master Record</option>
                    <option value="initiate_bank_transfer" ${cfg.actionType === 'initiate_bank_transfer' ? 'selected' : ''}>Initiate Bank Payout Batch</option>
                    <option value="post_payroll_journal" ${cfg.actionType === 'post_payroll_journal' ? 'selected' : ''}>Post General Ledger Journal</option>
                    <option value="credit_leave_balance" ${cfg.actionType === 'credit_leave_balance' ? 'selected' : ''}>Credit Annual Leave Balance</option>
                    <option value="generate_statutory_ecr" ${cfg.actionType === 'generate_statutory_ecr' ? 'selected' : ''}>Generate PF / ECR Statutory File</option>
                    <option value="lock_asset_inventory" ${cfg.actionType === 'lock_asset_inventory' ? 'selected' : ''}>Lock Asset Clearance Checklist</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Execution Mode</label>
                <select class="form-control" id="cfg-act-mode">
                    <option value="immediate" ${cfg.mode === 'immediate' ? 'selected' : ''}>Immediate Execution</option>
                    <option value="batch" ${cfg.mode === 'batch' ? 'selected' : ''}>Queue for Next Hourly Batch</option>
                    <option value="nightly" ${cfg.mode === 'nightly' ? 'selected' : ''}>Scheduled Nightly Run</option>
                </select>
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-play" style="color:var(--node-action);"></i> Integrates with enterprise services with pre-built system connectors.
            </div>
        `;
    } else if (node.type === 'notification') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Recipient</label>
                <select class="form-control" id="cfg-notif-recip">
                    <option value="employee" ${cfg.recipient === 'employee' ? 'selected' : ''}>Employee / Candidate</option>
                    <option value="manager" ${cfg.recipient === 'manager' ? 'selected' : ''}>Reporting Manager</option>
                    <option value="hr_ops" ${cfg.recipient === 'hr_ops' ? 'selected' : ''}>HR Operations Team</option>
                    <option value="it_desk" ${cfg.recipient === 'it_desk' ? 'selected' : ''}>IT Service Desk</option>
                    <option value="finance" ${cfg.recipient === 'finance' ? 'selected' : ''}>Finance & Accounts</option>
                    <option value="leadership" ${cfg.recipient === 'leadership' ? 'selected' : ''}>Department Leadership</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Channel</label>
                <select class="form-control" id="cfg-notif-chan">
                    <option value="email" ${cfg.channel === 'email' ? 'selected' : ''}>Email</option>
                    <option value="in_app" ${cfg.channel === 'in_app' ? 'selected' : ''}>In-App Action Center</option>
                    <option value="slack" ${cfg.channel === 'slack' ? 'selected' : ''}>Slack / Teams Webhook</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Subject / Header</label>
                <input type="text" class="form-control" id="cfg-notif-sub" value="${cfg.subject || 'Workflow Notice: Request Status Update'}" />
            </div>
            <div class="form-group">
                <label class="form-label">Message Template</label>
                <textarea class="form-control" id="cfg-notif-msg" rows="3">${cfg.template || 'Hello {{name}}, your request has been processed.'}</textarea>
                <div class="token-chips">
                    <span class="token-chip" onclick="insertToken('{{name}}')">{{name}}</span>
                    <span class="token-chip" onclick="insertToken('{{employee_id}}')">{{employee_id}}</span>
                    <span class="token-chip" onclick="insertToken('{{designation}}')">{{designation}}</span>
                    <span class="token-chip" onclick="insertToken('{{department}}')">{{department}}</span>
                    <span class="token-chip" onclick="insertToken('{{effectiveDate}}')">{{effectiveDate}}</span>
                    <span class="token-chip" onclick="insertToken('{{managerName}}')">{{managerName}}</span>
                </div>
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-paper-plane" style="color:var(--node-notification);"></i> Click any variable chip above to inject live data without writing template code.
            </div>
        `;
    } else if (node.type === 'document') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Document Template</label>
                <select class="form-control" id="cfg-doc-key">
                    <option value="offer_letter" ${cfg.templateKey === 'offer_letter' ? 'selected' : ''}>Offer Letter</option>
                    <option value="appointment_letter" ${cfg.templateKey === 'appointment_letter' ? 'selected' : ''}>Appointment Letter</option>
                    <option value="promotion_letter" ${cfg.templateKey === 'promotion_letter' ? 'selected' : ''}>Promotion Letter</option>
                    <option value="increment_letter" ${cfg.templateKey === 'increment_letter' ? 'selected' : ''}>Increment Letter</option>
                    <option value="transfer_letter" ${cfg.templateKey === 'transfer_letter' ? 'selected' : ''}>Transfer Letter</option>
                    <option value="payslip" ${cfg.templateKey === 'payslip' ? 'selected' : ''}>Itemized Payslip</option>
                    <option value="ff_statement" ${cfg.templateKey === 'ff_statement' ? 'selected' : ''}>Full & Final Statement</option>
                    <option value="relieving_letter" ${cfg.templateKey === 'relieving_letter' ? 'selected' : ''}>Relieving Letter</option>
                    <option value="experience_letter" ${cfg.templateKey === 'experience_letter' ? 'selected' : ''}>Experience Letter</option>
                    <option value="termination_letter" ${cfg.templateKey === 'termination_letter' ? 'selected' : ''}>Termination Letter</option>
                    <option value="nda_agreement" ${cfg.templateKey === 'nda_agreement' ? 'selected' : ''}>Non-Disclosure Agreement (NDA)</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Output Format</label>
                <select class="form-control" id="cfg-doc-format">
                    <option value="pdf_sealed" ${cfg.format === 'pdf_sealed' ? 'selected' : ''}>Digital PDF with Corporate Seal</option>
                    <option value="e_sign" ${cfg.format === 'e_sign' ? 'selected' : ''}>Route for E-Signature Sign-off</option>
                    <option value="draft" ${cfg.format === 'draft' ? 'selected' : ''}>Draft PDF for HR Preview</option>
                </select>
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-file-alt" style="color:var(--node-document);"></i> Pulls verified data into approved templates. Zero HTML or PDF scripting required.
            </div>
        `;
    } else if (node.type === 'form') {
        const activeFields = cfg.fields || ['personal', 'bank', 'emergency'];
        formHtml += `
            <div class="form-group">
                <label class="form-label">Form Title</label>
                <input type="text" class="form-control" id="cfg-form-title" value="${cfg.formTitle || 'Employee Details Form'}" />
            </div>
            <div class="form-group">
                <label class="form-label">Target Respondent</label>
                <select class="form-control" id="cfg-form-respondent">
                    <option value="employee" ${cfg.respondent === 'employee' ? 'selected' : ''}>Employee / Candidate</option>
                    <option value="manager" ${cfg.respondent === 'manager' ? 'selected' : ''}>Reporting Manager</option>
                    <option value="hr_specialist" ${cfg.respondent === 'hr_specialist' ? 'selected' : ''}>HR Operations Specialist</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Fields to Collect (Check to Include)</label>
                <div class="field-checkbox-grid">
                    <label class="field-checkbox-item">
                        <input type="checkbox" onchange="toggleFormField('personal', this.checked)" ${activeFields.includes('personal') ? 'checked' : ''} />
                        <span>Personal & Contact Information</span>
                    </label>
                    <label class="field-checkbox-item">
                        <input type="checkbox" onchange="toggleFormField('bank', this.checked)" ${activeFields.includes('bank') ? 'checked' : ''} />
                        <span>Bank Account & IFSC Direct Deposit</span>
                    </label>
                    <label class="field-checkbox-item">
                        <input type="checkbox" onchange="toggleFormField('emergency', this.checked)" ${activeFields.includes('emergency') ? 'checked' : ''} />
                        <span>Emergency Contacts & Next of Kin</span>
                    </label>
                    <label class="field-checkbox-item">
                        <input type="checkbox" onchange="toggleFormField('education', this.checked)" ${activeFields.includes('education') ? 'checked' : ''} />
                        <span>Educational Degree Certificates</span>
                    </label>
                    <label class="field-checkbox-item">
                        <input type="checkbox" onchange="toggleFormField('relieving', this.checked)" ${activeFields.includes('relieving') ? 'checked' : ''} />
                        <span>Previous Relieving & 3 Months Payslips</span>
                    </label>
                    <label class="field-checkbox-item">
                        <input type="checkbox" onchange="toggleFormField('tax', this.checked)" ${activeFields.includes('tax') ? 'checked' : ''} />
                        <span>PF UAN & Tax Declaration (Form 12B)</span>
                    </label>
                    <label class="field-checkbox-item">
                        <input type="checkbox" onchange="toggleFormField('assets', this.checked)" ${activeFields.includes('assets') ? 'checked' : ''} />
                        <span>IT Asset Handover Receipt</span>
                    </label>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Completion Deadline (Days)</label>
                <input type="number" class="form-control" id="cfg-form-days" value="${cfg.completionDays || 3}" min="1" max="30" />
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-clipboard-list" style="color:var(--node-form);"></i> Visual form schema generated instantly from your checkbox selections.
            </div>
        `;
    } else if (node.type === 'end') {
        formHtml += `
            <div class="form-group">
                <label class="form-label">Outcome Status</label>
                <select class="form-control" id="cfg-end-status">
                    <option value="COMPLETED" ${cfg.outcomeStatus === 'COMPLETED' ? 'selected' : ''}>COMPLETED (Successful Execution)</option>
                    <option value="REJECTED" ${cfg.outcomeStatus === 'REJECTED' ? 'selected' : ''}>REJECTED (Human Rejection Gate)</option>
                    <option value="CANCELLED" ${cfg.outcomeStatus === 'CANCELLED' ? 'selected' : ''}>CANCELLED (Withdrawn / Cancelled)</option>
                    <option value="ESCALATED" ${cfg.outcomeStatus === 'ESCALATED' ? 'selected' : ''}>ESCALATED (Handed Off to Executive)</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Audit Note</label>
                <input type="text" class="form-control" id="cfg-end-note" value="${cfg.auditNote || 'Workflow step finalized successfully.'}" />
            </div>
            <div class="no-code-pill-info">
                <i class="fas fa-flag-checkered" style="color:var(--node-end);"></i> Terminates the execution path and seals the compliance audit trail.
            </div>
        `;
    }

    panelBody.innerHTML = formHtml;
    attachConfigFormListeners(node);
}

function attachConfigFormListeners(node) {
    const bindInput = (id, callback) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', callback);
        if (el && el.tagName === 'SELECT') el.addEventListener('change', callback);
    };

    bindInput('cfg-node-label', (e) => {
        node.label = e.target.value;
        const cardLabel = document.querySelector(`#canvas_node_${node.id} .canvas-node-label`);
        if (cardLabel) cardLabel.textContent = node.label;
    });

    // Trigger
    bindInput('cfg-trigger-event', (e) => { node.config.event = e.target.value; updateNodeCard(node); });
    bindInput('cfg-trigger-entity', (e) => { node.config.entity = e.target.value; updateNodeCard(node); });
    bindInput('cfg-trigger-scope', (e) => { node.config.scope = e.target.value; updateNodeCard(node); });

    // Condition / Branch
    bindInput('cfg-cond-field', (e) => { node.config.field = e.target.value; updateNodeCard(node); });
    bindInput('cfg-cond-op', (e) => { node.config.operator = e.target.value; updateNodeCard(node); });
    bindInput('cfg-cond-val', (e) => { node.config.value = e.target.value; updateNodeCard(node); });
    bindInput('cfg-branch-true', (e) => { node.config.trueLabel = e.target.value; updateNodeCard(node); });
    bindInput('cfg-branch-false', (e) => { node.config.falseLabel = e.target.value; updateNodeCard(node); });

    // Approval
    bindInput('cfg-appr-role', (e) => { node.config.assigneeRole = e.target.value; updateNodeCard(node); });
    bindInput('cfg-appr-due', (e) => { node.config.dueHours = parseInt(e.target.value, 10); updateNodeCard(node); });
    bindInput('cfg-appr-reject', (e) => { node.config.onReject = e.target.value; updateNodeCard(node); });

    // Wait
    bindInput('cfg-wait-dur', (e) => { node.config.duration = parseInt(e.target.value, 10); updateNodeCard(node); });
    bindInput('cfg-wait-unit', (e) => { node.config.unit = e.target.value; updateNodeCard(node); });

    // Escalation
    bindInput('cfg-esc-to', (e) => { node.config.escalateTo = e.target.value; updateNodeCard(node); });
    bindInput('cfg-esc-sla', (e) => { node.config.slaHours = parseInt(e.target.value, 10); updateNodeCard(node); });
    bindInput('cfg-esc-urgency', (e) => { node.config.urgency = e.target.value; updateNodeCard(node); });

    // Action
    bindInput('cfg-act-type', (e) => { node.config.actionType = e.target.value; updateNodeCard(node); });
    bindInput('cfg-act-mode', (e) => { node.config.mode = e.target.value; updateNodeCard(node); });

    // Notification
    bindInput('cfg-notif-recip', (e) => { node.config.recipient = e.target.value; updateNodeCard(node); });
    bindInput('cfg-notif-chan', (e) => { node.config.channel = e.target.value; updateNodeCard(node); });
    bindInput('cfg-notif-sub', (e) => { node.config.subject = e.target.value; updateNodeCard(node); });
    bindInput('cfg-notif-msg', (e) => { node.config.template = e.target.value; updateNodeCard(node); });

    // Document
    bindInput('cfg-doc-key', (e) => { node.config.templateKey = e.target.value; updateNodeCard(node); });
    bindInput('cfg-doc-format', (e) => { node.config.format = e.target.value; updateNodeCard(node); });

    // Form
    bindInput('cfg-form-title', (e) => { node.config.formTitle = e.target.value; updateNodeCard(node); });
    bindInput('cfg-form-respondent', (e) => { node.config.respondent = e.target.value; updateNodeCard(node); });
    bindInput('cfg-form-days', (e) => { node.config.completionDays = parseInt(e.target.value, 10); updateNodeCard(node); });

    // End
    bindInput('cfg-end-status', (e) => { node.config.outcomeStatus = e.target.value; updateNodeCard(node); });
    bindInput('cfg-end-note', (e) => { node.config.auditNote = e.target.value; updateNodeCard(node); });
}

function updateNodeCard(node) {
    const bodyEl = document.querySelector(`#canvas_node_${node.id} .canvas-node-body`);
    if (bodyEl) bodyEl.innerHTML = getNodeSummary(node);
}

window.insertToken = function(token) {
    const msgEl = document.getElementById('cfg-notif-msg');
    if (msgEl) {
        msgEl.value += ' ' + token;
        msgEl.dispatchEvent(new Event('input'));
    }
};

window.setPresetValue = function(val) {
    const valEl = document.getElementById('cfg-cond-val');
    if (valEl) {
        valEl.value = val;
        valEl.dispatchEvent(new Event('input'));
    }
};

window.setSlaHours = function(hrs) {
    const dueEl = document.getElementById('cfg-appr-due');
    if (dueEl) {
        dueEl.value = hrs;
        dueEl.dispatchEvent(new Event('input'));
    }
};

window.toggleFormField = function(fieldName, isChecked) {
    if (!state.selectedNodeId) return;
    const node = state.currentWorkflow.canvas.nodes.find(n => n.id === state.selectedNodeId);
    if (!node || node.type !== 'form') return;
    node.config = node.config || {};
    node.config.fields = node.config.fields || ['personal', 'bank', 'emergency'];
    if (isChecked) {
        if (!node.config.fields.includes(fieldName)) node.config.fields.push(fieldName);
    } else {
        node.config.fields = node.config.fields.filter(f => f !== fieldName);
    }
    updateNodeCard(node);
};

// ─── ADD NODE HELPER (SMART PLACEMENT & ZERO-CODE) ───
function addNodeToCanvas(nodeType, customX = null, customY = null) {
    const nodes = state.currentWorkflow.canvas.nodes || [];
    let dropX = customX;
    let dropY = customY;

    if (dropX === null || dropY === null) {
        if (nodes.length === 0) {
            dropX = 140;
            dropY = 80;
        } else {
            const lastNode = nodes[nodes.length - 1];
            dropX = Math.min(Math.max(lastNode.x + (nodes.length % 2 === 0 ? 30 : -10), 60), 600);
            dropY = lastNode.y + 110;
        }
    }

    const newNodeId = 'node_' + Math.random().toString(36).substr(2, 6);
    const defaultConfig = getDefaultConfigForType(nodeType);

    const newNode = {
        id: newNodeId,
        type: nodeType,
        label: capitalize(nodeType),
        x: Math.round(dropX / 10) * 10,
        y: Math.round(dropY / 10) * 10,
        config: defaultConfig
    };

    state.currentWorkflow.canvas.nodes.push(newNode);
    selectNode(newNode.id);
    renderCanvas();
    showToast(`Added + ${capitalize(nodeType)} node (No-Code)`, 'success');
}

// ─── PALETTE DRAG & DROP AND CLICK-TO-ADD EVENTS ───
function setupPaletteDragEvents() {
    document.querySelectorAll('.palette-node').forEach(nodeEl => {
        const nodeType = nodeEl.getAttribute('data-node-type');

        // Drag support
        nodeEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', nodeType);
        });

        // 1-Click to add support (clicking anywhere on the palette item)
        nodeEl.addEventListener('click', (e) => {
            e.preventDefault();
            addNodeToCanvas(nodeType);
        });

        // Dedicated + button
        const addBtn = nodeEl.querySelector('.palette-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                addNodeToCanvas(nodeType);
            });
        }
    });

    const canvasWrapper = document.getElementById('canvas-wrapper');
    if (!canvasWrapper) return;

    canvasWrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    canvasWrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        const nodeType = e.dataTransfer.getData('text/plain');
        if (!nodeType) return;

        const rect = canvasWrapper.getBoundingClientRect();
        const dropX = (e.clientX - rect.left - state.panX) / state.scale;
        const dropY = (e.clientY - rect.top - state.panY) / state.scale;

        addNodeToCanvas(nodeType, dropX, dropY);
    });
}

function getDefaultConfigForType(type) {
    switch (type) {
        case 'trigger': return { event: 'candidate_offer_accepted', entity: 'candidate', scope: 'all' };
        case 'condition': return { field: 'department', operator: '==', value: 'Engineering' };
        case 'branch': return { field: 'ctc', operator: '>', value: 2000000, trueLabel: 'True / Yes', falseLabel: 'False / No' };
        case 'approval': return { assigneeRole: 'manager', dueHours: 24, onReject: 'terminate' };
        case 'wait': return { duration: 1, unit: 'days' };
        case 'escalation': return { escalateTo: 'hr_head', slaHours: 48, urgency: 'high' };
        case 'action': return { actionType: 'provision_it_assets', mode: 'immediate' };
        case 'notification': return { recipient: 'employee', channel: 'email', subject: 'Workflow Notification', template: 'Hello {{name}}, update ready.' };
        case 'document': return { templateKey: 'offer_letter', format: 'pdf_sealed' };
        case 'form': return { formTitle: 'Employee Information', fields: ['personal', 'bank', 'emergency'], completionDays: 3 };
        case 'end': return { outcomeStatus: 'COMPLETED', auditNote: 'Workflow completed successfully.' };
        default: return {};
    }
}

// ─── CANVAS PAN & ZOOM EVENTS ───
function setupCanvasEvents() {
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const workflowCanvas = document.getElementById('workflow-canvas');
    if (!canvasWrapper || !workflowCanvas) return;

    // Pan Canvas
    canvasWrapper.addEventListener('mousedown', (e) => {
        if (e.target === canvasWrapper || e.target.id === 'svg-canvas' || e.target.id === 'workflow-canvas') {
            state.isDraggingCanvas = true;
            state.dragStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
            canvasWrapper.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!state.isDraggingCanvas) return;
        state.panX = e.clientX - state.dragStart.x;
        state.panY = e.clientY - state.dragStart.y;
        updateCanvasTransform();
    });

    window.addEventListener('mouseup', () => {
        if (state.isDraggingCanvas) {
            state.isDraggingCanvas = false;
            canvasWrapper.style.cursor = 'crosshair';
        }
    });

    // Zoom buttons
    document.getElementById('zoom-in').addEventListener('click', () => {
        state.scale = Math.min(state.scale + 0.15, 2.0);
        updateCanvasTransform();
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        state.scale = Math.max(state.scale - 0.15, 0.4);
        updateCanvasTransform();
    });
    document.getElementById('zoom-reset').addEventListener('click', () => {
        state.scale = 1;
        state.panX = 0;
        state.panY = 0;
        updateCanvasTransform();
    });

    // Clear canvas
    document.getElementById('btn-clear-canvas').addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all canvas nodes and connections?')) {
            state.currentWorkflow.canvas.nodes = [];
            state.currentWorkflow.canvas.connections = [];
            state.selectedNodeId = null;
            renderCanvas();
            renderConfigPanel();
            showToast('Canvas cleared', 'info');
        }
    });

    // Delete selected node
    document.getElementById('btn-delete-node').addEventListener('click', () => {
        if (!state.selectedNodeId) return;
        const idToDelete = state.selectedNodeId;
        state.currentWorkflow.canvas.nodes = state.currentWorkflow.canvas.nodes.filter(n => n.id !== idToDelete);
        state.currentWorkflow.canvas.connections = state.currentWorkflow.canvas.connections.filter(c => c.from !== idToDelete && c.to !== idToDelete);
        state.selectedNodeId = null;
        renderCanvas();
        renderConfigPanel();
        showToast('Node deleted', 'info');
    });
}

function updateCanvasTransform() {
    const workflowCanvas = document.getElementById('workflow-canvas');
    if (workflowCanvas) {
        workflowCanvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    }
}

// ─── TOOLBAR BUTTON ACTIONS ───
function setupToolbarEvents() {
    document.getElementById('btn-new-workflow').addEventListener('click', newWorkflow);

    // Save Workflow
    document.getElementById('btn-save').addEventListener('click', async () => {
        state.currentWorkflow.name = document.getElementById('workflow-name-input').value.trim() || 'Untitled Workflow';
        state.currentWorkflow.description = document.getElementById('workflow-desc-input').value.trim();

        try {
            const method = state.currentWorkflow.id ? 'PUT' : 'POST';
            const url = state.currentWorkflow.id ? `${API_BASE}/${state.currentWorkflow.id}` : API_BASE;
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.currentWorkflow)
            });
            const json = await res.json();
            if (json.success) {
                state.currentWorkflow = json.workflow;
                showToast(`Workflow "${json.workflow.name}" saved successfully!`, 'success');
                await loadWorkflowsList();
                await fetchStats();
            } else {
                showToast(json.error || 'Validation failed during save', 'error');
            }
        } catch (err) {
            console.error('Save error:', err);
            showToast('Failed to save workflow', 'error');
        }
    });

    // Validate Workflow
    document.getElementById('btn-validate').addEventListener('click', async () => {
        try {
            const res = await fetch(`${API_BASE}/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ canvas: state.currentWorkflow.canvas })
            });
            const json = await res.json();
            if (json.success && json.validation.valid) {
                showToast('✅ Workflow structure is 100% valid and ready for automation!', 'success');
            } else {
                const errors = json.validation?.errors?.join('; ') || json.error;
                showToast(`⚠️ Validation issues: ${errors}`, 'error');
            }
        } catch (err) {
            showToast('Validation request failed', 'error');
        }
    });

    // Version Selector Change Event
    const versionSelect = document.getElementById('version-selector');
    if (versionSelect) {
        versionSelect.addEventListener('change', async (e) => {
            const verNum = parseInt(e.target.value, 10);
            state.selectedVersionNumber = verNum;
            const targetVer = state.versions.find(v => v.versionNumber === verNum);
            if (targetVer) {
                state.currentWorkflow.canvas = JSON.parse(JSON.stringify(targetVer.canvas || { nodes: [], connections: [] }));
                state.currentWorkflow.version = targetVer.versionNumber;
                state.currentWorkflow.status = targetVer.status;
                
                const badge = document.getElementById('workflow-status-badge');
                badge.className = `status-badge ${targetVer.status}`;
                badge.textContent = targetVer.status;

                const rollbackBtn = document.getElementById('btn-rollback-version');
                if (rollbackBtn) {
                    rollbackBtn.style.display = (verNum < (state.currentWorkflow.activeVersionNumber || 1)) ? 'inline-flex' : 'none';
                }

                state.selectedNodeId = state.currentWorkflow.canvas.nodes?.[0]?.id || null;
                renderCanvas();
                renderConfigPanel();
                showToast(`Viewing version v${verNum} (${targetVer.status})`, 'info');
            }
        });
    }

    // Rollback Version Button
    const rollbackBtn = document.getElementById('btn-rollback-version');
    if (rollbackBtn) {
        rollbackBtn.addEventListener('click', async () => {
            if (!state.currentWorkflow.id) return;
            const verNum = state.selectedVersionNumber;
            try {
                const res = await fetch(`${API_BASE}/${state.currentWorkflow.id}/versions/${verNum}/rollback`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actor: 'HR Admin' })
                });
                const json = await res.json();
                if (json.success) {
                    showToast(`Rolled back workflow to v${verNum} successfully!`, 'success');
                    await loadWorkflow(state.currentWorkflow.id);
                    await loadWorkflowsList();
                    await fetchStats();
                } else {
                    showToast(json.error || 'Rollback failed', 'error');
                }
            } catch (err) {
                showToast('Rollback request failed', 'error');
            }
        });
    }

    // Activate / Publish Workflow (Enforces Test-Run Gating)
    document.getElementById('btn-activate').addEventListener('click', async () => {
        if (!state.currentWorkflow.id) {
            showToast('Please save the workflow first before publishing', 'warning');
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/${state.currentWorkflow.id}/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actor: 'HR Admin' })
            });
            const json = await res.json();
            if (json.success) {
                state.currentWorkflow.status = 'active';
                const badge = document.getElementById('workflow-status-badge');
                badge.className = 'status-badge active';
                badge.textContent = 'active';
                showToast('🚀 Workflow approved and published to Live Production!', 'success');
                await loadWorkflow(state.currentWorkflow.id);
                await loadWorkflowsList();
                await fetchStats();
            } else {
                if (json.error && json.error.includes('untested')) {
                    showToast('⚠️ Test required before publishing. Opening test mode...', 'warning');
                    openTestModeModal();
                } else {
                    showToast(json.error || 'Publishing failed', 'error');
                }
            }
        } catch (err) {
            showToast('Activation error: ' + err.message, 'error');
        }
    });

    // Test Mode Button
    document.getElementById('btn-test-run').addEventListener('click', () => {
        openTestModeModal();
    });

    document.getElementById('btn-close-test-run').addEventListener('click', () => {
        document.getElementById('test-run-panel').classList.remove('open');
    });

    // Export JSON
    document.getElementById('btn-export').addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.currentWorkflow, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `${state.currentWorkflow.name.replace(/\s+/g, '_')}_workflow.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('Exported workflow JSON', 'success');
    });
}

// ─── TEST MODE & PRE-PUBLISH DRY-RUN EVENTS ───
function openTestModeModal() {
    const modal = document.getElementById('test-mode-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    
    // Auto-select first sample employee if none selected
    const empSelect = document.getElementById('test-employee-select');
    if (empSelect && !empSelect.value && state.sampleEmployees.length > 0) {
        empSelect.value = state.sampleEmployees[0].id;
        renderSelectedEmployeeCard(state.sampleEmployees[0]);
    }
}

function renderSelectedEmployeeCard(emp) {
    const card = document.getElementById('test-employee-card');
    if (!card) return;
    if (!emp) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'grid';
    card.innerHTML = `
        <div><span class="emp-stat-label">Employee:</span> <span class="emp-stat-val">${emp.name}</span></div>
        <div><span class="emp-stat-label">Role:</span> <span class="emp-stat-val">${emp.role}</span></div>
        <div><span class="emp-stat-label">Department:</span> <span class="emp-stat-val">${emp.department}</span></div>
        <div><span class="emp-stat-label">CTC:</span> <span class="emp-stat-val">₹${(emp.ctc || 0).toLocaleString()}</span></div>
        <div><span class="emp-stat-label">Tenure:</span> <span class="emp-stat-val">${emp.tenureMonths || 0} months</span></div>
        <div><span class="emp-stat-label">Days Absent:</span> <span class="emp-stat-val">${emp.daysAbsent || 0} days</span></div>
    `;
}

function setupTestModeEvents() {
    const modal = document.getElementById('test-mode-modal');
    const btnClose = document.getElementById('btn-close-test-modal');
    const empSelect = document.getElementById('test-employee-select');
    const btnExecute = document.getElementById('btn-execute-test-mode');
    const btnPublish = document.getElementById('btn-publish-from-test');
    const dryRunList = document.getElementById('dry-run-nodes-list');
    const countBadge = document.getElementById('test-trace-count-badge');

    if (!modal) return;

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    if (empSelect) {
        empSelect.addEventListener('change', () => {
            const empId = empSelect.value;
            const emp = state.sampleEmployees.find(e => e.id === empId);
            renderSelectedEmployeeCard(emp);
        });
    }

    if (btnExecute) {
        btnExecute.addEventListener('click', async () => {
            if (!state.currentWorkflow.id) {
                showToast('Please save workflow first before running test simulation', 'warning');
                return;
            }

            const empId = empSelect?.value || undefined;
            let customPayload = {};
            const customJsonVal = document.getElementById('test-custom-json')?.value?.trim();
            if (customJsonVal) {
                try {
                    customPayload = JSON.parse(customJsonVal);
                } catch (e) {
                    showToast('Invalid custom JSON payload syntax', 'error');
                    return;
                }
            }

            btnExecute.disabled = true;
            btnExecute.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Simulating Execution...';
            dryRunList.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:15px;"><i class="fas fa-spinner fa-spin"></i> Evaluating nodes against employee context...</div>';

            try {
                const res = await fetch(`${API_BASE}/${state.currentWorkflow.id}/test-run`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        employeeId: empId,
                        mockData: customPayload,
                        actor: 'HR Admin'
                    })
                });

                const json = await res.json();
                if (json.success && json.simulation) {
                    const trace = json.simulation.executionTrace || [];
                    if (countBadge) {
                        countBadge.style.display = 'inline-flex';
                        countBadge.textContent = `${trace.length} Nodes Evaluated`;
                        countBadge.className = 'status-badge active';
                    }

                    dryRunList.innerHTML = '';
                    trace.forEach((step, idx) => {
                        const row = document.createElement('div');
                        row.className = 'dry-run-node-item';
                        const icon = NODE_ICONS[step.nodeType] || 'fa-cog';
                        const color = NODE_COLORS[step.nodeType] || '#6366f1';
                        
                        row.innerHTML = `
                            <div style="font-weight:700; color:var(--text-muted); width:20px; font-size:11px;">#${idx + 1}</div>
                            <div style="width:24px; height:24px; border-radius:6px; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0;">
                                <i class="fas ${icon}"></i>
                            </div>
                            <div style="flex:1;">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <strong style="color:var(--text-primary); font-size:12px;">${step.label || step.nodeType}</strong>
                                    <span class="item-badge badge-success">${step.outcome}</span>
                                </div>
                                <div style="color:var(--text-secondary); font-size:11px; margin-top:2px;">${step.details}</div>
                            </div>
                        `;
                        dryRunList.appendChild(row);
                    });

                    // Show Approve & Publish button
                    if (btnPublish) btnPublish.style.display = 'inline-flex';

                    // Update local workflow state to reflect tested status
                    if (state.currentWorkflow.status === 'draft') {
                        const badge = document.getElementById('workflow-status-badge');
                        if (badge) {
                            badge.className = 'status-badge draft';
                            badge.textContent = 'Draft (Tested)';
                        }
                    }

                    showToast(`Dry-run trace complete: ${trace.length} nodes verified!`, 'success');
                } else {
                    dryRunList.innerHTML = `<div style="color:var(--accent-red);font-size:11.5px;padding:12px;">Simulation error: ${json.error}</div>`;
                }
            } catch (err) {
                dryRunList.innerHTML = `<div style="color:var(--accent-red);font-size:11.5px;padding:12px;">Simulation request failed: ${err.message}</div>`;
            } finally {
                btnExecute.disabled = false;
                btnExecute.innerHTML = '<i class="fas fa-play"></i> Re-Run Test Simulation';
            }
        });
    }

    if (btnPublish) {
        btnPublish.addEventListener('click', async () => {
            if (!state.currentWorkflow.id) return;
            try {
                const res = await fetch(`${API_BASE}/${state.currentWorkflow.id}/activate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actor: 'HR Admin' })
                });
                const json = await res.json();
                if (json.success) {
                    modal.style.display = 'none';
                    state.currentWorkflow.status = 'active';
                    const badge = document.getElementById('workflow-status-badge');
                    badge.className = 'status-badge active';
                    badge.textContent = 'active';
                    showToast('🚀 Workflow approved and published to Live Production!', 'success');
                    await loadWorkflow(state.currentWorkflow.id);
                    await loadWorkflowsList();
                    await fetchStats();
                } else {
                    showToast(json.error || 'Failed to publish workflow', 'error');
                }
            } catch (err) {
                showToast('Publish error: ' + err.message, 'error');
            }
        });
    }
}

function simulateLocalTrace() {
    const nodes = state.currentWorkflow.canvas.nodes || [];
    return nodes.map(n => ({
        nodeId: n.id,
        nodeType: n.type,
        label: n.label,
        outcome: 'SUCCESS',
        details: `Simulated step execution for ${n.label}`
    }));
}

function animateExecutionTrace(trace) {
    const traceContainer = document.getElementById('test-run-trace');
    traceContainer.innerHTML = '';

    if (trace.length === 0) {
        traceContainer.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">No steps were executed</div>';
        return;
    }

    trace.forEach((step, idx) => {
        setTimeout(() => {
            // Highlight node on canvas
            document.querySelectorAll('.canvas-node').forEach(el => el.classList.remove('executing'));
            const nodeEl = document.getElementById(`canvas_node_${step.nodeId}`);
            if (nodeEl) nodeEl.classList.add('executing');

            const stepDiv = document.createElement('div');
            stepDiv.className = 'trace-step';
            stepDiv.innerHTML = `
                <div class="trace-step-icon"><i class="fas fa-check"></i></div>
                <div class="trace-step-content">
                    <div class="trace-step-title">${step.label || step.nodeType}</div>
                    <div class="trace-step-desc">${step.details || step.outcome}</div>
                </div>
            `;
            traceContainer.appendChild(stepDiv);
            traceContainer.scrollTop = traceContainer.scrollHeight;

            if (idx === trace.length - 1) {
                setTimeout(() => {
                    document.querySelectorAll('.canvas-node').forEach(el => el.classList.remove('executing'));
                    showToast('Simulation complete: All paths verified', 'success');
                }, 1000);
            }
        }, idx * 600);
    });
}

function hexToRgb(hex) {
    const bigint = parseInt(hex.replace('#', ''), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── AI AUTOMATION CREATOR EVENT HANDLERS ───
let currentGeneratedAiFlow = null;

function setupAiCreatorEvents() {
    const modal = document.getElementById('ai-creator-modal');
    const btnOpen = document.getElementById('btn-ai-creator');
    const btnClose = document.getElementById('btn-close-ai-modal');
    const btnGenerate = document.getElementById('btn-generate-ai-flow');
    const btnApply = document.getElementById('btn-apply-ai-workflow');
    const promptInput = document.getElementById('ai-prompt-input');
    const previewContainer = document.getElementById('ai-preview-container');
    const explanationEl = document.getElementById('ai-explanation');
    const previewChainEl = document.getElementById('ai-preview-chain');
    const confidenceBadge = document.getElementById('ai-confidence-badge');

    if (!modal || !btnOpen) return;

    btnOpen.addEventListener('click', () => {
        modal.style.display = 'flex';
        if (promptInput) promptInput.focus();
    });

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    if (btnGenerate) {
        btnGenerate.addEventListener('click', async () => {
            const prompt = (promptInput?.value || '').trim();
            if (!prompt) {
                showToast('Please enter a natural-language workflow request.', 'error');
                return;
            }

            btnGenerate.disabled = true;
            btnGenerate.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Synthesizing Flow...';

            try {
                const res = await fetch(`${API_BASE}/ai-generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt })
                });

                const json = await res.json();
                if (json.success && json.workflow) {
                    currentGeneratedAiFlow = json.workflow;

                    if (explanationEl) explanationEl.textContent = json.explanation;
                    if (confidenceBadge) confidenceBadge.textContent = `Confidence: ${Math.round((json.confidence || 0.95) * 100)}%`;

                    if (previewChainEl) {
                        previewChainEl.innerHTML = '';
                        const chain = json.nodeChain || [];
                        chain.forEach((type, idx) => {
                            const pill = document.createElement('span');
                            const color = NODE_COLORS[type.toLowerCase()] || '#6366f1';
                            pill.className = 'ai-chain-pill';
                            pill.style.background = color;
                            pill.textContent = type;
                            previewChainEl.appendChild(pill);

                            if (idx < chain.length - 1) {
                                const arrow = document.createElement('span');
                                arrow.className = 'ai-chain-arrow';
                                arrow.innerHTML = '➔';
                                previewChainEl.appendChild(arrow);
                            }
                        });
                    }

                    if (previewContainer) previewContainer.style.display = 'block';
                    if (btnApply) btnApply.style.display = 'inline-flex';
                    showToast('AI synthesized workflow sequence!', 'success');
                } else {
                    showToast(json.error || 'Failed to synthesize workflow', 'error');
                }
            } catch (err) {
                console.error('AI synthesis error:', err);
                showToast('AI synthesis request failed', 'error');
            } finally {
                btnGenerate.disabled = false;
                btnGenerate.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Synthesize Workflow';
            }
        });
    }

    if (btnApply) {
        btnApply.addEventListener('click', () => {
            if (!currentGeneratedAiFlow) return;

            state.currentWorkflow = currentGeneratedAiFlow;
            document.getElementById('workflow-name-input').value = currentGeneratedAiFlow.name;
            document.getElementById('workflow-desc-input').value = currentGeneratedAiFlow.description || '';

            const badge = document.getElementById('workflow-status-badge');
            badge.className = 'status-badge draft';
            badge.textContent = 'Draft (Review)';

            // Show AI Review Mode Banner on Canvas
            const reviewBanner = document.getElementById('ai-review-banner');
            if (reviewBanner) reviewBanner.style.display = 'flex';

            modal.style.display = 'none';
            state.selectedNodeId = currentGeneratedAiFlow.canvas?.nodes?.[0]?.id || null;
            renderCanvas();
            renderConfigPanel();
            loadWorkflowsList();
            fetchStats();

            showToast(`Loaded AI draft "${currentGeneratedAiFlow.name}" in Review mode`, 'success');
        });
    }
}
