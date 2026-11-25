/**
 * Auth rate limits (routes/auth.js):
 *   signup / register-organization: 10 per IP per 15 min (shared by the two routes)
 *   login: only failed attempts count; 50 per IP and 10 per account (email, case-insensitive)
 * Each group of requests uses its own client IP (X-Forwarded-For, the app trusts one proxy hop).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

// Isolated: no real Firebase credentials
process.env.FIREBASE_SERVICE_ACCOUNT = '';
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';

const require = createRequire(import.meta.url);

// These exercise the registration endpoints themselves, so they opt in to the feature that is
// now off by default in production (config/signup.js: KYLRX_ALLOW_PUBLIC_SIGNUP).
process.env.KYLRX_ALLOW_PUBLIC_SIGNUP = 'true';
let server;
let baseUrl;

before(async () => {
  const { default: serverModule } = await import('../server.js');
  const admin = require('firebase-admin');
  assert.equal(admin.apps.length, 0, 'a real Firebase app is initialised');
  await serverModule.dynamicRoutesLoaded;
  server = http.createServer(serverModule.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

const post = (path, ip, body) => fetch(`${baseUrl}/api/auth${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
  body: JSON.stringify(body)
});
const login = (ip, email, password = 'wrong-password') => post('/login', ip, { email, password });
// A reserved name answers 409 immediately, without touching Firebase
const register = (ip) => post('/register-organization', ip, {
  fullName: 'Test Person', email: 'person@example.com', password: 'long-enough-password', organization: { displayName: 'Kylrx AI' }
});

describe('login rate limits', () => {
  it('blocks the 11th failed attempt for one account, case-insensitively, but not other accounts', async () => {
    const ip = '10.2.0.1';
    for (let i = 0; i < 10; i++) {
      const res = await login(ip, i % 2 ? 'Victim@Example.com' : 'victim@example.com');
      assert.equal(res.status, 401, `attempt ${i + 1}`);
    }
    const blocked = await login(ip, 'VICTIM@EXAMPLE.COM');
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error, /this account/);
    assert.equal((await login(ip, 'someone-else@example.com')).status, 401);
  });

  it('allows 50 failed attempts per IP across accounts, blocks the 51st, and successful logins use no budget', async () => {
    const ip = '10.2.0.2';
    const { db } = require('../config/firebase');
    const bcrypt = require('bcrypt');
    const password = 'right-password-1';
    const hash = await bcrypt.hash(password, 4);
    for (let i = 0; i < 12; i++) {
      await db.collection('users').doc(`rl_user_${i}`).set({ email: `rl${i}@example.com`, password: hash, role: 'employee' });
      const ok = await login(ip, `rl${i}@example.com`, password);
      assert.equal(ok.status, 200, `successful login ${i + 1}`);
    }
    // 12 successes + 50 failures would exceed 50 if successes counted
    for (let i = 0; i < 50; i++) {
      assert.equal((await login(ip, `nobody${i}@example.com`)).status, 401, `failure ${i + 1}`);
    }
    const blocked = await login(ip, 'nobody-final@example.com');
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error, /this network/);
    assert.equal((await login('10.2.0.9', 'nobody-final@example.com')).status, 401);
  });

  it('a login block does not affect registration from the same IP', async () => {
    assert.equal((await register('10.2.0.2')).status, 409);
  });
});

describe('signup / register-organization limit', () => {
  it('allows 10 per IP per window and blocks the 11th, and login failures do not count against it', async () => {
    const ip = '10.2.0.3';
    for (let i = 0; i < 5; i++) await login(ip, `x${i}@example.com`);
    for (let i = 0; i < 10; i++) assert.equal((await register(ip)).status, 409, `attempt ${i + 1}`);
    assert.equal((await register(ip)).status, 429);
  });
});
