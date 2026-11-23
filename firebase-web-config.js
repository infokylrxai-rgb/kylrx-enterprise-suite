/**
 * Firebase web app configuration: the ONE place the browser learns which Firebase project to use.
 *
 * Handover step: replace every CHANGE_ME value below with your own web app's config
 * (Firebase console > Project settings > General > Your apps > Web app > SDK setup and configuration > Config).
 * These values identify the project to the browser; they are public by design, and access is
 * protected by Firebase Authentication and the Firestore / Storage security rules.
 */
const placeholders = {
    apiKey: 'CHANGE_ME',
    authDomain: 'CHANGE_ME.firebaseapp.com',
    projectId: 'CHANGE_ME',
    storageBucket: 'CHANGE_ME.firebasestorage.app',
    messagingSenderId: 'CHANGE_ME',
    appId: 'CHANGE_ME'
};

// Local development: an optional, git-ignored firebase-web-config.local.js replaces the placeholders.
const local = await import('./firebase-web-config.local.js').then(m => m.firebaseWebConfigLocal, () => null);

/**
 * Deployed hosts have no local override, so the config comes from the server, which builds
 * it from its environment (GET /api/public-config). Keeping the values out of this file is
 * deliberate and enforced by tests/firebase-web-config-committed.test.mjs: it means the repo
 * carries no project-specific values and a host is repointed by changing env vars alone.
 * Any failure falls through to the placeholders, exactly as before.
 */
async function fromServer() {
    try {
        const res = await fetch('/api/public-config', { credentials: 'same-origin' });
        if (!res.ok) return null;
        const cfg = (await res.json()).firebase;
        if (!cfg || Object.values(cfg).some(v => !v || String(v).includes('CHANGE_ME'))) return null;
        return cfg;
    } catch (_) {
        return null;
    }
}

// Local override wins, so development never makes this request and its behaviour is unchanged.
export const firebaseWebConfig = local || (await fromServer()) || placeholders;

/** True once the placeholders have been replaced */
export const isFirebaseWebConfigSet = () => !Object.values(firebaseWebConfig).some(v => String(v).includes('CHANGE_ME'));
