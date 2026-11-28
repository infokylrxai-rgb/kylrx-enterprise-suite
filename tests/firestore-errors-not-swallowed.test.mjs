/**
 * firebase-config.js overrides console.error and console.warn to quieten noise from the
 * Firebase SDK. Its quota detector listed '@firebase/firestore: Firestore' - the prefix
 * of EVERY Firestore SDK log line - and 'documents:commit', the URL of every write. So
 * every Firestore error was classed as a quota problem, logged once as a misleading
 * "quota limit reached", and dropped after that.
 *
 * That is why 110 whole-collection reads that the security rules reject went unnoticed:
 * the permission errors they raised never reached the console. Each one renders an empty
 * screen.
 *
 * These tests run the real classifier functions, extracted from the file, against real
 * Firestore message text.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');

function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' not found');
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unterminated ' + name);
}
// eslint-disable-next-line no-new-func
const isQuota = new Function(extract('isQuotaOrBackoffMessage') + '; return isQuotaOrBackoffMessage;')();
// eslint-disable-next-line no-new-func
const isPermission = new Function(extract('isPermissionOrQuotaMessage') + '; return isPermissionOrQuotaMessage;')();

// Real message shapes, as the v12 SDK emits them.
const PERMISSION = '@firebase/firestore: Firestore (12.12.1): Uncaught Error in snapshot listener: FirebaseError: [code=permission-denied]: Missing or insufficient permissions.';
const PERMISSION_OBJ = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
const WRITE_FAILED = '@firebase/firestore: Firestore (12.12.1): Write at documents:commit failed: [code=invalid-argument]';
const QUOTA = '@firebase/firestore: Firestore (12.12.1): [code=resource-exhausted]: Quota exceeded.';

describe('Firestore errors are not mistaken for quota noise', () => {
  it('a permission error is recognised as one', () => {
    assert.equal(isPermission(PERMISSION), true);
    assert.equal(isPermission(PERMISSION_OBJ), true);
  });

  it('a permission error is NOT classed as quota', () => {
    assert.equal(isQuota(PERMISSION), false,
      'the "@firebase/firestore: Firestore" prefix alone must not mark a message as quota');
  });

  it('a failed write is NOT classed as quota', () => {
    assert.equal(isQuota(WRITE_FAILED), false, "'documents:commit' is every write's URL, not a quota signal");
  });

  it('a genuine quota error still is', () => {
    assert.equal(isQuota(QUOTA), true);
    assert.equal(isQuota('RESOURCE_EXHAUSTED'), true);
  });

  it('permission errors are logged as errors, before the quota check', () => {
    const body = src.slice(src.indexOf('console.error = function'), src.indexOf('console.warn = function'));
    const permAt = body.indexOf('isPermissionOrQuotaMessage');
    const quotaAt = body.indexOf('isQuotaOrBackoffMessage');
    assert.ok(permAt > -1 && permAt < quotaAt, 'permission must be checked first, or quota swallows it');
    assert.match(body, /_origConsoleError\.apply\(console, \['\[Firestore\] query rejected/);
  });

  it('they are never downgraded to a warning', () => {
    assert.ok(!src.includes('[Firestore Permission Mode]'), 'the old downgrade-to-warn branch is back');
  });
});
