/**
 * tools/start_5500_server.js: static server + /api reverse proxy.
 * Covers path traversal / secret files, CORS allow-list, and hop-by-hop header stripping.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

process.env.API_PORT = '38911'; // stub backend, never the real one on 3000
const require = createRequire(import.meta.url);
const { requestHandler } = require('../tools/start_5500_server.js');

let front, stub, port, seen;

const get = (path, headers = {}, method = 'GET') => new Promise((resolve) => {
  const r = http.request({ port, host: '127.0.0.1', path, method, headers }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  r.on('error', (e) => resolve({ status: `ERR ${e.code}`, headers: {}, body: '' }));
  r.end();
});

before(async () => {
  stub = http.createServer((req, res) => {
    seen = req.headers;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Keep-Alive': 'timeout=5', 'Proxy-Authenticate': 'x', 'X-Hop': 'secret', Connection: 'close, X-Hop' });
    res.end('{"ok":true}');
  }).listen(38911);
  front = http.createServer(requestHandler);
  await new Promise((r) => front.listen(0, r));
  port = front.address().port;
});
after(() => { front.close(); stub.close(); });

describe('static server', () => {
  it('serves normal files, including via the legacy /kylrx-enterprise-suite-main prefix', async () => {
    assert.equal((await get('/package.json')).status, 200);
    assert.equal((await get('/kylrx-enterprise-suite-main/package.json')).status, 200);
  });
  for (const p of [
    '/..%2f..%2f..%2fWindows/win.ini', '/%2e%2e/%2e%2e/Windows/win.ini', '/..%5c..%5cWindows%5cwin.ini',
    '/../../../Windows/win.ini', '/.env', '/.git/config', '/data/messages_store.json',
    '/node_modules/express/package.json', '/serviceAccountKey.json', '/x-adminsdk-1.json'
  ]) {
    it(`blocks ${p}`, async () => {
      const r = await get(p);
      assert.ok([403, 404].includes(r.status), `status ${r.status}`);
      assert.doesNotMatch(r.body, /\[fonts\]|private_key|JWT_SECRET/i);
    });
  }
  it('answers 400 (no crash) for a NUL byte or bad percent-encoding', async () => {
    assert.equal((await get('/a%00b')).status, 400);
    assert.equal((await get('/%E0%A4%A')).status, 400);
  });
});

describe('CORS', () => {
  it('foreign origin gets no CORS headers, local origin is reflected', async () => {
    assert.equal((await get('/api/health', { Origin: 'http://evil.example' })).headers['access-control-allow-origin'], undefined);
    assert.equal((await get('/api/health', { Origin: 'http://localhost:5502' })).headers['access-control-allow-origin'], 'http://localhost:5502');
    const pre = await get('/x', { Origin: 'http://evil.example' }, 'OPTIONS');
    assert.equal(pre.status, 204);
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
  });
});

describe('/api proxy', () => {
  it('strips hop-by-hop headers both ways but keeps Authorization', async () => {
    const r = await get('/api/health', { Connection: 'close, X-Secret-Hop', 'X-Secret-Hop': '1', TE: 'trailers', Upgrade: 'websocket', 'Proxy-Authorization': 'Basic abc', Authorization: 'Bearer keepme' });
    assert.equal(r.status, 200);
    assert.equal(r.body, '{"ok":true}');
    assert.ok(!seen['x-secret-hop'] && !seen.upgrade && !seen.te && !seen['proxy-authorization']);
    assert.equal(seen.authorization, 'Bearer keepme');
    assert.ok(!r.headers['keep-alive'] && !r.headers['proxy-authenticate'] && !r.headers['x-hop']);
  });
});
