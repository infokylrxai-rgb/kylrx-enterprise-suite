/** NODE_ENV=test must never initialise a real Firebase project, even when .env or the shell holds a service account. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const account = JSON.stringify({ type: 'service_account', project_id: 'acme-hr-prod', private_key: privateKey, client_email: 'x@acme-hr-prod.iam.gserviceaccount.com', client_id: '1' });
const run = (extraEnv) => spawnSync(process.execPath, ['-e', "const c=require('./config/firebase');console.log(JSON.stringify({configured:c.firebaseProjectInfo().configured,apps:require('firebase-admin').apps.length}))"],
  { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, FIREBASE_PROJECT_ID: 'acme-hr-prod', FIREBASE_SERVICE_ACCOUNT: account, ...extraEnv } });

describe('config/firebase.js in test mode', () => {
  it('ignores a service account under NODE_ENV=test', () => {
    const out = run({ NODE_ENV: 'test' });
    assert.deepEqual(JSON.parse(out.stdout.trim().split('\n').pop()), { configured: false, apps: 0 }, out.stderr);
  });
  it('still uses it outside test mode (control)', () => {
    const out = run({ NODE_ENV: 'development' });
    assert.equal(JSON.parse(out.stdout.trim().split('\n').pop()).configured, true, out.stderr);
  });
});
