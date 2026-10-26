/**
 * Firestore side of the notification pages: who the signed-in user is, the organization-scoped
 * query, and the read-state writes. The organization comes from the verified token claims
 * (via firebase-config.js tenantReady), never from localStorage.
 */
import {
    auth, db, tenantReady, getActiveOrgId,
    collection, query, where, orderBy, limit, doc, getDoc, updateDoc, writeBatch, arrayUnion, arrayRemove
} from './firebase-config.js';
import { chunk } from './notification-read-state.js';

/** { uid, orgId, role } of the signed-in user; throws when there is no session or no organization */
export async function loadIdentity() {
    await tenantReady;
    const user = auth.currentUser;
    if (!user) throw new Error('You are signed out. Please sign in again.');
    const orgId = getActiveOrgId();
    if (!orgId) throw new Error('No organization found for the signed-in user.');

    let role = (await user.getIdTokenResult()).claims.role;
    if (!role) {
        // Accounts created before role claims existed: the server-written profile has the role
        try { role = (await getDoc(doc(db, 'users', user.uid))).data()?.role; } catch (_) {}
    }
    return { uid: user.uid, orgId, role: role || 'employee' };
}

/**
 * The latest notifications of the user's organization. Notifications written before they carried
 * an orgId match no organization and are therefore shown to nobody (see scripts/migrate-tenant-orgid.js).
 */
export function orgNotificationsQuery(identity, max = 60) {
    return query(collection(db, 'notifications'), where('orgId', '==', identity.orgId), orderBy('timestamp', 'desc'), limit(max));
}

/** Add (read = true) or remove (read = false) the user's uid in the notification's readBy */
export function setReadState(id, uid, read) {
    return updateDoc(doc(db, 'notifications', id), { readBy: read ? arrayUnion(uid) : arrayRemove(uid) });
}

/** Mark many notifications read for the user, in batches of at most 500 writes */
export async function markAllRead(ids, uid) {
    for (const part of chunk(ids, 500)) {
        const batch = writeBatch(db);
        part.forEach(id => batch.update(doc(db, 'notifications', id), { readBy: arrayUnion(uid) }));
        await batch.commit();
    }
}

/** A message a person can act on, with the real reason */
export function failureReason(err) {
    if (err && err.code === 'permission-denied') return 'Permission denied: this notification does not belong to your organization or you may not change it.';
    return (err && err.message) || 'Unknown error';
}
