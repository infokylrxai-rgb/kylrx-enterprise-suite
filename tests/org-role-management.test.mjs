/**
 * Role management lets an organisation change its own people's roles, which until now was
 * impossible through the product: a role was fixed when the person was created.
 *
 * Changing a role IS privilege escalation, so what must hold is mostly refusals: the
 * organisation comes from the caller's token and never the request, nobody can promote
 * themselves, an organisation can never be left with no super admin, and a uid belonging
 * to another tenant is indistinguishable from one that does not exist.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);

// --- Firestore stand-in ---------------------------------------------------------------
const DOCS = { users: [], employees: [] };   // { id, data }
const WRITES = [];
function makeRef(collection, id) {
  return {
    id, path: collection + '/' + id,
    async get() {
      const row = (DOCS[collection] || []).find(r => r.id === id);
      return { exists: Boolean(row), data: () => row && row.data };
    },
    async set(data, opts) {
      WRITES.push({ collection, id, data });
      const row = (DOCS[collection] || []).find(r => r.id === id);
      if (row) row.data = opts && opts.merge ? { ...row.data, ...data } : data;
      else (DOCS[collection] = DOCS[collection] || []).push({ id, data });
    }
  };
}
function query(collection, clauses) {
  return {
    where(f, _op, v) { return query(collection, [...clauses, [f, v]]); },
    async get() {
      const rows = (DOCS[collection] || []).filter(r => clauses.every(([f, v]) => (r.data || {})[f] === v));
      return { size: rows.length, forEach: (fn) => rows.forEach(r => fn({ id: r.id, data: () => r.data, ref: makeRef(collection, r.id) })) };
    }
  };
}
const mockDb = { collection: (n) => ({ doc: (id) => makeRef(n, id), where: (f, o, v) => query(n, [[f, v]]) }) };

// --- Auth stand-in --------------------------------------------------------------------
const CLAIMS = {};
const mockAdmin = {
  apps: [{}],
  auth: () => ({
    async getUser(uid) {
      if (!CLAIMS[uid]) { const e = new Error('no user'); e.code = 'auth/user-not-found'; throw e; }
      return { uid, customClaims: CLAIMS[uid] };
    },
    async setCustomUserClaims(uid, c) { CLAIMS[uid] = c; }
  })
};

const fb = require.resolve('../config/firebase');
require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: { admin: mockAdmin, db: mockDb } };

const ctrl = require('../controllers/orgRolesController.js');

function mockRes() {
  return { statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
const BOSS = { uid: 'u_boss', email: 'boss@bosco.example', orgId: 'org_bosco', role: 'super_admin' };
const list = async (user = BOSS) => { const r = mockRes(); await ctrl.listOrgMembers({ user }, r); return r; };
const setRole = async (uid, role, user = BOSS) => {
  const r = mockRes();
  await ctrl.updateMemberRole({ user, params: { uid }, body: { role } }, r);
  return r;
};

beforeEach(() => {
  DOCS.users = [
    { id: 'u_boss',  data: { uid: 'u_boss',  email: 'boss@bosco.example',  name: 'Boss',  role: 'super_admin', orgId: 'org_bosco' } },
    { id: 'u_asha',  data: { uid: 'u_asha',  email: 'asha@bosco.example',  name: 'Asha',  role: 'employee',    orgId: 'org_bosco' } },
    { id: 'u_ravi',  data: { uid: 'u_ravi',  email: 'ravi@bosco.example',  name: 'Ravi',  role: 'manager',     orgId: 'org_bosco' } },
    { id: 'u_other', data: { uid: 'u_other', email: 'x@contoso.example',   name: 'Other', role: 'super_admin', orgId: 'org_contoso' } }
  ];
  DOCS.employees = [
    { id: 'e_nolog', data: { email: 'nologin@bosco.example', name: 'No Login', role: 'employee', orgId: 'org_bosco' } }
  ];
  WRITES.length = 0;
  for (const k of Object.keys(CLAIMS)) delete CLAIMS[k];
  Object.assign(CLAIMS, {
    u_boss:  { role: 'super_admin', orgId: 'org_bosco', super_admin: true },
    u_asha:  { role: 'employee',    orgId: 'org_bosco' },
    u_ravi:  { role: 'manager',     orgId: 'org_bosco' },
    u_other: { role: 'super_admin', orgId: 'org_contoso', super_admin: true }
  });
});

describe('listing an organisation\'s people', () => {
  it('shows only the caller\'s own organisation', async () => {
    const res = await list();
    const emails = res.body.members.map(m => m.email);
    assert.ok(emails.includes('asha@bosco.example'));
    assert.ok(!emails.includes('x@contoso.example'), 'another tenant must not appear');
  });

  it('marks somebody with no login, who cannot hold a role yet', async () => {
    const m = (await list()).body.members.find(x => x.email === 'nologin@bosco.example');
    assert.equal(m.hasLogin, false);
  });

  it('reports who the caller is, so the page can refuse self-promotion', async () => {
    const res = await list();
    assert.equal(res.body.you, 'u_boss');
    assert.equal(res.body.superAdminCount, 1);
  });

  it('refuses a caller with no organisation', async () => {
    const res = await list({ uid: 'u1' });
    assert.equal(res.statusCode, 400);
  });
});

describe('changing a role', () => {
  it('writes the claim and the profile together', async () => {
    const res = await setRole('u_asha', 'hr_admin');
    assert.equal(res.statusCode, 200);
    assert.equal(CLAIMS.u_asha.role, 'hr_admin');
    assert.equal(CLAIMS.u_asha.orgId, 'org_bosco', 'orgId must survive the change');
    assert.equal(DOCS.users.find(u => u.id === 'u_asha').data.role, 'hr_admin');
  });

  it('refuses a role that is not assignable', async () => {
    const res = await setRole('u_asha', 'root');
    assert.equal(res.statusCode, 400);
    assert.equal(CLAIMS.u_asha.role, 'employee', 'unchanged');
  });

  /** Nobody promotes themselves. */
  it('refuses changing your own role', async () => {
    const res = await setRole('u_boss', 'employee');
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /your own role/);
    assert.equal(CLAIMS.u_boss.role, 'super_admin');
  });

  /** The tenant boundary, and it must not leak that the uid exists elsewhere. */
  it('refuses a uid from another organisation, indistinguishably from one that does not exist', async () => {
    const theirs = await setRole('u_other', 'employee');
    const absent = await setRole('u_does_not_exist', 'employee');
    assert.equal(theirs.statusCode, 404);
    assert.equal(absent.statusCode, 404);
    assert.equal(theirs.body.error, absent.body.error, 'the two must be indistinguishable');
    assert.equal(CLAIMS.u_other.role, 'super_admin', 'their claims untouched');
    assert.equal(CLAIMS.u_other.orgId, 'org_contoso');
  });

  /** Locking an organisation out of its own administration is unrecoverable from here. */
  it('refuses to demote the only super admin', async () => {
    DOCS.users.push({ id: 'u_second', data: { uid: 'u_second', email: 's@bosco.example', name: 'Second', role: 'super_admin', orgId: 'org_bosco' } });
    CLAIMS.u_second = { role: 'super_admin', orgId: 'org_bosco' };
    // Two now, so demoting one is allowed.
    const ok = await setRole('u_second', 'employee');
    assert.equal(ok.statusCode, 200);
    // Back to one; the remaining super admin is the caller, who is blocked by the self rule.
    const alone = await setRole('u_boss', 'employee');
    assert.equal(alone.statusCode, 403);
  });

  it('blocks the last-super-admin demotion when someone else attempts it', async () => {
    const other = { uid: 'u_ravi', email: 'ravi@bosco.example', orgId: 'org_bosco', role: 'super_admin' };
    const res = await setRole('u_boss', 'employee', other);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /only super admin/i);
    assert.equal(CLAIMS.u_boss.role, 'super_admin');
  });

  it('only a super admin may grant super admin', async () => {
    const hr = { uid: 'u_hr', email: 'hr@bosco.example', orgId: 'org_bosco', role: 'hr_admin' };
    const res = await setRole('u_asha', 'super_admin', hr);
    assert.equal(res.statusCode, 403);
    assert.equal(CLAIMS.u_asha.role, 'employee');
  });

  it('says plainly when the person has no login to carry a role', async () => {
    DOCS.users.push({ id: 'e_nolog', data: { email: 'nologin@bosco.example', name: 'No Login', role: 'employee', orgId: 'org_bosco' } });
    const res = await setRole('e_nolog', 'manager');
    assert.equal(res.statusCode, 404);
    assert.match(res.body.error, /no login yet/i);
  });

  it('keeps the super_admin flag in step with the role', async () => {
    await setRole('u_asha', 'super_admin');
    assert.equal(CLAIMS.u_asha.super_admin, true);
    await setRole('u_asha', 'employee');
    assert.equal(CLAIMS.u_asha.super_admin, false, 'a stale flag would leave full access behind');
  });
});
