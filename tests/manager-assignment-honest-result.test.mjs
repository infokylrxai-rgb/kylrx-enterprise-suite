/**
 * Saving a manager reassignment used to report success whatever happened.
 *
 * A Firestore failure was logged as a "notice". The backend call swallowed every error
 * and never checked res.ok, so a 403 or a 500 counted as saved. Then the directory was
 * updated and "successfully updated with audit trail" shown - unconditionally. A change
 * could fail at both stores and at every audit write, and the admin was told it worked.
 *
 * This drives the real saveAssignment() through each outcome. Its dynamic
 * import('./firebase-config.js') is redirected to a stand-in that records writes and
 * fails on demand; fetch is replaced the same way.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createRequire } from 'node:module';

register('./fixtures/redirect-firebase-config.mjs', import.meta.url);
const require = createRequire(import.meta.url);

// --- a minimal browser ------------------------------------------------------------------
const elements = {};
const el = (id, extra = {}) => (elements[id] = {
  id, value: '', style: {}, textContent: '', innerHTML: '', disabled: false,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  ...extra
});

let notices = [];
globalThis.document = { getElementById: (id) => elements[id] || null };
globalThis.localStorage = { getItem: () => 'admin@bosco.example', setItem() {} };
globalThis.window = globalThis;
window.showSuccess = (title, message) => notices.push({ kind: 'success', title, message });
window.showError = (title, message) => notices.push({ kind: 'error', title, message });
window.showToast = (message, kind) => notices.push({ kind, title: '', message });
globalThis.alert = (m) => notices.push({ kind: 'alert', title: '', message: m });

const ctrl = require('../manager-assignment-controller.js');

const EMP = { id: 'emp_1', employeeId: 'emp_1', name: 'Asha', reportingManagerId: 'mgr_old' };

let fetchResult;
globalThis.fetch = async () => {
  if (fetchResult instanceof Error) throw fetchResult;
  return fetchResult;
};

async function save({ firestore = 'ok', audit = 'ok', api = { ok: true, status: 200 } } = {}) {
  globalThis.__fbMock = { writes: [], failSetDoc: firestore === 'fail', failAddDoc: audit === 'fail' };
  fetchResult = api;
  notices = [];

  el('managerAssignmentModal');
  el('mgrAssignL1Select', { value: 'mgr_new' });
  el('mgrAssignL2Select', { value: '' });
  el('mgrAssignValidationNotice');
  el('btnSaveManagerAssignment');

  window.state = { employees: [
    { ...EMP },
    { id: 'mgr_old', employeeId: 'mgr_old', name: 'Old Manager' },
    { id: 'mgr_new', employeeId: 'mgr_new', name: 'New Manager' }
  ] };
  await ctrl.openAssignmentModal('emp_1');
  await ctrl.saveAssignment();

  const row = window.state.employees.find(e => e.id === 'emp_1');
  return { notices, row, writes: globalThis.__fbMock.writes };
}

const lastNotice = (r) => r.notices[r.notices.length - 1] || {};

describe('a manager reassignment reports what actually happened', () => {
  beforeEach(() => { delete window.EmployeeProfileController; });

  it('everything saved: success, with audit trail', async () => {
    const r = await save();
    assert.equal(lastNotice(r).kind, 'success');
    assert.match(lastNotice(r).message, /with audit trail/);
    assert.ok(r.writes.some(w => w.op === 'addDoc' && w.path === 'audit_logs'), 'an audit entry was written');
  });

  /** The headline bug: both stores refuse, and it used to say it worked. */
  it('both stores refuse: an error, and nothing on screen changes', async () => {
    const r = await save({ firestore: 'fail', api: { ok: false, status: 500 } });
    assert.equal(lastNotice(r).kind, 'error', 'must not claim success');
    assert.match(lastNotice(r).message, /could not be saved/);
    assert.equal(r.row.reportingManagerId, 'mgr_old', 'the directory must still show the saved value');
  });

  it('a 403 from the server is a failure, not a save', async () => {
    const r = await save({ firestore: 'fail', api: { ok: false, status: 403 } });
    assert.equal(lastNotice(r).kind, 'error');
    assert.match(lastNotice(r).message, /HTTP 403/);
  });

  it('a network error reaching the server is a failure', async () => {
    const r = await save({ firestore: 'fail', api: new Error('network down') });
    assert.equal(lastNotice(r).kind, 'error');
  });

  it('only one store accepted it: saved, but says the other did not', async () => {
    const r = await save({ api: { ok: false, status: 500 } });
    assert.notEqual(lastNotice(r).kind, 'error');
    assert.match(lastNotice(r).message, /partly saved|did not accept/);
    assert.doesNotMatch(lastNotice(r).message, /with audit trail/);
  });

  it('the change saved but its audit entry did not: says so, never "with audit trail"', async () => {
    const r = await save({ audit: 'fail' });
    assert.match(lastNotice(r).title, /audit record incomplete/);
    assert.doesNotMatch(lastNotice(r).message, /with audit trail/);
  });
});
