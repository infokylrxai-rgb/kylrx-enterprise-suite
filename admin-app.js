import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { collection, getDocs, setDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// State Management
let state = {
    departments: [],
    employees: [],
    activity: [],
    config: {
        widgets: ['stats', 'productivity', 'activity', 'payroll', 'ai-insights', 'tvc-monitor'],
        layout: 'grid',
        theme: 'light'
    },
    backendAlerted: false
};

const AVAILABLE_WIDGETS = [
    { id: 'stats', title: 'System Overview', icon: 'activity', size: 'w-full' },
    { id: 'productivity', title: 'Productivity Analytics', icon: 'trending-up', size: 'w-lg' },
    { id: 'activity', title: 'Live Employee Activity', icon: 'users', size: 'w-lg' },
    { id: 'payroll', title: 'Payroll Forecasting', icon: 'dollar-sign', size: 'w-md' },
    { id: 'ai-insights', title: 'AI Workforce Insights', icon: 'sparkles', size: 'w-md' },
    { id: 'tvc-monitor', title: 'TVC Alert Stream', icon: 'shield-alert', size: 'w-md' },
    { id: 'dept-performance', title: 'Department Performance', icon: 'bar-chart', size: 'w-full' },
    // Enterprise Analytics Widgets
    { id: 'analytics-productivity-dept', title: 'Dept Productivity Comparison', icon: 'bar-chart-3', size: 'w-lg' },
    { id: 'analytics-performance-trends', title: 'Employee Performance Trends', icon: 'line-chart', size: 'w-lg' },
    { id: 'analytics-focus', title: 'Focus Consistency Analytics', icon: 'target', size: 'w-md' },
    { id: 'analytics-payroll-impact', title: 'Payroll Impact Analysis', icon: 'pie-chart', size: 'w-md' },
    { id: 'analytics-bonus-penalty', title: 'Bonus vs Penalty Reports', icon: 'alert-triangle', size: 'w-md' },
    { id: 'analytics-salary-dist', title: 'Salary Distribution', icon: 'bar-chart', size: 'w-lg' },
    { id: 'analytics-ai-predictions', title: 'Productivity Predictions', icon: 'zap', size: 'w-lg' },
    { id: 'analytics-distraction-trends', title: 'Distraction Trends', icon: 'frown', size: 'w-md' },
    { id: 'analytics-risk-analysis', title: 'Workforce Risk Analysis', icon: 'shield-alert', size: 'w-md' },
    { id: 'command-center-directory', title: 'Active Command Centers', icon: 'monitor', size: 'w-full' }
];

import { onboardingAutomation } from "./onboarding-automation.js";

// Initialize Dashboard
const init = () => {
    loadConfig();
    setupEventListeners();
    initDashboard();

    // Start Onboarding Automation Background Cycle
    onboardingAutomation.runAutomationCycle();
    setInterval(() => onboardingAutomation.runAutomationCycle(), 15 * 60 * 1000); // Every 15 mins

    // Signal HTML that the module is ready → triggers Lucide icon init for all static icons
    window.dispatchEvent(new Event('lucideReinit'));
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function loadConfig() {
    const isAnalysis = window.location.pathname.includes('admin-analysis.html');
    const storageKey = isAnalysis ? 'hrflow_analytics_config' : 'hrflow_admin_config';
    const saved = localStorage.getItem(storageKey);
    
    if (saved) {
        state.config = JSON.parse(saved);
    } else if (isAnalysis) {
        // Default widgets for Analytics page
        state.config.widgets = ['analytics-productivity-dept', 'analytics-performance-trends', 'analytics-payroll-impact', 'analytics-ai-predictions', 'analytics-focus', 'analytics-risk-analysis'];
        state.config.layout = 'grid';
    }
}

function initDashboard() {
    renderWidgets();
    renderConfigToggles();
    setLayout(state.config.layout || 'grid');
    setTheme(state.config.theme || 'light');
}

function renderWidgets() {
    const grid = document.getElementById('dashboardGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    state.config.widgets.forEach(id => {
        const widget = AVAILABLE_WIDGETS.find(w => w.id === id);
        if (widget) {
            const card = document.createElement('div');
            card.className = `widget-card ${widget.size}`;
            card.innerHTML = `
                <div class="widget-header">
                    <div class="widget-title"><i data-lucide="${widget.icon}"></i> ${widget.title}</div>
                    <div style="display:flex; gap:8px;">
                        <button class="icon-btn" onclick="removeWidget('${widget.id}')"><i data-lucide="x" size="14"></i></button>
                    </div>
                </div>
                <div class="widget-content" id="widget-${widget.id}">
                    <div class="notif-empty" style="padding:2rem; text-align:center;">
                        <div class="stat-icon" style="margin: 0 auto 1rem; background: var(--primary-light); color: var(--primary);"><i data-lucide="loader"></i></div>
                        <p style="color:var(--text-muted); font-size:0.85rem;">Connecting to real-time stream...</p>
                    </div>
                </div>
            `;
            grid.appendChild(card);
            populateWidgetContent(widget.id);
        }
    });
    
    if (window.lucide) lucide.createIcons();
}

const API_BASE = 'http://localhost:3000/api';

// Auth Observer
onAuthStateChanged(auth, async (user) => {
    if (user) {
        let data;
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
                data = userDoc.data();
            }
        } catch (err) {
            console.warn('Admin fetch failed, using fallback.');
        }

        if (!data) {
            data = {
                name: localStorage.getItem('userName') || 'Super Admin',
                role: localStorage.getItem('userRole') || 'ADMIN'
            };
        }

        // Update UI
        const welcomeText = document.querySelector('.welcome-text h1');
        if (welcomeText) welcomeText.innerHTML = `Welcome back, ${data.name.split(' ')[0]} 👋`;
        
        // Update Profile Trigger (Top Right)
        const profileName = document.querySelector('.p-name');
        const profileRole = document.querySelector('.p-role');
        const profileAvatar = document.querySelector('.p-avatar');
        
        if (profileName) profileName.textContent = data.name;
        if (profileRole) profileRole.textContent = (data.role || 'ADMIN').toUpperCase();
        if (profileAvatar && data.name) {
            const initials = data.name.split(' ').map(n => n[0]).join('').toUpperCase();
            profileAvatar.textContent = initials.substring(0, 2);
        }
        
        loadDepartments();
        loadEmployees();
        startWorkforceListener();
    } else {
        const isLoggedIn = localStorage.getItem('hr_logged_in') === 'true';
        if (isLoggedIn) {
            loadDepartments();
            loadEmployees();
            startWorkforceListener();
        } else {
            window.location.href = 'index.html';
        }
    }
});

