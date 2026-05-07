/**
 * Employee TVC Common Module
 * Shared UI rendering, payroll calculations, chart management,
 * and warning overlay for all 6 department employee TVC dashboards.
 */

import { on, writeSession, writeActivity } from './employee-tvc-realtime.js';
import { generateInsight, getFocusStatus, getSalaryVerdict } from './employee-tvc-ai.js';

// ── Payroll Config ─────────────────────────────────────
const PAY = { FREE: 3, PEN_RATE: 0.01, MAX_PEN: 0.20, BONUS_RATE: 0.005, BONUS_THRESH: 80, MAX_BONUS: 0.15 };

// ── State ──────────────────────────────────────────────
let trendChart = null;
let userData = { name: '', dept: '', role: '' };
let latestSession = {};
let latestActivity = {};

// ── Clock ──────────────────────────────────────────────
function startClock() {
    const el = document.getElementById('etvcClock');
    if (!el) return;
    setInterval(() => { el.textContent = new Date().toLocaleTimeString('en-US', { hour12: false }); }, 1000);
}

// ── Payroll Calc ───────────────────────────────────────
function calcPayroll(base, score, switches) {
    const excess = Math.max(0, switches - PAY.FREE);
    const penalty = Math.min(excess * PAY.PEN_RATE, PAY.MAX_PEN);
    let bonus = 0;
    if (score > PAY.BONUS_THRESH) {
        bonus = Math.min((score - PAY.BONUS_THRESH) * PAY.BONUS_RATE, PAY.MAX_BONUS);
    }
    return { penalty, bonus, final: base * (1 - penalty + bonus), impact: base * (-penalty + bonus) };
}

// ── UI Updates ─────────────────────────────────────────
function updateUI(session, activity) {
    const s = session || {};
    const a = activity || {};
    const score = s.productivityScore ?? 0;
    const switches = s.focusLossCount ?? a.tabSwitchCount ?? 0;
    const activeMin = Math.round((s.activeTime || 0) / 60000);
    const idleMin = Math.round((s.idleTime || 0) / 60000);
    const breakMin = Math.round((s.breakDuration || 0) / 60000);
    const sessionMin = Math.round(((s.activeTime || 0) + (s.idleTime || 0) + (s.breakDuration || 0)) / 60000);
    const base = parseFloat(s.baseSalary || 50000);
    const pay = calcPayroll(base, score, switches);
    const status = a.status || s.status || 'Offline';
    const focus = getFocusStatus(score, switches);
    const ai = generateInsight({ score, switches, activeMin, idleMin, breakMin, sessionMin, penalty: pay.penalty, bonus: pay.bonus });
    const verdict = getSalaryVerdict(pay.penalty, pay.bonus);

    // Helper
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
    const setColor = (id, c) => { const el = document.getElementById(id); if (el) el.style.color = c; };

    // Header
    set('etvcUserName', userData.name || s.userName || 'Employee');
    set('etvcUserDept', (userData.dept || s.departmentId || '').toUpperCase());
    set('etvcStatus', status);
    const statusDot = document.getElementById('etvcStatusDot');
    if (statusDot) {
        const sc = status === 'Active' ? '#10b981' : status === 'Idle' ? '#f59e0b' : status === 'Away' ? '#ef4444' : '#94a3b8';
        statusDot.style.background = sc;
        statusDot.style.boxShadow = `0 0 8px ${sc}`;
    }

    // Work Monitoring
    set('etvcActiveTime', activeMin + 'm');
    set('etvcIdleTime', idleMin + 'm');
    set('etvcBreakTime', breakMin + 'm');
    set('etvcSessionTime', sessionMin + 'm');

    // Active time progress bar
    const totalMin = activeMin + idleMin + breakMin;
    const pctActive = totalMin > 0 ? Math.round((activeMin / totalMin) * 100) : 0;
    const bar = document.getElementById('etvcActiveBar');
    if (bar) bar.style.width = pctActive + '%';
    set('etvcActivePct', pctActive + '%');

    // Focus Monitoring
    set('etvcFocusStatus', focus.status);
    setColor('etvcFocusStatus', focus.color);
    set('etvcSwitchCount', switches);
    set('etvcWarningLvl', s.warningLevel ?? 0);
    setColor('etvcSwitchCount', switches > 3 ? '#ef4444' : switches > 1 ? '#f59e0b' : '#10b981');

    // Productivity Score
    set('etvcScore', score);
    setColor('etvcScore', score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444');
    const ring = document.getElementById('etvcScoreRing');
    if (ring) {
        const deg = (score / 100) * 360;
        const c = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
        ring.style.background = `conic-gradient(${c} ${deg}deg, #e2e8f0 ${deg}deg)`;
    }

    // Salary Impact
    set('etvcBaseSalary', '₹' + Math.round(base).toLocaleString());
    set('etvcPenalty', (pay.penalty * 100).toFixed(1) + '%');
    setColor('etvcPenalty', pay.penalty > 0 ? '#ef4444' : '#10b981');
    set('etvcBonus', (pay.bonus * 100).toFixed(1) + '%');
    setColor('etvcBonus', pay.bonus > 0 ? '#10b981' : '#64748b');
    set('etvcFinalSalary', '₹' + Math.round(pay.final).toLocaleString());
    setColor('etvcFinalSalary', pay.impact >= 0 ? '#10b981' : '#ef4444');
    set('etvcSalaryImpact', (pay.impact >= 0 ? '+' : '') + '₹' + Math.abs(Math.round(pay.impact)).toLocaleString());
    setColor('etvcSalaryImpact', pay.impact >= 0 ? '#10b981' : '#ef4444');
    set('etvcVerdict', verdict.text);
    setColor('etvcVerdict', verdict.color);

    // AI Insight
    set('etvcAiIcon', ai.icon);
    set('etvcAiLabel', ai.label);
    set('etvcAiMsg', ai.msg);
}

// ── Trend Chart ────────────────────────────────────────
function renderTrend(history) {
    const ctx = document.getElementById('etvcTrendChart');
    if (!ctx || typeof Chart === 'undefined') return;

    const labels = history.map(h => { const p = h.date.split('-'); return p[2] + '/' + p[1]; });
    const data = history.map(h => h.productivityScore || 0);

    if (trendChart) { trendChart.destroy(); }

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Productivity',
                data,
                borderColor: '#0ea5e9',
                backgroundColor: 'rgba(14,165,233,0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 3,
                pointBackgroundColor: data.map(v => v >= 80 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444'),
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: ctx => `Score: ${ctx.parsed.y}` }
                }
            },
            scales: {
                y: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,0.04)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

