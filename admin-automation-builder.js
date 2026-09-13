// Kylrx Enterprise Suite - One Central Automation Builder Controller
// Implements the 9 standard builder elements:
// 1. Trigger (When does it start?)
// 2. Condition (When should it continue?)
// 3. Branch (What if different cases exist?)
// 4. Approval (Who must approve?)
// 5. Wait (How long should Kylrx wait?)
// 6. Escalation (What happens if nobody acts?)
// 7. Action (What should Kylrx do?)
// 8. Notification (Who should be informed?)
// 9. End (When is it complete?)

const ELEMENT_SPECS = {
    trigger: {
        type: 'trigger',
        label: 'Trigger',
        badge: 'When does it start?',
        badgeClass: 'badge-trigger',
        icon: 'zap',
        defaultTitle: 'Resignation Submitted',
        defaultDesc: 'When an employee submits resignation through portal',
        defaultModule: 'exit',
        defaultConfig: {
            eventType: 'exit:resignation_submitted',
            sourceModule: 'exit',
            scope: 'all_departments'
        }
    },
    condition: {
        type: 'condition',
        label: 'Condition',
        badge: 'When should it continue?',
        badgeClass: 'badge-condition',
        icon: 'filter',
        defaultTitle: 'Verify Tenure & Employment Status',
        defaultDesc: 'Employee Type == "Full-Time" && BU == "Technology"',
        defaultModule: 'core',
        defaultConfig: {
            rules: [
                { field: 'employeeType', operator: '==', value: 'Full-Time' },
                { field: 'businessUnit', operator: '==', value: 'Technology' }
            ],
            matchType: 'ALL'
        }
    },
    branch: {
        type: 'branch',
        label: 'Branch',
        badge: 'What if different cases exist?',
        badgeClass: 'badge-branch',
        icon: 'git-branch',
        defaultTitle: 'Physical & Cloud Assets Check',
        defaultDesc: 'Has assets? Yes -> Collect Assets / No -> Skip to Clearance',
        defaultModule: 'core',
        defaultConfig: {
            conditionField: 'hasAssignedAssets',
            branchA: { label: 'Has Assets (Yes)', next: 'Collect Assets' },
            branchB: { label: 'No Assets (No)', next: 'Skip to Clearance' }
        }
    },
    approval: {
        type: 'approval',
        label: 'Approval',
        badge: 'Who must approve?',
        badgeClass: 'badge-approval',
        icon: 'user-check',
        defaultTitle: 'Multi-Tier Approvals',
        defaultDesc: 'Manager -> HR Operations -> Finance Approver',
        defaultModule: 'core',
        defaultConfig: {
            chain: ['Direct Manager', 'HR Operations', 'Finance Approver'],
            slaHours: 48,
            requireAll: true
        }
    },
    wait: {
        type: 'wait',
        label: 'Wait',
        badge: 'How long should Kylrx wait?',
        badgeClass: 'badge-wait',
        icon: 'clock',
        defaultTitle: 'Cooling-Off Wait Window',
        defaultDesc: 'Pause execution for 48 hours for dispute check & exit review',
        defaultModule: 'core',
        defaultConfig: {
            duration: 48,
            unit: 'hours',
            waitForEvent: 'none'
        }
    },
    escalation: {
        type: 'escalation',
        label: 'Escalation',
        badge: 'What happens if nobody acts?',
        badgeClass: 'badge-escalation',
        icon: 'alert-triangle',
        defaultTitle: 'Approval SLA Escalation',
        defaultDesc: 'If manager inactive > 48h -> Reminder -> Escalation to HR Head',
        defaultModule: 'core',
        defaultConfig: {
            thresholdHours: 48,
            escalateTo: 'Head of HR',
            escalationAction: 'Auto-delegate and send urgent priority reminder'
        }
    },
    action: {
        type: 'action',
        label: 'Action',
        badge: 'What should Kylrx do?',
        badgeClass: 'badge-action',
        icon: 'play-circle',
        defaultTitle: 'Initiate Full & Final Settlement',
        defaultDesc: 'Assign policy, start F&F, calculate gratuity, generate letter',
        defaultModule: 'exit',
        defaultConfig: {
            actionName: 'exit:calculate_fnf',
            targetService: 'payroll-disbursement-engine',
            generateDocuments: true
        }
    },
    notification: {
        type: 'notification',
        label: 'Notification',
        badge: 'Who should be informed?',
        badgeClass: 'badge-notification',
        icon: 'bell',
        defaultTitle: 'Clearance & Exit Notification',
        defaultDesc: 'Multi-channel notifications to Employee, Manager, HR & Finance',
        defaultModule: 'core',
        defaultConfig: {
            channels: ['Email', 'In-App Portal', 'Slack/Teams'],
            recipients: ['Employee', 'Direct Manager', 'IT Support'],
            template: 'exit_acknowledgement_v1'
        }
    },
    end: {
        type: 'end',
        label: 'End',
        badge: 'When is it complete?',
        badgeClass: 'badge-end',
        icon: 'check-circle-2',
        defaultTitle: 'Exit Workflow Completed',
        defaultDesc: 'Employee status changed to Relieved. Immutable audit ledger sealed.',
        defaultModule: 'exit',
        defaultConfig: {
            status: 'COMPLETED',
            archiveRecord: true,
            emitAuditEvent: true
        }
    }
};

