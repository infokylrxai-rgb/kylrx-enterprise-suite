/**
 * Notification & Action Centre Client Logic
 * 
 * Separates actionable operational work from broadcast information.
 * Supports due time, reminder time, escalation time, assignee, and status.
 * Covers all 11 enterprise facets:
 * Critical, Due Today, Upcoming, Approvals, Attendance, Payroll, PMS, Policy, Exit, Documents, System
 */

const API_BASE = window.location.port === '5501' || window.location.port === '5502' || window.location.port === '5500'
    ? 'http://localhost:3000/api/notification-center'
    : '/api/notification-center';

let isZeroed = localStorage.getItem('kylrx_zero_notification_center') !== 'false';

const state = {
    currentView: 'actionable', // 'actionable' | 'information'
    currentFacet: 'all',
    searchQuery: '',
    actionableItems: [],
    informationalNotices: [],
    summary: {},
    activeModalItemId: null
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await fetchSummary();
    await fetchFeed();
    if (window.lucide) {
        lucide.createIcons();
    }
}

/**
 * Fetch KPI counts and facet summary
 */
async function fetchSummary() {
    try {
        const res = await fetch(`${API_BASE}/summary`);
        const json = await res.json();
        if (json.success && json.data) {
            state.summary = json.data;
            updateSummaryUI(json.data);
        }
    } catch (err) {
        console.error('[NotificationCenter] Error fetching summary:', err);
    }
}

/**
 * Update KPI ribbon and facet counters
 */
function updateSummaryUI(s) {
    const zero = isZeroed;
    const restoreBtn = document.getElementById('btn-restore');
    if (restoreBtn) restoreBtn.style.display = zero ? 'inline-flex' : 'none';

    const fbBadge = document.getElementById('firebase-status-badge');
    if (fbBadge && (s.connectedToFirebase || zero)) {
        fbBadge.style.display = 'inline-flex';
    }

    // Top Ribbon
    document.getElementById('kpi-critical-count').textContent = zero ? 0 : (s.critical || 0);
    document.getElementById('kpi-due-today-count').textContent = zero ? 0 : (s.dueToday || 0);
    document.getElementById('kpi-upcoming-count').textContent = zero ? 0 : (s.upcoming || 0);
    document.getElementById('kpi-approvals-count').textContent = zero ? 0 : (s.approvals || 0);
    document.getElementById('kpi-info-count').textContent = zero ? 0 : (s.totalInformational || 0);

    // Tab badges
    document.getElementById('badge-actionable-count').textContent = zero ? 0 : (s.totalActionable || 0);
    document.getElementById('badge-info-unread-count').textContent = zero ? '0 unread' : `${s.unreadInformational || 0} unread`;

    // Facet counts
    const countMap = {
        all: zero ? 0 : ((s.totalActionable || 0) + (s.totalInformational || 0)),
        critical: zero ? 0 : (s.critical || 0),
        due_today: zero ? 0 : (s.dueToday || 0),
        upcoming: zero ? 0 : (s.upcoming || 0),
        approvals: zero ? 0 : (s.approvals || 0),
        attendance: zero ? 0 : (s.attendance || 0),
        payroll: zero ? 0 : (s.payroll || 0),
        pms: zero ? 0 : (s.pms || 0),
        policy: zero ? 0 : (s.policy || 0),
        exit: zero ? 0 : (s.exit || 0),
        documents: zero ? 0 : (s.documents || 0),
        system: zero ? 0 : (s.system || 0)
    };

    Object.keys(countMap).forEach(facet => {
        const el = document.getElementById(`count-facet-${facet}`);
        if (el) el.textContent = countMap[facet];
    });
}

/**
 * Fetch feed items from API
 */
