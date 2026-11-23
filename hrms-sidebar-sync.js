import { db, auth, onAuthStateChanged, doc, getDoc, collection, query, where, getDocs } from "./firebase-config.js";

/**
 * HRMS Suite Sidebar & Profile Synchronization
 * Shows the SIGNED-IN HR user's name and role across all HRMS pages.
 * Falls back to 'Savitha Balraju' / 'Strategic Operations' / 'SB' only when no session is cached.
 */
export function initHrmsSidebar() {
    function friendlyRole(role) {
        const lower = String(role || '').toLowerCase();
        if (['hrms', 'hr_admin', 'hr', 'admin', 'super_admin', 'superadmin'].includes(lower)) {
            return 'Strategic Operations';
        }
        return role || 'Strategic Operations';
    }

    function updateHrmsUI(name, role) {
        let finalName = name
            || localStorage.getItem('userName')
            || localStorage.getItem('hrms_name')
            || localStorage.getItem('hrms_manager_name')
            || 'Savitha Balraju';
        if (finalName.includes('@')) {
            const prefix = finalName.split('@')[0];
            finalName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }

        const finalRole = friendlyRole(role || localStorage.getItem('hrms_manager_role') || localStorage.getItem('userRole'));

        const parts = finalName.trim().split(/[\s._-]+/).filter(Boolean);
        const initials = parts.length > 1
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : (parts[0] ? parts[0].slice(0, 2).toUpperCase() : 'SB');

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

    window.updateHrmsProfileUI = updateHrmsUI;

    window.logout = async () => {
        try {
            if (auth && auth.signOut) await auth.signOut();
        } catch (e) {
            console.warn("Logout error:", e);
        }
        localStorage.clear();
        window.location.href = 'index.html';
    };

    // Show the cached identity immediately (defaults to 'Savitha Balraju' only when nothing is cached),
    // then confirm from the signed-in user's Firestore profile so the real HR user's name is shown.
    updateHrmsUI();

    if (auth && typeof onAuthStateChanged === 'function') {
        onAuthStateChanged(auth, async (user) => {
            if (!user) { updateHrmsUI(); return; }
            try {
                const snap = await getDoc(doc(db, 'users', user.uid));
                if (snap.exists()) {
                    const d = snap.data();
                    updateHrmsUI(d.name || d.displayName || user.displayName || user.email, d.role || 'hrms');
                    return;
                }
            } catch (e) {
                console.warn('HRMS sidebar profile load failed:', e);
            }
            updateHrmsUI(user.displayName || user.email, 'hrms');
        });
    }
}

// Auto-run when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHrmsSidebar);
} else {
    initHrmsSidebar();
}
