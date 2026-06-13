import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp, addDoc, orderBy, limit, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Configuration (will be fetched dynamically from Firestore)
let THRESHOLD_SUSPEND_HOURS = 3;
let THRESHOLD_TRASH_DAYS = 3;
let autoEmailReminders = true;
let managerEscalations = true;

document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) lucide.createIcons();
    startMonitor();
    
    document.getElementById('runSimulation')?.addEventListener('click', runManualSync);
    document.getElementById('filterAll')?.addEventListener('click', () => refreshDashboard('all'));
    document.getElementById('filterSuspended')?.addEventListener('click', () => refreshDashboard('suspended'));
});

async function startMonitor() {
    console.log("[INACTIVITY] Monitoring engine active...");
    await loadAutomationRules();
    await refreshDashboard();
    await loadLiveLogs();
    setupRulesModal();
}

async function refreshDashboard(filter = 'all') {
    // Fetch stats
    const usersRef = collection(db, 'users');
    
    const pendingSnap = await getDocs(query(usersRef, where('onboardingStatus', 'in', ['Pending', 'Invitation Sent'])));
    const suspendedSnap = await getDocs(query(usersRef, where('onboardingStatus', '==', 'Suspended')));
    const trashSnap = await getDocs(query(usersRef, where('onboardingStatus', '==', 'Trash')));

    document.getElementById('countPending').textContent = pendingSnap.size;
    document.getElementById('countSuspended').textContent = suspendedSnap.size;
    document.getElementById('countTrash').textContent = trashSnap.size;

    const allActive = [...pendingSnap.docs, ...suspendedSnap.docs];
    const filtered = filter === 'suspended' ? suspendedSnap.docs : allActive;

    renderInactivityList(filtered);
    renderTrashTable(trashSnap);
    renderLogs(`Dashboard refreshed. Filter: ${filter}. Monitoring ${allActive.length} pipelines.`);
}

function renderInactivityList(docs) {
    const container = document.getElementById('inactivityList');
    if (!container) return;
    container.innerHTML = '';

    if (docs.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">No critical inactivity detected.</div>';
        return;
    }

    docs.forEach(docSnap => {
        const data = docSnap.data();
        const inviteDate = data.invitationSentAt?.toDate() || new Date();
        const diffHours = (new Date() - inviteDate) / (1000 * 60 * 60);
        
        const card = document.createElement('div');
        card.className = 'profile-card';
        card.innerHTML = `
            <div class="profile-header">
                <div class="profile-avatar">${data.name?.charAt(0) || 'U'}</div>
                <span class="timer-badge" style="${data.onboardingStatus === 'Suspended' ? '' : 'background: #fff7ed; color: #f97316;'}">
                    <i data-lucide="${data.onboardingStatus === 'Suspended' ? 'clock' : 'alert-triangle'}"></i> 
                    ${Math.floor(diffHours)}h Overdue
                </span>
            </div>
            <h4 style="font-weight: 800; margin-bottom: 4px;">${data.name || 'Anonymous'}</h4>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">${data.email || 'No email'} • ${data.department || 'General'}</p>
            
            <div style="background: #f8fafc; padding: 10px; border-radius: 12px; font-size: 0.75rem;">
                <p><strong>Status:</strong> <span style="color: ${data.onboardingStatus === 'Suspended' ? 'var(--danger)' : 'var(--warning)'}; font-weight: 700;">${data.onboardingStatus}</span></p>
                <p><strong>Last Action:</strong> Invitation Sent (${inviteDate.toLocaleDateString()})</p>
            </div>

            <div class="action-btns">
                <button class="btn btn-outline" style="font-size: 0.75rem;">Contact Dept</button>
                <button class="btn btn-primary" style="font-size: 0.75rem;">Force Active</button>
            </div>
        `;
        container.appendChild(card);
    });
    if (window.lucide) lucide.createIcons();
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

    if (snap.empty) {
        container.innerHTML += `<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-muted);">Trash bin is currently empty.</td></tr>`;
    }
}

async function emptyTrash() {
    if (!confirm("Are you sure you want to permanently delete all candidates in the trash? This action cannot be undone.")) return;
    
    showToast("Purging trash bin...");
    try {
        const q = query(collection(db, 'users'), where('onboardingStatus', '==', 'Trash'));
        const snap = await getDocs(q);
        
        const deletePromises = snap.docs.map(userDoc => updateDoc(doc(db, 'users', userDoc.id), {
            onboardingStatus: 'Deleted',
            deletedAt: serverTimestamp()
        }));
        
        await Promise.all(deletePromises);
        showToast(`Successfully purged ${snap.size} profiles.`);
        await refreshDashboard();
    } catch (err) {
        console.error("Empty trash failed:", err);
        showToast("Purge failed: " + err.message, true);
    }
}

// Global handlers for HTML integration
window.restoreUserHandler = restoreUser;
window.emptyTrashHandler = emptyTrash;

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

async function loadLiveLogs() {
    const container = document.getElementById('automationLogs');
    if (!container) return;
    
    try {
        const q = query(collection(db, 'automation_logs'), orderBy('timestamp', 'desc'), limit(10));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            container.innerHTML = '';
            snap.forEach(doc => {
                const data = doc.data();
                const time = data.timestamp?.toDate().toLocaleTimeString() || '--:--';
                const entry = document.createElement('div');
                entry.className = 'log-entry';
                entry.innerHTML = `<span class="log-timestamp">[${time}]</span> <span class="log-action">${data.action}</span>: ${data.details}`;
                container.appendChild(entry);
            });
        }
    } catch (err) {
        console.error("Failed to load logs:", err);
    }
}

