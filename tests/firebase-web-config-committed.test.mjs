/**
 * The committed firebase-web-config.js must hold only CHANGE_ME placeholders: real values belong in the
 * git-ignored firebase-web-config.local.js (local development) or are pasted in by the client at handover.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = fs.readFileSync(root + 'firebase-web-config.js', 'utf8');

describe('firebase-web-config.js (committed)', () => {
  it('has only CHANGE_ME values for every setting', () => {
    const block = /const placeholders = \{([\s\S]*?)\};/.exec(source)[1];
    const values = [...block.matchAll(/(\w+):\s*'([^']*)'/g)];
    assert.deepEqual(values.map(v => v[1]), ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']);
    for (const [, key, value] of values) assert.ok(value.includes('CHANGE_ME'), `${key} is not a placeholder`);
  });

  it('contains no Firebase API key or project id anywhere in the file', () => {
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(source));
    assert.ok(!/:web:[0-9a-f]{10,}/.test(source));
  });

  it('the local override is git-ignored and not tracked', () => {
    assert.equal(execFileSync('git', ['check-ignore', 'firebase-web-config.local.js'], { cwd: root, encoding: 'utf8' }).trim(), 'firebase-web-config.local.js');
    assert.equal(execFileSync('git', ['ls-files', 'firebase-web-config.local.js'], { cwd: root, encoding: 'utf8' }).trim(), '');
  });
});
