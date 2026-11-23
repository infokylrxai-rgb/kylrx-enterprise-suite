/**
 * A host can drop a secret into the project root at deploy time: Render's Secret Files are
 * placed there as well as under /etc/secrets. The static denylists are written against what
 * the repository contains, so they cannot know such a file exists - and a service account
 * added as serviceAccount.json was served publicly, handing out a Firebase admin private key.
 *
 * These tests put real credential-shaped files in the static root and require a 404.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
const root = fileURLToPath(new URL('..', import.meta.url));
const { app } = await import('../server.js');

let server, base;
const created = [];

/** Writes a file into the static root, remembering it for cleanup. Never overwrites. */
function plant(name, body) {
  const full = path.join(root, name);
  if (fs.existsSync(full)) return null; // never touch a real file
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  created.push(full);
  return full;
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  for (const f of created) { try { fs.unlinkSync(f); } catch (_) {} }
  if (server) server.close();
});

const FAKE_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account', project_id: 'test-project',
  private_key_id: 'deadbeef', private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
  client_email: 'fake@test-project.iam.gserviceaccount.com'
});

describe('static root never serves credential files', () => {
  for (const name of [
    'serviceAccount.json',          // exactly what Render's Secret Files produced
    'service-account.json',
    'service_account.json',
    'kylrxai-firebase-adminsdk-fbsvc-1c1dd80b91.json',
    'credentials.json',
    'secrets.json'
  ]) {
    it(`404s /${name}`, async () => {
      if (!plant(name, FAKE_SERVICE_ACCOUNT)) return; // a real file of that name exists; skip
      const res = await fetch(`${base}/${name}`);
      assert.equal(res.status, 404, `${name} was served - a secret would leak`);
      assert.ok(!(await res.text()).includes('PRIVATE KEY'), `${name} leaked key material`);
    });
  }

  for (const name of ['tls.key', 'server.pem', 'cert.crt', 'store.p12']) {
    it(`404s /${name}`, async () => {
      if (!plant(name, 'FAKE KEY MATERIAL')) return;
      assert.equal((await fetch(`${base}/${name}`)).status, 404);
    });
  }

  it('404s a credential file in a subdirectory too', async () => {
    if (!plant('reports/serviceAccount.json', FAKE_SERVICE_ACCOUNT)) return;
    assert.equal((await fetch(`${base}/reports/serviceAccount.json`)).status, 404);
  });

  it('still serves the ordinary static files the app needs', async () => {
    for (const p of ['/index.html', '/firebase-web-config.js']) {
      assert.equal((await fetch(`${base}${p}`)).status, 200, `${p} should still be served`);
    }
  });
});