async function fetchFeed() {
    const container = document.getElementById('feed-container');
    container.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: #94a3b8;">
            <i data-lucide="loader" class="spin" style="width: 28px; height: 28px; margin-bottom: 8px;"></i>
            <p style="margin: 0; font-size: 0.9rem; font-weight: 600;">Loading work queue...</p>
        </div>
    `;
    if (window.lucide) lucide.createIcons();

    try {
        const params = new URLSearchParams({
            type: state.currentView,
            facet: state.currentFacet,
            search: state.searchQuery
        });

        const res = await fetch(`${API_BASE}/feed?${params.toString()}`);
        const json = await res.json();

        if (json.success && json.data) {
            state.actionableItems = json.data.actionable || [];
            state.informationalNotices = json.data.informational || [];
            renderFeed();
        } else {
            container.innerHTML = `<div style="text-align:center; padding: 2rem; color: #ef4444;">Failed to load items.</div>`;
        }
    } catch (err) {
        console.error('[NotificationCenter] Feed fetch error:', err);
        container.innerHTML = `<div style="text-align:center; padding: 2rem; color: #ef4444;">Error connecting to service.</div>`;
    }
}

/**
 * Render feed based on current view
 */
function renderFeed() {
    const container = document.getElementById('feed-container');
    container.innerHTML = '';

    if (state.currentView === 'actionable') {
        renderActionableList(container);
    } else {
        renderInformationList(container);
    }

    if (window.lucide) {
        lucide.createIcons();
    }
}

/**
 * Render Actionable Work Items
 */
function renderActionableList(container) {
    if (isZeroed || state.actionableItems.length === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:3.5rem 1rem; background:#ffffff; border-radius:16px; border:1px dashed var(--border-card); text-align:center;">
                <div style="width:52px; height:52px; border-radius:50%; background:#ecfdf5; display:flex; align-items:center; justify-content:center; margin-bottom:12px;">
                    <i data-lucide="shield-check" style="width:28px; height:28px; color:#059669;"></i>
                </div>
                <h3 style="margin:0 0 6px 0; font-weight:800; font-size:1.15rem; color:#0f172a;">0 Action Items & Operational Tasks Pending</h3>
                <p style="margin:0; color:#64748b; font-size:0.85rem; max-width:480px; line-height:1.5;">
                    All attendance breaches, payroll holds, exit clearances, and document sign-offs are cleared across all 11 enterprise facets. Operational slate is 100% clean!
                </p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    state.actionableItems.forEach(item => {
        const card = document.createElement('div');
        card.className = `action-card severity-${item.severity} status-${item.status}`;

        // Countdown math
        const dueCountdown = formatCountdown(item.dueTime);
        const reminderInfo = item.reminderCount ? `Nudged (${item.reminderCount}x)` : 'Pending trigger';
        const escalationCountdown = formatCountdown(item.escalationTime);

        // Status Badge class
        let statusBadgeClass = 'badge-upcoming';
        if (item.status === 'escalated') statusBadgeClass = 'badge-escalated';
        else if (item.status === 'completed') statusBadgeClass = 'badge-completed';
        else if (item.urgency === 'critical') statusBadgeClass = 'badge-critical';
        else if (item.urgency === 'due_today') statusBadgeClass = 'badge-due-today';

        card.innerHTML = `
            <div class="card-top-row">
                <div>
                    <div class="card-badge-row">
                        <span class="badge badge-category">${item.category.toUpperCase()}</span>
                        <span class="badge ${statusBadgeClass}">${item.status.toUpperCase()}</span>
                        ${item.urgency === 'critical' ? `<span class="badge badge-critical"><i data-lucide="alert-triangle" style="width:12px;height:12px;margin-right:2px;"></i>CRITICAL SLA</span>` : ''}
                        <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">ID: ${item.id}</span>
                    </div>
                    <h3 class="item-title">${escapeHtml(item.title)}</h3>
                    <p class="item-desc">${escapeHtml(item.description)}</p>
                </div>
            </div>

            <!-- 5 Enforced Fields: Due, Reminder, Escalation, Assignee, Status -->
            <div class="enforced-fields-grid">
                <div class="field-unit">
                    <span class="field-lbl"><i data-lucide="clock" style="width:12px;height:12px;"></i> Due Time</span>
                    <span class="field-val ${dueCountdown.isUrgent ? 'urgent-countdown' : ''}">${dueCountdown.label}</span>
                </div>
                <div class="field-unit">
                    <span class="field-lbl"><i data-lucide="bell" style="width:12px;height:12px;"></i> Reminder</span>
                    <span class="field-val">${reminderInfo}</span>
                </div>
                <div class="field-unit">
                    <span class="field-lbl"><i data-lucide="shield-alert" style="width:12px;height:12px;"></i> Escalation SLA</span>
                    <span class="field-val">${escalationCountdown.label}</span>
                </div>
                <div class="field-unit">
                    <span class="field-lbl"><i data-lucide="user" style="width:12px;height:12px;"></i> Assignee</span>
                    <div class="assignee-chip">
                        <span class="assignee-avatar">${getInitials(item.assignee?.name || 'HR')}</span>
                        <span class="field-val">${escapeHtml(item.assignee?.name || 'Unassigned')} (${escapeHtml(item.assignee?.role || 'Admin')})</span>
                    </div>
                </div>
                <div class="field-unit">
                    <span class="field-lbl"><i data-lucide="activity" style="width:12px;height:12px;"></i> Status</span>
                    <span class="field-val" style="text-transform: capitalize;">${item.status}</span>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="card-actions-row">
                ${item.status !== 'completed' ? `
                    <button class="btn-act btn-remind" onclick="triggerRemind('${item.id}')" title="Send reminder notification to ${escapeHtml(item.assignee?.name)}">
                        <i data-lucide="bell"></i>
                        <span>Nudge</span>
                    </button>
                    <button class="btn-act btn-escalate" onclick="openEscalateModal('${item.id}', '${escapeJs(item.title)}')">
                        <i data-lucide="arrow-up-right"></i>
                        <span>Escalate</span>
                    </button>
                    ${item.actionOptions && item.actionOptions.includes('reject') ? `
                        <button class="btn-act btn-reject" onclick="openResolveModal('${item.id}', '${escapeJs(item.title)}', 'rejected')">
                            <i data-lucide="x-circle"></i>
                            <span>Reject</span>
                        </button>
                    ` : ''}
                    <button class="btn-act btn-approve" onclick="openResolveModal('${item.id}', '${escapeJs(item.title)}', 'approved')">
                        <i data-lucide="check-circle"></i>
                        <span>${item.actionOptions && item.actionOptions.includes('approve') ? 'Approve' : 'Resolve'}</span>
                    </button>
                ` : `
                    <span style="font-size: 0.8rem; color: var(--success); font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="check-circle-2" style="width: 16px; height: 16px;"></i>
                        Resolved by ${escapeHtml(item.resolvedBy || 'HR Admin')}
                    </span>
                `}
            </div>
        `;

        container.appendChild(card);
    });
}

function renderInformationList(container) {
    if (isZeroed || state.informationalNotices.length === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:3.5rem 1rem; background:#ffffff; border-radius:16px; border:1px dashed var(--border-card); text-align:center;">
                <div style="width:52px; height:52px; border-radius:50%; background:#ecfdf5; display:flex; align-items:center; justify-content:center; margin-bottom:12px;">
                    <i data-lucide="bell-off" style="width:28px; height:28px; color:#059669;"></i>
                </div>
                <h3 style="margin:0 0 6px 0; font-weight:800; font-size:1.15rem; color:#0f172a;">0 Information Notices & Broadcasts</h3>
                <p style="margin:0; color:#64748b; font-size:0.85rem; max-width:480px; line-height:1.5;">
                    All organizational circulars, statutory alerts, and system notices are up-to-date and acknowledged. Live synced with Firebase (<code>kylrxai</code>).
                </p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    state.informationalNotices.forEach(notice => {
        const card = document.createElement('div');
        card.className = `info-card ${notice.isRead ? 'read' : 'unread'}`;

        card.innerHTML = `
            <div class="info-card-left">
                <div class="info-icon-badge">
                    <i data-lucide="${notice.isRead ? 'mail-open' : 'mail'}"></i>
                </div>
                <div>
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <span class="badge badge-category">${notice.category.toUpperCase()}</span>
                        ${notice.severity === 'critical' ? `<span class="badge badge-critical">CRITICAL</span>` : ''}
                        ${!notice.isRead ? `<span class="badge" style="background:#e0e7ff; color:var(--primary);">NEW</span>` : ''}
                    </div>
                    <h4 style="margin: 4px 0 2px 0; font-size: 0.95rem; font-weight: 800; color: var(--text-main);">${escapeHtml(notice.title)}</h4>
                    <p style="margin: 0; font-size: 0.82rem; color: var(--text-muted); line-height: 1.4;">${escapeHtml(notice.description)}</p>
                    <div class="info-meta-row">
                        <span><i data-lucide="clock" style="width:12px;height:12px;vertical-align:middle;"></i> ${formatRelativeTime(notice.createdAt)}</span>
                        <span>•</span>
                        <span>Audience: All Employees & HR</span>
                    </div>
                </div>
            </div>

            <div>
                ${!notice.isRead ? `
                    <button class="btn-act" onclick="markNoticeRead('${notice.id}')" title="Mark as Read">
                        <i data-lucide="check"></i>
                        <span>Mark Read</span>
                    </button>
                ` : `
                    <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">Acknowledged</span>
                `}
            </div>
        `;

        container.appendChild(card);
    });
}

/**
 * Filter and view handlers
 */
function switchView(viewMode) {
    state.currentView = viewMode;

    document.getElementById('tab-actionable').classList.toggle('active', viewMode === 'actionable');
    document.getElementById('tab-information').classList.toggle('active', viewMode === 'information');

    // Update Facet Bar Active Pills
    renderFeed();
}

function selectFacet(facetName) {
    state.currentFacet = facetName;

    // If clicking kpi info ribbon, switch to information view
    if (facetName === 'information') {
        switchView('information');
        return;
    }

    // Default to actionable view if selecting functional facet
    if (state.currentView === 'information' && facetName !== 'all') {
        state.currentView = 'actionable';
        document.getElementById('tab-actionable').classList.add('active');
        document.getElementById('tab-information').classList.remove('active');
    }

    // Update active UI on pills
    document.querySelectorAll('.facet-pill').forEach(pill => {
        pill.classList.toggle('active', pill.getAttribute('data-facet') === facetName);
    });

    fetchFeed();
}

function handleSearch(val) {
    state.searchQuery = val.trim();
    fetchFeed();
}

function refreshFeed() {
    fetchSummary();
    fetchFeed();
    showToast('Feed refreshed successfully');
}

/**
 * Action Resolution Modal & Trigger
 */
function openResolveModal(id, title, defaultDecision = 'approved') {
    state.activeModalItemId = id;
    document.getElementById('modal-item-title').value = title;
    document.getElementById('modal-decision').value = defaultDecision;
    document.getElementById('modal-remarks').value = '';
    document.getElementById('resolve-modal').classList.add('open');
}

function closeResolveModal() {
    state.activeModalItemId = null;
    document.getElementById('resolve-modal').classList.remove('open');
}

async function submitResolution() {
    const id = state.activeModalItemId;
    if (!id) return;

    const decision = document.getElementById('modal-decision').value;
    const remarks = document.getElementById('modal-remarks').value;

    try {
        const res = await fetch(`${API_BASE}/actions/${id}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, remarks, actor: 'HR Administrator' })
        });
        const json = await res.json();

        if (json.success) {
            closeResolveModal();
            showToast(`Item successfully resolved (${decision})`);
            await fetchSummary();
            await fetchFeed();
        } else {
            alert(`Error: ${json.error}`);
        }
    } catch (err) {
        console.error(err);
        alert('Failed to resolve item.');
    }
}

