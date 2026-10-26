/**
 * Admin Suite Sidebar & Header Interlink Synchronization
 * Admin portal is fully isolated — no HRMS links injected per user requirement.
 */

import { db, onSnapshot, registerListener } from './firebase-config.js';
import { initCustomApps } from './custom-apps.js';

export function initAdminInterlink() {
    // Admin portal isolation: do NOT inject any HRMS links into admin sidebar or header.
    // All admin pages stay within the admin portal only.

    // 1. Ensure current page is highlighted active in sidebar
    try {
        const currentPage = window.location.pathname.split('/').pop() || 'admin-dashboard.html';
        const navLinks = [...document.querySelectorAll('.sidebar .nav-link')];
        const matches = navLinks.filter(link => {
            const href = link.getAttribute('href');
            return href && href.split('#')[0].split('?')[0] === currentPage;
        });
        // Several menu entries can point to the same page (e.g. Customize Layout); highlight only one,
        // preferring the one the page itself marked active
        const keep = matches.find(link => link.classList.contains('active')) || matches[0];
        matches.forEach(link => link.classList.toggle('active', link === keep));
    } catch (e) {
        console.warn('[SIDEBAR] Nav highlight notice:', e);
    }

    // 2. Setup universal logout button handler
    try {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn && !logoutBtn.dataset.bound) {
            logoutBtn.dataset.bound = 'true';
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                try {
                    localStorage.removeItem('hr_user_id');
                    localStorage.removeItem('hr_user_role');
                    localStorage.removeItem('hr_user_email');
                    localStorage.removeItem('hr_user_name');
                } catch(err) {}
                window.location.href = 'login.html';
            });
        }
    } catch (e) {
        console.warn('[SIDEBAR] Logout bind notice:', e);
    }

    // 3. Custom apps (sidebar list, App Registry modal): one shared, per-organization implementation
    initCustomApps();

    // 5. Ensure lucide icons are rendered
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

/* Universal Centered Alert Modal */
export function initUniversalCenteredAlert() {
    if (window._hasUniversalCenteredAlert) return;
    window._hasUniversalCenteredAlert = true;

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
                try { window.lucide.createIcons(); } catch(e) {}
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
                try { if (okBtn) okBtn.focus(); } catch(e) {}
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
}

// Auto-run when script loads or DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initAdminInterlink();
        initUniversalCenteredAlert();
    });
} else {
    initAdminInterlink();
    initUniversalCenteredAlert();
}

