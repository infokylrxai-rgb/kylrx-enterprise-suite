/**
 * Optional login-page extras, decided by the server (GET /api/public-config).
 * When the server says demo mode is on, this adds the 1-click demo bar, the "Demo Roles" button and the
 * demo roles modal (markup in demo-login-ui.js); each choice asks the server for a session in the demo
 * organization (POST /api/auth/demo-login { role }). When it is off, nothing is added to the page.
 * No account, e-mail or password is stored in the client.
 */
import { auth } from "./firebase-config.js";
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

const apiBase = () => window.API_BASE || window.location.origin;

async function demoModeOn() {
    try {
        const res = await fetch(`${apiBase()}/api/public-config`);
        return res.ok && (await res.json()).demoMode === true;
    } catch (_) {
        return false;
    }
}

function showLoginError(message) {
    const el = document.getElementById('errorMessage');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
}

async function demoSignIn(role, setReady) {
    const buttons = document.querySelectorAll('#btnQuickSuperAdmin, #btnQuickHrAdmin, #btnQuickManager, #btnQuickEmployee, #selectSuperAdmin, #selectHrAdmin, #selectManager, #selectEmployee');
    buttons.forEach(b => { b.style.pointerEvents = 'none'; b.style.opacity = '0.6'; });
    try {
        const res = await fetch(`${apiBase()}/api/auth/demo-login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.customToken) {
            setReady(false);
            throw new Error(body.error || 'Demo login is not available.');
        }
        const credential = await signInWithCustomToken(auth, body.customToken);
        await window.kylrxFinishSignIn(credential, credential.user.email || '');
    } catch (err) {
        showLoginError(err.message || 'Demo login failed.');
        buttons.forEach(b => { b.style.pointerEvents = ''; b.style.opacity = ''; });
    }
}

async function init() {
    if (!(await demoModeOn())) return;
    const { DEMO_BAR_HTML, DEMO_ROLES_BUTTON_HTML, DEMO_MODAL_HTML } = await import('./demo-login-ui.js');

    const submit = document.getElementById('loginBtn');
    const google = document.getElementById('googleLoginBtn');
    if (!submit || !google) return;

    submit.insertAdjacentHTML('beforebegin', DEMO_BAR_HTML + '\n');
    google.insertAdjacentHTML('afterend', '\n' + DEMO_ROLES_BUTTON_HTML);
    if (google.parentElement) google.parentElement.style.gridTemplateColumns = '';
    document.body.insertAdjacentHTML('beforeend', DEMO_MODAL_HTML);

    // "Ready" follows what the server said, not a fixed label
    const ready = document.querySelector('#btnQuickSuperAdmin').closest('div').parentElement.querySelector('span:last-child');
    const setReady = (ok) => { ready.textContent = ok ? '● Ready' : '● Unavailable'; ready.style.color = ok ? '#059669' : '#dc2626'; };
    setReady(true);

    const modal = document.getElementById('demoRolesModal');
    const openModal = () => { modal.style.display = 'flex'; };
    const closeModal = () => { modal.style.display = 'none'; };
    document.getElementById('credentialsBtn').addEventListener('click', openModal);
    document.getElementById('closeDemoRolesBtn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    const roles = { btnQuickSuperAdmin: 'admin', btnQuickHrAdmin: 'hrms', btnQuickManager: 'manager', btnQuickEmployee: 'employee',
        selectSuperAdmin: 'admin', selectHrAdmin: 'hrms', selectManager: 'manager', selectEmployee: 'employee' };
    for (const [id, role] of Object.entries(roles)) {
        document.getElementById(id).addEventListener('click', () => { closeModal(); demoSignIn(role, setReady); });
    }
    if (window.lucide) window.lucide.createIcons();
}

init();
