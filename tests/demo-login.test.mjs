/**
 * Demo login: the server side (404 unless demo mode, demo organization only, rate limited),
 * the login-page UI (only when the server says demo mode is on) and the guarantee that no demo
 * account or password is in any login page or script.
 */
import './helpers/isolate-firebase.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p) => fs.readFileSync(here(p), 'utf8');
const { demoEnabled, DEMO_ORG_ID, logDemoModeStatus } = require('../config/demo.js');

let server, baseUrl, db;
const call = (method, p, body, headers = {}) => fetch(`${baseUrl}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
const asOrg = (orgId, role = 'Super Admin') => ({ Authorization: `Bearer ${jwt.sign({ id: `u_${orgId}`, role, orgId }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

before(async () => {
  const { default: serverModule } = await import('../server.js');
  assert.equal(require('firebase-admin').apps.length, 0, 'a real Firebase app is initialised');
  await serverModule.dynamicRoutesLoaded;
  ({ db } = require('../config/firebase'));
  server = http.createServer(serverModule.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('demoEnabled()', () => {
  it('is off by default and for anything but "true"', () => {
    assert.equal(demoEnabled({}), false);
    assert.equal(demoEnabled({ KYLRX_DEMO_MODE: 'false' }), false);
    assert.equal(demoEnabled({ KYLRX_DEMO_MODE: '1' }), false);
  });
  it('is on in development and test', () => {
    assert.equal(demoEnabled({ KYLRX_DEMO_MODE: 'true' }), true);
    assert.equal(demoEnabled({ KYLRX_DEMO_MODE: 'true', NODE_ENV: 'test' }), true);
  });
  it('production needs the explicit second switch', () => {
    assert.equal(demoEnabled({ KYLRX_DEMO_MODE: 'true', NODE_ENV: 'production' }), false);
    assert.equal(demoEnabled({ NODE_ENV: 'production', KYLRX_DEMO_MODE_ALLOW_PRODUCTION: 'true' }), false, 'the second switch alone is not enough');
    assert.equal(demoEnabled({ KYLRX_DEMO_MODE: 'true', NODE_ENV: 'production', KYLRX_DEMO_MODE_ALLOW_PRODUCTION: 'true' }), true);
  });
  it('logs a warning when it is on, and when it was refused in production', () => {
    const lines = [];
    const logger = { warn: (m) => lines.push(m) };
    logDemoModeStatus(logger, { KYLRX_DEMO_MODE: 'true', NODE_ENV: 'production', KYLRX_DEMO_MODE_ALLOW_PRODUCTION: 'true' });
    logDemoModeStatus(logger, { KYLRX_DEMO_MODE: 'true', NODE_ENV: 'production' });
    logDemoModeStatus(logger, {});
    assert.equal(lines.length, 2);
    assert.match(lines[0], /PRODUCTION/);
    assert.match(lines[1], /ignored in production/);
  });
  it('org_demo is a reserved organization id (signup can never create it)', () => {
    assert.ok(require('../config/tenant').RESERVED_ORG_IDS.has(DEMO_ORG_ID));
  });
});

describe('demo mode off', () => {
  it('POST /api/auth/demo-login is a 404 and /api/public-config says off', async () => {
    await withEnv({ KYLRX_DEMO_MODE: undefined }, async () => {
      assert.equal((await call('POST', '/api/auth/demo-login', { role: 'admin' })).status, 404);
      assert.deepEqual(await (await call('GET', '/api/public-config')).json(), { demoMode: false });
    });
  });
  it('is a 404 in production even with KYLRX_DEMO_MODE=true', async () => {
    await withEnv({ KYLRX_DEMO_MODE: 'true', NODE_ENV: 'production', KYLRX_DEMO_MODE_ALLOW_PRODUCTION: undefined }, async () => {
      assert.equal((await call('POST', '/api/auth/demo-login', { role: 'admin' })).status, 404);
    });
  });
});

describe('demo mode on', () => {
  const fakeAuth = () => {
    const users = new Map();
    const claims = new Map();
    return {
      claims,
      getUserByEmail: async (email) => { if (!users.has(email)) { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; } return users.get(email); },
      createUser: async ({ email }) => { const u = { uid: `uid_${users.size + 1}`, email }; users.set(email, u); return u; },
      updateUser: async () => {},
      setCustomUserClaims: async (uid, c) => claims.set(uid, c)
    };
  };

  it('says so when the demo users were never seeded', async () => {
    await withEnv({ KYLRX_DEMO_MODE: 'true' }, async () => {
      const res = await call('POST', '/api/auth/demo-login', { role: 'admin' });
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /seed:demo/);
    });
  });

  it('seed:demo creates four demo users in org_demo only, with random passwords that are not stored', async () => {
    const { seedDemo } = require('../scripts/seed-demo.js');
    const auth = fakeAuth();
    const created = await seedDemo({ auth, firestore: db, log: () => {} });
    assert.deepEqual(created.map(u => u.role), ['admin', 'hrms', 'manager', 'employee']);
    assert.equal(new Set(created.map(u => u.password)).size, 4, 'passwords repeat');
    assert.ok(created.every(u => u.password.length >= 20));
    for (const c of auth.claims.values()) assert.equal(c.orgId, DEMO_ORG_ID);
    const stored = JSON.stringify((await db.collection('users').where('orgId', '==', DEMO_ORG_ID).get()).docs.map(d => d.data()));
    for (const u of created) assert.ok(!stored.includes(u.password), 'a password was written to the database');
    assert.ok((await db.collection('organizations').doc(DEMO_ORG_ID).get()).exists);
  });

  it('returns a session for the demo organization only', async () => {
    await withEnv({ KYLRX_DEMO_MODE: 'true' }, async () => {
      assert.deepEqual(await (await call('GET', '/api/public-config')).json(), { demoMode: true });
      for (const [role, claimRole] of [['admin', 'super_admin'], ['hrms', 'HRMS'], ['manager', 'Manager'], ['employee', 'Employee']]) {
        const res = await call('POST', '/api/auth/demo-login', { role });
        assert.equal(res.status, 200, await res.clone().text());
        const body = await res.json();
        assert.equal(body.orgId, DEMO_ORG_ID);
        const claims = JSON.parse(body.customToken.split(':').slice(2).join(':'));
        assert.equal(claims.orgId, DEMO_ORG_ID);
        assert.equal(claims.role, claimRole);
        assert.equal(claims.demo, true);
      }
    });
  });

  it('refuses unknown roles, and never mints a token for a user outside org_demo', async () => {
    await withEnv({ KYLRX_DEMO_MODE: 'true' }, async () => {
      assert.equal((await call('POST', '/api/auth/demo-login', { role: 'owner' })).status, 400);
      assert.equal((await call('POST', '/api/auth/demo-login', {})).status, 400);
      // a real organization's user that merely looks like a demo user is not picked
      await db.collection('users').doc('real_admin').set({ orgId: 'org_real', demoRole: 'admin', isDemo: true, role: 'Super Admin' });
      const body = await (await call('POST', '/api/auth/demo-login', { role: 'admin' })).json();
      assert.ok(!body.customToken.includes('real_admin'));
    });
  });
});

describe('demo tenant isolation', () => {
  it('a demo-organization user sees nothing of another organization', async () => {
    await db.collection('organizations').doc('org_real').collection('business_units').doc('BU_SECRET').set({ orgId: 'org_real', businessUnitCode: 'BU_SECRET' });
    await db.collection('messages').doc('m_real').set({ orgId: 'org_real', chatId: 'a_b', senderId: 'a', text: 'SECRET real message', timestamp: '2026-10-27T10:00:00Z' });
    const demo = asOrg(DEMO_ORG_ID);
    const units = await (await call('GET', '/api/admin/bu-rules', null, demo)).json();
    assert.deepEqual(units.rules, []);
    assert.ok(!(await (await call('GET', '/api/messages/thread/a_b', null, demo)).text()).includes('SECRET'));
  });
});

describe('demo rate limit', () => {
  it('limits demo-login attempts per IP', async () => {
    await withEnv({ KYLRX_DEMO_MODE: 'true' }, async () => {
      const statuses = [];
      for (let i = 0; i < 25; i++) statuses.push((await call('POST', '/api/auth/demo-login', { role: 'admin' })).status);
      assert.ok(statuses.includes(429), `no 429 in ${statuses.join(',')}`);
    });
  });
});

describe('login pages and scripts', () => {
  const pages = ['login.html', 'employee-login.html', 'hrms-login.html', 'manager-login.html'];
  const scripts = ['login.js', 'login-extras.js', 'demo-login-ui.js', 'config.js'];

  it('contain no demo account e-mail and no password literal', () => {
    for (const f of [...pages, ...scripts]) {
      const s = read(f);
      assert.ok(!/superadmin@kylrx\.ai|hradmin@kylrx\.ai|john\.doe@example\.com|marry@gmail\.com/i.test(s), `${f} has a demo e-mail`);
      assert.ok(!/passwordInput\.value\s*=\s*['"`][^'"`]+['"`]/.test(s), `${f} fills in a password`);
      assert.ok(!/validDemoMap|DEMO_(PASSWORD|CREDENTIALS)/.test(s), `${f} has a demo credential map`);
      assert.ok(!/\bpassword\s*[:=]\s*['"`][^'"`\s]{4,}['"`]/i.test(s.replace(/type="password"|type='password'/g, '')), `${f} has a password literal`);
    }
  });

  it('the page sources carry no demo UI or demo text: it is added only when the server says so', () => {
    for (const f of pages) {
      const s = read(f);
      assert.ok(!/1-Click Demo|Demo Roles|demoRolesModal|credentialsBtn|btnQuick|Quick Role/i.test(s), `${f} still has demo markup`);
      assert.ok(s.includes('login-extras.js'), `${f} does not load login-extras.js`);
    }
  });
});

describe('login page UI (jsdom)', () => {
  const windows = [];
  after(() => windows.forEach(w => w.close()));
  const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

  async function boot(page, { demoMode, loginStatus = 200 }) {
    const ui = await import('../demo-login-ui.js');
    const markup = read(page).replace(/<script[\s\S]*?<\/script>/g, '');
    const dom = new JSDOM(markup, { url: 'http://localhost/' + page, runScripts: 'outside-only' });
    const { window } = dom;
    windows.push(window);
    const calls = [];
    window.fetch = async (url, opts) => {
      calls.push([String(url), opts && opts.method, opts && opts.body]);
      if (String(url).endsWith('/api/public-config')) return { ok: true, json: async () => ({ demoMode }) };
      return { ok: loginStatus === 200, status: loginStatus, json: async () => (loginStatus === 200 ? { customToken: 'tok', orgId: 'org_demo' } : { error: 'nope' }) };
    };
    const finished = [];
    window.kylrxFinishSignIn = async (cred) => { finished.push(cred.user.uid); };
    window.__ui = ui;
    window.__stubs = { auth: {}, signInWithCustomToken: async () => ({ user: { uid: 'demo_uid', email: '' } }) };
    const src = read('login-extras.js').replace(/^import .*$/gm, '').replace("await import('./demo-login-ui.js')", 'window.__ui');
    window.eval(`(function () { const { auth, signInWithCustomToken } = window.__stubs; ${src} })();`);
    await tick();
    return { window, document: window.document, calls, finished };
  }

  for (const page of ['login.html', 'employee-login.html', 'hrms-login.html', 'manager-login.html']) {
    it(`${page}: demo mode off adds nothing`, async () => {
      const { document } = await boot(page, { demoMode: false });
      assert.equal(document.getElementById('credentialsBtn'), null);
      assert.equal(document.getElementById('demoRolesModal'), null);
      assert.ok(!/Demo/.test(document.body.textContent));
    });

    it(`${page}: demo mode on shows the bar, the Demo Roles button and the modal, with a live Ready label`, async () => {
      const { document, calls } = await boot(page, { demoMode: true });
      assert.match(document.body.textContent, /1-Click Demo Login/);
      assert.match(document.body.textContent, /Ready/);
      for (const id of ['btnQuickSuperAdmin', 'btnQuickHrAdmin', 'btnQuickManager', 'btnQuickEmployee', 'credentialsBtn', 'demoRolesModal']) assert.ok(document.getElementById(id), id);
      assert.equal(document.getElementById('demoRolesModal').style.display, 'none');
      document.getElementById('credentialsBtn').click();
      assert.equal(document.getElementById('demoRolesModal').style.display, 'flex');
      document.getElementById('closeDemoRolesBtn').click();
      assert.equal(document.getElementById('demoRolesModal').style.display, 'none');
      assert.ok(calls.some(c => c[0].endsWith('/api/public-config')));
    });
  }

  it('a demo button asks the server for that role and finishes the sign-in', async () => {
    const { document, calls, finished } = await boot('login.html', { demoMode: true });
    document.getElementById('btnQuickHrAdmin').click();
    await tick(40);
    const post = calls.find(c => c[1] === 'POST');
    assert.ok(post[0].endsWith('/api/auth/demo-login'));
    assert.deepEqual(JSON.parse(post[2]), { role: 'hrms' });
    assert.deepEqual(finished, ['demo_uid']);
  });

  it('when the server refuses, Ready turns to Unavailable and the error is shown', async () => {
    const { document, finished } = await boot('login.html', { demoMode: true, loginStatus: 503 });
    document.getElementById('btnQuickManager').click();
    await tick(40);
    assert.match(document.body.textContent, /Unavailable/);
    assert.match(document.getElementById('errorMessage').textContent, /nope/);
    assert.deepEqual(finished, []);
  });
});
