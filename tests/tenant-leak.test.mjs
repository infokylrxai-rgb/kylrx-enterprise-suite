/**
 * Cross-tenant leak test for the Express API (Admin SDK, bypasses firestore.rules).
 *
 * Boots the real app in production mode with TENANT_READ_SCOPING=on against the Firestore
 * EMULATOR, seeds two organizations, then calls every GET route as org A (and as an
 * unauthenticated / dev-token caller) and fails if any response contains org B's data.
 *
 * Run with:   npm run test:tenant      (needs Java 11+ for the emulator)
 * Limits: GET routes only; params are filled with org B document ids; routes mounted
 * inside other routers (router.use) are not enumerated.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set (this test must never touch a real project). Use npm run test:tenant.');
}

const require = createRequire(import.meta.url);
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

// Production-like environment, set before any app module loads
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'leak-test-jwt-secret-at-least-32-characters';
process.env.REFRESH_SECRET = 'leak-test-refresh-secret-at-least-32-chars';
// LEAK_TEST_SCOPING=off shows what leaks today, before the orgId migration
process.env.TENANT_READ_SCOPING = process.env.LEAK_TEST_SCOPING || 'on';
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account', project_id: 'demo-leak', private_key_id: 'x',
  private_key: privateKey, client_email: 'leak-test@demo-leak.iam.gserviceaccount.com', client_id: '1'
});
process.env.GCLOUD_PROJECT = 'demo-leak';
process.env.FIREBASE_PROJECT_ID = 'demo-leak';
process.env.FIREBASE_STORAGE_BUCKET = 'demo-leak.appspot.com';
// The rest of what production requires (scripts/check-env.js): test-only values
process.env.KYLRX_EXPORT_SIGNING_KEY = 'leak-test-export-signing-key-32-characters';
process.env.DECENTRO_BASE_URL = 'https://decentro.invalid';
process.env.DECENTRO_CLIENT_ID = 'leak-test';
process.env.DECENTRO_CLIENT_SECRET = 'leak-test';
process.env.DECENTRO_MODULE_SECRET = 'leak-test';
process.env.DECENTRO_PROVIDER_SECRET = 'leak-test';
process.env.APP_URL = 'https://app.invalid';

const A = 'org_leak_a';
const B = 'org_leak_b';
const MARK_A = 'SECRET_ORG_A';
const MARK_B = 'SECRET_ORG_B';
const B_ID = 'ORGB_DOC';

const COLLECTIONS = [
  'users', 'employees', 'notifications', 'tasks', 'attendance', 'payroll_profiles', 'payroll_runs',
  'payment_batches', 'messages', 'activities', 'automations', 'automation_runs', 'automation_audit_logs',
  'alert_rules', 'alert_breaches', 'assets', 'policies', 'leave_types', 'leave_policies', 'holidays',
  'shifts', 'business_units', 'command_centers', 'onboarding_config', 'onboarding_invites', 'pms_cycles',
  'pms_tasks', 'gratuity_settlements', 'esic_compliance_batches', 'nps_compliance_batches',
  'pf_compliance_batches', 'compliance_returns', 'employee_assignments', 'hr_tasks', 'legal_entities',
  'assignment_rules', 'performance_metrics', 'audit_logs', 'document_audit_logs', 'bu_employee_type_rules'
];

// Record every router mounted on the app so GET routes can be enumerated (Express 5 keeps no mount path)
const express = require('express');
const mounts = [];
const origUse = express.application.use;
express.application.use = function (...args) {
  const router = args.find((a) => a && typeof a === 'function' && Array.isArray(a.stack));
  if (typeof args[0] === 'string' && router) mounts.push([args[0], router]);
  return origUse.apply(this, args);
};

const jwt = require('jsonwebtoken');
let server;
let base;
const getRoutes = new Set();

function collectGetRoutes() {
  for (const [prefix, router] of mounts) {
    for (const layer of router.stack) {
      if (layer.route && layer.route.methods.get && typeof layer.route.path === 'string') {
        const sub = layer.route.path === '/' ? '' : layer.route.path;
        getRoutes.add((prefix + sub).replace(/:[A-Za-z0-9_]+\??/g, B_ID).replace(/\*/g, B_ID));
      }
    }
  }
}

