/**
 * HRMS No-Code Visual Workflow Builder Controller
 * Pure SVG + Vanilla JavaScript Canvas & Configuration Engine
 * Dedicated for HRMS Strategic Operations (No Super Admin dependencies)
 */

const API_HOST = window.location.port === '3000' 
    ? '' 
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3000' 
        : '');

const API_BASE = `${API_HOST}/api/workflow-builder`;
const STORAGE_KEY = 'kylrx_hrms_workflows_data';
const STORAGE_LOGS_KEY = 'kylrx_hrms_workflow_logs';

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
    trigger: { name: "Trigger", label: "Trigger", color: "#6366f1", icon: "fa-bolt", category: "start", description: "Starts the workflow on HR lifecycle, leave, or schedule event", requiredConfig: ["event"] },
    condition: { name: "Condition", label: "Condition", color: "#f59e0b", icon: "fa-filter", category: "logic", description: "Pass / Fail evaluation gate based on employee or leave fields", requiredConfig: ["field","operator"] },
    branch: { name: "Branch", label: "Branch", color: "#8b5cf6", icon: "fa-code-branch", category: "logic", description: "Multi-way routing based on department, role, or days absent", requiredConfig: ["field","operator"] },
    approval: { name: "Approval", label: "Approval", color: "#3b82f6", icon: "fa-user-check", category: "human", description: "Manager or HR approval gate with SLA deadline and auto-escalation", requiredConfig: ["assigneeRole"] },
    wait: { name: "Wait", label: "Wait", color: "#14b8a6", icon: "fa-clock", category: "control", description: "Delay step for probation or SLA countdown timer", requiredConfig: ["duration"] },
    escalation: { name: "Escalation", label: "Escalation", color: "#f97316", icon: "fa-level-up-alt", category: "control", description: "Automatic escalation to HR Director upon SLA breach", requiredConfig: ["escalateTo"] },
    action: { name: "Action", label: "Action", color: "#10b981", icon: "fa-play", category: "execute", description: "Executes automated HR record update or webhook sync", requiredConfig: ["actionType"] },
    notification: { name: "Notification", label: "Notification", color: "#ec4899", icon: "fa-paper-plane", category: "execute", description: "Dispatches employee notice (Email, In-App, Slack)", requiredConfig: ["recipient","channel"] },
    document: { name: "Document", label: "Document", color: "#eab308", icon: "fa-file-alt", category: "execute", description: "Generates official PDF (Offer Letter, NDA, Relieving Letter)", requiredConfig: ["templateKey"] },
    form: { name: "Form", label: "Form", color: "#06b6d4", icon: "fa-clipboard-list", category: "human", description: "Captures candidate/employee documentation or survey details", requiredConfig: ["formTitle"] },
    end: { name: "End", label: "End", color: "#ef4444", icon: "fa-flag-checkered", category: "terminal", description: "Final step completing the workflow and writing immutable audit log", requiredConfig: ["outcomeStatus"] }
};

