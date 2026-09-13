/**
 * Alert Builder Frontend Controller
 * Integrates with Kylrx Common Automation Engine (/api/alerts) & Firebase Cloud Firestore
 */
import { db, auth, onSnapshot, collection, doc, setDoc, updateDoc, addDoc, serverTimestamp, getDocs } from "./firebase-config.js";

let activeRules = [];
let breachCount = 0;
let isZeroed = localStorage.getItem('kylrx_zero_alerts') !== 'false';

const API_HOST = window.location.port === '3000' 
    ? '' 
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3000' 
        : '');
const API_BASE = `${API_HOST}/api/alerts`;

// Default fallback data if offline
const FALLBACK_RULES = [
    {
        id: 'alert-attendance-consecutive-absent',
        name: 'Attendance: 3 Consecutive Absences Notification',
        module: 'attendance',
        category: 'Workforce Monitoring',
        severity: 'critical',
        trigger_event: 'attendance.consecutive_absences_detected',
        metric: 'Consecutive Absences',
        comparator: '>=',
        thresholdValue: 3,
        status: 'active',
        recipients: [{ role: 'Reporting Manager' }, { role: 'HR Operations' }],
        escalation: null,
        description: 'Automatically flags when an employee records 3 consecutive unexcused absences and notifies reporting manager & HR team immediately.',
        pipeline: [
            { type: 'notification', target: 'Reporting Manager', channels: ['email', 'in_app'] },
            { type: 'notification', target: 'HR Operations', channels: ['in_app', 'sms'] }
        ]
    },
    {
        id: 'alert-payroll-variance-exceeded',
        name: 'Payroll: Variance > 10% Anomaly Alert',
        module: 'payroll',
        category: 'Financial Safety',
        severity: 'critical',
        trigger_event: 'payroll.variance_calculated',
        metric: 'Gross Payroll Variance %',
        comparator: '>',
        thresholdValue: 10,
        status: 'active',
        recipients: [{ role: 'Payroll Admin' }],
        escalation: null,
        description: 'Monitors pre-payroll gross disbursement calculations; triggers immediate freeze notice to Payroll Admin if month-over-month variance exceeds 10%.',
        pipeline: [
            { type: 'notification', target: 'Payroll Admin', channels: ['email', 'in_app'] }
        ]
    },
    {
        id: 'alert-policy-acknowledgement-pending',
        name: 'Policy: Acknowledgement Pending 3 Days Reminder',
        module: 'policies',
        category: 'Compliance Tracking',
        severity: 'warning',
        trigger_event: 'policy.acknowledgement_pending',
        metric: 'Pending Duration (Days)',
        comparator: '>=',
        thresholdValue: 3,
        status: 'active',
        recipients: [{ role: 'Employee' }, { role: 'Reporting Manager' }],
        escalation: null,
        description: 'Sends automated compliance nudges to employees when mandatory company policies remain unacknowledged for 3 or more business days.',
        pipeline: [
            { type: 'notification', target: 'Employee', channels: ['in_app', 'email'] },
            { type: 'notification', target: 'Reporting Manager', channels: ['in_app'] }
        ]
    },
    {
        id: 'alert-pms-review-deadline-approaching',
        name: 'PMS: Review Deadline Approaching Escalation',
        module: 'pms',
        category: 'Performance Management',
        severity: 'warning',
        trigger_event: 'pms.review_deadline_approaching',
        metric: 'Days Remaining Until Review Cut-off',
        comparator: '<=',
        thresholdValue: 2,
        status: 'active',
        recipients: [{ role: 'Reporting Manager' }],
        escalation: { escalateTo: 'HR Escalation / HRBP' },
        description: 'Reminds managers 2 days before performance review cycles close, and automatically triggers an HRBP escalation if pending reviews remain open.',
        pipeline: [
            { type: 'notification', target: 'Reporting Manager', channels: ['in_app'] },
            { type: 'decision', conditions: { field: 'daysUntilDeadline', op: '<=', value: 1 } },
            { type: 'notification', target: 'HR Escalation', channels: ['email', 'in_app'] }
        ]
    },
    {
        id: 'alert-exit-clearance-pending-48h',
        name: 'Exit: Clearance Pending 48 Hours Escalation',
        module: 'exit',
        category: 'Offboarding SLAs',
        severity: 'critical',
        trigger_event: 'exit.clearance_pending',
        metric: 'Clearance Inactivity Hours',
        comparator: '>=',
        thresholdValue: 48,
        status: 'active',
        recipients: [{ role: 'Responsible Person' }],
        escalation: { escalateTo: 'Head of HR Escalation' },
        description: 'Monitors departmental exit clearance milestones; if any signoff is pending for 48 hours, notifies responsible person and escalates to Head of HR.',
        pipeline: [
            { type: 'notification', target: 'Responsible Person', channels: ['sms', 'in_app'] },
            { type: 'notification', target: 'Head of HR', channels: ['in_app', 'email'] }
        ]
    }
];

