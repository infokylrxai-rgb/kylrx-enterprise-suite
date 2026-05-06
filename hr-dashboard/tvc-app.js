import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { collection, query, where, onSnapshot, setDoc, doc, serverTimestamp, orderBy, limit, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// --- DOM Elements ---
const wfGrid = document.getElementById('wfGrid');
const alertsGrid = document.getElementById('alertsGrid');
const tickerContent = document.getElementById('tickerContent');
const sysClock = document.getElementById('sysClock');
const screenFlash = document.getElementById('screenFlash');
const alertSound = document.getElementById('alertSound');
const deptStatsContainer = document.getElementById('deptStatsContainer');
const aiInsightText = document.getElementById('aiInsightText');

// Views
const views = [
    { id: 'view-workforce', title: '<i data-lucide="users" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> Live Workforce Monitor' },
    { id: 'view-marketing', title: '<i data-lucide="megaphone" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> Marketing Operations' },
    { id: 'view-finance', title: '<i data-lucide="dollar-sign" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> Financial Operations' },
    { id: 'view-alerts', title: '<i data-lucide="alert-triangle" size="16" style="vertical-align:text-bottom;margin-right:6px;"></i> System Alerts Log' }
];
let currentViewIndex = 0;

// State
let allUsersData = [];
let allAlerts = [];
let allCampaigns = [];
let allLeads = [];
let financeData = { payrollTotal: 0, expenseTotal: 0, revenue: 0, budgetLimit: 0, depts: {} };
let currentRole = '';
let currentDept = '';
let processedAlertKeys = new Set(); // To prevent saving duplicate alerts
let chartsInit = false;
let spendChart, trendChart;

// --- Clock ---
setInterval(() => {
    sysClock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

// --- Auth & Init ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentRole = (localStorage.getItem('userRole') || 'employee').toLowerCase();
        currentDept = (localStorage.getItem('userDept') || '').toLowerCase();
        
        // Employees are now allowed to access the TVC Dashboard
        initRealtimeListeners();
        startAutoRotate();
        initMockFinanceData(); // Ensure collection exists for demo
    } else {
        window.location.href = 'index.html';
    }
});

function initRealtimeListeners() {
    const activityRef = collection(db, 'activityStatus');
    const alertsRef = collection(db, 'alertEvents');
    const financeRef = collection(db, 'financeMetrics');
    const campaignsRef = collection(db, 'campaigns');
    const leadsRef = collection(db, 'leads');

    let qActivity, qAlerts, qFinance;

    if (currentRole === 'admin') {
        qActivity = query(activityRef);
        qAlerts = query(alertsRef, limit(50));
        qFinance = query(financeRef);
    } else {
        if (!currentDept) currentDept = 'engineering';
        qActivity = query(activityRef, where('departmentId', '==', currentDept));
        qAlerts = query(alertsRef, where('departmentId', '==', currentDept), limit(50));
        qFinance = query(financeRef, where('departmentId', '==', currentDept));
    }

    // 1. Listen to Activity
    onSnapshot(qActivity, (snapshot) => {
        allUsersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderWorkforce();
        evaluateRuleEngine();
        renderDeptStats();
        generateAIInsight();
    });

    // 2. Listen to Alerts
    onSnapshot(qAlerts, (snapshot) => {
        allAlerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAlerts();
        renderTicker();
    });

    // 3. Listen to Finance Metrics (for OPEX, Revenue, Budget)
    onSnapshot(qFinance, (snapshot) => {
        const rawFin = snapshot.docs.map(doc => doc.data());
        financeData.expenseTotal = 0;
        financeData.revenue = 0;
        financeData.budgetLimit = 0;
        financeData.depts = financeData.depts || {};
        
        rawFin.forEach(f => {
            financeData.expenseTotal += parseFloat(f.expenseTotal || 0);
            financeData.revenue += parseFloat(f.revenue || 0);
            financeData.budgetLimit += parseFloat(f.budgetLimit || 0);
            financeData.depts[f.departmentId] = { ...financeData.depts[f.departmentId], ...f };
        });
        renderFinance();
    });

    // 4. Listen to Campaigns
    onSnapshot(campaignsRef, (snapshot) => {
        allCampaigns = snapshot.docs.map(doc => doc.data());
        renderMarketing();
        evaluateMarketingRules();
    });

    // 5. Listen to Leads
    onSnapshot(leadsRef, (snapshot) => {
        allLeads = snapshot.docs.map(doc => doc.data());
        renderMarketing();
    });

    // 6. Listen to Users (to calculate REAL Payroll from salaries)
    onSnapshot(collection(db, 'users'), (snapshot) => {
        const users = snapshot.docs.map(doc => doc.data());
        let totalPayroll = 0;
        
        users.forEach(u => {
            const salary = parseFloat(u.salary || 0);
            totalPayroll += salary;
            
            // Assign to dept for spend chart
            if (u.departmentId) {
                if (!financeData.depts[u.departmentId]) financeData.depts[u.departmentId] = { payrollTotal: 0, expenseTotal: 0 };
                financeData.depts[u.departmentId].payrollTotal = (financeData.depts[u.departmentId].payrollTotal || 0) + (salary / 12); // Monthly payroll
            }
        });
        
        financeData.payrollTotal = totalPayroll / 12; // Monthly view
        renderFinance();
    });
}

