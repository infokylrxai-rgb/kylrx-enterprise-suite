/**
 * employee-dashboard.html: runs the page's real module script in jsdom against stubbed Firebase.
 * No demo identity; the uid and organization come from the verified session; the holiday and
 * teammate reads are scoped to the organization.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(fileURLToPath(new URL('../employee-dashboard.html', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const moduleSource = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('loadDashboardData'));
const importedNames = [...moduleSource.matchAll(/^\s*import \{([^}]*)\} from/gm)].flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean)).map(x => x.split(/\s+as\s+/).pop());
const body = moduleSource.replace(/^\s*import .*$/gm, '');
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

const ME = { uid: 'emp-1', orgId: 'org_a', role: 'Employee' };
const windows = [];
after(() => windows.forEach(w => w.close()));
const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

async function boot({ signedIn = true, orgKnown = true, search = '?id=other', local = { employee_uid: 'attacker', hr_user_id: 'attacker' } } = {}) {
  const dom = new JSDOM(markup, { url: 'http://localhost/employee-dashboard.html' + search, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);
  for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  const rec = { queries: [], snapshots: [], docs: [] };
  const stubs = Object.fromEntries(importedNames.map(n => [n, () => ({})]));
  Object.assign(stubs, {
    db: {}, auth: { currentUser: signedIn ? { uid: ME.uid } : null },
    attendanceEngine: { getTodayPunchStatus: async () => null, initHolidays: async () => {}, isTodayHoliday: async () => false },
    onAuthStateChanged: (_a, cb) => cb(signedIn ? { uid: ME.uid } : null),
    checkBackendFirebaseStatus: async () => ({ online: true }),
    tenantReady: Promise.resolve(orgKnown ? ME.orgId : null),
    collection: (_db, col) => ({ col }),
    doc: (_db, col, id) => ({ path: `${col}/${id}` }),
    where: (...w) => ({ where: w }),
    whereMyOrg: () => ({ mine: true }),
    orderBy: (...o) => ({ order: o }),
    limit: () => ({}),
    query: (base, ...constraints) => { const q = { col: base.col, constraints, __q: true }; rec.queries.push(q); return q; },
    getDoc: async () => ({ exists: () => false, data: () => ({}) }),
    getDocs: async () => ({ empty: true, docs: [] }),
    onSnapshot: (ref, onNext) => { rec.snapshots.push(ref.path || ref.col); if (ref.path) onNext({ exists: () => true, data: () => ({ name: 'Eve Employee', department: 'Sales' }) }); else onNext({ empty: true, docs: [] }); return () => {}; },
    addDoc: async () => ({}), setDoc: async () => {}, updateDoc: async () => {}, arrayUnion: (x) => x, arrayRemove: (x) => x, serverTimestamp: () => 'ts', registerListener: () => {},
    loadIdentity: async () => { if (!orgKnown) throw new Error('No organization found for the signed-in user.'); return ME; }
  });
  window.__stubs = stubs;
  window.lucide = { createIcons: () => {} };
  window.eval(`(function () { const { ${Object.keys(stubs).join(', ')} } = window.__stubs; ${body} })();`);
  await tick();
  return { window, document: window.document, rec };
}

describe('employee-dashboard.html', () => {
  it('has no demo identity in the page', () => {
    for (const bad of ['demo_emp', 'demo_user', 'John Doe', 'Marry', 'Nandan', 'Cybersecurity', 'ZnaGIFv88QRD8AD4xTJOJ1KZinE2']) assert.ok(!html.includes(bad), `${bad} is still in the page`);
  });

  it('uses the verified uid for the profile, whatever ?id= and localStorage say', async () => {
    const { rec, window } = await boot();
    assert.ok(rec.snapshots.includes(`users/${ME.uid}`), 'profile listener is not on the session uid');
    assert.ok(!rec.snapshots.some(p => String(p).includes('attacker')));
    assert.equal(window.__kylrxUid, ME.uid);
  });

  it('reads holidays and teammates of this organization only', async () => {
    const { rec } = await boot();
    const holidays = rec.queries.find(q => q.col === 'holidays');
    assert.ok(holidays && holidays.constraints.some(c => c.mine), 'holidays query is not organization-scoped');
    const users = rec.queries.filter(q => q.col === 'users');
    assert.ok(users.length > 0, 'no teammates query ran');
    assert.deepEqual(users.filter(q => !q.constraints.some(c => c.mine)), [], 'a users query without the organization filter');
  });

  it('signed out: no profile, no holidays, no teammates', async () => {
    const { rec } = await boot({ signedIn: false, orgKnown: false });
    assert.equal(rec.snapshots.filter(p => String(p).startsWith('users/')).length, 0);
    assert.equal(rec.queries.filter(q => q.col === 'holidays' || q.col === 'users').length, 0);
  });

  it('an unverifiable organization loads no profile', async () => {
    const { rec } = await boot({ orgKnown: false });
    assert.equal(rec.snapshots.filter(p => String(p).startsWith('users/')).length, 0);
  });
});