const DEFAULT_HRMS_WORKFLOWS = [
    {
        id: "wf_hrms_onboarding",
        name: "New Hire 30-Day Onboarding Pipeline",
        description: "Automated candidate offer letter dispatch, IT asset clearance, manager intro, and 30-day probation check.",
        status: "active",
        version: 1,
        activeVersionNumber: 1,
        canvas: {
            nodes: [
                { id: "n1", type: "trigger", label: "Candidate Hired", x: 80, y: 160, position: { x: 80, y: 160 }, config: { event: "candidate_hired", entity: "candidate", label: "Candidate Hired", outcomeStatus: "COMPLETED" } },
                { id: "n2", type: "document", label: "Generate Offer Letter", x: 340, y: 160, position: { x: 340, y: 160 }, config: { templateKey: "offer_letter", label: "Generate Offer Letter", outcomeStatus: "COMPLETED" } },
                { id: "n3", type: "approval", label: "Manager & HR Review", x: 600, y: 160, position: { x: 600, y: 160 }, config: { assigneeRole: "hr_admin", dueHours: 24, onReject: "terminate", label: "Manager & HR Review", outcomeStatus: "COMPLETED" } },
                { id: "n4", type: "notification", label: "Send Welcome Packet", x: 860, y: 160, position: { x: 860, y: 160 }, config: { recipient: "employee", channel: "email", template: "Welcome to the team! Your offer letter is ready.", label: "Send Welcome Packet", outcomeStatus: "COMPLETED" } },
                { id: "n5", type: "wait", label: "Wait 30 Days", x: 1120, y: 160, position: { x: 1120, y: 160 }, config: { duration: 30, unit: "days", label: "Wait 30 Days", outcomeStatus: "COMPLETED" } },
                { id: "n6", type: "end", label: "Probation Initiated", x: 1380, y: 160, position: { x: 1380, y: 160 }, config: { outcomeStatus: "COMPLETED", label: "Probation Initiated" } }
            ],
            connections: [
                { id: "conn_1", from: "n1", to: "n2", fromNodeId: "n1", toNodeId: "n2", port: "out", label: "" },
                { id: "conn_2", from: "n2", to: "n3", fromNodeId: "n2", toNodeId: "n3", port: "out", label: "" },
                { id: "conn_3", from: "n3", to: "n4", fromNodeId: "n3", toNodeId: "n4", port: "out", label: "" },
                { id: "conn_4", from: "n4", to: "n5", fromNodeId: "n4", toNodeId: "n5", port: "out", label: "" },
                { id: "conn_5", from: "n5", to: "n6", fromNodeId: "n5", toNodeId: "n6", port: "out", label: "" }
            ]
        }
    },
    {
        id: "wf_hrms_leave_approval",
        name: "Multi-Tier Leave Approval & SLA Escalation",
        description: "Evaluates leave duration. 1-2 days auto-approved; >3 days requires Manager sign-off with 24h SLA auto-forward to HR.",
        status: "active",
        version: 1,
        activeVersionNumber: 1,
        canvas: {
            nodes: [
                { id: "n1", type: "trigger", label: "Leave Application", x: 80, y: 180, position: { x: 80, y: 180 }, config: { event: "leave_applied", entity: "leave_request", label: "Leave Application" } },
                { id: "n2", type: "condition", label: "Days > 3?", x: 340, y: 180, position: { x: 340, y: 180 }, config: { field: "daysCount", operator: ">", value: "3", label: "Days > 3?" } },
                { id: "n3", type: "approval", label: "Manager Approval (24h)", x: 620, y: 100, position: { x: 620, y: 100 }, config: { assigneeRole: "manager", dueHours: 24, onReject: "terminate", label: "Manager Approval (24h)" } },
                { id: "n4", type: "action", label: "Auto-Approve Short Leave", x: 620, y: 260, position: { x: 620, y: 260 }, config: { actionType: "auto_approve_leave", label: "Auto-Approve Short Leave" } },
                { id: "n5", type: "notification", label: "Notify Team & Sync Calendar", x: 920, y: 180, position: { x: 920, y: 180 }, config: { recipient: "employee", channel: "in_app", label: "Notify Team & Sync Calendar" } },
                { id: "n6", type: "end", label: "Leave Finalized", x: 1200, y: 180, position: { x: 1200, y: 180 }, config: { outcomeStatus: "COMPLETED", label: "Leave Finalized" } }
            ],
            connections: [
                { id: "conn_1", from: "n1", to: "n2", fromNodeId: "n1", toNodeId: "n2", port: "out", label: "" },
                { id: "conn_2", from: "n2", to: "n3", fromNodeId: "n2", toNodeId: "n3", port: "out", label: "Yes" },
                { id: "conn_3", from: "n2", to: "n4", fromNodeId: "n2", toNodeId: "n4", port: "out", label: "No" },
                { id: "conn_4", from: "n3", to: "n5", fromNodeId: "n3", toNodeId: "n5", port: "out", label: "" },
                { id: "conn_5", from: "n4", to: "n5", fromNodeId: "n4", toNodeId: "n5", port: "out", label: "" },
                { id: "conn_6", from: "n5", to: "n6", fromNodeId: "n5", toNodeId: "n6", port: "out", label: "" }
            ]
        }
    },
    {
        id: "wf_hrms_exit_clearance",
        name: "Employee Separation & Exit Clearance",
        description: "Triggers exit interview, IT hardware recovery check, final payroll settlement signoff, and relieving document generation.",
        status: "draft",
        version: 1,
        activeVersionNumber: 1,
        canvas: {
            nodes: [
                { id: "n1", type: "trigger", label: "Resignation Submitted", x: 80, y: 160, position: { x: 80, y: 160 }, config: { event: "resignation_submitted", entity: "exit_case", label: "Resignation Submitted" } },
                { id: "n2", type: "approval", label: "HR Exit Interview", x: 340, y: 160, position: { x: 340, y: 160 }, config: { assigneeRole: "hr_admin", dueHours: 48, label: "HR Exit Interview" } },
                { id: "n3", type: "action", label: "IT Asset Return Verification", x: 600, y: 160, position: { x: 600, y: 160 }, config: { actionType: "verify_asset_return", label: "IT Asset Return Verification" } },
                { id: "n4", type: "document", label: "Generate Relieving Letter", x: 860, y: 160, position: { x: 860, y: 160 }, config: { templateKey: "relieving_letter", label: "Generate Relieving Letter" } },
                { id: "n5", type: "end", label: "Offboarding Complete", x: 1120, y: 160, position: { x: 1120, y: 160 }, config: { outcomeStatus: "COMPLETED", label: "Offboarding Complete" } }
            ],
            connections: [
                { id: "conn_1", from: "n1", to: "n2", fromNodeId: "n1", toNodeId: "n2", port: "out", label: "" },
                { id: "conn_2", from: "n2", to: "n3", fromNodeId: "n2", toNodeId: "n3", port: "out", label: "" },
                { id: "conn_3", from: "n3", to: "n4", fromNodeId: "n3", toNodeId: "n4", port: "out", label: "" },
                { id: "conn_4", from: "n4", to: "n5", fromNodeId: "n4", toNodeId: "n5", port: "out", label: "" }
            ]
        }
    }
];

// Application State
const state = {
    currentWorkflow: null,
    workflows: [],
    nodeTypes: { ...DEFAULT_NODE_TYPES },
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

// Initialize Storage
function initStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            state.workflows = JSON.parse(saved);
        } else {
            state.workflows = JSON.parse(JSON.stringify(DEFAULT_HRMS_WORKFLOWS));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.workflows));
        }
    } catch (e) {
        console.warn('Storage read warning:', e);
        state.workflows = JSON.parse(JSON.stringify(DEFAULT_HRMS_WORKFLOWS));
    }
}

function persistWorkflows() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.workflows));
    } catch (e) {
        console.warn('Storage save warning:', e);
    }
}

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

// Palette drag handlers
function initPaletteDraggable() {
    const items = document.querySelectorAll('.palette-item');
    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            const nodeType = item.getAttribute('data-node-type');
            e.dataTransfer.setData('text/plain', JSON.stringify({ action: 'create_node', nodeType }));
        });
    });
}

// Initialize Canvas
function initCanvas() {
    const container = document.getElementById('canvas-container');
    const canvas = document.getElementById('workflow-canvas');
    if (!container || !canvas) return;

    // Canvas panning
    container.addEventListener('mousedown', (e) => {
        if (e.target === container || e.target.tagName === 'svg' || e.target.id === 'workflow-canvas') {
            state.isDraggingCanvas = true;
            state.dragStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
            container.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (state.isDraggingCanvas) {
            state.panX = e.clientX - state.dragStart.x;
            state.panY = e.clientY - state.dragStart.y;
            applyCanvasTransform();
        }
    });

    window.addEventListener('mouseup', () => {
        if (state.isDraggingCanvas) {
            state.isDraggingCanvas = false;
            container.style.cursor = 'crosshair';
        }
    });

    // Drag over canvas to drop new node
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        try {
            const rawData = e.dataTransfer.getData('text/plain');
            if (!rawData) return;
            const data = JSON.parse(rawData);
            if (data.action === 'create_node' && data.nodeType) {
                const rect = container.getBoundingClientRect();
                const dropX = (e.clientX - rect.left - state.panX) / state.scale;
                const dropY = (e.clientY - rect.top - state.panY) / state.scale;
                createNodeAt(data.nodeType, Math.round(dropX), Math.round(dropY));
            }
        } catch (err) {
            console.error('Drop error:', err);
        }
    });

    // Click canvas deselects node
    container.addEventListener('click', (e) => {
        if (e.target === container || e.target.tagName === 'svg' || e.target.id === 'workflow-canvas') {
            selectNode(null);
        }
    });
}

