/**
 * Employee TVC Real-Time Module
 * Listens to activityStatus & hrms_sessions for the logged-in employee ONLY.
 * Fires callbacks so the UI layer can update without knowing Firebase internals.
 */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
    doc, onSnapshot, setDoc, getDoc, serverTimestamp, collection, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ── State ──────────────────────────────────────────────
const _cbs = {};
let _userId = null;
let _unsubs = [];

function on(evt, fn) { if (!_cbs[evt]) _cbs[evt] = []; _cbs[evt].push(fn); }
function emit(evt, d) { (_cbs[evt] || []).forEach(fn => { try { fn(d); } catch(e){} }); }

// ── Auth Gate ──────────────────────────────────────────
function init() {
    onAuthStateChanged(auth, user => {
        if (user) {
            _userId = user.uid;
            emit('auth:ready', {
                uid: user.uid,
                name: localStorage.getItem('userName') || user.displayName || user.email,
                role: (localStorage.getItem('userRole') || 'employee').toLowerCase(),
                dept: (localStorage.getItem('userDept') || 'general').toLowerCase()
            });
            startListeners();
        } else {
            _unsubs.forEach(u => u());
            _unsubs = [];
            window.location.href = 'employee-login.html';
        }
    });
}

// ── Real-Time Listeners (self-data only) ───────────────
function startListeners() {
    // 1. activityStatus/{uid}
    const actRef = doc(db, 'activityStatus', _userId);
    _unsubs.push(onSnapshot(actRef, snap => {
        if (snap.exists()) emit('activity:update', snap.data());
    }, err => console.warn('activity listener:', err.message)));

    // 2. hrms_sessions/{uid}_{today}
    const dayKey = new Date().toISOString().split('T')[0];
    const sessRef = doc(db, 'hrms_sessions', `${_userId}_${dayKey}`);
    _unsubs.push(onSnapshot(sessRef, snap => {
        if (snap.exists()) emit('session:update', snap.data());
    }, err => console.warn('session listener:', err.message)));

    // 3. Historical sessions (last 7 days for trend)
    const d = new Date();
    const keys = [];
    for (let i = 6; i >= 0; i--) {
        const dd = new Date(d);
        dd.setDate(dd.getDate() - i);
        keys.push(dd.toISOString().split('T')[0]);
    }
    // Fetch once then listen to today
    Promise.all(keys.map(k =>
        getDoc(doc(db, 'hrms_sessions', `${_userId}_${k}`))
            .then(s => s.exists() ? { date: k, ...s.data() } : { date: k, productivityScore: 0 })
            .catch(() => ({ date: k, productivityScore: 0 }))
    )).then(history => {
        emit('history:loaded', history);
    });

    // 4. Alerts for this user
    try {
        const alertQ = query(
            collection(db, 'alertEvents'),
            where('userId', '==', _userId),
            orderBy('timestamp', 'desc'),
            limit(10)
        );
        _unsubs.push(onSnapshot(alertQ, snap => {
            emit('alerts:update', snap.docs.map(d => d.data()));
        }, () => {}));
    } catch(e) {}
}

// ── Write helpers ──────────────────────────────────────
async function writeSession(data) {
    if (!_userId) return;
    const dayKey = new Date().toISOString().split('T')[0];
    try {
        await setDoc(doc(db, 'hrms_sessions', `${_userId}_${dayKey}`), {
            ...data, userId: _userId, date: dayKey, lastUpdate: serverTimestamp()
        }, { merge: true });
    } catch(e) {}
}

async function writeActivity(data) {
    if (!_userId) return;
    try {
        await setDoc(doc(db, 'activityStatus', _userId), {
            ...data, userId: _userId, lastSeen: serverTimestamp()
        }, { merge: true });
    } catch(e) {}
}

// ── Boot ───────────────────────────────────────────────
init();

export { on, emit, writeSession, writeActivity };
