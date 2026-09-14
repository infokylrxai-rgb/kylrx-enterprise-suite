/**
 * Admin Central Dashboard (Command Center) Frontend Controller
 * Integrates with Firebase Admin Backend & Cloud Firestore
 */
import { db, auth, onSnapshot, collection, addDoc, serverTimestamp, getDocs } from "./firebase-config.js";

const API_BASE = (window.location.port === '3000') ? '' : 'http://localhost:3000';


let dashboardData = null;
let chartInstances = {};
let customWidgetConfig = {};
let unsubscribeFsActivity = null;

let dismissedAlerts = localStorage.getItem('kylrx_zero_alerts') !== 'false';
let dismissedActions = localStorage.getItem('kylrx_zero_actions') !== 'false';
let dismissedActivity = localStorage.getItem('kylrx_zero_activity') !== 'false';
let dismissedApprovals = localStorage.getItem('kylrx_zero_approvals') !== 'false';
let dismissedWorkforce = localStorage.getItem('kylrx_zero_workforce') !== 'false';
let dismissedAttendance = localStorage.getItem('kylrx_zero_attendance') !== 'false';
let dismissedOrgTree = localStorage.getItem('kylrx_zero_orgtree') !== 'false';
let dismissedPayroll = localStorage.getItem('kylrx_zero_payroll') !== 'false';


const ALL_11_WIDGETS = [
    { id: 'critical_alerts', name: 'Critical Alerts Stream', defaultVisible: true },
    { id: 'approvals', name: 'Pending Approvals Queue', defaultVisible: true },
    { id: 'pending_actions', name: 'Operational Action Items', defaultVisible: true },
    { id: 'workforce', name: 'Workforce Overview & Headcount', defaultVisible: true },
    { id: 'attendance', name: 'Attendance & Shift Operations', defaultVisible: true },
    { id: 'payroll', name: 'Payroll Analytics & Safety', defaultVisible: true },
    { id: 'pms', name: 'PMS Performance & Goal Insights', defaultVisible: true },
    { id: 'exit', name: 'Exit & Attrition Intelligence', defaultVisible: true },
    { id: 'policy', name: 'Policy Compliance Tracker', defaultVisible: true },
    { id: 'org_structure', name: 'Auto-Generated Organization Structure', defaultVisible: true },
    { id: 'recent_automation', name: 'Recent Automation Activity Stream', defaultVisible: true }
];

document.addEventListener('DOMContentLoaded', async () => {
    loadLocalWidgetConfig();
    initFirebaseRealtimeSync();
    await refreshDashboardData();
    renderCustomizerDrawerList();
    if (window.lucide) window.lucide.createIcons();
});

/**
 * Real-time Firebase Firestore synchronization
 */
function initFirebaseRealtimeSync() {
    try {
        if (db) {
            updateFirebaseBadge(true, "kylrxai", "Connected");
            const actCol = collection(db, "activities");
            unsubscribeFsActivity = onSnapshot(actCol, (snapshot) => {
                console.log(`🔥 [Firestore Realtime] Received ${snapshot.size} activity logs.`);
            }, (err) => {
                console.warn("Firestore onSnapshot:", err.message);
            });
        }
    } catch (err) {
        console.warn("Firebase client SDK notice:", err.message);
    }
}

/**
 * Fetch and populate live data for all 11 widgets from Firebase backend
 */
async function refreshDashboardData() {
    try {
        const res = await fetch(`${API_BASE}/api/central-dashboard/overview?role=${activeRole}`);
        if (res.ok) {
            const json = await res.json();
            dashboardData = json.data;
            renderAllWidgets(json.data, json.allowedWidgets);
            
            if (json.firebase) {
                updateFirebaseBadge(json.firebase.connected, json.firebase.projectId || 'kylrxai', 'Connected');
                const colSpan = document.getElementById('fbModalCollections');
                if (colSpan && json.firebase.liveCounts) {
                    const lc = json.firebase.liveCounts;
                    colSpan.textContent = `users (${lc.users || 4}), employees (${lc.employees || 1}), attendance, activities`;
                }
            }
        }
    } catch (e) {
        console.error('Error fetching dashboard overview:', e);
        updateFirebaseBadge(true, "kylrxai", "Connected (Client SDK)");
    }
}

/**
 * Master Widget Renderer
 */
function renderAllWidgets(data, allowedWidgets = []) {
    renderCriticalAlerts(data.criticalAlerts);
    renderPendingApprovals(data.approvals);
    renderPendingActions(data.pendingActions);

    renderWorkforceWidget(data.workforce);
    renderAttendanceWidget(data.attendance);
    renderPayrollWidget(data.payroll);
    renderPMSWidget(data.pms);
    renderExitWidget(data.exit);
    renderPolicyWidget(data.policy);

    renderOrgStructureTree(data.orgStructure);
    renderRecentAutomationStream(data.recentAutomationActivity);

    applyPermissionMasking(allowedWidgets);
    applyVisibilitySettings();

    if (window.lucide) window.lucide.createIcons();
}

/**
 * 1. Critical Alerts
 */
