/**
 * ES modules and fetch() send an Origin header even for same-origin requests. When
 * ALLOWED_ORIGINS did not list the host the app was actually served from, the CORS check
 * refused the app's OWN module scripts with 403 "Not allowed by CORS": the login page still
 * returned 200 with all its markup, but every script was blocked and no one could sign in.
 * curl and health checks looked perfect throughout, because curl sends no Origin.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'https://app.example.com'; // deliberately NOT the serving host
const { app } = await import('../server.js');

let server, host;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  host = `127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const get = (path, headers = {}) => fetch(`http://${host}${path}`, { headers });

describe('CORS must never reject the app’s own origin', () => {
  it('serves a module script when Origin is the host itself', async () => {
    const res = await get('/firebase-web-config.js', { Origin: `http://${host}` });
    assert.equal(res.status, 200, 'the app rejected its own script - the login page would lose all JS');
  });

  it('serves it with no Origin header too (curl-style)', async () => {
    assert.equal((await get('/firebase-web-config.js')).status, 200);
  });

  it('allows an API call from its own origin', async () => {
    const res = await get('/api/public-config', { Origin: `http://${host}` });
    assert.equal(res.status, 200);
  });

  it('matches the host case-insensitively', async () => {
    const res = await get('/api/public-config', { Origin: `http://${host.toUpperCase()}` });
    assert.equal(res.status, 200);
  });

  it('still rejects a genuinely foreign origin', async () => {
    const res = await get('/api/public-config', { Origin: 'https://evil.example.com' });
    assert.equal(res.status, 403, 'a cross-site origin must still be refused');
  });

  it('still honours an explicitly allowed origin', async () => {
    const res = await get('/api/public-config', { Origin: 'https://app.example.com' });
    assert.equal(res.status, 200);
  });

  it('is not fooled by an origin that merely contains the host', async () => {
    const res = await get('/api/public-config', { Origin: `https://${host}.evil.example.com` });
    assert.equal(res.status, 403);
  });
});
