/**
 * Admin Suite Sidebar & Header Interlink Synchronization
 * Admin portal is fully isolated — no HRMS links injected per user requirement.
 */
export function initAdminInterlink() {
    // Admin portal isolation: do NOT inject any HRMS links into admin sidebar or header.
    // All admin pages stay within the admin portal only.
    return;
}

// Auto-run when script loads or DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminInterlink);
} else {
    initAdminInterlink();
}