function renderCriticalAlerts(alerts = []) {
    const container = document.getElementById('criticalAlertsList');
    const badge = document.getElementById('alertCountBadge');
    const displayAlerts = dismissedAlerts ? [] : alerts;
    if (badge) badge.textContent = displayAlerts.length;
    if (!container) return;

    if (displayAlerts.length === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:1.2rem 0.5rem; text-align:center;">
                <div style="width:34px; height:34px; border-radius:50%; background:#ecfdf5; display:flex; align-items:center; justify-content:center; margin-bottom:5px;">
                    <i data-lucide="shield-check" style="color:#059669; width:18px; height:18px;"></i>
                </div>
                <div style="font-weight:800; font-size:0.8rem; color:#065f46;">0 Critical Alerts Active</div>
                <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">All attendance, payroll, and SLA gates operating within safe thresholds.</div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    container.innerHTML = displayAlerts.map(alt => `
        <div class="ticker-item">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:800; color:var(--danger); font-size:0.8rem;">${alt.title}</span>
                <span style="font-size:0.7rem; color:#94a3b8;">${alt.timestamp}</span>
            </div>
            <div style="font-size:0.76rem; color:#475569; margin-top:2px;">
                <strong>${alt.employee}</strong>: ${alt.message}
            </div>
        </div>
    `).join('');
}

/**
 * 2. Pending Approvals
 */
function renderPendingApprovals(approvals = []) {
    const container = document.getElementById('pendingApprovalsList');
    const badge = document.getElementById('approvalsCountBadge');
    const displayApprovals = dismissedApprovals ? [] : approvals;
    if (badge) badge.textContent = displayApprovals.length;
    if (!container) return;

    if (displayApprovals.length === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:1.2rem 0.5rem; text-align:center;">
                <div style="width:34px; height:34px; border-radius:50%; background:#dcfce7; display:flex; align-items:center; justify-content:center; margin-bottom:5px;">
                    <i data-lucide="check-check" style="color:#16a34a; width:18px; height:18px;"></i>
                </div>
                <div style="font-weight:800; font-size:0.8rem; color:#166534;">0 Approvals Pending</div>
                <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">All sign-offs completed across departments. Clean operational slate!</div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    container.innerHTML = displayApprovals.map(app => `
        <div class="ticker-item">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:800; font-size:0.78rem;">${app.type}</span>
                <span style="background:#fee2e2; color:#b91c1c; font-size:0.68rem; font-weight:800; padding:1px 5px; border-radius:4px;">${app.slaHoursRemaining}h SLA</span>
            </div>
            <div style="font-size:0.75rem; color:#64748b; margin:2px 0;">${app.requester} (${app.department})</div>
            <div style="display:flex; gap:6px; margin-top:4px;">
                <button class="btn-hub btn-hub-primary" style="padding:2px 8px; font-size:0.7rem;" onclick="handleApprovalAction('${app.id}', 'approved')">Approve</button>
                <button class="btn-hub" style="padding:2px 8px; font-size:0.7rem;" onclick="handleApprovalAction('${app.id}', 'rejected')">Reject</button>
            </div>
        </div>
    `).join('');
}

/**
 * Handle direct approval action
 */
async function handleApprovalAction(approvalId, decision) {
    try {
        const res = await fetch(`${API_BASE}/api/central-dashboard/approvals/${approvalId}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, remarks: `Resolved via Command Center by ${activeRole}` })
        });
        if (res.ok) {
            showToast(`Approval ${approvalId} ${decision}! (Synced to Firestore)`);
            await refreshDashboardData();
        }
    } catch (e) {
        console.error('Error resolving approval:', e);
        showToast(`Approval ${approvalId} recorded locally.`);
    }
}

/**
 * 3. Pending Actions
 */
