/**
 * Admin Suite Sidebar & Header Interlink Synchronization
 * Admin portal is fully isolated — no HRMS links injected per user requirement.
 */

import { db } from './firebase-config.js';
import { doc, setDoc, onSnapshot, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const DEFAULT_APPS = [
    { name: "AWS CONSOLE", url: "https://console.aws.amazon.com" },
    { name: "DATADOG", url: "https://app.datadoghq.com" }
];

export function initAdminInterlink() {
    // Admin portal isolation: do NOT inject any HRMS links into admin sidebar or header.
    // All admin pages stay within the admin portal only.

    // 1. Ensure current page is highlighted active in sidebar
    try {
        const currentPage = window.location.pathname.split('/').pop() || 'admin-dashboard.html';
        const navLinks = document.querySelectorAll('.sidebar .nav-link');
        let matched = false;
        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                const baseHref = href.split('#')[0].split('?')[0];
                if (baseHref === currentPage) {
                    link.classList.add('active');
                    matched = true;
                }
            }
        });
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

    // 3. Setup Custom App Registry functions on window if not already defined
    if (!window.openAppRegistryModal) {
        window.openAppRegistryModal = () => {
            const modal = document.getElementById('customAppsModal');
            if (modal) modal.style.display = 'flex';
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        };
    }

    if (!window.addCustomApp) {
        window.addCustomApp = async () => {
            const urlInput = document.getElementById('appUrlInput');
            const nameInput = document.getElementById('appNameInput');
            if (!urlInput) return;
            
            const url = urlInput.value.trim();
            const customName = nameInput ? nameInput.value.trim() : '';
            if (!url) return;

            try {
                let cleanUrl = url;
                if (!url.startsWith('http')) cleanUrl = 'https://' + url;
                const urlObj = new URL(cleanUrl);
                const domain = urlObj.hostname.replace('www.', '');
                const appName = customName || domain.split('.')[0].toUpperCase();

                if (db) {
                    const appsRef = doc(db, "system_configs", "admin_custom_apps");
                    await setDoc(appsRef, {
                        customApps: arrayUnion({ name: appName, url: cleanUrl })
                    }, { merge: true });
                }

                urlInput.value = '';
                if (nameInput) nameInput.value = '';
            } catch (e) {
                alert("Invalid URL structure.");
            }
        };
    }

    if (!window.removeAppFromServer) {
        window.removeAppFromServer = async (url, name) => {
            if (db) {
                const appsRef = doc(db, "system_configs", "admin_custom_apps");
                await setDoc(appsRef, {
                    customApps: arrayRemove({ name: name, url: url })
                }, { merge: true });
            }
        };
    }

    // 4. Initialize Custom Apps in sidebar if container exists
    const customList = document.getElementById('customAppsList');
    if (customList && !customList.dataset.initialized && db) {
        customList.dataset.initialized = 'true';
        try {
            const appsRef = doc(db, "system_configs", "admin_custom_apps");
            onSnapshot(appsRef, async (snapshot) => {
                let apps = [];
                if (snapshot.exists()) {
                    apps = snapshot.data().customApps || [];
                } else {
                    try {
                        await setDoc(appsRef, { customApps: DEFAULT_APPS, customAppsInitialized: true }, { merge: true });
                        apps = DEFAULT_APPS;
                    } catch(e) {}
                }
                renderAppsUI(apps);
            }, (err) => {
                console.warn('[CUSTOM APPS] Snapshot notice:', err);
            });
        } catch (err) {
            console.warn('[CUSTOM APPS] Init notice:', err);
        }
    }

    // 5. Ensure lucide icons are rendered
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

function renderAppsUI(apps) {
    const list = document.getElementById('customAppsList');
    if (list) {
        list.innerHTML = apps.map((app) => `
            <div class="nav-item" style="position: relative;">
                <a href="${app.url}" target="_blank" class="nav-link" style="padding-right: 32px;">
                    <i data-lucide="external-link"></i>
                    <span>${app.name}</span>
                </a>
                <button onclick="removeAppFromServer('${app.url}', '${app.name}')" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--danger); opacity: 0.5; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;" title="Remove App Mapping">
                    <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                </button>
            </div>
        `).join('');
    }

    const registryList = document.getElementById('registryAppsList');
    if (registryList) {
        registryList.innerHTML = apps.map((app) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; font-size: 0.85rem; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
                    <i data-lucide="external-link" style="width: 16px; height: 16px; color: #3b82f6; flex-shrink: 0;"></i>
                    <span style="font-weight: 700; font-size: 0.8rem; color: #0f172a;">${app.name}</span>
                </div>
                <button onclick="removeAppFromServer('${app.url}', '${app.name}')" style="background: none; border: none; color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; flex-shrink: 0;" title="Delete Mapping">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            </div>
        `).join('');
    }
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

// Auto-run when script loads or DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminInterlink);
} else {
    initAdminInterlink();
}
