/**
 * bulk-trigger-controller.js
 * 
 * Interactive Client-Side Controller for:
 * 2. Bulk Triggering and AI-Assisted Builder (PRD §2)
 * 2.1 Bulk Triggering
 * 2.2 Batch Processing (e.g. 100 items in 5 groups of 20)
 * 2.3 Email Notifications & OTP Verification Separation
 */

(function () {
    const API_HOST = (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : window.location.origin);
    const API_BASE = `${API_HOST}/api`;

    /**
     * Backend call: the server's message on failure, 30 s timeout. Saves are not sent while
     * Firebase refuses writes (the server would only answer 503).
     */
    async function api(path, { method = 'GET', body, query = '' } = {}) {
        if (method !== 'GET' && !(await getWriteStatus()).accepting) {
            throw new Error('Saving is paused: Firebase is not accepting changes right now (the daily Firestore write quota is used up). Nothing was sent. Please try again after the quota resets.');
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        try {
            const res = await fetch(`${API_BASE}/bulk-trigger${path}${query}`, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false) {
                const err = new Error(json.message || json.error || `Request failed (HTTP ${res.status})`);
                err.body = json;
                throw err;
            }
            return json;
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('The server did not respond in time. Please try again.');
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    let writeStatusCache = { at: 0, value: null };
    async function getWriteStatus() {
        if (writeStatusCache.value && Date.now() - writeStatusCache.at < 60000) return writeStatusCache.value;
        try {
            const json = await (await fetch(`${API_BASE}/firestore/write-status`)).json();
            writeStatusCache = { at: Date.now(), value: { accepting: json.accepting !== false, localTestDatabase: json.localTestDatabase === true } };
        } catch (_) {
            writeStatusCache = { at: Date.now(), value: { accepting: true, localTestDatabase: false } };
        }
        return writeStatusCache.value;
    }

    // Banner when saves go to the local test database, or when Firebase is refusing saves
    async function showSaveNotice() {
        const status = await getWriteStatus();
        let notice = document.getElementById('bulkSaveNotice');
        if (status.accepting && !status.localTestDatabase) { notice?.remove(); return; }
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'bulkSaveNotice';
            notice.style.cssText = 'margin: 0 0 1.25rem; padding: 12px 16px; border-radius: 12px; font-size: 0.85rem; font-weight: 600;';
            const header = document.querySelector('.main-content > header, .main-content > div');
            if (header) header.after(notice); else document.querySelector('.main-content')?.prepend(notice);
        }
        if (status.localTestDatabase) {
            notice.style.background = '#eff6ff'; notice.style.color = '#1e40af'; notice.style.border = '1px solid #bfdbfe';
            notice.textContent = 'Local test database: jobs and notifications on this page go to the local copy of your Firebase data, not the live project. No real emails are sent.';
        } else {
            notice.style.background = '#fffbeb'; notice.style.color = '#92400e'; notice.style.border = '1px solid #fde68a';
            notice.textContent = 'Saving is paused: Firebase is not accepting changes right now (the daily Firestore write quota is used up). Bulk jobs cannot run until the quota resets.';
        }
    }

    async function updateFirebaseStatusBadge() {
        const title = document.getElementById('firebaseStatusTitle');
        const dot = document.getElementById('firebaseStatusDot');
        const badge = document.getElementById('firebaseProjectIdBadge');

        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/firebase-status`);
            if (res.ok) {
                const json = await res.json();
                if (json.online && json.firebaseReady) {
                    if (title) title.textContent = 'Firebase Connected';
                    if (dot) {
                        dot.style.background = '#16a34a';
                        dot.style.boxShadow = '0 0 0 3px rgba(22, 163, 74, 0.2)';
                    }
                    if (badge) badge.textContent = json.projectId || 'kylrxai';
                    return;
                }
            }
        } catch (_) {}

        if (title) title.textContent = 'Local Cache / Standby';
        if (dot) {
            dot.style.background = '#f59e0b';
            dot.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.2)';
        }
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       CENTERED ALERT MODAL SYSTEM (Replaces browser popup)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    function ensureAppAlertElement() {
        let modal = document.getElementById('appAlertModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'appAlertModal';
            modal.className = 'app-alert-overlay';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML = `
                <div class="app-alert-card" onclick="event.stopPropagation()">
                    <div id="appAlertIconBox" class="app-alert-icon-box warning">
                        <i data-lucide="alert-triangle" id="appAlertIcon" style="width: 28px; height: 28px;"></i>
                    </div>
                    <h3 id="appAlertTitle" class="app-alert-title">Notice</h3>
                    <p id="appAlertMessage" class="app-alert-msg"></p>
                    <button id="appAlertOkBtn" class="app-alert-btn" type="button">OK</button>
                </div>
            `;
            document.body.appendChild(modal);
        }
        return modal;
    }

    function showAppAlert(message, title = 'Notice', type = 'warning') {
        return new Promise((resolve) => {
            const modal = ensureAppAlertElement();
            const titleEl = document.getElementById('appAlertTitle');
            const msgEl = document.getElementById('appAlertMessage');
            const iconBox = document.getElementById('appAlertIconBox');
            const iconEl = document.getElementById('appAlertIcon');
            const okBtn = document.getElementById('appAlertOkBtn');

            if (titleEl) titleEl.textContent = title;
            if (msgEl) msgEl.textContent = message;

            if (iconBox) {
                iconBox.className = 'app-alert-icon-box ' + (type || 'warning');
                const iconName = type === 'error' ? 'alert-circle' : (type === 'success' ? 'check-circle' : 'alert-triangle');
                if (iconEl) iconEl.setAttribute('data-lucide', iconName);
            }

            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                try { window.lucide.createIcons(); } catch (e) {}
            }

            function closeModal() {
                modal.classList.remove('active');
                if (okBtn) okBtn.removeEventListener('click', onOk);
                modal.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKeyDown);
                resolve();
            }

            function onOk(e) {
                if (e) e.preventDefault();
                closeModal();
            }

            function onBackdrop(e) {
                if (e.target === modal) closeModal();
            }

            function onKeyDown(e) {
                if (e.key === 'Escape' || e.key === 'Enter') {
                    if (e) e.preventDefault();
                    closeModal();
                }
            }

            if (okBtn) okBtn.addEventListener('click', onOk);
            modal.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKeyDown);

            modal.classList.add('active');
            setTimeout(() => {
                try { if (okBtn) okBtn.focus(); } catch (e) {}
            }, 60);
        });
    }

    if (!window._nativeAlert) {
        window._nativeAlert = window.alert;
    }
    window.alert = function (msg) {
        return showAppAlert(msg);
    };
    window.showAppAlert = showAppAlert;

    const state = {
        currentJobId: null,
        activeAction: 'EMAIL_NOTIFICATION',
        batchSize: 20,
        recipientsList: [],
        validationSummary: null,
        activeTab: 'trigger', // 'trigger' | 'batch_monitor' | 'otp_studio' | 'ai_builder' | 'audit_trail'
        currentAiDraft: null,
        user: {
            id: localStorage.getItem('userId') || '',
            name: localStorage.getItem('userName') || '',
            role: localStorage.getItem('userRole') || ''
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        initBulkTriggerApp();
    });

    async function initBulkTriggerApp() {
        console.log('[BulkTrigger] Initializing Bulk Triggering & Batch Processing Hub...');
        updateFirebaseStatusBadge();
        showSaveNotice();
        showAiMode();
        loadConfig();
        bindEventListeners();
        loadAuditLogs();
        loadAiConfigurations('all');
        await loadRecipientsFromFirebase(); // This organization's people
        setInterval(updateFirebaseStatusBadge, 30000);
        setInterval(showSaveNotice, 120000);
        // Audit trail refresh (replaces direct Firestore listeners, which saw every organization)
        setInterval(() => { if (!document.hidden) loadAuditLogs(); }, 20000);

        // Handle URL query parameters (e.g. navigating directly from Section 1.3 Template Setup or Alert Builder)
        const params = new URLSearchParams(window.location.search);
        const templateId = params.get('templateId');
        const templateName = params.get('templateName');
        const tabParam = params.get('tab');

        if (tabParam) {
            switchToTab(tabParam);
        }

        if (templateId) {
            state.activeAction = 'TEMPLATE_SETUP_DISPATCH';
            document.querySelectorAll('.action-select-card').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-action') === 'TEMPLATE_SETUP_DISPATCH');
            });
            const subjectInput = document.getElementById('triggerSubjectInput');
            if (subjectInput) subjectInput.value = `Template Setup: ${templateName || templateId}`;
            const messageInput = document.getElementById('triggerMessageInput');
            if (messageInput) messageInput.value = `Bulk instantiation dispatch for template ${templateName || templateId} across selected cohort.`;
            validateSelection();
        }
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       1. ENGINE CONFIGURATION
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    async function loadConfig() {
        try {
            const json = await api('/config');
            {
                state.batchSize = json.data.batchSize || 20;
                const batchInput = document.getElementById('cfgBatchSizeInput');
                if (batchInput) batchInput.value = state.batchSize;
                const batchDisplay = document.getElementById('cfgBatchSizeDisplay');
                if (batchDisplay) batchDisplay.textContent = state.batchSize;
            }
        } catch (err) {
            console.warn('[BulkTrigger] Failed to load config:', err.message);
        }
    }

    window.saveBatchConfig = async function () {
        const input = document.getElementById('cfgBatchSizeInput');
        const newSize = parseInt(input?.value, 10);
        if (isNaN(newSize) || newSize < 1 || newSize > 100) {
            alert('Batch size must be between 1 and 100.');
            return;
        }

        try {
            await api('/config', { method: 'PUT', body: { batchSize: newSize } });

            state.batchSize = newSize;
            const batchDisplay = document.getElementById('cfgBatchSizeDisplay');
            if (batchDisplay) batchDisplay.textContent = newSize;

            showToast(`Batch size ${newSize} saved to Firebase.`);
            validateSelection();
        } catch (err) {
            alert('Failed to update config: ' + err.message);
        }
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       2. RECIPIENT SELECTION & PRE-POPULATION
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /** Loads this organization's people (exited staff are marked opted out and excluded) */
    window.loadRecipientsFromFirebase = async function () {
        const btn = document.getElementById('btnLoadFirestoreRecipients');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span style="display:inline-block; animation: spin 1s linear infinite;">⏳</span><span>Loading…</span>`;
        }
        try {
            const json = await api('/recipients/from-firestore', { query: '?limit=2000' });
            state.recipientsList = json.data || [];
            renderRecipientsTable();
            await validateSelection();
            const datasetBadge = document.getElementById('firebaseDatasetBadge');
            if (datasetBadge) datasetBadge.textContent = `🏢 Your organization's people (${state.recipientsList.length})`;
            showToast(state.recipientsList.length ? `Loaded ${state.recipientsList.length} people from Firebase.` : 'No people found in your organization.');
        } catch (err) {
            console.error('[BulkTrigger] Error loading recipients:', err);
            showAppAlert('Could not load your people from Firebase: ' + err.message, 'Database Notice', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
                if (window.renderLucideIcons) window.renderLucideIcons();
            }
        }
    };

    function renderRecipientsTable() {
        const tbody = document.getElementById('recipientsTableBody');
        const countBadge = document.getElementById('recipientSelectedCount');
        if (countBadge) countBadge.textContent = state.recipientsList.length;

        if (!tbody) return;

        if (state.recipientsList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #64748b;">No recipients selected. Click "Load Your People".</td></tr>`;
            return;
        }

        // Show top 50 in table for high performance
        const displayItems = state.recipientsList.slice(0, 50);
        tbody.innerHTML = displayItems.map((r, idx) => {
            const isOptedOut = r.consentStatus === 'opted_out';
            const isBadEmail = !String(r.email || '').includes('@');

            return `
                <tr style="border-bottom: 1px solid var(--border); transition: background 0.15s;">
                    <td style="padding: 10px 14px; font-weight: 700; font-size: 0.8rem; color: #334155;">#${idx + 1}</td>
                    <td style="padding: 10px 14px; font-weight: 700; font-size: 0.85rem; color: #0f172a;">${escapeHtml(r.name)}</td>
                    <td style="padding: 10px 14px; font-size: 0.82rem; color: ${isBadEmail ? '#ef4444; font-weight: 700;' : '#475569;'}">
                        ${escapeHtml(r.email)} ${isBadEmail ? '⚠️' : ''}
                    </td>
                    <td style="padding: 10px 14px; font-size: 0.82rem; color: #64748b;">${escapeHtml(r.department)}</td>
                    <td style="padding: 10px 14px;">
                        ${isOptedOut 
                            ? '<span style="background: #fee2e2; color: #b91c1c; font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">Opted Out</span>'
                            : '<span style="background: #dcfce7; color: #15803d; font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">Consent Granted</span>'}
                    </td>
                    <td style="padding: 10px 14px; text-align: right;">
                        <button data-remove-recipient="${escapeHtml(r.id)}" style="background:none; border:none; color:#ef4444; cursor:pointer;" title="Remove">✕</button>
                    </td>
                </tr>
            `;
        }).join('');

        if (state.recipientsList.length > 50) {
            tbody.innerHTML += `<tr><td colspan="6" style="text-align: center; padding: 8px; font-size: 0.75rem; color: #64748b; background: #f8fafc;">... and ${state.recipientsList.length - 50} more items in this cohort</td></tr>`;
        }
    }

    window.removeRecipient = function (id) {
        state.recipientsList = state.recipientsList.filter(r => r.id !== id);
        renderRecipientsTable();
        validateSelection();
    };

    // Remove buttons carry the id as data (not inside inline code)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove-recipient]');
        if (btn) window.removeRecipient(btn.dataset.removeRecipient);
    });

    window.clearAllRecipients = function () {
        state.recipientsList = [];
        renderRecipientsTable();
        validateSelection();
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3. SELECTION VALIDATION (PRD §2.1: System validates the selection & displays total count)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    async function validateSelection() {
        if (state.recipientsList.length === 0) {
            updateValidationUI({
                totalSelected: 0,
                validCount: 0,
                invalidCount: 0,
                estimatedBatches: 0,
                batchSize: state.batchSize
            });
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: state.activeAction, recipients: state.recipientsList })
            });
            const json = await res.json().catch(() => ({}));
            if (res.ok && json.data) {
                state.validationSummary = json.data;
                updateValidationUI(json.data);
            } else {
                state.validationSummary = null;
                updateValidationUI({ totalSelected: state.recipientsList.length, validCount: 0, invalidCount: 0, estimatedBatches: 0, batchSize: state.batchSize });
                showToast('Validation failed: ' + (json.message || json.error || res.status));
            }
        } catch (err) {
            console.warn('[BulkTrigger] Validation check failed:', err.message);
        }
    }
    window.validateSelection = validateSelection;

    function updateValidationUI(data) {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setVal('summaryTotalCount', data.totalSelected || 0);
        setVal('summaryValidCount', data.validCount || 0);
        setVal('summaryInvalidCount', data.invalidCount || 0);
        setVal('summaryBatchCount', data.estimatedBatches || 0);
        setVal('summaryBatchSize', data.batchSize || state.batchSize);

        const btnTrigger = document.getElementById('btnStartBulkTrigger');
        if (btnTrigger) {
            btnTrigger.disabled = !(data.validCount > 0);
            btnTrigger.style.opacity = (data.validCount > 0) ? '1' : '0.5';
            btnTrigger.style.cursor = (data.validCount > 0) ? 'pointer' : 'not-allowed';
        }

        // Show invalid warnings preview
        const warningsBox = document.getElementById('validationWarningsBox');
        if (warningsBox) {
            if (data.invalidCount > 0 && data.invalidItems) {
                warningsBox.style.display = 'block';
                warningsBox.innerHTML = `
                    <div style="font-weight: 700; color: #b91c1c; font-size: 0.8rem; margin-bottom: 4px;">
                        ⚠️ ${data.invalidCount} item(s) will be excluded from dispatch:
                    </div>
                    <ul style="margin: 0; padding-left: 18px; font-size: 0.75rem; color: #7f1d1d; line-height: 1.4;">
                        ${data.invalidItems.slice(0, 3).map(inv => `<li><strong>${escapeHtml(inv.itemId)}</strong>: ${escapeHtml(inv.errorReason)}</li>`).join('')}
                        ${data.invalidItems.length > 3 ? `<li>... and ${data.invalidItems.length - 3} more</li>` : ''}
                    </ul>
                `;
            } else {
                warningsBox.style.display = 'none';
            }
        }
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       4. EXECUTE BATCH TRIGGERING (PRD §2.1 & §2.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       AI ASSIST: compose, audience, pre-send check
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    async function showAiMode() {
        try {
            const { data } = await api('/ai/status');
            const el = document.getElementById('aiAssistMode');
            if (el) el.textContent = data.aiConfigured ? 'AI model connected' : 'Smart templates (no AI key configured)';
        } catch (_) {}
    }

    window.aiComposeMessage = async function () {
        const intent = document.getElementById('aiComposeIntent')?.value.trim();
        const out = document.getElementById('aiComposeResult');
        if (!intent) return showToast('Describe the message first.');
        const btn = document.getElementById('btnAiCompose');
        btn.disabled = true;
        out.textContent = 'Writing…';
        try {
            const { data } = await api('/ai/compose', { method: 'POST', body: { intent, tone: document.getElementById('aiComposeTone')?.value, action: state.activeAction } });
            document.getElementById('triggerSubjectInput').value = data.subject;
            document.getElementById('triggerMessageInput').value = data.body;
            out.textContent = 'Subject and message written below — edit anything before sending.';
            document.getElementById('aiReviewResult').innerHTML = '';
        } catch (err) {
            out.textContent = 'AI Compose failed: ' + err.message;
        } finally {
            btn.disabled = false;
        }
    };

    window.aiSelectAudience = async function () {
        const description = document.getElementById('aiAudienceInput')?.value.trim();
        const out = document.getElementById('aiAudienceResult');
        if (!description) return showToast('Describe who should receive it first.');
        const btn = document.getElementById('btnAiAudience');
        btn.disabled = true;
        out.textContent = 'Selecting…';
        try {
            const { data } = await api('/ai/audience', { method: 'POST', body: { description } });
            state.recipientsList = data.recipients;
            renderRecipientsTable();
            await validateSelection();
            out.innerHTML = `Selected <strong>${data.matched}</strong> of ${data.of} people. ${escapeHtml(data.explanation)}`;
            document.getElementById('aiReviewResult').innerHTML = '';
        } catch (err) {
            out.textContent = 'AI Audience failed: ' + err.message;
        } finally {
            btn.disabled = false;
        }
    };

    function renderAiReview(review) {
        const box = document.getElementById('aiReviewResult');
        if (!box) return;
        const color = review.verdict === 'ready' ? '#059669' : review.verdict === 'review' ? '#d97706' : '#dc2626';
        const label = review.verdict === 'ready' ? 'Ready to send' : review.verdict === 'review' ? 'Review the suggestions' : 'Fix before sending';
        const sev = { critical: ['#fef2f2', '#b91c1c'], high: ['#fff7ed', '#c2410c'], medium: ['#fffbeb', '#a16207'] };
        box.innerHTML = `
            <div class="ai-review-card">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <strong style="font-size: 1.25rem; color: ${color};">${review.score}<span style="font-size: 0.7rem; color: #94a3b8;">/100</span></strong>
                    <span style="font-size: 0.78rem; font-weight: 800; color: ${color};">${label}</span>
                </div>
                ${review.issues.map(i => `<div class="ai-review-item" style="background: ${sev[i.severity][0]}; color: ${sev[i.severity][1]};"><strong>${escapeHtml(i.severity.toUpperCase())}</strong> · ${escapeHtml(i.message)}</div>`).join('')}
                ${review.suggestions.map(s => `<div style="font-size: 0.76rem; color: #334155;">• ${escapeHtml(s)}</div>`).join('')}
            </div>`;
    }

    async function runAiReview() {
        const { data } = await api('/ai/review', {
            method: 'POST',
            body: {
                subject: document.getElementById('triggerSubjectInput')?.value || '',
                body: document.getElementById('triggerMessageInput')?.value || '',
                action: state.activeAction,
                recipients: state.recipientsList
            }
        });
        renderAiReview(data);
        return data;
    }

    window.aiReviewMessage = async function () {
        const btn = document.getElementById('btnAiReview');
        btn.disabled = true;
        try {
            await runAiReview();
        } catch (err) {
            document.getElementById('aiReviewResult').textContent = 'Check failed: ' + err.message;
        } finally {
            btn.disabled = false;
        }
    };

    window.startBulkTriggerExecution = async function () {
        if (!state.validationSummary || state.validationSummary.validCount === 0) {
            alert('Cannot trigger: No valid recipients found.');
            return;
        }

        // Pre-send check: critical problems (e.g. asking for passwords or bank details) need confirmation
        try {
            const review = await runAiReview();
            const critical = review.issues.filter(i => i.severity === 'critical');
            if (critical.length && !window.confirm(`The pre-send check found a critical problem:\n\n${critical.map(i => '• ' + i.message).join('\n')}\n\nSend anyway?`)) {
                return;
            }
        } catch (_) { /* the check is advisory; sending still validates on the server */ }

        const subjectInput = document.getElementById('triggerSubjectInput');
        const messageInput = document.getElementById('triggerMessageInput');
        const payload = {
            subject: subjectInput ? subjectInput.value.trim() : 'Enterprise Update',
            message: messageInput ? messageInput.value.trim() : 'Mandatory enterprise communication.',
            purpose: 'template_setup_verification'
        };

        const btnTrigger = document.getElementById('btnStartBulkTrigger');
        if (btnTrigger) {
            btnTrigger.disabled = true;
            btnTrigger.textContent = 'Initiating Batches...';
        }

        try {
            const json = await api('/execute', {
                method: 'POST',
                body: { action: state.activeAction, recipients: state.recipientsList, payload }
            });

            const job = json.data;
            state.currentJobId = job.jobId;

            if (json.firebaseSaved === false) showAppAlert(json.message, 'Job ran, result not saved', 'warning');
            else showToast(`Job ${job.jobId}: ${job.successCount} succeeded, ${job.failureCount} failed of ${job.totalItems}. Saved to Firebase.`);
            switchToTab('batch_monitor');
            renderJobExecutionProgress(job);
            loadAuditLogs();
        } catch (err) {
            alert('Execution failed: ' + err.message);
        } finally {
            if (btnTrigger) {
                btnTrigger.disabled = false;
                btnTrigger.textContent = '🚀 Start Bulk Triggering';
            }
        }
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       5. PROGRESS MONITOR & FAILED ITEMS REVIEW (PRD §2.1 & §2.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    let monitorPollTimer = null;

    function renderJobExecutionStandby() {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setVal('monitorJobId', 'Ready for Execution');
        setVal('monitorAction', '--');
        setVal('monitorTotalItems', '0');
        setVal('monitorSuccessCount', '0');
        setVal('monitorFailCount', '0');
        setVal('monitorBatchCount', '--');

        const statusBadge = document.getElementById('monitorJobStatusBadge');
        if (statusBadge) {
            statusBadge.style.background = '#f1f5f9';
            statusBadge.style.color = '#64748b';
            statusBadge.textContent = 'Standby';
        }

        const progressBar = document.getElementById('monitorProgressBar');
        if (progressBar) progressBar.style.width = '0%';
        setVal('monitorProgressPercent', '0%');

        // Stepper to Standby
        updateMonitorStepper('standby');

        // Batches List Standby Card
        const batchesContainer = document.getElementById('monitorBatchesList');
        if (batchesContainer) {
            batchesContainer.innerHTML = `
                <div style="grid-column: 1 / -1; background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 14px; padding: 2rem 1.5rem; text-align: center;">
                    <div style="font-size: 2rem; margin-bottom: 6px;">📋</div>
                    <h4 style="font-size: 1rem; font-weight: 800; color: #0f172a; margin: 0 0 6px 0;">No Batch Job Currently Executing</h4>
                    <p style="font-size: 0.82rem; color: #64748b; max-width: 520px; margin: 0 auto 16px auto; line-height: 1.5;">
                        Choose an action and recipients in <strong>Tab 1 (Trigger Configuration)</strong>, then start the job to follow its batches here.
                    </p>
                    <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                        <button onclick="switchToTab('trigger')" style="background: white; border: 1.5px solid #cbd5e1; color: #0f172a; padding: 9px 16px; border-radius: 10px; font-weight: 700; font-size: 0.82rem; cursor: pointer;">
                            👈 Go to Trigger Configuration
                        </button>
                    </div>
                </div>
            `;
        }

        const failedCard = document.getElementById('failedItemsReviewCard');
        if (failedCard) failedCard.style.display = 'none';
    }

    function updateMonitorStepper(status, job = {}) {
        const step1 = document.getElementById('stepIndicator1');
        const step2 = document.getElementById('stepIndicator2');
        const step3 = document.getElementById('stepIndicator3');
        const bubble1 = document.getElementById('stepBubble1');
        const bubble2 = document.getElementById('stepBubble2');
        const bubble3 = document.getElementById('stepBubble3');
        const title2 = document.getElementById('stepTitle2');
        const subtitle2 = document.getElementById('stepSubtitle2');
        const subtitle3 = document.getElementById('stepSubtitle3');

        if (!step1 || !step2 || !step3) return;

        if (status === 'standby') {
            step1.className = 'step-item active';
            if (bubble1) bubble1.textContent = '1';
            step2.className = 'step-item';
            if (bubble2) bubble2.textContent = '2';
            if (title2) title2.textContent = '2. Batch Execution';
            if (subtitle2) subtitle2.textContent = 'Standby';
            step3.className = 'step-item';
            if (bubble3) bubble3.textContent = '3';
            if (subtitle3) subtitle3.textContent = 'Pending execution';
            return;
        }

        // When a job is active or finished, Step 1 is always completed
        step1.className = 'step-item completed';
        if (bubble1) bubble1.textContent = '✓';

        if (status === 'completed') {
            step2.className = 'step-item completed';
            if (bubble2) bubble2.textContent = '✓';
            if (title2) title2.textContent = '2. Batch Execution';
            if (subtitle2) subtitle2.textContent = `Completed (${job.totalBatches || 5} Batches)`;

            step3.className = 'step-item completed';
            if (bubble3) bubble3.textContent = '✓';
            if (subtitle3) subtitle3.textContent = 'Results audited & verified';
        } else if (status === 'partially_completed') {
            step2.className = 'step-item completed';
            if (bubble2) bubble2.textContent = '⚠️';
            if (title2) title2.textContent = '2. Batch Execution';
            if (subtitle2) subtitle2.textContent = `${job.failureCount} items failed review`;

            step3.className = 'step-item active';
            if (bubble3) bubble3.textContent = '3';
            if (subtitle3) subtitle3.textContent = 'Safe retry pass available';
        } else if (status === 'processing') {
            step2.className = 'step-item active';
            if (bubble2) bubble2.textContent = '2';
            if (title2) title2.textContent = '2. Batch Execution';
            if (subtitle2) subtitle2.textContent = `Batch ${job.currentBatchIndex || 1} of ${job.totalBatches || 5} running`;

            step3.className = 'step-item';
            if (bubble3) bubble3.textContent = '3';
            if (subtitle3) subtitle3.textContent = 'Pending batch completion';
        } else if (status === 'queued') {
            step2.className = 'step-item active';
            if (bubble2) bubble2.textContent = '2';
            if (title2) title2.textContent = '2. Batch Execution';
            if (subtitle2) subtitle2.textContent = 'Queued in pipeline';

            step3.className = 'step-item';
            if (bubble3) bubble3.textContent = '3';
            if (subtitle3) subtitle3.textContent = 'Pending execution';
        }
    }

    function renderJobExecutionProgress(job) {
        if (!job || !job.jobId) {
            renderJobExecutionStandby();
            return;
        }

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setVal('monitorJobId', job.jobId);
        setVal('monitorAction', job.action || '--');
        setVal('monitorTotalItems', job.totalItems || 0);
        setVal('monitorSuccessCount', job.successCount || 0);
        setVal('monitorFailCount', job.failureCount || 0);
        setVal('monitorBatchCount', `${job.batches?.length || job.totalBatches || 0} Batches (${job.batchSize || 20}/batch)`);

        // Status Badge (queued -> processing -> completed)
        const statusBadge = document.getElementById('monitorJobStatusBadge');
        if (statusBadge) {
            const colorMap = {
                queued: { bg: '#eff6ff', text: '#2563eb', label: 'Queued' },
                processing: { bg: '#fef3c7', text: '#b45309', label: 'Processing...' },
                completed: { bg: '#dcfce7', text: '#15803d', label: 'Completed' },
                partially_completed: { bg: '#ffedd5', text: '#c2410c', label: 'Partially Completed' },
                failed: { bg: '#fee2e2', text: '#b91c1c', label: 'Failed' },
                standby: { bg: '#f1f5f9', text: '#64748b', label: 'Standby' }
            };
            const c = colorMap[job.status] || colorMap.completed;
            statusBadge.style.background = c.bg;
            statusBadge.style.color = c.text;
            statusBadge.textContent = c.label;
        }

        // Progress bar
        const pct = typeof job.percentComplete === 'number' ? job.percentComplete : (job.totalItems > 0 ? Math.round((job.processedCount / job.totalItems) * 100) : (job.status === 'completed' ? 100 : 0));
        const progressBar = document.getElementById('monitorProgressBar');
        if (progressBar) progressBar.style.width = `${pct}%`;
        setVal('monitorProgressPercent', `${pct}%`);

        // Update Stepper
        updateMonitorStepper(job.status, job);

        // Render Batches Grid (Handwritten notes example: 5 groups of 20)
        const batchesContainer = document.getElementById('monitorBatchesList');
        if (batchesContainer && job.batches && job.batches.length > 0) {
            batchesContainer.innerHTML = job.batches.map(b => {
                const bSuccess = b.successCount || 0;
                const bFail = b.failureCount || 0;
                const isCompleted = b.status === 'completed';
                const isPartially = b.status === 'partially_completed';
                const isRunning = b.status === 'processing';

                let badgeHtml = '<span style="font-size: 0.72rem; font-weight: 800; background: #dcfce7; color: #15803d; padding: 3px 8px; border-radius: 6px;">✓ Completed</span>';
                if (bFail > 0 || isPartially) {
                    badgeHtml = '<span style="font-size: 0.72rem; font-weight: 800; background: #fee2e2; color: #b91c1c; padding: 3px 8px; border-radius: 6px;">⚠️ Has Failures</span>';
                } else if (isRunning) {
                    badgeHtml = '<span style="font-size: 0.72rem; font-weight: 800; background: #fef3c7; color: #b45309; padding: 3px 8px; border-radius: 6px;">⏳ Processing</span>';
                }

                return `
                    <div style="background: white; border: 1.5px solid ${bFail > 0 ? '#fca5a5' : '#e2e8f0'}; border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
                                <span style="font-size: 0.72rem; font-weight: 800; background: #eff6ff; color: #2563eb; padding: 2px 6px; border-radius: 6px;">
                                    Batch ${b.batchIndex}
                                </span>
                                <strong style="font-size: 0.85rem; color: #0f172a;">${b.size} items</strong>
                            </div>
                            <div style="font-size: 0.72rem; color: #64748b;">
                                Completed: <span style="color: #10b981; font-weight: 700;">${bSuccess}</span> | Failed: <span style="color: #ef4444; font-weight: 700;">${bFail}</span>
                            </div>
                        </div>
                        <div>
                            ${badgeHtml}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Render Failed Items for Review (PRD §2.1: Failed items should be listed for review)
        const failedItemsContainer = document.getElementById('failedItemsReviewContainer');
        const failedCard = document.getElementById('failedItemsReviewCard');

        if (failedCard) {
            if (job.failureCount > 0 && job.failedItems && job.failedItems.length > 0) {
                failedCard.style.display = 'block';
                if (failedItemsContainer) {
                    failedItemsContainer.innerHTML = job.failedItems.map(f => `
                        <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div>
                                <div style="font-size: 0.82rem; font-weight: 800; color: #9f1239;">
                                    ${escapeHtml(f.itemId)} — ${escapeHtml(f.recipient?.name || 'Recipient')}
                                </div>
                                <div style="font-size: 0.75rem; color: #be123c; margin-top: 2px;">
                                    ${escapeHtml(f.errorReason)}
                                </div>
                            </div>
                            <span style="font-size: 0.68rem; font-weight: 800; background: #fee2e2; color: #e11d48; padding: 3px 8px; border-radius: 6px;">
                                ${escapeHtml(f.errorCode || 'DISPATCH_ERROR')}
                            </span>
                        </div>
                    `).join('');
                }
            } else {
                failedCard.style.display = 'none';
            }
        }

        // Poll if job is active
        if (job.status === 'queued' || job.status === 'processing') {
            scheduleMonitorPoll(job.jobId);
        }
    }

    function scheduleMonitorPoll(jobId) {
        if (monitorPollTimer) clearTimeout(monitorPollTimer);
        monitorPollTimer = setTimeout(async () => {
            try {
                const json = await api(`/jobs/${encodeURIComponent(jobId)}`);
                {
                    if (json.data) {
                        renderJobExecutionProgress(json.data);
                        if (json.data.status !== 'queued' && json.data.status !== 'processing') {
                            loadAuditLogs();
                        }
                    }
                }
            } catch (err) {
                console.warn('[MonitorPoll] Polling error:', err.message);
            }
        }, 1200);
    }

    async function refreshBatchMonitorView() {
        try {
            let job = null;
            if (state.currentJobId) {
                const res = await fetch(`${API_BASE}/bulk-trigger/jobs/${encodeURIComponent(state.currentJobId)}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.success && json.data) job = json.data;
                }
            }
            if (!job) {
                // Fetch latest job executed on server
                const res = await fetch(`${API_BASE}/bulk-trigger/jobs/latest`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.success && json.data) {
                        job = json.data;
                        state.currentJobId = job.jobId;
                    }
                }
            }

            if (job) {
                renderJobExecutionProgress(job);
            } else {
                renderJobExecutionStandby();
            }
        } catch (err) {
            console.warn('[BatchMonitor] Refresh error:', err.message);
            if (!state.currentJobId) {
                renderJobExecutionStandby();
            }
        }
    }
    window.refreshBatchMonitorView = refreshBatchMonitorView;


    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       6. SAFE RETRY (PRD §2.1: Retries should avoid duplicate actions)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    window.retryFailedItemsAction = async function () {
        if (!state.currentJobId) {
            alert('No active job to retry.');
            return;
        }

        const btnRetry = document.getElementById('btnRetryFailedItems');
        if (btnRetry) {
            btnRetry.disabled = true;
            btnRetry.textContent = 'Retrying Failed Items...';
        }

        try {
            const json = await api(`/jobs/${encodeURIComponent(state.currentJobId)}/retry`, { method: 'POST', body: {} });
            showToast('Safe retry completed and saved. Items that already succeeded were not sent again.');
            renderJobExecutionProgress(json.data);
            loadAuditLogs();
        } catch (err) {
            alert('Retry failed: ' + err.message);
        } finally {
            if (btnRetry) {
                btnRetry.disabled = false;
                btnRetry.textContent = '🔄 Safe Retry Failed Items (0 Duplicates Guaranteed)';
            }
        }
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       7. SEPARATE OTP STUDIO (PRD §2.3)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    window.generateSingleOtpTest = async function () {
        const identifier = document.getElementById('otpTestIdentifier')?.value.trim();
        const ttl = parseInt(document.getElementById('otpTestTtl')?.value, 10) || 300;
        const maxAttempts = parseInt(document.getElementById('otpTestMaxAttempts')?.value, 10) || 3;

        if (!identifier) {
            alert('Please specify an email or phone for OTP issuance.');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/otp/generate?devMode=true`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, purpose: 'user_verification', ttlSeconds: ttl, maxAttempts })
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error);

            const otp = json.data;
            document.getElementById('otpResultBox').style.display = 'block';
            document.getElementById('otpGeneratedCode').textContent = otp.code || '******';
            document.getElementById('otpGeneratedId').textContent = otp.otpId;
            document.getElementById('otpVerifyInput').value = otp.code || '';
            document.getElementById('otpVerifyIdHolder').value = otp.otpId;

            showToast(`OTP generated for ${identifier}! Valid for ${ttl}s.`);
        } catch (err) {
            alert('OTP generation error: ' + err.message);
        }
    };

    window.verifySingleOtpTest = async function () {
        const otpId = document.getElementById('otpVerifyIdHolder')?.value;
        const code = document.getElementById('otpVerifyInput')?.value.trim();

        if (!otpId || !code) {
            alert('Please provide the OTP code to verify.');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/otp/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otpId, code })
            });

            const json = await res.json();
            const resultBox = document.getElementById('otpVerifyOutcomeBox');
            if (resultBox) resultBox.style.display = 'block';

            if (!res.ok) {
                // Failure (e.g. invalid code, expired, max attempts exceeded)
                if (resultBox) {
                    resultBox.style.background = '#fee2e2';
                    resultBox.style.border = '1px solid #fecdd3';
                    resultBox.style.color = '#9f1239';
                    resultBox.innerHTML = `<strong>Verification Failed:</strong> ${escapeHtml(json.message)} ${json.attemptsRemaining !== undefined ? `(${json.attemptsRemaining} attempts left)` : ''}`;
                }
            } else {
                // Success
                if (resultBox) {
                    resultBox.style.background = '#dcfce7';
                    resultBox.style.border = '1px solid #bbf7d0';
                    resultBox.style.color = '#15803d';
                    resultBox.innerHTML = `<strong>✓ Success:</strong> ${escapeHtml(json.message)} (Status is now single-use CONSUMED)`;
                }
                showToast('OTP verified successfully!');
            }
        } catch (err) {
            alert('Verification request error: ' + err.message);
        }
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       8. AUDIT LOGS EXPLORER (PRD §2.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    function renderAuditLogsHtml(logs) {
        const container = document.getElementById('auditLogsContainer');
        if (!container) return;

        if (!logs || logs.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;">No bulk trigger audit records logged yet.</div>';
            return;
        }

        container.innerHTML = logs.map(l => {
            const dateStr = new Date(l.timestamp).toLocaleString();
            const hashSnippet = l.integrityHash ? l.integrityHash.slice(0, 16) + '...' : 'SHA-256';

            return `
                <div style="background: white; border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <span style="font-size: 0.75rem; font-weight: 800; background: #eff6ff; color: #2563eb; padding: 2px 6px; border-radius: 6px;">${escapeHtml(l.action)}</span>
                            <strong style="font-size: 0.85rem; color: #0f172a;">Job: ${escapeHtml(l.jobId)}</strong>
                        </div>
                        <span style="font-size: 0.72rem; color: #64748b;">${dateStr}</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: #334155; margin-bottom: 6px;">
                        <span>Initiator: <strong>${escapeHtml(l.initiator?.name || 'Admin')}</strong> (${escapeHtml(l.initiator?.role || 'admin')})</span>
                        <span>Total: <strong>${l.count?.total || 0}</strong> | Succeeded: <strong style="color: #10b981;">${l.count?.success || 0}</strong> | Failed: <strong style="color: #ef4444;">${l.count?.failed || 0}</strong></span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #64748b; border-top: 1px dashed #e2e8f0; padding-top: 6px;">
                        <span>Batches: ${l.count?.batches || 1} (Size: ${l.count?.batchSize || 20})</span>
                        <span style="font-family: monospace; color: #0284c7;" title="Cryptographic SHA-256 Signature">🔒 ${escapeHtml(hashSnippet)}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    async function loadAuditLogs() {
        try {
            const json = await api('/audit-logs', { query: '?limit=25' });
            renderAuditLogsHtml(json.data || []);
        } catch (err) {
            console.warn('[BulkTrigger] Failed to load audit logs:', err);
        }
    }
    window.loadAuditLogs = loadAuditLogs;

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       8.5 AI-ASSISTED BUILDER CONTROLLER (PRD §2.4)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    window.applyPresetPrompt = function (promptText) {
        const input = document.getElementById('aiAlertPromptInput');
        if (input) input.value = promptText;
        generateAiAlertRecommendation();
    };

    window.changeAiBuilderRole = function (newRole) {
        state.user.role = newRole;
        const badge = document.getElementById('aiBuilderCurrentActorBadge');
        if (badge) {
            badge.textContent = newRole;
            badge.style.background = (newRole === 'employee') ? '#fee2e2' : '#eff6ff';
            badge.style.color = (newRole === 'employee') ? '#b91c1c' : '#2563eb';
        }
        showToast(`Simulation Operator role set to: ${newRole}`);
    };

    window.generateAiAlertRecommendation = async function () {
        const promptInput = document.getElementById('aiAlertPromptInput');
        const prompt = promptInput?.value?.trim();

        if (!prompt) {
            alert('Please provide an alert description to generate recommendations.');
            return;
        }

        const btn = document.getElementById('btnGenerateAiAlert');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i data-lucide="loader-2" style="width: 16px; height: 16px; animation: spin 1s linear infinite;"></i><span>Synthesizing Triggers & Conditions...</span>`;
        }

        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/ai-builder/suggest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    actor: state.user
                })
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to synthesize alert recommendations.');

            state.currentAiDraft = json.data;
            renderAiDraft(json.data);
            loadAiConfigurations('all');

            showToast('AI Draft generated! Status: DRAFT (User review & approval required).');
        } catch (err) {
            alert('AI Builder Error: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i data-lucide="sparkles" style="width: 16px; height: 16px;"></i><span>Generate AI Suggestions (Strict Draft Mode)</span>`;
                if (window.renderLucideIcons) window.renderLucideIcons();
            }
        }
    };

    function renderAiDraft(draft) {
        const container = document.getElementById('aiDraftResultContainer');
        if (!container) return;

        container.style.display = 'block';

        // Header info
        const titleEl = document.getElementById('aiDraftTitleHeader');
        if (titleEl) titleEl.textContent = draft.name;

        const idEl = document.getElementById('aiDraftIdDisplay');
        if (idEl) idEl.textContent = draft.id;

        const confEl = document.getElementById('aiDraftConfidence');
        if (confEl) confEl.textContent = `${Math.round((draft.aiMetadata?.confidence || 0.9) * 100)}%`;

        const catEl = document.getElementById('aiDraftCategory');
        if (catEl) catEl.textContent = draft.category || 'Workforce Monitoring';

        // Status Badge
        const badgeEl = document.getElementById('aiDraftStatusBadge');
        if (badgeEl) {
            badgeEl.textContent = (draft.status || 'draft').toUpperCase();
            if (draft.status === 'active') {
                badgeEl.style.background = '#dcfce7';
                badgeEl.style.color = '#15803d';
            } else if (draft.status === 'rejected') {
                badgeEl.style.background = '#fee2e2';
                badgeEl.style.color = '#b91c1c';
            } else {
                badgeEl.style.background = '#fef3c7';
                badgeEl.style.color = '#b45309';
            }
        }

        // Editable Inputs
        const nameInput = document.getElementById('aiEditAlertName');
        if (nameInput) nameInput.value = draft.name || '';

        const eventInput = document.getElementById('aiEditEventKey');
        if (eventInput) eventInput.value = draft.triggers?.eventKey || '';

        const metricInput = document.getElementById('aiEditMetric');
        if (metricInput) metricInput.value = draft.conditions?.metric || '';

        const compSelect = document.getElementById('aiEditComparator');
        if (compSelect) compSelect.value = draft.conditions?.comparator || '>=';

        const threshInput = document.getElementById('aiEditThreshold');
        if (threshInput) threshInput.value = draft.conditions?.thresholdValue ?? 3;

        const timeInput = document.getElementById('aiEditTimeWindow');
        if (timeInput) timeInput.value = draft.triggers?.timeWindow || '';

        const recipInput = document.getElementById('aiEditRecipients');
        if (recipInput) {
            recipInput.value = (draft.recipients || []).map(r => r.role || r.target || r.name).join(', ');
        }

        const subjInput = document.getElementById('aiEditSubject');
        if (subjInput) subjInput.value = draft.message?.subject || '';

        const bodyInput = document.getElementById('aiEditBody');
        if (bodyInput) bodyInput.value = draft.message?.body || '';

        // Validation Gate Checklist
        const valStatus = draft.validationStatus || {};
        const gateEl = document.getElementById('aiValidationGateStatus');
        if (gateEl) {
            if (valStatus.isValid) {
                gateEl.textContent = 'PASSED GATE';
                gateEl.style.background = '#ecfdf5';
                gateEl.style.color = '#059669';
            } else {
                gateEl.textContent = `${valStatus.errors?.length || 1} VALIDATION ERRORS`;
                gateEl.style.background = '#fee2e2';
                gateEl.style.color = '#b91c1c';
            }
        }

        // Outcome message reset
        const outcomeMsg = document.getElementById('aiActivationOutcomeMsg');
        if (outcomeMsg) {
            outcomeMsg.style.display = 'none';
        }

        // Scroll to draft container smoothly
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (window.renderLucideIcons) window.renderLucideIcons();
    }

    window.saveDraftEdits = async function () {
        if (!state.currentAiDraft) {
            alert('No active AI draft loaded.');
            return;
        }

        const name = document.getElementById('aiEditAlertName')?.value?.trim();
        const eventKey = document.getElementById('aiEditEventKey')?.value?.trim();
        const metric = document.getElementById('aiEditMetric')?.value?.trim();
        const comparator = document.getElementById('aiEditComparator')?.value;
        const thresholdValue = parseFloat(document.getElementById('aiEditThreshold')?.value);
        const timeWindow = document.getElementById('aiEditTimeWindow')?.value?.trim();
        const recipientsStr = document.getElementById('aiEditRecipients')?.value || '';
        const subject = document.getElementById('aiEditSubject')?.value?.trim();
        const body = document.getElementById('aiEditBody')?.value?.trim();

        const recipients = recipientsStr.split(',').map(s => s.trim()).filter(Boolean).map(role => ({ role, target: role.toLowerCase().replace(/\s+/g, '_') }));

        const edits = {
            name,
            triggers: { eventKey, timeWindow },
            conditions: { metric, comparator, thresholdValue },
            recipients,
            message: { subject, body, channels: ['email', 'in_app'] }
        };

        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/ai-builder/drafts/${state.currentAiDraft.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    edits,
                    actor: state.user
                })
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to update draft.');

            state.currentAiDraft = json.data;
            renderAiDraft(json.data);
            loadAiConfigurations('all');

            showToast('Custom edits saved to draft successfully!');
        } catch (err) {
            alert('Save Edits Error: ' + err.message);
        }
    };

    window.rejectCurrentDraft = async function () {
        if (!state.currentAiDraft) {
            alert('No active draft to reject.');
            return;
        }

        const reason = prompt('Please enter a rejection reason (optional):', 'Requirements revised / duplicate alert');
        if (reason === null) return; // user cancelled prompt

        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/ai-builder/drafts/${state.currentAiDraft.id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reason: reason || 'Rejected by user',
                    actor: state.user
                })
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error);

            state.currentAiDraft = json.data;
            renderAiDraft(json.data);
            loadAiConfigurations('all');

            showToast(`Draft rejected and archived. Reason: ${reason}`);
        } catch (err) {
            alert('Reject Error: ' + err.message);
        }
    };

    window.activateCurrentDraft = async function () {
        if (!state.currentAiDraft) {
            alert('No draft loaded for activation.');
            return;
        }

        const outcomeMsg = document.getElementById('aiActivationOutcomeMsg');

        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/ai-builder/drafts/${state.currentAiDraft.id}/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actor: state.user
                })
            });

            const json = await res.json();

            if (!res.ok) {
                // Blocked (e.g. role unauthorized or validation failure)
                if (outcomeMsg) {
                    outcomeMsg.style.display = 'block';
                    outcomeMsg.style.background = '#fee2e2';
                    outcomeMsg.style.color = '#9f1239';
                    outcomeMsg.style.border = '1px solid #fecdd3';
                    outcomeMsg.innerHTML = `<strong>⚠️ Activation Denied:</strong> ${escapeHtml(json.error || json.message)}`;
                }
                showToast(`Activation Blocked: Role '${state.user.role}' not authorized.`);
                return;
            }

            state.currentAiDraft = json.data;
            renderAiDraft(json.data);
            loadAiConfigurations('all');

            if (outcomeMsg) {
                outcomeMsg.style.display = 'block';
                outcomeMsg.style.background = '#dcfce7';
                outcomeMsg.style.color = '#15803d';
                outcomeMsg.style.border = '1px solid #bbf7d0';
                outcomeMsg.innerHTML = `<strong>✓ Configuration Activated:</strong> Alert '${escapeHtml(json.data.name)}' is now live in enterprise event monitoring. Activated by ${escapeHtml(json.data.activatedBy.name)} (${escapeHtml(json.data.activatedBy.role)}).`;
            }

            showToast('Configuration formally activated into live monitoring!');
        } catch (err) {
            alert('Activation Request Error: ' + err.message);
        }
    };

    window.loadAiConfigurations = async function (filterStatus = 'all') {
        const container = document.getElementById('aiConfigurationsTableContainer');
        if (!container) return;

        // Update active filter pill style
        document.querySelectorAll('.ai-filter-pill').forEach(p => {
            p.classList.toggle('active', p.getAttribute('data-filter') === filterStatus);
            if (p.getAttribute('data-filter') === filterStatus) {
                p.style.background = '#9333ea';
                p.style.color = 'white';
                p.style.borderColor = '#9333ea';
            } else {
                p.style.background = 'white';
                p.style.color = '#475569';
                p.style.borderColor = 'var(--border)';
            }
        });

        try {
            const queryParam = filterStatus === 'all' ? '' : `?status=${filterStatus}`;
            const res = await fetch(`${API_BASE}/bulk-trigger/ai-builder/drafts${queryParam}`);
            if (!res.ok) return;

            const json = await res.json();
            const configs = json.data || [];

            if (configs.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;">No configurations found in this view.</div>';
                return;
            }

            container.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
                    ${configs.map(c => {
                        const isDraft = c.status === 'draft';
                        const isActive = c.status === 'active';
                        const isRejected = c.status === 'rejected';

                        const badgeColor = isActive ? 'background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;' :
                                          isRejected ? 'background: #fee2e2; color: #b91c1c; border: 1px solid #fecdd3;' :
                                          'background: #fef3c7; color: #b45309; border: 1px solid #fde68a;';

                        return `
                            <div style="background: white; border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.02);">
                                <div>
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                        <span style="font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 12px; text-transform: uppercase; ${badgeColor}">${c.status}</span>
                                        <span style="font-size: 0.7rem; color: #64748b;">${new Date(c.updatedAt).toLocaleDateString()}</span>
                                    </div>
                                    <h5 style="font-size: 0.95rem; font-weight: 800; color: #0f172a; margin: 0 0 6px 0;">${escapeHtml(c.name)}</h5>
                                    <p style="font-size: 0.76rem; color: #64748b; margin: 0 0 10px 0; line-height: 1.4;">${escapeHtml(c.description || '')}</p>
                                    
                                    <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 0.74rem; margin-bottom: 10px;">
                                        <div>Trigger: <strong style="font-family: monospace; color: #2563eb;">${escapeHtml(c.triggers?.eventKey || 'N/A')}</strong></div>
                                        <div>Condition: <strong>${escapeHtml(c.conditions?.metric || '')} ${escapeHtml(c.conditions?.comparator || '')} ${c.conditions?.thresholdValue}</strong></div>
                                        <div>Recipients: <strong>${(c.recipients || []).map(r => r.role || r.target).join(', ')}</strong></div>
                                    </div>
                                </div>

                                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 10px; margin-top: 4px;">
                                    <span style="font-size: 0.7rem; color: #64748b;">${isActive ? `Activated by ${escapeHtml(c.activatedBy?.name || 'Admin')}` : 'Requires user approval'}</span>
                                    <button onclick="loadAiDraftIntoWorkspace('${c.id}')" style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; padding: 5px 10px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; cursor: pointer;">
                                        Inspect / Review →
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
            if (window.renderLucideIcons) window.renderLucideIcons();
        } catch (err) {
            console.warn('[BulkTrigger] Failed to load AI configs:', err);
        }
    };

    window.loadAiDraftIntoWorkspace = async function (draftId) {
        try {
            const res = await fetch(`${API_BASE}/bulk-trigger/ai-builder/drafts/${draftId}`);
            if (!res.ok) throw new Error('Failed to fetch draft.');

            const json = await res.json();
            state.currentAiDraft = json.data;
            renderAiDraft(json.data);
            showToast(`Loaded ${json.data.id} into review workspace.`);
        } catch (err) {
            alert('Failed to load draft: ' + err.message);
        }
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       9. TAB NAVIGATION & HELPERS
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    function bindEventListeners() {
        // Tab buttons
        document.querySelectorAll('.bulk-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = btn.getAttribute('data-tab');
                switchToTab(target);
            });
        });

        // Action selector cards
        document.querySelectorAll('.action-select-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.action-select-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                state.activeAction = card.getAttribute('data-action') || 'EMAIL_NOTIFICATION';
                validateSelection();
            });
        });
    }

    const TAB_ALIASES = {
        'trigger_builder': 'trigger',
        'builder': 'trigger',
        'trigger_setup': 'trigger',
        'batch_monitor': 'batch_monitor',
        'monitor': 'batch_monitor',
        'dispatch_engine': 'otp_studio',
        'otp_security': 'otp_studio',
        'ai_builder': 'ai_builder',
        'builder_ai': 'ai_builder',
        'audit_logs': 'audit_trail',
        'audit_review': 'audit_trail',
        'audit_trail': 'audit_trail'
    };

    async function switchToTab(tabId) {
        const resolvedTab = TAB_ALIASES[tabId] || tabId;
        state.activeTab = resolvedTab;
        document.querySelectorAll('.bulk-tab-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tab') === resolvedTab);
        });
        document.querySelectorAll('.bulk-tab-pane').forEach(p => {
            p.style.display = p.id === `pane_${resolvedTab}` ? 'block' : 'none';
        });

        if (resolvedTab === 'batch_monitor') {
            await refreshBatchMonitorView();
        } else if (resolvedTab === 'audit_trail') {
            await loadAuditLogs();
        }
    }
    window.switchToTab = switchToTab;

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: #0f172a; color: white; padding: 12px 20px; border-radius: 12px; font-size: 0.82rem; font-weight: 700; z-index: 10000; box-shadow: 0 10px 25px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 8px; border: 1px solid #334155;';
        toast.innerHTML = `<span style="color: #10b981;">✓</span> <span>${escapeHtml(msg)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3400);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})();