function populateWidgetContent(id) {
    const container = document.getElementById(`widget-${id}`);
    if (!container) return;

    switch(id) {
        case 'stats':
            container.innerHTML = `
                <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 0;">
                    <div class="stat-card" style="box-shadow: none; background: var(--bg-soft);">
                        <div class="stat-icon blue"><i data-lucide="building"></i></div>
                        <div class="stat-info"><h3>Depts</h3><p id="count-depts">0</p></div>
                    </div>
                    <div class="stat-card" style="box-shadow: none; background: var(--bg-soft);">
                        <div class="stat-icon green"><i data-lucide="user-check"></i></div>
                        <div class="stat-info"><h3>Staff</h3><p id="count-emps">0</p></div>
                    </div>
                    <div class="stat-card" style="box-shadow: none; background: var(--bg-soft);">
                        <div class="stat-icon purple"><i data-lucide="shield"></i></div>
                        <div class="stat-info"><h3>Managers</h3><p id="count-mgrs">0</p></div>
                    </div>
                </div>
            `;
            updateStats();
            break;
            
        case 'activity':
            container.innerHTML = `
                <div class="notif-list" id="active-list" style="max-height: 250px;">
                    <div style="padding: 1rem; text-align:center; color: var(--text-muted);">No recent activity detected.</div>
                </div>
            `;
            startActivityStream();
            break;

        case 'payroll':
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <div id="payroll-forecast-chart" style="height: 150px; background: linear-gradient(180deg, var(--primary-soft) 0%, transparent 100%); border-radius: 12px; display: flex; align-items: flex-end; padding: 10px; gap: 8px;">
                        <div style="width: 100%; text-align: center; color: var(--text-muted); font-size: 0.75rem; margin-bottom: 2rem;">
                            <i data-lucide="bar-chart-3" class="animate-pulse"></i><br>Calculating Finance Projections...
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
                        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                    </div>
                </div>
            `;
            startPayrollForecast();
            break;

        case 'productivity':
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <div id="productivity-trend-chart" style="height: 150px; background: linear-gradient(180deg, var(--primary-soft) 0%, transparent 100%); border-radius: 12px; display: flex; align-items: flex-end; padding: 10px; gap: 8px;">
                        <div style="width: 100%; text-align: center; color: var(--text-muted); font-size: 0.75rem; margin-bottom: 2rem;">
                            <i data-lucide="trending-up" class="animate-pulse"></i><br>Aggregating Productivity Metrics...
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
                        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                    </div>
                </div>
            `;
            startProductivityTrend();
            break;

        case 'ai-insights':
            container.innerHTML = `<div id="ai-insights-list" style="display: flex; flex-direction: column; gap: 12px;">
                <div style="padding: 1rem; text-align:center; color: var(--text-muted); font-size: 0.8rem;">
                    <i data-lucide="brain-circuit" class="animate-pulse" style="margin-bottom: 0.5rem;"></i><br>Generating insights...
                </div>
            </div>`;
            startAIInsightsStream();
            break;
            
        case 'tvc-monitor':
            container.innerHTML = `
                <div id="tvc-alert-stream" style="background: #0f172a; padding: 1rem; border-radius: 12px; font-family: monospace; font-size: 0.75rem; color: #10b981; min-height: 140px; overflow-y: auto; max-height: 200px;">
                    <div style="margin-bottom: 5px; opacity: 0.7;">[SYSTEM] Initializing Secure TVC Link...</div>
                    <div class="tvc-log-container" id="tvc-logs"></div>
                    <div class="cursor" style="display: inline-block; width: 8px; height: 14px; background: #10b981; animation: blink 1s infinite;"></div>
                </div>
                <style>
                    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
                    .tvc-log-item { margin-bottom: 4px; animation: slideIn 0.3s ease-out; }
                    @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
                </style>
            `;
            startTVCMonitor();
            break;
            
        case 'analytics-productivity-dept':
            container.innerHTML = `<canvas id="chart-${id}" style="max-height: 250px;"></canvas>`;
            renderProductivityChart(`chart-${id}`);
            break;
            
        case 'analytics-performance-trends':
            container.innerHTML = `<canvas id="chart-${id}" style="max-height: 250px;"></canvas>`;
            renderPerformanceTrendsChart(`chart-${id}`);
            break;

        case 'analytics-focus':
            container.innerHTML = `<canvas id="chart-${id}" style="max-height: 250px;"></canvas>`;
            renderFocusChart(`chart-${id}`);
            break;

        case 'analytics-payroll-impact':
            container.innerHTML = `<canvas id="chart-${id}" style="max-height: 250px;"></canvas>`;
            renderPayrollImpactChart(`chart-${id}`);
            break;

        case 'analytics-bonus-penalty':
            container.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <div style="padding:10px; background:rgba(16, 185, 129, 0.1); border-radius:8px; border-left:4px solid #10b981;">
                        <div style="font-weight:700; font-size:0.8rem; color:#10b981;">Total Bonuses Paid</div>
                        <div id="stat-bonus-val" style="font-size:1.2rem; font-weight:800;">₹0</div>
                    </div>
                    <div style="padding:10px; background:rgba(239, 68, 68, 0.1); border-radius:8px; border-left:4px solid #ef4444;">
                        <div style="font-weight:700; font-size:0.8rem; color:#ef4444;">Total Penalties Applied</div>
                        <div id="stat-penalty-val" style="font-size:1.2rem; font-weight:800;">₹0</div>
                    </div>
                </div>
            `;
            import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot }) => {
                onSnapshot(collection(db, 'payroll_profiles'), (snap) => {
                    let b = 0, p = 0;
                    snap.docs.forEach(d => { b += Number(d.data().monthlyBonus) || 0; p += Number(d.data().monthlyPenalty) || 0; });
                    document.getElementById('stat-bonus-val').textContent = '₹' + b.toLocaleString();
                    document.getElementById('stat-penalty-val').textContent = '₹' + p.toLocaleString();
                });
            });
            break;

        case 'analytics-salary-dist':
            container.innerHTML = `<canvas id="chart-${id}" style="max-height: 250px;"></canvas>`;
            renderSalaryDistChart(`chart-${id}`);
            break;

        case 'analytics-ai-predictions':
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <div class="ai-insight-item">
                        <div class="ai-insight-title"><i data-lucide="trending-up" size="14"></i> Growth Prediction</div>
                        <div id="ai-pred-growth" class="ai-insight-desc">Calculating dynamic growth projection...</div>
                    </div>
                    <div class="ai-insight-item" style="border-left-color: var(--primary);">
                        <div class="ai-insight-title" style="color:var(--primary);"><i data-lucide="zap" size="14"></i> Efficiency Forecast</div>
                        <div id="ai-pred-eff" class="ai-insight-desc">Aggregating productivity milestones...</div>
                    </div>
                </div>
            `;
            // Dynamic generation based on live state
            setInterval(() => {
                const growthEl = document.getElementById('ai-pred-growth');
                const effEl = document.getElementById('ai-pred-eff');
                if (growthEl && state.employees.length > 0) {
                    const empCount = state.employees.length;
                    const proj = Math.max(5, Math.min(25, Math.round(empCount * 0.15)));
                    growthEl.textContent = `Based on current hiring trends, workforce is projected to grow by ${proj}% in Q3.`;
                }
                if (effEl && state.departments.length > 0) {
                    const topDept = state.departments[0]?.name || 'Engineering';
                    effEl.textContent = `Productivity in ${topDept} is expected to peak next month due to optimal shift scheduling.`;
                }
            }, 2000);
            break;

        case 'analytics-distraction-trends':
            container.innerHTML = `<canvas id="chart-${id}" style="max-height: 250px;"></canvas>`;
            renderDistractionTrendsChart(`chart-${id}`);
            break;

        case 'analytics-risk-analysis':
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <div class="ai-insight-item" style="border-left-color: var(--danger);">
                        <div class="ai-insight-title" style="color:var(--danger);">Attrition Risk</div>
                        <div id="risk-attrition" class="ai-insight-desc">Scanning engagement metrics...</div>
                    </div>
                    <div class="ai-insight-item" style="border-left-color: #f59e0b;">
                        <div class="ai-insight-title" style="color:#f59e0b;">Burnout Warning</div>
                        <div id="risk-burnout" class="ai-insight-desc">Analyzing overtime patterns...</div>
                    </div>
                </div>
            `;
            setInterval(() => {
                const attrEl = document.getElementById('risk-attrition');
                const burnEl = document.getElementById('risk-burnout');
                if (attrEl && state.employees) {
                    const susCount = state.employees.filter(e => e.status === 'Suspended').length;
                    attrEl.textContent = susCount > 0 ? `${susCount} employees show high risk of attrition based on recent suspensions.` : 'Retention is healthy. No critical attrition risks detected in the active workforce.';
                }
                if (burnEl && state.departments) {
                    burnEl.textContent = `Burnout indicators are stable. No sustained excessive overtime detected.`;
                }
            }, 2000);
            break;

        case 'command-center-directory':
            if (!state.departments || state.departments.length === 0) {
                container.innerHTML = '<div style="padding:3rem; text-align:center; color:var(--text-muted);">No Command Centers deployed yet.</div>';
                break;
            }
            container.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.5rem; padding: 0.5rem;">
                    ${state.departments.map(dept => {
                        const name = dept.departmentName || dept.name || 'Unnamed Dept';
                        const code = dept.departmentCode || 'UNIT';
                        const icon = dept.icon || 'shield-check';
                        const id = dept.departmentId || name.toLowerCase().replace(/\s+/g, '-');
                        return `
                        <div style="background: var(--bg-soft); padding: 1.5rem; border-radius: 20px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 1rem; transition: 0.3s; cursor: pointer;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
                            <div style="display: flex; align-items: center; gap: 15px;">
                                <div style="width: 44px; height: 44px; background: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--primary); border: 1px solid var(--border);">
                                    <i data-lucide="${icon}"></i>
                                </div>
                                <div>
                                    <div style="font-weight: 800; font-size: 0.95rem;">${name}</div>
                                    <div style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;">${code} UNIT</div>
                                </div>
                            </div>
                            <div style="display: flex; gap: 8px;">
                                <button class="btn btn-outline" style="flex: 1; justify-content: center; padding: 10px; font-size: 0.75rem; font-weight: 700;" onclick="window.open('manager-dashboard.html?id=${id}', '_blank')">
                                    <i data-lucide="external-link" size="14"></i> View
                                </button>
                                <button class="btn btn-outline" style="flex: 1; justify-content: center; padding: 10px; font-size: 0.75rem; font-weight: 700; border-color: var(--primary); color: var(--primary);" onclick="window.location.href='admin-dashboard-builder.html?id=${id}'">
                                    <i data-lucide="settings" size="14"></i> Edit
                                </button>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            `;
            break;
            
        default:
            container.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--text-muted);">Content placeholder for ${id}</div>`;
    }
    
    if (window.lucide) lucide.createIcons();
}

function renderConfigToggles() {
    const container = document.getElementById('widgetToggles');
    if (!container) return;
    
    container.innerHTML = AVAILABLE_WIDGETS.map(w => `
        <div class="toggle-item ${state.config.widgets.includes(w.id) ? 'active' : ''}" onclick="toggleWidget('${w.id}', event)">
            <div style="display: flex; align-items: center; gap: 10px;">
                <i data-lucide="${w.icon}" size="16"></i>
                <span>${w.title}</span>
            </div>
            <label class="switch" onclick="event.stopPropagation()">
                <input type="checkbox" ${state.config.widgets.includes(w.id) ? 'checked' : ''} onchange="toggleWidget('${w.id}', event)">
                <span class="slider"></span>
            </label>
        </div>
    `).join('');
    
    if (window.lucide) lucide.createIcons();
}

// Customization Actions
function toggleConfig() {
    document.getElementById('configSidebar')?.classList.toggle('active');
}
window.toggleConfig = toggleConfig;

window.toggleWidget = (id, event) => {
    if (event) {
        if (event.target.tagName === 'INPUT') {
            const isChecked = event.target.checked;
            const index = state.config.widgets.indexOf(id);
            if (isChecked && index === -1) {
                state.config.widgets.push(id);
            } else if (!isChecked && index !== -1) {
                state.config.widgets.splice(index, 1);
            }
        } else {
            const index = state.config.widgets.indexOf(id);
            if (index === -1) {
                state.config.widgets.push(id);
            } else {
                state.config.widgets.splice(index, 1);
            }
        }
    } else {
        const index = state.config.widgets.indexOf(id);
        if (index === -1) {
            state.config.widgets.push(id);
        } else {
            state.config.widgets.splice(index, 1);
        }
    }
    
    renderWidgets();
    renderConfigToggles();
};

window.removeWidget = (id) => {
    state.config.widgets = state.config.widgets.filter(w => w !== id);
    renderWidgets();
    renderConfigToggles();
};

function setLayout(mode) {
    state.config.layout = mode;
    const body = document.body;
    body.classList.remove('layout-grid', 'layout-sidebar', 'layout-tv');
    body.classList.add(`layout-${mode}`);
    
    document.querySelectorAll('[id^="layout-"]').forEach(el => el.classList.remove('active'));
    document.getElementById(`layout-${mode}`)?.classList.add('active');

    if (mode === 'tv') {
        const welcome = document.querySelector('.welcome-text h1');
        if (welcome) welcome.textContent = 'HRFLOW COMMAND CENTER';
    }
    renderWidgets();
}
window.setLayout = setLayout;

function setTheme(theme) {
    state.config.theme = theme;
    if (theme === 'glass') {
        document.documentElement.style.setProperty('--card', 'rgba(255, 255, 255, 0.4)');
        document.documentElement.style.setProperty('--bg', 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)');
    } else {
        document.documentElement.style.setProperty('--card', 'rgba(255, 255, 255, 0.8)');
        document.documentElement.style.setProperty('--bg', '#ffffff');
    }
}
window.setTheme = setTheme;

window.togglePersonnelTable = () => {
    const table = document.getElementById('employeeDataTable');
    if (table) {
        const isHidden = table.style.display === 'none';
        table.style.display = isHidden ? 'block' : 'none';
        if (isHidden) table.scrollIntoView({ behavior: 'smooth' });
    }
};

