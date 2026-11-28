/**
 * A stand-in for firebase-config.js, for tests that exercise code which imports it.
 *
 * The real module loads the Firebase SDK from a CDN and cannot run under Node. This one
 * records every write and fails on demand, driven by globalThis.__fbMock:
 *
 *   failSetDoc   - setDoc rejects (the change is not stored)
 *   failAddDoc   - addDoc rejects (an audit entry is not stored)
 *   writes       - every attempted write, appended in order
 */
const ctl = () => (globalThis.__fbMock ||= { writes: [] });

export const db = { __mock: true };
export const doc = (_db, ...path) => ({ path: path.join('/') });
export const collection = (_db, ...path) => ({ path: path.join('/') });

export async function setDoc(ref, data) {
  if (ctl().failSetDoc) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
  ctl().writes.push({ op: 'setDoc', path: ref.path, data });
}

export async function addDoc(ref, data) {
  if (ctl().failAddDoc) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
  ctl().writes.push({ op: 'addDoc', path: ref.path, data });
  return { id: 'mock_' + ctl().writes.length };
}

// Used by the onboarding page tests.
export const auth = { currentUser: null };
export const getActiveOrgId = () => ctl().orgId || 'org_test';
export const serverTimestamp = () => ({ __serverTimestamp: true });
export async function getDoc() { return { exists: () => false, data: () => ({}) }; }
export async function getDocs() { return { empty: true, docs: [], forEach() {} }; }
export const tenantReady = Promise.resolve();