// --- Workforce View ---
function renderWorkforce() {
    if (allUsersData.length === 0) {
        wfGrid.innerHTML = '<div style="color:var(--text-muted); font-family:monospace;">No active telemetry data.</div>';
        return;
    }

    wfGrid.innerHTML = allUsersData.map(user => {
        const status = user.status || 'Offline';
        const lastSeenTime = user.lastActivity ? new Date(user.lastActivity.toDate ? user.lastActivity.toDate() : user.lastActivity).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false}) : '--:--';
        
        const activeTime = user.activeTime || 0;
        const idleTime = user.idleTime || 0;
        const totalTime = activeTime + idleTime;
        
        // Prioritize AI ML Score if available
        const prodScore = user.aiProductivityScore !== undefined ? user.aiProductivityScore : (totalTime > 0 ? Math.round((activeTime / totalTime) * 100) : 0);
        const aiLabel = user.aiBehaviorLabel || (status === 'Active' ? 'Focused' : status);
        const isAnomaly = user.isAnomaly === true;
        
        return `
            <div class="wf-card ${isAnomaly ? 'anomaly-pulse' : ''}" data-status="${status}">
                <div class="wf-head">
                    <div>
                        <div class="wf-name">${user.name || 'Unknown'} ${isAnomaly ? '<i data-lucide="zap" size="12" style="color:var(--danger)"></i>' : ''}</div>
                        <div class="wf-role">${aiLabel} // ${user.departmentId}</div>
                    </div>
                    <div class="wf-status-badge">${status}</div>
                </div>
                <div class="wf-metrics">
                    <div><span>LAST_SEEN</span>${lastSeenTime}</div>
                    <div><span>TAB_SWITCH</span>${user.tabSwitchCount || 0}</div>
                    <div><span>PROD_SCORE</span>${prodScore}%</div>
                    <div><span>SESS_TIME</span>${Math.round(totalTime/60000)}m</div>
                </div>
            </div>
        `;
    }).join('');
    if (window.lucide) { lucide.createIcons(); }

// --- Dept Efficiency ---
function renderDeptStats() {
    const depts = {};
    allUsersData.forEach(u => {
        const d = u.departmentId || 'general';
        if (!depts[d]) depts[d] = { active:0, total:0, prodSum:0, users:0 };
        depts[d].total++;
        if (u.status === 'Active') depts[d].active++;
        
        const totT = (u.activeTime||0) + (u.idleTime||0);
        if (totT > 0) {
            depts[d].prodSum += ((u.activeTime||0) / totT);
            depts[d].users++;
        }
    });

    const html = Object.keys(depts).map(d => {
        const data = depts[d];
        const eff = data.users > 0 ? Math.round((data.prodSum / data.users) * 100) : 0;
        return `
            <div class="dept-row">
                <div class="dept-name"><span>${d.toUpperCase()}</span> <span>${eff}% EFF</span></div>
                <div class="prod-bar-bg"><div class="prod-bar-fill" style="width:${eff}%"></div></div>
                <div class="dept-meta">
                    <span>${data.active}/${data.total} ONLINE</span>
                    <span>${data.total > 0 ? Math.round((data.active/data.total)*100) : 0}% ACTIVE RATE</span>
                </div>
            </div>
        `;
    }).join('');

    deptStatsContainer.innerHTML = html || '<div style="color:var(--text-muted); font-size:0.8rem;">No dept data</div>';
}

