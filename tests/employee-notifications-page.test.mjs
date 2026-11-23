/**
 * employee-notifications.html: runs the page's real module script in jsdom against stubbed
 * Firebase. Covers per-user read state, mark as read / unread, mark all (batched), rollback with
 * the real reason, organization scoping and the honest error state.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const root = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const html = fs.readFileSync(root('employee-notifications.html'), 'utf8').replace(/\r\n/g, '\n');
const readStateSource = fs.readFileSync(root('notification-read-state.js'), 'utf8');
const readState = new Function(readStateSource.replace(/^export /gm, '') +
  `\nreturn { ${[...readStateSource.matchAll(/^export (?:const|function) (\w+)/gm)].map(m => m[1]).join(', ')} };`)();

const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*$/gm, '');
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

const ME = { uid: 'emp-1', orgId: 'org_a', role: 'Employee' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const base = { title: 'Payroll posted', message: 'Your payslip is ready', target: 'all', priority: 'normal', timestamp: new Date() };

function boot({ docs = [], setReadState, markAllRead, snapshotError = null } = {}) {
  const dom = new JSDOM(markup, { url: 'http://localhost/employee-notifications.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { setReadState: [], markAllRead: [] };
  const snapshot = (list) => ({ docs: list.map(({ id, ...data }) => ({ id, data: () => data })) });

  const stubs = {
    auth: { signOut: async () => {} }, db: {},
    doc: () => ({ __doc: true }), onAuthStateChanged: (_a, cb) => cb({ uid: ME.uid }),
    checkBackendFirebaseStatus: async () => ({ online: true }),
    collection: () => ({}), query: () => ({ __query: true }), where: () => ({}), getDoc: async () => ({ exists: () => false }), getDocs: async () => ({ docs: [] }),
    onSnapshot: (q, onNext, onError) => {
      if (!q || !q.__query) return () => {};
      if (snapshotError) { onError(snapshotError); return () => {}; }
      onNext(snapshot(docs));
      return () => {};
    },
    updateDoc: async () => {}, limit: () => ({}), deleteDoc: async () => {}, arrayUnion: (x) => x, addDoc: async () => {},
    serverTimestamp: () => 'ts', registerListener: () => {},
    loadIdentity: async () => ME,
    orgNotificationsQuery: () => ({ __query: true }),
    setReadState: async (...a) => { calls.setReadState.push(a); return setReadState ? setReadState(...a) : undefined; },
    markAllRead: async (...a) => { calls.markAllRead.push(a); return markAllRead ? markAllRead(...a) : undefined; },
    failureReason: (e) => (e && e.code === 'permission-denied' ? 'Permission denied: test' : (e && e.message) || 'Unknown error'),
    unreadFor: readState.isUnread, unreadCount: readState.unreadCount, canMarkUnread: readState.canMarkUnread,
    withReadState: readState.withReadState, isTargetedTo: readState.isTargetedTo
  };
  window.__stubs = stubs;
  window.lucide = { createIcons: () => {} };
  window.Audio = class { play() { return Promise.resolve(); } };
  const names = Object.keys(stubs);
  window.eval(`(function () { const { ${names.join(', ')} } = window.__stubs; ${moduleSource} })();`);
  return { window, document: window.document, calls };
}

const item = (document, id) => document.querySelector(`[data-id="${id}"]`);
const toast = (document) => { const el = document.getElementById('notifToast'); return el ? { text: el.textContent, color: el.style.background } : null; };

describe('employee-notifications.html', () => {
  it('shows only my organization\'s notifications addressed to me, my role or everyone', async () => {
    const { document } = boot({ docs: [
      { id: 'all', ...base },
      { id: 'emp', ...base, target: 'employee' },
      { id: 'mine', ...base, target: ME.uid },
      { id: 'mgr', ...base, target: 'manager' },
      { id: 'other', ...base, target: 'someone-else' },
      { id: 'cleared', ...base, clearedBy: [ME.uid] }
    ] });
    await tick();
    for (const id of ['all', 'emp', 'mine']) assert.ok(item(document, id), id);
    for (const id of ['mgr', 'other', 'cleared']) assert.equal(item(document, id), null, id);
  });

  it('unread is my readBy, with the legacy shared flag counting as read, and the badge agrees', async () => {
    const { document } = boot({ docs: [
      { id: 'u', ...base },
      { id: 'r', ...base, readBy: [ME.uid] },
      { id: 'o', ...base, readBy: ['someone-else'] },
      { id: 'legacy', ...base, read: true }
    ] });
    await tick();
    assert.ok(!item(document, 'u').classList.contains('read'));
    assert.ok(item(document, 'r').classList.contains('read'));
    assert.ok(!item(document, 'o').classList.contains('read'));
    assert.ok(item(document, 'legacy').classList.contains('read'));
    assert.equal(document.getElementById('unreadBadge').textContent, '2 unread');
  });

  it('marks read at once, writes my uid and toasts; marks unread the same way', async () => {
    const { document, window, calls } = boot({ docs: [{ id: 'u', ...base }, { id: 'r', ...base, readBy: [ME.uid] }] });
    await tick();
    await window.toggleMarkAsRead('u', true);
    assert.ok(item(document, 'u').classList.contains('read'));
    assert.equal(toast(document).text, 'Marked as read');
    await window.toggleMarkAsRead('r', false);
    assert.ok(!item(document, 'r').classList.contains('read'));
    assert.equal(toast(document).text, 'Marked as unread');
    assert.deepEqual(calls.setReadState, [['u', ME.uid, true], ['r', ME.uid, false]]);
  });

  it('on failure it rolls back and shows the real reason', async () => {
    const { document, window } = boot({ docs: [{ id: 'u', ...base }], setReadState: async () => { throw Object.assign(new Error('rules'), { code: 'permission-denied' }); } });
    await tick();
    await window.toggleMarkAsRead('u', true);
    assert.ok(!item(document, 'u').classList.contains('read'), 'rolled back to unread');
    const t = toast(document);
    assert.match(t.text, /Could not update the notification: Permission denied: test/);
    assert.match(t.color, /153|991b1b/i);
  });

  it('an older notification read for everyone cannot be marked unread', async () => {
    const { document, window, calls } = boot({ docs: [{ id: 'legacy', ...base, read: true }] });
    await tick();
    await window.toggleMarkAsRead('legacy', false);
    assert.equal(calls.setReadState.length, 0);
    assert.match(toast(document).text, /cannot be marked unread/);
  });

  it('mark all as read sends every unread id once and updates the page', async () => {
    const { document, window, calls } = boot({ docs: [{ id: 'a', ...base }, { id: 'b', ...base }, { id: 'c', ...base, readBy: [ME.uid] }] });
    await tick();
    await window.markAllNotificationsAsRead();
    // (arrays come from the page's own realm; the order of equally old notifications is not defined)
    const [[ids, uid]] = JSON.parse(JSON.stringify(calls.markAllRead));
    assert.deepEqual([...ids].sort(), ['a', 'b']);
    assert.equal(uid, ME.uid);
    assert.equal(calls.markAllRead.length, 1);
    assert.equal(document.getElementById('unreadBadge').style.display, 'none');
    assert.match(toast(document).text, /Marked 2 notifications as read/);
  });

  it('mark all rolls back and explains when the write fails', async () => {
    const { document, window } = boot({ docs: [{ id: 'a', ...base }], markAllRead: async () => { throw new Error('quota'); } });
    await tick();
    await window.markAllNotificationsAsRead();
    assert.equal(document.getElementById('unreadBadge').textContent, '1 unread');
    assert.match(toast(document).text, /Could not mark all as read: quota/);
  });

  it('a failed query shows the error, not stale or invented notifications', async () => {
    const { document } = boot({ snapshotError: Object.assign(new Error('x'), { code: 'permission-denied' }) });
    await tick();
    assert.match(document.getElementById('notificationsFeed').textContent, /Could not load notifications/);
    assert.match(document.getElementById('notificationsFeed').textContent, /Permission denied/);
  });
});

describe('employee-notifications.html: no demo identity', () => {
  it('has no demo persona and never rewrites the stored uid', () => {
    const page = fs.readFileSync(fileURLToPath(new URL('../employee-notifications.html', import.meta.url)), 'utf8');
    for (const bad of ['Marry', 'John Doe', 'Cybersecurity', 'demo_emp', 'EMP_1789230184645', 'ZnaGIFv88QRD8AD4xTJOJ1KZinE2']) assert.ok(!page.includes(bad), `${bad} is still in the page`);
    assert.ok(!/localStorage\.setItem\('(employee_uid|hr_user_id)'/.test(page), 'the page writes the user id into localStorage');
  });
});
