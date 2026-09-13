import { db, auth, onAuthStateChanged, doc, getDoc, collection, query, where, getDocs } from "./firebase-config.js";

/**
 * HRMS Suite Sidebar & Profile Synchronization
 * Displays HRMS Manager and Strategic Operations across all HRMS pages
 * with clean typography and zero text truncation.
 */
export function initHrmsSidebar() {
    function updateHrmsUI(name, role) {
        let finalName = name || localStorage.getItem('hrms_manager_name') || 'Savitha Balraju';
        if (finalName === 'HRMS Manager' || finalName === 'Savitha' || finalName.toLowerCase().startsWith('employee') || finalName.toLowerCase() === 'marry doe') {
            finalName = 'Savitha Balraju';
        }
        if (finalName.includes('@')) {
            const prefix = finalName.split('@')[0];
            finalName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }

        let finalRole = role || localStorage.getItem('hrms_manager_role') || 'Strategic Operations';
        const lower = String(finalRole).toLowerCase();
        if (lower === 'hrms' || lower === 'hr_admin' || lower === 'admin') {
            finalRole = 'Strategic Operations';
        }

        const parts = finalName.trim().split(/[\s._-]+/).filter(Boolean);
        const initials = finalName === 'Savitha Balraju' ? 'SB' : (parts.length > 1 
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() 
            : (parts[0] ? parts[0].slice(0, 2).toUpperCase() : 'SB'));

        const elements = {
            userInitial: initials,
            sideUserInitial: initials,
            topUserAvatar: initials,
            userNameDisplay: finalName,
            sideUserName: finalName,
            topUserName: finalName,
            userRoleDisplay: finalRole,
            sideUserRole: finalRole,
            topUserRole: finalRole,
            welcomeUserName: finalName
        };

        Object.entries(elements).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        });

        document.querySelectorAll('.user-name').forEach(el => el.textContent = finalName);
        document.querySelectorAll('.user-role').forEach(el => el.textContent = finalRole);

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    function ensureEnterpriseInterlink() {
        // 1. Inject Enterprise Admin section into HRMS sidebars
        const nav = document.querySelector('.nav-menu');
        if (nav && !nav.querySelector('a[href*="admin-dashboard.html"]')) {
            const adminSection = document.createElement('div');
            adminSection.className = 'nav-interlink-admin-group';
            adminSection.innerHTML = `
                <div class="nav-label" style="display:flex; justify-content:space-between; align-items:center; margin-top:1.2rem; color:#4f46e5; font-weight:800; font-size:0.68rem; letter-spacing:0.06em;">
                    <span>ENTERPRISE ADMIN</span>
                    <span style="font-size:0.6rem; background:#ede9fe; color:#4338ca; padding:2px 6px; border-radius:4px; font-weight:700;">Console</span>
                </div>
                <div class="nav-item">
                    <a href="admin-dashboard.html" class="nav-link" style="color:#4338ca; font-weight:600;" title="Super Admin Console">
                        <i data-lucide="shield-check"></i>
                        <span>Super Admin Console</span>
                    </a>
                </div>
                <div class="nav-item">
                    <a href="admin-central-dashboard.html" class="nav-link" title="Command Center">
                        <i data-lucide="command"></i>
                        <span>Command Center</span>
                    </a>
                </div>
                <div class="nav-item">
                    <a href="admin-assignment-matrix.html" class="nav-link" title="Assignment Hub & Impact Simulator">
                        <i data-lucide="layers"></i>
                        <span>Assignment Hub</span>
                    </a>
                </div>
                <div class="nav-item">
                    <a href="admin-alert-builder.html" class="nav-link" title="Common Automation & Alert Builder">
                        <i data-lucide="bell-ring"></i>
                        <span>Alert Builder</span>
                    </a>
                </div>
            `;
            const configLabel = Array.from(nav.querySelectorAll('.nav-label')).find(el => el.textContent.trim().toLowerCase().includes('configuration'));
            if (configLabel) {
                nav.insertBefore(adminSection, configLabel);
            } else {
                nav.appendChild(adminSection);
            }
        }

        // 2. Top Navigation Bar Quick-Switch to Admin Console
        const headerActions = document.querySelector('.header-actions, .top-menu-bar, .hub-header');
        if (headerActions && !document.getElementById('btnQuickAdminConsole')) {
            const rightWrap = headerActions.querySelector('.qa-action-btn-group, .hub-actions, div:last-child');
            if (rightWrap) {
                const adminBtn = document.createElement('a');
                adminBtn.id = 'btnQuickAdminConsole';
                adminBtn.href = 'admin-dashboard.html';
                adminBtn.className = 'btn-quick-admin-switch';
                adminBtn.title = 'Switch to Super Admin Console';
                adminBtn.style.cssText = 'display:inline-flex; align-items:center; gap:6px; padding:6px 12px; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:10px; font-size:0.78rem; font-weight:700; text-decoration:none; transition:all 0.2s; cursor:pointer; flex-shrink:0; margin-right:8px;';
                adminBtn.innerHTML = '<i data-lucide="shield-check" size="14"></i><span>Admin Console</span>';
                adminBtn.onmouseover = () => { adminBtn.style.background = '#dbeafe'; };
                adminBtn.onmouseout = () => { adminBtn.style.background = '#eff6ff'; };
                rightWrap.insertBefore(adminBtn, rightWrap.firstChild);
            }
        }

        // 3. Make QA Role switch in payroll-disbursement also support seamless console jump
        const switchBtn = document.getElementById('btnSwitchRole');
        if (switchBtn && !switchBtn.dataset.interlinkBound) {
            switchBtn.dataset.interlinkBound = "true";
            switchBtn.setAttribute('title', 'Switch role or double-click to jump directly to Super Admin Console');
        }

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    window.updateHrmsProfileUI = updateHrmsUI;
    window.ensureEnterpriseInterlink = ensureEnterpriseInterlink;

    window.logout = async () => {
        try {
            if (auth && auth.signOut) await auth.signOut();
        } catch (e) {
            console.warn("Logout error:", e);
        }
        localStorage.clear();
        window.location.href = 'index.html';
    };

    // 1. Immediate pre-render to guarantee Savitha Balraju and Strategic Operations
    updateHrmsUI('Savitha Balraju', 'Strategic Operations');
    ensureEnterpriseInterlink();
}

// Auto-run when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHrmsSidebar);
} else {
    initHrmsSidebar();
}