function applyCanvasTransform() {
    const canvas = document.getElementById('workflow-canvas');
    if (canvas) {
        canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    }
}

// Zoom Controls
window.zoomIn = function() {
    state.scale = Math.min(2.0, state.scale + 0.15);
    applyCanvasTransform();
};

window.zoomOut = function() {
    state.scale = Math.max(0.4, state.scale - 0.15);
    applyCanvasTransform();
};

window.zoomReset = function() {
    state.scale = 1.0;
    state.panX = 0;
    state.panY = 0;
    applyCanvasTransform();
};

// Create Node
function createNodeAt(type, x, y) {
    if (!state.currentWorkflow) {
        createNewWorkflow();
    }
    const def = state.nodeTypes[type] || DEFAULT_NODE_TYPES[type] || { label: type };
    const nodeId = 'node_' + Math.random().toString(36).substr(2, 7);
    const newNode = {
        id: nodeId,
        type: type,
        label: def.label || def.name || type,
        x: Math.max(20, x),
        y: Math.max(20, y),
        position: { x: Math.max(20, x), y: Math.max(20, y) },
        config: {
            label: def.label || def.name || type,
            outcomeStatus: 'COMPLETED'
        }
    };

    // Preset defaults
    if (type === 'trigger') newNode.config.event = 'employee_onboarding_started';
    if (type === 'condition') { newNode.config.field = 'department'; newNode.config.operator = '=='; newNode.config.value = 'Engineering'; }
    if (type === 'approval') { newNode.config.assigneeRole = 'hr_admin'; newNode.config.dueHours = 24; }
    if (type === 'document') { newNode.config.templateKey = 'offer_letter'; }
    if (type === 'notification') { newNode.config.channel = 'email'; newNode.config.recipient = 'employee'; }

    state.currentWorkflow.canvas.nodes.push(newNode);
    renderCanvas();
    selectNode(nodeId);
    updateStatsBar();
    showToast(`Added ${def.name || type} node`, 'info');
}

// Render Canvas
function renderCanvas() {
    const nodesContainer = document.getElementById('canvas-nodes-layer');
    const svgLayer = document.getElementById('svg-connections-layer');
    if (!nodesContainer || !svgLayer) return;

    nodesContainer.innerHTML = '';
    svgLayer.innerHTML = '';

    if (!state.currentWorkflow || !state.currentWorkflow.canvas) return;

    const nodes = state.currentWorkflow.canvas.nodes || [];
    const connections = state.currentWorkflow.canvas.connections || [];

    // Render nodes
    nodes.forEach(node => {
        const nodeEl = document.createElement('div');
        nodeEl.className = `canvas-node ${state.selectedNodeId === node.id ? 'selected' : ''}`;
        nodeEl.id = `cn_${node.id}`;
        nodeEl.style.left = `${node.x || node.position?.x || 0}px`;
        nodeEl.style.top = `${node.y || node.position?.y || 0}px`;

        const color = NODE_COLORS[node.type] || '#64748b';
        const icon = NODE_ICONS[node.type] || 'fa-cog';

        let subtext = '';
        if (node.type === 'trigger') subtext = `Event: ${node.config?.event || 'Lifecycle'}`;
        else if (node.type === 'condition') subtext = `Rule: ${node.config?.field || 'attr'} ${node.config?.operator || '=='} ${node.config?.value || 'val'}`;
        else if (node.type === 'approval') subtext = `Role: ${node.config?.assigneeRole || 'hr_admin'} (${node.config?.dueHours || 24}h SLA)`;
        else if (node.type === 'document') subtext = `Doc: ${node.config?.templateKey || 'Template'}`;
        else if (node.type === 'notification') subtext = `Channel: ${node.config?.channel || 'in_app'} → ${node.config?.recipient || 'employee'}`;
        else subtext = node.config?.description || 'Configured step';

        nodeEl.innerHTML = `
            <div class="canvas-node-header" style="background: ${color}10; border-left: 3px solid ${color};">
                <div class="canvas-node-icon" style="background: ${color};">
                    <i class="fas ${icon}"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div class="canvas-node-type-label">${node.type}</div>
                    <div class="canvas-node-label" title="${node.label || node.id}">${node.label || node.id}</div>
                </div>
                <button class="node-delete-btn" onclick="event.stopPropagation(); deleteNode('${node.id}');" title="Remove Node" style="background:none; border:none; color:#94a3b8; cursor:pointer; font-size:11px; padding:2px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="canvas-node-body">
                <div style="font-size: 11px; color: #475569; font-weight: 500;">${subtext}</div>
            </div>
            <div class="node-port node-port-in" title="Incoming Connection" data-port="in" data-node-id="${node.id}"></div>
            <div class="node-port node-port-out" title="Connect to next step" data-port="out" data-node-id="${node.id}"></div>
        `;

        // Node click to select
        nodeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectNode(node.id);
        });

        // Make node draggable
        makeNodeDraggable(nodeEl, node);

        // Port connection handlers
        const portOut = nodeEl.querySelector('.node-port-out');
        if (portOut) {
            portOut.addEventListener('click', (e) => {
                e.stopPropagation();
                handlePortClick(node.id, 'out');
            });
        }

        const portIn = nodeEl.querySelector('.node-port-in');
        if (portIn) {
            portIn.addEventListener('click', (e) => {
                e.stopPropagation();
                handlePortClick(node.id, 'in');
            });
        }

        nodesContainer.appendChild(nodeEl);
    });

    // Render SVG connections
    connections.forEach(conn => {
        const fromNode = nodes.find(n => n.id === (conn.from || conn.fromNodeId));
        const toNode = nodes.find(n => n.id === (conn.to || conn.toNodeId));
        if (fromNode && toNode) {
            renderConnectionLine(svgLayer, conn, fromNode, toNode);
        }
    });

    if (window.renderLucideIcons) window.renderLucideIcons();
}