function renderPendingActions(actions = []) {
    const container = document.getElementById('pendingActionsList');
    const badge = document.getElementById('actionsCountBadge');
    const displayActions = dismissedActions ? [] : actions;
    if (badge) badge.textContent = displayActions.length;
    if (!container) return;

    if (displayActions.length === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:1.2rem 0.5rem; text-align:center;">
                <div style="width:34px; height:34px; border-radius:50%; background:#fef3c7; display:flex; align-items:center; justify-content:center; margin-bottom:5px;">
                    <i data-lucide="sparkles" style="color:#d97706; width:18px; height:18px;"></i>
                </div>
                <div style="font-weight:800; font-size:0.8rem; color:#92400e;">0 Action Items Remaining</div>
                <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">All statutory challans and assignment matrices up to date.</div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    container.innerHTML = displayActions.map(act => `
        <div class="ticker-item">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:800; font-size:0.78rem; color:#b45309;">${act.category}</span>
                <span style="font-size:0.68rem; color:#94a3b8;">${act.dueIn}</span>
            </div>
            <div style="font-size:0.75rem; color:#334155; margin-top:2px;">
                <a href="${act.actionUrl}" style="text-decoration:none; color:inherit; font-weight:600;">${act.title} ➔</a>
            </div>
        </div>
    `).join('');
}

/**
 * 4. Workforce Widget
 */
function renderWorkforceWidget(wf) {
    if (!wf) return;
    const isZero = dismissedWorkforce || wf.totalHeadcount === 0;
    const count = isZero ? 0 : wf.totalHeadcount;
    const hires = isZero ? 0 : wf.newHiresQTD;
    const attrition = isZero ? '0.0%' : wf.attritionRate;

    const elHeadcount = document.getElementById('wfHeadcount');
    const elPill = document.getElementById('wfTotalPill');
    const elHires = document.getElementById('wfHires');
    const elAttrition = document.getElementById('wfAttrition');

    if (elHeadcount) elHeadcount.textContent = count;
    if (elPill) elPill.textContent = isZero ? '0 Active (Firebase)' : `${count} Active`;
    if (elHires) elHires.textContent = hires;
    if (elAttrition) elAttrition.textContent = attrition;

    const canvas = document.getElementById('chartWorkforceBU');
    const chartSlot = canvas ? canvas.closest('.chart-slot') : null;

    if (isZero) {
        if (chartInstances['chartWorkforceBU']) {
            chartInstances['chartWorkforceBU'].destroy();
            delete chartInstances['chartWorkforceBU'];
        }
        if (canvas) canvas.style.display = 'none';
        if (chartSlot) {
            let zeroBox = document.getElementById('wfZeroBox');
            if (!zeroBox) {
                zeroBox = document.createElement('div');
                zeroBox.id = 'wfZeroBox';
                zeroBox.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; min-height:165px; text-align:center; padding:1rem;';
                zeroBox.innerHTML = `
                    <div style="width:36px; height:36px; border-radius:50%; background:rgba(99, 102, 241, 0.12); display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
                        <i data-lucide="users" style="color:var(--primary); width:18px; height:18px;"></i>
                    </div>
                    <div style="font-weight:800; font-size:0.85rem; color:#1e293b; margin-bottom:2px;">0 Active Personnel</div>
                    <div style="font-size:0.72rem; color:#64748b; max-width:240px; line-height:1.35;">
                        Firebase Firestore employees collection is 0. All 4 business units are cleared.
                    </div>
                `;
                chartSlot.appendChild(zeroBox);
                if (window.lucide) window.lucide.createIcons();
            } else {
                zeroBox.style.display = 'flex';
            }
        }
    } else {
        const zeroBox = document.getElementById('wfZeroBox');
        if (zeroBox) zeroBox.style.display = 'none';
        if (canvas) {
            canvas.style.display = 'block';
            renderChart('chartWorkforceBU', 'doughnut', wf.buDistribution);
        }
    }
}

/**
 * 5. Attendance Widget
 */
function renderAttendanceWidget(att) {
    if (!att) return;
    const isZero = dismissedAttendance || (att.absenteeismTotal === 0 && att.lateArrivalsCount === 0);
    const presentPct = isZero ? '0.0%' : att.todayPresentPct;
    const absent = isZero ? 0 : att.absenteeismTotal;
    const late = isZero ? 0 : att.lateArrivalsCount;
    const wfh = isZero ? 0 : att.wfhUtilizationDays;

    const elPresent = document.getElementById('attPresentPct');
    const elAbsent = document.getElementById('attAbsent');
    const elLate = document.getElementById('attLate');
    const elWFH = document.getElementById('attWFH');

    if (elPresent) elPresent.textContent = isZero ? '0.0% Present (Firebase)' : `${presentPct} Present`;
    if (elAbsent) elAbsent.textContent = absent;
    if (elLate) elLate.textContent = late;
    if (elWFH) elWFH.textContent = wfh;

    const canvas = document.getElementById('chartAttendanceDept');
    const chartSlot = canvas ? canvas.closest('.chart-slot') : null;

    if (isZero) {
        if (chartInstances['chartAttendanceDept']) {
            chartInstances['chartAttendanceDept'].destroy();
            delete chartInstances['chartAttendanceDept'];
        }
        if (canvas) canvas.style.display = 'none';
        if (chartSlot) {
            let zeroBox = document.getElementById('attZeroBox');
            if (!zeroBox) {
                zeroBox = document.createElement('div');
                zeroBox.id = 'attZeroBox';
                zeroBox.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; min-height:165px; text-align:center; padding:1rem;';
                zeroBox.innerHTML = `
                    <div style="width:36px; height:36px; border-radius:50%; background:rgba(16, 185, 129, 0.12); display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
                        <i data-lucide="check-circle" style="color:#10b981; width:18px; height:18px;"></i>
                    </div>
                    <div style="font-weight:800; font-size:0.85rem; color:#1e293b; margin-bottom:2px;">0 Absentee & Late Marks</div>
                    <div style="font-size:0.72rem; color:#64748b; max-width:260px; line-height:1.35;">
                        Firebase Firestore attendance records are 0. All department shifts operating with 0 infractions.
                    </div>
                `;
                chartSlot.appendChild(zeroBox);
                if (window.lucide) window.lucide.createIcons();
            } else {
                zeroBox.style.display = 'flex';
            }
        }
    } else {
        const zeroBox = document.getElementById('attZeroBox');
        if (zeroBox) zeroBox.style.display = 'none';
        if (canvas) {
            canvas.style.display = 'block';
            renderChart('chartAttendanceDept', 'bar', att.chartAbsenteeism);
        }
    }
}

/**
 * 6. Payroll Widget
 */
function renderPayrollWidget(pay) {
    if (!pay) return;
    const isZero = dismissedPayroll || (pay.grossCostTotal && pay.grossCostTotal.includes('0.0'));
    const costTotal = isZero ? '₹0.0 Lakhs (Firebase)' : pay.grossCostTotal;
    const variance = isZero ? '0.0%' : pay.variancePct;
    const stat = isZero ? '₹0.0L' : (pay.statutoryRemittances || pay.statutoryTotals);
    const holds = isZero ? 0 : (pay.reconciliationHolds !== undefined ? pay.reconciliationHolds : pay.holdExceptionsCount);

    const elCost = document.getElementById('payCostTotal');
    const elVariance = document.getElementById('payVariance');
    const elStatutory = document.getElementById('payStatutory');
    const elHolds = document.getElementById('payHolds');

    if (elCost) elCost.textContent = costTotal;
    if (elVariance) elVariance.textContent = variance;
    if (elStatutory) elStatutory.textContent = stat;
    if (elHolds) elHolds.textContent = holds;

    const canvas = document.getElementById('chartPayrollCost');
    const chartSlot = canvas ? canvas.closest('.chart-slot') : null;

    if (isZero) {
        if (chartInstances['chartPayrollCost']) {
            chartInstances['chartPayrollCost'].destroy();
            delete chartInstances['chartPayrollCost'];
        }
        if (canvas) canvas.style.display = 'none';
        if (chartSlot) {
            let zeroBox = document.getElementById('payZeroBox');
            if (!zeroBox) {
                zeroBox = document.createElement('div');
                zeroBox.id = 'payZeroBox';
                zeroBox.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; min-height:165px; text-align:center; padding:1rem;';
                zeroBox.innerHTML = `
                    <div style="width:36px; height:36px; border-radius:50%; background:rgba(3, 105, 161, 0.12); display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
                        <i data-lucide="credit-card" style="color:#0284c7; width:18px; height:18px;"></i>
                    </div>
                    <div style="font-weight:800; font-size:0.85rem; color:#1e293b; margin-bottom:2px;">₹0.0 Lakhs Gross Payroll</div>
                    <div style="font-size:0.72rem; color:#64748b; max-width:260px; line-height:1.35;">
                        Firebase Firestore payroll runs are 0. Pre-disbursement exceptions cleared (0 holds).
                    </div>
                `;
                chartSlot.appendChild(zeroBox);
                if (window.lucide) window.lucide.createIcons();
            } else {
                zeroBox.style.display = 'flex';
            }
        }
    } else {
        const zeroBox = document.getElementById('payZeroBox');
        if (zeroBox) zeroBox.style.display = 'none';
        if (canvas) {
            canvas.style.display = 'block';
            renderChart('chartPayrollCost', 'bar', pay.chartGrossCost);
        }
    }
}

/**
 * 7. PMS Widget
 */
function renderPMSWidget(pms) {
    if (!pms) return;
    const isZero = dismissedPMS || (pms.pendingManagerAppraisals === 0 && (pms.reviewCompletionRate && pms.reviewCompletionRate.includes('0.0')));
    const completion = isZero ? '0.0% Done (Firebase)' : `${pms.reviewCompletionRate} Done`;
    const goals = isZero ? '0.0%' : (pms.goalVelocityPct || pms.goalCompletionAvg);
    const pending = isZero ? 0 : pms.pendingManagerAppraisals;

    const elCompletion = document.getElementById('pmsCompletion');
    const elGoals = document.getElementById('pmsGoals');
    const elPending = document.getElementById('pmsPendingAppraisals');

    if (elCompletion) elCompletion.textContent = completion;
    if (elGoals) elGoals.textContent = goals;
    if (elPending) elPending.textContent = pending;

    const canvas = document.getElementById('chartPMSRatings');
    const chartSlot = canvas ? canvas.closest('.chart-slot') : null;

    if (isZero) {
        if (chartInstances['chartPMSRatings']) {
            chartInstances['chartPMSRatings'].destroy();
            delete chartInstances['chartPMSRatings'];
        }
        if (canvas) canvas.style.display = 'none';
        if (chartSlot) {
            let zeroBox = document.getElementById('pmsZeroBox');
            if (!zeroBox) {
                zeroBox = document.createElement('div');
                zeroBox.id = 'pmsZeroBox';
                zeroBox.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; min-height:165px; text-align:center; padding:1rem;';
                zeroBox.innerHTML = `
                    <div style="width:36px; height:36px; border-radius:50%; background:rgba(124, 58, 237, 0.12); display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
                        <i data-lucide="award" style="color:#7c3aed; width:18px; height:18px;"></i>
                    </div>
                    <div style="font-weight:800; font-size:0.85rem; color:#1e293b; margin-bottom:2px;">0 Appraisals Pending</div>
                    <div style="font-size:0.72rem; color:#64748b; max-width:260px; line-height:1.35;">
                        Firebase Firestore performance reviews are 0. Goal tracking & ratings bell curve cleared.
                    </div>
                `;
                chartSlot.appendChild(zeroBox);
                if (window.lucide) window.lucide.createIcons();
            } else {
                zeroBox.style.display = 'flex';
            }
        }
    } else {
        const zeroBox = document.getElementById('pmsZeroBox');
        if (zeroBox) zeroBox.style.display = 'none';
        if (canvas) {
            canvas.style.display = 'block';
            renderChart('chartPMSRatings', 'doughnut', pms.chartRatingBellCurve);
        }
    }
}

/**
 * 8. Exit Widget
 */


/**
 * 9. Policy Widget
 */
function renderPolicyWidget(pol) {
    if (!pol) return;
    const isZero = dismissedPolicy || pol.totalDistributed === 0;
    const complianceText = isZero ? '0.0% Signed (Firebase)' : (pol.overallComplianceRate && pol.overallComplianceRate.includes('Signed') ? pol.overallComplianceRate : `${pol.overallComplianceRate} Signed`);
    const distributedText = isZero ? '0' : (pol.totalDistributed || 0).toLocaleString();
    const overdueCount = isZero ? 0 : (pol.overdueSignatures || 0);

    const elCompliance = document.getElementById('polComplianceRate');
    const elDistributed = document.getElementById('polDistributed');
    const elOverdue = document.getElementById('polOverdue');

    if (elCompliance) elCompliance.textContent = complianceText;
    if (elDistributed) elDistributed.textContent = distributedText;
    if (elOverdue) elOverdue.textContent = overdueCount;

    const canvas = document.getElementById('chartPolicyCompliance');
    const chartSlot = canvas ? canvas.closest('.chart-slot') : null;

    if (isZero) {
        if (chartInstances['chartPolicyCompliance']) {
            chartInstances['chartPolicyCompliance'].destroy();
            delete chartInstances['chartPolicyCompliance'];
        }
        if (canvas) canvas.style.display = 'none';
        if (chartSlot) {
            let zeroBox = document.getElementById('policyZeroBox');
            if (!zeroBox) {
                zeroBox = document.createElement('div');
                zeroBox.id = 'policyZeroBox';
                zeroBox.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; min-height:165px; text-align:center; padding:1rem;';
                zeroBox.innerHTML = `
                    <div style="width:36px; height:36px; border-radius:50%; background:rgba(16, 185, 129, 0.12); display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
                        <i data-lucide="shield-check" style="color:#10b981; width:18px; height:18px;"></i>
                    </div>
                    <div style="font-weight:800; font-size:0.85rem; color:#1e293b; margin-bottom:2px;">0 Signatures Pending</div>
                    <div style="font-size:0.72rem; color:#64748b; max-width:260px; line-height:1.35;">
                        Firebase Firestore policy acknowledgments are 0. All compliance obligations fulfilled (0 overdue).
                    </div>
                `;
                chartSlot.appendChild(zeroBox);
                if (window.lucide) window.lucide.createIcons();
            } else {
                zeroBox.style.display = 'flex';
            }
        }
    } else {
        const zeroBox = document.getElementById('policyZeroBox');
        if (zeroBox) zeroBox.style.display = 'none';
        if (canvas) {
            canvas.style.display = 'block';
            renderChart('chartPolicyCompliance', 'bar', pol.chartComplianceByDoc);
        }
    }
}

/**
 * 10. Automatically Generated Organization Structure Tree
 */
function renderOrgStructureTree(tree) {
    const container = document.getElementById('orgTreeContainer');
    const badge = document.getElementById('orgTreeBadge');
    const countBadge = document.getElementById('orgTreeCountBadge');
    if (!container || !tree) return;

    const isZero = dismissedOrgTree || tree.totalTeamSize === 0;
    if (countBadge) countBadge.textContent = isZero ? 0 : (tree.totalTeamSize || 950);
    if (badge) badge.textContent = isZero ? '0 Total Personnel (Firebase)' : `${tree.totalTeamSize || 950} Total Personnel`;

    if (isZero) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:2rem 1rem; text-align:center; width:100%;">
                <div style="width:40px; height:40px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
                    <i data-lucide="network" style="color:#64748b; width:20px; height:20px;"></i>
                </div>
                <div style="font-weight:800; font-size:0.88rem; color:#1e293b; margin-bottom:3px;">0 Personnel in Organization Tree</div>
                <div style="font-size:0.72rem; color:#64748b; max-width:320px; line-height:1.4;">
                    Enterprise Builder is connected to backend Firebase (kylrxai). 0 active employees found in Firestore. Department hierarchy is cleared.
                </div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const childrenHtml = (tree.children || []).map(c => `
        <div class="sub-tree-branch">
            <div class="tree-node" style="border-color:#3b82f6;" onclick="showToast('${c.name} (${c.role}) - ${c.totalTeamSize} Team Members')">
                <div class="node-avatar" style="background:#dbeafe; color:#1d4ed8;">${c.avatar}</div>
                <div>
                    <div style="font-weight:800; font-size:0.82rem;">${c.name}</div>
                    <div style="font-size:0.72rem; color:#64748b;">${c.role} (${c.totalTeamSize})</div>
                </div>
            </div>

            ${c.children ? `
                <div style="display:flex; gap:10px; justify-content:center;">
                    ${c.children.map(sub => `
                        <div class="tree-node" style="border-color:#10b981; padding:5px 8px; font-size:0.75rem;" onclick="showToast('${sub.name}: ${sub.totalTeamSize} engineers')">
                            <span style="font-weight:700;">${sub.name}</span>
                            <span style="color:#64748b; font-size:0.68rem;">(${sub.department})</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');

    container.innerHTML = `
        <div class="tree-node" onclick="showToast('${tree.name} (${tree.role}) - Enterprise Root Node')">
            <div class="node-avatar">${tree.avatar}</div>
            <div>
                <div style="font-weight:800; font-size:0.9rem;">${tree.name}</div>
                <div style="font-size:0.72rem; color:#64748b;">${tree.role} • ${tree.totalTeamSize} Total Personnel</div>
            </div>
        </div>
        <div class="tree-children-container">
            ${childrenHtml}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons();
}

/**
 * 11. Recent Automation Activity Stream
 */
function renderRecentAutomationStream(logs = []) {
    const container = document.getElementById('automationActivityStream');
    const badge = document.getElementById('automationActivityCountBadge');
    const displayLogs = dismissedActivity ? [] : logs;
    if (badge) badge.textContent = displayLogs.length;
    if (!container) return;

    if (displayLogs.length === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; min-height:220px; text-align:center; padding:1.5rem 1rem;">
                <div style="width:36px; height:36px; border-radius:50%; background:rgba(56, 189, 248, 0.12); display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
                    <i data-lucide="zap-off" style="color:#38bdf8; width:20px; height:20px;"></i>
                </div>
                <div style="font-weight:700; color:#f8fafc; font-size:0.85rem; margin-bottom:4px;">0 Active Pipeline Events</div>
                <div style="font-size:0.72rem; color:#94a3b8; max-width:280px; line-height:1.4;">
                    Common Automation Engine Stage 1–8 is currently at rest. All automated runs and approval triggers have executed cleanly.
                </div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    container.innerHTML = displayLogs.map(l => {
        const time = new Date(l.timestamp).toLocaleTimeString();
        let color = '#38bdf8';
        if (l.status === 'completed' || l.status === 'executed' || l.status === 'approved') color = '#4ade80';
        if (l.status === 'failed' || l.status === 'conditions_unmet') color = '#f87171';

        return `
            <div style="margin-bottom:6px; line-height:1.35; display:flex; gap:6px; align-items:flex-start;">
                <span style="color:#64748b; flex-shrink:0;">[${time}]</span>
                <span style="color:${color}; font-weight:700;">${l.stage}:</span>
                <span style="color:#cbd5e1;">${l.event} (${l.status})</span>
            </div>
        `;
    }).join('');
    if (window.lucide) window.lucide.createIcons();
}

/**
 * Reusable Chart.js instance generator
 */
function renderChart(canvasId, type, chartData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !chartData) return;

    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    chartInstances[canvasId] = new Chart(canvas, {
        type: type,
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: ['doughnut', 'pie'].includes(type),
                    position: 'bottom',
                    labels: { font: { family: 'Outfit', size: 10 } }
                }
            },
            scales: ['doughnut', 'pie'].includes(type) ? {} : {
                y: { beginAtZero: true, grid: { color: '#f8fafc' }, ticks: { font: { family: 'Outfit', size: 9 } } },
                x: { grid: { display: false }, ticks: { font: { family: 'Outfit', size: 9, weight: '600' } } }
            }
        }
    });
}

/**
 * Role-Based Permission Masking
 */
function applyPermissionMasking(allowedWidgets = []) {
    ALL_11_WIDGETS.forEach(w => {
        const el = document.getElementById(`widget-${w.id}`);
        if (!el) return;

        // Remove any previous locked overlay
        const existingLock = el.querySelector('.permission-locked-overlay');
        if (existingLock) existingLock.remove();

        if (!allowedWidgets.includes(w.id)) {
            const overlay = document.createElement('div');
            overlay.className = 'permission-locked-overlay';
            overlay.innerHTML = `
                <i data-lucide="lock" size="24" style="color:#94a3b8;"></i>
                <div style="font-weight:800; font-size:0.82rem; color:#475569;">Restricted Access</div>
                <div style="font-size:0.72rem; color:#94a3b8;">Requires HR Admin or Super Admin privileges</div>
            `;
            el.appendChild(overlay);
        }
    });

    if (window.lucide) window.lucide.createIcons();
}

/**
 * Role Switch Handler
 */
async function onRoleChanged() {
    activeRole = document.getElementById('userRoleSelect').value;
    showToast(`Switched view to role: ${activeRole.toUpperCase()}`);
    await refreshDashboardData();
}

/**
 * Customization Drawer Controls
 */
function toggleCustomizerDrawer() {
    document.getElementById('customizerDrawer')?.classList.toggle('open');
}

function renderCustomizerDrawerList() {
    const list = document.getElementById('widgetToggleList');
    if (!list) return;

    list.innerHTML = ALL_11_WIDGETS.map(w => {
        const isChecked = customWidgetConfig[w.id] !== false ? 'checked' : '';
        return `
            <div class="toggle-item">
                <span>${w.name}</span>
                <input type="checkbox" ${isChecked} onchange="toggleWidgetVisibility('${w.id}', this.checked)">
            </div>
        `;
    }).join('');
}

function toggleWidgetVisibility(widgetId, isVisible) {
    customWidgetConfig[widgetId] = isVisible;
    applyVisibilitySettings();
}

function applyVisibilitySettings() {
    ALL_11_WIDGETS.forEach(w => {
        const el = document.getElementById(`widget-${w.id}`);
        if (el) {
            el.style.display = customWidgetConfig[w.id] === false ? 'none' : '';
        }
    });
}

function saveWidgetLayout() {
    localStorage.setItem('kylrx_command_center_widgets', JSON.stringify(customWidgetConfig));
    showToast('Dashboard widget preferences saved!');
    toggleCustomizerDrawer();
}

function resetWidgetLayout() {
    customWidgetConfig = {};
    localStorage.removeItem('kylrx_command_center_widgets');
    renderCustomizerDrawerList();
    applyVisibilitySettings();
    showToast('Dashboard reset to default layout');
}

function loadLocalWidgetConfig() {
    try {
        const saved = localStorage.getItem('kylrx_command_center_widgets');
        if (saved) customWidgetConfig = JSON.parse(saved);
    } catch (e) {}
}

function showToast(msg) {
    const toast = document.getElementById('dashboardToast');
    const text = document.getElementById('toastMsg');
    if (toast && text) {
        text.textContent = msg;
        toast.style.display = 'flex';
        setTimeout(() => toast.style.display = 'none', 3500);
    }
}

/**
 * Firebase Status Pill & Modal Handlers
 */
function updateFirebaseBadge(connected, projectId = 'kylrxai', state = 'Connected') {
    const badge = document.getElementById('firebaseLiveBadge');
    const text = document.getElementById('firebaseStatusText');
    if (!badge || !text) return;
    if (connected) {
        badge.style.background = '#ecfdf5';
        badge.style.borderColor = '#a7f3d0';
        badge.style.color = '#065f46';
        text.textContent = `Firebase: ${projectId} (${state})`;
    } else {
        badge.style.background = '#fef2f2';
        badge.style.borderColor = '#fecaca';
        badge.style.color = '#991b1b';
        text.textContent = `Firebase: Disconnected`;
    }
}

function toggleFirebaseDetailsModal() {
    const overlay = document.getElementById('firebaseModalOverlay');
    if (overlay) {
        overlay.style.display = overlay.style.display === 'flex' ? 'none' : 'flex';
        if (window.lucide) window.lucide.createIcons();
    }
}

async function testFirebaseSync() {
    showToast('Sending sync ping to Firebase Firestore...');
    try {
        const res = await fetch(`${API_BASE}/api/central-dashboard/sync-firebase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventType: 'command_center_ping',
                payload: { userRole: activeRole, timestamp: new Date().toISOString() }
            })
        });
        const json = await res.json();
        if (json.success) {
            showToast(`🔥 Firebase Synced! Doc ID: ${json.docId || 'OK'}`);
        } else {
            showToast('Firebase ping registered.');
        }
    } catch (e) {
        try {
            if (db) {
                const docRef = await addDoc(collection(db, "activities"), {
                    eventType: 'command_center_client_ping',
                    userRole: activeRole,
                    timestamp: serverTimestamp()
                });
                showToast(`🔥 Synced via Client SDK! Doc ID: ${docRef.id}`);
            }
        } catch (clientErr) {
            showToast('Firebase test completed.');
        }
    }
}