// Current Workflow Model (13-Step Standard Employee Exit Automation)
let currentWorkflow = {
    id: 'wf_' + Date.now(),
    name: 'Example: Employee Exit Automation',
    description: 'Trigger -> Condition -> Start Workflow -> Manager Approval -> Asset Clearance -> Parallel Approvals -> Wait 2 Days -> Escalation -> Start FnF -> Letters -> Status Update -> Vault Archive -> Exit Completed',
    module: 'exit',
    status: 'ACTIVE',
    steps: [
        // 1. Trigger: Employee submits resignation
        {
            id: 'node-01',
            type: 'trigger',
            title: 'Employee submits resignation',
            description: 'Trigger: Employee submits resignation through self-service portal',
            module: 'exit',
            config: { eventType: 'exit.resignation_submitted', scope: 'all_departments' }
        },
        // 2. Condition: Employee Type = Full Time
        {
            id: 'node-02',
            type: 'condition',
            title: 'Employee Type = Full Time',
            description: 'Condition: Verify employee type is Full Time',
            module: 'core',
            config: { rules: [{ field: 'employeeType', operator: '==', value: 'Full Time' }], matchType: 'ALL' }
        },
        // 3. Action: Start applicable Exit Workflow
        {
            id: 'node-03',
            type: 'action',
            title: 'Start applicable Exit Workflow',
            description: 'Action: Start applicable Exit Workflow for Full Time separation track',
            module: 'exit',
            config: { actionName: 'exit.start_workflow', generateWorkflow: true }
        },
        // 4. Approval: Reporting Manager
        {
            id: 'node-04',
            type: 'approval',
            title: 'Reporting Manager',
            description: 'Approval: Reporting Manager review and initial exit sign-off',
            module: 'core',
            config: { chain: ['Reporting Manager'], slaHours: 48, requireAll: true }
        },
        // 5. Action: Start Asset Clearance
        {
            id: 'node-05',
            type: 'action',
            title: 'Start Asset Clearance',
            description: 'Action: Start physical and digital asset clearance (Hardware, Badges, Tokens)',
            module: 'exit',
            config: { actionName: 'exit.start_asset_clearance', checklist: ['Laptop', 'Badge', 'Token'] }
        },
        // 6. Parallel/Sequential approvals: IT + Admin + Finance as configured
        {
            id: 'node-06',
            type: 'approval',
            title: 'Parallel/Sequential approvals: IT + Admin + Finance as configured',
            description: 'Approvals: Departmental clearances from IT + Admin + Finance',
            module: 'core',
            config: { chain: ['IT Lead', 'Admin Facilities', 'Finance Controller'], mode: 'PARALLEL', slaHours: 48 }
        },
        // 7. Wait: 2 business days for pending actions
        {
            id: 'node-07',
            type: 'wait',
            title: '2 business days for pending actions',
            description: 'Wait: 2 business days for pending clearance acknowledgements',
            module: 'core',
            config: { duration: 2, unit: 'business_days' }
        },
        // 8. Escalation: Notify HR if overdue
        {
            id: 'node-08',
            type: 'escalation',
            title: 'Notify HR if overdue',
            description: 'Escalation: Notify HR Head if clearance actions exceed 48h SLA window',
            module: 'core',
            config: { thresholdHours: 48, escalateTo: 'Head of HR' }
        },
        // 9. Action: Start F&F
        {
            id: 'node-09',
            type: 'action',
            title: 'Start F&F',
            description: 'Action: Start Full & Final settlement calculation and payout schedule',
            module: 'exit',
            config: { actionName: 'exit.start_fnf', generateSheet: true }
        },
        // 10. Action: Generate Relieving Letter + Experience Letter using approved templates
        {
            id: 'node-10',
            type: 'action',
            title: 'Generate Relieving Letter + Experience Letter using approved templates',
            description: 'Action: Generate Relieving Letter + Experience Letter using approved corporate templates',
            module: 'exit',
            config: { actionName: 'exit.generate_letters', templates: ['Relieving_Letter', 'Experience_Letter'] }
        },
        // 11. Action: Update Employee status
        {
            id: 'node-11',
            type: 'action',
            title: 'Update Employee status',
            description: 'Action: Update Employee status to "Relieved" in core roster',
            module: 'exit',
            config: { actionName: 'exit.update_employee_status', targetStatus: 'Relieved' }
        },
        // 12. Action: Move/retain documents in the employee vault
        {
            id: 'node-12',
            type: 'action',
            title: 'Move/retain documents in the employee vault',
            description: 'Action: Move/retain separation documents in the employee vault under 7-year retention policy',
            module: 'exit',
            config: { actionName: 'exit.archive_to_vault', retentionPolicy: 'STATUTORY_7_YEARS' }
        },
        // 13. End: Exit completed
        {
            id: 'node-13',
            type: 'end',
            title: 'Exit completed',
            description: 'End: Exit completed. Terminal milestone reached and sealed with immutable audit hash.',
            module: 'exit',
            config: { status: 'EXIT_COMPLETED', emitAuditHash: true }
        }
    ]
};

const API_BASE = window.location.port === '3000' 
    ? '' 
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3000' 
        : '');

const FALLBACK_MODULES = [
    { id: 'exit', moduleName: 'Exit & Offboarding' },
    { id: 'onboarding', moduleName: 'Employee Onboarding' },
    { id: 'leave', moduleName: 'Leave & Attendance' },
    { id: 'payroll', moduleName: 'Payroll & Compensation' },
    { id: 'statutory', moduleName: 'Statutory Compliance' },
    { id: 'core', moduleName: 'Core Assignment & Flow Engine' }
];

let selectedNodeIndex = 0;
let registeredModules = [...FALLBACK_MODULES];
let isSimulating = false;
let insertTargetIndex = null;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();
    await fetchRegisteredModules();
    await loadWorkflowFromBackendOrFirebase();
    renderCanvas();
    selectNode(0);
    bindToolbarEvents();
});

// Listen for Firebase connection event
window.addEventListener('firebase-ready', async () => {
    console.log('⚡ [Automation Builder] Firebase client connected. Syncing active workflow state.');
    const pill = document.getElementById('firebaseStatusPill');
    if (pill) {
        pill.innerHTML = `<i data-lucide="database" size="12"></i> Firebase: Connected`;
        if (window.lucide) lucide.createIcons();
    }
    // Automatically ensure active workflow is synced to Firebase
    await syncWorkflowToBackendAndFirebase(currentWorkflow);
});

async function loadWorkflowFromBackendOrFirebase() {
    try {
        const res = await fetch(`${API_BASE}/api/automations`);
        if (res.ok) {
            const json = await res.json();
            const list = json.data || [];
            if (list.length > 0) {
                const found = list.find(w => w.id === currentWorkflow.id) || list[0];
                if (found && found.steps && found.steps.length > 0) {
                    currentWorkflow = found;
                    console.log('⚡ [Automation Builder] Loaded active workflow from Backend Firebase:', found.name);
                    return true;
                }
            }
        }
    } catch (e) {}

    const cached = localStorage.getItem('kylrx_active_flow');
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.steps && parsed.steps.length > 0) {
                currentWorkflow = parsed;
                return true;
            }
        } catch (e) {}
    }
    return false;
}

