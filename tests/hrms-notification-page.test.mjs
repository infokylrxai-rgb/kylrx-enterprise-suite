/**
 * hrms-notification.html: runs the page's real module script in jsdom against stubbed Firebase.
 * Covers the organization-scoped HRMS inbox, per-user read toggle, resolving a request with a
 * payload the firestore.rules allow, and the honest error state.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const root = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const html = fs.readFileSync(root('hrms-notification.html'), 'utf8').replace(/\r\n/g, '\n');
const readStateSource = fs.readFileSync(root('notification-read-state.js'), 'utf8');
const readState = new Function(readStateSource.replace(/^export /gm, '') +
  `\nreturn { ${[...readStateSource.matchAll(/^export (?:const|function) (\w+)/gm)].map(m => m[1]).join(', ')} };`)();

const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const importedNames = [...moduleSource.matchAll(/^\s*import \{([^}]*)\} from/gm)]
  .flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean))
  .map(x => x.split(/\s+as\s+/).pop());
const body = moduleSource.replace(/^\s*import .*$/gm, '');
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

const ME = { uid: 'hr-1', orgId: 'org_a', role: 'HRMS' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const base = { title: 'Help needed', message: 'Cannot log in', target: 'hrms', priority: 'normal', type: 'employee_help', timestamp: { toDate: () => new Date() } };

function boot({ docs = [], setReadState, updateDoc, snapshotError = null } = {}) {
  const dom = new JSDOM(markup, { url: 'http://localhost/hrms-notification.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { setReadState: [], updateDoc: [] };
  const snapshot = (list) => ({ docs: list.map(({ id, ...data }) => ({ id, data: () => data })), size: list.length });

  const stubs = Object.fromEntries(importedNames.map(n => [n, () => ({})]));
  Object.assign(stubs, {
    db: {}, auth: { currentUser: { uid: ME.uid } },
    doc: (_db, col, id) => ({ path: `${col}/${id}` }),
    onAuthStateChanged: (_a, cb) => cb({ uid: ME.uid }),
    query: () => ({ __query: true }),
    onSnapshot: (q, onNext, onError) => {
      if (!q || !q.__query) return () => {};
      if (snapshotError) { if (onError) onError(snapshotError); return () => {}; }
      onNext(snapshot(docs));
      return () => {};
    },
    arrayUnion: (x) => ({ union: x }), arrayRemove: (x) => ({ remove: x }),
    updateDoc: async (ref, data) => { calls.updateDoc.push([ref.path, data]); return updateDoc ? updateDoc(ref, data) : undefined; },
    loadIdentity: async () => ME,
    orgNotificationsQuery: () => ({ __query: true }),
    setReadState: async (...a) => { calls.setReadState.push(a); return setReadState ? setReadState(...a) : undefined; },
    failureReason: (e) => (e && e.code === 'permission-denied' ? 'Permission denied: test' : (e && e.message) || 'Unknown error'),
    unreadFor: readState.isUnread, unreadCount: readState.unreadCount, canMarkUnread: readState.canMarkUnread
  });
  window.__stubs = stubs;
  window.lucide = { createIcons: () => {} };
  const names = Object.keys(stubs);
  window.eval(`(function () { const { ${names.join(', ')} } = window.__stubs; ${body} })();`);
  return { window, document: window.document, calls };
}

const toast = (document) => { const el = document.getElementById('hrmsToast'); return el ? { text: el.textContent, color: el.style.background } : null; };

describe('hrms-notification.html', () => {
  it('lists only this organization\'s HRMS notifications, minus the ones I cleared', async () => {
    const { document } = boot({ docs: [
      { id: 'a', ...base },
      { id: 'b', ...base, target: 'x', type: 'employee_help_approved' },
      { id: 'c', ...base, target: 'manager', type: 'other' },
      { id: 'd', ...base, clearedBy: [ME.uid] }
    ] });
    await tick();
    const text = document.querySelector('.card').innerHTML;
    assert.ok(text.includes('hrms-notif-a'));
    assert.ok(text.includes('hrms-notif-b'));
    assert.ok(!text.includes('hrms-notif-c'));
    assert.ok(!text.includes('hrms-notif-d'));
  });

  it('shows an unread marker by my readBy and a toggle that asks for what it says', async () => {
    const { document } = boot({ docs: [{ id: 'u', ...base }, { id: 'r', ...base, readBy: [ME.uid] }, { id: 'legacy', ...base, read: true }] });
    await tick();
    const html = document.querySelector('.card').innerHTML;
    const part = (id) => html.slice(html.indexOf(`hrms-notif-${id}`)).split('hrms-notif-')[1] ? html.slice(html.indexOf(`hrms-notif-${id}`), html.indexOf('hrms-notif-', html.indexOf(`hrms-notif-${id}`) + 5) > 0 ? html.indexOf('hrms-notif-', html.indexOf(`hrms-notif-${id}`) + 5) : undefined) : '';
    assert.match(part('u'), /title="Unread"/);
    assert.match(part('u'), /hrmsToggleRead\('u', true\)/);
    assert.doesNotMatch(part('r'), /title="Unread"/);
    assert.match(part('r'), /hrmsToggleRead\('r', false\)/);
    assert.match(part('legacy'), /disabled/);
  });

  it('toggling writes my uid and toasts; a failure shows the real reason', async () => {
    const ok = boot({ docs: [{ id: 'u', ...base }] });
    await tick();
    await ok.window.hrmsToggleRead('u', true);
    assert.deepEqual(ok.calls.setReadState, [['u', ME.uid, true]]);
    assert.equal(toast(ok.document).text, 'Marked as read');

    const bad = boot({ docs: [{ id: 'u', ...base }], setReadState: async () => { throw Object.assign(new Error('rules'), { code: 'permission-denied' }); } });
    await tick();
    await bad.window.hrmsToggleRead('u', true);
    assert.match(toast(bad.document).text, /Could not update the notification: Permission denied: test/);
    assert.match(toast(bad.document).color, /153|991b1b/i);
  });

  it('resolving sends only fields the rules allow, and failures are shown', async () => {
    const ok = boot({ docs: [{ id: 'u', ...base }] });
    await tick();
    await ok.window.resolveHelpRequest('u');
    const [path, data] = ok.calls.updateDoc[0];
    assert.equal(path, 'notifications/u');
    assert.deepEqual(Object.keys(data).sort(), ['readBy', 'resolvedBy', 'status']);
    assert.equal(data.status, 'resolved');
    assert.equal(data.resolvedBy, ME.uid);
    assert.equal(toast(ok.document).text, 'Request marked as resolved');

    const bad = boot({ docs: [{ id: 'u', ...base }], updateDoc: async () => { throw new Error('offline'); } });
    await tick();
    await bad.window.resolveHelpRequest('u');
    assert.match(toast(bad.document).text, /Could not resolve the request: offline/);
  });

  it('a failed query shows the error', async () => {
    const { document } = boot({ snapshotError: Object.assign(new Error('x'), { code: 'permission-denied' }) });
    await tick();
    assert.match(document.querySelector('.card').textContent, /Could not load notifications/);
    assert.match(document.querySelector('.card').textContent, /Permission denied/);
  });
});
