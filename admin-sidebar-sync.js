/**
 * Admin Suite Sidebar & Header Interlink Synchronization
 * Guarantees direct two-way interlinking between Admin pages and the HRMS Strategic Suite.
 */
export function initAdminInterlink() {
    // Preserve strict admin page isolation per user requirement
    if (window.location.pathname.includes('admin-payroll') || window.location.pathname.includes('admin-statutory')) {
        return;
    }
    function injectHrmsLinks() {
        // 1. Sidebar Interlink: Add HRMS Strategic Hub into Admin navigation
        const nav = document.querySelector('.nav-menu');
        if (nav && !nav.querySelector('a[href*="hrms-dashboard.html"]')) {
            const hrmsItem = document.createElement('div');
            hrmsItem.className = 'nav-item hrms-interlink-item';
            hrmsItem.innerHTML = `
                <a href="hrms-dashboard.html" class="nav-link" style="color: #2563eb; font-weight: 700;" title="Open HRMS Strategic Operations Hub">
                    <i data-lucide="layout-dashboard"></i>
                    <span>HRMS Strategic Hub</span>
                </a>
            `;

            // Insert under MAIN MENU after Super Admin Console or at top of list
            const superAdminItem = Array.from(nav.querySelectorAll('.nav-item')).find(el => {
                const text = el.textContent.toLowerCase();
                return text.includes('super admin') || text.includes('admin console');
            });

            if (superAdminItem && superAdminItem.nextSibling) {
                nav.insertBefore(hrmsItem, superAdminItem.nextSibling);
            } else {
                const firstLabel = nav.querySelector('.nav-label');
                if (firstLabel && firstLabel.nextSibling) {
                    nav.insertBefore(hrmsItem, firstLabel.nextSibling);
                } else {
                    nav.prepend(hrmsItem);
                }
            }
        }

        // 2. Top Header Interlink: Add quick-switch button in header toolbar
        const headerActions = document.querySelector('.hub-actions, .header-actions, .top-nav-right, header > div:last-child');
        if (headerActions && !document.getElementById('btnQuickHrmsHub')) {
            const hrmsBtn = document.createElement('a');
            hrmsBtn.id = 'btnQuickHrmsHub';
            hrmsBtn.href = 'hrms-dashboard.html';
            hrmsBtn.className = 'btn-hub btn-hub-accent';
            hrmsBtn.title = 'Switch to HRMS Strategic Operations Hub';
            hrmsBtn.style.cssText = 'text-decoration:none; display:inline-flex; align-items:center; gap:6px; font-size:0.8rem; font-weight:700; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:8px; padding:6px 12px; transition:all 0.2s; cursor:pointer; flex-shrink:0;';
            hrmsBtn.innerHTML = '<i data-lucide="layout-dashboard" size="14"></i><span>HRMS Hub</span>';
            hrmsBtn.onmouseover = () => { hrmsBtn.style.background = '#dbeafe'; };
            hrmsBtn.onmouseout = () => { hrmsBtn.style.background = '#eff6ff'; };

            headerActions.insertBefore(hrmsBtn, headerActions.firstChild);
        }

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    injectHrmsLinks();
}

// Auto-run when script loads or DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminInterlink);
} else {
    initAdminInterlink();
}