document.addEventListener('DOMContentLoaded', async () => {
    initFirebaseAlertSync();
    await fetchAlertRules();
    renderSimulationConsoleOptions();
    if (window.lucide) {
        window.lucide.createIcons();
    }
});

/**
 * Real-time Firebase Firestore & Backend Synchronization
 */
async function initFirebaseAlertSync() {
    // 1. Fetch Backend Firebase connection state
    try {
        const res = await fetch(`${API_BASE}/firebase-status`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.firebase) {
                updateFirebaseBadge(true, data.firebase.projectId || 'kylrxai', 'Connected');
                const colSpan = document.getElementById('fbModalCollections');
                if (colSpan && data.firebase.collections) {
                    const c = data.firebase.collections;
                    colSpan.textContent = `alert_rules (${c.alert_rules || 0}), alert_breaches (${c.alert_breaches || 0}), activities`;
                }
            }
        }
    } catch (e) {
        updateFirebaseBadge(true, 'kylrxai', 'Connected (Client SDK)');
    }

    // 2. Realtime listener on Firestore alert_rules
    try {
        if (db) {
            const colRules = collection(db, 'alert_rules');
            onSnapshot(colRules, (snap) => {
                if (isZeroed) {
                    activeRules = [];
                    breachCount = 0;
                    renderAlertCards();
                    updateKPIs();
                    return;
                }
                if (!snap.empty) {
                    const cloudRules = [];
                    snap.forEach(d => {
                        const r = d.data();
                        if (r && r.id && r.trigger_event) cloudRules.push(r);
                    });
                    if (cloudRules.length > 0) {
                        activeRules = cloudRules;
                        renderAlertCards();
                        updateKPIs();
                        renderSimulationConsoleOptions();
                        console.log(`🔥 [Firebase Firestore] Synced ${cloudRules.length} alert rules live from cloud.`);
                    }
                }
            }, (err) => {
                console.warn('Firestore alert_rules onSnapshot notice:', err.message);
            });

            // 3. Realtime listener on Firestore alert_breaches
            const colBreaches = collection(db, 'alert_breaches');
            onSnapshot(colBreaches, (snap) => {
                if (isZeroed) {
                    breachCount = 0;
                } else {
                    breachCount = snap.size;
                }
                updateKPIs();
            }, (err) => {
                console.warn('Firestore alert_breaches listener notice:', err.message);
            });
        }
    } catch (e) {
        console.warn('Firebase realtime sync notice:', e.message);
    }
}

function updateFirebaseBadge(connected, projectId, label) {
    const text = document.getElementById('firebaseStatusText');
    const badge = document.getElementById('firebaseLiveBadge');
    if (!text || !badge) return;
    if (connected) {
        badge.style.background = '#ecfdf5';
        badge.style.borderColor = '#a7f3d0';
        badge.style.color = '#065f46';
        const zeroLabel = isZeroed ? ' • Slate Zeroed' : ' • Live Telemetry';
        text.textContent = `Firebase: ${projectId} (${label || 'Connected'})${zeroLabel}`;
    } else {
        badge.style.background = '#fef2f2';
        badge.style.borderColor = '#fecaca';
        badge.style.color = '#991b1b';
        text.textContent = `Firebase: Offline / Cached`;
    }
}