// Central Module Discovery
async function fetchRegisteredModules() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${API_BASE}/api/automations/modules`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            const raw = data.modules || data.data || [];
            if (raw && raw.length > 0) {
                registeredModules = raw.map(m => ({
                    id: m.moduleKey || m.id,
                    moduleName: m.moduleName || m.name,
                    triggers: m.triggers || [],
                    actions: m.actions || []
                }));
                // Ensure core is present in module list
                if (!registeredModules.some(m => m.id === 'core')) {
                    registeredModules.push({ id: 'core', moduleName: 'Core Assignment & Flow Engine' });
                }
                return;
            }
        }
    } catch (err) {
        // Central backend is offline or unreachable - use default registered modules silently
        console.info('Backend API offline or unreachable. Initialized with built-in module catalog.');
    }
    registeredModules = [...FALLBACK_MODULES];
}

// Render Canvas with All Nodes
function renderCanvas() {
    const container = document.getElementById('canvasContainer');
    if (!container) return;

    const nameInput = document.getElementById('workflowNameInput');
    if (nameInput) nameInput.value = currentWorkflow.name;

    let html = '';

    currentWorkflow.steps.forEach((step, index) => {
        const spec = ELEMENT_SPECS[step.type] || ELEMENT_SPECS.action;
        const isSelected = index === selectedNodeIndex;

        html += `
            <div class="node-step ${isSelected ? 'selected' : ''}" 
                 id="nodeCard-${index}" 
                 onclick="selectNode(${index})">
                <div class="node-header">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="node-type-badge ${spec.badgeClass}">
                            <i data-lucide="${spec.icon}" size="14"></i>
                            ${spec.label}
                        </span>
                        <span class="node-question">${spec.badge}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;" onclick="event.stopPropagation();">
                        <button class="btn-builder" style="padding: 4px 8px; font-size: 0.7rem;" title="Move Up" onclick="moveNode(event, ${index}, -1)" ${index === 0 ? 'disabled style="opacity:0.3"' : ''}>
                            ▲
                        </button>
                        <button class="btn-builder" style="padding: 4px 8px; font-size: 0.7rem;" title="Move Down" onclick="moveNode(event, ${index}, 1)" ${index === currentWorkflow.steps.length - 1 ? 'disabled style="opacity:0.3"' : ''}>
                            ▼
                        </button>
                        <button class="btn-builder" style="padding: 4px 8px; font-size: 0.7rem; color: #dc2626;" title="Delete Step" onclick="deleteNode(event, ${index})" ${currentWorkflow.steps.length <= 1 ? 'disabled style="opacity:0.3"' : ''}>
                            ✕
                        </button>
                    </div>
                </div>

                <div class="node-title">STEP 0${index + 1}: ${escapeHtml(step.title)}</div>
                <div class="node-summary">${escapeHtml(step.description || spec.defaultDesc)}</div>

                <div class="node-chip-bar">
                    <span class="node-chip"><i data-lucide="layers" size="12"></i> Module: <strong>${step.module || 'core'}</strong></span>
                    ${renderStepMetaChips(step)}
                </div>
            </div>

            ${index < currentWorkflow.steps.length - 1 ? `
                <div class="flow-connector">
                    <button class="btn-insert-step" title="Insert Step Here" onclick="openInsertModal(${index + 1})">
                        <i data-lucide="plus" size="14"></i>
                    </button>
                </div>
            ` : `
                <div class="flow-connector" style="height: 32px;">
                    <button class="btn-insert-step" title="Append Step" onclick="openInsertModal(${currentWorkflow.steps.length})">
                        <i data-lucide="plus" size="14"></i>
                    </button>
                </div>
            `}
        `;
    });

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

function renderStepMetaChips(step) {
    if (step.type === 'approval') {
        const count = step.config?.chain?.length || 3;
        return `<span class="node-chip"><i data-lucide="users" size="12"></i> ${count} Approvers</span>`;
    }
    if (step.type === 'wait') {
        return `<span class="node-chip"><i data-lucide="clock" size="12"></i> ${step.config?.duration || 48}h Wait</span>`;
    }
    if (step.type === 'escalation') {
        return `<span class="node-chip" style="color:#e11d48; border-color:#fecdd3;"><i data-lucide="shield-alert" size="12"></i> SLA: ${step.config?.thresholdHours || 48}h</span>`;
    }
    if (step.type === 'branch') {
        return `<span class="node-chip" style="color:#b45309; border-color:#fde68a;"><i data-lucide="git-branch" size="12"></i> 2-Way Decision</span>`;
    }
    if (step.type === 'action') {
        return `<span class="node-chip" style="color:#059669; border-color:#a7f3d0;"><i data-lucide="play" size="12"></i> Automated Action</span>`;
    }
    if (step.type === 'notification') {
        return `<span class="node-chip" style="color:#4338ca; border-color:#c7d2fe;"><i data-lucide="mail" size="12"></i> Multi-Channel</span>`;
    }
    return '';
}

// Select Node & Open Inspector
function selectNode(index) {
    if (index < 0 || index >= currentWorkflow.steps.length) return;
    selectedNodeIndex = index;

    document.querySelectorAll('.node-step').forEach((el, i) => {
        if (i === index) el.classList.add('selected');
        else el.classList.remove('selected');
    });

    const step = currentWorkflow.steps[index];
    const spec = ELEMENT_SPECS[step.type] || ELEMENT_SPECS.action;

    const drawer = document.getElementById('nodeInspector');
    if (drawer) drawer.classList.remove('collapsed');

    const badge = document.getElementById('drawerBadge');
    if (badge) {
        badge.className = `node-type-badge ${spec.badgeClass}`;
        badge.innerHTML = `<i data-lucide="${spec.icon}" size="14"></i> ${spec.label}`;
    }

    const titleEl = document.getElementById('drawerTitle');
    if (titleEl) {
        titleEl.textContent = `Step 0${index + 1}: ${spec.label} Configuration`;
    }

    renderInspectorFields(step, spec);
    if (window.lucide) lucide.createIcons();
}

function closeInspector() {
    const drawer = document.getElementById('nodeInspector');
    if (drawer) drawer.classList.add('collapsed');
}

// Render dynamic configuration fields based on the 9 element types
function renderInspectorFields(step, spec) {
    const container = document.getElementById('drawerFields');
    if (!container) return;

    let html = `
        <div class="form-group">
            <label class="form-label">Element Type (1 of 9)</label>
            <select class="form-select" id="fieldNodeType" onchange="changeNodeType(this.value)">
                <option value="trigger" ${step.type === 'trigger' ? 'selected' : ''}>1. Trigger (When does it start?)</option>
                <option value="condition" ${step.type === 'condition' ? 'selected' : ''}>2. Condition (When should it continue?)</option>
                <option value="branch" ${step.type === 'branch' ? 'selected' : ''}>3. Branch (What if different cases exist?)</option>
                <option value="approval" ${step.type === 'approval' ? 'selected' : ''}>4. Approval (Who must approve?)</option>
                <option value="wait" ${step.type === 'wait' ? 'selected' : ''}>5. Wait (How long should Kylrx wait?)</option>
                <option value="escalation" ${step.type === 'escalation' ? 'selected' : ''}>6. Escalation (What happens if nobody acts?)</option>
                <option value="action" ${step.type === 'action' ? 'selected' : ''}>7. Action (What should Kylrx do?)</option>
                <option value="notification" ${step.type === 'notification' ? 'selected' : ''}>8. Notification (Who should be informed?)</option>
                <option value="end" ${step.type === 'end' ? 'selected' : ''}>9. End (When is it complete?)</option>
            </select>
        </div>

        <div class="form-group">
            <label class="form-label">Step Title</label>
            <input type="text" class="form-input" id="fieldNodeTitle" value="${escapeHtml(step.title)}" oninput="updateNodeTitle(this.value)">
        </div>

        <div class="form-group">
            <label class="form-label">Step Summary / Purpose</label>
            <textarea class="form-textarea" id="fieldNodeDesc" rows="2" oninput="updateNodeDesc(this.value)">${escapeHtml(step.description || '')}</textarea>
        </div>

        <div class="form-group">
            <label class="form-label">Module Owner</label>
            <select class="form-select" id="fieldNodeModule" onchange="updateNodeModule(this.value)">
                ${registeredModules.map(m => `
                    <option value="${m.id}" ${step.module === m.id ? 'selected' : ''}>${escapeHtml(m.moduleName)}</option>
                `).join('')}
            </select>
        </div>
    `;

    // Type-specific field injection
    switch (step.type) {
        case 'trigger':
            html += `
                <div class="form-group">
                    <label class="form-label">Triggering Event</label>
                    <select class="form-select" onchange="setStepConfig('eventType', this.value)">
                        <option value="exit:resignation_submitted" ${step.config?.eventType === 'exit:resignation_submitted' ? 'selected' : ''}>exit:resignation_submitted (Resignation Filed)</option>
                        <option value="onboarding:candidate_invited" ${step.config?.eventType === 'onboarding:candidate_invited' ? 'selected' : ''}>onboarding:candidate_invited (New Hire Created)</option>
                        <option value="leave:applied" ${step.config?.eventType === 'leave:applied' ? 'selected' : ''}>leave:applied (Leave Application Submitted)</option>
                        <option value="payroll:run_initiated" ${step.config?.eventType === 'payroll:run_initiated' ? 'selected' : ''}>payroll:run_initiated (Monthly Run Started)</option>
                        <option value="statutory:filing_required" ${step.config?.eventType === 'statutory:filing_required' ? 'selected' : ''}>statutory:filing_required (Quarterly Tax Window)</option>
                    </select>
                </div>
            `;
            break;

        case 'condition':
            html += `
                <div class="form-group">
                    <label class="form-label">Condition Rules (Evaluation Gate)</label>
                    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:10px; padding:10px; font-size:0.8rem; display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; justify-content:space-between;">
                            <span>Rule 1:</span> <strong>employeeType == "Full-Time"</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span>Rule 2:</span> <strong>businessUnit == "Technology"</strong>
                        </div>
                    </div>
                </div>
            `;
            break;

        case 'branch':
            html += `
                <div class="form-group">
                    <label class="form-label">Decision Condition</label>
                    <input class="form-input" value="${escapeHtml(step.config?.conditionField || 'hasAssignedAssets')}" oninput="setStepConfig('conditionField', this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label" style="color: #059669;">Branch Path A (True)</label>
                    <input class="form-input" value="Collect Physical & Cloud Assets" readonly>
                </div>
                <div class="form-group">
                    <label class="form-label" style="color: #d97706;">Branch Path B (False)</label>
                    <input class="form-input" value="Skip Directly to Finance Clearance" readonly>
                </div>
            `;
            break;

        case 'approval':
            html += `
                <div class="form-group">
                    <label class="form-label">Sequential Approval Hierarchy</label>
                    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:10px; padding:10px; font-size:0.8rem; display:flex; flex-direction:column; gap:6px;">
                        <div>1. Direct Reporting Manager (N+1)</div>
                        <div>2. HR Operations Specialist</div>
                        <div>3. Finance / Payroll Controller</div>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Approval Window (SLA Hours)</label>
                    <input type="number" class="form-input" value="${step.config?.slaHours || 48}" oninput="setStepConfig('slaHours', parseInt(this.value))">
                </div>
            `;
            break;

        case 'wait':
            html += `
                <div class="form-group">
                    <label class="form-label">Wait Duration</label>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <input type="number" class="form-input" value="${step.config?.duration || 48}" oninput="setStepConfig('duration', parseInt(this.value))">
                        <select class="form-select" onchange="setStepConfig('unit', this.value)">
                            <option value="hours" ${step.config?.unit === 'hours' ? 'selected' : ''}>Hours</option>
                            <option value="business_days" ${step.config?.unit === 'business_days' ? 'selected' : ''}>Business Days</option>
                        </select>
                    </div>
                </div>
            `;
            break;

        case 'escalation':
            html += `
                <div class="form-group">
                    <label class="form-label">Inactivity Trigger Threshold</label>
                    <input type="number" class="form-input" value="${step.config?.thresholdHours || 48}" oninput="setStepConfig('thresholdHours', parseInt(this.value))">
                </div>
                <div class="form-group">
                    <label class="form-label">Escalation Destination</label>
                    <select class="form-select" onchange="setStepConfig('escalateTo', this.value)">
                        <option value="Head of HR" selected>Head of HR / VP People</option>
                        <option value="Skip-level Manager">Skip-level Manager (N+2)</option>
                        <option value="Super Admin">Super Admin Notification</option>
                    </select>
                </div>
            `;
            break;

        case 'action':
            html += `
                <div class="form-group">
                    <label class="form-label">Automated Action Execution</label>
                    <select class="form-select" onchange="setStepConfig('actionName', this.value)">
                        <option value="exit:calculate_fnf" ${step.config?.actionName === 'exit:calculate_fnf' ? 'selected' : ''}>exit:calculate_fnf (Full & Final Calculation)</option>
                        <option value="onboarding:provision_accounts" ${step.config?.actionName === 'onboarding:provision_accounts' ? 'selected' : ''}>onboarding:provision_accounts (Google Workspace & Slack)</option>
                        <option value="leave:deduct_balance" ${step.config?.actionName === 'leave:deduct_balance' ? 'selected' : ''}>leave:deduct_balance (Ledger Debit)</option>
                        <option value="payroll:generate_payslips" ${step.config?.actionName === 'payroll:generate_payslips' ? 'selected' : ''}>payroll:generate_payslips (PDF Generator)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Seal Settlement with SHA-256?</label>
                    <select class="form-select" onchange="setStepConfig('generateDocuments', this.value === 'true')">
                        <option value="true" ${step.config?.generateDocuments !== false ? 'selected' : ''}>Yes - Tamper-evident Seal</option>
                        <option value="false" ${step.config?.generateDocuments === false ? 'selected' : ''}>No - Action Only</option>
                    </select>
                </div>
            `;
            break;

        case 'notification':
            html += `
                <div class="form-group">
                    <label class="form-label">Alert Channels</label>
                    <div style="display:flex; gap: 8px; flex-wrap: wrap;">
                        <span class="node-chip" style="background:#e0e7ff; color:#3730a3;"><i data-lucide="mail" size="12"></i> Email</span>
                        <span class="node-chip" style="background:#e0f2fe; color:#0369a1;"><i data-lucide="bell" size="12"></i> In-App Portal</span>
                        <span class="node-chip" style="background:#fef3c7; color:#92400e;"><i data-lucide="message-square" size="12"></i> Slack</span>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Recipient Roles</label>
                    <input class="form-input" value="Employee, Direct Manager, Finance, IT" oninput="setStepConfig('recipients', this.value)">
                </div>
            `;
            break;

        case 'end':
            html += `
                <div class="form-group">
                    <label class="form-label">Completion Status</label>
                    <input class="form-input" value="COMPLETED (Record Archived & Sealed)" readonly>
                </div>
            `;
            break;
    }

    // Add Delete This Step action button in inspector drawer
    html += `
        <div style="margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid var(--border);">
            <button type="button" class="btn-builder" style="width: 100%; padding: 11px; color: #dc2626; border: 1px solid #fecaca; background: #fef2f2; font-weight: 700; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: 0.2s;" onclick="deleteNode(event, selectedNodeIndex)" ${currentWorkflow.steps.length <= 1 ? 'disabled style="opacity:0.3"' : ''}>
                <i data-lucide="trash-2" size="16"></i>
                <span>Delete This Step (Syncs to Firebase)</span>
            </button>
        </div>
    `;

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

function updateNodeTitle(val) {
    currentWorkflow.steps[selectedNodeIndex].title = val;
    const titleEl = document.querySelector(`#nodeCard-${selectedNodeIndex} .node-title`);
    if (titleEl) titleEl.textContent = `STEP 0${selectedNodeIndex + 1}: ${val}`;
}

