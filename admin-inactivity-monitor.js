// Sign-in session: adds the login token to this page's /api calls
import "./firebase-config.js";

/**
 * Employee Inactivity Radar.
 *
 * Everything comes from the backend (/api/inactivity), limited to this organization:
 * invited people who have not signed in, their status (Pending / Suspended / Trash), the
 * automation rules and log, and AI risk insights. Changes respond only after Firebase
 * confirmed them; saves are not sent while Firebase refuses writes.
 */

const API = '/api/inactivity';
let overview = null;
let currentFilter = 'all';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const icons = () => { if (window.lucide) lucide.createIcons(); };
const toast = (msg, isError = false) => (window.showToast ? window.showToast(msg, isError) : console.log(msg));

let writeStatusCache = { at: 0, value: null };
async function getWriteStatus() {
    if (writeStatusCache.value && Date.now() - writeStatusCache.at < 60000) return writeStatusCache.value;
    try {
        const json = await (await fetch('/api/firestore/write-status')).json();
        writeStatusCache = { at: Date.now(), value: { accepting: json.accepting !== false, localTestDatabase: json.localTestDatabase === true } };
    } catch (_) {
        writeStatusCache = { at: Date.now(), value: { accepting: true, localTestDatabase: false } };
    }
    return writeStatusCache.value;
}