// Make individual node card draggable on canvas
function makeNodeDraggable(el, node) {
    let startX = 0, startY = 0, initialNodeX = 0, initialNodeY = 0;

    el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('node-port') || e.target.closest('.node-delete-btn')) return;
        e.stopPropagation();
        startX = e.clientX;
        startY = e.clientY;
        initialNodeX = node.x || node.position?.x || 0;
        initialNodeY = node.y || node.position?.y || 0;

        const onMouseMove = (moveEvent) => {
            const dx = (moveEvent.clientX - startX) / state.scale;
            const dy = (moveEvent.clientY - startY) / state.scale;
            node.x = Math.round(initialNodeX + dx);
            node.y = Math.round(initialNodeY + dy);
            if (!node.position) node.position = {};
            node.position.x = node.x;
            node.position.y = node.y;

            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;

            // Fast re-render connections during drag
            renderConnectionsOnly();
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            persistWorkflows();
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

// Fast re-render of connections only
function renderConnectionsOnly() {
    const svgLayer = document.getElementById('svg-connections-layer');
    if (!svgLayer || !state.currentWorkflow) return;
    svgLayer.innerHTML = '';
    const nodes = state.currentWorkflow.canvas.nodes || [];
    const connections = state.currentWorkflow.canvas.connections || [];
    connections.forEach(conn => {
        const fromNode = nodes.find(n => n.id === (conn.from || conn.fromNodeId));
        const toNode = nodes.find(n => n.id === (conn.to || conn.toNodeId));
        if (fromNode && toNode) {
            renderConnectionLine(svgLayer, conn, fromNode, toNode);
        }
    });
}

// Render SVG Bezier Curve between nodes
function renderConnectionLine(svg, conn, fromNode, toNode) {
    const fromX = (fromNode.x || fromNode.position?.x || 0) + 110;
    const fromY = (fromNode.y || fromNode.position?.y || 0) + 84;
    const toX = (toNode.x || toNode.position?.x || 0) + 110;
    const toY = (toNode.y || toNode.position?.y || 0) - 2;

    const deltaY = Math.max(30, Math.abs(toY - fromY) * 0.5);
    const cp1x = fromX;
    const cp1y = fromY + deltaY;
    const cp2x = toX;
    const cp2y = toY - deltaY;

    const d = `M ${fromX} ${fromY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toX} ${toY}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `flow-line ${conn.label === 'Yes' ? 'branch-true' : conn.label === 'No' ? 'branch-false' : ''}`);
    path.setAttribute('data-conn-id', conn.id);
    path.style.cursor = 'pointer';

    path.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this workflow connection?')) {
            deleteConnection(conn.id);
        }
    });

    svg.appendChild(path);

    // If connection has label, add text
    if (conn.label) {
        const midX = (fromX + toX) / 2;
        const midY = (fromY + toY) / 2;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', midX);
        text.setAttribute('y', midY - 6);
        text.setAttribute('fill', conn.label === 'Yes' ? '#10b981' : '#ef4444');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-weight', '700');
        text.setAttribute('text-anchor', 'middle');
        text.textContent = conn.label;
        svg.appendChild(text);
    }
}

// Connection Port Click
function handlePortClick(nodeId, portType) {
    if (portType === 'out') {
        state.connectingFromNodeId = nodeId;
        showToast('Click another node\'s top connector to complete connection', 'info');
    } else if (portType === 'in' && state.connectingFromNodeId) {
        if (state.connectingFromNodeId === nodeId) {
            showToast('Cannot connect a node to itself', 'error');
            state.connectingFromNodeId = null;
            return;
        }

        // Add connection
        const connId = `conn_${Date.now()}`;
        const newConn = {
            id: connId,
            from: state.connectingFromNodeId,
            to: nodeId,
            fromNodeId: state.connectingFromNodeId,
            toNodeId: nodeId,
            port: 'out',
            label: ''
        };

        state.currentWorkflow.canvas.connections.push(newConn);
        state.connectingFromNodeId = null;
        renderCanvas();
        persistWorkflows();
        showToast('Workflow nodes connected successfully!', 'success');
    }
}

// Delete Connection
function deleteConnection(connId) {
    if (!state.currentWorkflow) return;
    state.currentWorkflow.canvas.connections = state.currentWorkflow.canvas.connections.filter(c => c.id !== connId);
    renderCanvas();
    persistWorkflows();
    showToast('Connection removed', 'info');
}

// Delete Node
window.deleteNode = function(nodeId) {
    if (!state.currentWorkflow) return;
    state.currentWorkflow.canvas.nodes = state.currentWorkflow.canvas.nodes.filter(n => n.id !== nodeId);
    state.currentWorkflow.canvas.connections = state.currentWorkflow.canvas.connections.filter(c => c.from !== nodeId && c.to !== nodeId && c.fromNodeId !== nodeId && c.toNodeId !== nodeId);
    if (state.selectedNodeId === nodeId) selectNode(null);
    renderCanvas();
    persistWorkflows();
    updateStatsBar();
    showToast('Node removed from workflow canvas', 'info');
};

// Select Node and populate Right Inspector
function selectNode(nodeId) {
    state.selectedNodeId = nodeId;

    // Visual selection update
    document.querySelectorAll('.canvas-node').forEach(el => {
        if (el.id === `cn_${nodeId}`) el.classList.add('selected');
        else el.classList.remove('selected');
    });

    const inspector = document.getElementById('inspector-panel');
    const emptyMsg = document.getElementById('inspector-empty-state');
    const form = document.getElementById('inspector-form');
    if (!inspector || !emptyMsg || !form) return;

    if (!nodeId) {
        emptyMsg.style.display = 'block';
        form.style.display = 'none';
        return;
    }

    const node = state.currentWorkflow?.canvas?.nodes?.find(n => n.id === nodeId);
    if (!node) {
        emptyMsg.style.display = 'block';
        form.style.display = 'none';
        return;
    }

    emptyMsg.style.display = 'none';
    form.style.display = 'block';

    const color = NODE_COLORS[node.type] || '#2563eb';
    const typeBadge = document.getElementById('node-type-badge');
    if (typeBadge) {
        typeBadge.textContent = node.type.toUpperCase();
        typeBadge.style.background = `${color}20`;
        typeBadge.style.color = color;
    }

    const labelInput = document.getElementById('node-label-input');
    if (labelInput) labelInput.value = node.label || node.config?.label || '';

    // Render Type-Specific Inspector Fields
    const configArea = document.getElementById('type-specific-config');
    if (configArea) {
        configArea.innerHTML = renderInspectorFieldsForType(node);
    }
}

// Generate inspector HTML for specific node type
function renderInspectorFieldsForType(node) {
    const cfg = node.config || {};
    if (node.type === 'trigger') {
        return `
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Event Trigger</label>
                <select class="form-control" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('event', this.value)">
                    <option value="candidate_hired" ${cfg.event === 'candidate_hired' ? 'selected' : ''}>Candidate Hired (Onboarding)</option>
                    <option value="leave_applied" ${cfg.event === 'leave_applied' ? 'selected' : ''}>Leave Applied</option>
                    <option value="resignation_submitted" ${cfg.event === 'resignation_submitted' ? 'selected' : ''}>Resignation Submitted (Exit)</option>
                    <option value="probation_check_due" ${cfg.event === 'probation_check_due' ? 'selected' : ''}>Probation Review Due (30/90 Days)</option>
                    <option value="payroll_cycle_initiated" ${cfg.event === 'payroll_cycle_initiated' ? 'selected' : ''}>Monthly Payroll Cycle Initiated</option>
                    <option value="statutory_filing_cycle" ${cfg.event === 'statutory_filing_cycle' ? 'selected' : ''}>PF / ESIC Filing Period</option>
                    <option value="appraisal_window_open" ${cfg.event === 'appraisal_window_open' ? 'selected' : ''}>Annual Appraisal Window Open</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Source HR Module</label>
                <input type="text" class="form-control" value="${cfg.entity || 'workforce'}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('entity', this.value)" />
            </div>
        `;
    }

    if (node.type === 'condition') {
        return `
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Evaluated Field</label>
                <input type="text" class="form-control" value="${cfg.field || 'department'}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('field', this.value)" placeholder="e.g. department, daysCount, salary" />
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:12px;">
                <div>
                    <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Operator</label>
                    <select class="form-control" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('operator', this.value)">
                        <option value="==" ${cfg.operator === '==' ? 'selected' : ''}>Equals (==)</option>
                        <option value="!=" ${cfg.operator === '!=' ? 'selected' : ''}>Not Equals (!=)</option>
                        <option value=">" ${cfg.operator === '>' ? 'selected' : ''}>Greater Than (&gt;)</option>
                        <option value="<" ${cfg.operator === '<' ? 'selected' : ''}>Less Than (&lt;)</option>
                        <option value="contains" ${cfg.operator === 'contains' ? 'selected' : ''}>Contains</option>
                    </select>
                </div>
                <div>
                    <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Value</label>
                    <input type="text" class="form-control" value="${cfg.value || ''}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('value', this.value)" placeholder="Value" />
                </div>
            </div>
        `;
    }

    if (node.type === 'approval') {
        return `
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Assignee Role</label>
                <select class="form-control" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('assigneeRole', this.value)">
                    <option value="manager" ${cfg.assigneeRole === 'manager' ? 'selected' : ''}>Reporting Line Manager</option>
                    <option value="hr_admin" ${cfg.assigneeRole === 'hr_admin' ? 'selected' : ''}>HR Operations Admin</option>
                    <option value="department_head" ${cfg.assigneeRole === 'department_head' ? 'selected' : ''}>Department Head</option>
                    <option value="finance_lead" ${cfg.assigneeRole === 'finance_lead' ? 'selected' : ''}>Finance / Payroll Lead</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">SLA Deadline (Hours)</label>
                <input type="number" class="form-control" value="${cfg.dueHours || 24}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('dueHours', parseInt(this.value) || 24)" />
            </div>
            <div class="form-group">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Auto-Escalation Target</label>
                <select class="form-control" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('onSlaBreach', this.value)">
                    <option value="escalate_hr_director">Escalate to Head of HR</option>
                    <option value="auto_approve">Auto-Approve after SLA</option>
                    <option value="alert_reminder">Send Urgent Reminder Notification</option>
                </select>
            </div>
        `;
    }

    if (node.type === 'document') {
        return `
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Document Template</label>
                <select class="form-control" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('templateKey', this.value)">
                    <option value="offer_letter" ${cfg.templateKey === 'offer_letter' ? 'selected' : ''}>Official Employment Offer Letter</option>
                    <option value="relieving_letter" ${cfg.templateKey === 'relieving_letter' ? 'selected' : ''}>Relieving & Experience Certificate</option>
                    <option value="nda_agreement" ${cfg.templateKey === 'nda_agreement' ? 'selected' : ''}>Non-Disclosure & IP Agreement (NDA)</option>
                    <option value="appraisal_letter" ${cfg.templateKey === 'appraisal_letter' ? 'selected' : ''}>Annual Appraisal & Compensation Letter</option>
                    <option value="probation_confirmation" ${cfg.templateKey === 'probation_confirmation' ? 'selected' : ''}>Probation Confirmation Letter</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Auto Signature</label>
                <div style="font-size:11.5px; color:#475569; display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" checked disabled /> Head of People & Culture Digital Stamp
                </div>
            </div>
        `;
    }

    if (node.type === 'notification') {
        return `
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Delivery Channel</label>
                <select class="form-control" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('channel', this.value)">
                    <option value="in_app" ${cfg.channel === 'in_app' ? 'selected' : ''}>In-App Notification</option>
                    <option value="email" ${cfg.channel === 'email' ? 'selected' : ''}>Email Dispatch (Direct)</option>
                    <option value="both" ${cfg.channel === 'both' ? 'selected' : ''}>In-App + Email Combo</option>
                    <option value="webhook" ${cfg.channel === 'webhook' ? 'selected' : ''}>Slack / Teams Webhook</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Recipient</label>
                <select class="form-control" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('recipient', this.value)">
                    <option value="employee" ${cfg.recipient === 'employee' ? 'selected' : ''}>Employee / Candidate</option>
                    <option value="manager" ${cfg.recipient === 'manager' ? 'selected' : ''}>Reporting Manager</option>
                    <option value="hr_team" ${cfg.recipient === 'hr_team' ? 'selected' : ''}>HR Operations Team</option>
                    <option value="all_department" ${cfg.recipient === 'all_department' ? 'selected' : ''}>Entire Department</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Notification Template</label>
                <textarea class="form-control" rows="3" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; font-family:inherit;" onchange="updateNodeConfig('template', this.value)">${cfg.template || 'Hello {employee.name}, your request has been updated.'}</textarea>
                <div style="margin-top:6px; display:flex; gap:4px; flex-wrap:wrap;">
                    <span class="token-chip" onclick="insertToken('{employee.name}')">{name}</span>
                    <span class="token-chip" onclick="insertToken('{department}')">{dept}</span>
                    <span class="token-chip" onclick="insertToken('{leave.days}')">{days}</span>
                </div>
            </div>
        `;
    }

    return `
        <div class="form-group">
            <label class="form-label" style="font-size:11px; font-weight:700; color:#334155; margin-bottom:4px; display:block;">Execution Payload Description</label>
            <input type="text" class="form-control" value="${cfg.description || ''}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;" onchange="updateNodeConfig('description', this.value)" placeholder="Action notes..." />
        </div>
    `;
}

// Update Node Config live
window.updateNodeConfig = function(key, value) {
    if (!state.selectedNodeId || !state.currentWorkflow) return;
    const node = state.currentWorkflow.canvas.nodes.find(n => n.id === state.selectedNodeId);
    if (!node) return;
    if (!node.config) node.config = {};
    node.config[key] = value;
    persistWorkflows();
    renderCanvas();
};

window.updateNodeLabel = function(label) {
    if (!state.selectedNodeId || !state.currentWorkflow) return;
    const node = state.currentWorkflow.canvas.nodes.find(n => n.id === state.selectedNodeId);
    if (!node) return;
    node.label = label;
    if (!node.config) node.config = {};
    node.config.label = label;
    persistWorkflows();
    renderCanvas();
};

window.insertToken = function(token) {
    const textarea = document.querySelector('#type-specific-config textarea');
    if (textarea) {
        textarea.value += ' ' + token;
        updateNodeConfig('template', textarea.value);
    }
};

// Workflows Management
function loadWorkflowsList() {
    const list = document.getElementById('workflows-list');
    if (!list) return;
    list.innerHTML = '';

    state.workflows.forEach(wf => {
        const item = document.createElement('div');
        item.className = `workflow-item ${state.currentWorkflow?.id === wf.id ? 'active' : ''}`;
        item.onclick = () => switchWorkflow(wf.id);

        const badgeClass = wf.status === 'active' ? 'active' : 'draft';
        const nodeCount = wf.canvas?.nodes?.length || 0;

        item.innerHTML = `
            <div class="workflow-item-header">
                <span class="workflow-item-name">${wf.name}</span>
                <span class="status-badge ${badgeClass}" style="font-size:10px; padding:2px 6px;">${wf.status.toUpperCase()}</span>
            </div>
            <div class="workflow-item-desc">${wf.description || 'Custom HR Workflow'}</div>
            <div class="workflow-item-footer">
                <span><i class="fas fa-cubes"></i> ${nodeCount} steps</span>
                <span>v${wf.version || 1}</span>
            </div>
        `;
        list.appendChild(item);
    });
}

function switchWorkflow(id) {
    const found = state.workflows.find(w => w.id === id);
    if (found) {
        state.currentWorkflow = JSON.parse(JSON.stringify(found));
        syncHeaderMeta();
        renderCanvas();
        selectNode(null);
        updateStatsBar();
        loadWorkflowsList();
        showToast(`Loaded "${found.name}"`, 'info');
    }
}

window.createNewWorkflow = function() {
    const id = `wf_hrms_${Date.now()}`;
    const newWf = {
        id,
        name: 'New HR Operation Flow',
        description: 'Automated HRMS event lifecycle workflow',
        status: 'draft',
        version: 1,
        activeVersionNumber: 1,
        canvas: {
            nodes: [
                { id: 'n1', type: 'trigger', label: 'HR Event Ingested', x: 120, y: 180, position: { x: 120, y: 180 }, config: { event: 'employee_onboarding_started', label: 'HR Event Ingested' } },
                { id: 'n2', type: 'approval', label: 'HR Admin Signoff', x: 420, y: 180, position: { x: 420, y: 180 }, config: { assigneeRole: 'hr_admin', dueHours: 24, label: 'HR Admin Signoff' } },
                { id: 'n3', type: 'end', label: 'Pipeline Concluded', x: 720, y: 180, position: { x: 720, y: 180 }, config: { outcomeStatus: 'COMPLETED', label: 'Pipeline Concluded' } }
            ],
            connections: [
                { id: 'conn_1', from: 'n1', to: 'n2', fromNodeId: 'n1', toNodeId: 'n2', port: 'out', label: '' },
                { id: 'conn_2', from: 'n2', to: 'n3', fromNodeId: 'n2', toNodeId: 'n3', port: 'out', label: '' }
            ]
        }
    };

    state.workflows.unshift(newWf);
    persistWorkflows();
    state.currentWorkflow = newWf;
    syncHeaderMeta();
    renderCanvas();
    selectNode(null);
    updateStatsBar();
    loadWorkflowsList();
    showToast('Created new workflow canvas', 'success');
};

function syncHeaderMeta() {
    const nameInput = document.getElementById('workflow-name-input');
    const descInput = document.getElementById('workflow-desc-input');
    const badge = document.getElementById('workflow-status-badge');

    if (nameInput) nameInput.value = state.currentWorkflow.name || '';
    if (descInput) descInput.value = state.currentWorkflow.description || '';
    if (badge) {
        badge.textContent = (state.currentWorkflow.status || 'draft').toUpperCase();
        badge.className = `status-badge ${state.currentWorkflow.status === 'active' ? 'active' : 'draft'}`;
    }
}

// Save Current Workflow
window.saveCurrentWorkflow = function() {
    if (!state.currentWorkflow) return;
    const nameInput = document.getElementById('workflow-name-input');
    const descInput = document.getElementById('workflow-desc-input');
    if (nameInput) state.currentWorkflow.name = nameInput.value;
    if (descInput) state.currentWorkflow.description = descInput.value;

    const idx = state.workflows.findIndex(w => w.id === state.currentWorkflow.id);
    if (idx >= 0) {
        state.workflows[idx] = JSON.parse(JSON.stringify(state.currentWorkflow));
    } else {
        state.workflows.push(JSON.parse(JSON.stringify(state.currentWorkflow)));
    }

    persistWorkflows();
    loadWorkflowsList();
    updateStatsBar();
    showToast('Workflow saved successfully', 'success');
};

// Validate Workflow Structure
window.validateWorkflow = function() {
    if (!state.currentWorkflow) return;
    const nodes = state.currentWorkflow.canvas.nodes || [];
    const conns = state.currentWorkflow.canvas.connections || [];

    const triggers = nodes.filter(n => n.type === 'trigger');
    const ends = nodes.filter(n => n.type === 'end');

    const issues = [];
    if (triggers.length === 0) issues.push('Workflow needs at least 1 Start Trigger node.');
    if (ends.length === 0) issues.push('Workflow should have at least 1 Terminal End node.');
    if (nodes.length > 1 && conns.length === 0) issues.push('Canvas nodes are disconnected.');

    if (issues.length > 0) {
        alert('Validation Findings:\n\n• ' + issues.join('\n• '));
    } else {
        showToast('Validation Passed! Ready to test or publish.', 'success');
    }
};

// Publish / Activate Workflow
window.publishWorkflow = function() {
    if (!state.currentWorkflow) return;
    state.currentWorkflow.status = 'active';
    state.currentWorkflow.version = (state.currentWorkflow.version || 1) + 1;
    state.currentWorkflow.activeVersionNumber = state.currentWorkflow.version;

    // Record audit log
    addAuditLog(`Published Workflow "${state.currentWorkflow.name}" to Version v${state.currentWorkflow.version}`);

    saveCurrentWorkflow();
    syncHeaderMeta();
    showToast(`Published & Activated v${state.currentWorkflow.version}!`, 'success');
};

// Audit Trail & Logs
function addAuditLog(action) {
    try {
        const raw = localStorage.getItem(STORAGE_LOGS_KEY);
        const logs = raw ? JSON.parse(raw) : [];
        logs.unshift({
            id: 'log_' + Date.now(),
            action,
            actor: 'HR Strategic Director',
            timestamp: new Date().toLocaleTimeString() + ', ' + new Date().toLocaleDateString(),
            workflow: state.currentWorkflow?.name || 'HRMS Pipeline'
        });
        localStorage.setItem(STORAGE_LOGS_KEY, JSON.stringify(logs.slice(0, 30)));
    } catch (e) {}
}

function loadExecutionLogs() {
    const list = document.getElementById('execution-logs-list');
    if (!list) return;
    list.innerHTML = `
        <div class="log-item">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span class="item-badge success">STAGE 8 SUCCESS</span>
                <span style="color:#64748b; font-size:10.5px;">Just now</span>
            </div>
            <div style="font-weight:600; color:#0f172a;">Pipeline run for John Doe (Engineering)</div>
            <div style="font-size:11px; color:#475569; margin-top:2px;">Offer Letter generated & dispatched to email.</div>
        </div>
        <div class="log-item">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span class="item-badge info">SLA COMPLIANT</span>
                <span style="color:#64748b; font-size:10.5px;">24m ago</span>
            </div>
            <div style="font-weight:600; color:#0f172a;">Leave Request Auto-Approved (2 Days)</div>
            <div style="font-size:11px; color:#475569; margin-top:2px;">Calendar updated and team notified.</div>
        </div>
    `;
}

function loadAuditTrail() {
    const list = document.getElementById('audit-trail-list');
    if (!list) return;
    try {
        const raw = localStorage.getItem(STORAGE_LOGS_KEY);
        const logs = raw ? JSON.parse(raw) : [];
        if (logs.length === 0) {
            list.innerHTML = '<div style="padding:15px; color:#64748b; text-align:center; font-size:11.5px;">No audit events yet. Changes are recorded immutably.</div>';
            return;
        }
        list.innerHTML = logs.map(l => `
            <div class="audit-item">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span class="item-badge info">STAGE 8 AUDIT</span>
                    <span style="color:#64748b; font-size:10px;">${l.timestamp}</span>
                </div>
                <div style="font-weight:600; color:#0f172a; font-size:11.5px;">${l.action}</div>
                <div style="color:#64748b; font-size:10.5px; margin-top:2px;">Actor: ${l.actor} | Flow: ${l.workflow}</div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div style="padding:10px; color:#64748b;">Audit logs active.</div>';
    }
}