// --- Rule & Alert Engine (Client-side trigger) ---
function evaluateRuleEngine() {
    allUsersData.forEach(user => {
        if (!user.lastActivity || user.status === 'Offline') return;

        const now = new Date();
        const lastAct = user.lastActivity.toDate ? user.lastActivity.toDate() : new Date(user.lastActivity);
        const diffMins = Math.floor((now - lastAct) / 60000);
        
        let alertType = null;
        let severity = 'info';
        let msg = '';

        if (user.status === 'Idle' && diffMins > 10) {
            alertType = 'idle_warning';
            severity = 'warning';
            msg = `Time anomaly: ${user.name} idle for ${diffMins} minutes.`;
        } else if (user.status === 'Away' && diffMins > 10) {
            alertType = 'away_alert';
            severity = 'critical';
            msg = `Security/Productivity Risk: ${user.name} off-screen > 10 mins.`;
        } else if ((user.tabSwitchCount || 0) > 5) {
            alertType = 'tab_suspicious';
            severity = 'warning';
            msg = `Suspicious Activity: ${user.name} recorded high context switching (${user.tabSwitchCount} tabs).`;
        }

        if (alertType) {
            triggerAlert(user, alertType, severity, msg);
        }
    });

    // Check Dept level multiple idle
    const deptsIdle = {};
    allUsersData.forEach(u => {
        if (u.status === 'Idle' || u.status === 'Away') {
            const d = u.departmentId || 'general';
            deptsIdle[d] = (deptsIdle[d] || 0) + 1;
            if (deptsIdle[d] >= 3) {
                triggerAlert({ departmentId: d }, 'dept_idle_alert', 'warning', `Multiple users inactive in ${d.toUpperCase()}. Possible department blockage.`);
            }
        }
    });
}

async function triggerAlert(context, type, severity, message) {
    // Generate deterministic key to avoid spamming Firestore
    const day = new Date().toISOString().split('T')[0];
    const contextId = context.id || context.departmentId || 'sys';
    const alertId = `${contextId}_${type}_${day}`;

    if (processedAlertKeys.has(alertId)) return;
    processedAlertKeys.add(alertId);

    const alertData = {
        alertId,
        type: 'workforce',
        severity,
        message,
        departmentId: context.departmentId || 'system',
        timestamp: serverTimestamp()
    };

    try {
        await setDoc(doc(db, 'alertEvents', alertId), alertData);
    } catch (e) {
        console.warn("Failed to write alert (permissions or network):", e);
    }

    if (severity === 'critical') {
        flashScreen();
        playAlertSound();
    }
}

function flashScreen() {
    screenFlash.style.display = 'block';
    setTimeout(() => { screenFlash.style.display = 'none'; }, 3000);
}

function playAlertSound() {
    alertSound.play().catch(e => console.log('Audio autoplay prevented by browser.'));
}

// --- Alerts View & Ticker ---
function renderAlerts() {
    if (allAlerts.length === 0) {
        alertsGrid.innerHTML = '<div style="color:var(--text-muted); font-family:monospace;">No system alerts recorded.</div>';
        return;
    }

    alertsGrid.innerHTML = allAlerts.map(al => {
        const time = al.timestamp ? new Date(al.timestamp.toDate ? al.timestamp.toDate() : al.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}) : '--:--:--';
        return `
            <div class="alert-row ${al.severity}">
                <div class="al-time">${time}</div>
                <div class="al-type">[${al.severity}]</div>
                <div class="al-msg">${al.message}</div>
            </div>
        `;
    }).join('');
}