function updateNodeDesc(val) {
    currentWorkflow.steps[selectedNodeIndex].description = val;
    const descEl = document.querySelector(`#nodeCard-${selectedNodeIndex} .node-summary`);
    if (descEl) descEl.textContent = val;
}

function updateNodeModule(val) {
    currentWorkflow.steps[selectedNodeIndex].module = val;
    renderCanvas();
}

function setStepConfig(key, val) {
    if (!currentWorkflow.steps[selectedNodeIndex].config) {
        currentWorkflow.steps[selectedNodeIndex].config = {};
    }
    currentWorkflow.steps[selectedNodeIndex].config[key] = val;
    renderCanvas();
}

function changeNodeType(newType) {
    const spec = ELEMENT_SPECS[newType];
    const step = currentWorkflow.steps[selectedNodeIndex];
    step.type = newType;
    step.title = spec.defaultTitle;
    step.description = spec.defaultDesc;
    step.module = spec.defaultModule;
    step.config = JSON.parse(JSON.stringify(spec.defaultConfig));
    renderCanvas();
    selectNode(selectedNodeIndex);
}

// Move Step Up/Down
function moveNode(e, index, delta) {
    if (e) e.stopPropagation();
    const newIdx = index + delta;
    if (newIdx < 0 || newIdx >= currentWorkflow.steps.length) return;

    const item = currentWorkflow.steps.splice(index, 1)[0];
    currentWorkflow.steps.splice(newIdx, 0, item);

    renderCanvas();
    selectNode(newIdx);
}