async function api(path, { method = 'GET', body } = {}) {
    if (method !== 'GET' && !(await getWriteStatus()).accepting) {
        throw new Error('Saving is paused: Firebase is not accepting changes right now (the daily Firestore write quota is used up). Nothing was changed.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
        const res = await fetch(`${API}${path}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) throw new Error(json.message || json.error || `Request failed (HTTP ${res.status})`);
        return json.data;
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('The server did not respond in time. Please try again.');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    icons();
    showSaveNotice();
    refreshDashboard();
    setupRulesModal();
    api('/ai/status').then(d => {
        const el = document.getElementById('aiModeLabel');
        if (el) el.textContent = d.aiConfigured ? '· AI model connected' : '· rule-based (no AI key configured)';
    }).catch(() => {});

    document.getElementById('runSimulation')?.addEventListener('click', runManualSync);
    document.getElementById('filterAll')?.addEventListener('click', () => { currentFilter = 'all'; renderAll(); });
    document.getElementById('filterSuspended')?.addEventListener('click', () => { currentFilter = 'suspended'; renderAll(); });
    setInterval(() => { if (!document.hidden) refreshDashboard(); }, 60000);
});

async function showSaveNotice() {
    const status = await getWriteStatus();
    if (status.accepting && !status.localTestDatabase) return;
    const header = document.querySelector('.main-content > header');
    if (!header || document.getElementById('inactivitySaveNotice')) return;
    const notice = document.createElement('div');
    notice.id = 'inactivitySaveNotice';
    notice.style.cssText = 'margin: 0 0 1.25rem; padding: 12px 16px; border-radius: 12px; font-size: 0.85rem; font-weight: 600;'
        + (status.localTestDatabase ? 'background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;' : 'background:#fffbeb;color:#92400e;border:1px solid #fde68a;');
    notice.textContent = status.localTestDatabase
        ? 'Local test database: changes on this page go to the local copy of your Firebase data, not the live project.'
        : 'Saving is paused: Firebase is not accepting changes right now (the daily Firestore write quota is used up). The radar is read-only until the quota resets.';
    header.after(notice);
}

async function refreshDashboard() {
    try {
        overview = await api('/overview');
        renderAll();
    } catch (err) {
        const list = document.getElementById('inactivityList');
        if (list) list.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #b91c1c;">Could not load the inactivity radar: ${esc(err.message)}</div>`;
    }
}

function fmtWait(hours) {
    if (hours >= 48) return `${Math.floor(hours / 24)}d`;
    if (hours >= 1) return `${Math.floor(hours)}h`;
    return `${Math.max(1, Math.round(hours * 60))}m`;
}

function renderAll() {
    if (!overview) return;
    const { counts, rules, people, logs } = overview;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('countPending', counts.pending);
    set('countSuspended', counts.suspended);
    set('countTrash', counts.trash);
    set('countUndelivered', counts.undelivered);
    set('labelTrash', `In Trash (${rules.thresholdTrashDays}-Day Limit)`);
    set('trashRetentionNote', `Profiles in this bin are purged ${rules.trashRetentionDays} days after they were trashed.`);
    const danger = document.querySelector('.tvc-card.danger p.tvc-trend');
    if (danger) danger.innerHTML = `<i data-lucide="clock"></i> ${esc(rules.thresholdSuspendHours)}hr threshold`;

    const open = people.filter(p => p.status !== 'Trash');
    const high = open.filter(p => p.risk.level === 'high').length;
    set('aiInsightsSummary', open.length ? `${open.length} waiting · ${high} high risk · ${counts.responded} of ${counts.invited} invited have signed in` : `All ${counts.invited} invited people have signed in.`);

    renderInactivityList(currentFilter === 'suspended' ? open.filter(p => p.status === 'Suspended') : open);
    renderTrashTable(people.filter(p => p.status === 'Trash'));
    renderLogs(logs);
    icons();
}

function renderInactivityList(list) {
    const container = document.getElementById('inactivityList');
    if (!container) return;
    if (!list.length) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">${currentFilter === 'suspended' ? 'No suspended profiles.' : 'No critical inactivity detected — everyone invited has signed in.'}</div>`;
        return;
    }
    const riskStyle = { high: 'background:#fef2f2;color:#b91c1c', medium: 'background:#fff7ed;color:#c2410c', low: 'background:#ecfdf5;color:#047857' };
    container.innerHTML = list.map(p => {
        const suspended = p.status === 'Suspended';
        const untilSuspend = Math.max(0, overview.rules.thresholdSuspendHours - p.hoursSinceInvite);
        return `
        <div class="profile-card">
            <div class="profile-header">
                <div class="profile-avatar">${esc(String(p.name || 'U').charAt(0).toUpperCase())}</div>
                <span class="timer-badge" style="${suspended ? '' : 'background: #fff7ed; color: #f97316;'}">
                    <i data-lucide="${suspended ? 'clock' : 'alert-triangle'}"></i> ${esc(fmtWait(p.hoursSinceInvite))} waiting
                </span>
            </div>
            <h4 style="font-weight: 800; margin-bottom: 4px;">${esc(p.name)}</h4>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem;">${esc(p.email || 'No email')} • ${esc(p.department || 'No department')}</p>
            <div style="background: #f8fafc; padding: 10px; border-radius: 12px; font-size: 0.75rem; line-height: 1.6;">
                <p><strong>Status:</strong> <span style="color: ${suspended ? 'var(--danger)' : 'var(--warning)'}; font-weight: 700;">${esc(p.status)}</span>${p.inviteDelivered ? '' : ' · <span style="color:#b91c1c;font-weight:700;">invite not delivered</span>'}</p>
                <p><strong>Invited:</strong> ${esc(new Date(p.invitedAt).toLocaleString())}</p>
                ${!suspended && p.inviteDelivered ? `<p><strong>Auto-suspend:</strong> ${untilSuspend > 0 ? `in ${esc(fmtWait(untilSuspend))}` : 'at next sync'}</p>` : ''}
                ${p.joiningDate ? `<p><strong>Joining:</strong> ${esc(p.joiningDate)}</p>` : ''}
            </div>
            <div style="margin-top: 10px; border: 1px solid #ddd6fe; background: #faf5ff; border-radius: 12px; padding: 8px 10px; font-size: 0.74rem; color: #4c1d95;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <strong>✨ AI risk</strong>
                    <span class="timer-badge" style="${riskStyle[p.risk.level]}; font-size: 0.68rem;">${esc(p.risk.score)} · ${esc(p.risk.level)}</span>
                </div>
                <div><strong>Next:</strong> ${esc(p.risk.action.label)} — ${esc(p.risk.action.detail)}</div>
                ${p.risk.reasons.length ? `<div style="color:#6b21a8;margin-top:3px;">${p.risk.reasons.map(esc).join(' ')}</div>` : ''}
            </div>
            <div class="action-btns" style="flex-wrap: wrap;">
                <button class="btn btn-outline" style="font-size: 0.75rem;" data-act="nudge" data-id="${esc(p.id)}">✨ Nudge</button>
                <button class="btn btn-outline" style="font-size: 0.75rem;" data-act="${p.inviteDelivered ? 'contact' : 'resend'}" data-id="${esc(p.id)}">${p.inviteDelivered ? 'Contact Dept' : 'Resend Invite'}</button>
                <button class="btn btn-primary" style="font-size: 0.75rem;" data-act="active" data-id="${esc(p.id)}">Mark Active</button>
            </div>
        </div>`;
    }).join('');
}

function renderTrashTable(list) {
    const tbody = document.getElementById('trashTableBody');
    if (!tbody) return;
    const head = `<tr style="text-align: left; font-size: 0.75rem; color: var(--text-muted);">
        <th style="padding: 1rem 0;">NAME</th><th style="padding: 1rem 0;">REASON</th><th style="padding: 1rem 0;">REMAINING</th><th style="padding: 1rem 0; text-align: right;">ACTION</th></tr>`;
    if (!list.length) {
        tbody.innerHTML = head + '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-muted);">Trash bin is currently empty.</td></tr>';
        return;
    }
    tbody.innerHTML = head + list.map(p => {
        const daysLeft = p.retentionExpiry ? Math.max(0, Math.ceil((Date.parse(p.retentionExpiry) - Date.now()) / 86400000)) : '—';
        return `<tr style="font-size: 0.85rem; border-top: 1px solid var(--border);">
            <td style="padding: 1rem 0; font-weight: 700;">${esc(p.name)}<div style="font-size:0.72rem;color:var(--text-muted);font-weight:500;">${esc(p.email)}</div></td>
            <td style="padding: 1rem 0;">No sign-in ${esc(fmtWait(p.hoursSinceInvite))} after invite</td>
            <td style="padding: 1rem 0; color: var(--danger);">${esc(daysLeft)} day(s)</td>
            <td style="padding: 1rem 0; text-align: right;"><span class="recover-btn" style="color: var(--primary); font-weight: 700; cursor: pointer; text-decoration: underline;" data-act="restore" data-id="${esc(p.id)}">Restore</span></td>
        </tr>`;
    }).join('');
}

function renderLogs(logs) {
    const container = document.getElementById('automationLogs');
    if (!container) return;
    container.innerHTML = logs.length
        ? logs.map(l => `<div class="log-entry"><span class="log-timestamp">[${esc(new Date(l.timestamp).toLocaleString())}]</span> <span class="log-action">${esc(l.action)}</span>: ${esc(l.details)}${l.by ? ` <span style="color:var(--text-muted);">— ${esc(l.by)}</span>` : ''}</div>`).join('')
        : '<div class="log-entry" style="color: var(--text-muted);">No automation activity yet. Click "Run Sync Now" to apply the rules.</div>';
}

function personOf(id) {
    return (overview && overview.people.find(p => p.id === id)) || { name: id };
}

// Card and trash actions
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    const person = personOf(id);
    if (act === 'nudge') return openNudge(id);
    btn.disabled = true;
    try {
        if (act === 'active') {
            const reason = prompt(`Mark ${person.name} as active (removes them from the radar)?\nReason (e.g. "reached by phone, will sign in today"):`, 'Confirmed by administrator');
            if (reason === null) return;
            await api(`/people/${encodeURIComponent(id)}/mark-active`, { method: 'POST', body: { reason } });
            toast(`${person.name} marked active and saved.`);
        } else if (act === 'contact') {
            const d = await api(`/people/${encodeURIComponent(id)}/contact-dept`, { method: 'POST', body: {} });
            toast(`Notified ${d.notified.join(', ')} about ${person.name}.`);
        } else if (act === 'resend') {
            await api(`/people/${encodeURIComponent(id)}/resend`, { method: 'POST', body: {} });
            toast(`Invitation resent to ${person.name}.`);
        } else if (act === 'restore') {
            await api(`/people/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {} });
            toast(`${person.name} restored; their response window restarts now.`);
        }
        await refreshDashboard();
    } catch (err) {
        toast(err.message, true);
    } finally {
        btn.disabled = false;
    }
});

// AI Nudge window
async function openNudge(id) {
    document.getElementById('aiNudgeModal')?.remove();
    const p = personOf(id);
    const modal = document.createElement('div');
    modal.id = 'aiNudgeModal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.45); backdrop-filter:blur(4px); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px;';
    modal.innerHTML = `
        <div style="background:#fff; border-radius:20px; width:560px; max-width:100%; padding:22px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:#0f172a;">✨ AI reminder for ${esc(p.name)}</h3>
                <button id="nudgeClose" style="background:#f1f5f9; border:none; border-radius:8px; width:30px; height:30px; cursor:pointer;">✕</button>
            </div>
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px; font-size:0.8rem;">
                Tone <select id="nudgeTone" style="padding:6px 8px; border-radius:8px; border:1px solid var(--border);"><option value="friendly">Friendly</option><option value="formal">Formal</option></select>
                <button id="nudgeRegenerate" class="btn btn-outline" style="font-size:0.75rem; padding:6px 10px;">Write again</button>
            </div>
            <input id="nudgeSubject" style="width:100%; padding:9px 11px; border:1px solid var(--border); border-radius:10px; font-size:0.85rem; margin-bottom:8px; box-sizing:border-box;" />
            <textarea id="nudgeBody" rows="8" style="width:100%; padding:10px 11px; border:1px solid var(--border); border-radius:10px; font-size:0.85rem; font-family:inherit; box-sizing:border-box;">Writing…</textarea>
            <div style="font-size:0.75rem; color:var(--text-muted); margin:8px 0;">Send it by WhatsApp, SMS or email${p.phone ? ` (${esc(p.phone)})` : ''}${p.email ? ` · ${esc(p.email)}` : ''}. Nothing is sent automatically.</div>
            <div style="display:flex; gap:8px; justify-content:flex-end;">
                <button id="nudgeCopy" class="btn btn-primary" style="font-size:0.8rem;">Copy message</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', ev => { if (ev.target === modal) close(); });
    modal.querySelector('#nudgeClose').onclick = close;
    const write = async () => {
        modal.querySelector('#nudgeBody').value = 'Writing…';
        try {
            const d = await api(`/ai/nudge/${encodeURIComponent(id)}`, { method: 'POST', body: { tone: modal.querySelector('#nudgeTone').value } });
            modal.querySelector('#nudgeSubject').value = d.subject;
            modal.querySelector('#nudgeBody').value = d.body;
        } catch (err) {
            modal.querySelector('#nudgeBody').value = 'Could not write the reminder: ' + err.message;
        }
    };
    modal.querySelector('#nudgeRegenerate').onclick = write;
    modal.querySelector('#nudgeTone').onchange = write;
    modal.querySelector('#nudgeCopy').onclick = async () => {
        const text = `${modal.querySelector('#nudgeSubject').value}\n\n${modal.querySelector('#nudgeBody').value}`;
        try { await navigator.clipboard.writeText(text); toast('Reminder copied — paste it into WhatsApp, SMS or email.'); } catch (_) { toast('Select the text and copy it manually.', true); }
    };
    write();
}

window.emptyTrashHandler = async function () {
    const inTrash = overview ? overview.people.filter(p => p.status === 'Trash') : [];
    if (!inTrash.length) return toast('Trash bin is already empty.');
    if (!confirm(`Permanently purge ${inTrash.length} profile(s) from the trash? They will no longer appear on this radar.`)) return;
    try {
        const d = await api('/trash/empty', { method: 'POST', body: {} });
        toast(`Purged ${d.purged} profile(s).`);
        await refreshDashboard();
    } catch (err) {
        toast('Purge failed: ' + err.message, true);
    }
};

async function runManualSync() {
    const btn = document.getElementById('runSimulation');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Syncing...';
    icons();
    try {
        const d = await api('/sync', { method: 'POST', body: {} });
        const parts = [`${d.suspended.length} suspended`, `${d.trashed.length} moved to trash`, `${d.purged.length} purged`];
        toast(`Sync complete: ${parts.join(', ')}${d.skippedUndelivered.length ? `; ${d.skippedUndelivered.length} with undelivered invites left for resend` : ''}.`);
        await refreshDashboard();
    } catch (err) {
        toast('Sync failed: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="play"></i> Run Sync Now';
        icons();
    }
}

function setupRulesModal() {
    const modal = document.getElementById('automationRulesModal');
    if (!modal) return;
    const field = (id) => document.getElementById(id);
    const closeModal = () => { modal.style.opacity = '0'; setTimeout(() => { modal.style.display = 'none'; }, 300); };

    field('btnOpenRules')?.addEventListener('click', () => {
        const r = overview ? overview.rules : { thresholdSuspendHours: 3, thresholdTrashDays: 2, trashRetentionDays: 30, emailReminders: true, escalations: true };
        field('ruleSuspendHours').value = r.thresholdSuspendHours;
        field('ruleTrashDays').value = r.thresholdTrashDays;
        field('ruleRetentionDays').value = r.trashRetentionDays;
        field('ruleEmailReminders').checked = r.emailReminders;
        field('ruleEscalations').checked = r.escalations;
        field('aiRulesAdviceResult').innerHTML = '';
        modal.style.display = 'flex';
        setTimeout(() => { modal.style.opacity = '1'; }, 10);
    });
    field('btnCloseRulesModal')?.addEventListener('click', closeModal);
    field('btnCancelRules')?.addEventListener('click', closeModal);

    field('btnAiRulesAdvice')?.addEventListener('click', async () => {
        const out = field('aiRulesAdviceResult');
        out.textContent = 'Analysing response history…';
        try {
            const d = await api('/ai/rules-advice');
            out.innerHTML = esc(d.message) + (d.suggestion
                ? ` <button type="button" id="btnApplyAdvice" class="btn btn-outline" style="font-size:0.72rem; padding:4px 8px; margin-top:6px;">Use ${d.suggestion.thresholdSuspendHours}h / ${d.suggestion.thresholdTrashDays}d</button>`
                : '');
            field('btnApplyAdvice')?.addEventListener('click', () => {
                field('ruleSuspendHours').value = d.suggestion.thresholdSuspendHours;
                field('ruleTrashDays').value = d.suggestion.thresholdTrashDays;
                toast('Suggested thresholds filled in — press Save Rules to apply.');
            });
        } catch (err) {
            out.textContent = 'AI advice failed: ' + err.message;
        }
    });

    field('btnSaveRules')?.addEventListener('click', async () => {
        const btnSave = field('btnSaveRules');
        btnSave.disabled = true;
        const oldLabel = btnSave.innerHTML;
        btnSave.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Saving...';
        icons();
        try {
            await api('/rules', {
                method: 'PUT',
                body: {
                    thresholdSuspendHours: Number(field('ruleSuspendHours').value),
                    thresholdTrashDays: Number(field('ruleTrashDays').value),
                    trashRetentionDays: Number(field('ruleRetentionDays').value),
                    emailReminders: field('ruleEmailReminders').checked,
                    escalations: field('ruleEscalations').checked
                }
            });
            toast('Automation rules saved to Firebase.');
            closeModal();
            await refreshDashboard();
        } catch (err) {
            toast('Failed to save rules: ' + err.message, true);
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = oldLabel;
            icons();
        }
    });
}
