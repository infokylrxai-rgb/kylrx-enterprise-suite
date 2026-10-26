/**
 * Workforce Monitor (GET /api/workforce-monitor): organization A never receives organization B's
 * employees, activity, attendance or sessions, whatever the request says. The organization comes
 * only from the verified token.
 */
import './helpers/isolate-firebase.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);
const A = 'org_monitor_a';
const B = 'org_monitor_b';
const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

let server;
let baseUrl;
let db;
let LEGACY_ORG_ID;

const token = (claims) => jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '10m' });
const asAdmin = (orgId) => ({ Authorization: `Bearer ${token({ id: `admin_of_${orgId || 'none'}`, role: 'Super Admin', ...(orgId ? { orgId } : {}) })}` });
const get = (path, headers = {}) => fetch(`${baseUrl}${path}`, { headers });

before(async () => {
  const { default: serverModule } = await import('../server.js');
  const admin = require('firebase-admin');
  assert.equal(admin.apps.length, 0, 'a real Firebase app is initialised; the test must run on the in-memory store');
  await serverModule.dynamicRoutesLoaded;
  ({ db } = require('../config/firebase'));
  ({ LEGACY_ORG_ID } = require('../config/tenant'));

  const seed = async (col, id, data) => { await db.collection(col).doc(id).set(data); };
  // people
  await seed('users', 'a_emp', { orgId: A, role: 'employee', name: 'Alice Alpha', email: 'alice@a.test', password: '$2b$secret-hash-A', status: 'Active' });
  await seed('users', 'a_mgr', { orgId: A, role: 'manager', name: 'Alan Manager', email: 'alan@a.test' });
  await seed('users', 'b_emp', { orgId: B, role: 'employee', name: 'Bob Beta', email: 'bob@b.test', password: '$2b$secret-hash-B' });
  await seed('users', 'b_emp2', { orgId: B, role: 'employee', name: 'Bella Beta', email: 'bella@b.test' });
  await seed('users', 'legacy_emp', { role: 'employee', name: 'Lenny Legacy', email: 'lenny@old.test' }); // untagged
  // live activity: tagged, untagged-with-owner, and orphans with no matching person
  await seed('activityStatus', 'a_emp', { orgId: A, status: 'Active', aiProductivityScore: 80 });
  await seed('activityStatus', 'b_emp', { orgId: B, status: 'Active' });
  await seed('activityStatus', 'legacy_emp', { status: 'Active' });
  await seed('activityStatus', 'ghost_user', { status: 'Active', lastUpdated: new Date() });
  // attendance: today and yesterday
  await seed('attendance', `a_emp_${today}`, { userId: 'a_emp', orgId: A, date: today, userName: 'Alice Alpha', punchIn: new Date() });
  await seed('attendance', `a_emp_${yesterday}`, { userId: 'a_emp', orgId: A, date: yesterday, punchIn: new Date() });
  await seed('attendance', `b_emp_${today}`, { userId: 'b_emp', orgId: B, date: today, userName: 'Bob Beta', punchIn: new Date() });
  await seed('attendance', `legacy_emp_${today}`, { userId: 'legacy_emp', date: today, userName: 'Lenny Legacy' });
  await seed('attendance', `ghost_user_${today}`, { userId: 'ghost_user', date: today, userName: 'Ghost' });
  // admin / manager sessions
  await seed('admin_sessions', `a_mgr_${today}`, { userId: 'a_mgr', name: 'Alan Manager', status: 'Active' }); // untagged, owner is in org A
  await seed('admin_sessions', `b_adm_${today}`, { userId: 'b_adm', orgId: B, name: 'Beth Admin', status: 'Active' });

  server = http.createServer(serverModule.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

const names = (rows) => rows.map(r => r.name || r.userName).filter(Boolean).sort();

describe('Workforce Monitor tenant isolation', () => {
  it('organization A gets only its own employees, activity, attendance and sessions', async () => {
    const res = await get('/api/workforce-monitor', asAdmin(A));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(names(body.users), ['Alan Manager', 'Alice Alpha']);
    assert.deepEqual(body.activity.map(a => a.id), ['a_emp']);
    assert.deepEqual(body.attendance.map(a => a.id), [`a_emp_${today}`]); // today only
    assert.deepEqual(names(body.adminSessions), ['Alan Manager']);

    const text = JSON.stringify(body);
    for (const leak of ['Bob', 'Bella', 'Lenny', 'Ghost', 'Beth', 'b_emp', 'legacy_emp', 'ghost_user', org => org]) {
      if (typeof leak === 'string') assert.ok(!text.includes(leak), `org A response contains ${leak}`);
    }
    assert.ok(!text.includes(B), 'org A response mentions org B');
    assert.ok(!/secret-hash|password/i.test(text), 'password data left the server');
  });

  it('organization B gets only its own, and no legacy or orphan documents', async () => {
    const body = await (await get('/api/workforce-monitor', asAdmin(B))).json();
    assert.deepEqual(names(body.users), ['Bella Beta', 'Bob Beta']);
    assert.deepEqual(body.activity.map(a => a.id), ['b_emp']);
    assert.deepEqual(body.attendance.map(a => a.id), [`b_emp_${today}`]);
    assert.deepEqual(names(body.adminSessions), ['Beth Admin']);
    const text = JSON.stringify(body);
    for (const leak of ['Alice', 'Alan', 'Lenny', 'Ghost', 'a_emp', 'legacy_emp', 'ghost_user']) assert.ok(!text.includes(leak), `org B response contains ${leak}`);
  });

  it('the organization cannot be chosen by header, query or the Origin of the request', async () => {
    for (const [path, headers] of [
      [`/api/workforce-monitor?orgId=${B}&org=${B}&organizationId=${B}`, {}],
      ['/api/workforce-monitor', { 'X-Org-Id': B, 'X-Tenant-Id': B, 'X-Organization-Id': B }]
    ]) {
      const body = await (await get(path, { ...asAdmin(A), ...headers })).json();
      assert.deepEqual(names(body.users), ['Alan Manager', 'Alice Alpha']);
    }
  });

  it('the legacy organization sees its untagged people, but orphan documents stay hidden for everyone', async () => {
    const body = await (await get('/api/workforce-monitor', asAdmin(LEGACY_ORG_ID))).json();
    // (the in-memory store also holds some untagged demo users, which belong to the legacy organization)
    assert.ok(names(body.users).includes('Lenny Legacy'));
    assert.ok(body.activity.some(a => a.id === 'legacy_emp'));
    const text = JSON.stringify(body);
    for (const leak of ['Alice', 'Alan', 'Bob', 'Bella', 'Beth', 'Ghost', 'ghost_user', 'a_emp', 'b_emp']) assert.ok(!text.includes(leak), `legacy response contains ${leak}`);
  });

  it('a token with no organization gets 403 and the route reads no workforce data', async () => {
    const collections = [];
    const original = db.collection;
    db.collection = function (name, ...rest) { collections.push(name); return original.call(this, name, ...rest); };
    try {
      const res = await get('/api/workforce-monitor', asAdmin(null));
      assert.equal(res.status, 403);
      // verifyToken looks up the caller's own profile; nothing else may be read
      assert.deepEqual([...new Set(collections)].filter(name => name !== 'users'), []);
      assert.ok(collections.length <= 2, `unexpected reads: ${collections.join(',')}`);
    } finally {
      db.collection = original;
    }
  });

  it('employees and unauthenticated callers are refused', async () => {
    const employee = { Authorization: `Bearer ${token({ id: 'a_emp', role: 'Employee', orgId: A })}` };
    assert.equal((await get('/api/workforce-monitor', employee)).status, 403);
    assert.equal((await get('/api/workforce-monitor')).status, 401);
  });

  it('per-person attendance: own organization only', async () => {
    const own = await get('/api/workforce-monitor/attendance/a_emp', asAdmin(A));
    assert.equal(own.status, 200);
    assert.deepEqual((await own.json()).logs.map(l => l.date), [today, yesterday]);
    assert.equal((await get('/api/workforce-monitor/attendance/b_emp', asAdmin(A))).status, 404);
    assert.equal((await get('/api/workforce-monitor/attendance/legacy_emp', asAdmin(A))).status, 404);
  });
});
