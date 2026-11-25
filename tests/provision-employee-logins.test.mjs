/**
 * Every UI path that creates employees - the 27-sheet Bulk Onboarding workbook, the
 * provisionEmployees callable, app.js - writes Firestore documents only. A browser cannot create
 * a Firebase Auth account for someone else, so those people had no password, no invite and no way
 * in: HR could upload a whole company and not one of them could sign in.
 *
 * POST /api/admin/employees/provision-logins closes that for records however they arrived.
 * What must hold: it stays inside the caller's organisation, takes the role from the record
 * rather than the request, is safe to re-run, and does not let one bad record stop the rest.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long!!';
process.env.APP_URL = 'https://app.kylrxai.com';

const require = createRequire(import.meta.url);

const S = {};
function reset() {
  S.docs = { users: [], employees: [] };   // { id, data }
  S.authByEmail = {};                       // email -> uid
  S.authByUid = {};                         // uid -> record
  S.created = [];
  S.claims = {};
  S.written = {};
  S.retired = [];
  S.emailFails = false;
  S.sent = [];
  S.createThrowsFor = null;
  S.nextUid = 1;
}

const makeRef = (collection, id) => ({
  id, path: collection + '/' + id,
  async set(data, opts) {
    S.written[collection + '/' + id] = Object.assign({}, S.written[collection + '/' + id] || {}, data);
    if (data && data.supersededByUid) S.retired.push(collection + '/' + id);
  }
});

const mockDb = {
  collection(name) {
    return {
      doc: (id) => makeRef(name, id),
      where(field, op, value) {
        return { async get() {
          const rows = (S.docs[name] || []).filter(r => (r.data || {})[field] === value);
          return { size: rows.length, forEach: (fn) => rows.forEach(r => fn({ data: () => r.data, ref: makeRef(name, r.id) })) };
        }};
      }
    };
  }
};

const mockAdmin = {
  apps: [{}],
  auth: () => ({
    async getUserByEmail(email) {
      const uid = S.authByEmail[email];
      if (!uid) { const e = new Error('not found'); e.code = 'auth/user-not-found'; throw e; }
      return { uid, email };
    },
    async getUser(uid) { const u = S.authByUid[uid]; if (!u) throw new Error('no user'); return u; },
    async createUser({ email, password, displayName }) {
      if (S.createThrowsFor === email) throw new Error('auth/invalid-email');
      const uid = 'new-uid-' + (S.nextUid++);
      S.authByEmail[email] = uid; S.authByUid[uid] = { uid, email };
      S.created.push({ uid, email, password, displayName });
      return { uid, email };
    },
    async setCustomUserClaims(uid, claims) { S.claims[uid] = claims; }
  })
};

const fb = require.resolve('../config/firebase');
require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: { admin: mockAdmin, db: mockDb } };
const em = require.resolve('../utils/email');
require.cache[em] = { id: em, filename: em, loaded: true, exports: { sendEmail: async (m) => {
  if (S.emailFails) throw new Error('No email transport configured');
  S.sent.push(m.to);
}}};

const ctrl = require('../controllers/adminController.js');

function mockRes() {
  return { statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
const call = async (user = { orgId: 'org_customer', role: 'super_admin' }, body = {}) => {
  const res = mockRes();
  await ctrl.provisionEmployeeLogins({ user, body }, res);
  return res;
};

beforeEach(reset);

describe('provisioning logins', () => {
  it('400 when the caller has no organization', async () => {
    assert.equal((await call({ role: 'super_admin' })).statusCode, 400);
  });

  it('creates a login, claims and a profile at the Auth uid', async () => {
    S.docs.users.push({ id: 'phantom-1', data: { email: 'a@c.com', name: 'A', role: 'employee', orgId: 'org_customer', departmentId: 'ENG' } });
    const res = await call();
    assert.equal(res.body.created, 1);
    const uid = S.created[0].uid;
    assert.deepEqual(S.claims[uid], { role: 'employee', orgId: 'org_customer', departmentId: 'ENG' });
    assert.equal(S.written['users/' + uid].orgId, 'org_customer');
    assert.equal(S.written['users/' + uid].must_change_password, true);
    assert.deepEqual(S.sent, ['a@c.com']);
  });

  it('is idempotent: someone who already has a login is skipped', async () => {
    S.docs.users.push({ id: 'u1', data: { email: 'has@c.com', role: 'employee', orgId: 'org_customer' } });
    S.authByEmail['has@c.com'] = 'existing-uid';
    const res = await call();
    assert.equal(res.body.created, 0);
    assert.equal(res.body.skipped, 1);
    assert.equal(S.created.length, 0, 'must not create a second account');
  });

  it('never touches another organization', async () => {
    S.docs.users.push({ id: 'mine', data: { email: 'mine@c.com', role: 'employee', orgId: 'org_customer' } });
    S.docs.users.push({ id: 'theirs', data: { email: 'theirs@other.com', role: 'employee', orgId: 'org_other' } });
    const res = await call();
    assert.equal(res.body.created, 1);
    assert.deepEqual(S.created.map(c => c.email), ['mine@c.com']);
  });

  it('takes role from the record and orgId from the token, never from the body', async () => {
    S.docs.users.push({ id: 'p', data: { email: 'p@c.com', role: 'employee', orgId: 'org_customer' } });
    await call({ orgId: 'org_customer', role: 'super_admin' }, { role: 'super_admin', orgId: 'org_other' });
    const uid = S.created[0].uid;
    assert.equal(S.claims[uid].role, 'employee');
    assert.equal(S.claims[uid].orgId, 'org_customer');
  });

  it('one bad record does not stop the others', async () => {
    S.docs.users.push({ id: 'ok1', data: { email: 'ok1@c.com', role: 'employee', orgId: 'org_customer' } });
    S.docs.users.push({ id: 'bad', data: { email: 'bad@c.com', role: 'employee', orgId: 'org_customer' } });
    S.docs.users.push({ id: 'ok2', data: { email: 'ok2@c.com', role: 'employee', orgId: 'org_customer' } });
    S.createThrowsFor = 'bad@c.com';
    const res = await call();
    assert.equal(res.body.created, 2);
    assert.equal(res.body.failed, 1);
    assert.equal(res.body.results.find(r => r.email === 'bad@c.com').status, 'failed');
  });

  it('retires the placeholder so one person is not two records', async () => {
    S.docs.users.push({ id: 'phantom-x', data: { email: 'x@c.com', role: 'employee', orgId: 'org_customer' } });
    await call();
    const uid = S.created[0].uid;
    assert.equal(S.written['users/' + uid].migratedFrom, 'users/phantom-x');
    assert.deepEqual(S.retired, ['users/phantom-x']);
  });

  it('still creates the account when the invite cannot be emailed', async () => {
    S.emailFails = true;
    S.docs.users.push({ id: 'n', data: { email: 'n@c.com', role: 'employee', orgId: 'org_customer' } });
    const res = await call();
    assert.equal(res.body.created, 1);
    const row = res.body.results[0];
    assert.equal(row.invite, 'not sent');
    assert.ok(row.tempPassword, 'the password must be returned so an admin can pass it on');
  });

  it('de-duplicates a person present in both users and employees', async () => {
    S.docs.users.push({ id: 'u', data: { email: 'dup@c.com', role: 'employee', orgId: 'org_customer' } });
    S.docs.employees.push({ id: 'e', data: { email: 'dup@c.com', role: 'employee', orgId: 'org_customer' } });
    const res = await call();
    assert.equal(res.body.created, 1, 'one person, one account');
  });

  it('honours an explicit email list', async () => {
    S.docs.users.push({ id: 'a', data: { email: 'a@c.com', role: 'employee', orgId: 'org_customer' } });
    S.docs.users.push({ id: 'b', data: { email: 'b@c.com', role: 'employee', orgId: 'org_customer' } });
    const res = await call({ orgId: 'org_customer' }, { emails: ['B@C.com'] });
    assert.equal(res.body.created, 1);
    assert.deepEqual(S.created.map(c => c.email), ['b@c.com']);
  });

  it('bounds the batch and says when it was truncated', async () => {
    for (let i = 0; i < 5; i++) S.docs.users.push({ id: 'u' + i, data: { email: 'u' + i + '@c.com', role: 'employee', orgId: 'org_customer' } });
    const res = await call({ orgId: 'org_customer' }, { limit: 2 });
    assert.equal(res.body.processed, 2);
    assert.equal(res.body.truncated, true);
  });

  it('skips records with no email rather than failing', async () => {
    S.docs.users.push({ id: 'noemail', data: { role: 'employee', orgId: 'org_customer' } });
    const res = await call();
    assert.equal(res.body.considered, 0);
    assert.equal(res.body.created, 0);
  });
});
