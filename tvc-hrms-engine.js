/**
 * TVC HRMS Engine v2.0
 * Enterprise-grade HR Management System Engine
 * Features: Auth Tracking, Tab Focus Enforcement, Warning System,
 *           Activity Tracking, AI Productivity Score, Dynamic Payroll
 */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, setDoc, getDoc, getDocs, collection, query, where, serverTimestamp, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ==================== CONFIGURATION ====================
const CONFIG = {
    IDLE_TIMEOUT_MS: 5 * 60 * 1000,
    AUTO_LOGOUT_MS: 30 * 60 * 1000,
    TAB_SWITCH_IGNORE_MS: 5000,
    MAX_PENALTY_RATE: 0.20,
    MAX_BONUS_RATE: 0.15,
    PENALTY_PER_SWITCH: 0.01,
    BONUS_PER_POINT: 0.005,
    BONUS_THRESHOLD: 80,
    FREE_SWITCHES: 3,
    UPDATE_INTERVAL_MS: 30000,
    WARNING_LEVELS: ['soft', 'strong', 'final', 'penalty'],
    // Enterprise Command Center Config
    AI_THRESHOLDS: {
        risk: 40,
        burnout: 70,
        focus_critical: 5
    },
    ML_MODELS: {
        productivity_regression: true,
        behavioral_clustering: true
    }
};

// ==================== STATE ====================
const state = {
    userId: null,
    userName: '',
    userRole: '',
    userDept: '',
    baseSalary: 0,
    loginTime: null,
    status: 'Offline',
    activeTime: 0,
    idleTime: 0,
    breakDuration: 0,
    focusLossCount: 0,
    warningLevel: 0,
    lastActivityTs: Date.now(),
    lastTabSwitchTs: 0,
    isOnBreak: false,
    breakStartTs: 0,
    sessionDuration: 0,
    productivityScore: 0,
    penalty: 0,
    bonus: 0,
    finalSalary: 0,
    dailyResetDate: new Date().toDateString(),
    initialized: false,
    // AI/ML Predictive State
    predictions: {
        productivityTrend: 'stable',
        burnoutProbability: 0,
        performanceRisk: 'low'
    },
    behavioralLabel: 'Standard'
};

let _intervalId = null;
let _idleCheckId = null;
let _listeners = {};

// ==================== EVENT SYSTEM ====================
function on(event, cb) { if (!_listeners[event]) _listeners[event] = []; _listeners[event].push(cb); }
function emit(event, data) { (_listeners[event] || []).forEach(cb => { try { cb(data); } catch(e) {} }); }

// ==================== 1. AUTHENTICATION TRACKING ====================
function initAuth() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            state.userId = user.uid;
            state.userName = localStorage.getItem('userName') || user.displayName || user.email || 'User';
            state.userRole = (localStorage.getItem('userRole') || 'employee').toLowerCase();
            state.userDept = (localStorage.getItem('userDept') || 'general').toLowerCase();
            state.loginTime = Date.now();
            state.status = 'Online';
            state.lastActivityTs = Date.now();

            // Load persisted data
            await loadUserData();
            checkDailyReset();
            startTracking();
            syncToFirestore();
            emit('auth:login', { userId: state.userId, role: state.userRole });
        } else {
            handleLogout();
        }
    });
}

async function loadUserData() {
    try {
        const uDoc = await getDoc(doc(db, 'users', state.userId));
        if (uDoc.exists()) {
            const d = uDoc.data();
            state.baseSalary = parseFloat(d.salary || d.baseSalary || 50000);
        }
        // Load today's session
        const dayKey = new Date().toISOString().split('T')[0];
        const sessDoc = await getDoc(doc(db, 'hrms_sessions', `${state.userId}_${dayKey}`));
        if (sessDoc.exists()) {
            const s = sessDoc.data();
            state.activeTime = s.activeTime || 0;
            state.idleTime = s.idleTime || 0;
            state.breakDuration = s.breakDuration || 0;
            state.focusLossCount = s.focusLossCount || 0;
            state.warningLevel = s.warningLevel || 0;
        }
    } catch (e) { console.warn('HRMS: Load user data fallback', e.message); }
}

function handleLogout() {
    const logoutTime = Date.now();
    state.sessionDuration = state.loginTime ? logoutTime - state.loginTime : 0;
    emit('auth:logout', { sessionDuration: state.sessionDuration });
    if (_intervalId) clearInterval(_intervalId);
    if (_idleCheckId) clearInterval(_idleCheckId);
    state.initialized = false;
}

function forceLogout(reason) {
    emit('system:force_logout', { reason });
    syncToFirestore();
    setTimeout(() => { signOut(auth).then(() => { window.location.href = 'employee-login.html'; }); }, 1500);
}

// ==================== 2. TAB SWITCH DETECTION ====================
function initTabDetection() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { handleFocusLoss(); } else { handleFocusGain(); }
    });
    window.addEventListener('blur', () => { handleFocusLoss(); });
    window.addEventListener('focus', () => { handleFocusGain(); });
}

