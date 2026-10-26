/**
 * /api/messages (controllers/messageController.js): the caller's organization only, sent as the
 * caller, and "clear" hides a chat for the caller instead of deleting it for everyone.
 */
import './helpers/isolate-firebase.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);
const A = 'org_msg_a';
const B = 'org_msg_b';
const CHAT = ['emp_x', 'hr_support'].sort().join('_'); // the same chat id can exist in two organizations
let server;
let baseUrl;
let db;

const as = (orgId, role = 'Super Admin', id = `admin_of_${orgId}`) => ({ Authorization: `Bearer ${jwt.sign({ id, role, ...(orgId ? { orgId } : {}) }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const call = (method, p, headers, body) => fetch(`${baseUrl}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  const { default: serverModule } = await import('../server.js');
  assert.equal(require('firebase-admin').apps.length, 0, 'a real Firebase app is initialised');
  await serverModule.dynamicRoutesLoaded;
  ({ db } = require('../config/firebase'));
  const seed = (id, data) => db.collection('messages').doc(id).set(data);
  await seed('mA', { orgId: A, chatId: CHAT, senderId: 'emp_x', receiverId: 'hr_support', text: 'hello from A', timestamp: '2026-10-26T10:00:00Z' });
  await seed('mB', { orgId: B, chatId: CHAT, senderId: 'emp_x', receiverId: 'hr_support', text: 'SECRET from B', timestamp: '2026-10-26T10:01:00Z' });
  await seed('mU', { chatId: CHAT, senderId: 'emp_x', receiverId: 'hr_support', text: 'SECRET untagged', timestamp: '2026-10-26T10:02:00Z' });
  await seed('mMarry', { orgId: B, chatId: 'EMP_1789230184645_hr_support', senderId: 'EMP_1789230184645', receiverId: 'hr_support', senderName: 'Marry', text: 'SECRET Marry', timestamp: '2026-10-26T10:03:00Z' });
  server = http.createServer(serverModule.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('/api/messages tenant scoping', () => {
  it('a thread returns only the caller\'s organization, even for a chat id another organization also uses', async () => {
    const text = JSON.stringify(await (await call('GET', `/api/messages/thread/${CHAT}`, as(A))).json());
    assert.ok(text.includes('hello from A'));
    assert.ok(!text.includes('SECRET'), 'another organization\'s or an untagged message leaked');
  });

  it('the old "Marry" special case no longer returns someone else\'s messages', async () => {
    const text = JSON.stringify(await (await call('GET', '/api/messages/thread/hr_support_ADMIN,marry_hr_support', as(A))).json());
    assert.ok(!text.includes('SECRET Marry'));
  });

  it('a token with no organization is refused', async () => {
    assert.equal((await call('GET', `/api/messages/thread/${CHAT}`, as(null))).status, 403);
  });

  it('messages are stamped with the caller\'s organization and sent as the caller', async () => {
    const res = await call('POST', '/api/messages/send', as(A, 'Employee', 'emp_y'), { recipientId: 'emp_x', text: 'hi', senderId: 'emp_y' });
    assert.equal(res.status, 201);
    const sent = (await res.json()).data;
    assert.equal(sent.orgId, A);
    assert.equal(sent.senderId, 'emp_y');
    assert.equal((await call('POST', '/api/messages/send', as(A, 'Employee', 'emp_y'), { recipientId: 'emp_x', text: 'x', senderId: 'emp_x' })).status, 403);
    assert.equal((await call('POST', '/api/messages/send', as(A, 'Employee', 'emp_y'), { recipientId: 'emp_x', text: 'x', senderId: 'hr_support' })).status, 403);
    assert.equal((await call('POST', '/api/messages/send', as(A, 'HRMS', 'hr_1'), { recipientId: 'emp_x', text: 'x', senderId: 'hr_support' })).status, 201);
  });

  it('clearing hides the chat for the caller in their organization only, and deletes nothing', async () => {
    const res = await call('POST', `/api/messages/clear/${CHAT}`, as(A));
    assert.equal(res.status, 200);
    const a = (await db.collection('messages').doc('mA').get()).data();
    const b = (await db.collection('messages').doc('mB').get()).data();
    const u = (await db.collection('messages').doc('mU').get()).data();
    assert.ok(a, 'org A message still exists');
    assert.deepEqual(a.clearedBy, [`admin_of_${A}`]);
    assert.ok(b && !b.clearedBy, 'org B message untouched');
    assert.ok(u && !u.clearedBy, 'untagged message untouched');
  });
});