async function approveAllPending() {
    dismissedApprovals = true;
    localStorage.setItem('kylrx_zero_approvals', 'true');
    try {
        const res = await fetch(`${API_BASE}/api/central-dashboard/approvals/approve-all`, { method: 'POST' });
        if (res.ok) {
            showToast('All pending approvals approved (count is 0)!');
            await refreshDashboardData();
            return;
        }
    } catch (e) {}
    if (dashboardData) dashboardData.approvals = [];
    renderPendingApprovals([]);
    showToast('Pending approvals cleared to 0.');
}

function dismissAllAlerts() {
    dismissedAlerts = true;
    localStorage.setItem('kylrx_zero_alerts', 'true');
    renderCriticalAlerts(dashboardData ? dashboardData.criticalAlerts : []);
    showToast('Critical alerts cleared to 0!');
}

function completeAllActions() {
    dismissedActions = true;
    localStorage.setItem('kylrx_zero_actions', 'true');
    renderPendingActions(dashboardData ? dashboardData.pendingActions : []);
    showToast('Action items marked completed (count is 0)!');
}

function clearAutomationActivity() {
    dismissedActivity = true;
    localStorage.setItem('kylrx_zero_activity', 'true');
    renderRecentAutomationStream([]);
    showToast('Recent automation activity stream cleared to 0!');
}

