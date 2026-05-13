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
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    setupEventListeners();
    initDashboard();

    // Start Onboarding Automation Background Cycle
    onboardingAutomation.runAutomationCycle();
    setInterval(() => onboardingAutomation.runAutomationCycle(), 15 * 60 * 1000); // Every 15 mins
});

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
                    <div style="padding: 1rem; text-align:center; color: var(--text-muted);">Monitoring active connections...</div>
                </div>
            `;
            startActivityStream();
            break;

        case 'productivity':
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <div style="height: 150px; background: linear-gradient(180deg, var(--primary-soft) 0%, transparent 100%); border-radius: 12px; display: flex; align-items: flex-end; padding: 10px; gap: 8px;">
                        ${[65, 80, 45, 90, 75, 85, 95].map(h => `<div style="flex:1; height:${h}%; background:var(--primary); border-radius:4px 4px 0 0;"></div>`).join('')}
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
                        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                    </div>
                </div>
            `;
            break;

        case 'ai-insights':
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <div style="padding: 12px; background: var(--primary-light); border-radius: 12px; border-left: 4px solid var(--primary);">
                        <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 4px; color: var(--primary);">Productivity Boost Detected</div>
                        <p style="font-size: 0.75rem; color: var(--text-muted);">Engineering team output is 12% higher than average this week.</p>
                    </div>
                    <div style="padding: 12px; background: rgba(245, 158, 11, 0.1); border-radius: 12px; border-left: 4px solid var(--accent);">
                        <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 4px; color: var(--accent);">Focus Warning</div>
                        <p style="font-size: 0.75rem; color: var(--text-muted);">Marketing department shows a 15% increase in focus loss events.</p>
                    </div>
                </div>
            `;
            break;
            
        case 'tvc-monitor':
            container.innerHTML = `
                <div style="background: #0f172a; padding: 1rem; border-radius: 12px; font-family: monospace; font-size: 0.75rem; color: #10b981; min-height: 120px;">
                    <div style="margin-bottom: 5px;">[SYSTEM] Initializing TVC Data Stream...</div>
                    <div style="margin-bottom: 5px;">[WARN] High idle time: Emp-102 (Sales)</div>
                    <div style="margin-bottom: 5px; color: #ef4444;">[ALERT] Restricted access: User-88 (HR)</div>
                    <div class="cursor" style="display: inline-block; width: 8px; height: 14px; background: #10b981; animation: blink 1s infinite;"></div>
                </div>
                <style>@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }</style>
            `;
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
                        <div style="font-size:1.2rem; font-weight:800;">₹42,500</div>
                    </div>
                    <div style="padding:10px; background:rgba(239, 68, 68, 0.1); border-radius:8px; border-left:4px solid #ef4444;">
                        <div style="font-weight:700; font-size:0.8rem; color:#ef4444;">Total Penalties Applied</div>
                        <div style="font-size:1.2rem; font-weight:800;">₹12,800</div>
                    </div>
                </div>
            `;
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
                        <div class="ai-insight-desc">Based on current trends, workforce is projected to grow by 15% in Q3.</div>
                    </div>
                    <div class="ai-insight-item" style="border-left-color: var(--primary);">
                        <div class="ai-insight-title" style="color:var(--primary);"><i data-lucide="zap" size="14"></i> Efficiency Forecast</div>
                        <div class="ai-insight-desc">Productivity is expected to peak next month due to upcoming project milestones.</div>
                    </div>
                </div>
            `;
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
                        <div class="ai-insight-desc">3 employees in Marketing show high risk of attrition based on engagement metrics.</div>
                    </div>
                    <div class="ai-insight-item" style="border-left-color: #f59e0b;">
                        <div class="ai-insight-title" style="color:#f59e0b;">Burnout Warning</div>
                        <div class="ai-insight-desc">Engineering team shows signs of potential burnout due to sustained overtime.</div>
                    </div>
                </div>
            `;
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
                                <button class="btn btn-outline" style="flex: 1; justify-content: center; padding: 10px; font-size: 0.75rem; font-weight: 700; border-color: var(--primary); color: var(--primary);" onclick="window.location.href='admin-Dashboard-bulider.html?id=${id}'">
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
window.toggleConfig = () => {
    document.getElementById('configSidebar')?.classList.toggle('active');
};

