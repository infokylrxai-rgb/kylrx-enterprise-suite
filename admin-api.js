/**
 * Shared client for the admin pages' backend APIs.
 *
 * - getWriteStatus(): whether Firebase currently accepts saves (and whether the local test
 *   database is in use), cached for a minute.
 * - createApi(base): request helper for one API; saves are not sent while Firebase refuses
 *   writes, errors carry the server's message, and requests time out after 25 s.
 * - createOverviewStore(load): one overview shared by a page, refreshed every 30 s and after
 *   each save.
 */
const API_HOST = (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : window.location.origin);
const REQUEST_TIMEOUT_MS = 25000;
const REFRESH_MS = 30000;

let writeStatusCache = { at: 0, value: null };
export async function getWriteStatus() {
    if (writeStatusCache.value && Date.now() - writeStatusCache.at < 60000) return writeStatusCache.value;
    try {
        const res = await fetch(`${API_HOST}/api/firestore/write-status`);
        const json = await res.json();
        writeStatusCache = { at: Date.now(), value: { accepting: json.accepting !== false, localTestDatabase: json.localTestDatabase === true } };
    } catch (_) {
        writeStatusCache = { at: Date.now(), value: { accepting: true, localTestDatabase: false } };
    }
    return writeStatusCache.value;
}

export const SAVING_PAUSED_MESSAGE = 'Saving is paused: Firebase is not accepting changes right now (the daily Firestore write quota is used up). Nothing was sent or saved. Please try again after the quota resets.';

export function createApi(base) {
    return async function api(path = '', { method = 'GET', body } = {}) {
        if (method !== 'GET' && !(await getWriteStatus()).accepting) throw new Error(SAVING_PAUSED_MESSAGE);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(`${API_HOST}${base}${path}`, {
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
    };
}

export function createOverviewStore(load) {
    let overview = null;
    let loading = null;
    let timer = null;
    const subscribers = new Set();
    const errorSubscribers = new Set();

    function refresh() {
        if (!loading) {
            loading = load()
                .then(data => {
                    overview = data;
                    subscribers.forEach(cb => { try { cb(overview); } catch (e) { console.error('[ADMIN] Render error:', e); } });
                    return overview;
                })
                .catch(err => {
                    errorSubscribers.forEach(cb => cb(err));
                    throw err;
                })
                .finally(() => { loading = null; });
        }
        return loading;
    }

    return {
        refresh,
        get: () => (overview ? Promise.resolve(overview) : refresh()),
        /** Calls cb(overview) now (if loaded) and after every refresh */
        subscribe(cb, onError) {
            subscribers.add(cb);
            if (onError) errorSubscribers.add(onError);
            if (overview) cb(overview);
            if (!timer) {
                timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, REFRESH_MS);
                refresh().catch(() => {});
            }
            return () => { subscribers.delete(cb); if (onError) errorSubscribers.delete(onError); };
        },
        /** Runs a save, then reloads the overview so the page shows what Firebase now holds */
        async afterWrite(promise) {
            const result = await promise;
            await refresh().catch(() => {});
            return result;
        }
    };
}

/** YYYY-MM-DD in the browser's time zone */
export function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
