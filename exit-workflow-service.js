/**
 * Exit & Offboarding client service.
 *
 * All reads and writes go through the backend (/api/exits), which keeps each organization's
 * offboarding cases separate and responds only after Firestore confirmed a write. Errors are
 * thrown with the server's message so the page can show them.
 */
const API_HOST = (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : window.location.origin);
const API_BASE = `${API_HOST}/api/exits`;
const REQUEST_TIMEOUT_MS = 25000;

async function api(path = '', { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) {
            throw new Error(json.message || json.error || `Request failed (HTTP ${res.status})`);
        }
        return json;
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('The server did not respond in time. Please try again.');
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

/** Offboarding cases of this organization */
export async function getExits() {
    return (await api('')).data || [];
}

/** Figures computed from this organization's exits */
export async function getExitAnalytics() {
    return (await api('/analytics')).data;
}

/** Active employees who can be offboarded (with exitInProgress flags) */
export async function getExitEmployees() {
    return (await api('/employees')).data || [];
}

/** Start an exit; resolves once Firebase saved it */
export async function initiateExit(employeeId, data) {
    return api('', { method: 'POST', body: { employeeId, lwd: data.lwd, type: data.type, reason: data.reason } });
}

/** Move an exit to the next stage */
export async function advanceExit(exitId) {
    return api(`/${encodeURIComponent(exitId)}/advance`, { method: 'POST' });
}

/** Tick or untick a clearance checklist item */
export async function updateExitChecklist(exitId, field, checked) {
    return api(`/${encodeURIComponent(exitId)}/checklist`, { method: 'PATCH', body: { field, checked } });
}

/** Close an exit at "F&F Pending" and mark the employee as exited */
export async function finalizeExit(exitId) {
    return api(`/${encodeURIComponent(exitId)}/finalize`, { method: 'POST' });
}