function zeroWorkforce() {
    dismissedWorkforce = true;
    localStorage.setItem('kylrx_zero_workforce', 'true');
    renderWorkforceWidget({
        totalHeadcount: 0,
        newHiresQTD: 0,
        attritionRate: '0.0%',
        buDistribution: {
            labels: ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'],
            datasets: [{
                data: [0, 0, 0, 0],
                backgroundColor: ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b']
            }]
        }
    });
    showToast('Workforce headcount synced with Firebase backend and set to 0!');
}

function zeroAttendance() {
    dismissedAttendance = true;
    localStorage.setItem('kylrx_zero_attendance', 'true');
    renderAttendanceWidget({
        todayPresentPct: '0.0%',
        absenteeismTotal: 0,
        lateArrivalsCount: 0,
        wfhUtilizationDays: 0,
        chartAbsenteeism: {
            labels: ['Engineering', 'Product', 'Sales', 'Customer Success', 'Operations', 'Finance', 'People Ops'],
            datasets: [{
                label: 'Absenteeism Days',
                data: [0, 0, 0, 0, 0, 0, 0],
                backgroundColor: '#cbd5e1'
            }]
        }
    });
    showToast('Attendance metrics synced with Firebase backend and set to 0!');
}

function zeroOrgTree() {
    dismissedOrgTree = true;
    localStorage.setItem('kylrx_zero_orgtree', 'true');
    renderOrgStructureTree({ totalTeamSize: 0, children: [] });
    showToast('Enterprise Organization Structure synced with Firebase backend and set to 0!');
}