window.toggleWidget = (id, event) => {
    if (event) {
        // If triggered by the checkbox change, we don't want to double toggle
        // If triggered by the div click, we toggle
        if (event.target.tagName === 'INPUT') {
            // Checkbox already changed its 'checked' state
            const isChecked = event.target.checked;
            const index = state.config.widgets.indexOf(id);
            if (isChecked && index === -1) {
                state.config.widgets.push(id);
            } else if (!isChecked && index !== -1) {
                state.config.widgets.splice(index, 1);
            }
        } else {
            // Div clicked
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

window.setLayout = (mode) => {
    state.config.layout = mode;
    const body = document.body;
    body.classList.remove('layout-grid', 'layout-sidebar', 'layout-tv');
    body.classList.add(`layout-${mode}`);
    if (mode === 'tv') {
        const welcome = document.querySelector('.welcome-text h1');
        if (welcome) welcome.textContent = 'HRFLOW COMMAND CENTER';
    }
    renderWidgets();
};

window.setTheme = (theme) => {
    state.config.theme = theme;
    if (theme === 'glass') {
        document.documentElement.style.setProperty('--card', 'rgba(255, 255, 255, 0.4)');
        document.documentElement.style.setProperty('--bg', 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)');
    } else {
        document.documentElement.style.setProperty('--card', 'rgba(255, 255, 255, 0.8)');
        document.documentElement.style.setProperty('--bg', '#ffffff');
    }
};

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
        const q = query(collection(db, 'activity'), orderBy('timestamp', 'desc'), limit(10));
        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                list.innerHTML = '<div style="padding: 1rem; text-align:center; color: var(--text-muted);">No recent activity detected.</div>';
                return;
            }
            list.innerHTML = snapshot.docs.map(doc => {
                const data = doc.data();
                return `
                    <div class="notif-item">
                        <div class="stat-icon" style="width:32px; height:32px; background:var(--primary-light); color:var(--primary); font-size: 0.7rem;">${data.userName ? data.userName[0] : 'U'}</div>
                        <div class="notif-body">
                            <div class="notif-text"><b>${data.userName || 'Unknown'}</b> - ${data.action || 'Active'}</div>
                            <div class="notif-msg">${data.department || 'General'}</div>
                        </div>
                    </div>
                `;
            }).join('');
        });
    }).catch(err => {
        console.warn('Firebase activity stream failed, using demo data:', err);
        list.innerHTML = `
            <div class="notif-item"><div class="stat-icon" style="width:32px; height:32px;">A</div><div class="notif-body"><div class="notif-text"><b>Aman Verma</b> - Coding</div><div class="notif-msg">Engineering</div></div></div>
            <div class="notif-item"><div class="stat-icon" style="width:32px; height:32px;">P</div><div class="notif-body"><div class="notif-text"><b>Priya Sharma</b> - Meeting</div><div class="notif-msg">Marketing</div></div></div>
        `;
    });
}

