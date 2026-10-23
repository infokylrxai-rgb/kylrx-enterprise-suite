import { db, onSnapshot } from './firebase-config.js';
import { collection } from "./firebase-config.js";

/**
 * Policy Center client service.
 *
 * All reads and writes go through the backend (/api/policies), which keeps every organization's
 * policies separate and responds only after Firestore confirmed a write. Failures are thrown
 * with the server's message so the page can show them (no silent local / direct-write fallback).
 * Firestore listeners are used only as a "something changed" signal to refetch.
 */
const API_HOST = (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : window.location.origin);
const API_BASE = `${API_HOST}/api/policies`;
const REQUEST_TIMEOUT_MS = 25000;

let cachedPolicies = [];
let cachedAuditLogs = [];

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

// Calls `refetch` whenever the Firestore collection changes (debounced)
function watchCollection(name, refetch) {
    let timer = null;
    try {
        return onSnapshot(collection(db, name), () => {
            clearTimeout(timer);
            timer = setTimeout(refetch, 400);
        }, (err) => console.warn(`[POLICY] ${name} listener notice:`, err.message));
    } catch (err) {
        console.warn(`[POLICY] Could not watch ${name}:`, err.message);
        return () => {};
    }
}

/** This organization's active policies */
export async function getActivePolicies() {
    try {
        cachedPolicies = (await api('')).data || [];
    } catch (err) {
        console.warn('[POLICY] Could not load policies:', err.message);
    }
    return cachedPolicies;
}

/** Live policy list (refetched from the server whenever Firestore changes) */
export function listenToPolicies(callback) {
    return watchCollection('policies', async () => callback(await getActivePolicies()));
}

/** This organization's policy audit trail */
export async function getPolicyAuditLogs() {
    try {
        cachedAuditLogs = (await api('/audit-logs')).data || [];
    } catch (err) {
        console.warn('[POLICY] Could not load audit logs:', err.message);
    }
    return cachedAuditLogs;
}

/** Live audit trail (latest 15 entries) */
export function listenToAuditLogs(callback) {
    return watchCollection('policy_audit', async () => callback((await getPolicyAuditLogs()).slice(0, 15)));
}

/** Deploy a new policy; resolves with its id only once Firebase saved it */
export async function createPolicy(policyData) {
    const data = await api('', { method: 'POST', body: policyData });
    if (data.data) cachedPolicies.unshift(data.data);
    return data.id;
}

/** Retire and delete a policy */
export async function deletePolicy(policyId) {
    await api(`/${encodeURIComponent(policyId)}`, { method: 'DELETE' });
    cachedPolicies = cachedPolicies.filter(p => p.id !== policyId);
    return { success: true };
}

/** Save the auto-assignment toggle */
export async function updateAutoAssignConfig(isEnabled) {
    await api('/auto-assign', { method: 'POST', body: { enabled: !!isEnabled } });
}

/** Current auto-assignment setting */
export async function getAutoAssignConfig() {
    try {
        return (await api('/auto-assign')).enabled !== false;
    } catch (err) {
        console.warn('[POLICY] Could not load auto-assign setting:', err.message);
        return true;
    }
}

/** Save selective departmental routing */
export async function updateSelectiveRouting(selectedDepts) {
    await api('/selective-routing', { method: 'POST', body: { departments: selectedDepts } });
}

/** Save a custom compliance plan; resolves with its id */
export async function createCustomCompliancePlan(planData) {
    return (await api('/custom-plan', { method: 'POST', body: planData })).id;
}

/** Compliance metrics computed by the server from this organization's data */
export async function getCompliancePulse() {
    try {
        return (await api('/compliance-pulse')).data;
    } catch (err) {
        console.warn('[POLICY] Could not load compliance pulse:', err.message);
        return { overallRate: 0, overdueCount: 0, blockedCount: 0, totalEmployees: 0, unavailable: true };
    }
}

/** Version archive */
export async function getVersionHistory() {
    try {
        return (await api('/versions')).data || [];
    } catch (err) {
        console.warn('[POLICY] Could not load version history:', err.message);
        return [];
    }
}
