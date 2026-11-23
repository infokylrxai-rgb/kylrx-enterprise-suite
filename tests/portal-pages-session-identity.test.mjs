/**
 * Employee, manager and HRMS pages: the uid and organization come from the signed-in (verified) session, never
 * from localStorage, ?id= or a demo default (on manager / HRMS pages ?id= is a command center id and is allowed). Each page's real inline module script runs in jsdom against recording
 * stubs of Firebase; localStorage and the URL are poisoned with an "attacker" uid, and no call, query or request
 * may ever mention it. The pages' sources must also contain no demo persona or demo uid.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const read = (f) => fs.readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const PAGES = (process.env.PAGES || [
  'employee-appraisal', 'employee-assets', 'employee-attendance-log', 'employee-bank-task', 'employee-calendar', 'employee-leave', 'employee-policy',
  'employee-goals', 'employee-job-details', 'employee-quick-actions-page',
  'manager-analysis', 'manager-assets', 'manager-attendance', 'manager-calendar', 'manager-console', 'manager-dashboard', 'manager-documents',
  'manager-notification', 'manager-performance', 'manager-policy', 'manager-security', 'manager-workforce', 'manager-message',
  'hrms-dashboard', 'hrms-message'
].join(',')).split(',').filter(f => fs.existsSync(fileURLToPath(new URL(`../${f}.html`, import.meta.url))));

// pages whose script must actually act as the session user (so a crash cannot make the poisoned-uid check pass vacuously)
const USES_SESSION_UID = new Set(['employee-appraisal', 'employee-assets', 'employee-attendance-log', 'employee-bank-task', 'employee-calendar', 'employee-leave', 'employee-policy', 'manager-assets', 'manager-attendance', 'manager-console', 'manager-dashboard', 'manager-documents', 'manager-performance', 'manager-security', 'manager-workforce']);

const ME = { uid: 'session-uid-1', orgId: 'org_a', role: 'Employee' };
const BAD = 'attacker-uid-9';
const DEMO = ['demo_emp', 'demo_user', 'EMP_1789230184645', 'EMP_1789151730443', 'ZnaGIFv88QRD8AD4xTJOJ1KZinE2', 'Marry Doe', 'John Doe', 'Nandan.B', 'marry@gmail.com', 'john.doe@example.com'];
const windows = [];
after(() => windows.forEach(w => w.close()));
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

// a permissive stand-in: callable, chainable, awaitable as "nothing"
const loose = () => new Proxy(function () {}, { get: (_t, k) => (k === 'then' || k === Symbol.toPrimitive ? undefined : loose()), apply: () => loose() });

function flatten(v, out = [], depth = 0) {
  if (depth > 5 || v == null) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => flatten(x, out, depth + 1));
  else if (typeof v === 'object') Object.values(v).forEach(x => flatten(x, out, depth + 1));
  return out;
}

async function run(page) {
  const html = read(`${page}.html`);
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(markup, { url: `http://localhost/${page}.html?id=${page.startsWith('employee-') ? BAD : 'center-9'}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);
  for (const k of ['employee_uid', 'hr_user_id', 'manager_uid', 'userId', 'uid']) window.localStorage.setItem(k, BAD);
  window.localStorage.setItem('userName', 'Stored Name');
  const seen = [];
  const errors = [];
  // a command center document (?id= on manager pages) is legitimately addressed by that id
  const record = (name, args) => { flatten(args, seen); void name; };
  // like loose(), but every call's arguments are recorded
  const rloose = (n) => new Proxy(function () {}, { get: (_t, k) => (k === 'then' || k === Symbol.toPrimitive ? undefined : rloose(`${n}.${String(k)}`)), apply: (_t, _this, args) => { record(n, args); return rloose(`${n}()`); } });
  window.fetch = async (url, opts) => { record('fetch', [url, opts && opts.body]); return { ok: true, status: 200, json: async () => ({ success: true, data: [] }), text: async () => '' }; };
  window.lucide = { createIcons: () => {} };
  window.addEventListener('error', (e) => errors.push(e.message));
  for (const body of scripts) {
    const IMPORT = /^\s*import\s+([\w*{}\s,]+?)\s+from\s+["'][^"']+["'];?/gm;
    const importedNames = [...body.matchAll(IMPORT)].flatMap(m => {
      const clause = m[1].trim();
      const named = /\{([^}]*)\}/.exec(clause);
      const names = named ? named[1].split(',').map(x => x.trim()).filter(Boolean).map(x => x.split(/\s+as\s+/).pop()) : [];
      const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
      if (head) names.push(head.replace(/^\*\s+as\s+/, ''));
      return names;
    });
    const stubs = {};
    for (const n of importedNames) {
      stubs[n] = rloose(n);
    }
    Object.assign(stubs, {
      db: {}, auth: { currentUser: { uid: ME.uid, getIdToken: async () => 'tok', getIdTokenResult: async () => ({ claims: ME }) }, signOut: async () => {} },
      tenantReady: Promise.resolve(ME.orgId),
      getActiveOrgId: () => ME.orgId,
      loadIdentity: async () => ME,
      whereMyOrg: (...a) => { record('whereMyOrg', a); return { mine: true }; },
      onAuthStateChanged: (_a, cb) => { Promise.resolve().then(() => cb({ uid: ME.uid, displayName: 'Session User', email: 'u@x.test', getIdToken: async () => 'tok' })); return () => {}; },
      // ?id= on manager and dashboard pages is a command center id, which they may legitimately read
      doc: (...a) => { if (a[1] !== 'command_centers') record('doc', a); return { path: a.slice(1).join('/') }; },
      collection: (...a) => { record('collection', a); return { col: a[1] }; },
      where: (...a) => { record('where', a); return { where: a }; },
      query: (...a) => { record('query', a); return { __q: true }; },
      getDoc: async (r) => { record('getDoc', [r]); return { exists: () => false, data: () => ({}), id: 'x' }; },
      getDocs: async (q) => { record('getDocs', [q]); return { empty: true, size: 0, docs: [], forEach() {} }; },
      onSnapshot: (ref, cb) => { record('onSnapshot', [ref]); try { cb({ exists: () => false, data: () => ({}), empty: true, size: 0, docs: [], forEach() {} }); } catch (_) {} return () => {}; },
      setDoc: async (r, d) => { record('setDoc', [r, d]); }, updateDoc: async (r, d) => { record('updateDoc', [r, d]); }, addDoc: async (c, d) => { record('addDoc', [c, d]); return { id: 'n' }; },
      registerListener: () => {}, checkBackendFirebaseStatus: async () => ({ online: true }), serverTimestamp: () => 'ts'
    });
    // names a script imports that the table above covers keep the recording version where it exists
    for (const n of importedNames) if (!(n in stubs)) stubs[n] = loose();
    window.__stubs = stubs;
    // dynamic import("./x.js") of local modules resolves to the same recording stubs (Node must never load the real SDK)
    const code = body.replace(IMPORT, '').replace(/^\s*import\s+["'][^"']+["'];?/gm, '').replace(/import\(\s*["']\.\/[\w./-]+["']\s*\)/g, 'Promise.resolve(window.__stubs)');
    try {
      await window.eval(`(async function () { const { ${Object.keys(stubs).join(', ')} } = window.__stubs; ${code} })()`);
    } catch (err) {
      errors.push(err.message);
    }
    await tick();
  }
  return { html, seen, errors, window };
}

describe('portal pages take the user from the session', () => {
  for (const page of PAGES) {
    it(`${page}.html: no demo persona or demo uid in the source`, () => {
      const html = read(`${page}.html`);
      for (const bad of DEMO) assert.ok(!html.includes(bad), `${bad} is in ${page}.html`);
      assert.ok(!/localStorage\.getItem\('(employee_uid|hr_user_id|manager_uid)'\)/.test(html), `${page}.html reads the uid from localStorage`);
    });

    it(`${page}.html: never uses the uid from ?id= or localStorage`, async () => {
      const { seen, errors } = await run(page);
      const leaks = seen.filter(s => s.includes(BAD) && !s.startsWith('command_centers/'));
      assert.deepEqual(leaks.slice(0, 3), [], `${page}.html used the poisoned uid`);
      assert.deepEqual(errors, [], `${page}.html threw while running`);
      if (USES_SESSION_UID.has(page)) assert.ok(seen.some(x => x.includes(ME.uid)), `${page}.html never used the session uid`);
    });
  }
});