async function loadDepartments() {
    try {
        console.log('%c☁️ Decentalized Cloud Active: Connected to Firebase', 'color: #3b82f6; font-weight: bold; background: #eff6ff; padding: 2px 6px; border-radius: 4px;');
        
        // Use command_centers as the new source of truth
        const snap = await getDocs(collection(db, 'command_centers'));
        const commandCenters = snap.docs.map(d => ({ departmentId: d.id, ...d.data() }));
        
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
        const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
        const snap = await getDocs(collection(db, 'users'));
        state.employees = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(u => (u.role || '').toLowerCase() !== 'admin');
        
        // Sort by createdAt descending (Newest first)
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
    } catch (fbError) {
        console.error('Failed to load employees from Firestore:', fbError);
        renderEmployeeTable([]);
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
                        <button class="btn-action" onclick="restoreEmployee('${emp.uid || emp.id}')" title="Restore Profile">
                            <i data-lucide="rotate-ccw" size="14"></i>
                        </button>
                    ` : `
                        <button class="btn-action" onclick="openEditModal('${emp.uid || emp.id}')" title="Edit Profile">
                            <i data-lucide="edit-3" size="14"></i>
                        </button>
                    `}
                    <button class="btn-action delete" onclick="deleteEmployee('${emp.uid || emp.id}', '${emp.name}')" title="${isTrashed ? 'Permanent Delete' : 'Terminate'}">
                        <i data-lucide="${isTrashed ? 'user-minus' : 'trash-2'}" size="14"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;}).join('');

    if (window.lucide) lucide.createIcons();
}

function setupEventListeners() {
    // Dashboard Customization
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

        if (nameField) nameField.addEventListener('input', generatePassword);
        
        if (deptField) {
            ['change', 'input', 'click'].forEach(evt => {
                deptField.addEventListener(evt, generatePassword);
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
window.openEditModal = (id) => {
    const emp = state.employees.find(e => (e.uid === id || e.employeeId === id || e.managerId === id));
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
        form.name.value = emp.name || '';
        form.email.value = emp.email || '';
        form.departmentId.value = emp.departmentId || '';
        form.roleType.value = emp.role || 'employee';
        form.phone.value = emp.phone || '';
        form.salary.value = emp.salary || '';
        form.address.value = emp.address || '';
        form.password.value = emp.tempPassword || '';
        
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
    if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
        // Force refresh of layout to ensure backdrop-filter is cleared
        document.body.style.overflow = 'auto';
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
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Engineering', 'Marketing', 'Sales', 'Finance', 'HR', 'Operations'],
            datasets: [{
                label: 'Efficiency %',
                data: [92, 85, 78, 94, 88, 90],
                backgroundColor: 'rgba(37, 99, 235, 0.7)',
                borderRadius: 8
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

function renderPerformanceTrendsChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
            datasets: [{
                label: 'Avg. Performance Score',
                data: [82, 84, 81, 88, 90, 93],
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderFocusChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Deep Work', 'Task Completion', 'App Focus', 'Consistency', 'Flow State'],
            datasets: [{
                label: 'Focus Consistency',
                data: [85, 90, 75, 88, 82],
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(6, 182, 212, 0.2)'
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderPayrollImpactChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Base Salary', 'Performance Bonuses', 'Productivity Penalties'],
            datasets: [{
                data: [85, 10, 5],
                backgroundColor: ['#2563eb', '#10b981', '#ef4444'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
}

function renderSalaryDistChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['₹0-25k', '₹25k-50k', '₹50k-75k', '₹75k-100k', '₹100k+'],
            datasets: [{
                label: 'Employees',
                data: [12, 45, 30, 15, 5],
                backgroundColor: 'rgba(14, 165, 233, 0.7)',
                borderRadius: 4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderDistractionTrendsChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            datasets: [{
                label: 'Distraction Events',
                data: [45, 32, 58, 24, 38],
                borderColor: '#ef4444',
                tension: 0.3
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
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

// --- TVC AI/ML Python Connectivity Simulation ---
let adminTimerInterval;
let adminStartTime;

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
        tvcText.textContent = "TVC: CONNECTING...";
        tvcDot.style.background = "#3b82f6";
        
        setTimeout(() => {
            tvcText.textContent = "TVC: SECURE";
            tvcDot.style.background = "#10b981";
            tvcDot.style.boxShadow = "0 0 10px #10b981";
            
            // Start Timer
            adminStartTime = Date.now();
            timerDisplay.style.display = 'inline';
            startAdminTimer();

            showSuccess('Security Link Established', 'Total Visibility Control is now active for this administrative session.', {
                "Mode": "Standard / Encrypted",
                "Status": "Active"
            });
        }, 1500);

        // 3. UI Updates
        btnIn.style.display = 'none';
        btnBreak.style.display = 'flex';
        btnOut.style.display = 'flex';
        
    } catch (err) {
        console.error('Punch In Error:', err);
    }
};

function startAdminTimer() {
    const timerDisplay = document.getElementById('adminSessionTimer');
    clearInterval(adminTimerInterval);
    adminTimerInterval = setInterval(() => {
        const diff = Date.now() - adminStartTime;
        const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        timerDisplay.textContent = `${h}:${m}:${s}`;
    }, 1000);
}

window.adminBreak = () => {
    const btnBreak = document.getElementById('btnBreak');
    const tvcDot = document.getElementById('tvcDot');
    const tvcText = document.getElementById('tvcStatusText');

    if (btnBreak.textContent.includes('Break')) {
        // Start Break
        if (window.setTrackerOverride) window.setTrackerOverride('Break');
        clearInterval(adminTimerInterval);
        btnBreak.innerHTML = '<i data-lucide="play" size="16"></i> Resume';
        btnBreak.style.background = "#3b82f6";
        tvcText.textContent = "SECURE: PAUSED";
        tvcDot.style.background = "#f59e0b";
        showSuccess('Status: On Break', 'Productivity tracking has been paused.', {});
    } else {
        // Resume
        if (window.setTrackerOverride) window.setTrackerOverride('Active');
        // Adjust start time to "skip" the break duration
        // Simplified for demo: just restart from where it was or continue
        startAdminTimer();
        btnBreak.innerHTML = '<i data-lucide="coffee" size="16"></i> Break';
        btnBreak.style.background = "#f59e0b";
        tvcText.textContent = "TVC: SECURE";
        tvcDot.style.background = "#10b981";
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

    // 2. Disconnect TVC
    tvcText.textContent = "SECURE: IDLE";
    tvcDot.style.background = "#cbd5e1";
    tvcDot.style.boxShadow = "none";
    timerDisplay.style.display = 'none';

    // 3. UI Reset
    btnIn.style.display = 'flex';
    btnBreak.style.display = 'none';
    btnOut.style.display = 'none';
    btnBreak.innerHTML = '<i data-lucide="coffee" size="16"></i> Break';
    btnBreak.style.background = "#f59e0b";

    showSuccess('Punch Out Successful', 'Session ended safely.', {});
    if (window.lucide) lucide.createIcons();
};