function renderTicker() {
    const recent = allAlerts.slice(0, 10);
    if (recent.length === 0) {
        tickerContent.innerHTML = '<div class="ticker-item info"><i data-lucide="info" size="14"></i> Systems operational. No critical events.</div>';
        if (window.lucide) { lucide.createIcons(); }
        return;
    }

    // Duplicate array to make scrolling seamless
    const tickerItems = [...recent, ...recent].map(al => {
        const icon = al.severity === 'critical' ? 'alert-octagon' : (al.severity === 'warning' ? 'alert-triangle' : 'info');
        return `<div class="ticker-item ${al.severity}"><i data-lucide="${icon}" size="14"></i> [${(al.departmentId||'SYS').toUpperCase()}] ${al.message}</div>`;
    }).join('');

    tickerContent.innerHTML = tickerItems;
    if (window.lucide) { lucide.createIcons(); }

// --- Marketing View ---
function renderMarketing() {
    const list = document.getElementById('mktCampaignsGrid');
    if (!list) return;

    const activeCount = allCampaigns.filter(c => c.status === 'Active').length;
    const leadCount = allLeads.length;
    const convRate = leadCount > 0 ? (allLeads.filter(l => l.status === 'Converted').length / leadCount * 100).toFixed(1) : 0;

    document.getElementById('mktStatCampaigns').textContent = activeCount;
    document.getElementById('mktStatLeads').textContent = leadCount;
    document.getElementById('mktStatConv').textContent = convRate + '%';
    
    // Connect ROI to real finance data if available
    const mktFin = financeData.depts.marketing || {};
    const revenue = mktFin.revenue || 800000;
    const expenses = mktFin.expenseTotal || 150000;
    const roi = expenses > 0 ? Math.round((revenue / expenses) * 100) : 210;
    
    const roiEl = document.getElementById('mktStatROI');
    if (roiEl) roiEl.textContent = roi + '%';

    list.innerHTML = allCampaigns.slice(0, 6).map(c => `
        <div class="fin-card" style="padding:1rem;">
            <div style="font-weight:700; font-size:0.9rem;">${c.name}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${c.platform} // ₹${c.budget}</div>
            <div class="prod-bar-bg" style="margin-top:0.5rem; height:4px;"><div class="prod-bar-fill" style="width:70%"></div></div>
        </div>
    `).join('');
}

function evaluateMarketingRules() {
    allCampaigns.forEach(c => {
        if (c.status === 'Active' && c.budget > 100000) {
            triggerAlert({ id: c.id, departmentId: 'marketing' }, 'budget_high', 'warning', `High budget campaign detected: ${c.name} (₹${c.budget})`);
        }
    });
}

// --- Finance View ---
async function initMockFinanceData() {
    // Only admin can seed
    if (currentRole !== 'admin') return;
    try {
        await setDoc(doc(db, 'financeMetrics', 'engineering'), { departmentId: 'engineering', payrollTotal: 450000, expenseTotal: 25000, revenue: 0, budgetLimit: 500000 });
        await setDoc(doc(db, 'financeMetrics', 'marketing'), { departmentId: 'marketing', payrollTotal: 280000, expenseTotal: 150000, revenue: 800000, budgetLimit: 300000 });
        await setDoc(doc(db, 'financeMetrics', 'sales'), { departmentId: 'sales', payrollTotal: 320000, expenseTotal: 45000, revenue: 1200000, budgetLimit: 400000 });
    } catch(e) {}
}

function renderFinance() {
    const p = financeData.payrollTotal || 0;
    const o = financeData.expenseTotal || 0;
    const r = financeData.revenue || 0;
    const b = financeData.budgetLimit || 1;
    
    document.getElementById('finPayroll').textContent = '$' + (p/1000).toFixed(1) + 'k';
    document.getElementById('finOpex').textContent = '$' + (o/1000).toFixed(1) + 'k';
    document.getElementById('finRev').textContent = '$' + (r/1000).toFixed(1) + 'k';
    
    const burn = Math.round(((p + o) / b) * 100);
    document.getElementById('finBurn').textContent = burn + '%';

    if (burn > 95) triggerAlert({id:'sys'}, 'budget_critical', 'critical', `Finance Alert: Org burn rate critical at ${burn}%.`);

    if (!chartsInit) {
        initCharts();
    } else {
        updateCharts();
    }
}

function initCharts() {
    const ctxS = document.getElementById('spendChart');
    const ctxT = document.getElementById('trendChart');
    if (!ctxS || !ctxT) return;
    
    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Roboto Mono', monospace";
    Chart.defaults.borderColor = 'rgba(0,0,0,0.05)';

    spendChart = new Chart(ctxS, {
        type: 'doughnut',
        data: { labels: ['Engineering', 'Marketing', 'Sales'], datasets: [{ data: [450, 430, 365], backgroundColor: ['#0ea5e9', '#8b5cf6', '#10b981'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } }, cutout: '70%' }
    });

    trendChart = new Chart(ctxT, {
        type: 'line',
        data: {
            labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'Current'],
            datasets: [
                { label: 'Outflow', data: [750, 800, 820, 850, 890, (financeData.payrollTotal+financeData.expenseTotal)/1000 || 905], borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.4 },
                { label: 'Inflow', data: [900, 1100, 1050, 1300, 1250, (financeData.revenue)/1000 || 1400], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
    chartsInit = true;
}

function updateCharts() {
    if(!spendChart || !trendChart) return;
    const depts = Object.keys(financeData.depts);
    spendChart.data.labels = depts;
    spendChart.data.datasets[0].data = depts.map(d => (financeData.depts[d].payrollTotal + financeData.depts[d].expenseTotal)/1000);
    spendChart.update();
}

// --- AI Insights ---
function generateAIInsight() {
    // 1. Fetch AI Insights from Firestore (newly added collection)
    onSnapshot(query(collection(db, 'aiInsights'), orderBy('timestamp', 'desc'), limit(1)), (snapshot) => {
        if (!snapshot.empty) {
            const data = snapshot.docs[0].data();
            aiInsightText.textContent = `[AI ENGINE] ${data.message}`;
            return;
        }

        // Fallback to client-side logic if no ML insights yet
        const act = allUsersData.filter(u => u.status === 'Active').length;
        const tot = allUsersData.length;
        const rate = tot > 0 ? (act/tot) : 0;
        
        let text = "Telemetry stable. Operating within normal parameters.";
        
        if (rate < 0.5 && tot > 0) {
            text = `AI Warning: Operations dropping. Only ${Math.round(rate*100)}% active.`;
        } else if (allAlerts.filter(a => a.severity === 'critical').length > 3) {
            text = `AI Alert: Multiple critical anomalies detected.`;
        }
        
        aiInsightText.textContent = text;
    });
}

// --- Auto Rotation ---
function startAutoRotate() {
    setInterval(() => {
        // Hide current
        document.getElementById(views[currentViewIndex].id).classList.remove('active');
        document.getElementById('dot-' + currentViewIndex).classList.remove('active');
        
        // Next
        currentViewIndex = (currentViewIndex + 1) % views.length;
        
        // Show next
        document.getElementById(views[currentViewIndex].id).classList.add('active');
        document.getElementById('dot-' + currentViewIndex).classList.add('active');
        document.getElementById('centerStageTitle').innerHTML = views[currentViewIndex].title;
        
    }, 15000); // 15 seconds
}

// Fullscreen toggle
document.getElementById('btnFullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
});

// Cloud Sync Button
document.getElementById('btnSyncDatabase')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalContent = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
    
    try {
        // Seed some basic structure if missing
        const departments = [
            { departmentId: 'marketing', departmentName: 'Marketing' },
            { departmentId: 'engineering', departmentName: 'Engineering' },
            { departmentId: 'finance', departmentName: 'Finance' },
            { departmentId: 'hr', departmentName: 'HR' }
        ];
        
        for (const d of departments) {
            await setDoc(doc(db, 'departments', d.departmentId), d, { merge: true });
        }
        
        // Log a system event
        await addDoc(collection(db, 'alertEvents'), {
            type: 'system',
            severity: 'info',
            message: 'Manual Cloud Synchronization executed from TVC Console.',
            departmentId: 'system',
            timestamp: serverTimestamp()
        });
        
        if (window.showToast) window.showToast('Cloud Synced', 'Database connection verified and core data refreshed.', 'success');
        else alert('Cloud Synced: Database connection verified and core data refreshed.');
        
    } catch (err) {
        console.error('Sync Error:', err);
        alert('Sync Failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
});

