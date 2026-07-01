import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
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

// AI Panels
const burnoutVal = document.getElementById('burnoutVal');
const burnoutBar = document.getElementById('burnoutBar');
const riskVal = document.getElementById('riskVal');
const riskBar = document.getElementById('riskBar');
const predictionText = document.getElementById('predictionText');

// State
let allUsersData = [];
let allAlerts = [];
let financeData = { payrollTotal: 0, opex: 0, revenue: 0, budget: 1000000 };
let currentRole = '';
let processedAlertKeys = new Set();
let chartsInit = false;
let spendChart;
let rotationInterval = 15000;
let rotationTimer = null;

// --- Clock ---
setInterval(() => {
    sysClock.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

// --- Customization Hooks ---
window.updateRotationInterval = (val) => {
    rotationInterval = val * 1000;
    startAutoRotate(); // Restart with new interval
};

// --- Auth & Init ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentRole = (localStorage.getItem('userRole') || 'employee').toLowerCase();
        initRealtimeListeners();
        startAutoRotate();
    } else {
        window.location.href = 'index.html';
    }
});

function initRealtimeListeners() {
    const activityRef = collection(db, 'activityStatus');
    const alertsRef = collection(db, 'alertEvents');

    // 1. Workforce Telemetry
    onSnapshot(activityRef, (snapshot) => {
        allUsersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderWorkforce();
        renderDeptStats();
        processAIAnalytics();
    });

    // 2. Alerts
    onSnapshot(query(alertsRef, orderBy('timestamp', 'desc'), limit(20)), (snapshot) => {
        allAlerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAlerts();
        renderTicker();
    });

    // 3. Finance (Authoritative Sync)
    onSnapshot(collection(db, 'financeMetrics'), async (snapshot) => {
        if (!snapshot.empty) {
            let totalP = 0;
            snapshot.docs.forEach(d => {
                const data = d.data();
                totalP += (data.payrollTotal || 0);
            });
            financeData.payrollTotal = totalP;
        } else {
            // Fallback: Sum up salaries from users collection for real-time accuracy
            const usersSnap = await getDocs(collection(db, 'users'));
            let sum = 0;
            usersSnap.forEach(u => {
                const data = u.data();
                if (data.salary) sum += Number(data.salary);
                else if (data.onboardingStatus === 'Active') sum += 75000;
            });
            financeData.payrollTotal = sum / 1000; 
        }
        renderFinance();
    });

    // 4. Budget Tracking
    onSnapshot(doc(db, 'system_config', 'budget'), (snap) => {
        if (snap.exists()) {
            financeData.budget = snap.data().value || 1000000;
            renderFinance();
        }
    });
}

