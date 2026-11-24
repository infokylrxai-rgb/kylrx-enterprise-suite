/**
 * provision-superadmin.js shipped a literal fallback password, so every super-admin created
 * without --password shared one credential readable by anyone with repository access - on an
 * account holding 'all', manage_payroll, approve_batches and view_unmasked_pii over real
 * salary and bank data. The repository's scripts/ directory was also briefly served publicly
 * by a static mirror, putting that literal on the open internet.
 *
 * This guards the whole repository, not just that one file. It scans what git actually
 * TRACKS: a local, git-ignored override holding real values is the intended way to work and
 * must not fail the suite - the question is only what would be committed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const tracked = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.cjs'], { cwd: root, encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean);

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Fixtures that deliberately contain credential-SHAPED text so the guards can be tested.
// They are recognised by their placeholder body, not by filename, so a real key pasted into
// one of these files would still be caught.
const isObviousFixture = (text, match) =>
  /FAKE|EXAMPLE|PLACEHOLDER|CHANGE_ME|DUMMY|TEST_ONLY/i.test(match) ||
  /FAKE|PLACEHOLDER/.test(text.slice(Math.max(0, text.indexOf(match) - 80), text.indexOf(match) + 200));

describe('no credential literals are committed', () => {
  it('scans a meaningful number of tracked files', () => {
    assert.ok(tracked.length > 50, `only scanned ${tracked.length} tracked files`);
  });

  it('the old super-admin default password is gone', () => {
    const hits = tracked.filter(f => read(f).includes('Kylrx#SuperAdmin' + '2026!Secured'));
    assert.deepEqual(hits, [], 'the committed super-admin password is back');
  });

  it('provision-superadmin has no literal password fallback', () => {
    const src = read('scripts/provision-superadmin.js');
    assert.match(src, /SUPERADMIN_PASSWORD \|\| GENERATED_PASSWORD/, 'the fallback must be generated');
    assert.match(src, /crypto\.randomInt/, 'generation must use a CSPRNG');
  });

  it('no Cashfree secret, private key or Google API key is committed', () => {
    const patterns = [
      [/cfsk_[a-z]{2}_(test|prod)_[0-9a-f]{16,}/g, 'a Cashfree secret key'],
      [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,40}[A-Za-z0-9+/]{60,}/g, 'a private key'],
      [/AIza[0-9A-Za-z_-]{35}/g, 'a Google API key']
    ];
    const found = [];
    for (const f of tracked) {
      const src = read(f);
      for (const [re, what] of patterns) {
        for (const m of src.match(re) || []) {
          if (!isObviousFixture(src, m)) found.push(`${f}: ${what}`);
        }
      }
    }
    assert.deepEqual(found, [], 'credential material is committed');
  });

  it('the git-ignored local Firebase override is still not tracked', () => {
    assert.ok(!tracked.includes('firebase-web-config.local.js'),
      'the local override carries real values and must never be committed');
  });
});