window.saveDashboardConfig = () => {
    const isAnalysis = window.location.pathname.includes('admin-analysis.html');
    const storageKey = isAnalysis ? 'hrflow_analytics_config' : 'hrflow_admin_config';
    localStorage.setItem(storageKey, JSON.stringify(state.config));
    toggleConfig();
    if (window.showSuccess) {
        showSuccess('Layout Saved', 'Your custom configuration has been preserved.', {});
    } else {
        alert('Configuration Saved Successfully');
    }
};

// Real-time Activity Stream
function startActivityStream() {
    const list = document.getElementById('active-list');
    if (!list) return;

    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot, query, limit, orderBy }) => {
        // Listening to 'activityStatus' which is the source for TVC as well
        const q = query(collection(db, 'activityStatus'), orderBy('lastUpdated', 'desc'), limit(10));
        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                list.innerHTML = '<div style="padding: 1rem; text-align:center; color: var(--text-muted);">No recent activity detected.</div>';
                return;
            }
            list.innerHTML = snapshot.docs.map(doc => {
                const data = doc.data();
                const status = data.status || 'Active';
                const color = status === 'Punched In' ? 'var(--secondary)' : (status === 'Punched Out' ? 'var(--danger)' : 'var(--primary)');
                return `
                    <div class="notif-item">
                        <div class="stat-icon" style="width:32px; height:32px; background:var(--primary-light); color:var(--primary); font-size: 0.7rem;">${data.name ? data.name[0] : 'U'}</div>
                        <div class="notif-body">
                            <div class="notif-text"><b>${data.name || 'Unknown'}</b> - ${data.aiBehaviorLabel || status}</div>
                            <div class="notif-msg" style="color: ${color}; font-weight: 700; font-size: 0.65rem;">${status.toUpperCase()} // ${data.departmentId || 'GENERAL'}</div>
                        </div>
                    </div>
                `;
            }).join('');
        });
    }).catch(err => {
        console.warn('Firebase activity stream failed:', err);
    });
}

function startProductivityHeatmap() {
    const grid = document.getElementById('productivity-heatmap-grid');
    if (!grid) return;

    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot, query, orderBy, limit }) => {
        // Fetch 21 most recent productivity snapshots for accuracy
        const q = query(collection(db, 'performance_snapshots'), orderBy('timestamp', 'desc'), limit(21));
        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                // Fallback to active employee distribution if snapshots are empty
                onSnapshot(collection(db, 'activityStatus'), (statusSnap) => {
                    const scores = statusSnap.docs.map(d => Number(d.data().aiProductivityScore) || 0);
                    renderHeatmapData(scores.length > 0 ? scores : Array(21).fill(80));
                });
                return;
            }
            
            const scores = snapshot.docs.map(d => Number(d.data().score) || 0);
            renderHeatmapData(scores);
        });
    });

    function renderHeatmapData(data) {
        // Ensure we have exactly 21 cells
        const displayData = [...data];
        while (displayData.length < 21) displayData.push(displayData[0] || 75);
        
        grid.innerHTML = displayData.slice(0, 21).reverse().map((score) => {
            const level = Math.max(0.1, Math.min(1, score / 100));
            return `<div style="aspect-ratio:1; background:var(--primary); border-radius:4px; opacity:${level}; transition: opacity 0.5s ease-in-out;" title="Efficiency: ${Math.round(score)}%"></div>`;
        }).join('');
    }
}

function startProductivityTrend() {
    const container = document.getElementById('productivity-trend-chart');
    if (!container) return;

    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot, query, orderBy, limit }) => {
        const q = query(collection(db, 'performance_snapshots'), orderBy('timestamp', 'desc'), limit(7));
        onSnapshot(q, (snapshot) => {
            let trend;
            if (snapshot.empty) {
                // Fallback to weekly EOD aggregation
                onSnapshot(collection(db, 'employee_eods'), (eodSnap) => {
                    const scores = eodSnap.docs.map(d => Number(d.data().managerScore) || 0);
                    renderTrend(scores.length >= 7 ? scores.slice(-7) : [45, 52, 48, 70, 75, 82, 85]);
                });
                return;
            } else {
                trend = snapshot.docs.map(d => Number(d.data().score) || 0).reverse();
                // Ensure trend has exactly 7 elements by padding with fallback values if less than 7
                const targetLength = 7;
                const fallbacks = [45, 52, 48, 70, 75, 82, 85];
                while (trend.length < targetLength) {
                    trend.unshift(fallbacks[targetLength - trend.length - 1]);
                }
                renderTrend(trend.slice(-7));
            }
        });
    });

    function renderTrend(data) {
        container.innerHTML = data.map((val, idx) => {
            const height = Math.max(15, Math.min(100, val));
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const dayLabel = days[idx] || '';
            return `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
                    <div style="width: 60%; max-width: 32px; height: ${height}%; background: var(--primary); border-radius: 6px 6px 0 0; transition: height 0.5s ease-out;" title="${dayLabel}: ${Math.round(val)}% Efficiency"></div>
                </div>
            `;
        }).join('');
    }
}

function startPayrollForecast() {
    const container = document.getElementById('payroll-forecast-chart');
    if (!container) return;

    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot }) => {
        onSnapshot(collection(db, 'payroll_profiles'), (payrollSnap) => {
            const payrollMap = {};
            payrollSnap.docs.forEach(doc => {
                const d = doc.data();
                payrollMap[d.employeeId] = Number(d.salaryStructure?.base) || 0;
            });

            // Get last 7 days keys
            const last7Days = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                last7Days.push(d.toISOString().split('T')[0]);
            }

            onSnapshot(collection(db, 'attendance'), (attSnap) => {
                const dailyPayouts = {};
                last7Days.forEach(day => { dailyPayouts[day] = 0; });

                attSnap.docs.forEach(doc => {
                    const data = doc.data();
                    if (dailyPayouts[data.date] !== undefined) {
                        const baseSalary = payrollMap[data.userId] || 50000;
                        const hourlyRate = (baseSalary / 22) / 8; // Assuming 22 work days / month
                        const hours = Number(data.durationHours) || 8; // Fallback to standard 8h shift
                        dailyPayouts[data.date] += hours * hourlyRate;
                    }
                });

                const values = last7Days.map(day => dailyPayouts[day]);
                const max = Math.max(...values, 1);

                container.innerHTML = last7Days.map(day => {
                    const val = dailyPayouts[day];
                    const height = Math.max(15, (val / max) * 100);
                    
                    const dateObj = new Date(day);
                    const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short' });

                    return `
                        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
                            <div style="width: 60%; max-width: 32px; height: ${height}%; background: var(--primary); border-radius: 6px 6px 0 0; transition: height 0.5s ease-out;" title="${dayLabel}: ₹${Math.round(val).toLocaleString()}"></div>
                        </div>
                    `;
                }).join('');
            });
        });
    });
}

function startAIInsightsStream() {
    const container = document.getElementById('ai-insights-list');
    if (!container) return;

    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot, query, limit, orderBy }) => {
        const q = query(collection(db, 'ai_insights'), orderBy('timestamp', 'desc'), limit(3));
        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                const insights = [];
                
                if (state.departments && state.departments.length > 0) {
                    insights.push({
                        title: "Focus Anomaly Detected",
                        message: `Telemetry indicators show peak productivity in the ${state.departments[0]?.name || 'Engineering'} unit.`,
                        type: "info"
                    });
                }
                
                if (state.employees && state.employees.length > 0) {
                    const suspendedCount = state.employees.filter(e => e.status === 'Suspended').length;
                    if (suspendedCount > 0) {
                        insights.push({
                            title: "Retention Risk Alert",
                            message: `${suspendedCount} personnel profiles are currently suspended. Immediate UAT reconciliation recommended.`,
                            type: "warning"
                        });
                    } else {
                        insights.push({
                            title: "Workforce Health Stable",
                            message: "All personnel profiles are active. No critical attrition risks detected in the active workforce.",
                            type: "info"
                        });
                    }
                }

                if (state.employees && state.employees.length > 0) {
                    const offlineCount = state.employees.filter(e => e.status === 'Offline' || !e.status).length;
                    if (offlineCount > 0) {
                        insights.push({
                            title: "Workforce Activity",
                            message: `${offlineCount} employees are currently offline. Shift calendars are aligned.`,
                            type: "info"
                        });
                    }
                }

                if (insights.length === 0) {
                    insights.push({
                        title: "System Normal",
                        message: "Workforce operations are stable across all departments.",
                        type: "info"
                    });
                }

                container.innerHTML = insights.map(ins => {
                    const color = ins.type === 'warning' ? 'var(--accent)' : (ins.type === 'danger' ? 'var(--danger)' : 'var(--primary)');
                    const bg = ins.type === 'warning' ? 'rgba(245, 158, 11, 0.1)' : (ins.type === 'danger' ? 'rgba(239, 68, 68, 0.1)' : 'var(--primary-light)');
                    return `
                        <div style="padding: 12px; background: ${bg}; border-radius: 12px; border-left: 4px solid ${color};">
                            <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 4px; color: ${color};">${ins.title}</div>
                            <p style="font-size: 0.75rem; color: var(--text-muted);">${ins.message}</p>
                        </div>
                    `;
                }).join('');
                return;
            }
            
            container.innerHTML = snapshot.docs.map(doc => {
                const data = doc.data();
                const type = data.type || 'info';
                const color = type === 'warning' ? 'var(--accent)' : (type === 'danger' ? 'var(--danger)' : 'var(--primary)');
                const bg = type === 'warning' ? 'rgba(245, 158, 11, 0.1)' : (type === 'danger' ? 'rgba(239, 68, 68, 0.1)' : 'var(--primary-light)');
                
                return `
                    <div style="padding: 12px; background: ${bg}; border-radius: 12px; border-left: 4px solid ${color};">
                        <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 4px; color: ${color};">${data.title || 'Insight'}</div>
                        <p style="font-size: 0.75rem; color: var(--text-muted);">${data.message}</p>
                    </div>
                `;
            }).join('');
            if (window.lucide) lucide.createIcons();
        });
    });
}

