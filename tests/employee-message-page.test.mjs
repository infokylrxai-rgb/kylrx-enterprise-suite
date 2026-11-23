/**
 * employee-message.html: runs the page's real module script in jsdom against stubbed Firebase.
 * No hard-coded people, the uid and organization come from the verified session, and every
 * query (colleagues, chat stream, clear chat) is scoped to the signed-in user's organization.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const file = fileURLToPath(new URL('../employee-message.html', import.meta.url));
const html = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]);
const moduleSource = scripts.find(s => s.includes('syncTeammates'));
const importedNames = [...moduleSource.matchAll(/^\s*import \{([^}]*)\} from/gm)]
  .flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean)).map(x => x.split(/\s+as\s+/).pop());
const body = moduleSource.replace(/^\s*import .*$/gm, '');
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

const ME = { uid: 'emp-1', orgId: 'org_a', role: 'Employee' };
const windows = [];
// the page polls on timers; closing each window stops them so the test process can exit
after(() => windows.forEach(w => w.close()));
const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

function boot({ users = [], profile = { name: 'Eve Employee', department: 'Sales', managerId: 'mgr-1', managerName: 'Mia Manager' }, signedIn = true } = {}) {
  const dom = new JSDOM(markup, { url: 'http://localhost/employee-message.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);
  const rec = { queries: [], added: [], fetches: [] };

  const stubs = Object.fromEntries(importedNames.map(n => [n, () => ({})]));
  Object.assign(stubs, {
    db: {}, auth: { currentUser: signedIn ? { uid: ME.uid } : null, signOut: async () => {} },
    checkBackendFirebaseStatus: async () => ({ online: true }),
    onAuthStateChanged: (_a, cb) => cb(signedIn ? { uid: ME.uid } : null),
    collection: (_db, col) => ({ col }),
    doc: (_db, col, id) => ({ path: `${col}/${id}` }),
    where: (...w) => ({ where: w }),
    whereMyOrg: () => ({ mine: true, where: ['orgId', '==', ME.orgId] }),
    query: (base, ...constraints) => { const q = { col: base && base.col, constraints, __query: true }; rec.queries.push(q); return q; },
    limit: () => ({}),
    getDoc: async () => ({ exists: () => false, data: () => ({}) }),
    getDocs: async (q) => ({ docs: q.col === 'users' ? users.map(u => ({ id: u.id, data: () => u })) : [] }),
    onSnapshot: (ref, onNext) => {
      if (ref && ref.path === `users/${ME.uid}`) onNext({ exists: () => true, data: () => profile });
      else if (ref && ref.__query) onNext({ docs: [] });
      return () => {};
    },
    addDoc: async (col, data) => { rec.added.push([col.col, data]); },
    setDoc: async () => {}, updateDoc: async () => {}, deleteField: () => ({}), arrayUnion: (x) => x, serverTimestamp: () => 'ts', registerListener: () => {},
    loadIdentity: async () => ME
  });
  window.__stubs = stubs;
  window.lucide = { createIcons: () => {} };
  window.renderLucideIcons = () => {};
  // defined by a classic script in the page
  window.escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.fetch = async (url, opts) => { rec.fetches.push([String(url), opts && opts.method]); return { ok: false, json: async () => ({}) }; };
  window.eval(`(function () { const { ${Object.keys(stubs).join(', ')} } = window.__stubs; ${body} })();`);
  return { window, document: window.document, rec };
}

const directList = (document) => document.getElementById('directMsgList').textContent;

describe('employee-message.html', () => {
  it('has no hard-coded people or ids in the page', () => {
    for (const hardCoded of ['EMP_17892', 'w2XWBkvIgkS9xonTqVM5wPNckav2', 'demo_emp', 'Savitha', 'John Doe', 'Marry']) {
      assert.ok(!html.includes(hardCoded), `${hardCoded} is still in the page`);
    }
  });

  it('lists only this organization\'s colleagues (plus HR support), never a default roster', async () => {
    const { document, rec } = boot({ users: [{ id: 'emp-1', name: 'Eve Employee' }, { id: 'u2', name: 'Pat Peer', role: 'Member' }, { id: 'u3', name: 'Quinn Teammate' }] });
    await tick();
    const text = directList(document);
    assert.match(text, /Super Admin/);
    assert.match(text, /Pat Peer/);
    assert.match(text, /Quinn Teammate/);
    assert.ok(!/Eve Employee/.test(text), 'the user is not their own contact');
    for (const demo of ['John Doe', 'Savitha', 'jame', 'Marry']) assert.ok(!text.includes(demo), demo);
    const users = rec.queries.filter(q => q.col === 'users');
    assert.equal(users.length, 1);
    assert.ok(users[0].constraints.some(c => c && c.mine), 'the colleagues query has no organization filter');
  });

  it('with an empty organization only HR support is listed', async () => {
    const { document } = boot({ users: [] });
    await tick();
    assert.match(directList(document), /Super Admin/);
    assert.equal(document.querySelectorAll('#directMsgList .msg-channel').length, 1);
  });

  it('every messages query carries the organization filter, in the chat stream and in clear chat', async () => {
    const { window, document, rec } = boot();
    await tick();
    await window.switchChatChannel('hr', document.getElementById('chan-hr'));
    await tick();
    const messageQueries = rec.queries.filter(q => q.col === 'messages');
    assert.ok(messageQueries.length > 0, 'the chat opened no messages query');
    assert.deepEqual(messageQueries.filter(q => !q.constraints.some(c => c && c.mine)), [], 'a messages query without the organization filter');
  });

  it('the HR chat ids use the signed-in uid only', async () => {
    const { window, document, rec } = boot();
    await tick();
    await window.switchChatChannel('hr', document.getElementById('chan-hr'));
    await tick();
    const ids = JSON.stringify(rec.queries.filter(q => q.col === 'messages').map(q => q.constraints));
    assert.ok(ids.includes('hr_support_emp-1') || ids.includes('emp-1_hr_support'), ids);
    assert.ok(!ids.includes('EMP_1789230184645'));
  });

  it('the manager channel uses the profile\'s manager, and says so when there is none', async () => {
    const { window, document } = boot({ profile: { name: 'Eve', department: 'Sales', managerId: 'mgr-1', managerName: 'Mia Manager' } });
    await tick();
    await window.switchChatChannel('manager', document.querySelector('.msg-channel'));
    assert.match(document.getElementById('activeChatPartner').textContent, /Mia Manager/);

    const none = boot({ profile: { name: 'Eve', department: 'Sales' } });
    await tick();
    await none.window.switchChatChannel('manager', none.document.querySelector('.msg-channel'));
    assert.match(none.document.body.textContent, /No manager assigned yet/);
    assert.ok(!none.document.body.textContent.includes('Nandan'));
  });

  it('signed out: nothing is listed and nothing is queried', async () => {
    const { document, rec } = boot({ signedIn: false });
    await tick();
    assert.equal(rec.queries.filter(q => q.col === 'users' || q.col === 'messages').length, 0);
    assert.ok(!/Pat Peer|John Doe/.test(directList(document)));
  });
});