// ── Warning Overlay ────────────────────────────────────
function showWarning(level, count) {
    const overlay = document.getElementById('etvcWarnOverlay');
    if (!overlay) return;

    const configs = {
        1: { icon: '⚡', title: 'Soft Warning', msg: 'You switched away from your work tab. Stay focused!', color: '#f59e0b', border: '#fbbf24' },
        2: { icon: '🔶', title: 'Strong Warning', msg: 'Second tab switch detected. Further switches will affect your productivity score.', color: '#f97316', border: '#fb923c' },
        3: { icon: '🚨', title: 'FINAL WARNING', msg: 'This is your last warning! Any further tab switches WILL result in salary penalties.', color: '#ef4444', border: '#f87171' },
        4: { icon: '💸', title: 'Penalty Active!', msg: `You have ${count - 3} excess tab switches. Your salary is being reduced by ${Math.min((count - 3), 20)}%.`, color: '#dc2626', border: '#ef4444' }
    };
    const c = configs[Math.min(level, 4)] || configs[1];

    document.getElementById('etvcWarnIcon').textContent = c.icon;
    document.getElementById('etvcWarnTitle').textContent = c.title;
    document.getElementById('etvcWarnTitle').style.color = c.color;
    document.getElementById('etvcWarnMsg').textContent = c.msg;
    document.getElementById('etvcWarnMeta').textContent = `Tab switches: ${count} | Level: ${c.title}`;
    overlay.querySelector('.etvc-warn-box').style.borderTop = `6px solid ${c.border}`;

    overlay.style.display = 'flex';
    if (level >= 3) setTimeout(() => { overlay.style.display = 'none'; }, 8000);
}

// ── Tab Switch Detection ───────────────────────────────
let _lastSwitchTs = 0;
let _switchCount = 0;

function initFocusDetection() {
    const handleLoss = () => {
        const now = Date.now();
        if (now - _lastSwitchTs < 5000) return;
        _lastSwitchTs = now;
        _switchCount++;
        if (_switchCount <= 4) showWarning(_switchCount, _switchCount);
        else showWarning(4, _switchCount);
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) handleLoss(); });
    window.addEventListener('blur', handleLoss);
}

// ── Boot ───────────────────────────────────────────────
function boot() {
    startClock();
    initFocusDetection();

    on('auth:ready', d => {
        userData = d;
        document.getElementById('etvcUserName') && (document.getElementById('etvcUserName').textContent = d.name);
        document.getElementById('etvcUserDept') && (document.getElementById('etvcUserDept').textContent = d.dept.toUpperCase());
    });

    on('session:update', s => { latestSession = s; updateUI(latestSession, latestActivity); });
    on('activity:update', a => { latestActivity = a; updateUI(latestSession, latestActivity); });
    on('history:loaded', renderTrend);
}

boot();

export { updateUI, renderTrend, showWarning, calcPayroll };
