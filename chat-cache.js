/**
 * Chat cache in localStorage, owned by the signed-in uid.
 * Keys are "kylrx_chat:<uid>:<name>", so another user on the same browser never reads this user's messages.
 * syncChatCacheOwner(uid) (call when sign-in resolves) deletes every other user's entries and the old
 * un-keyed ones (fs_col_messages, fs_chat_*); clearChatCaches() (call on logout) deletes all of them.
 */
export const CHAT_CACHE_PREFIX = 'kylrx_chat:';
const LEGACY = (k) => k === 'fs_col_messages' || k.startsWith('fs_chat_');

function keysOf(storage) {
    const out = [];
    for (let i = 0; i < storage.length; i++) out.push(storage.key(i));
    return out;
}

/** Cache bound to one uid; with no uid it reads nothing and stores nothing */
export function chatCache(uid, storage = globalThis.localStorage) {
    const key = (name) => `${CHAT_CACHE_PREFIX}${uid}:${name}`;
    return {
        get(name, fallback = null) {
            if (!uid) return fallback;
            try { const raw = storage.getItem(key(name)); return raw === null ? fallback : JSON.parse(raw); } catch (_) { return fallback; }
        },
        set(name, value) {
            if (!uid) return;
            try { storage.setItem(key(name), JSON.stringify(value)); } catch (_) { /* quota: the cache is optional */ }
        },
        remove(name) {
            if (uid) storage.removeItem(key(name));
        }
    };
}

/** Keep only this uid's entries; returns how many other entries were deleted */
export function syncChatCacheOwner(uid, storage = globalThis.localStorage) {
    const own = `${CHAT_CACHE_PREFIX}${uid}:`;
    let removed = 0;
    for (const k of keysOf(storage)) {
        if ((k.startsWith(CHAT_CACHE_PREFIX) && !(uid && k.startsWith(own))) || LEGACY(k)) { storage.removeItem(k); removed++; }
    }
    return removed;
}

/** Logout: no chat cache survives */
export function clearChatCaches(storage = globalThis.localStorage) {
    return syncChatCacheOwner(null, storage);
}