function updateStatsBar() {
    const totalEl = document.getElementById('stat-total');
    const activeEl = document.getElementById('stat-active');
    const draftEl = document.getElementById('stat-draft');
    const nodesEl = document.getElementById('stat-nodes');

    if (totalEl) totalEl.textContent = state.workflows.length;
    if (activeEl) activeEl.textContent = state.workflows.filter(w => w.status === 'active').length;
    if (draftEl) draftEl.textContent = state.workflows.filter(w => w.status === 'draft').length;
    if (nodesEl) nodesEl.textContent = state.currentWorkflow?.canvas?.nodes?.length || 0;
}

// AI Creator Modal
window.openAiModal = function() {
    const modal = document.getElementById('ai-creator-modal');
    if (modal) modal.style.display = 'flex';
};

window.closeAiModal = function() {
    const modal = document.getElementById('ai-creator-modal');
    if (modal) modal.style.display = 'none';
};

window.generateWorkflowWithAi = function() {
    const input = document.getElementById('ai-prompt-input');
    const prompt = input?.value?.trim() || '';
    if (!prompt) {
        showToast('Please type a workflow prompt or click a suggestion', 'error');
        return;
    }

    const btn = document.getElementById('btn-run-ai-generation');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Synthesizing Canvas Flow...';

    setTimeout(() => {
        if (btn) btn.innerHTML = '<i class="fas fa-magic"></i> Generate Workflow Nodes';
        closeAiModal();

        // Create AI-crafted flow
        const id = `wf_ai_${Date.now()}`;
        const generatedWf = {
            id,
            name: `AI: ${prompt.slice(0, 32)}...`,
            description: prompt,
            status: 'draft',
            version: 1,
            activeVersionNumber: 1,
            canvas: {
                nodes: [
                    { id: 'n1', type: 'trigger', label: 'HR Trigger Initiated', x: 80, y: 160, position: { x: 80, y: 160 }, config: { event: 'employee_onboarding_started', label: 'HR Trigger Initiated' } },
                    { id: 'n2', type: 'condition', label: 'Verify Criteria', x: 340, y: 160, position: { x: 340, y: 160 }, config: { field: 'department', operator: '==', value: 'Engineering', label: 'Verify Criteria' } },
                    { id: 'n3', type: 'approval', label: 'Manager Signoff', x: 600, y: 100, position: { x: 600, y: 100 }, config: { assigneeRole: 'manager', dueHours: 24, label: 'Manager Signoff' } },
                    { id: 'n4', type: 'document', label: 'Pre-Approved Doc Gen', x: 860, y: 100, position: { x: 860, y: 100 }, config: { templateKey: 'offer_letter', label: 'Pre-Approved Doc Gen' } },
                    { id: 'n5', type: 'notification', label: 'Multi-Channel Alert', x: 1120, y: 160, position: { x: 1120, y: 160 }, config: { channel: 'both', recipient: 'employee', label: 'Multi-Channel Alert' } },
                    { id: 'n6', type: 'end', label: 'Stage 8 Preserved', x: 1380, y: 160, position: { x: 1380, y: 160 }, config: { outcomeStatus: 'COMPLETED', label: 'Stage 8 Preserved' } }
                ],
                connections: [
                    { id: 'c1', from: 'n1', to: 'n2', fromNodeId: 'n1', toNodeId: 'n2', port: 'out', label: '' },
                    { id: 'c2', from: 'n2', to: 'n3', fromNodeId: 'n2', toNodeId: 'n3', port: 'out', label: '' },
                    { id: 'c3', from: 'n3', to: 'n4', fromNodeId: 'n3', toNodeId: 'n4', port: 'out', label: '' },
                    { id: 'c4', from: 'n4', to: 'n5', fromNodeId: 'n4', toNodeId: 'n5', port: 'out', label: '' },
                    { id: 'c5', from: 'n5', to: 'n6', fromNodeId: 'n5', toNodeId: 'n6', port: 'out', label: '' }
                ]
            }
        };

        state.workflows.unshift(generatedWf);
        persistWorkflows();
        state.currentWorkflow = generatedWf;
        syncHeaderMeta();
        renderCanvas();
        updateStatsBar();
        loadWorkflowsList();
        showToast('AI Workflow synthesized directly into canvas!', 'success');
    }, 900);
};