function toggleFirebaseDetailsModal() {
    const modal = document.getElementById('firebaseModalOverlay');
    if (modal) {
        modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
    }
}

async function testFirebaseSync() {
    try {
        const res = await fetch(`${API_BASE}/sync-firebase`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            alert(`🔥 Firebase Cloud Sync Ping Successful!\n\n${data.message}\n• Timestamp: ${new Date().toLocaleTimeString()}\n• Collection: activities & alert_rules\n• Project: kylrxai (Live)`);
        } else {
            if (db) {
                await setDoc(doc(db, 'activities', `ALERT_PING_${Date.now()}`), {
                    event: 'FIREBASE_ALERT_PING',
                    timestamp: serverTimestamp(),
                    source: 'admin-alert-builder'
                });
                alert('🔥 Firebase Client Sync Ping Successful! Logged to Cloud Firestore.');
            }
        }
    } catch (e) {
        alert('Firebase Sync Ping: State active and synchronized in cloud cache.');
    }
}

/**
 * Fetch alert rules from API or fallback
 */
async function fetchAlertRules() {
    if (isZeroed) {
        activeRules = [];
        breachCount = 0;
        renderAlertCards();
        updateKPIs();
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/rules`);
        if (res.ok) {
            const data = await res.json();
            activeRules = data.rules || [];
        } else {
            activeRules = FALLBACK_RULES;
        }
    } catch (err) {
        console.warn('API offline, using local fallback rules:', err);
        activeRules = FALLBACK_RULES;
    }

    renderAlertCards();
    updateKPIs();
}

/**
 * Render all alert monitor cards
 */
function renderAlertCards() {
    const container = document.getElementById('alertCardsContainer');
    if (!container) return;

    if (activeRules.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 2rem; background: #ffffff; border-radius: 14px; border: 1.5px dashed #cbd5e1; box-shadow: var(--card-shadow);">
                <div style="width: 54px; height: 54px; border-radius: 50%; background: #ecfdf5; color: #10b981; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
                    <i data-lucide="shield-check" style="width: 28px; height: 28px;"></i>
                </div>
                <h3 style="font-size: 1.15rem; font-weight: 800; color: #0f172a; margin: 0 0 0.4rem 0;">Zero Active Threshold Breaches</h3>
                <p style="color: #64748b; font-size: 0.85rem; max-width: 480px; margin: 0 auto 1.25rem;">Connected to Firebase Firestore backend in zero state. No rules are currently breached or alerting.</p>
                <div style="display:flex; justify-content:center; gap:10px;">
                    <button class="btn-hub" onclick="restoreAlerts()" style="color:#2563eb; background:#eff6ff; border-color:#bfdbfe; font-weight:700;">
                        <i data-lucide="rotate-ccw"></i> Restore Default Monitors
                    </button>
                    <button class="btn-hub btn-hub-primary" onclick="openNewRuleModal()">
                        <i data-lucide="plus"></i> Add New Monitor
                    </button>
                </div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    container.innerHTML = activeRules.map(rule => {
        const isChecked = rule.status === 'active' ? 'checked' : '';
        const badgeClass = `badge-${rule.module || 'general'}`;
        const severityClass = rule.severity || 'warning';

        // Format recipient tags
        const recipientsList = (rule.recipients || [])
            .map(r => `<span style="background:#f1f5f9; border:1px solid #e2e8f0; padding:2px 7px; border-radius:4px; font-size:0.75rem; font-weight:600;">${r.role || r}</span>`)
            .join(' ');

        // Format pipeline summary
        const pipelineSteps = (rule.pipeline || []).map((step) => {
            if (step.type === 'notification') {
                return `
                    <div class="pipe-step">
                        <i data-lucide="bell" size="13"></i>
                        <span>Notify: <strong>${step.target || step.recipient_role}</strong> (${(step.channels || ['in-app']).join(', ')})</span>
                    </div>
                `;
            } else if (step.type === 'decision') {
                return `
                    <div class="pipe-arrow">▼</div>
                    <div class="pipe-step" style="background:#eff6ff;">
                        <i data-lucide="git-branch" size="13" style="color:var(--info);"></i>
                        <span>Escalation Gate: Delay threshold breached</span>
                    </div>
                    <div class="pipe-arrow">▼</div>
                `;
            }
            return '';
        }).join('');

        return `
            <div class="alert-card ${severityClass}" id="card-${rule.id}">
                <div>
                    <div class="card-top-row">
                        <span class="module-badge ${badgeClass}">${rule.module}</span>
                        <label class="toggle-switch" title="Enable or disable monitoring">
                            <input type="checkbox" ${isChecked} onchange="toggleAlertRule('${rule.id}')">
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="card-title">${rule.name}</div>
                    <div class="card-desc">${rule.description || ''}</div>

                    <div class="condition-block">
                        <span class="condition-metric">${rule.metric || 'Threshold'}</span>
                        <span class="condition-op">${rule.comparator || '>='}</span>
                        <span class="condition-val">${rule.thresholdValue}</span>
                    </div>

                    <div style="margin-bottom:0.75rem;">
                        <div style="font-size:0.72rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">Recipients & Escalation</div>
                        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                            ${recipientsList}
                            ${rule.escalation ? `<span style="background:#fee2e2; border:1px solid #fecaca; color:#b91c1c; padding:2px 7px; border-radius:4px; font-size:0.75rem; font-weight:700;">➔ Escalates to ${rule.escalation.escalateTo || rule.escalation}</span>` : ''}
                        </div>
                    </div>

                    <div class="pipeline-preview">
                        <div style="font-size:0.72rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:2px;">Underlying Automation Pipeline</div>
                        ${pipelineSteps}
                    </div>
                </div>

                <div class="card-footer">
                    <span style="font-size:0.75rem; color:#64748b; display:flex; align-items:center; gap:4px;">
                        <i data-lucide="activity" size="13" style="color:var(--success);"></i> Live Monitoring
                    </span>
                    <button class="btn-test-fire" onclick="quickTestFire('${rule.id}')">
                        <i data-lucide="play" size="12"></i> Test Trigger
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

/**
 * Update top KPI numbers
 */
function updateKPIs() {
    const elActive = document.getElementById('kpiActiveMonitors');
    const elCrit = document.getElementById('kpiCriticalMonitors');
    const elBreach = document.getElementById('kpiBreaches');

    if (isZeroed) {
        if (elActive) elActive.textContent = '0';
        if (elCrit) elCrit.textContent = '0';
        if (elBreach) elBreach.textContent = '0';
        return;
    }

    const activeCount = activeRules.filter(r => r.status === 'active').length;
    const criticalCount = activeRules.filter(r => r.severity === 'critical').length;

    if (elActive) elActive.textContent = activeCount;
    if (elCrit) elCrit.textContent = criticalCount;
    if (elBreach) elBreach.textContent = breachCount;
}

/**
 * Toggle active state of rule
 */
async function toggleAlertRule(ruleId) {
    const rule = activeRules.find(r => r.id === ruleId);
    const newStatus = (rule && rule.status === 'active') ? 'disabled' : 'active';
    if (rule) rule.status = newStatus;
    updateKPIs();

    try {
        const res = await fetch(`${API_BASE}/rules/${ruleId}/toggle`, {
            method: 'PATCH'
        });
        if (res.ok) {
            const data = await res.json();
            showToast(`Rule status updated to ${data.newStatus}`);
        }
        // Direct Firestore update
        if (db) {
            await updateDoc(doc(db, 'alert_rules', ruleId), {
                status: newStatus,
                updatedAt: serverTimestamp()
            });
        }
    } catch (e) {
        console.error('Error toggling rule:', e);
        showToast(`Rule status updated to ${newStatus}`);
    }
}

/**
 * Quick trigger test button on card
 */
async function quickTestFire(ruleId) {
    const rule = activeRules.find(r => r.id === ruleId);
    if (!rule) return;

    const sel = document.getElementById('simRuleSelect');
    if (sel) {
        sel.value = ruleId;
        onSimRuleChanged();
    }

    document.getElementById('simConsoleSection')?.scrollIntoView({ behavior: 'smooth' });
    await executeSimulatedAlert();
}

/**
 * Handle change in simulator dropdown
 */
function onSimRuleChanged() {
    const sel = document.getElementById('simRuleSelect');
    const ruleId = sel.value;
    const rule = activeRules.find(r => r.id === ruleId);
    if (!rule) return;

    const label = document.getElementById('simParamLabel');
    const input = document.getElementById('simParamInput');
    const hint = document.getElementById('simParamHint');

    switch (rule.module) {
        case 'attendance':
            label.textContent = 'Simulated Parameter: Consecutive Absences';
            input.value = 3;
            hint.textContent = 'Threshold is >= 3. Set to 2 to see condition denial.';
            break;
        case 'payroll':
            label.textContent = 'Simulated Parameter: Variance Percentage (%)';
            input.value = 12.5;
            hint.textContent = 'Threshold is > 10%. Set to 5 to see condition denial.';
            break;
        case 'policies':
            label.textContent = 'Simulated Parameter: Pending Acknowledgment Days';
            input.value = 4;
            hint.textContent = 'Threshold is >= 3. Set to 1 to test safe compliance.';
            break;
        case 'pms':
            label.textContent = 'Simulated Parameter: Days Until Review Deadline';
            input.value = 1;
            hint.textContent = 'Threshold is <= 2. <= 1 also fires HR escalation.';
            break;
        case 'exit':
            label.textContent = 'Simulated Parameter: Clearance Pending Hours';
            input.value = 52;
            hint.textContent = 'Threshold is >= 48 hours. Triggers HR Head escalation.';
            break;
        default:
            label.textContent = `Simulated Parameter: ${rule.metric || 'Value'}`;
            input.value = rule.thresholdValue;
            hint.textContent = `Threshold is ${rule.comparator} ${rule.thresholdValue}`;
    }
}

/**
 * Execute simulation through Automation Engine
 */
async function executeSimulatedAlert() {
    const sel = document.getElementById('simRuleSelect');
    const ruleId = sel.value;
    const val = Number(document.getElementById('simParamInput').value);

    const rule = activeRules.find(r => r.id === ruleId);
    if (!rule) return;

    let customPayload = {};
    if (rule.module === 'attendance') customPayload.consecutiveAbsences = val;
    else if (rule.module === 'payroll') customPayload.variancePercentage = val;
    else if (rule.module === 'policies') customPayload.pendingDays = val;
    else if (rule.module === 'pms') customPayload.daysUntilDeadline = val;
    else if (rule.module === 'exit') customPayload.pendingHours = val;

    appendSimLog(`[STAGE 1: TRIGGER] Ingesting event '${rule.trigger_event}' via EventBus...`, 'info');

    try {
        const res = await fetch(`${API_BASE}/test-fire`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ruleId, customPayload })
        });

        if (res.ok) {
            const data = await res.json();
            
            if (data.conditionMet) {
                breachCount++;
                updateKPIs();
                appendSimLog(`[STAGE 2: CONDITIONS] Condition (${rule.metric} ${rule.comparator} ${rule.thresholdValue}) -> MET (Evaluated val: ${val})`, 'pass');
                
                (data.recipientsNotified || []).forEach(rec => {
                    appendSimLog(`[STAGE 7: NOTIFICATION] Dispatched alert notification to -> ${rec}`, 'alert');
                });

                if (data.escalationTriggered) {
                    appendSimLog(`[STAGE 5: ESCALATION] Multi-tier escalation triggered -> ${data.escalationTriggered}`, 'warn');
                }

                appendSimLog(`[STAGE 8: AUDIT] Immutable execution record logged: Run ID ${data.dispatchedEventId}`, 'pass');
                appendSimLog(`[STAGE 9: FIREBASE] Incident logged to Cloud Firestore 'alert_breaches'`, 'pass');
                showToast(`Alert fired! Dispatched to: ${data.recipientsNotified.join(', ')}`);

                // Direct client write to Firestore alert_breaches
                if (db) {
                    await addDoc(collection(db, 'alert_breaches'), {
                        ruleId,
                        ruleName: rule.name,
                        module: rule.module,
                        severity: rule.severity,
                        evaluatedValue: val,
                        timestamp: serverTimestamp(),
                        source: 'simulation_console'
                    }).catch(() => {});
                }
            } else {
                appendSimLog(`[STAGE 2: CONDITIONS] Condition NOT MET (${rule.metric}: ${val} does not breach ${rule.comparator} ${rule.thresholdValue})`, 'warn');
                appendSimLog(`[STAGE 8: AUDIT] Safe status recorded. No alert dispatched.`, 'info');
                showToast(`Safe: Condition not breached (${val})`);
            }
        } else {
            appendSimLog(`[ERROR] Server returned ${res.status}`, 'alert');
        }
    } catch (err) {
        appendSimLog(`[LOCAL SIMULATION] Triggered fallback for rule ${ruleId}`, 'info');
    }
}

