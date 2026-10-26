/**
 * admin-notifications.html: runs the page's real module script in jsdom against stubbed Firebase.
 * Covers the mark-as-read / unread button: optimistic update, toast, rollback with the real
 * reason on failure, the legacy-read lock, organization scoping and the honest error state.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const root = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const html = fs.readFileSync(root('admin-notifications.html'), 'utf8').replace(/\r\n/g, '\n');
const readStateSource = fs.readFileSync(root('notification-read-state.js'), 'utf8');
const readState = new Function(readStateSource.replace(/^export /gm, '') +
  `\nreturn { ${[...readStateSource.matchAll(/^export (?:const|function) (\w+)/gm)].map(m => m[1]).join(', ')} };`)();

// the page's inline module script, without its import lines
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*$/gm, '');
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

const ME = { uid: 'admin-1', orgId: 'org_a', role: 'Super Admin' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function boot({ docs = [], setReadState, snapshotError = null } = {}) {
  const dom = new JSDOM(markup, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { setReadState: [] };
  const snapshotDocs = (list) => ({ docs: list.map(({ id, ...data }) => ({ id, data: () => data })) });
  let pushSnapshot = () => {};

  const stubs = {
    db: {}, auth: {},
    onAuthStateChanged: (_auth, cb) => cb({ uid: ME.uid }),
    onSnapshot: (q, onNext, onError) => {
      if (!q || !q.__query) return () => {}; // document listeners (custom sidebar apps) are not under test
      if (snapshotError) { onError(snapshotError); return () => {}; }
      pushSnapshot = (list) => onNext(snapshotDocs(list));
      onNext(snapshotDocs(docs));
      return () => {};
    },
    collection: () => ({}), query: () => ({ __query: true }), orderBy: () => ({}), limit: () => ({}), getDocs: async () => ({ docs: [] }),
    doc: () => ({}), updateDoc: async () => {}, arrayUnion: (x) => x, arrayRemove: (x) => x, addDoc: async () => {},
    serverTimestamp: () => 'ts', registerListener: () => {}, setDoc: async () => {},
    loadIdentity: async () => ME,
    orgNotificationsQuery: () => ({ __query: true }),
    setReadState: async (...args) => { calls.setReadState.push(args); return setReadState ? setReadState(...args) : undefined; },
    failureReason: (e) => (e && e.code === 'permission-denied' ? 'Permission denied: test' : (e && e.message) || 'Unknown error'),
    ...Object.fromEntries(Object.entries({ isUnread: readState.isUnread, unreadCount: readState.unreadCount, canMarkUnread: readState.canMarkUnread, withReadState: readState.withReadState, isTargetedTo: readState.isTargetedTo }))
  };
  // the page imports isUnread under the local name unreadFor
  stubs.unreadFor = stubs.isUnread;

  window.__stubs = stubs;
  window.lucide = { createIcons: () => {} };
  window.renderLucideIcons = () => {};
  const names = ['db', 'auth', 'onAuthStateChanged', 'collection', 'query', 'orderBy', 'limit', 'onSnapshot', 'getDocs', 'doc', 'updateDoc', 'arrayUnion', 'addDoc', 'serverTimestamp', 'registerListener', 'setDoc', 'arrayRemove', 'loadIdentity', 'orgNotificationsQuery', 'setReadState', 'failureReason', 'unreadFor', 'unreadCount', 'canMarkUnread', 'withReadState', 'isTargetedTo'];
  window.eval(`(function () { const { ${names.join(', ')} } = window.__stubs; ${moduleSource} })();`);
  return { window, document: window.document, calls, push: (list) => pushSnapshot(list) };
}

const card = (document, id) => document.getElementById(`notif_card_${id}`);
const toast = (document) => ({ text: document.getElementById('toastNotifText').textContent, error: document.getElementById('toastNotif').style.background });

describe('admin-notifications.html mark as read / unread', () => {
  let n1;
  beforeEach(() => { n1 = { id: 'n1', title: 'Policy update', message: 'Read it', target: 'all', priority: 'normal', timestamp: new Date() }; });

  it('the button asks for what it says: an unread item is marked read, a read item unread', async () => {
    const { document, calls, window } = boot({ docs: [n1, { ...n1, id: 'n2', readBy: [ME.uid] }] });
    await tick();
    assert.ok(card(document, 'n1').classList.contains('unread'));
    assert.ok(!card(document, 'n2').classList.contains('unread'));
    assert.match(card(document, 'n1').innerHTML, /toggleReadStatus\('n1', true\)/);
    assert.match(card(document, 'n2').innerHTML, /toggleReadStatus\('n2', false\)/);
    await window.toggleReadStatus('n2', false);
    assert.deepEqual(calls.setReadState, [['n2', ME.uid, false]]);
  });

  it('marks as read at once, writes my uid, and shows a success toast', async () => {
    let release;
    const { document, window, calls } = boot({ docs: [n1], setReadState: () => new Promise((resolve) => { release = resolve; }) });
    await tick();
    const pending = window.toggleReadStatus('n1', true);
    assert.ok(!card(document, 'n1').classList.contains('unread'), 'optimistic: read before Firestore answers');
    assert.equal(document.getElementById('countAll').textContent, '0');
    release();
    await pending;
    assert.deepEqual(calls.setReadState, [['n1', ME.uid, true]]);
    assert.equal(toast(document).text, 'Marked as read');
  });

  it('marks as unread with its own toast', async () => {
    const { document, window } = boot({ docs: [{ ...n1, readBy: [ME.uid] }] });
    await tick();
    await window.toggleReadStatus('n1', false);
    assert.ok(card(document, 'n1').classList.contains('unread'));
    assert.equal(toast(document).text, 'Marked as unread');
  });

  it('on failure it rolls back and shows the real reason, never silently', async () => {
    const { document, window } = boot({ docs: [n1], setReadState: async () => { const e = new Error('rules'); e.code = 'permission-denied'; throw e; } });
    await tick();
    await window.toggleReadStatus('n1', true);
    assert.ok(card(document, 'n1').classList.contains('unread'), 'rolled back to unread');
    assert.equal(document.getElementById('countAll').textContent, '1');
    const t = toast(document);
    assert.match(t.text, /Could not update the notification: Permission denied: test/);
    assert.match(t.error, /153|991b1b/i); // the error colour
  });

  it('an older notification that was read for everyone cannot be marked unread', async () => {
    const { document, window, calls } = boot({ docs: [{ ...n1, read: true }] });
    await tick();
    assert.ok(!card(document, 'n1').classList.contains('unread'));
    assert.match(card(document, 'n1').innerHTML, /disabled/);
    await window.toggleReadStatus('n1', false);
    assert.equal(calls.setReadState.length, 0);
    assert.match(toast(document).text, /cannot be marked unread/);
  });

  it('shows only notifications addressed to me, my role or everyone', async () => {
    const { document } = boot({ docs: [
      n1,
      { ...n1, id: 'mgr', target: 'manager' },
      { ...n1, id: 'emp', target: 'employee' },
      { ...n1, id: 'mine', target: ME.uid },
      { ...n1, id: 'gone', clearedBy: [ME.uid] }
    ] });
    await tick();
    assert.ok(card(document, 'n1'));
    assert.ok(card(document, 'mine'));
    assert.equal(card(document, 'mgr'), null);
    assert.equal(card(document, 'emp'), null);
    assert.equal(card(document, 'gone'), null);
  });

  it('a failed query shows the error, not invented notifications', async () => {
    const { document } = boot({ snapshotError: Object.assign(new Error('x'), { code: 'permission-denied' }) });
    await tick();
    const list = document.getElementById('notifList').textContent;
    assert.match(list, /Could not load notifications/);
    assert.match(list, /Permission denied/);
    assert.doesNotMatch(document.body.textContent, /Core Engine Operational|Manager Approval Queue Cleared/);
  });
});
