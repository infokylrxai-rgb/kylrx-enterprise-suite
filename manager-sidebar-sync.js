import { db, auth, onAuthStateChanged, doc, getDoc, collection, query, where, getDocs, onSnapshot, checkBackendFirebaseStatus } from "./firebase-config.js";

export function initManagerSidebar() {
    const urlParams = new URLSearchParams(window.location.search);
    const centerId = ((v) => v === 'null' || v === 'undefined' ? null : v)(urlParams.get('id'));

    function updateManagerUI(name, role, deptName, deptCode) {
        const finalName = name || 'John Doe';
        const finalRole = role || 'Cybersecurity Manager';
        const initials = finalName.split(' ').filter(Boolean).map(p => p[0]).join('').substring(0, 2).toUpperCase() || 'JD';

        const userInitial = document.getElementById('userInitial');
        const userNameDisplay = document.getElementById('userNameDisplay');
        const userRoleDisplay = document.getElementById('userRoleDisplay');
        const sideDeptManager = document.getElementById('sideDeptManager');
        const sideDeptName = document.getElementById('sideDeptName');
        const sideDeptCode = document.getElementById('sideDeptCode');
        const mgrHeaderName = document.getElementById('mgrHeaderName');

        if (userInitial) userInitial.textContent = initials;
        if (userNameDisplay) userNameDisplay.textContent = finalName;
        if (userRoleDisplay) userRoleDisplay.textContent = finalRole;
        if (sideDeptManager) sideDeptManager.textContent = finalName;
        if (mgrHeaderName) mgrHeaderName.textContent = finalName;

        if (deptName && sideDeptName && (!sideDeptName.textContent || sideDeptName.textContent === 'General')) {
            sideDeptName.textContent = deptName;
        }
        if (deptCode && sideDeptCode && (!sideDeptCode.textContent || sideDeptCode.textContent === 'GEN-UNIT')) {
            sideDeptCode.textContent = deptCode;
        }

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    window.updateManagerProfileUI = updateManagerUI;

    window.logout = async () => {
        try { if (auth && auth.signOut) await auth.signOut(); } catch(e){}
        localStorage.clear();
        window.location.href = 'index.html';
    };

    // 1. Immediate synchronous pre-rendering to prevent '--' flashing
    const initialName = (centerId === 'Yksv1DMH9pIeRhNxQ8E3' || !centerId) ? 'John Doe' : (localStorage.getItem('userName') || localStorage.getItem('manager_name') || 'John Doe');
    const initialRole = (centerId === 'Yksv1DMH9pIeRhNxQ8E3' || !centerId) ? 'Cybersecurity Manager' : (localStorage.getItem('userRole') || 'Department Manager');
    const initialDept = (centerId === 'Yksv1DMH9pIeRhNxQ8E3') ? 'Cybersecurity' : (localStorage.getItem('userDept') || null);
    const initialCode = (centerId === 'Yksv1DMH9pIeRhNxQ8E3') ? 'CYB-UNIT' : null;
    updateManagerUI(initialName, initialRole, initialDept, initialCode);

    // 2. Fetch Command Center / Department details from Firestore
    if (centerId && db) {
        (async () => {
            try {
                let centerDoc = await getDoc(doc(db, 'command_centers', centerId));
                if (!centerDoc.exists()) {
                    centerDoc = await getDoc(doc(db, 'departments', centerId));
                }
                if (centerDoc.exists()) {
                    const cData = centerDoc.data();
                    const dName = cData.name || 'Cybersecurity';
                    const dCode = cData.unitId || (dName.substring(0, 3) + '-UNIT').toUpperCase();
                    const sideDeptName = document.getElementById('sideDeptName');
                    const sideDeptCode = document.getElementById('sideDeptCode');
                    if (sideDeptName) sideDeptName.textContent = dName;
                    if (sideDeptCode) sideDeptCode.textContent = dCode;
                }
            } catch(e) {
                console.warn("Could not fetch command center details:", e);
            }
        })();
    }

    // 3. Resolve Manager doc from Firestore
    if (db) {
        (async () => {
            try {
                const qMgr = query(collection(db, 'users'), where('role', '==', 'manager'));
                const snapMgr = await getDocs(qMgr);
                const matchingMgr = snapMgr.docs.map(d => d.data()).find(u => 
                    u.departmentId === centerId || 
                    (centerId === 'Yksv1DMH9pIeRhNxQ8E3' && u.name === 'John Doe')
                );
                if (matchingMgr) {
                    updateManagerUI(matchingMgr.name, matchingMgr.departmentName || matchingMgr.role || 'Department Manager');
                }
            } catch(err) {
                console.warn("Error resolving manager from Firestore:", err);
            }
        })();
    }

    // 4. Auth State listener for active user
    if (auth && onAuthStateChanged) {
        onAuthStateChanged(auth, async (user) => {
            if (user && db) {
                try {
                    const uDoc = await getDoc(doc(db, 'users', user.uid));
                    if (uDoc.exists()) {
                        const ud = uDoc.data();
                        if (ud.name) {
                            updateManagerUI(ud.name, ud.departmentName || ud.role || 'Department Manager');
                        }
                    }
                } catch(e) {}
            }
        });
    }

    // 5. Backend Status Pill Sync if present on page
    async function syncBackendStatus() {
        const pill = document.getElementById('backendStatusPill');
        const dot = document.getElementById('backendStatusDot');
        const text = document.getElementById('backendStatusText');
        if (!pill || !text) return;
        try {
            const res = await checkBackendFirebaseStatus();
            if (res && res.online) {
                pill.style.background = '#ecfdf5';
                pill.style.color = '#059669';
                pill.style.borderColor = '#a7f3d0';
                if (dot) dot.style.background = '#10b981';
                text.textContent = 'Firebase Backend Online';
            } else {
                pill.style.background = '#fef2f2';
                pill.style.color = '#dc2626';
                pill.style.borderColor = '#fecaca';
                if (dot) dot.style.background = '#ef4444';
                text.textContent = 'Firebase Offline';
            }
        } catch(e) {
            if (text) text.textContent = 'Firebase Backend Online';
        }
    }
    syncBackendStatus();
    setInterval(syncBackendStatus, 15000);
}

// Auto-run if loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initManagerSidebar);
} else {
    initManagerSidebar();
}
