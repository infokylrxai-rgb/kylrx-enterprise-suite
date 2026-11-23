/**
 * manager-notification.html: runs the page's real module script in jsdom against stubbed Firebase.
 * Organization-scoped manager inbox, per-user read toggle, allow/decline with a payload the rules
 * allow (resolvedBy = me), escaped content, and the honest error state.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const root = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const html = fs.readFileSync(root('manager-notification.html'), 'utf8').replace(/\r\n/g, '\n');
const rsSource = fs.readFileSync(root('notification-read-state.js'), 'utf8');
const readState = new Function(rsSource.replace(/^export /gm, '') +
  `\nreturn { ${[...rsSource.matchAll(/^export (?:const|function) (\w+)/gm)].map(m => m[1]).join(', ')} };`)();

const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const importedNames = [...moduleSource.matchAll(/^\s*import \{([^}]*)\} from/gm)]
  .flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean)).map(x => x.split(/\s+as\s+/).pop());
const body = moduleSource.replace(/^\s*import .*$/gm, '');
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

const ME = { uid: 'mgr-1', orgId: 'org_a', role: 'Manager' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const help = { type: 'employee_help', title: 'Access request', message: 'Please help', empEmail: 'emp@a.test', status: 'pending', timestamp: { toDate: () => new Date() } };

function boot({ docs = [], updateDoc, setReadState, snapshotError = null } = {}) {
  const dom = new JSDOM(markup, { url: 'http://localhost/manager-notification.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { updateDoc: [], addDoc: [], setReadState: [], badge: [] };
  const snapshot = (list) => ({ docs: list.map(({ id, ...data }) => ({ id, data: () => data })), size: list.length });
  const stubs = Object.fromEntries(importedNames.map(n => [n, () => ({})]));
  Object.assign(stubs, {
    db: {}, auth: { currentUser: { uid: ME.uid } },
    doc: (_db, col, id) => ({ path: `${col}/${id}` }),
    collection: (_db, col) => ({ col }),
    query: () => ({ __query: true }),
    onAuthStateChanged: (_a, cb) => cb({ uid: ME.uid }),
    onSnapshot: (q, onNext, onError) => {
      if (!q || !q.__orgNotifications) return () => {};
      if (snapshotError) { if (onError) onError(snapshotError); return () => {}; }
      onNext(snapshot(docs));
      return () => {};
    },
    getDoc: async () => ({ exists: () => false }),
    arrayUnion: (x) => ({ union: x }),
    serverTimestamp: () => 'ts',
    updateDoc: async (ref, data) => { calls.updateDoc.push([ref.path, data]); return updateDoc ? updateDoc() : undefined; },
    addDoc: async (col, data) => { calls.addDoc.push([col.col, data]); },
    whereMyOrg: () => ({ mine: true }),
    loadIdentity: async () => ME,
    orgNotificationsQuery: () => ({ __orgNotifications: true }),
    setReadState: async (...a) => { calls.setReadState.push(a); return setReadState ? setReadState() : undefined; },
    watchNotificationBadge: async (badge, pred) => { calls.badge.push(pred); },
    failureReason: (e) => (e && e.code === 'permission-denied' ? 'Permission denied: test' : (e && e.message) || 'Unknown error'),
    unreadFor: readState.isUnread, canMarkUnread: readState.canMarkUnread, isManagerNotification: readState.isManagerNotification
  });
  window.__stubs = stubs;
  window.lucide = { createIcons: () => {} };
  window.eval(`(function () { const { ${Object.keys(stubs).join(', ')} } = window.__stubs; ${body} })();`);
  return { window, document: window.document, calls };
}
const card = (document) => document.querySelector('.card');
const toast = (document) => { const el = document.getElementById('managerToast'); return el ? { text: el.textContent, color: el.style.background } : null; };

describe('manager-notification.html', () => {
  it('lists my organization\'s manager notifications and help requests, minus what I cleared', async () => {
    const { document } = boot({ docs: [
      { id: 'm', title: 'For managers', target: 'manager' },
      { id: 'h', ...help },
      { id: 'mine', title: 'Just me', target: ME.uid },
      { id: 'emp', title: 'For employees', target: 'employee' },
      { id: 'gone', title: 'Cleared', target: 'manager', clearedBy: [ME.uid] }
    ] });
    await tick();
    const h = card(document).innerHTML;
    for (const id of ['m', 'h', 'mine']) assert.ok(h.includes(`notif-${id}"`), id);
    for (const id of ['emp', 'gone']) assert.ok(!h.includes(`notif-${id}"`), id);
  });

  it('escapes stored content and keeps the email out of onclick strings', async () => {
    const { document } = boot({ docs: [{ id: 'x', ...help, title: '<img src=x onerror=alert(1)>', message: '<b>bold</b>', empEmail: "a'); alert(1);//@x.test" }] });
    await tick();
    assert.equal(card(document).querySelectorAll('img').length, 0);
    assert.equal(card(document).querySelectorAll('.notif-desc b').length, 0);
    const handlers = [...card(document).querySelectorAll('[onclick]')].map(el => el.getAttribute('onclick'));
    assert.ok(handlers.some(h => h.startsWith('handleHelpRequest(')), 'no allow/decline buttons rendered');
    assert.ok(handlers.every(h => !h.includes('alert') && !h.includes('@')), `the email reached an onclick string: ${handlers.join(' | ')}`);
    assert.ok(card(document).textContent.includes("a'); alert(1);//@x.test"), 'the email is still shown as text');
  });

  it('read toggle: unread marker by my readBy; toggling writes my uid and toasts', async () => {
    const { document, window, calls } = boot({ docs: [{ id: 'u', title: 'n', target: 'manager' }, { id: 'r', title: 'n', target: 'manager', readBy: [ME.uid] }] });
    await tick();
    const h = card(document).innerHTML;
    assert.match(h, /managerToggleRead\('u', true\)/);
    assert.match(h, /managerToggleRead\('r', false\)/);
    await window.managerToggleRead('u', true);
    assert.deepEqual(calls.setReadState, [['u', ME.uid, true]]);
    assert.equal(toast(document).text, 'Marked as read');
  });

  it('allowing a request records me as resolver, tells HRMS of my organization, and confirms', async () => {
    const { window, document, calls } = boot({ docs: [{ id: 'h', ...help }] });
    await tick();
    await window.handleHelpRequest('h', 'allow');
    const [path, data] = calls.updateDoc[0];
    assert.equal(path, 'notifications/h');
    assert.deepEqual(Object.keys(data).sort(), ['readBy', 'resolvedAt', 'resolvedBy', 'status']);
    assert.equal(data.status, 'allowed');
    assert.equal(data.resolvedBy, ME.uid);
    const [col, approved] = calls.addDoc[0];
    assert.equal(col, 'notifications');
    assert.equal(approved.orgId, ME.orgId);
    assert.equal(approved.empEmail, 'emp@a.test');
    assert.equal(approved.target, 'hrms');
    assert.match(toast(document).text, /HRMS has been notified/);
  });

  it('a failed decision is reported, not swallowed', async () => {
    const { window, document } = boot({ docs: [{ id: 'h', ...help }], updateDoc: () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }); } });
    await tick();
    await window.handleHelpRequest('h', 'decline');
    assert.match(toast(document).text, /Could not update the request: Permission denied: test/);
  });

  it('the bell uses the manager audience rule', async () => {
    const { calls } = boot({ docs: [] });
    await tick();
    assert.equal(calls.badge.length, 1);
    assert.equal(calls.badge[0]({ target: 'manager' }), true);
    assert.equal(calls.badge[0]({ target: 'employee' }), false);
  });

  it('a failed query shows the error', async () => {
    const { document } = boot({ snapshotError: Object.assign(new Error('x'), { code: 'permission-denied' }) });
    await tick();
    assert.match(card(document).textContent, /Could not load notifications/);
  });
});
