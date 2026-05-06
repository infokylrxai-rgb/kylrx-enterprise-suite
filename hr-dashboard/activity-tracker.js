import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

let trackingActive = false;
let status = 'Offline'; // Active, Idle, Away, Break, Offline
let lastActivity = Date.now();
let tabSwitchCount = 0;
let activeTime = 0;
let idleTime = 0;
let intervalId = null;
let userId = null;

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const INACTIVE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const UPDATE_INTERVAL = 30 * 1000; // Update Firestore every 30 seconds to batch metrics

function initTracker(user) {
    if (trackingActive) return;
    trackingActive = true;
    userId = user.uid;
    
    // Retrieve metadata from local storage
    const name = localStorage.getItem('userName') || user.displayName || user.email || 'Unknown User';
    const role = localStorage.getItem('userRole') || 'employee';
    const dept = localStorage.getItem('userDept') || 'General';

    // Ensure we start with Active
    status = 'Active';
    lastActivity = Date.now();

    // Event listeners for activity
    const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    activityEvents.forEach(evt => {
        window.addEventListener(evt, handleActivity, { passive: true });
    });

    // Tab switching detection
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            tabSwitchCount++;
            // If the tab is hidden, we assume the user might be on another site/social media
            setStatus('Away');
            updateFirestoreNow();
        } else {
            handleActivity();
        }
    });

    window.addEventListener('blur', () => {
        if (status !== 'Away') {
            setStatus('Away');
            updateFirestoreNow();
        }
    });

    window.addEventListener('focus', handleActivity);

    // Initial save
    updateFirestoreNow();

    // Set interval to check idle timeouts and update metrics
    intervalId = setInterval(checkAndSync, UPDATE_INTERVAL);
    
    // Handle window closing
    window.addEventListener('beforeunload', () => {
        setStatus('Offline');
        updateFirestoreNow(true); // synchronous if possible, but async here is best effort
    });
}

let overrideStatus = null;

function handleActivity() {
    if (overrideStatus) return; // Don't interrupt manual overrides
    if (status === 'Break') return; 
    lastActivity = Date.now();
    if (status !== 'Active') {
        setStatus('Active');
        updateFirestoreNow();
    }
}

function setStatus(newStatus) {
    if (overrideStatus && newStatus !== 'Offline') return; // Explicit override overrides everything except closing tab
    if (status === 'Break' && newStatus !== 'Offline') return;
    if (status !== newStatus) {
        status = newStatus;
    }
}

function checkAndSync() {
    if (status === 'Offline') return;
    
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivity;

    if (!overrideStatus && status !== 'Away' && status !== 'Break') {
        if (timeSinceLastActivity > INACTIVE_TIMEOUT) {
            setStatus('Offline');
        } else if (timeSinceLastActivity > IDLE_TIMEOUT) {
            setStatus('Idle');
        }
    }

    // Accumulate time based on status
    if (status === 'Active') {
        activeTime += UPDATE_INTERVAL;
    } else if (status === 'Idle' || status === 'Away') {
        idleTime += UPDATE_INTERVAL;
    }

    updateFirestoreNow();
}

async function updateFirestoreNow(isUnloading = false) {
    if (!userId) return;
    
    const name = localStorage.getItem('userName') || 'User';
    const role = localStorage.getItem('userRole') || 'employee';
    const dept = localStorage.getItem('userDept') || 'General';

    const docRef = doc(db, 'activityStatus', userId);
    
    const data = {
        userId,
        name,
        role,
        departmentId: dept,
        status,
        lastActivity: new Date(lastActivity),
        lastSeen: serverTimestamp(),
        tabSwitchCount,
        activeTime,
        idleTime
    };

    try {
        await setDoc(docRef, data, { merge: true });
    } catch (e) {
        if (e.code === 'permission-denied') {
            console.warn("Activity tracker: Permission denied. Ensure your Firestore rules allow writing to 'activityStatus'.");
        } else {
            console.error("Error updating activity tracker:", e);
        }
    }
}

// Global method to set status manually
window.setTrackerOverride = function(newStatus) {
    if (newStatus === 'Active') {
        overrideStatus = null;
        status = 'Active';
        handleActivity();
    } else {
        overrideStatus = newStatus;
        status = newStatus;
        updateFirestoreNow();
    }
}

// Global method for legacy compatibility
window.setTrackerBreak = function(isBreak) {
    if (isBreak) {
        window.setTrackerOverride('Break');
    } else {
        window.setTrackerOverride('Active');
    }
}

// Start tracking once authenticated
onAuthStateChanged(auth, (user) => {
    if (user) {
        initTracker(user);
    } else {
        if (intervalId) clearInterval(intervalId);
        trackingActive = false;
        userId = null;
    }
});