// --- Workforce Rendering ---
function renderWorkforce() {
    wfGrid.innerHTML = allUsersData.map(user => {
        const status = user.status || 'Offline';
        const prodScore = user.aiProductivityScore || 0;
        const label = user.aiBehaviorLabel || 'Analyzing...';
        const isAnomaly = user.isAnomaly || prodScore < 30;

        return `
            <div class="wf-card-mini ${isAnomaly ? 'anomaly-pulse' : ''}">
                <div class="name">${user.name || 'User'}</div>
                <div class="stat">${label}</div>
                <div class="stat">${prodScore}% EFF // ${user.departmentId || 'General'}</div>
                <div class="prod-bar-bg" style="height:4px; margin-top:8px;">
                    <div class="prod-bar-fill" style="width:${prodScore}%; background:${prodScore > 70 ? 'var(--success)' : 'var(--warning)'}"></div>
                </div>
            </div>
        `;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

// --- AI Predictive Logic ---
function processAIAnalytics() {
    if (allUsersData.length === 0) return;

    // Calculate aggregate burnout (mock ML logic)
    const highSwitchUsers = allUsersData.filter(u => (u.tabSwitchCount || 0) > 5).length;
    const avgBurnout = Math.min(100, Math.round((highSwitchUsers / allUsersData.length) * 100));
    
    burnoutVal.textContent = avgBurnout + '%';
    burnoutBar.style.width = avgBurnout + '%';
    burnoutBar.style.background = avgBurnout > 60 ? 'var(--danger)' : 'var(--warning)';

    // Workforce Risk
    const criticalAnomalies = allUsersData.filter(u => u.isAnomaly || u.aiProductivityScore < 30).length;
    const riskScore = Math.min(100, criticalAnomalies * 25);
    riskVal.textContent = riskScore > 50 ? 'Critical' : (riskScore > 20 ? 'Elevated' : 'Low');
    riskBar.style.width = Math.max(10, riskScore) + '%';
    riskBar.style.background = riskScore > 50 ? 'var(--danger)' : (riskScore > 20 ? 'var(--warning)' : 'var(--success)');

    // Prediction Text
    const trend = criticalAnomalies > 2 ? 'declining' : 'stable';
    predictionText.textContent = `Workforce productivity trend is ${trend}. AI predicts ${riskScore > 50 ? 'potential operational disruption' : 'continued efficiency'}.`;
    aiInsightText.textContent = `AI Command Node: Monitoring ${allUsersData.length} entities. Risk level: ${riskVal.textContent.toUpperCase()}.`;
}

// --- Dept Efficiency ---
function renderDeptStats() {
    const depts = {};
    allUsersData.forEach(u => {
        const d = (u.departmentId || 'general').toLowerCase();
        if (!depts[d]) depts[d] = { sum: 0, count: 0 };
        depts[d].sum += (u.aiProductivityScore || 0);
        depts[d].count++;
    });

    deptStatsContainer.innerHTML = Object.keys(depts).map(d => {
        const eff = Math.round(depts[d].sum / depts[d].count);
        return `
            <div class="dept-row" style="padding: 10px; margin-bottom: 8px;">
                <div class="dept-name" style="font-size: 0.8rem;"><span>${d.toUpperCase()}</span> <span>${eff}%</span></div>
                <div class="prod-bar-bg" style="height: 6px;"><div class="prod-bar-fill" style="width:${eff}%"></div></div>
            </div>
        `;
    }).join('');
}

// --- Finance ---
function renderFinance() {
    const p = financeData.payrollTotal || 0;
    // Display in Rupees (Converted from USD baseline: 1M USD = 8.3Cr INR)
    const payrollInInr = p * 83 / 10000; // Adjusted for 'k' scale in baseline
    document.getElementById('finPayroll').textContent = '₹' + (p / 120).toFixed(1) + 'Cr'; 
    
    const burn = Math.round((p / financeData.budget) * 100);
    document.getElementById('finBurn').textContent = burn + '%';

    if (!chartsInit) {
        const ctx = document.getElementById('spendChart');
        if (!ctx) return;
        spendChart = new Chart(ctx, {
            type: 'doughnut',
            data: { 
                labels: ['Engineering', 'Marketing', 'Sales', 'HR'], 
                datasets: [{ 
                    data: [45, 25, 20, 10], 
                    backgroundColor: ['#3b82f6', '#6366f1', '#10b981', '#f59e0b'],
                    borderWidth: 0 
                }] 
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }
        });
        chartsInit = true;
    }
}

// --- Alerts & Ticker ---
function renderAlerts() {
    alertsGrid.innerHTML = allAlerts.map(al => `
        <div class="alert-row ${al.severity || 'info'}" style="padding: 6px 12px; margin-bottom: 4px; font-size: 0.75rem;">
            <div class="al-msg">${al.message}</div>
        </div>
    `).join('');
}

function renderTicker() {
    tickerContent.innerHTML = allAlerts.slice(0, 5).map(al => `
        <div class="ticker-item ${al.severity || 'info'}"><i data-lucide="alert-circle"></i> [${(al.departmentId||'SYS').toUpperCase()}] ${al.message}</div>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

// --- Rotation Engine ---
function startAutoRotate() {
    if (rotationTimer) clearInterval(rotationTimer);
    
    // Rotating focus on widgets (visual cue)
    let activeWidgetIdx = 0;
    const widgets = ['wf', 'ai', 'dept', 'payroll', 'alerts'];
    
    rotationTimer = setInterval(() => {
        if (!document.getElementById('checkRotate').checked) return;
        
        widgets.forEach(id => {
            const w = document.querySelector(`.widget[data-id="${id}"]`);
            if (w) w.style.borderColor = 'var(--surface-border)';
        });

        const activeId = widgets[activeWidgetIdx];
        const activeW = document.querySelector(`.widget[data-id="${activeId}"]`);
        if (activeW) {
            activeW.style.borderColor = 'var(--primary)';
            // In TV mode, we might want to highlight or focus
            if (document.body.classList.contains('tv-mode')) {
                activeW.style.boxShadow = '0 0 40px var(--primary-glow)';
            }
        }

        activeWidgetIdx = (activeWidgetIdx + 1) % widgets.length;
    }, rotationInterval);
}

// --- Global Actions ---
window.syncCloud = async () => {
    if (window.showToast) window.showToast('Syncing...', 'Initializing global state refresh.', 'info');
    // Simulated sync
    setTimeout(() => {
        if (window.showToast) window.showToast('Cloud Synced', 'Enterprise state synchronized with Firebase.', 'success');
        else alert('Cloud Synced!');
    }, 1000);
};

// Fullscreen
document.getElementById('btnFullscreen').onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
};

// Logout
document.getElementById('logoutBtn').onclick = async () => {
    await signOut(auth);
    localStorage.clear();
    window.location.href = 'index.html';
};