function handleFocusLoss() {
    const now = Date.now();
    if (now - state.lastTabSwitchTs < CONFIG.TAB_SWITCH_IGNORE_MS) return;
    state.lastTabSwitchTs = now;
    state.focusLossCount++;
    state.status = 'Away';
    processWarning();
    syncToFirestore();
    emit('focus:lost', { count: state.focusLossCount, warningLevel: state.warningLevel });
}

function handleFocusGain() {
    state.lastActivityTs = Date.now();
    if (!state.isOnBreak) state.status = 'Online';
    emit('focus:gained', {});
}

// ==================== 3. WARNING SYSTEM ====================
function processWarning() {
    const count = state.focusLossCount;
    if (count === 1) {
        state.warningLevel = 1;
        emit('warning', { level: 'soft', message: 'You switched away from the work tab. Stay focused!', count });
    } else if (count === 2) {
        state.warningLevel = 2;
        emit('warning', { level: 'strong', message: 'Second tab switch detected. Continued switches will affect your productivity score.', count });
    } else if (count === 3) {
        state.warningLevel = 3;
        emit('warning', { level: 'final', message: 'Final Warning! Further tab switches will result in salary penalties.', count });
    } else if (count > 3) {
        state.warningLevel = 4;
        emit('warning', { level: 'penalty', message: `Penalty active! ${count - CONFIG.FREE_SWITCHES} excess switches recorded. Your salary will be reduced.`, count });
    }
}

function checkDailyReset() {
    const today = new Date().toDateString();
    if (state.dailyResetDate !== today) {
        state.focusLossCount = 0;
        state.warningLevel = 0;
        state.activeTime = 0;
        state.idleTime = 0;
        state.breakDuration = 0;
        state.dailyResetDate = today;
    }
}

// ==================== 4. ACTIVITY TRACKING ====================
function startTracking() {
    if (state.initialized) return;
    state.initialized = true;

    const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    activityEvents.forEach(evt => {
        window.addEventListener(evt, () => {
            state.lastActivityTs = Date.now();
            if (state.status === 'Idle' && !state.isOnBreak) { state.status = 'Online'; }
        }, { passive: true });
    });

    // Time accumulation
    _intervalId = setInterval(() => {
        checkDailyReset();
        if (state.status === 'Active') {
            state.activeTime += CONFIG.UPDATE_INTERVAL_MS;
        } else if (state.status === 'Idle' || state.status === 'Away') {
            state.idleTime += CONFIG.UPDATE_INTERVAL_MS;
        } else if (state.isOnBreak) {
            state.breakDuration += CONFIG.UPDATE_INTERVAL_MS;
        }
        state.sessionDuration = Date.now() - (state.loginTime || Date.now());
        calculateProductivity();
        calculatePayroll();
        syncToFirestore();
        emit('tick', getSnapshot());
    }, CONFIG.UPDATE_INTERVAL_MS);

    // Idle check (every 10s)
    _idleCheckId = setInterval(() => {
        const elapsed = Date.now() - state.lastActivityTs;
        if (elapsed > CONFIG.AUTO_LOGOUT_MS && state.status !== 'Break') {
            forceLogout('Inactivity timeout');
        } else if (elapsed > CONFIG.IDLE_TIMEOUT_MS && state.status === 'Online') {
            state.status = 'Idle';
            emit('status:idle', {});
        }
    }, 10000);

    window.addEventListener('beforeunload', () => { state.status = 'Offline'; syncToFirestore(); });
    initTabDetection();
}

// ==================== 5. AI PRODUCTIVITY SCORE ====================
function calculateProductivity() {
    const totalTime = state.activeTime + state.idleTime + state.breakDuration;
    if (totalTime === 0) { state.productivityScore = 100; return; }

    const activeRatio = state.activeTime / totalTime;
    const idleRatio = state.idleTime / totalTime;
    const breakRatio = state.breakDuration / totalTime;
    const switchPenalty = Math.min(state.focusLossCount * 2, 30);

    let score = 100;
    score *= (0.5 + 0.5 * activeRatio);  // Active time boost
    score -= (idleRatio * 25);            // Idle penalty
    score -= (breakRatio * 10);           // Break slight reduction
    score -= switchPenalty;               // Focus loss penalty

    state.productivityScore = Math.max(0, Math.min(100, Math.round(score)));
    
    // AI ML Behavioral Classification
    if (state.productivityScore > 90 && state.focusLossCount < 2) state.behavioralLabel = 'High Performer';
    else if (state.productivityScore > 75) state.behavioralLabel = 'Focused';
    else if (state.productivityScore > 50) state.behavioralLabel = 'Average';
    else if (state.focusLossCount > 5) state.behavioralLabel = 'Distracted';
    else state.behavioralLabel = 'Needs Attention';

    // Predictive Analytics Mockup
    state.predictions.burnoutProbability = Math.round((state.activeTime / (state.activeTime + state.idleTime + 1)) * (state.focusLossCount > 5 ? 80 : 20));
    state.predictions.performanceRisk = (state.productivityScore < 40 || state.focusLossCount > 8) ? 'High' : 'Low';

    emit('productivity:updated', { 
        score: state.productivityScore, 
        label: state.behavioralLabel,
        predictions: state.predictions
    });
}

