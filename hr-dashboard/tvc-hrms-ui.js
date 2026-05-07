/**
 * TVC HRMS UI Controller
 * Renders warning overlays, employee dashboard widgets, 
 * manager team view, admin payroll controls, and alert panels.
 * Integrates with tvc-hrms-engine.js event system.
 */

import { on, getSnapshot, setBreak, managerOverrideSalary, listenTeamSessions, getAllSessionsToday, state, CONFIG } from './tvc-hrms-engine.js';

// ==================== DOM INJECTION ====================
function injectHRMSUI() {
    // 1. Warning Overlay
    if (!document.getElementById('hrmsWarningOverlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'hrmsWarningOverlay';
        overlay.innerHTML = `
            <div class="hrms-warn-box">
                <div class="hrms-warn-icon" id="hrmsWarnIcon">⚠️</div>
                <h2 id="hrmsWarnTitle">Focus Warning</h2>
                <p id="hrmsWarnMsg">Please return to your workspace.</p>
                <div class="hrms-warn-meta" id="hrmsWarnMeta"></div>
                <button id="hrmsWarnDismiss" onclick="document.getElementById('hrmsWarningOverlay').style.display='none'">I Understand</button>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    // 2. HRMS Status Bar (injected into existing top-bar or topbar-right)
    injectStatusBar();

    // 3. If TVC dashboard has panel-content areas, inject HRMS views
    injectHRMSViews();
}

function injectStatusBar() {
    const topControls = document.querySelector('.top-controls') || document.querySelector('.topbar-right');
    if (!topControls || document.getElementById('hrmsStatusPill')) return;

    const pill = document.createElement('div');
    pill.id = 'hrmsStatusPill';
    pill.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(16,185,129,0.1);padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:700;color:#10b981;border:1px solid rgba(16,185,129,0.2);';
    pill.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981;"></span><span id="hrmsScorePill">SCORE: --</span>`;
    topControls.insertBefore(pill, topControls.firstChild);
}

function injectHRMSViews() {
    // Add HRMS view to the TVC center stage if the views exist
    const panelContent = document.querySelector('.center-stage .panel-content');
    if (!panelContent || document.getElementById('view-hrms')) return;

    // Add new view section
    const hrmsView = document.createElement('div');
    hrmsView.className = 'view-section';
    hrmsView.id = 'view-hrms';
    hrmsView.innerHTML = buildHRMSViewHTML();
    panelContent.appendChild(hrmsView);

    // Add payroll view
    const payrollView = document.createElement('div');
    payrollView.className = 'view-section';
    payrollView.id = 'view-payroll';
    payrollView.innerHTML = buildPayrollViewHTML();
    panelContent.appendChild(payrollView);

    // Add dot indicators
    const dotsContainer = document.querySelector('.view-indicators');
    if (dotsContainer) {
        const dot4 = document.createElement('div');
        dot4.className = 'v-dot';
        dot4.id = 'dot-4';
        dotsContainer.appendChild(dot4);

        const dot5 = document.createElement('div');
        dot5.className = 'v-dot';
        dot5.id = 'dot-5';
        dotsContainer.appendChild(dot5);
    }
}

function buildHRMSViewHTML() {
    return `
    <div class="finance-view" style="grid-template-rows:auto auto 1fr;">
        <div class="fin-stat-cards">
            <div class="fin-card" style="border-left:4px solid #10b981;">
                <span class="fin-card-label">Productivity Score</span>
                <span class="fin-card-value" id="hrmsScoreVal" style="color:#10b981;">--</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #f59e0b;">
                <span class="fin-card-label">Warnings Today</span>
                <span class="fin-card-value" id="hrmsWarnCount" style="color:#f59e0b;">0</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #0ea5e9;">
                <span class="fin-card-label">Active Time</span>
                <span class="fin-card-value" id="hrmsActiveTime" style="color:#0ea5e9;">0m</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #8b5cf6;">
                <span class="fin-card-label">Focus Switches</span>
                <span class="fin-card-value" id="hrmsFocusCount" style="color:#8b5cf6;">0</span>
            </div>
        </div>
        <div class="fin-stat-cards" style="grid-column:1/3;">
            <div class="fin-card" style="border-left:4px solid #ef4444;">
                <span class="fin-card-label">Idle Time</span>
                <span class="fin-card-value" id="hrmsIdleTime" style="color:#ef4444;font-size:1.5rem;">0m</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #06b6d4;">
                <span class="fin-card-label">Break Time</span>
                <span class="fin-card-value" id="hrmsBreakTime" style="color:#06b6d4;font-size:1.5rem;">0m</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #10b981;">
                <span class="fin-card-label">Salary Impact</span>
                <span class="fin-card-value" id="hrmsSalaryImpact" style="font-size:1.5rem;">₹0</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #f97316;">
                <span class="fin-card-label">Session Duration</span>
                <span class="fin-card-value" id="hrmsSessionTime" style="color:#f97316;font-size:1.5rem;">0m</span>
            </div>
        </div>
        <div class="fin-chart-container" style="grid-column:1/3;">
            <div style="font-size:0.8rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;font-weight:600;">
                Team Performance Monitor
            </div>
            <div class="workforce-grid" id="hrmsTeamGrid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr));overflow-y:auto;max-height:280px;"></div>
        </div>
    </div>`;
}

function buildPayrollViewHTML() {
    return `
    <div class="finance-view" style="grid-template-rows:auto 1fr;">
        <div class="fin-stat-cards">
            <div class="fin-card" style="border-left:4px solid #0ea5e9;">
                <span class="fin-card-label">Base Salary</span>
                <span class="fin-card-value" id="payBase" style="color:#0ea5e9;">₹0</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #ef4444;">
                <span class="fin-card-label">Penalty</span>
                <span class="fin-card-value" id="payPenalty" style="color:#ef4444;">0%</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #10b981;">
                <span class="fin-card-label">Bonus</span>
                <span class="fin-card-value" id="payBonus" style="color:#10b981;">0%</span>
            </div>
            <div class="fin-card" style="border-left:4px solid #8b5cf6;">
                <span class="fin-card-label">Final Salary</span>
                <span class="fin-card-value" id="payFinal" style="color:#8b5cf6;">₹0</span>
            </div>
        </div>
        <div class="fin-chart-container" style="grid-column:1/3;">
            <div style="font-size:0.8rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;font-weight:600;">
                Payroll Breakdown — All Employees
            </div>
            <div style="overflow-y:auto;max-height:320px;" id="payrollTableWrap">
                <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                    <thead>
                        <tr style="background:#f8fafc;text-transform:uppercase;font-size:0.7rem;font-weight:700;color:var(--text-muted);letter-spacing:1px;">
                            <th style="padding:10px;text-align:left;">Employee</th>
                            <th style="padding:10px;text-align:left;">Dept</th>
                            <th style="padding:10px;text-align:center;">Score</th>
                            <th style="padding:10px;text-align:center;">Switches</th>
                            <th style="padding:10px;text-align:right;">Penalty</th>
                            <th style="padding:10px;text-align:right;">Bonus</th>
                            <th style="padding:10px;text-align:right;">Final</th>
                        </tr>
                    </thead>
                    <tbody id="payrollTableBody"></tbody>
                </table>
            </div>
        </div>
    </div>`;
}

// ==================== WARNING UI ====================
function showWarning(data) {
    const overlay = document.getElementById('hrmsWarningOverlay');
    if (!overlay) return;

    const icon = document.getElementById('hrmsWarnIcon');
    const title = document.getElementById('hrmsWarnTitle');
    const msg = document.getElementById('hrmsWarnMsg');
    const meta = document.getElementById('hrmsWarnMeta');
    const box = overlay.querySelector('.hrms-warn-box');

    const colors = { soft: '#f59e0b', strong: '#f97316', final: '#ef4444', penalty: '#dc2626' };
    const icons = { soft: '⚡', strong: '🔶', final: '🚨', penalty: '💸' };
    const titles = { soft: 'Soft Warning', strong: 'Strong Warning', final: 'FINAL WARNING', penalty: 'Penalty Applied!' };

    icon.textContent = icons[data.level] || '⚠️';
    title.textContent = titles[data.level] || 'Warning';
    title.style.color = colors[data.level] || '#f59e0b';
    msg.textContent = data.message;
    meta.textContent = `Tab switches today: ${data.count} | Warning level: ${data.level.toUpperCase()}`;

    if (box) {
        box.style.borderTop = `6px solid ${colors[data.level]}`;
    }

    overlay.style.display = 'flex';

    if (data.level === 'final' || data.level === 'penalty') {
        // Auto-dismiss after 8 seconds for serious warnings
        setTimeout(() => { overlay.style.display = 'none'; }, 8000);
    }
}

// ==================== DASHBOARD UPDATES ====================
function updateDashboard(snap) {
    // Score pill
    const pill = document.getElementById('hrmsScorePill');
    if (pill) {
        pill.textContent = `SCORE: ${snap.productivityScore}`;
        const pillParent = pill.closest('#hrmsStatusPill');
        if (pillParent) {
            const c = snap.productivityScore > 80 ? '#10b981' : snap.productivityScore > 50 ? '#f59e0b' : '#ef4444';
            pillParent.style.background = c + '15';
            pillParent.style.color = c;
            pillParent.style.borderColor = c + '30';
            pillParent.querySelector('span').style.background = c;
            pillParent.querySelector('span').style.boxShadow = `0 0 6px ${c}`;
        }
    }

    // HRMS View cards
    const el = (id) => document.getElementById(id);
    if (el('hrmsScoreVal')) el('hrmsScoreVal').textContent = snap.productivityScore;
    if (el('hrmsWarnCount')) el('hrmsWarnCount').textContent = snap.warningLevel;
    if (el('hrmsActiveTime')) el('hrmsActiveTime').textContent = snap.activeTimeMin + 'm';
    if (el('hrmsFocusCount')) el('hrmsFocusCount').textContent = snap.focusLossCount;
    if (el('hrmsIdleTime')) el('hrmsIdleTime').textContent = snap.idleTimeMin + 'm';
    if (el('hrmsBreakTime')) el('hrmsBreakTime').textContent = snap.breakTimeMin + 'm';
    if (el('hrmsSessionTime')) el('hrmsSessionTime').textContent = snap.sessionMin + 'm';

    // Salary impact
    const impactEl = el('hrmsSalaryImpact');
    if (impactEl) {
        const impact = snap.salaryImpact;
        impactEl.textContent = (impact >= 0 ? '+' : '') + '₹' + Math.abs(Math.round(impact)).toLocaleString();
        impactEl.style.color = impact >= 0 ? '#10b981' : '#ef4444';
    }

    // Payroll view
    if (el('payBase')) el('payBase').textContent = '₹' + Math.round(snap.baseSalary).toLocaleString();
    if (el('payPenalty')) {
        el('payPenalty').textContent = snap.penaltyPct + '%';
        el('payPenalty').style.color = parseFloat(snap.penaltyPct) > 0 ? '#ef4444' : '#10b981';
    }
    if (el('payBonus')) {
        el('payBonus').textContent = snap.bonusPct + '%';
        el('payBonus').style.color = parseFloat(snap.bonusPct) > 0 ? '#10b981' : '#64748b';
    }
    if (el('payFinal')) el('payFinal').textContent = '₹' + Math.round(snap.finalSalary).toLocaleString();
}

// ==================== TEAM/ADMIN VIEWS ====================
function renderTeamGrid(sessions) {
    const grid = document.getElementById('hrmsTeamGrid');
    if (!grid) return;

    if (sessions.length === 0) {
        grid.innerHTML = '<div style="color:var(--text-muted);font-family:monospace;">No team session data yet.</div>';
        return;
    }

    grid.innerHTML = sessions.map(s => {
        const score = s.productivityScore || 0;
        const scoreColor = score > 80 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444';
        const label = score > 80 ? 'High Performer' : score > 50 ? 'Average' : 'Needs Attention';
        return `
            <div class="wf-card" data-status="${s.status || 'Offline'}" style="border-left-color:${scoreColor};">
                <div class="wf-head">
                    <div>
                        <div class="wf-name">${s.userName || 'Unknown'}</div>
                        <div class="wf-role">${label} // ${s.departmentId || 'N/A'}</div>
                    </div>
                    <div class="wf-status-badge" style="background:${scoreColor}15;color:${scoreColor};">${score}%</div>
                </div>
                <div class="wf-metrics">
                    <div><span>ACTIVE</span>${Math.round((s.activeTime||0)/60000)}m</div>
                    <div><span>SWITCHES</span>${s.focusLossCount || 0}</div>
                    <div><span>PENALTY</span>${((s.penalty||0)*100).toFixed(1)}%</div>
                    <div><span>BONUS</span>${((s.bonus||0)*100).toFixed(1)}%</div>
                </div>
            </div>`;
    }).join('');
}

function renderPayrollTable(sessions) {
    const tbody = document.getElementById('payrollTableBody');
    if (!tbody) return;

    tbody.innerHTML = sessions.map(s => {
        const score = s.productivityScore || 0;
        const scoreColor = score > 80 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444';
        return `
            <tr style="border-bottom:1px solid var(--surface-border,#e2e8f0);">
                <td style="padding:10px;font-weight:600;">${s.userName || 'Unknown'}</td>
                <td style="padding:10px;color:var(--text-muted);text-transform:uppercase;font-size:0.75rem;font-weight:600;">${s.departmentId || '-'}</td>
                <td style="padding:10px;text-align:center;"><span style="background:${scoreColor}15;color:${scoreColor};padding:3px 10px;border-radius:12px;font-weight:700;font-size:0.8rem;">${score}</span></td>
                <td style="padding:10px;text-align:center;font-weight:600;">${s.focusLossCount || 0}</td>
                <td style="padding:10px;text-align:right;color:#ef4444;font-weight:600;">${((s.penalty||0)*100).toFixed(1)}%</td>
                <td style="padding:10px;text-align:right;color:#10b981;font-weight:600;">${((s.bonus||0)*100).toFixed(1)}%</td>
                <td style="padding:10px;text-align:right;font-weight:700;font-family:'Roboto Mono',monospace;">₹${Math.round(s.finalSalary||s.baseSalary||0).toLocaleString()}</td>
            </tr>`;
    }).join('');
}

// ==================== INJECT STYLES ====================
function injectStyles() {
    if (document.getElementById('hrmsStyles')) return;
    const style = document.createElement('style');
    style.id = 'hrmsStyles';
    style.textContent = `
        #hrmsWarningOverlay {
            position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(12px);
            display:none;align-items:center;justify-content:center;z-index:999999;
            animation:hrmsOverlayIn 0.3s ease;
        }
        @keyframes hrmsOverlayIn { from{opacity:0} to{opacity:1} }
        .hrms-warn-box {
            background:#ffffff;padding:2.5rem;border-radius:24px;width:90%;max-width:480px;
            text-align:center;box-shadow:0 25px 60px rgba(0,0,0,0.25);
            border-top:6px solid #f59e0b;
            animation:hrmsBoxIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes hrmsBoxIn { from{transform:scale(0.85);opacity:0} to{transform:scale(1);opacity:1} }
        .hrms-warn-icon { font-size:3rem;margin-bottom:1rem; }
        .hrms-warn-box h2 { font-size:1.5rem;font-weight:800;margin-bottom:0.75rem; }
        .hrms-warn-box p { color:#64748b;font-size:1rem;line-height:1.6;margin-bottom:1rem; }
        .hrms-warn-meta { font-family:'Roboto Mono',monospace;font-size:0.75rem;color:#94a3b8;margin-bottom:1.5rem;background:#f8fafc;padding:8px 16px;border-radius:8px; }
        #hrmsWarnDismiss {
            background:#0f172a;color:#fff;border:none;padding:0.85rem 2.5rem;
            border-radius:14px;font-weight:700;font-size:0.95rem;cursor:pointer;
            transition:all 0.2s;
        }
        #hrmsWarnDismiss:hover { transform:translateY(-2px);box-shadow:0 6px 20px rgba(15,23,42,0.3); }
    `;
    document.head.appendChild(style);
}

// ==================== EXTENDED VIEW ROTATION ====================
function extendViewRotation() {
    // Patch the existing views array used by tvc-app.js auto-rotation
    // We do this by finding the script's view config and extending it
    if (!window._hrmsViewsPatched) {
        window._hrmsViewsPatched = true;
        // The TVC dashboard rotates views via its own code; we just need our views to be available.
        // Extend by monkey-patching the rotation interval to include our 2 new views
        const totalViews = 6; // 0-3 original + 4 HRMS + 5 Payroll
        const viewConfigs = [
            { id: 'view-workforce', title: '<i data-lucide="users" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> Live Workforce Monitor' },
            { id: 'view-marketing', title: '<i data-lucide="megaphone" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> Marketing Operations' },
            { id: 'view-finance', title: '<i data-lucide="dollar-sign" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> Financial Operations' },
            { id: 'view-alerts', title: '<i data-lucide="alert-triangle" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> System Alerts Log' },
            { id: 'view-hrms', title: '<i data-lucide="activity" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> HRMS Performance Monitor' },
            { id: 'view-payroll', title: '<i data-lucide="wallet" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> Dynamic Payroll Engine' },
        ];

        let vIdx = 0;
        setInterval(() => {
            // Hide current
            const curEl = document.getElementById(viewConfigs[vIdx].id);
            const curDot = document.getElementById('dot-' + vIdx);
            if (curEl) curEl.classList.remove('active');
            if (curDot) curDot.classList.remove('active');

            vIdx = (vIdx + 1) % totalViews;

            const nextEl = document.getElementById(viewConfigs[vIdx].id);
            const nextDot = document.getElementById('dot-' + vIdx);
            const titleEl = document.getElementById('centerStageTitle');
            if (nextEl) nextEl.classList.add('active');
            if (nextDot) nextDot.classList.add('active');
            if (titleEl) titleEl.innerHTML = viewConfigs[vIdx].title;

            if (window.lucide) lucide.createIcons();
        }, 15000);
    }
}

// ==================== BOOT ====================
function boot() {
    injectStyles();
    
    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { injectHRMSUI(); extendViewRotation(); });
    } else {
        injectHRMSUI();
        extendViewRotation();
    }

    // Wire up events from engine
    on('warning', showWarning);
    on('tick', updateDashboard);
    on('productivity:updated', () => { updateDashboard(getSnapshot()); });
    on('payroll:updated', () => { updateDashboard(getSnapshot()); });

    on('auth:login', (data) => {
        const role = data.role;
        const dept = state.userDept;
        
        // Start listening to team data for managers/admins
        if (role === 'manager' || role === 'admin') {
            const targetDept = role === 'admin' ? 'all' : dept;
            listenTeamSessions(targetDept, (sessions) => {
                renderTeamGrid(sessions);
                renderPayrollTable(sessions);
            });
        }
    });

    on('system:force_logout', (data) => {
        const overlay = document.getElementById('hrmsWarningOverlay');
        if (overlay) {
            document.getElementById('hrmsWarnIcon').textContent = '🔒';
            document.getElementById('hrmsWarnTitle').textContent = 'Session Terminated';
            document.getElementById('hrmsWarnMsg').textContent = `Your session has been ended due to: ${data.reason}`;
            document.getElementById('hrmsWarnDismiss').style.display = 'none';
            overlay.style.display = 'flex';
        }
    });

    // Alert system events
    on('focus:lost', (data) => {
        if (data.count > 3) {
            // Trigger TVC alert if available
            const ticker = document.getElementById('tickerContent');
            if (ticker) {
                const alertItem = document.createElement('div');
                alertItem.className = 'ticker-item critical';
                alertItem.innerHTML = `<i data-lucide="alert-octagon" size="14"></i> [HRMS] ${state.userName} excessive tab switching (${data.count} switches)`;
                ticker.appendChild(alertItem);
            }
        }
    });
}

boot();

export { showWarning, updateDashboard, renderTeamGrid, renderPayrollTable };