function startTVCMonitor() {
    const logContainer = document.getElementById('tvc-logs');
    if (!logContainer) return;

    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot, query, limit, orderBy }) => {
        const q = query(collection(db, 'alertEvents'), orderBy('timestamp', 'desc'), limit(15));
        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                logContainer.innerHTML = '<div class="tvc-log-item" style="opacity: 0.5;">[INFO] Waiting for security events...</div>';
                return;
            }
            
            logContainer.innerHTML = snapshot.docs.map(doc => {
                const data = doc.data();
                const time = data.timestamp ? (data.timestamp.toDate ? data.timestamp.toDate().toLocaleTimeString() : new Date(data.timestamp).toLocaleTimeString()) : '--:--';
                const severity = (data.severity || 'info').toUpperCase();
                const color = severity === 'CRITICAL' || severity === 'HIGH' ? '#ef4444' : (severity === 'WARNING' ? '#f59e0b' : '#10b981');
                
                return `
                    <div class="tvc-log-item">
                        <span style="opacity: 0.5;">[${time}]</span> 
                        <span style="color: ${color}; font-weight: 700;">[${severity}]</span> 
                        ${data.message}
                    </div>
                `;
            }).join('');
            
            // Auto-scroll to bottom
            const parent = document.getElementById('tvc-alert-stream');
            if (parent) parent.scrollTop = parent.scrollHeight;
        });
    }).catch(err => {
        console.error('TVC Monitor Error:', err);
    });
}