// ==================== 6. DYNAMIC PAYROLL ====================
function calculatePayroll() {
    const excessSwitches = Math.max(0, state.focusLossCount - CONFIG.FREE_SWITCHES);
    const rawPenalty = excessSwitches * CONFIG.PENALTY_PER_SWITCH;
    state.penalty = Math.min(rawPenalty, CONFIG.MAX_PENALTY_RATE);

    let rawBonus = 0;
    if (state.productivityScore > CONFIG.BONUS_THRESHOLD) {
        const pointsAbove = state.productivityScore - CONFIG.BONUS_THRESHOLD;
        rawBonus = pointsAbove * CONFIG.BONUS_PER_POINT;
    }
    state.bonus = Math.min(rawBonus, CONFIG.MAX_BONUS_RATE);

    state.finalSalary = state.baseSalary * (1 - state.penalty + state.bonus);
    emit('payroll:updated', { base: state.baseSalary, penalty: state.penalty, bonus: state.bonus, final: state.finalSalary });
}

// ==================== FIRESTORE SYNC ====================
async function syncToFirestore() {
    if (!state.userId) return;
    const dayKey = new Date().toISOString().split('T')[0];
    try {
        await setDoc(doc(db, 'hrms_sessions', `${state.userId}_${dayKey}`), {
            userId: state.userId,
            userName: state.userName,
            role: state.userRole,
            departmentId: state.userDept,
            date: dayKey,
            status: state.status,
            loginTime: state.loginTime,
            activeTime: state.activeTime,
            idleTime: state.idleTime,
            breakDuration: state.breakDuration,
            focusLossCount: state.focusLossCount,
            warningLevel: state.warningLevel,
            productivityScore: state.productivityScore,
            baseSalary: state.baseSalary,
            penalty: state.penalty,
            bonus: state.bonus,
            finalSalary: state.finalSalary,
            lastUpdate: serverTimestamp()
        }, { merge: true });

        // Also update activityStatus for TVC monitor
        await setDoc(doc(db, 'activityStatus', state.userId), {
            userId: state.userId,
            name: state.userName,
            role: state.userRole,
            departmentId: state.userDept,
            status: state.status,
            lastActivity: new Date(state.lastActivityTs),
            lastSeen: serverTimestamp(),
            tabSwitchCount: state.focusLossCount,
            activeTime: state.activeTime,
            idleTime: state.idleTime,
            aiProductivityScore: state.productivityScore,
            aiBehaviorLabel: state.productivityScore > 80 ? 'High Performer' : state.productivityScore > 50 ? 'Focused' : 'Needs Attention',
            isAnomaly: state.focusLossCount > 10 || state.productivityScore < 30
        }, { merge: true });
    } catch (e) { console.warn('HRMS sync error:', e.message); }
}

// ==================== PUBLIC API ====================
function getSnapshot() {
    return { ...state, 
        productivityScore: state.productivityScore,
        activeTimeMin: Math.round(state.activeTime / 60000),
        idleTimeMin: Math.round(state.idleTime / 60000),
        breakTimeMin: Math.round(state.breakDuration / 60000),
        sessionMin: Math.round(state.sessionDuration / 60000),
        penaltyPct: (state.penalty * 100).toFixed(1),
        bonusPct: (state.bonus * 100).toFixed(1),
        salaryImpact: state.finalSalary - state.baseSalary
    };
}

function setBreak(isBreak) {
    state.isOnBreak = isBreak;
    if (isBreak) { state.breakStartTs = Date.now(); state.status = 'Break'; }
    else { state.status = 'Online'; state.lastActivityTs = Date.now(); }
    syncToFirestore();
    emit('break:toggle', { isBreak });
}

function managerOverrideSalary(targetUserId, overrideData) {
    if (state.userRole !== 'manager' && state.userRole !== 'admin') return false;
    return setDoc(doc(db, 'payroll_overrides', targetUserId), {
        ...overrideData, overriddenBy: state.userId, timestamp: serverTimestamp()
    }, { merge: true });
}

async function getTeamData(dept) {
    const dayKey = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'hrms_sessions'), where('departmentId', '==', dept || state.userDept), where('date', '==', dayKey));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getAllSessionsToday() {
    const dayKey = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'hrms_sessions'), where('date', '==', dayKey));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function listenTeamSessions(dept, callback) {
    const dayKey = new Date().toISOString().split('T')[0];
    const q = dept === 'all' 
        ? query(collection(db, 'hrms_sessions'), where('date', '==', dayKey))
        : query(collection(db, 'hrms_sessions'), where('departmentId', '==', dept), where('date', '==', dayKey));
    return onSnapshot(q, (snap) => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

// ==================== INIT ====================
initAuth();

export { on, emit, getSnapshot, setBreak, managerOverrideSalary, getTeamData, getAllSessionsToday, listenTeamSessions, state, CONFIG };