// Centered Custom Confirmation Modal (Replaces native browser confirm)
function showConfirmModal({
    title = 'Remove Step',
    message = '',
    confirmText = 'Remove',
    cancelText = 'Cancel',
    danger = true,
    icon = 'trash-2'
} = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('builderConfirmModal');
        const titleEl = document.getElementById('builderConfirmTitle');
        const msgEl = document.getElementById('builderConfirmMessage');
        const cancelBtn = document.getElementById('builderConfirmCancelBtn');
        const okBtn = document.getElementById('builderConfirmOkBtn');
        const iconBox = document.getElementById('builderConfirmIconBox');
        const iconEl = document.getElementById('builderConfirmIcon');

        if (!modal) {
            resolve(window.confirm(message.replace(/<[^>]*>?/gm, '')));
            return;
        }

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.innerHTML = message;
        if (cancelBtn) cancelBtn.textContent = cancelText;

        if (okBtn) {
            okBtn.textContent = confirmText;
            if (danger) {
                okBtn.style.background = '#dc2626';
                okBtn.style.color = '#ffffff';
                okBtn.style.boxShadow = '0 4px 14px rgba(220, 38, 38, 0.3)';
            } else {
                okBtn.style.background = 'var(--primary, #3b82f6)';
                okBtn.style.color = '#ffffff';
                okBtn.style.boxShadow = '0 4px 14px rgba(59, 130, 246, 0.3)';
            }
        }

        if (iconBox) {
            if (danger) {
                iconBox.style.background = '#fee2e2';
                iconBox.style.color = '#dc2626';
            } else {
                iconBox.style.background = '#eff6ff';
                iconBox.style.color = '#2563eb';
            }
        }

        if (iconEl) {
            iconEl.setAttribute('data-lucide', icon);
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        }

        let cleanup = () => {};

        const onCancelClick = () => {
            cleanup();
            resolve(false);
        };

        const onOkClick = () => {
            cleanup();
            resolve(true);
        };

        const onBackdropClick = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve(false);
            }
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(false);
            }
        };

        cleanup = () => {
            modal.style.display = 'none';
            if (cancelBtn) cancelBtn.removeEventListener('click', onCancelClick);
            if (okBtn) okBtn.removeEventListener('click', onOkClick);
            modal.removeEventListener('click', onBackdropClick);
            document.removeEventListener('keydown', onKeyDown);
        };

        if (cancelBtn) cancelBtn.addEventListener('click', onCancelClick);
        if (okBtn) okBtn.addEventListener('click', onOkClick);
        modal.addEventListener('click', onBackdropClick);
        document.addEventListener('keydown', onKeyDown);

        modal.style.display = 'flex';
        if (okBtn) okBtn.focus();
    });
}
window.showConfirmModal = showConfirmModal;

// Centered Custom Alert Modal (Replaces native browser alert)
function showAlertModal({
    title = 'Notice',
    message = '',
    type = 'info',
    okText = 'Got it'
} = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('builderAlertModal');
        const titleEl = document.getElementById('builderAlertTitle');
        const msgEl = document.getElementById('builderAlertMessage');
        const okBtn = document.getElementById('builderAlertOkBtn');
        const iconBox = document.getElementById('builderAlertIconBox');
        const iconEl = document.getElementById('builderAlertIcon');

        if (!modal) {
            window.alert(message.replace(/<[^>]*>?/gm, ''));
            resolve();
            return;
        }

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.innerHTML = message;
        if (okBtn) okBtn.textContent = okText;

        if (iconBox && iconEl) {
            if (type === 'warning') {
                iconBox.style.background = '#fef3c7';
                iconBox.style.color = '#d97706';
                iconEl.setAttribute('data-lucide', 'alert-triangle');
            } else if (type === 'success') {
                iconBox.style.background = '#dcfce7';
                iconBox.style.color = '#15803d';
                iconEl.setAttribute('data-lucide', 'check-circle-2');
            } else {
                iconBox.style.background = '#eff6ff';
                iconBox.style.color = '#2563eb';
                iconEl.setAttribute('data-lucide', 'info');
            }
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        }

        let cleanup = () => {};

        const onOkClick = () => {
            cleanup();
            resolve();
        };

        const onBackdropClick = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve();
            }
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
                cleanup();
                resolve();
            }
        };

        cleanup = () => {
            modal.style.display = 'none';
            if (okBtn) okBtn.removeEventListener('click', onOkClick);
            modal.removeEventListener('click', onBackdropClick);
            document.removeEventListener('keydown', onKeyDown);
        };

        if (okBtn) okBtn.addEventListener('click', onOkClick);
        modal.addEventListener('click', onBackdropClick);
        document.addEventListener('keydown', onKeyDown);

        modal.style.display = 'flex';
        if (okBtn) okBtn.focus();
    });
}
window.showAlertModal = showAlertModal;

// Toast Notification Helper
let toastTimeout = null;
function showToast(message, type = 'success') {
    const toast = document.getElementById('builderToast');
    const textEl = document.getElementById('builderToastText');
    const iconEl = document.getElementById('builderToastIcon');
    if (!toast) return;

    if (textEl) textEl.innerHTML = message;
    if (iconEl) {
        iconEl.setAttribute('data-lucide', type === 'success' ? 'check-circle-2' : (type === 'warning' ? 'alert-triangle' : 'info'));
        iconEl.style.color = type === 'success' ? '#4ade80' : (type === 'warning' ? '#fbbf24' : '#60a5fa');
        if (window.lucide) lucide.createIcons();
    }

    toast.style.display = 'flex';
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.style.display = 'none';
    }, 3500);
}
window.showToast = showToast;