function renderLogs(msg) {
    const container = document.getElementById('automationLogs');
    if (!container) return;
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.style.borderLeft = '2px solid var(--primary)';
    entry.innerHTML = `<span class="log-timestamp">[${time}]</span> ${msg}`;
    container.prepend(entry);
}

async function loadAutomationRules() {
    try {
        const docRef = doc(db, 'system_configs', 'inactivity_rules');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            const data = snap.data();
            THRESHOLD_SUSPEND_HOURS = Number(data.thresholdSuspendHours) || 3;
            THRESHOLD_TRASH_DAYS = Number(data.thresholdTrashDays) || 3;
            autoEmailReminders = data.emailReminders !== false;
            managerEscalations = data.escalations !== false;
            console.log(`[INACTIVITY] Rules loaded: Suspend = ${THRESHOLD_SUSPEND_HOURS}h, Trash = ${THRESHOLD_TRASH_DAYS}d`);
        } else {
            await setDoc(docRef, {
                thresholdSuspendHours: 3,
                thresholdTrashDays: 3,
                emailReminders: true,
                escalations: true,
                updatedAt: serverTimestamp()
            });
            console.log("[INACTIVITY] Default rules seeded in Firestore system_configs.");
        }
        
        const hoursInput = document.getElementById('ruleSuspendHours');
        const daysInput = document.getElementById('ruleTrashDays');
        const emailCheck = document.getElementById('ruleEmailReminders');
        const escCheck = document.getElementById('ruleEscalations');
        
        if (hoursInput) hoursInput.value = THRESHOLD_SUSPEND_HOURS;
        if (daysInput) daysInput.value = THRESHOLD_TRASH_DAYS;
        if (emailCheck) emailCheck.checked = autoEmailReminders;
        if (escCheck) escCheck.checked = managerEscalations;

        const cardWarning = document.querySelector('.tvc-card.danger p.tvc-trend');
        const cardTrash = document.querySelector('.tvc-card:nth-child(3) p.tvc-label');
        if (cardWarning) cardWarning.innerHTML = `<i data-lucide="clock"></i> ${THRESHOLD_SUSPEND_HOURS}hr Threshold Hit`;
        if (cardTrash) cardTrash.textContent = `In Trash (${THRESHOLD_TRASH_DAYS}-Day Limit)`;
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error("Failed to load automation rules:", err);
    }
}

function setupRulesModal() {
    const modal = document.getElementById('automationRulesModal');
    const btnOpen = document.getElementById('btnOpenRules');
    const btnClose = document.getElementById('btnCloseRulesModal');
    const btnCancel = document.getElementById('btnCancelRules');
    const btnSave = document.getElementById('btnSaveRules');

    if (!modal) return;

    btnOpen?.addEventListener('click', () => {
        document.getElementById('ruleSuspendHours').value = THRESHOLD_SUSPEND_HOURS;
        document.getElementById('ruleTrashDays').value = THRESHOLD_TRASH_DAYS;
        document.getElementById('ruleEmailReminders').checked = autoEmailReminders;
        document.getElementById('ruleEscalations').checked = managerEscalations;

        modal.style.display = 'flex';
        setTimeout(() => modal.style.opacity = '1', 10);
    });

    const closeModal = () => {
        modal.style.opacity = '0';
        setTimeout(() => modal.style.display = 'none', 300);
    };

    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    btnSave?.addEventListener('click', async () => {
        btnSave.disabled = true;
        const oldLabel = btnSave.innerHTML;
        btnSave.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Saving...';
        if (window.lucide) lucide.createIcons();

        const newHours = Number(document.getElementById('ruleSuspendHours').value) || 3;
        const newDays = Number(document.getElementById('ruleTrashDays').value) || 3;
        const newEmail = document.getElementById('ruleEmailReminders').checked;
        const newEsc = document.getElementById('ruleEscalations').checked;

        try {
            const docRef = doc(db, 'system_configs', 'inactivity_rules');
            await setDoc(docRef, {
                thresholdSuspendHours: newHours,
                thresholdTrashDays: newDays,
                emailReminders: newEmail,
                escalations: newEsc,
                updatedAt: serverTimestamp()
            }, { merge: true });

            THRESHOLD_SUSPEND_HOURS = newHours;
            THRESHOLD_TRASH_DAYS = newDays;
            autoEmailReminders = newEmail;
            managerEscalations = newEsc;

            await logAutomationEvent('RULE_UPDATE', 'system', `Updated rules: Suspend = ${newHours}h, Trash = ${newDays}d`);
            showToast("Automation rules updated successfully.");
            closeModal();
            await refreshDashboard();
            await loadLiveLogs();
            
            // Re-render UI indicators to reflect updated values
            const cardWarning = document.querySelector('.tvc-card.danger p.tvc-trend');
            const cardTrash = document.querySelector('.tvc-card:nth-child(3) p.tvc-label');
            if (cardWarning) cardWarning.innerHTML = `<i data-lucide="clock"></i> ${THRESHOLD_SUSPEND_HOURS}hr Threshold Hit`;
            if (cardTrash) cardTrash.textContent = `In Trash (${THRESHOLD_TRASH_DAYS}-Day Limit)`;
            if (window.lucide) lucide.createIcons();
        } catch (err) {
            console.error("Save rules failed:", err);
            showToast("Failed to save rules: " + err.message, true);
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = oldLabel;
            if (window.lucide) lucide.createIcons();
        }
    });
}