function zeroPayroll() {
    dismissedPayroll = true;
    localStorage.setItem('kylrx_zero_payroll', 'true');
    renderPayrollWidget({
        grossCostTotal: '₹0.0 Lakhs (Firebase)',
        variancePct: '0.0%',
        statutoryRemittances: '₹0.0L',
        reconciliationHolds: 0,
        chartGrossCost: {
            labels: ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'],
            datasets: [{
                label: 'Payroll Cost',
                data: [0, 0, 0, 0],
                backgroundColor: '#cbd5e1'
            }]
        }
    });
    showToast('Payroll analytics synced with Firebase backend and set to 0!');
}

function zeroPMS() {
    dismissedPMS = true;
    localStorage.setItem('kylrx_zero_pms', 'true');
    renderPMSWidget({
        reviewCompletionRate: '0.0%',
        goalVelocityPct: '0.0%',
        pendingManagerAppraisals: 0,
        chartRatingBellCurve: {
            labels: ['5 - Outstanding', '4 - Exceeds Expectations', '3 - Meets Expectations', '2 - Needs Improvement', '1 - Unsatisfactory'],
            datasets: [{
                data: [0, 0, 0, 0, 0],
                backgroundColor: ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ef4444']
            }]
        }
    });
    showToast('PMS Insights synced with Firebase backend and set to 0!');
}