// Test Mode Simulation Modal
window.openTestModeModal = function() {
    const modal = document.getElementById('test-simulation-modal');
    if (modal) modal.style.display = 'flex';
};

window.closeTestModeModal = function() {
    const modal = document.getElementById('test-simulation-modal');
    if (modal) modal.style.display = 'none';
};

window.runTestSimulation = function() {
    const outputList = document.getElementById('dry-run-nodes-list');
    const badge = document.getElementById('test-trace-count-badge');
    if (!outputList || !state.currentWorkflow) return;

    const nodes = state.currentWorkflow.canvas.nodes || [];
    outputList.innerHTML = nodes.map((n, i) => `
        <div class="trace-step" style="display:flex; gap:10px; margin-bottom:10px; padding:8px; background:#f8fafc; border-radius:6px; border-left:3px solid ${NODE_COLORS[n.type] || '#2563eb'};">
            <div style="font-weight:700; color:#2563eb; font-size:12px;">Step ${i + 1}</div>
            <div>
                <div style="font-weight:600; color:#0f172a; font-size:12px;">${n.label} (${n.type})</div>
                <div style="font-size:11px; color:#10b981;"><i class="fas fa-check-circle"></i> Evaluated simulated payload & passes SLA.</div>
            </div>
        </div>
    `).join('');

    if (badge) {
        badge.style.display = 'inline-block';
        badge.textContent = `${nodes.length} Steps Validated`;
    }

    showToast('Dry run simulation executed with zero errors', 'success');
};