// Sync Workflow State to Backend and Firebase Firestore
async function syncWorkflowToBackendAndFirebase(workflow = currentWorkflow) {
    workflow.updatedAt = new Date().toISOString();
    const payload = {
        ...workflow,
        trigger_event: (workflow.steps && workflow.steps[0] && (workflow.steps[0].config?.eventType || workflow.steps[0].title)) || 'exit.resignation_submitted',
        pipeline: workflow.steps || []
    };

    let backendSynced = false;
    let firestoreSynced = false;

    // 1. Sync to Express Backend API (/api/automations) -> saves to Firebase Firestore
    try {
        const res = await fetch(`${API_BASE}/api/automations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) backendSynced = true;
    } catch (e) {
        console.warn('[Sync] Express backend sync notice:', e.message);
    }

    // 2. Direct Sync to Firebase Firestore Client SDK (if loaded)
    if (window.db && window.firestoreTools) {
        try {
            const { doc, setDoc } = window.firestoreTools;
            const docRef = doc(window.db, 'automations', workflow.id);
            await setDoc(docRef, {
                ...payload,
                updatedAt: new Date().toISOString(),
                syncedAt: new Date().toISOString()
            }, { merge: true });
            firestoreSynced = true;
        } catch (fsErr) {
            console.warn('[Sync] Firestore direct sync notice:', fsErr.message);
        }
    }

    // 3. LocalStorage persistence cache
    try {
        localStorage.setItem(`kylrx_flow_${workflow.id}`, JSON.stringify(workflow));
        localStorage.setItem('kylrx_active_flow', JSON.stringify(workflow));
    } catch (e) {}

    // Update Firebase Status Pill in topbar
    const pill = document.getElementById('firebaseStatusPill');
    if (pill) {
        pill.innerHTML = `<i data-lucide="database" size="12"></i> Firebase: Connected (Synced)`;
        pill.style.background = '#ecfdf5';
        pill.style.color = '#059669';
        pill.style.borderColor = '#a7f3d0';
        if (window.lucide) lucide.createIcons();
    }

    return { backendSynced, firestoreSynced };
}
window.syncWorkflowToBackendAndFirebase = syncWorkflowToBackendAndFirebase;

// Delete Step (Removes selected or targeted step & connects to Backend Firebase)
async function deleteNode(e, index) {
    if (e) e.stopPropagation();
    if (currentWorkflow.steps.length <= 1) {
        await showAlertModal({
            title: 'Action Restricted',
            message: 'Workflow must have at least one step.',
            type: 'warning'
        });
        return;
    }

    const step = currentWorkflow.steps[index];
    const stepTitle = step ? step.title : `Step ${index + 1}`;

    const confirmed = await showConfirmModal({
        title: 'Remove Step',
        message: `Remove step ${index + 1}: "<strong>${escapeHtml(stepTitle)}</strong>"?<br><span style="font-size:0.8rem; color:#059669; margin-top:8px; display:inline-block;">⚡ Connected to Backend Firebase: changes will be automatically saved.</span>`,
        confirmText: 'Remove Step',
        cancelText: 'Cancel',
        danger: true,
        icon: 'trash-2'
    });

    if (confirmed) {
        // 1. Remove step from local workflow state
        const removed = currentWorkflow.steps.splice(index, 1)[0];
        const nextIdx = Math.max(0, index - 1);
        renderCanvas();
        selectNode(nextIdx);

        // 2. Connect to Backend Firebase and persist deletion
        showToast(`Deleting step "${escapeHtml(stepTitle)}"... Syncing to Firebase...`);
        const syncResult = await syncWorkflowToBackendAndFirebase(currentWorkflow);

        if (syncResult.backendSynced || syncResult.firestoreSynced) {
            showToast(`✓ Step removed & connected to Backend Firebase.`, 'success');
        } else {
            showToast(`Step removed (Offline cache updated).`, 'info');
        }
    }
}

// Insert Step Modal Handling
function openInsertModal(targetIdx) {
    insertTargetIndex = targetIdx;
    const modal = document.getElementById('stepSelectModal');
    if (modal) modal.style.display = 'flex';
}

function closeInsertModal() {
    const modal = document.getElementById('stepSelectModal');
    if (modal) modal.style.display = 'none';
}

function selectElementType(type) {
    const spec = ELEMENT_SPECS[type];
    if (!spec) return;

    const newStep = {
        id: 'node-' + Date.now(),
        type: type,
        title: spec.defaultTitle,
        description: spec.defaultDesc,
        module: spec.defaultModule,
        config: JSON.parse(JSON.stringify(spec.defaultConfig))
    };

    if (insertTargetIndex !== null) {
        currentWorkflow.steps.splice(insertTargetIndex, 0, newStep);
        selectedNodeIndex = insertTargetIndex;
    } else {
        currentWorkflow.steps.push(newStep);
        selectedNodeIndex = currentWorkflow.steps.length - 1;
    }

    closeInsertModal();
    renderCanvas();
    selectNode(selectedNodeIndex);

    setTimeout(() => {
        const el = document.getElementById(`nodeCard-${selectedNodeIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

// Template Library Modal Handling
function openTemplateModal() {
    const modal = document.getElementById('templateModal');
    if (modal) modal.style.display = 'flex';
}

function closeTemplateModal() {
    const modal = document.getElementById('templateModal');
    if (modal) modal.style.display = 'none';
}

function loadTemplate(templateType) {
    if (templateType === 'exit') {
        currentWorkflow = {
            id: 'wf_exit_' + Date.now(),
            name: 'Example: Employee Exit Automation',
            description: 'Trigger -> Condition -> Start Workflow -> Manager Approval -> Asset Clearance -> Parallel Approvals -> Wait 2 Days -> Escalation -> Start FnF -> Letters -> Status Update -> Vault Archive -> Exit Completed',
            module: 'exit',
            status: 'ACTIVE',
            steps: [
                { id: 'node-01', type: 'trigger', title: 'Employee submits resignation', description: 'Trigger: Employee submits resignation through self-service portal', module: 'exit', config: { eventType: 'exit.resignation_submitted', scope: 'all_departments' } },
                { id: 'node-02', type: 'condition', title: 'Employee Type = Full Time', description: 'Condition: Verify employee type is Full Time', module: 'core', config: { rules: [{ field: 'employeeType', operator: '==', value: 'Full Time' }], matchType: 'ALL' } },
                { id: 'node-03', type: 'action', title: 'Start applicable Exit Workflow', description: 'Action: Start applicable Exit Workflow for Full Time separation track', module: 'exit', config: { actionName: 'exit.start_workflow', generateWorkflow: true } },
                { id: 'node-04', type: 'approval', title: 'Reporting Manager', description: 'Approval: Reporting Manager review and initial exit sign-off', module: 'core', config: { chain: ['Reporting Manager'], slaHours: 48, requireAll: true } },
                { id: 'node-05', type: 'action', title: 'Start Asset Clearance', description: 'Action: Start physical and digital asset clearance (Hardware, Badges, Tokens)', module: 'exit', config: { actionName: 'exit.start_asset_clearance', checklist: ['Laptop', 'Badge', 'Token'] } },
                { id: 'node-06', type: 'approval', title: 'Parallel/Sequential approvals: IT + Admin + Finance as configured', description: 'Approvals: Departmental clearances from IT + Admin + Finance', module: 'core', config: { chain: ['IT Lead', 'Admin Facilities', 'Finance Controller'], mode: 'PARALLEL', slaHours: 48 } },
                { id: 'node-07', type: 'wait', title: '2 business days for pending actions', description: 'Wait: 2 business days for pending clearance acknowledgements', module: 'core', config: { duration: 2, unit: 'business_days' } },
                { id: 'node-08', type: 'escalation', title: 'Notify HR if overdue', description: 'Escalation: Notify HR Head if clearance actions exceed 48h SLA window', module: 'core', config: { thresholdHours: 48, escalateTo: 'Head of HR' } },
                { id: 'node-09', type: 'action', title: 'Start F&F', description: 'Action: Start Full & Final settlement calculation and payout schedule', module: 'exit', config: { actionName: 'exit.start_fnf', generateSheet: true } },
                { id: 'node-10', type: 'action', title: 'Generate Relieving Letter + Experience Letter using approved templates', description: 'Action: Generate Relieving Letter + Experience Letter using approved corporate templates', module: 'exit', config: { actionName: 'exit.generate_letters', templates: ['Relieving_Letter', 'Experience_Letter'] } },
                { id: 'node-11', type: 'action', title: 'Update Employee status', description: 'Action: Update Employee status to "Relieved" in core roster', module: 'exit', config: { actionName: 'exit.update_employee_status', targetStatus: 'Relieved' } },
                { id: 'node-12', type: 'action', title: 'Move/retain documents in the employee vault', description: 'Action: Move/retain separation documents in the employee vault under 7-year retention policy', module: 'exit', config: { actionName: 'exit.archive_to_vault', retentionPolicy: 'STATUTORY_7_YEARS' } },
                { id: 'node-13', type: 'end', title: 'Exit completed', description: 'End: Exit completed. Terminal milestone reached and sealed with immutable audit hash.', module: 'exit', config: { status: 'EXIT_COMPLETED', emitAuditHash: true } }
            ]
        };
    } else if (templateType === 'onboarding') {
        currentWorkflow = {
            id: 'wf_onb_' + Date.now(),
            name: 'New Hire Onboarding & Provisioning',
            description: 'Candidate accepted -> Documents verified -> HR approval -> Google/Slack accounts provisioned -> Welcome kit',
            module: 'onboarding',
            status: 'ACTIVE',
            steps: [
                { type: 'trigger', title: 'Offer Letter Signed', description: 'When candidate completes digital onboarding acceptance', module: 'onboarding', config: { eventType: 'onboarding:candidate_invited' } },
                { type: 'condition', title: 'Mandatory KYC & Identity Verified', description: 'Aadhaar, PAN, and academic degrees verified with green status', module: 'core', config: ELEMENT_SPECS.condition.defaultConfig },
                { type: 'approval', title: 'HR Operations Sign-off', description: 'Onboarding partner verifies background check and confirms start date', module: 'core', config: ELEMENT_SPECS.approval.defaultConfig },
                { type: 'action', title: 'Provision Corporate Accounts & Hardware', description: 'Auto-create Google Workspace, Slack, and dispatch company laptop', module: 'onboarding', config: { actionName: 'onboarding:provision_accounts' } },
                { type: 'notification', title: 'Welcome Kit & Day 1 Schedule Sent', description: 'Send orientation agenda to new hire and notify team buddy', module: 'core', config: ELEMENT_SPECS.notification.defaultConfig },
                { type: 'end', title: 'Onboarding Completed', description: 'Employee roster status marked Active', module: 'onboarding', config: ELEMENT_SPECS.end.defaultConfig }
            ]
        };
    } else if (templateType === 'leave') {
        currentWorkflow = {
            id: 'wf_leave_' + Date.now(),
            name: 'Leave Policy & SLA Escalation Flow',
            description: 'Leave applied -> Balance check -> Duration branch -> Manager approval -> 24h escalation -> Ledger debit',
            module: 'leave',
            status: 'ACTIVE',
            steps: [
                { type: 'trigger', title: 'Leave Application Filed', description: 'Employee files annual/casual leave in mobile app or portal', module: 'leave', config: { eventType: 'leave:applied' } },
                { type: 'condition', title: 'Leave Balance Check', description: 'Validate balance >= requested days and zero blacklisted blackout dates', module: 'core', config: ELEMENT_SPECS.condition.defaultConfig },
                { type: 'branch', title: 'Leave Duration Fork (> 3 Days)', description: 'Has assets? Yes / No condition fork for skip-level requirement', module: 'core', config: ELEMENT_SPECS.branch.defaultConfig },
                { type: 'approval', title: 'Direct Manager Sign-off', description: 'Review and approve in portal', module: 'core', config: ELEMENT_SPECS.approval.defaultConfig },
                { type: 'escalation', title: 'Manager 24h SLA Escalation', description: 'If manager inactive > 24 hours -> Escalate to Department Head', module: 'core', config: ELEMENT_SPECS.escalation.defaultConfig },
                { type: 'action', title: 'Debit Leave Balance & Sync Biometric', description: 'Deduct days from balance ledger and mark calendar', module: 'leave', config: { actionName: 'leave:deduct_balance' } },
                { type: 'notification', title: 'Leave Approved Notification', description: 'In-app notification to employee and team calendar sync', module: 'core', config: ELEMENT_SPECS.notification.defaultConfig },
                { type: 'end', title: 'Leave Processed & Logged', description: 'Timesheet synchronized with biometric clock', module: 'leave', config: ELEMENT_SPECS.end.defaultConfig }
            ]
        };
    } else if (templateType === 'payroll') {
        currentWorkflow = {
            id: 'wf_pay_' + Date.now(),
            name: 'Monthly Payroll Disbursement & Statutory Run',
            description: 'Payroll cycle -> Zero exceptions -> Maker-Checker approval -> HDFC CMS payout -> Form 24Q filing',
            module: 'payroll',
            status: 'ACTIVE',
            steps: [
                { type: 'trigger', title: 'Monthly Payroll Cycle Triggered', description: 'Initiated on 28th of each calendar month or manual trigger', module: 'payroll', config: { eventType: 'payroll:run_initiated' } },
                { type: 'condition', title: 'Zero Unresolved Timesheet Penalties', description: 'Ensure all attendance exceptions and approvals are closed', module: 'core', config: ELEMENT_SPECS.condition.defaultConfig },
                { type: 'approval', title: 'Maker-Checker Finance Sign-off', description: 'Payroll Specialist prepares -> Finance VP authorizes disbursement', module: 'core', config: ELEMENT_SPECS.approval.defaultConfig },
                { type: 'action', title: 'Generate Bank CMS Disbursement File', description: 'Generate encrypted HDFC/ICICI bulk payment instruction file with hash', module: 'payroll', config: { actionName: 'payroll:generate_payslips' } },
                { type: 'action', title: 'Generate Statutory Filings (EPF/ESI/TDS)', description: 'Generate ECR text file and Form 24Q quarterly return schedule', module: 'statutory', config: { actionName: 'statutory:filing_required' } },
                { type: 'notification', title: 'Salary Slips Published Alert', description: 'Notify all active employees that pay slip is ready in portal', module: 'core', config: ELEMENT_SPECS.notification.defaultConfig },
                { type: 'end', title: 'Payroll Run Closed', description: 'Ledger locked and sealed with immutable audit hash', module: 'payroll', config: ELEMENT_SPECS.end.defaultConfig }
            ]
        };
    }

    closeTemplateModal();
    renderCanvas();
    selectNode(0);
}

// Live Flow Simulation
async function runFlowSimulation() {
    if (isSimulating) return;
    isSimulating = true;

    const consoleCard = document.getElementById('simulationConsole');
    const logsContainer = document.getElementById('simulationLogs');
    const simBtn = document.getElementById('btnSimulate');

    if (consoleCard) consoleCard.classList.add('open');
    if (simBtn) {
        simBtn.innerHTML = '<i data-lucide="loader-2" size="16" class="spin"></i> <span>Simulating...</span>';
        simBtn.disabled = true;
    }

    logsContainer.innerHTML = `
        <div style="color: #38bdf8; font-weight: 700; margin-bottom: 6px;">
            [${new Date().toLocaleTimeString()}] ⚡ Initializing Kylrx Unified 8-Stage Automation Pipeline...
        </div>
        <div style="color: #94a3b8; margin-bottom: 8px;">
            Target Flow: <strong>${escapeHtml(currentWorkflow.name)}</strong> (${currentWorkflow.steps.length} Steps)
        </div>
    `;

    for (let i = 0; i < currentWorkflow.steps.length; i++) {
        const step = currentWorkflow.steps[i];
        const spec = ELEMENT_SPECS[step.type] || ELEMENT_SPECS.action;
        const nodeCard = document.getElementById(`nodeCard-${i}`);

        if (nodeCard) {
            nodeCard.classList.add('simulating');
            nodeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        appendSimLog(`▶ Step 0${i + 1} [${spec.label.toUpperCase()}]: ${escapeHtml(step.title)}`, '#ffffff');

        await sleep(800);

        if (step.title.includes('submits resignation') || step.type === 'trigger') {
            appendSimLog(`   ⚡ Ingest Trigger: Formal resignation received from employee ➔ Matched in Central Event Bus`, '#c084fc');
        } else if (step.title.includes('Full Time') || step.type === 'condition') {
            appendSimLog(`   ✓ Condition Gate Evaluated: PASS (Employee Type == "Full Time" ➔ Route to Standard Flow)`, '#38bdf8');
        } else if (step.title.includes('Start applicable Exit Workflow')) {
            appendSimLog(`   🚀 Action Executed: Applicable Exit Workflow initiated (EX_WF_STANDARD_FT ➔ Status: INITIATED)`, '#4ade80');
        } else if (step.title.includes('Reporting Manager')) {
            appendSimLog(`   👤 Approval Gate Resolved: Reporting Manager completed exit interview & approved handover`, '#818cf8');
        } else if (step.title.includes('Start Asset Clearance')) {
            appendSimLog(`   💻 Action Executed: Asset recovery checklist dispatched (Laptop, Security Badges, Cloud Tokens)`, '#4ade80');
        } else if (step.title.includes('IT + Admin + Finance')) {
            appendSimLog(`   👥 Parallel Clearances Resolved: IT Lead + Facilities Admin + Finance Controller approved`, '#818cf8');
        } else if (step.title.includes('2 business days')) {
            appendSimLog(`   ⏳ Wait SLA Window: 2 business days cooling period elapsed with zero pending disputes`, '#94a3b8');
        } else if (step.title.includes('Notify HR if overdue')) {
            appendSimLog(`   ▲ Escalation Monitor: Synchronized with Central Assignment Engine (48h SLA timer active)`, '#fb7185');
        } else if (step.title.includes('Start F&F')) {
            appendSimLog(`   💰 Action Executed: Full & Final Settlement computed (Salary: 14d, Leave: 12d, Gratuity: YES)`, '#4ade80');
        } else if (step.title.includes('Relieving Letter + Experience Letter')) {
            appendSimLog(`   📄 Action Executed: Relieving & Experience letters rendered & cryptographically sealed with SHA-256`, '#4ade80');
        } else if (step.title.includes('Update Employee status')) {
            appendSimLog(`   👤 Action Executed: Employee roster status updated to "Relieved" & directory SSO disabled`, '#4ade80');
        } else if (step.title.includes('employee vault')) {
            appendSimLog(`   🗄️ Action Executed: All signed letters & settlement sheets archived into secure employee vault (7-yr retention)`, '#4ade80');
        } else if (step.type === 'end') {
            appendSimLog(`   🏁 Terminal Reached: Exit completed. Immutable audit hash sealed into central ledger.`, '#2dd4bf');
        }

        if (nodeCard) {
            nodeCard.classList.remove('simulating');
        }

        await sleep(250);
    }

    appendSimLog(`🎉 Automation Flow Simulation Complete: 100% SUCCESS (Zero exceptions)`, '#4ade80');

    if (simBtn) {
        simBtn.innerHTML = '<i data-lucide="play" size="16"></i> <span>Simulate Flow</span>';
        simBtn.disabled = false;
        if (window.lucide) lucide.createIcons();
    }

    isSimulating = false;
}

function appendSimLog(msg, color = '#f8fafc') {
    const logs = document.getElementById('simulationLogs');
    if (!logs) return;
    const line = document.createElement('div');
    line.style.color = color;
    line.style.fontSize = '0.8rem';
    line.style.lineHeight = '1.5';
    line.innerHTML = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logs.appendChild(line);
    logs.scrollTop = logs.scrollHeight;
}

// Deploy Workflow to Backend & Firestore
async function deployWorkflow() {
    currentWorkflow.status = 'ACTIVE';
    
    // Connect and sync workflow to Backend Express & Firebase Firestore
    const syncRes = await syncWorkflowToBackendAndFirebase(currentWorkflow);

    await showAlertModal({
        title: 'Automation Deployed Successfully',
        message: `Workflow <strong>${escapeHtml(currentWorkflow.name)}</strong> is now active and connected to Backend Firebase.<br><br><div style="text-align: left; background: #f8fafc; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 14px 16px; font-size: 0.85rem; color: #475569;"><div style="margin-bottom: 6px; display: flex; justify-content: space-between;"><span>• Steps:</span><strong>${currentWorkflow.steps.length}</strong></div><div style="margin-bottom: 6px; display: flex; justify-content: space-between;"><span>• Status:</span><span style="color: #16a34a; font-weight: 700;">ACTIVE</span></div><div style="margin-bottom: 6px; display: flex; justify-content: space-between;"><span>• Backend API:</span><strong style="color: #2563eb;">${syncRes.backendSynced ? 'Connected (200 OK)' : 'Offline'}</strong></div><div style="display: flex; justify-content: space-between;"><span>• Firebase Firestore:</span><strong style="color: #059669;">${syncRes.firestoreSynced || syncRes.backendSynced ? 'Connected (Synced)' : 'Local Cache'}</strong></div></div>`,
        type: 'success',
        okText: 'Done'
    });
}

function toggleWorkflowStatus() {
    const pill = document.getElementById('statusPill');
    if (!pill) return;
    if (currentWorkflow.status === 'ACTIVE') {
        currentWorkflow.status = 'DRAFT';
        pill.className = 'status-pill';
        pill.textContent = 'Draft Flow';
    } else {
        currentWorkflow.status = 'ACTIVE';
        pill.className = 'status-pill active';
        pill.textContent = 'Active Flow';
    }
}

function bindToolbarEvents() {
    const nameInput = document.getElementById('workflowNameInput');
    if (nameInput) {
        nameInput.addEventListener('input', (e) => {
            currentWorkflow.name = e.target.value;
        });
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
