/**
 * /api/admin/bu-rules and employee validation: business units live only in
 * organizations/{orgId}/business_units, one organization's rules never reach another,
 * the legacy bu_employee_type_rules collection is not written, and no organization is refused.
 */
import './helpers/isolate-firebase.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);
const A = 'org_bu_a';
const B = 'org_bu_b';
let server;
let baseUrl;
let db;

const as = (orgId, role = 'Super Admin') => ({ Authorization: `Bearer ${jwt.sign({ id: `admin_of_${orgId}`, role, ...(orgId ? { orgId } : {}) }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const call = (method, p, headers, body) => fetch(`${baseUrl}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
const unit = { businessUnitCode: 'BU_ONLY_A', businessUnitName: 'Only A', allowedEmployeeTypes: ['FULL_TIME'], isActive: true };

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

describe('business unit API', () => {
  it('saves under the caller\'s organization with orgId, and never writes the legacy collection', async () => {
    const res = await call('POST', '/api/admin/bu-rules', as(A), unit);
    assert.equal(res.status, 200, await res.clone().text());
    const stored = await db.collection('organizations').doc(A).collection('business_units').doc('BU_ONLY_A').get();
    assert.equal(stored.exists, true);
    assert.equal(stored.data().orgId, A);
    assert.equal((await db.collection('bu_employee_type_rules').get()).docs.length, 0, 'the legacy collection was written');
  });

  it('another organization does not see it', async () => {
    const mine = await (await call('GET', '/api/admin/bu-rules', as(A))).json();
    assert.deepEqual(mine.rules.map(r => r.businessUnitCode), ['BU_ONLY_A']);
    const theirs = await (await call('GET', '/api/admin/bu-rules', as(B))).json();
    assert.deepEqual(theirs.rules, []);
  });

  it('creating an employee is validated against the caller\'s own business units, not a shared list', async () => {
    const body = { name: 'Eve Example', email: 'eve@example.test', phone: '9999999999', role: 'Employee', departmentId: 'hrms', salary: 1, businessUnitCode: 'BU_ONLY_A', employeeType: 'INTERN' };
    const inA = await call('POST', '/api/admin/employees', as(A), body);
    assert.equal(inA.status, 400, 'FULL_TIME-only unit accepted an intern: ' + await inA.clone().text());
    assert.match((await inA.json()).message, /does not permit/);
    const inB = await call('POST', '/api/admin/employees', as(B), body);
    assert.equal(inB.status, 400);
    assert.match((await inB.json()).message, /not recognized/, 'org B must not know org A\'s unit');
  });

  it('a token without an organization is refused', async () => {
    const res = await call('POST', '/api/admin/bu-rules', as(null), unit);
    assert.equal(res.status, 403);
  });

  it('deleting removes the organization\'s unit only', async () => {
    await call('POST', '/api/admin/bu-rules', as(B), unit);
    const del = await call('DELETE', '/api/admin/business-units/BU_ONLY_A', as(A));
    assert.equal(del.status, 200);
    assert.equal((await db.collection('organizations').doc(A).collection('business_units').doc('BU_ONLY_A').get()).exists, false);
    assert.equal((await db.collection('organizations').doc(B).collection('business_units').doc('BU_ONLY_A').get()).exists, true);
  });
});