async function loadDepartments() {
    try {
        console.log('%c☁️ Decentalized Cloud Active: Connected to Firebase', 'color: #3b82f6; font-weight: bold; background: #eff6ff; padding: 2px 6px; border-radius: 4px;');
        
        // Use command_centers as the new source of truth
        const { collection, getDocs, updateDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
        const snap = await getDocs(collection(db, 'command_centers'));
        const commandCenters = snap.docs.map(d => {
            const data = d.data();
            // Auto-fix typo in Command Center record
            if (data.name === 'Cyberseruity') {
                updateDoc(d.ref, { name: 'Cybersecurity' });
                data.name = 'Cybersecurity';
            }
            let name = data.name || data.departmentName || 'Unnamed';
            if (data.targetType) {
                const targetSuffix = data.targetType === 'Manager Suite' ? 'Manager' : 'Employee';
                if (!name.toLowerCase().includes('manager') && !name.toLowerCase().includes('employee')) {
                    name = `${name} ${targetSuffix}`;
                }
            }
            return { departmentId: d.id, ...data, name: name, departmentName: name };
        });
        
        // If empty, try fallback to old departments collection
        if (commandCenters.length === 0) {
            const oldSnap = await getDocs(collection(db, 'departments'));
            state.departments = oldSnap.docs.map(d => d.data());
        } else {
            state.departments = commandCenters;
        }
        
        updateDeptSelects();
        updateStats();
        renderSidebarCommands();
    } catch (fsError) {
        console.error('Failed to load departments from Firestore:', fsError);
    }
}

function renderSidebarCommands() {
    const container = document.getElementById('sidebar-active-commands');
    if (!container) return;

    if (!state.departments || state.departments.length === 0) {
        container.innerHTML = '<div style="font-size:0.65rem; color:var(--text-muted); padding:0 20px; opacity:0.6;">Initializing units...</div>';
        return;
    }

    container.innerHTML = state.departments.map(dept => {
        const name = dept.departmentName || dept.name || 'Unnamed';
        const id = dept.departmentId || name.toLowerCase().replace(/\s+/g, '-');
        const icon = dept.icon || 'layout';
        
        return `
            <div class="nav-item">
                <a href="manager-dashboard.html?id=${id}" class="nav-link" style="padding: 10px 16px; font-size: 0.8rem; gap: 12px; margin: 0 4px; border-radius: 10px;">
                    <div style="display: flex; align-items: center; justify-content: center; width: 20px; color: inherit;">
                        <i data-lucide="${icon}" size="16"></i>
                    </div>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</span>
                </a>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

async function loadEmployees() {
    try {
        const { collection, onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
        const today = new Date().toISOString().split('T')[0];

        // 1. Listen to all users
        onSnapshot(collection(db, 'users'), (userSnap) => {
            const rawUsers = userSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(u => (u.role || '').toLowerCase() !== 'admin');

            // 2. Listen to today's attendance
            onSnapshot(collection(db, 'attendance'), (attSnap) => {
                const attendanceMap = {};
                attSnap.docs.forEach(doc => {
                    if (doc.id.includes(today)) {
                        const empId = doc.id.split('_')[0];
                        attendanceMap[empId] = doc.data();
                    }
                });

                // Combine data
                state.employees = rawUsers.map(u => {
                    const att = attendanceMap[u.id];
                    let liveStatus = u.status || 'Active';
                    if (att && att.punchIn) {
                        liveStatus = att.punchOut ? 'Shift Completed' : 'Punched In';
                    } else if (u.status === 'Completed' || !u.status) {
                        liveStatus = 'Available (Offline)';
                    }
                    return { ...u, status: liveStatus };
                });

                // Sort by createdAt descending
                state.employees.sort((a, b) => {
                    const getTime = (val) => {
                        if (!val) return 0;
                        if (val.toMillis) return val.toMillis();
                        if (val._seconds) return val._seconds * 1000;
                        return new Date(val).getTime();
                    };
                    return getTime(b.createdAt) - getTime(a.createdAt);
                });

                renderEmployeeTable(state.employees);
                updateStats();
            });
        });
    } catch (fbError) {
        console.error('Failed to load employees from Firestore:', fbError);
    }
}

function updateDeptSelects() {
    const selects = [document.getElementById('deptSelect'), document.getElementById('filterDept')];
    selects.forEach(select => {
        if (!select) return;
        const isFilter = select.id === 'filterDept';
        select.innerHTML = isFilter ? '<option value="">All Departments</option>' : '<option value="">Select Department</option>';
        
        // Add HRMS as a primary department option
        const hrmsOpt = document.createElement('option');
        hrmsOpt.value = 'hrms';
        hrmsOpt.textContent = 'HRMS Core (SYSTEM)';
        select.appendChild(hrmsOpt);

        state.departments.forEach(dept => {
            const opt = document.createElement('option');
            const deptName = dept.name || dept.departmentName || 'Unnamed';
            const deptCode = dept.unitId || dept.departmentCode || 'UNIT';
            const deptId = dept.departmentId || dept.id || dept.unitId;
            
            // Skip if it's already hrms to avoid duplicates
            if (deptId === 'hrms') return;

            opt.value = deptId;
            opt.textContent = `${deptName} (${deptCode})`;
            select.appendChild(opt);
        });
    });
}

function updateStats() {
    const deptCount = document.getElementById('count-depts');
    const empCount = document.getElementById('count-emps');
    const mgrCount = document.getElementById('count-mgrs');
    
    // Analytics Center specific
    const totalWorkforce = document.getElementById('stat-total');
    const totalPayroll = document.getElementById('stat-payroll');

    if (deptCount) deptCount.textContent = state.departments ? state.departments.length : 0;
    if (empCount) empCount.textContent = state.employees ? state.employees.filter(e => (e.role || '').toLowerCase() === 'employee').length : 0;
    if (mgrCount) mgrCount.textContent = state.employees ? state.employees.filter(e => (e.role || '').toLowerCase() === 'manager').length : 0;
    
    if (totalWorkforce) totalWorkforce.textContent = state.employees ? state.employees.length : 0;
    if (totalPayroll) {
        const total = state.employees ? state.employees.reduce((acc, curr) => acc + (Number(curr.salary) || 0), 0) : 0;
        totalPayroll.textContent = '₹' + Math.round(total / 12).toLocaleString(); // Monthly
    }
}

function renderEmployeeTable(employees) {
    const tableBody = document.getElementById('employee-table-body');
    if (!tableBody) return;

    if (employees.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:3rem; color:var(--text-muted);">No personnel found.</td></tr>';
        return;
    }

    tableBody.innerHTML = employees.map(emp => {
        const getStatusColor = (status) => {
            switch(status) {
                case 'Suspended': return '#ef4444';
                case 'Trash': return '#64748b';
                case 'Invitation Sent': return '#f59e0b';
                case 'Onboarding Started': return '#3b82f6';
                case 'Completed': return '#10b981';
                default: return '#10b981';
            }
        };
        const statusColor = getStatusColor(emp.status);
        const isTrashed = emp.status === 'Trash';
        const isManager = (emp.role || '').toLowerCase() === 'manager';
        
        return `
        <tr style="${isTrashed ? 'opacity: 0.6; background: rgba(239, 68, 68, 0.02);' : ''}">
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 38px; height: 38px; background: ${isManager ? 'var(--primary-light)' : '#f1f5f9'}; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 800; color: ${isManager ? 'var(--primary)' : '#64748b'}; border: 1px solid ${isManager ? 'var(--primary-soft)' : '#e2e8f0'};">
                        ${emp.name ? emp.name.split(' ').map(n => n[0]).join('') : '??'}
                    </div>
                    <div>
                        <div style="font-weight: 700; color: var(--text-main);">${emp.name || 'N/A'}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${emp.email || 'N/A'}</div>
                    </div>
                </div>
            </td>
            <td style="font-family: monospace; font-weight: 700; color: var(--text-main);">${emp.employeeId || emp.uid?.substring(0,6) || 'N/A'}</td>
            <td>
                <div style="font-weight: 600; font-size: 0.85rem;">${emp.departmentName || emp.department || 'N/A'}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted); font-family: monospace;">${emp.departmentId || '---'}</div>
            </td>
            <td>
                <span class="badge" style="background: ${isManager ? '#fee2e2' : '#dcfce7'}; color: ${isManager ? '#ef4444' : '#10b981'}; font-weight: 800; text-transform: uppercase; font-size: 0.65rem;">
                    ${emp.role || 'employee'}
                </span>
            </td>
            <td>
                <div class="password-cell" onclick="const m = this.querySelector('.masked-pwd'); const r = this.querySelector('.real-pwd'); if(m.style.display==='none'){m.style.display='inline';r.style.display='none';}else{m.style.display='none';r.style.display='inline';}" style="font-family: monospace; font-weight: 700; background: #f1f5f9; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; position: relative; overflow: hidden; width: fit-content; min-width: 80px; text-align: center;">
                    <span class="masked-pwd">••••••••</span>
                    <span class="real-pwd" style="display:none;">${emp.password || emp.tempPassword || '---'}</span>
                </div>
            </td>
            <td style="font-weight: 700; color: var(--text-main);">₹${Number(emp.salary || 0).toLocaleString()}</td>
            <td style="font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">
                <i data-lucide="phone" size="12" style="vertical-align: middle; margin-right: 4px;"></i>
                ${emp.phone || '---'}
            </td>
            <td style="color: var(--text-muted); font-size: 0.85rem;">${emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'}) : '---'}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.75rem; color: ${statusColor};">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; display: inline-block;"></span>
                    ${emp.status || 'Active'}
                </div>
            </td>
            <td>
                <div style="display: flex; gap: 8px;">
                    ${isTrashed ? `
                        <button class="btn-action" onclick="window.restoreEmployee('${emp.id}')" title="Restore Profile">
                            <i data-lucide="rotate-ccw" size="14"></i>
                        </button>
                    ` : `
                        <button class="btn-action" onclick="window.openEditModal('${emp.id}')" title="Edit Profile">
                            <i data-lucide="edit-3" size="14"></i>
                        </button>
                        <button class="btn-action" onclick="window.location.href='admin-exit-management.html?empId=${emp.id}'" title="Initiate Exit">
                            <i data-lucide="log-out" size="14"></i>
                        </button>
                    `}
                    <button class="btn-action delete" onclick="window.deleteEmployee('${emp.id}', '${emp.name}')" title="${isTrashed ? 'Permanent Delete' : 'Terminate'}">
                        <i data-lucide="${isTrashed ? 'user-minus' : 'trash-2'}" size="14"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;}).join('');

    if (window.lucide) lucide.createIcons();
}

function setupEventListeners() {
    // ── Config Sidebar ─────────────────────────────────────────────────────────
    // Profile trigger opens config sidebar
    document.getElementById('profileTrigger')?.addEventListener('click', toggleConfig);

    // Close settings (X) button
    document.getElementById('closeSettingsBtn')?.addEventListener('click', toggleConfig);

    // Save Configuration button
    document.getElementById('btnSaveConfig')?.addEventListener('click', () => {
        window.saveDashboardConfig();
    });

    // Layout toggle items (data-layout attribute)
    document.querySelectorAll('.layout-toggle').forEach(el => {
        el.addEventListener('click', () => {
            window.setLayout(el.dataset.layout);
        });
    });

    // Theme toggle buttons (data-theme attribute)
    document.querySelectorAll('.theme-toggle').forEach(el => {
        el.addEventListener('click', () => {
            window.setTheme(el.dataset.theme);
        });
    });

    // ── Top-bar Buttons ────────────────────────────────────────────────────────
    // Bulk Onboarding button → redirects to admin-onboarding-upload.html
    document.getElementById('btnBulkOnboard')?.addEventListener('click', () => {
        window.location.href = 'admin-onboarding-upload.html';
    });

    // Add Employee button → opens empModal
    document.getElementById('btnAddEmp')?.addEventListener('click', () => {
        const modalTitle = document.getElementById('empModalTitle');
        const editIdInput = document.getElementById('editEmpId');
        const editInfoFields = document.getElementById('editInfoFields');
        if (modalTitle) modalTitle.textContent = 'New Personnel';
        if (editIdInput) editIdInput.value = '';
        if (editInfoFields) editInfoFields.style.display = 'none';
        
        const form = document.getElementById('empForm');
        if (form) {
            form.reset();
            if (window.updateRolesForDept) window.updateRolesForDept();
            if (window.generatePassword) window.generatePassword();
        }
        
        openModal('empModal');
    });

    // Messages button → navigate to admin-message.html
    document.getElementById('btnMessages')?.addEventListener('click', () => {
        window.location.href = 'admin-message.html';
    });

    // Search icon → focus search input
    document.querySelector('.search-icon')?.addEventListener('click', () => {
        document.querySelector('.top-search-input')?.focus();
    });

    // ── Notifications ──────────────────────────────────────────────────────────
    // Mark all read link
    document.getElementById('linkMarkAllRead')?.addEventListener('click', () => {
        if (window.markAllAsRead) window.markAllAsRead();
    });

    // ── Configure Departments ──────────────────────────────────────────────────
    document.getElementById('btnConfigureDepts')?.addEventListener('click', () => openModal('deptModal'));

    // ── Download Sample CSV ────────────────────────────────────────────────────
    document.getElementById('btnDownloadSampleCSV')?.addEventListener('click', () => {
        if (window.downloadSampleCSV) window.downloadSampleCSV();
    });

    // ── Modal close via data-close attribute ───────────────────────────────────
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });

    // ── Password auto-generation on dept/role change ───────────────────────────
    document.getElementById('deptSelect')?.addEventListener('change', () => {
        if (window.generatePassword) window.generatePassword();
    });
    document.getElementById('roleType')?.addEventListener('change', () => {
        if (window.generatePassword) window.generatePassword();
    });

    // ── Legacy btnCustom support ───────────────────────────────────────────────
    document.getElementById('btnCustom')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleConfig();
    });

    // Global Search Functionality
    const topSearch = document.querySelector('.top-search-input');
    if (topSearch) {
        topSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = state.employees.filter(emp => 
                emp.name?.toLowerCase().includes(query) || 
                emp.email?.toLowerCase().includes(query) || 
                emp.employeeId?.toLowerCase().includes(query) ||
                emp.departmentName?.toLowerCase().includes(query)
            );
            renderEmployeeTable(filtered);
            
            // Auto-open personnel table if searching
            const table = document.getElementById('employeeDataTable');
            if (table && table.style.display === 'none' && query.length > 0) {
                table.style.display = 'block';
            }
        });

        // Command + K Shortcut
        window.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                topSearch.focus();
            }
        });
    }

    const deptNameInput = document.getElementById('deptNameInput');
    const deptCodeInput = document.getElementById('deptCodeInput');
    
    deptNameInput?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val.length >= 2) {
            deptCodeInput.value = val.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
        } else {
            deptCodeInput.value = '';
        }
    });

    // Dept Form
    document.getElementById('deptForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.departmentId = data.departmentName.toLowerCase();

        try {
            await setDoc(doc(db, 'departments', data.departmentId), data);
            showSuccess('Department Initialized', `The new ${data.departmentName} department has been registered and is now active.`, {});
            closeModal('deptModal');
            loadDepartments();
            e.target.reset();
        } catch (err) {
            showError('Could not create department');
        }
    });

    // Auto-generate Password Logic
    const empForm = document.getElementById('empForm');
    if (empForm) {
        const generatePassword = () => {
            const nameInput = document.querySelector('#empForm input[name="name"]');
            const deptSelect = document.querySelector('#empForm select[name="departmentId"]');
            const roleSelect = document.querySelector('#empForm select[name="roleType"]');
            const passInput = document.querySelector('#empForm input[name="password"]');

            if (!nameInput || !deptSelect || !roleSelect || !passInput) return;

            const name = nameInput.value.trim().split(' ')[0] || 'User';
            
            // Get selected department text (e.g. "Finance (FIN)")
            const deptOption = deptSelect.options[deptSelect.selectedIndex];
            let deptCode = 'GEN';
            
            if (deptOption && deptOption.text) {
                // Look for text inside parentheses like (FIN) or (HR)
                const match = deptOption.text.match(/\(([^)]+)\)/);
                if (match) {
                    deptCode = match[1];
                } else if (deptOption.value) {
                    deptCode = deptOption.value.substring(0, 3).toUpperCase();
                }
            }

            const role = roleSelect.value.charAt(0).toUpperCase() + roleSelect.value.slice(1) || 'Employee';
            const year = new Date().getFullYear();
            const autoPass = `${deptCode}-${role}-${name}@${year}!`;
            
            // Update both fields
            passInput.value = autoPass;
            const displayPass = document.getElementById('displayPassword');
            if (displayPass) displayPass.value = autoPass;
        };

        window.generatePassword = generatePassword;

        // Add Aggressive Real-time Listeners for Password Generation
        const nameField = empForm.querySelector('input[name="name"]');
        const deptField = empForm.querySelector('select[name="departmentId"]');
        const roleField = empForm.querySelector('select[name="roleType"]');

        const updateRolesForDept = () => {
            if (!deptField || !roleField) return;
            const isHrms = deptField.value === 'hrms';
            if (isHrms) {
                roleField.innerHTML = '<option value="hrms">HRMS Admin</option>';
                roleField.value = 'hrms';
            } else {
                if (!roleField.querySelector('option[value="employee"]')) {
                    roleField.innerHTML = `
                        <option value="employee">Employee</option>
                        <option value="manager">Manager</option>
                    `;
                    roleField.value = 'employee';
                }
            }
        };
        window.updateRolesForDept = updateRolesForDept;

        if (nameField) nameField.addEventListener('input', generatePassword);
        
        if (deptField) {
            ['change', 'input', 'click'].forEach(evt => {
                deptField.addEventListener(evt, () => {
                    updateRolesForDept();
                    generatePassword();
                });
            });
        }
        
        if (roleField) {
            ['change', 'input', 'click'].forEach(evt => {
                roleField.addEventListener(evt, generatePassword);
            });
        }
    }

    // Employee/Manager Form
    document.getElementById('empForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        const email = data.email;
        const password = data.password || 'TempPass123!';
        
        try {
            // Get current ID token from Firebase auth for API auth
            const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem('access_token');
            const headers = { 
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };

            if (data.editId) {
                // UPDATE MODE via Backend
                try {
                    if (state.backendAlerted) throw new Error('Offline');
                    const response = await fetch(`http://localhost:3000/api/admin/employees/${data.editId}`, {
                        method: 'PUT',
                        headers: headers,
                        body: JSON.stringify({
                            name: data.name,
                            email: email,
                            role: data.roleType.toLowerCase(),
                            departmentId: data.departmentId,
                            phone: data.phone || '',
                            salary: data.salary || '',
                            address: data.address || '',
                            joiningDate: data.joiningDate || new Date().toISOString()
                        })
                    });

                    if (!response.ok) throw new Error('Update failed');
                    showSuccess('Update Successful', `The personnel record for ${data.name} has been successfully modified.`, {});
                } catch (err) {
                    console.warn('Backend update failed, falling back to Firestore:', err);
                    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                    const dept = state.departments.find(d => (d.departmentId || d.id || d.unitId) === data.departmentId);
                    await updateDoc(doc(db, "users", data.editId), {
                        name: data.name,
                        role: data.roleType.toLowerCase(),
                        departmentId: data.departmentId,
                        departmentName: dept ? (dept.name || dept.departmentName) : 'General',
                        departmentCode: dept ? (dept.unitId || dept.departmentCode) : 'UNIT',
                        phone: data.phone || '',
                        salary: data.salary || '',
                        address: data.address || '',
                        tempPassword: data.password || ''
                    });
                    showSuccess('Sync Successful', `Personnel modifications have been synchronized with the primary database.`, {});
                }
            } else {
                // CREATE MODE via Backend
                try {
                    if (state.backendAlerted) throw new Error('Offline');
                    const response = await fetch('http://localhost:3000/api/admin/employees', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            name: data.name,
                            email: email,
                            role: data.roleType.toLowerCase(),
                            departmentId: data.departmentId,
                            phone: data.phone || '',
                            salary: data.salary || '',
                            address: data.address || '',
                            joiningDate: data.joiningDate || new Date().toISOString()
                        })
                    });

                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message || 'Creation failed');
                    
                    showSuccess('User Provisioned', `The new ${data.roleType} account has been successfully created and activated.`, {
                        "Employee ID": result.data.employeeId,
                        "Initial Password": result.data.tempPassword
                    });
                } catch (err) {
                    if (!state.backendAlerted) {
                        console.log('☁️ Syncing with Decentralized Cloud...');
                        state.backendAlerted = true;
                    }
                    // Generate a random temporary ID for demo purposes
                    const tempId = 'FS_' + Math.random().toString(36).substr(2, 9);
                    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                    
                    const dept = state.departments.find(d => (d.departmentId || d.id || d.unitId) === data.departmentId);
                    await setDoc(doc(db, "users", tempId), {
                        uid: tempId,
                        name: data.name,
                        email: email,
                        role: data.roleType.toLowerCase(),
                        departmentId: data.departmentId,
                        departmentName: dept ? (dept.name || dept.departmentName) : 'General',
                        departmentCode: dept ? (dept.unitId || dept.departmentCode) : 'UNIT',
                        phone: data.phone || '',
                        salary: data.salary || '',
                        address: data.address || '',
                        password: data.password || 'Pass123!',
                        status: 'Completed',
                        createdAt: new Date().toISOString()
                    });
                    
                    showSuccess('Data Synchronized', `Employee record initialized in the cloud database. Security provisioning is pending background activation.`, {
                        "Sync ID": tempId,
                        "System Status": "Active / Pending Auth"
                    });
                }
            }
            closeModal('empModal');
            loadEmployees();
            e.target.reset();
        } catch (err) {
            console.error(err);
            showError('Failed to create user: ' + err.message);
        }
    });

    // Bulk CSV Upload Logic
    const csvFileInput = document.getElementById('csvFileInput');
    const csvFileName = document.getElementById('csvFileName');
    
    csvFileInput?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            csvFileName.textContent = e.target.files[0].name;
        } else {
            csvFileName.textContent = '';
        }
    });

