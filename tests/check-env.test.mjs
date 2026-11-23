/**
 * scripts/check-env.js: lists missing required variables per mode, by NAME only, and exits 1.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const script = fileURLToPath(new URL('../scripts/check-env.js', import.meta.url));
const { checkEnv, assertEnv } = require(script);

const long = (tag) => `${tag}-${'x'.repeat(40)}`;
const production = {
  NODE_ENV: 'production', JWT_SECRET: long('jwt'), REFRESH_SECRET: long('refresh'),
  FIREBASE_PROJECT_ID: 'acme-hr', FIREBASE_STORAGE_BUCKET: 'acme-hr.firebasestorage.app', FIREBASE_SERVICE_ACCOUNT_PATH: 'key.json',
  KYLRX_EXPORT_SIGNING_KEY: long('export'), CASHFREE_CLIENT_ID: 'cf_id', CASHFREE_CLIENT_SECRET: 'cf_secret',
  APP_URL: 'https://hr.acme.example'
};

describe('check:env', () => {
  it('development needs only the JWT secrets', () => {
    assert.deepEqual(checkEnv('development', {}).missing, ['JWT_SECRET', 'REFRESH_SECRET']);
    assert.deepEqual(checkEnv('development', { JWT_SECRET: 'a', REFRESH_SECRET: 'b' }).missing, []);
  });

  it('production lists every missing variable, and either service-account variable is enough', () => {
    assert.deepEqual(checkEnv('production', production), { missing: [], recommended: ['ALLOWED_ORIGINS', 'EMAIL_FROM or SMTP_USER', 'SMTP_PASS or RESEND_API_KEY'], problems: [] });
    const { missing } = checkEnv('production', { ...production, FIREBASE_SERVICE_ACCOUNT_PATH: '', CASHFREE_CLIENT_SECRET: '', APP_URL: undefined });
    assert.deepEqual(missing, ['FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH', 'CASHFREE_CLIENT_SECRET', 'APP_URL']);
  });

  it('placeholders from .env.example count as missing', () => {
    assert.deepEqual(checkEnv('production', { ...production, FIREBASE_PROJECT_ID: 'CHANGE_ME' }).missing, ['FIREBASE_PROJECT_ID']);
  });

  it('flags weak or reused secrets and dev identity in production', () => {
    const { problems } = checkEnv('production', { ...production, JWT_SECRET: 'short', REFRESH_SECRET: 'short', ALLOW_DEV_IDENTITY: 'true' });
    assert.ok(problems.includes('JWT_SECRET is shorter than 32 characters'));
    assert.ok(problems.some(p => p.startsWith('ALLOW_DEV_IDENTITY')));
    assert.ok(checkEnv('production', { ...production, REFRESH_SECRET: production.JWT_SECRET }).problems.includes('JWT_SECRET and REFRESH_SECRET must differ'));
  });

  it('assertEnv throws with names, never values', () => {
    assert.doesNotThrow(() => assertEnv('production', production));
    const secret = long('TOP-SECRET-VALUE');
    try {
      assertEnv('production', { ...production, JWT_SECRET: secret, KYLRX_EXPORT_SIGNING_KEY: '' });
      assert.fail('should throw');
    } catch (err) {
      assert.match(err.message, /missing: KYLRX_EXPORT_SIGNING_KEY/);
      assert.ok(!err.message.includes(secret));
    }
  });

  it('the command exits 1 on missing variables and prints no values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-env-')); // no .env here
    const secret = long('TOP-SECRET-VALUE');
    const run = spawnSync(process.execPath, [script, '--mode=production'], {
      cwd: dir, encoding: 'utf8',
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', JWT_SECRET: secret, REFRESH_SECRET: long('r') }
    });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /MISSING\s+FIREBASE_PROJECT_ID/);
    assert.ok(!run.stdout.includes(secret) && !run.stderr.includes(secret), 'a value was printed');
  });
});