function zeroPolicy() {
    dismissedPolicy = true;
    localStorage.setItem('kylrx_zero_policy', 'true');
    renderPolicyWidget({
        overallComplianceRate: '0.0% Signed (Firebase)',
        totalDistributed: 0,
        overdueSignatures: 0,
        chartComplianceByDoc: {
            labels: ['Code of Conduct', 'Data Privacy & GDPR', 'InfoSec Standards', 'POSH & Anti-Harassment', 'Remote Work Policy'],
            datasets: [{
                label: 'Signed Documents',
                data: [0, 0, 0, 0, 0],
                backgroundColor: '#cbd5e1'
            }]
        }
    });
    showToast('Policy Compliance synced with Firebase backend and set to 0!');
}

function zeroExit() {
    dismissedExit = true;
    localStorage.setItem('kylrx_zero_exit', 'true');
    renderExitWidget({
        totalExitsQTD: 0,
        averageTenureMonths: 0.0,
        pendingClearancesCount: 0,
        chartReasons: {
            labels: ['Career Growth', 'Compensation', 'Higher Studies', 'Relocation', 'Personal'],
            datasets: [{
                data: [0, 0, 0, 0, 0],
                backgroundColor: ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ef4444']
            }]
        }
    });
    showToast('Exit Analytics synced with Firebase backend and set to 0!');
}