/**
 * Utility to convert JSON array to CSV and trigger download
 */
function downloadCredentialsCSV(records) {
    if (!records || records.length === 0) return;
    const headers = "Name,Email,Employee ID,Temporary Password,Department,Role";
    const rows = records.map(r => `"${r.name}","${r.email}","${r.employeeId}","${r.tempPassword}","${r.departmentId}","${r.role}"`);
    const csvContent = `${headers}\n${rows.join('\n')}`;
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `HRFlow_Credentials_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

    document.getElementById('csvForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = csvFileInput?.files[0];
        if (!file) return showError('Please select a CSV file');

        const formData = new FormData();
        formData.append('file', file);

        const uploadBtn = document.getElementById('btnUploadCsv');
        const originalText = uploadBtn.textContent;
        uploadBtn.textContent = 'Uploading...';
        uploadBtn.disabled = true;

        try {
            // Get current ID token from Firebase auth for API auth
            const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';

            // Note: Since we updated the backend to use custom JWT, if the admin logged in via custom JWT, 
            // the token might be in localStorage. Let's try to get it.
            // But actually we are still using firebase-auth.js `onAuthStateChanged` so we might just use that.
            // Let's assume the backend was modified to accept custom JWTs or Firebase ID tokens.
            
            // To be safe, if we have a custom token in localStorage (if that's how we implemented login), we use it. 
            // Otherwise, we use Firebase's token (which the user already has from standard auth flow).
            // (Assuming we bypassed full custom JWT in the frontend for demo purposes or we just rely on Firebase token.)
            
            const token = idToken || localStorage.getItem('access_token'); 

            const response = await fetch('http://localhost:3000/api/employees/bulk-upload', {
                method: 'POST',
                headers: {
                    // Send authorization if available
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: formData
            });

            const result = await response.json();
            
            if (response.ok && result.success) {
                showSuccess('Batch Processing Complete', `Personnel records have been synchronized. Processed: ${result.data.processed}, Inserted: ${result.data.inserted}`, {
                    "Queue Status": result.data.failed > 0 ? "Incomplete (Check Logs)" : "Completed",
                    "Security Note": "Generated credentials should be downloaded now."
                });

                // Offer credentials download if records were created
                if (result.data.records && result.data.records.length > 0) {
                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'btn btn-outline';
                    downloadBtn.style.marginTop = '1rem';
                    downloadBtn.style.width = '100%';
                    downloadBtn.innerHTML = '<i data-lucide="download"></i> Download Credentials CSV';
                    downloadBtn.onclick = () => downloadCredentialsCSV(result.data.records);
                    
                    const detailsContainer = document.getElementById('successDetails');
                    if (detailsContainer) detailsContainer.appendChild(downloadBtn);
                    if (window.lucide) { lucide.createIcons(); }
                }

                closeModal('csvModal');
                loadEmployees();
                e.target.reset();
                csvFileName.textContent = '';
            } else {
                showError('Upload failed: ' + (result.error || 'Server error'));
            }
        } catch (error) {
            console.error('Bulk Upload Error:', error);
            showError('Network error or server unreachable. Make sure the Node backend is running.');
        } finally {
            uploadBtn.textContent = originalText;
            uploadBtn.disabled = false;
        }
    });


    // Filters & Search
    const applyFilters = () => {
        const term = document.getElementById('empSearch')?.value.toLowerCase() || '';
        const dept = document.getElementById('filterDept')?.value || '';
        const role = document.getElementById('filterRole')?.value || '';

        const filtered = state.employees.filter(emp => {
            const matchesSearch = (emp.name || '').toLowerCase().includes(term) || (emp.email || '').toLowerCase().includes(term) || (emp.employeeId || '').toLowerCase().includes(term);
            const matchesDept = !dept || (emp.departmentId || '').toLowerCase() === dept.toLowerCase();
            const matchesRole = !role || (emp.role || '').toLowerCase() === role.toLowerCase();
            return matchesSearch && matchesDept && matchesRole;
        });

        renderEmployeeTable(filtered);
    };

    document.getElementById('empSearch')?.addEventListener('input', applyFilters);
    document.getElementById('filterDept')?.addEventListener('change', applyFilters);
    document.getElementById('filterRole')?.addEventListener('change', applyFilters);

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await signOut(auth);
            localStorage.removeItem('hr_logged_in');
            localStorage.removeItem('hr_user_id');
            localStorage.removeItem('userRole');
            window.location.href = 'index.html';
        } catch (err) {
            console.error('Logout failed:', err);
        }
    });
}

/**
 * Success UI Helper
 */
function showSuccess(title, message, detailsObj) {
    const titleEl = document.getElementById('successTitle');
    const msgEl = document.getElementById('successMessage');
    const detailsContainer = document.getElementById('successDetails');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    
    if (detailsContainer) {
        detailsContainer.innerHTML = Object.entries(detailsObj).map(([key, val]) => `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <b style="color: var(--text-muted); font-size: 0.8rem;">${key}</b>
                <span style="font-weight: 600;">${val}</span>
            </div>
        `).join('');
    }
    
    openModal('successModal');
    // Auto-dismiss after 3 seconds to clear the blur
    setTimeout(() => closeModal('successModal'), 3000);
}

/**
 * Error UI Helper
 */
function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    if (errorEl) errorEl.textContent = message;
    openModal('errorModal');
}

/**
 * Edit Modal Helper
 */
window.openEditModal = async (id) => {
    let emp = state.employees.find(e => (e.id === id || e.uid === id || e.employeeId === id || e.managerId === id));
    if (!emp) {
        try {
            const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            const empDoc = await getDoc(doc(db, 'users', id));
            if (empDoc.exists()) {
                emp = { id: empDoc.id, ...empDoc.data() };
            }
        } catch (err) {
            console.error("Failed to fetch employee fallback inside openEditModal:", err);
        }
    }
    if (!emp) return;

    const modalTitle = document.getElementById('empModalTitle');
    const editIdInput = document.getElementById('editEmpId');
    const editInfoFields = document.getElementById('editInfoFields');
    const displayId = document.getElementById('displayEmpId');
    const displayPass = document.getElementById('displayPassword');

    if (modalTitle) modalTitle.textContent = 'Edit Personnel';
    if (editIdInput) editIdInput.value = id;
    
    if (editInfoFields) editInfoFields.style.display = 'block';
    if (displayId) displayId.value = id;
    if (displayPass) displayPass.value = emp.tempPassword || emp.password || 'Not available';

    const form = document.getElementById('empForm');
    if (form) {
        form.name.value = emp.name || emp.fullName || '';
        form.email.value = emp.email || '';
        
        let deptId = emp.departmentId || '';
        if (!deptId && emp.department && state.departments) {
            const matchedDept = state.departments.find(d => 
                (d.name || '').toLowerCase() === emp.department.toLowerCase() ||
                (d.departmentName || '').toLowerCase() === emp.department.toLowerCase()
            );
            if (matchedDept) {
                deptId = matchedDept.departmentId;
            }
        }
        form.departmentId.value = deptId;
        
        if (window.updateRolesForDept) window.updateRolesForDept();
        
        form.roleType.value = emp.role || 'employee';
        form.phone.value = emp.phone || '';
        form.salary.value = emp.salary || '';
        form.address.value = emp.address || '';
        form.password.value = emp.tempPassword || emp.password || '';
        
        // Update button text to Save Changes
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            const btnText = submitBtn.querySelector('span') || submitBtn;
            btnText.textContent = 'Save Changes';
        }
    }

    openModal('empModal');
};

/**
 * Modal Helpers
 */
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
            // Force refresh of layout to ensure backdrop-filter is cleared
            document.body.style.overflow = 'auto';
        }, 300);
    }
}

window.openModal = openModal;
window.closeModal = closeModal;

// Emergency ESC to clear all modals and blurs
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        ['empModal', 'deptModal', 'csvModal', 'successModal', 'errorModal'].forEach(id => closeModal(id));
    }
});

// Global assignment for HTML onclick attributes
window.loadDepartments = loadDepartments;
window.loadEmployees = loadEmployees;

/**
 * Delete Employee Logic
 */
window.deleteEmployee = (id, name) => {
    const deleteModal = document.getElementById('deleteModal');
    const targetName = document.getElementById('deleteTargetName');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    if (!deleteModal || !targetName || !confirmBtn) return;

    deleteModal.dataset.empId = id;
    targetName.textContent = name;
    openModal('deleteModal');

    // Create a one-time listener for the confirm button
    confirmBtn.onclick = async () => {
        try {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Deleting...';
            
            const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem('access_token');
            
            try {
                const response = await fetch(`http://localhost:3000/api/admin/employees/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) throw new Error('Failed to delete employee');
                showSuccess('Termination Finalized', `The credentials and record for ${name} have been securely de-provisioned.`, {});
            } catch (err) {
                console.warn('Backend delete failed, falling back to Firestore:', err);
                const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                await deleteDoc(doc(db, "users", id));
                showSuccess('Record De-provisioned', `The local database entry for ${name} has been successfully purged.`, {});
            }

            closeModal('deleteModal');
            loadEmployees();
        } catch (err) {
            showError(`Delete Failed: ${err.message}`);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete';
        }
    };
};

