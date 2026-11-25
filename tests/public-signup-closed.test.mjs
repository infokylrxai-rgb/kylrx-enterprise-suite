/**
 * Kylrx is sold to organizations and their access is provisioned, but signup.html and
 * POST /api/auth/register-organization were reachable by anyone on the internet. Beyond strangers
 * creating tenants on infrastructure you pay for, the tenant key is derived from the company name
 * (orgId = 'org_' + slug) and a duplicate is refused with 409 - so whoever registers "Acme" first
 * owns org_acme, and the real Acme is later told their own organization is already registered.
 *
 * Closed by default; KYLRX_ALLOW_PUBLIC_SIGNUP=true reopens it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long!!';
process.env.REFRESH_SECRET = process.env.REFRESH_SECRET || 'another-test-secret-32-characters-long!!';
delete process.env.KYLRX_ALLOW_PUBLIC_SIGNUP;

const require = createRequire(import.meta.url);
const { publicSignupEnabled } = require('../config/signup.js');
const { app } = await import('../server.js');

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const post = (path, body = {}) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

describe('public signup is closed by default', () => {
  it('the flag is off unless explicitly set', () => {
    assert.equal(publicSignupEnabled({}), false);
    assert.equal(publicSignupEnabled({ KYLRX_ALLOW_PUBLIC_SIGNUP: 'false' }), false);
    assert.equal(publicSignupEnabled({ KYLRX_ALLOW_PUBLIC_SIGNUP: 'true' }), true);
  });

  it('register-organization is not reachable', async () => {
    const res = await post('/api/auth/register-organization', {
      fullName: 'Squatter', email: 'squat@example.com', password: 'Str0ng!Passw0rd#2026',
      organization: { displayName: 'Acme' }
    });
    assert.equal(res.status, 404, 'a stranger could still create a tenant');
  });

  it('plain signup is not reachable', async () => {
    const res = await post('/api/auth/signup', {
      name: 'X', email: 'x@example.com', password: 'Str0ng!Passw0rd#2026', department: 'Eng'
    });
    assert.equal(res.status, 404);
  });

  it('the signup page and its script are hidden too', async () => {
    assert.equal((await fetch(base + '/signup.html')).status, 404,
      'a reachable form that cannot submit is worse than no form');
    assert.equal((await fetch(base + '/signup.js')).status, 404);
  });

  it('it answers 404 rather than advertising a closed door', async () => {
    const res = await post('/api/auth/register-organization', {});
    assert.notEqual(res.status, 403, 'do not confirm the route exists');
    assert.notEqual(res.status, 503);
  });
});

describe('the rest of authentication is unaffected', () => {
  it('login is still reachable', async () => {
    const res = await post('/api/auth/login', { email: 'nobody@example.com', password: 'x' });
    assert.notEqual(res.status, 404, 'closing signup must not close login');
  });

  it('the login page is still served', async () => {
    assert.equal((await fetch(base + '/login.html')).status, 200);
  });

  it('public-config is still served', async () => {
    assert.equal((await fetch(base + '/api/public-config')).status, 200);
  });
});
