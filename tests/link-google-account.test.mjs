/**
 * POST /api/auth/link-google completes a Google sign-in: the server decides who may enter and
 * attaches role + orgId to the Google identity.
 *
 * It exists because the browser cannot do it. firestore.rules only lets a user create their OWN
 * profile when the role is 'Employee' and the orgId already matches their token, so the client's
 * users/{googleUid} write was silently denied for everyone else - leaving a person signed in with
 * no claims and no profile, who could open a dashboard and read nothing.
 *
 * The two properties that matter here: role and orgId come from the EXISTING record and never from
 * the request, and an unknown Google account is removed rather than left to accumulate - but only
 * when we are certain it is unknown.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long!!';
process.env.REFRESH_SECRET = process.env.REFRESH_SECRET || 'another-test-secret-32-characters-long!!';

const require = createRequire(import.meta.url);

// State the mocks read, reset per test.
const S = {};
function reset() {
  S.token = { uid: 'google-uid-1', email: 'Person@Example.com' };
  S.tokenValid = true;
  S.usersByUid = {};          // uid -> doc data
  S.usersByEmail = {};        // email -> { id, data }
  S.employeesByEmail = {};
  S.throwOnLookup = false;
  S.authUsers = { 'google-uid-1': { uid: 'google-uid-1', customClaims: null,
      providerData: [{ providerId: 'google.com' }],
      metadata: { creationTime: new Date().toISOString() } } };
  S.claimsSet = null;
  S.deleted = [];
  S.written = {};
  S.retired = [];
}

const docRef = (collection, id) => ({
  id, path: collection + '/' + id,
  async get() {
    if (S.throwOnLookup) throw new Error('firestore unavailable');
    const data = collection === 'users' ? S.usersByUid[id] : undefined;
    return { exists: !!data, data: () => data, ref: docRef(collection, id) };
  },
  async set(data, opts) {
    if (collection === 'users' && S.usersByUid[id] === undefined && !opts) S.usersByUid[id] = data;
    S.written[collection + '/' + id] = data;
    if (data && data.supersededByUid) S.retired.push(collection + '/' + id);
  }
});

const mockDb = {
  collection(name) {
    return {
      doc: (id) => docRef(name, id),
      where(field, op, value) {
        return { limit: () => ({
          async get() {
            if (S.throwOnLookup) throw new Error('firestore unavailable');
            const src = name === 'users' ? S.usersByEmail : S.employeesByEmail;
            const hit = src[String(value).toLowerCase()];
            if (!hit) return { empty: true, docs: [] };
            return { empty: false, docs: [{ data: () => hit.data, ref: docRef(name, hit.id) }] };
          }
        })};
      }
    };
  }
};

const mockAdmin = {
  auth: () => ({
    async verifyIdToken() { if (!S.tokenValid) throw new Error('bad token'); return S.token; },
    async getUser(uid) { const u = S.authUsers[uid]; if (!u) throw new Error('no user'); return u; },
    async setCustomUserClaims(uid, claims) { S.claimsSet = { uid, claims }; },
    async deleteUser(uid) { S.deleted.push(uid); delete S.authUsers[uid]; }
  })
};

// Install the mock before authController loads.
const fbPath = require.resolve('../config/firebase');
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { admin: mockAdmin, db: mockDb } };
const ctrl = require('../controllers/authController.js');

function mockRes() {
  return { statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
async function call(headers = { authorization: 'Bearer tok' }, body = {}) {
  const res = mockRes();
  await ctrl.linkGoogleAccount({ headers, body }, res);
  return res;
}

beforeEach(reset);

describe('link-google: who is allowed in', () => {
  it('401 without a token', async () => {
    assert.equal((await call({})).statusCode, 401);
  });

  it('401 on an invalid token', async () => {
    S.tokenValid = false;
    assert.equal((await call()).statusCode, 401);
  });

  it('403 and DELETES the account when no Kylrx record exists', async () => {
    const res = await call();
    assert.equal(res.statusCode, 403);
    assert.deepEqual(S.deleted, ['google-uid-1'], 'the stray Google account must not be left behind');
    assert.match(res.body.error, /No Kylrx account exists/);
  });

  it('503 and does NOT delete when the lookup itself failed', async () => {
    S.throwOnLookup = true;
    const res = await call();
    assert.equal(res.statusCode, 503);
    assert.deepEqual(S.deleted, [], 'a Firestore outage must never be read as "unknown person"');
  });

  it('409 when the record has no organisation', async () => {
    S.usersByEmail['person@example.com'] = { id: 'google-uid-1', data: { role: 'employee' } };
    assert.equal((await call()).statusCode, 409);
  });
});

describe('link-google: what the identity receives', () => {
  it('sets claims and returns the role from the existing record', async () => {
    S.usersByUid['google-uid-1'] = { role: 'hrms', orgId: 'org_kylrx', name: 'Person' };
    const res = await call();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.role, 'hrms');
    assert.equal(res.body.orgId, 'org_kylrx');
    assert.deepEqual(S.claimsSet, { uid: 'google-uid-1', claims: { role: 'hrms', orgId: 'org_kylrx' } });
    assert.equal(S.written['users/google-uid-1'].orgId, 'org_kylrx');
  });

  it('IGNORES a role or orgId supplied in the request body', async () => {
    S.usersByUid['google-uid-1'] = { role: 'employee', orgId: 'org_kylrx' };
    const res = await call({ authorization: 'Bearer tok' },
      { role: 'super_admin', orgId: 'org_acme', super_admin: true });
    assert.equal(res.body.role, 'employee', 'role must come from the record, never the request');
    assert.equal(res.body.orgId, 'org_kylrx');
    assert.equal(S.claimsSet.claims.role, 'employee');
  });

  it('returns only presentational profile fields', async () => {
    S.usersByUid['google-uid-1'] = { role: 'employee', orgId: 'org_kylrx', name: 'P',
      departmentName: 'Eng', tempPassword: 'should-not-leak', passwordHash: 'nope' };
    const res = await call();
    const keys = Object.keys(res.body.profile);
    assert.ok(!keys.includes('tempPassword') && !keys.includes('passwordHash'),
      'profile leaked credential fields: ' + keys.join(','));
    assert.equal(res.body.profile.departmentName, 'Eng');
  });
});

describe('link-google: one person, one record', () => {
  it('retires an onboarding placeholder that has no login of its own', async () => {
    S.usersByEmail['person@example.com'] = { id: 'phantom-doc-id', data: { role: 'employee', orgId: 'org_kylrx' } };
    const res = await call();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.migrated, true);
    assert.equal(S.written['users/google-uid-1'].migratedFrom, 'users/phantom-doc-id');
    assert.deepEqual(S.retired, ['users/phantom-doc-id'], 'the placeholder must not linger as a duplicate');
  });

  it('leaves a record alone when it has its own Auth account', async () => {
    S.usersByEmail['person@example.com'] = { id: 'real-other-uid', data: { role: 'employee', orgId: 'org_kylrx' } };
    S.authUsers['real-other-uid'] = { uid: 'real-other-uid', customClaims: { role: 'employee' },
      providerData: [{ providerId: 'password' }], metadata: { creationTime: new Date(0).toISOString() } };
    await call();
    assert.deepEqual(S.retired, [], 'a real separate account must never be retired');
  });
});

describe('link-google: deletion is narrow on purpose', () => {
  it('does not delete an account that already carries claims', async () => {
    S.authUsers['google-uid-1'].customClaims = { role: 'employee' };
    await call();
    assert.deepEqual(S.deleted, [], 'an established account must not be deleted');
  });

  it('does not delete an account that is not brand new', async () => {
    S.authUsers['google-uid-1'].metadata = { creationTime: new Date(Date.now() - 3600e3).toISOString() };
    await call();
    assert.deepEqual(S.deleted, []);
  });

  it('does not delete an account with a non-Google provider', async () => {
    S.authUsers['google-uid-1'].providerData = [{ providerId: 'google.com' }, { providerId: 'password' }];
    await call();
    assert.deepEqual(S.deleted, []);
  });
});