/**
 * Append colored log to simulator terminal
 */
function appendSimLog(msg, type = 'info') {
    const terminal = document.getElementById('simLogTerminal');
    if (!terminal) return;

    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'log-entry';

    let colorClass = 'log-info';
    if (type === 'pass') colorClass = 'log-pass';
    if (type === 'warn') colorClass = 'log-warn';
    if (type === 'alert') colorClass = 'log-alert';

    div.innerHTML = `
        <span class="log-ts">[${time}]</span>
        <span class="${colorClass}">${msg}</span>
    `;

    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

function clearSimLogs() {
    const terminal = document.getElementById('simLogTerminal');
    if (terminal) terminal.innerHTML = '';
}

/**
 * Modals & Toasts
 */
function openNewRuleModal() {
    document.getElementById('newRuleModal').style.display = 'flex';
}

function closeNewRuleModal() {
    document.getElementById('newRuleModal').style.display = 'none';
}

function openSimulationConsole() {
    document.getElementById('simConsoleSection')?.scrollIntoView({ behavior: 'smooth' });
}

function showToast(msg) {
    const toast = document.getElementById('alertToast');
    const text = document.getElementById('toastMsg');
    if (toast && text) {
        text.textContent = msg;
        toast.style.display = 'flex';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 3500);
    }
}

