/**
 * A customer's administrator was greeted as "Welcome back, Nandan" - a developer's name
 * hardcoded into the product. It alternated with their real name because the resolver
 * renamed anyone whose role contained ADMIN and then persisted that to localStorage, so
 * whichever value was written last is what they saw.
 *
 * The same name was also being stamped onto records as createdBy, assignedBy and
 * uploadedBy, which is worse than a wrong label: it made the audit trail untrue.
 *
 * This fails the build if a personal name reappears in code a customer can reach.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Developer and sample names that must not appear in anything a customer loads.
const BANNED = ['nandan', 'jame'];

// Developer utilities that are never served to a browser, and the test tree itself.
const EXEMPT = new Set([
  'send_live_test.js', 'sync_firebase_backend.js', 'test_email_nandan.js',
  'compare_hrms_sidebars.js'
]);
const EXEMPT_DIRS = new Set(['node_modules', 'tests', 'scripts', '.git', 'netlify_site', 'functions']);

function collect(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXEMPT_DIRS.has(entry.name)) collect(full, acc);
    } else if (/\.(js|html|mjs)$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name) && !EXEMPT.has(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('no hardcoded personal names reach a customer', () => {
  const files = collect(ROOT);

  it('scans a meaningful number of files', () => {
    assert.ok(files.length > 80, `only ${files.length} files scanned - the walk is probably wrong`);
  });

  it('no developer name appears in anything a customer loads', () => {
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      // A name inside a placeholder-filter list is the fix, not the bug: those lists
      // exist so such a name is never displayed.
      const scannable = text.replace(/(PLACEHOLDER_NAMES|PLACEHOLDERS)\s*=\s*\[[^\]]*\]/g, '');
      for (const name of BANNED) {
        const re = new RegExp(name, 'gi');
        const hits = (scannable.match(re) || []).length;
        if (hits) offenders.push(`${path.relative(ROOT, file)}: "${name}" x${hits}`);
      }
    }
    assert.deepEqual(offenders, [],
      'a personal name is hardcoded where a customer can see it:\n  ' + offenders.join('\n  '));
  });

  /** The specific shape of the original bug: a name invented for a whole role. */
  it('no name is assigned on the basis of a role', () => {
    const text = fs.readFileSync(path.join(ROOT, 'admin-app.js'), 'utf8');
    assert.ok(!/includes\('ADMIN'\)[\s\S]{0,120}resolvedName\s*=\s*'[A-Z]/.test(text),
      'a role test must not decide a display name');
  });

  it('a name is never persisted unless it is a real one', () => {
    const text = fs.readFileSync(path.join(ROOT, 'admin-app.js'), 'utf8');
    const idx = text.indexOf("localStorage.setItem('userName'");
    assert.ok(idx > -1, 'expected the cache write to still exist');
    const guarded = text.slice(Math.max(0, idx - 260), idx);
    assert.match(guarded, /if \(resolvedName\)/,
      'caching an empty or invented name is how the wrong one became sticky');
  });
});
