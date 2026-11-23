/**
 * /api/notifications (routes/notifications.js): the signed-in user's organization only.
 * Its old behaviour merged every organization's notifications into one shared file and let any
 * caller read or change any notification by id.
 */
import './helpers/isolate-firebase.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';

// The route keeps a local cache under the user's home; point it at a temp folder
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kylrx-notif-'));
process.env.USERPROFILE = home;
process.env.HOME = home;

const require = createRequire(import.meta.url);
const A = 'org_notif_a';
const B = 'org_notif_b';
let server;
let baseUrl;
let db;

const as = (orgId, role = 'Super Admin', id = `user_of_${orgId}`) => ({ Authorization: `Bearer ${jwt.sign({ id, role, orgId }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const call = (method, p, headers, body) => fetch(`${baseUrl}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  const { default: serverModule } = await import('../server.js');
  assert.equal(require('firebase-admin').apps.length, 0, 'a real Firebase app is initialised');
  await serverModule.dynamicRoutesLoaded;
  ({ db } = require('../config/firebase'));
  const seed = (id, data) => db.collection('notifications').doc(id).set(data);
  await seed('nA', { orgId: A, title: 'For org A', message: 'a', target: 'all', timestamp: new Date() });
  await seed('nB', { orgId: B, title: 'For org B SECRET', message: 'b', target: 'all', timestamp: new Date(), clearedBy: [] });
  await seed('nU', { title: 'Untagged SECRET', message: 'u', target: 'all', timestamp: new Date() });
  server = http.createServer(serverModule.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(home, { recursive: true, force: true });
});

describe('/api/notifications tenant scoping', () => {
  it('returns only the caller\'s organization, never another organization or untagged documents', async () => {
    const res = await call('GET', '/api/notifications', as(A));
    assert.equal(res.status, 200);
    const text = JSON.stringify(await res.json());
    assert.ok(text.includes('For org A'));
    assert.ok(!text.includes('SECRET'), 'another organization\'s or an untagged notification leaked');
  });

  it('organization B gets only its own, even right after A (no shared cache file)', async () => {
    const text = JSON.stringify(await (await call('GET', '/api/notifications', as(B))).json());
    assert.ok(text.includes('For org B SECRET'));
    assert.ok(!text.includes('For org A'));
    assert.ok(!text.includes('Untagged SECRET'));
  });

  it('a token with no organization is refused', async () => {
    const noOrg = { Authorization: `Bearer ${jwt.sign({ id: 'x', role: 'Super Admin' }, process.env.JWT_SECRET)}` };
    assert.equal((await call('GET', '/api/notifications', noOrg)).status, 403);
  });

  it('cannot mark read or clear another organization\'s notification by id', async () => {
    assert.equal((await call('POST', '/api/notifications/read/nB', as(A))).status, 404);
    assert.equal((await call('POST', '/api/notifications/clear/nB', as(A), { uid: 'victim' })).status, 404);
    assert.deepEqual((await db.collection('notifications').doc('nB').get()).data().clearedBy, []);
    assert.equal((await call('POST', '/api/notifications/read/nA', as(A))).status, 200);
  });

  it('a notification sent through the API belongs to the caller\'s organization, whatever the body says', async () => {
    const res = await call('POST', '/api/notifications/send', as(A), { id: 'sent1', title: 'Hello', message: 'm', target: 'all', orgId: B });
    assert.equal(res.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await db.collection('notifications').doc('sent1').get()).data().orgId, A);
  });
});
