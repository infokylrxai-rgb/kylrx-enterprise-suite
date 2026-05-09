import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Configuration
const THRESHOLD_SUSPEND_HOURS = 3;
const THRESHOLD_TRASH_DAYS = 3;

document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) lucide.createIcons();
    startMonitor();
    
    document.getElementById('runSimulation')?.addEventListener('click', runManualSync);
});

async function startMonitor() {
    console.log("[INACTIVITY] Monitoring engine active...");
    await refreshDashboard();
}

async function refreshDashboard() {
    // Fetch stats
    const usersRef = collection(db, 'users');
    
    const pendingSnap = await getDocs(query(usersRef, where('onboardingStatus', 'in', ['Pending', 'Invitation Sent'])));
    const suspendedSnap = await getDocs(query(usersRef, where('onboardingStatus', '==', 'Suspended')));
    const trashSnap = await getDocs(query(usersRef, where('onboardingStatus', '==', 'Trash')));

    document.getElementById('countPending').textContent = pendingSnap.size;
    document.getElementById('countSuspended').textContent = suspendedSnap.size;
    document.getElementById('countTrash').textContent = trashSnap.size;

    renderTrashTable(trashSnap);
    renderLogs(`Dashboard refreshed. Monitoring ${pendingSnap.size} active pipelines.`);
}

async function restoreUser(uid, name) {
    console.log(`Restoring user ${name}...`);
    try {
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, {
            onboardingStatus: 'Pending', // Back to active onboarding
            trashedAt: null,
            retentionExpiry: null,
            restoredAt: serverTimestamp()
        });

        await logAutomationEvent('RESTORED', uid, `Admin restored ${name} from Trash.`);
        renderLogs(`SUCCESS: ${name} has been restored to Pending status.`);
        await refreshDashboard();
    } catch (err) {
        console.error("Restore failed:", err);
    }
}

async function renderTrashTable(snap) {
    const container = document.querySelector('.trash-section tbody') || document.querySelector('.trash-section table');
    if (!container) return;

    // Reset table
    container.innerHTML = `
        <tr style="text-align: left; font-size: 0.75rem; color: var(--text-muted);">
            <th style="padding: 1rem 0;">NAME</th>
            <th style="padding: 1rem 0;">REASON</th>
            <th style="padding: 1rem 0;">REMAINING</th>
            <th style="padding: 1rem 0; text-align: right;">ACTION</th>
        </tr>
    `;

    snap.forEach(docSnap => {
        const data = docSnap.data();
        const expiry = data.retentionExpiry?.toDate() || new Date();
        const daysLeft = Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24));

        const tr = document.createElement('tr');
        tr.style.fontSize = '0.85rem';
        tr.style.borderTop = '1px solid var(--border)';
        tr.innerHTML = `
            <td style="padding: 1rem 0; font-weight: 700;">${data.name || 'Unknown'}</td>
            <td style="padding: 1rem 0;">3-Day Inactivity</td>
            <td style="padding: 1rem 0; color: var(--danger);">${daysLeft} Days</td>
            <td style="padding: 1rem 0; text-align: right;">
                <span class="recover-btn" style="color: var(--primary); font-weight: 700; cursor: pointer; text-decoration: underline;" 
                      onclick="window.restoreUserHandler('${docSnap.id}', '${data.name}')">Restore</span>
            </td>
        `;
        container.appendChild(tr);
    });
}

// Global handlers for HTML integration
window.restoreUserHandler = restoreUser;

async function runManualSync() {
    const btn = document.getElementById('runSimulation');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Syncing...';
    if (window.lucide) lucide.createIcons();

    renderLogs("MANUAL_SYNC: Triggering threshold analysis...");

    try {
        const usersRef = collection(db, 'users');
        const snap = await getDocs(query(usersRef, where('onboardingStatus', 'in', ['Pending', 'Invitation Sent'])));
        
        const now = new Date();
        let suspendedCount = 0;
        let trashedCount = 0;

        for (const userDoc of snap.docs) {
            const userData = userDoc.data();
            const inviteDate = userData.invitationSentAt?.toDate() || new Date();
            const diffHours = (now - inviteDate) / (1000 * 60 * 60);
            const diffDays = diffHours / 24;

            if (diffDays >= THRESHOLD_TRASH_DAYS) {
                await moveUserToTrash(userDoc.id, userData.name);
                trashedCount++;
            } else if (diffHours >= THRESHOLD_SUSPEND_HOURS && userData.onboardingStatus !== 'Suspended') {
                await suspendUser(userDoc.id, userData.name);
                suspendedCount++;
            }
        }

        renderLogs(`SYNC_COMPLETE: ${suspendedCount} Suspended, ${trashedCount} Trashed.`);
        await refreshDashboard();
    } catch (err) {
        console.error("Sync failed:", err);
        renderLogs("ERROR: Automation engine encountered a fault.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="play"></i> Run Sync Now';
        if (window.lucide) lucide.createIcons();
    }
}

async function suspendUser(uid, name) {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
        onboardingStatus: 'Suspended',
        invitationToken: null, // Expire link
        suspendedAt: serverTimestamp(),
        inactivityAlert: true
    });

    await logAutomationEvent('SUSPENDED', uid, `3-hour inactivity limit hit for ${name}`);
    renderLogs(`AUTOMATION: ${name} (ID: ${uid.substring(0,6)}) has been suspended.`);
}

async function moveUserToTrash(uid, name) {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
        onboardingStatus: 'Trash',
        trashedAt: serverTimestamp(),
        retentionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 Days
    });

    await logAutomationEvent('TRASHED', uid, `3-day non-responsive threshold for ${name}`);
    renderLogs(`AUTOMATION: ${name} (ID: ${uid.substring(0,6)}) moved to Candidate Trash.`);
}

async function logAutomationEvent(action, uid, details) {
    await addDoc(collection(db, 'automation_logs'), {
        action,
        targetId: uid,
        details,
        timestamp: serverTimestamp()
    });
}

function renderLogs(msg) {
    const container = document.getElementById('automationLogs');
    if (!container) return;
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-timestamp">[${time}]</span> ${msg}`;
    container.prepend(entry);
}