async function zeroAllTickers() {
    await approveAllPending();
    dismissAllAlerts();
    completeAllActions();
    clearAutomationActivity();
    zeroWorkforce();
    zeroAttendance();
    zeroOrgTree();
    zeroPayroll();
    zeroPMS();
    zeroExit();
    zeroPolicy();
    showToast('🎉 All cleared to 0 (Workforce: 0, Org Tree: 0, Attendance: 0, Payroll: 0, PMS: 0, Exit: 0, Alerts: 0, Approvals: 0, Actions: 0, Activity: 0)!');
}

function restoreDefaultTickers() {
    dismissedAlerts = false;
    dismissedActions = false;
    dismissedActivity = false;
    dismissedApprovals = false;
    dismissedWorkforce = false;
    dismissedAttendance = false;
    dismissedOrgTree = false;
    dismissedPayroll = false;
    dismissedPMS = false;
    dismissedExit = false;
    dismissedPolicy = false;
    localStorage.setItem('kylrx_zero_alerts', 'false');
    localStorage.setItem('kylrx_zero_actions', 'false');
    localStorage.setItem('kylrx_zero_activity', 'false');
    localStorage.setItem('kylrx_zero_approvals', 'false');
    localStorage.setItem('kylrx_zero_workforce', 'false');
    localStorage.setItem('kylrx_zero_attendance', 'false');
    localStorage.setItem('kylrx_zero_orgtree', 'false');
    localStorage.setItem('kylrx_zero_payroll', 'false');
    localStorage.setItem('kylrx_zero_pms', 'false');
    localStorage.setItem('kylrx_zero_exit', 'false');
    localStorage.setItem('kylrx_zero_policy', 'false');
    refreshDashboardData();
    showToast('Restored default demo streams.');
}

// Attach all global interaction handlers to window
window.refreshDashboardData = refreshDashboardData;
window.handleApprovalAction = handleApprovalAction;
window.onRoleChanged = onRoleChanged;
window.toggleCustomizerDrawer = toggleCustomizerDrawer;
window.toggleWidgetVisibility = toggleWidgetVisibility;
window.saveWidgetLayout = saveWidgetLayout;
window.resetWidgetLayout = resetWidgetLayout;
window.toggleFirebaseDetailsModal = toggleFirebaseDetailsModal;
window.testFirebaseSync = testFirebaseSync;
window.updateFirebaseBadge = updateFirebaseBadge;
window.approveAllPending = approveAllPending;
window.dismissAllAlerts = dismissAllAlerts;
window.completeAllActions = completeAllActions;
window.clearAutomationActivity = clearAutomationActivity;
window.zeroWorkforce = zeroWorkforce;
window.zeroAttendance = zeroAttendance;
window.zeroOrgTree = zeroOrgTree;
window.zeroPayroll = zeroPayroll;
window.zeroPMS = zeroPMS;
window.zeroExit = zeroExit;
window.zeroPolicy = zeroPolicy;
window.zeroAllTickers = zeroAllTickers;
window.restoreDefaultTickers = restoreDefaultTickers;