async function call(path, headers = {}) {
  try {
    const res = await fetch(base + path, { headers, signal: AbortSignal.timeout(8000) });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: '' };
  }
}

before(async () => {
  const { app, dynamicRoutesLoaded } = require('../server.js');
  await dynamicRoutesLoaded;
  collectGetRoutes();

  const { rawCollection } = require('../config/firebase');
  assert.ok(rawCollection, 'tenant scoping must be installed (service account not loaded?)');
  for (const [org, mark] of [[A, MARK_A], [B, MARK_B]]) {
    for (const col of COLLECTIONS) {
      const id = org === B ? B_ID : 'ORGA_DOC';
      await rawCollection(col).doc(id).set({
        orgId: org, name: `${mark} name`, title: `${mark} title`, employeeId: org === B ? 'ORGB_USER' : 'ORGA_USER',
        email: `${mark.toLowerCase()}@leak.test`, status: 'ACTIVE', createdAt: new Date().toISOString()
      });
    }
  }
  await rawCollection('users').doc('ORGA_USER').set({ orgId: A, role: 'Super Admin', email: 'a-admin@leak.test', name: `${MARK_A} admin` });
  await rawCollection('users').doc('ORGB_USER').set({ orgId: B, role: 'Super Admin', email: 'b-admin@leak.test', name: `${MARK_B} admin` });

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server?.closeAllConnections?.(); server?.close(); });

describe('API tenant isolation (production mode, TENANT_READ_SCOPING=on)', () => {
  it('enumerates a meaningful set of GET routes', () => {
    assert.ok(getRoutes.size > 50, `only ${getRoutes.size} GET routes found`);
  });

  it('org A token never receives org B data from any GET route (and does receive its own)', async () => {
    const token = jwt.sign({ id: 'ORGA_USER', role: 'Super Admin' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const leaks = [];
    let ownHits = 0;
    let ok200 = 0;
    for (const route of getRoutes) {
      const { status, body } = await call(route, { Authorization: `Bearer ${token}` });
      if (status === 200) ok200++;
      if (body.includes(MARK_B) || body.includes('ORGB_USER') || body.includes('orgsecret_b')) leaks.push(`${route} -> ${status}`);
      if (body.includes(MARK_A)) ownHits++;
    }
    console.log(`  routes=${getRoutes.size} http200=${ok200} routesReturningOrgAData=${ownHits}`);
    assert.deepEqual(leaks, [], `org B data leaked to an org A token via:\n${leaks.join('\n')}`);
    assert.ok(ownHits > 0, 'positive control failed: no route returned org A data, so the test proves nothing');
  });

  it('production: verifyToken rejects dev tokens and ?role= with 401', async () => {
    const bad = [];
    for (const [label, headers, q] of [
      ['no credentials', {}, ''],
      ['super_admin_dev_token', { Authorization: 'Bearer super_admin_dev_token' }, ''],
      ['dev_ prefix token', { Authorization: 'Bearer dev_anything' }, ''],
      ['?role= without token', {}, '?role=super_admin'],
      ['garbage token + ?role=', { Authorization: 'Bearer not-a-real-token' }, '?role=super_admin']
    ]) {
      const { status } = await call('/api/firebase/status' + q, headers);
      if (status !== 401) bad.push(`${label} -> ${status}`);
    }
    assert.deepEqual(bad, [], 'verifyToken granted access in production: ' + bad.join('; '));
  });

  for (const [label, headers, suffix] of [
    ['no credentials', {}, ''],
    ['dev token super_admin_dev_token', { Authorization: 'Bearer super_admin_dev_token' }, ''],
    ['?role=super_admin and no token', {}, 'role=super_admin'],
    ['invalid token plus ?role=super_admin', { Authorization: 'Bearer not-a-real-token' }, 'role=super_admin']
  ]) {
    it(`production: ${label} gets no tenant data from any GET route`, async () => {
      const leaks = [];
      for (const route of getRoutes) {
        const url = suffix ? `${route}${route.includes('?') ? '&' : '?'}${suffix}` : route;
        const { status, body } = await call(url, headers);
        if (/SECRET_ORG_[AB]/.test(body)) leaks.push(`${route} -> ${status}`);
      }
      assert.deepEqual(leaks, [], `unauthenticated caller read tenant data via:\n${leaks.join('\n')}`);
    });
  }
});
