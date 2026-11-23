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
// It does not exist on a deployed host, so the import fails quietly and the placeholders stay.
const local = await import('./firebase-web-config.local.js').then(m => m.firebaseWebConfigLocal, () => null);
export const firebaseWebConfig = local || placeholders;

/** True once the placeholders have been replaced */
export const isFirebaseWebConfigSet = () => !Object.values(firebaseWebConfig).some(v => String(v).includes('CHANGE_ME'));