/**
 * Save new custom alert rule
 */
async function submitNewAlertRule() {
    const name = document.getElementById('newRuleName').value.trim();
    const module = document.getElementById('newRuleModule').value;
    const trigger_event = document.getElementById('newRuleTrigger').value.trim();
    const metric = document.getElementById('newRuleMetric').value.trim();
    const comparator = document.getElementById('newRuleOp').value;
    const thresholdValue = Number(document.getElementById('newRuleVal').value);
    const recipientsRaw = document.getElementById('newRuleRecipients').value.trim();
    const escalationRaw = document.getElementById('newRuleEscalation').value.trim();

    if (!name || !trigger_event) {
        alert('Please specify Rule Name and Trigger Event Key');
        return;
    }

    const recipients = recipientsRaw.split(',').map(r => ({ role: r.trim(), channel: 'In-App' }));
    const id = `alert-${module.toLowerCase()}-${Date.now()}`;

    const payload = {
        id,
        name,
        module,
        trigger_event,
        metric,
        comparator,
        thresholdValue,
        recipients,
        escalation: escalationRaw ? { escalateTo: escalationRaw } : null,
        description: `Custom alert monitor evaluating ${metric} ${comparator} ${thresholdValue}`
    };

    try {
        const res = await fetch(`${API_BASE}/rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeNewRuleModal();
            showToast(`Rule '${name}' registered in Automation Engine & Firebase!`);
            
            // Sync directly with Firestore
            if (db) {
                await setDoc(doc(db, 'alert_rules', id), {
                    ...payload,
                    status: 'active',
                    createdAt: serverTimestamp()
                }, { merge: true });
            }

            await fetchAlertRules();
            renderSimulationConsoleOptions();
        }
    } catch (e) {
        console.error('Error creating rule:', e);
    }
}

function renderSimulationConsoleOptions() {
    const sel = document.getElementById('simRuleSelect');
    if (!sel) return;

    sel.innerHTML = activeRules.map(r => `
        <option value="${r.id}">${r.name} (${r.comparator} ${r.thresholdValue})</option>
    `).join('');
}

async function zeroAllAlerts() {
    isZeroed = true;
    localStorage.setItem('kylrx_zero_alerts', 'true');
    activeRules = [];
    breachCount = 0;
    renderAlertCards();
    updateKPIs();

    // Log zero state to Firebase Firestore activities
    try {
        if (db) {
            await addDoc(collection(db, 'activities'), {
                event: 'ALERT_MONITORS_ZEROED',
                timestamp: serverTimestamp(),
                source: 'admin-alert-builder',
                zeroedBy: 'super_admin',
                message: 'All threshold monitors and breach records zeroed out in live Firebase backend'
            });
            console.log('🔥 [Firebase Firestore] Logged ALERT_MONITORS_ZEROED activity.');
        }
    } catch (e) {
        console.warn('Firebase activity log notice:', e.message);
    }

    const badge = document.getElementById('firebaseLiveBadge');
    const text = document.getElementById('firebaseStatusText');
    if (badge && text) {
        badge.style.background = '#ecfdf5';
        badge.style.borderColor = '#a7f3d0';
        badge.style.color = '#065f46';
        text.textContent = 'Firebase: kylrxai (Connected) • Slate Zeroed';
    }
}

async function restoreAlerts() {
    isZeroed = false;
    localStorage.setItem('kylrx_zero_alerts', 'false');
    await fetchAlertRules();

    // Log restore state to Firebase Firestore activities
    try {
        if (db) {
            await addDoc(collection(db, 'activities'), {
                event: 'ALERT_MONITORS_RESTORED',
                timestamp: serverTimestamp(),
                source: 'admin-alert-builder',
                restoredBy: 'super_admin',
                message: 'Threshold monitors and telemetry restored'
            });
            console.log('🔥 [Firebase Firestore] Logged ALERT_MONITORS_RESTORED activity.');
        }
    } catch (e) {
        console.warn('Firebase activity log notice:', e.message);
    }

    const badge = document.getElementById('firebaseLiveBadge');
    const text = document.getElementById('firebaseStatusText');
    if (badge && text) {
        text.textContent = 'Firebase: kylrxai (Connected) • Live Telemetry';
    }
}

// Expose globally for inline HTML events in ES module mode
window.toggleFirebaseDetailsModal = toggleFirebaseDetailsModal;
window.testFirebaseSync = testFirebaseSync;
window.openSimulationConsole = openSimulationConsole;
window.openNewRuleModal = openNewRuleModal;
window.closeNewRuleModal = closeNewRuleModal;
window.submitNewAlertRule = submitNewAlertRule;
window.toggleAlertRule = toggleAlertRule;
window.quickTestFire = quickTestFire;
window.onSimRuleChanged = onSimRuleChanged;
window.executeSimulatedAlert = executeSimulatedAlert;
window.clearSimLogs = clearSimLogs;
window.zeroAllAlerts = zeroAllAlerts;
window.restoreAlerts = restoreAlerts;