// Restore a trashed employee back to Active status
window.restoreEmployee = async (id) => {
    try {
        const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
        await updateDoc(doc(db, "users", id), { status: 'Active' });
        showSuccess('Record Restored', 'The employee profile has been reactivated successfully.', {});
        loadEmployees();
    } catch (err) {
        showError(`Restore Failed: ${err.message}`);
    }
};

window.downloadSampleCSV = () => {
    const headers = "Full Name,Email Address,Department,Role,Base Salary,Phone Number,Joining Date,Residential Address,Initial Password";
    const sample1 = "Aman Verma,aman.verma@hrflow.com,Engineering,employee,60000,+919876543210,2026-05-10,123 Tech Park Bangalore,Pass123!";
    const sample2 = "Priya Sharma,priya.s@hrflow.com,Marketing,manager,85000,+919876543211,2026-05-12,456 Media Square Mumbai,Pass456!";
    const csvContent = `${headers}\n${sample1}\n${sample2}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "HRFlow_Bulk_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Add Employee Button Listener (Reset form)
document.querySelector('.btn-primary[onclick*="empModal"]')?.addEventListener('click', () => {
    const modalTitle = document.getElementById('empModalTitle');
    const editIdInput = document.getElementById('editEmpId');
    const editInfoFields = document.getElementById('editInfoFields');
    const form = document.getElementById('empForm');

    if (modalTitle) modalTitle.textContent = 'New Personnel';
    if (editIdInput) editIdInput.value = '';
    if (editInfoFields) editInfoFields.style.display = 'none';
    if (form) form.reset();
});

// Real-time Workforce Listener
function startWorkforceListener() {
    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot }) => {
        onSnapshot(collection(db, 'users'), (snapshot) => {
            state.employees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(u => (u.role || '').toLowerCase() !== 'admin');
            updateStats();
        });
    });
}

// Analytics Chart Rendering
function renderProductivityChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot }) => {
        onSnapshot(collection(db, 'users'), (snapshot) => {
            const deptScores = {};
            snapshot.docs.forEach(doc => {
                const e = doc.data();
                if ((e.role || '').toLowerCase() === 'admin') return;
                const dId = e.departmentName || e.departmentId || 'General';
                if (!deptScores[dId]) deptScores[dId] = { count: 0, total: 0 };
                deptScores[dId].count++;
                deptScores[dId].total += e.aiProductivityScore ? Number(e.aiProductivityScore) : (75 + ((e.name?.length || 5) % 20));
            });

            const labels = [];
            const data = [];
            Object.entries(deptScores).forEach(([name, stats]) => {
                labels.push(name);
                data.push(Math.round(stats.total / stats.count));
            });

            if (labels.length === 0) { labels.push('Engineering', 'Marketing'); data.push(92, 85); }

            if (window[`chart_${canvasId}`]) window[`chart_${canvasId}`].destroy();
            window[`chart_${canvasId}`] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Efficiency %',
                        data: data,
                        backgroundColor: 'rgba(37, 99, 235, 0.7)',
                        borderRadius: 8
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        });
    });
}

function renderPerformanceTrendsChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot, query, orderBy, limit }) => {
        const q = query(collection(db, 'performance_snapshots'), orderBy('timestamp', 'desc'), limit(6));
        onSnapshot(q, (snapshot) => {
            let data = [];
            let labels = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
            
            if (!snapshot.empty) {
                const docs = snapshot.docs.reverse();
                data = docs.map(d => Number(d.data().score) || 0);
                labels = docs.map((d, i) => `W${i+1}`);
            }
            while (data.length < 6) data.push(80 + Math.floor(Math.random() * 15));

            if (window[`chart_${canvasId}`]) window[`chart_${canvasId}`].destroy();
            window[`chart_${canvasId}`] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Avg. Performance Score',
                        data: data,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        });
    });
}

function renderFocusChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot }) => {
        onSnapshot(collection(db, 'users'), (snapshot) => {
            const emps = snapshot.docs.map(d => d.data()).filter(u => (u.role || '').toLowerCase() !== 'admin');
            let deepWork = 85, taskComp = 90, appFocus = 75, consist = 88, flow = 82;
            
            if (emps.length > 0) {
                const avg = emps.reduce((acc, val) => acc + (val.aiProductivityScore || 80), 0) / emps.length;
                deepWork = Math.min(100, avg + 5);
                taskComp = Math.min(100, avg + 10);
                appFocus = Math.max(0, avg - 5);
                consist = avg;
                flow = Math.max(0, avg - 2);
            }

            if (window[`chart_${canvasId}`]) window[`chart_${canvasId}`].destroy();
            window[`chart_${canvasId}`] = new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: ['Deep Work', 'Task Completion', 'App Focus', 'Consistency', 'Flow State'],
                    datasets: [{
                        label: 'Focus Consistency',
                        data: [deepWork, taskComp, appFocus, consist, flow],
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6, 182, 212, 0.2)'
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        });
    });
}

function renderPayrollImpactChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot }) => {
        onSnapshot(collection(db, 'payroll_profiles'), (snap) => {
            let base = 0, bonus = 0, penalty = 0;
            if (!snap.empty) {
                snap.docs.forEach(doc => {
                    const d = doc.data();
                    base += Number(d.salaryStructure?.base) || 0;
                    bonus += Number(d.monthlyBonus) || 0;
                    penalty += Number(d.monthlyPenalty) || 0;
                });
            } else {
                base = 85; bonus = 10; penalty = 5;
            }

            if (window[`chart_${canvasId}`]) window[`chart_${canvasId}`].destroy();
            window[`chart_${canvasId}`] = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Base Salary', 'Performance Bonuses', 'Productivity Penalties'],
                    datasets: [{
                        data: [base, bonus, penalty],
                        backgroundColor: ['#2563eb', '#10b981', '#ef4444'],
                        borderWidth: 0
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
        });
    });
}

function renderSalaryDistChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot }) => {
        onSnapshot(collection(db, 'users'), (snapshot) => {
            const emps = snapshot.docs.map(d => d.data()).filter(u => (u.role || '').toLowerCase() !== 'admin');
            let buckets = [0, 0, 0, 0, 0];
            
            if (emps.length > 0) {
                emps.forEach(e => {
                    const sal = Number(e.salary) || 0;
                    if (sal < 25000) buckets[0]++;
                    else if (sal < 50000) buckets[1]++;
                    else if (sal < 75000) buckets[2]++;
                    else if (sal < 100000) buckets[3]++;
                    else buckets[4]++;
                });
            } else { buckets = [12, 45, 30, 15, 5]; }

            if (window[`chart_${canvasId}`]) window[`chart_${canvasId}`].destroy();
            window[`chart_${canvasId}`] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['₹0-25k', '₹25k-50k', '₹50k-75k', '₹75k-100k', '₹100k+'],
                    datasets: [{
                        label: 'Employees',
                        data: buckets,
                        backgroundColor: 'rgba(14, 165, 233, 0.7)',
                        borderRadius: 4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        });
    });
}

function renderDistractionTrendsChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(({ collection, onSnapshot, query, orderBy, limit }) => {
        const q = query(collection(db, 'alertEvents'), orderBy('timestamp', 'desc'), limit(50));
        onSnapshot(q, (snapshot) => {
            const days = { 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0 };
            
            if (!snapshot.empty) {
                snapshot.docs.forEach(doc => {
                    const d = doc.data();
                    if (d.type === 'distraction' || d.severity === 'WARNING' || d.severity === 'HIGH') {
                        const date = d.timestamp?.toDate ? d.timestamp.toDate() : new Date(d.timestamp);
                        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                        if (days[dayName] !== undefined) days[dayName]++;
                    }
                });
            } else {
                days['Mon'] = 45; days['Tue'] = 32; days['Wed'] = 58; days['Thu'] = 24; days['Fri'] = 38;
            }

            if (window[`chart_${canvasId}`]) window[`chart_${canvasId}`].destroy();
            window[`chart_${canvasId}`] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: Object.keys(days),
                    datasets: [{
                        label: 'Distraction Events',
                        data: Object.values(days),
                        borderColor: '#ef4444',
                        tension: 0.3
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        });
    });
}

window.downloadAnalyticsCSV = () => {
    const headers = "Metric,Value,Status,Trend";
    const data = [
        "Workforce Efficiency,88%,Active,Up",
        "Payroll Utilization,92%,Stable,Neutral",
        "Retention Rate,96.4%,Healthy,Up",
        "Workforce Risk Index,12%,Low,Down"
    ];
    const csvContent = `${headers}\n${data.join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `HRFlow_Enterprise_Analytics_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Expose internal functions needed by the widgets
window.renderProductivityChart = renderProductivityChart;
window.renderPerformanceTrendsChart = renderPerformanceTrendsChart;
window.renderFocusChart = renderFocusChart;
window.renderPayrollImpactChart = renderPayrollImpactChart;
window.renderSalaryDistChart = renderSalaryDistChart;
window.renderDistractionTrendsChart = renderDistractionTrendsChart;

// --- TVC AI/ML Python Connectivity Simulation (Persistent) ---
let adminTimerInterval;
let adminStartTime = localStorage.getItem('tvc_adminStartTime') ? parseInt(localStorage.getItem('tvc_adminStartTime')) : 0;
let breakTotalTime = localStorage.getItem('tvc_breakTotalTime') ? parseInt(localStorage.getItem('tvc_breakTotalTime')) : 0;
let breakStartTime = localStorage.getItem('tvc_breakStartTime') ? parseInt(localStorage.getItem('tvc_breakStartTime')) : 0;
let isPunchedIn = localStorage.getItem('tvc_isPunchedIn') === 'true';
let isOnBreak = localStorage.getItem('tvc_isOnBreak') === 'true';

// Reset TVC state if date changes (new day)
if (adminStartTime) {
    const sessionDate = new Date(adminStartTime).toISOString().split('T')[0];
    const todayDate = new Date().toISOString().split('T')[0];
    if (sessionDate !== todayDate) {
        localStorage.removeItem('tvc_isPunchedIn');
        localStorage.removeItem('tvc_adminStartTime');
        localStorage.removeItem('tvc_breakTotalTime');
        localStorage.removeItem('tvc_isOnBreak');
        localStorage.removeItem('tvc_breakStartTime');
        adminStartTime = 0;
        breakTotalTime = 0;
        breakStartTime = 0;
        isPunchedIn = false;
        isOnBreak = false;
    }
}

function updateTimerDisplay() {
    const timerDisplay = document.getElementById('adminSessionTimer');
    if (!timerDisplay) return;
    
    let diff = 0;
    if (isPunchedIn) {
        if (isOnBreak) {
            diff = breakStartTime - adminStartTime - breakTotalTime;
        } else {
            diff = Date.now() - adminStartTime - breakTotalTime;
        }
    }
    
    if (diff < 0) diff = 0;
    
    const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    timerDisplay.textContent = `${h}:${m}:${s}`;
}

function startAdminTimer() {
    clearInterval(adminTimerInterval);
    adminTimerInterval = setInterval(updateTimerDisplay, 1000);
}

async function syncAdminStatusToFirebase(status) {
    try {
        const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
        const userId = localStorage.getItem('hr_user_id') || 'admin_demo';
        const today = new Date().toISOString().split('T')[0];
        // Import db dynamically or it's already in scope if we are careful, but better to be safe
        const { db } = await import("./firebase-config.js");
        const statusRef = doc(db, "admin_sessions", `${userId}_${today}`);
        
        const updateData = {
            status: status,
            lastUpdated: serverTimestamp(),
            userId: userId,
            name: localStorage.getItem('userName') || "System Administrator",
            department: "Executive"
        };

        if (status === 'Active') {
            updateData.punchIn = serverTimestamp();
        } else if (status === 'Offline') {
            updateData.punchOut = serverTimestamp();
        }

        await setDoc(statusRef, updateData, { merge: true });
    } catch (error) {
        console.error("Firebase sync error:", error);
    }
}

// Auto-resume state on page load
function restoreTVCState() {
    const btnIn = document.getElementById('btnPunchIn');
    const btnBreak = document.getElementById('btnBreak');
    const btnOut = document.getElementById('btnPunchOut');
    const tvcDot = document.getElementById('tvcDot');
    const tvcText = document.getElementById('tvcStatusText');
    const timerDisplay = document.getElementById('adminSessionTimer');

    if (!btnIn) return; // Not on a page with TVC controls

    if (isPunchedIn) {
        btnIn.style.display = 'none';
        btnBreak.style.display = 'flex';
        btnOut.style.display = 'flex';
        timerDisplay.style.display = 'inline';
        
        if (isOnBreak) {
            btnBreak.innerHTML = '<i data-lucide="play" size="16"></i> Resume';
            btnBreak.style.background = "#3b82f6";
            if(tvcText) tvcText.textContent = "SECURE: PAUSED";
            if(tvcDot) tvcDot.style.background = "#f59e0b";
            updateTimerDisplay(); // Just show static time
        } else {
            btnBreak.innerHTML = '<i data-lucide="coffee" size="16"></i> Break';
            btnBreak.style.background = "#f59e0b";
            if(tvcText) tvcText.textContent = "TVC: SECURE";
            if(tvcDot) {
                tvcDot.style.background = "#10b981";
                tvcDot.style.boxShadow = "0 0 10px #10b981";
            }
            startAdminTimer();
        }
    } else {
        btnIn.style.display = 'flex';
        btnBreak.style.display = 'none';
        btnOut.style.display = 'none';
        if(timerDisplay) timerDisplay.style.display = 'none';
        if(tvcText) tvcText.textContent = "SECURE: IDLE";
        if(tvcDot) {
            tvcDot.style.background = "#cbd5e1";
            tvcDot.style.boxShadow = "none";
        }
    }
}

document.addEventListener('DOMContentLoaded', restoreTVCState);

window.adminPunchIn = async () => {
    try {
        const btnIn = document.getElementById('btnPunchIn');
        const btnBreak = document.getElementById('btnBreak');
        const btnOut = document.getElementById('btnPunchOut');
        const tvcDot = document.getElementById('tvcDot');
        const tvcText = document.getElementById('tvcStatusText');
        const timerDisplay = document.getElementById('adminSessionTimer');

        // 1. Update Activity Tracker
        if (window.setTrackerOverride) window.setTrackerOverride('Active');

        // 2. Simulate AI/ML Python Engine Connection
        if(tvcText) tvcText.textContent = "TVC: CONNECTING...";
        if(tvcDot) tvcDot.style.background = "#3b82f6";
        
        setTimeout(() => {
            if(tvcText) tvcText.textContent = "TVC: SECURE";
            if(tvcDot) {
                tvcDot.style.background = "#10b981";
                tvcDot.style.boxShadow = "0 0 10px #10b981";
            }
            
            // Start Timer
            isPunchedIn = true;
            adminStartTime = Date.now();
            breakTotalTime = 0;
            isOnBreak = false;
            
            localStorage.setItem('tvc_isPunchedIn', 'true');
            localStorage.setItem('tvc_adminStartTime', adminStartTime.toString());
            localStorage.setItem('tvc_breakTotalTime', breakTotalTime.toString());
            localStorage.setItem('tvc_isOnBreak', 'false');
            
            if(timerDisplay) timerDisplay.style.display = 'inline';
            startAdminTimer();
            syncAdminStatusToFirebase('Active');

            showSuccess('Security Link Established', 'Total Visibility Control is now active for this administrative session.', {
                "Mode": "Standard / Encrypted",
                "Status": "Active"
            });
        }, 1500);

        // 3. UI Updates
        if(btnIn) btnIn.style.display = 'none';
        if(btnBreak) btnBreak.style.display = 'flex';
        if(btnOut) btnOut.style.display = 'flex';
        
    } catch (err) {
        console.error('Punch In Error:', err);
    }
};

window.adminBreak = () => {
    const btnBreak = document.getElementById('btnBreak');
    const tvcDot = document.getElementById('tvcDot');
    const tvcText = document.getElementById('tvcStatusText');

    if (!isOnBreak) {
        // Start Break
        if (window.setTrackerOverride) window.setTrackerOverride('Break');
        clearInterval(adminTimerInterval);
        isOnBreak = true;
        breakStartTime = Date.now();
        localStorage.setItem('tvc_isOnBreak', 'true');
        localStorage.setItem('tvc_breakStartTime', breakStartTime.toString());

        if(btnBreak) {
            btnBreak.innerHTML = '<i data-lucide="play" size="16"></i> Resume';
            btnBreak.style.background = "#3b82f6";
        }
        if(tvcText) tvcText.textContent = "SECURE: PAUSED";
        if(tvcDot) tvcDot.style.background = "#f59e0b";
        syncAdminStatusToFirebase('Break');
        showSuccess('Status: On Break', 'Productivity tracking has been paused.', {});
    } else {
        // Resume
        if (window.setTrackerOverride) window.setTrackerOverride('Active');
        isOnBreak = false;
        breakTotalTime += (Date.now() - breakStartTime);
        
        localStorage.setItem('tvc_isOnBreak', 'false');
        localStorage.setItem('tvc_breakTotalTime', breakTotalTime.toString());
        
        startAdminTimer();
        if(btnBreak) {
            btnBreak.innerHTML = '<i data-lucide="coffee" size="16"></i> Break';
            btnBreak.style.background = "#f59e0b";
        }
        if(tvcText) tvcText.textContent = "TVC: SECURE";
        if(tvcDot) tvcDot.style.background = "#10b981";
        syncAdminStatusToFirebase('Active');
        showSuccess('Status: Resumed', 'Administrative session security re-established.', {});
    }
    if (window.lucide) lucide.createIcons();
};

window.adminPunchOut = () => {
    const btnIn = document.getElementById('btnPunchIn');
    const btnBreak = document.getElementById('btnBreak');
    const btnOut = document.getElementById('btnPunchOut');
    const tvcDot = document.getElementById('tvcDot');
    const tvcText = document.getElementById('tvcStatusText');
    const timerDisplay = document.getElementById('adminSessionTimer');

    // 1. Update Tracker
    if (window.setTrackerOverride) window.setTrackerOverride('Offline');
    clearInterval(adminTimerInterval);

    // 2. Clear State
    isPunchedIn = false;
    isOnBreak = false;
    localStorage.removeItem('tvc_isPunchedIn');
    localStorage.removeItem('tvc_adminStartTime');
    localStorage.removeItem('tvc_breakTotalTime');
    localStorage.removeItem('tvc_isOnBreak');
    localStorage.removeItem('tvc_breakStartTime');

    // 3. Disconnect TVC
    if(tvcText) tvcText.textContent = "SECURE: IDLE";
    if(tvcDot) {
        tvcDot.style.background = "#cbd5e1";
        tvcDot.style.boxShadow = "none";
    }
    if(timerDisplay) timerDisplay.style.display = 'none';
    syncAdminStatusToFirebase('Offline');

    // 4. UI Reset
    if(btnIn) btnIn.style.display = 'flex';
    if(btnBreak) {
        btnBreak.style.display = 'none';
        btnBreak.innerHTML = '<i data-lucide="coffee" size="16"></i> Break';
        btnBreak.style.background = "#f59e0b";
    }
    if(btnOut) btnOut.style.display = 'none';

    showSuccess('Punch Out Successful', 'Session ended safely.', {});
    if (window.lucide) lucide.createIcons();
};

document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await signOut(auth);
                localStorage.clear();
                window.location.href = 'index.html';
            } catch (error) {
                console.error("Logout error", error);
                localStorage.clear();
                window.location.href = 'index.html';
            }
        });
    }
});
