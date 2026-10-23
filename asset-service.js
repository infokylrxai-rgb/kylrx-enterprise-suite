/**
 * Asset Management client service.
 *
 * All reads and writes go through the backend (/api/assets), which keeps each organization's
 * assets separate and responds only after Firestore confirmed a write. Failures are thrown with
 * the server's message so the page can show them; there is no local-storage or sample-data
 * fallback that could make an unsaved asset look saved.
 */
const API_HOST = (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : window.location.origin);
const API_BASE = `${API_HOST}/api/assets`;
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

/** Provision a new asset; resolves with its id once Firebase saved it */
export async function addAsset(assetData) {
    return (await api('', { method: 'POST', body: assetData })).id;
}

/** This organization's inventory */
export async function getAssets() {
    return (await api('')).data || [];
}

/** Inventory counts */
export async function getAssetStats() {
    const json = await api('/stats');
    return {
        total: json.total || 0,
        allocated: json.allocated || 0,
        inStock: json.inStock || 0,
        repair: json.repair || 0,
        missing: json.missing || 0,
        pendingDeclarations: json.pendingDeclarations || 0
    };
}

/** Latest audit entries */
export async function getAssetLogs() {
    return (await api('/logs')).data || [];
}

/** Assign an asset to an employee of this organization */
export async function allocateAsset(assetId, employeeId, adminId, employeeName = null) {
    return api(`/${encodeURIComponent(assetId)}/allocate`, { method: 'POST', body: { employeeId, employeeName } });
}

/** Remove an asset from the inventory */
export async function deleteAsset(assetId) {
    await api(`/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
    return { success: true };
}

/* Employee actions (only the employee the asset is assigned to) */

export async function acknowledgeAssetDeclaration(assetId, employeeId, condition, signature) {
    return api(`/${encodeURIComponent(assetId)}/declaration`, { method: 'POST', body: { condition, signature } });
}

export async function reportAssetIssue(assetId, employeeId, issueType, description) {
    return api(`/${encodeURIComponent(assetId)}/issues`, { method: 'POST', body: { issueType, description } });
}

export async function initiateAssetReturn(assetId, employeeId) {
    return api(`/${encodeURIComponent(assetId)}/return`, { method: 'POST' });
}

/** Active employees of this organization (for the allocation picker) */
export async function getAssignableEmployees() {
    return (await api('/employees')).data || [];
}