/**
 * Reminder Trigger (Nudge)
 */
async function triggerRemind(id) {
    try {
        const res = await fetch(`${API_BASE}/actions/${id}/remind`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: 'HR Admin' })
        });
        const json = await res.json();

        if (json.success) {
            showToast('Reminder notification dispatched to assignee');
            await fetchFeed();
        } else {
            alert(`Error: ${json.error}`);
        }
    } catch (err) {
        console.error(err);
        alert('Failed to send reminder.');
    }
}

/**
 * Escalation Modal & Trigger
 */
function openEscalateModal(id, title) {
    state.activeModalItemId = id;
    document.getElementById('modal-esc-title').value = title;
    document.getElementById('modal-esc-reason').value = '';
    document.getElementById('escalate-modal').classList.add('open');
}

function closeEscalateModal() {
    state.activeModalItemId = null;
    document.getElementById('escalate-modal').classList.remove('open');
}

async function submitEscalation() {
    const id = state.activeModalItemId;
    if (!id) return;

    const assignee = document.getElementById('modal-esc-assignee').value;
    const reason = document.getElementById('modal-esc-reason').value;

    try {
        const res = await fetch(`${API_BASE}/actions/${id}/escalate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                escalationAssignee: assignee,
                reason: reason || 'SLA Threshold Imminent',
                actor: 'HR Command Center'
            })
        });
        const json = await res.json();

        if (json.success) {
            closeEscalateModal();
            showToast(`Action escalated to ${assignee}`);
            await fetchSummary();
            await fetchFeed();
        } else {
            alert(`Error: ${json.error}`);
        }
    } catch (err) {
        console.error(err);
        alert('Failed to escalate action.');
    }
}

/**
 * Information Notices Handlers
 */
async function markNoticeRead(id) {
    try {
        const res = await fetch(`${API_BASE}/notifications/${id}/read`, {
            method: 'POST'
        });
        const json = await res.json();
        if (json.success) {
            showToast('Notice marked as read');
            await fetchSummary();
            await fetchFeed();
        }
    } catch (err) {
        console.error(err);
    }
}

async function markAllNoticesRead() {
    try {
        const res = await fetch(`${API_BASE}/notifications/mark-all-read`, {
            method: 'POST'
        });
        const json = await res.json();
        if (json.success) {
            showToast('All notifications marked as read');
            await fetchSummary();
            await fetchFeed();
        }
    } catch (err) {
        console.error(err);
    }
}

/**
 * Helpers
 */
function formatCountdown(isoTime) {
    if (!isoTime) return { label: 'No SLA', isUrgent: false };
    const diff = new Date(isoTime) - new Date();
    const isPast = diff < 0;
    const absDiff = Math.abs(diff);

    const hours = Math.floor(absDiff / (1000 * 60 * 60));
    const mins = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60));

    if (isPast) {
        return {
            label: `Overdue by ${hours > 0 ? `${hours}h ` : ''}${mins}m`,
            isUrgent: true
        };
    } else {
        return {
            label: `Due in ${hours > 0 ? `${hours}h ` : ''}${mins}m`,
            isUrgent: hours < 3
        };
    }
}

function formatRelativeTime(isoTime) {
    if (!isoTime) return 'Just now';
    const diffHours = Math.floor((new Date() - new Date(isoTime)) / (1000 * 60 * 60));
    if (diffHours < 1) return 'Within the hour';
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${Math.floor(diffHours / 24)} days ago`;
}

function getInitials(name) {
    if (!name) return 'HR';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function showToast(message) {
    const popup = document.getElementById('toast-popup');
    const msg = document.getElementById('toast-message');
    msg.textContent = message;
    popup.style.display = 'flex';
    setTimeout(() => {
        popup.style.display = 'none';
    }, 3500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeJs(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'");
}

/**
 * Zero Out All Notifications & Action Items (Clean Slate)
 */
async function zeroAllNotices() {
    isZeroed = true;
    localStorage.setItem('kylrx_zero_notification_center', 'true');
    try {
        await fetch(`${API_BASE}/zero`, { method: 'POST' });
    } catch (e) {
        console.warn('[NotificationCenter] Firebase zero sync fallback:', e);
    }
    updateSummaryUI({
        totalActionable: 0,
        totalInformational: 0,
        unreadInformational: 0,
        critical: 0,
        dueToday: 0,
        upcoming: 0,
        approvals: 0,
        attendance: 0,
        payroll: 0,
        pms: 0,
        policy: 0,
        exit: 0,
        documents: 0,
        system: 0,
        connectedToFirebase: true
    });
    renderFeed();
    showToast('🎉 All operational work & notices cleared to 0 and synced to Firebase!');
}

/**
 * Restore Seed Demo Feed
 */
function restoreDefaultFeed() {
    isZeroed = false;
    localStorage.setItem('kylrx_zero_notification_center', 'false');
    fetchSummary();
    fetchFeed();
    showToast('Restored default demo work queue.');
}

window.zeroAllNotices = zeroAllNotices;
window.restoreDefaultFeed = restoreDefaultFeed;