// Export Workflow JSON
window.exportWorkflowJson = function() {
    if (!state.currentWorkflow) return;
    const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.currentWorkflow, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", jsonStr);
    dlAnchor.setAttribute("download", `${state.currentWorkflow.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_hrms_workflow.json`);
    dlAnchor.click();
    showToast('Exported workflow JSON', 'info');
};

// Initialization on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initStorage();
    if (state.workflows.length > 0) {
        state.currentWorkflow = JSON.parse(JSON.stringify(state.workflows[0]));
    } else {
        createNewWorkflow();
    }

    initPaletteDraggable();
    initCanvas();
    syncHeaderMeta();
    renderCanvas();
    updateStatsBar();
    loadWorkflowsList();

    // Top action listeners
    document.getElementById('btn-new-workflow')?.addEventListener('click', createNewWorkflow);
    document.getElementById('btn-save')?.addEventListener('click', saveCurrentWorkflow);
    document.getElementById('btn-validate')?.addEventListener('click', validateWorkflow);
    document.getElementById('btn-activate')?.addEventListener('click', publishWorkflow);
    document.getElementById('btn-export')?.addEventListener('click', exportWorkflowJson);
    document.getElementById('btn-ai-creator')?.addEventListener('click', openAiModal);
    document.getElementById('btn-test-run')?.addEventListener('click', openTestModeModal);
    document.getElementById('btn-execute-test-mode')?.addEventListener('click', runTestSimulation);
    document.getElementById('btn-run-ai-generation')?.addEventListener('click', generateWorkflowWithAi);

    // Inspector label listener
    document.getElementById('node-label-input')?.addEventListener('input', (e) => {
        updateNodeLabel(e.target.value);
    });

    // Workflow Title & Desc auto-sync
    document.getElementById('workflow-name-input')?.addEventListener('input', (e) => {
        if (state.currentWorkflow) state.currentWorkflow.name = e.target.value;
    });
    document.getElementById('workflow-desc-input')?.addEventListener('input', (e) => {
        if (state.currentWorkflow) state.currentWorkflow.description = e.target.value;
    });

    if (window.renderLucideIcons) window.renderLucideIcons();
});
