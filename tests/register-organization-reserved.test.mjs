/**
 * registerOrganization must refuse the default/fallback tenant IDs (409) before it creates
 * a Firebase Auth user, so nobody can sign up as the owner of the legacy organization.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

// Isolated: no real Firebase credentials, and a custom dev-default org to cover DEV_DEFAULT_ORG_ID
process.env.FIREBASE_SERVICE_ACCOUNT = '';
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
process.env.DEV_DEFAULT_ORG_ID = 'org_custom_default';

const require = createRequire(import.meta.url);

// These exercise the registration endpoints themselves, so they opt in to the feature that is
// now off by default in production (config/signup.js: KYLRX_ALLOW_PUBLIC_SIGNUP).
process.env.KYLRX_ALLOW_PUBLIC_SIGNUP = 'true';
let server;
let baseUrl;
let createUserCalls;

before(async () => {
  const { default: serverModule } = await import('../server.js');
  const admin = require('firebase-admin');
  assert.equal(admin.apps.length, 0, 'a real Firebase app is initialised');
  await serverModule.dynamicRoutesLoaded;

  // Spy on Auth user creation
  createUserCalls = [];
  const spyAuth = () => ({ createUser: async (u) => { createUserCalls.push(u); return { uid: 'should-not-happen' }; } });
  Object.defineProperty(admin, 'auth', { value: spyAuth, configurable: true, writable: true });
  assert.equal(typeof admin.auth().createUser, 'function', 'could not install the Auth spy');

  server = http.createServer(serverModule.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

const signup = (displayName) => fetch(`${baseUrl}/api/auth/register-organization`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.1.1.1' },
  body: JSON.stringify({ fullName: 'Test Person', email: 'person@example.com', password: 'long-enough-password', organization: { displayName } })
});

describe('POST /api/auth/register-organization reserved organization IDs', () => {
  for (const name of ['Kylrx AI', 'kylrx-ai', 'KYLRX AI', 'Kylrx', 'Kylrx Default', 'Default', 'Custom Default']) {
    it(`"${name}" returns 409 and creates no Auth user`, async () => {
      const res = await signup(name);
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /reserved/i);
      assert.equal(createUserCalls.length, 0);
    });
  }

  it('an ordinary name is not rejected as reserved (it reaches the SDK check)', async () => {
    const res = await signup('Acme Corp');
    assert.notEqual(res.status, 409);
    assert.equal(res.status, 503); // no Admin SDK in this isolated run
    assert.equal(createUserCalls.length, 0);
  });
});
