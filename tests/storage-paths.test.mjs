/**
 * storage-paths.js: every Storage path is orgs/{orgId}/... and no input can escape its folder.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Browser ES module: load the pure helpers without a module loader
const source = fs.readFileSync(fileURLToPath(new URL('../storage-paths.js', import.meta.url)), 'utf8')
  .replace(/^export (?=async function orgStoragePath)/m, '')
  .replace(/^export /gm, '');
const { safeSegment, safeExtension, buildOrgPath } = new Function(`${source}\nreturn { safeSegment, safeExtension, buildOrgPath };`)();

describe('storage paths', () => {
  it('builds orgs/{orgId}/... paths', () => {
    assert.equal(buildOrgPath('org_acme', 'payroll', 'payslips', 'EMP0001', '2026-09.pdf'), 'orgs/org_acme/payroll/payslips/EMP0001/2026-09.pdf');
    assert.equal(buildOrgPath('org_acme', 'recruitment', 'resumes', 'c1.pdf'), 'orgs/org_acme/recruitment/resumes/c1.pdf');
  });

  it('refuses a missing organization', () => {
    for (const org of [null, undefined, '']) assert.throws(() => buildOrgPath(org, 'x'), /No organization/);
  });

  it('keeps every input inside one segment (no traversal, no extra folders)', () => {
    for (const bad of ['../../orgs/org_b/payroll/x.pdf', '..\\..\\x', 'a/b/c.pdf', '/etc/passwd', 'evil\u0000name.pdf']) {
      const seg = safeSegment(bad);
      assert.ok(!seg.includes('/') && !seg.includes('\\'), seg);
      assert.ok(!seg.startsWith('.'), seg);
    }
    const path = buildOrgPath('org_a', 'employees', '../org_b', 'documents', '../../secret.pdf');
    assert.equal(path.split('/').length, 6); // orgs, org_a, employees, <id>, documents, <file>
    assert.ok(path.startsWith('orgs/org_a/employees/'));
    assert.ok(!path.includes('..'));
  });

  it('refuses names with nothing usable left', () => {
    for (const bad of ['', '..', '.', '///', null]) assert.throws(() => safeSegment(bad), /Invalid/);
  });

  it('limits a segment to 120 characters', () => {
    assert.equal(safeSegment('a'.repeat(500)).length, 120);
  });

  it('extensions are short, lower case and safe', () => {
    assert.equal(safeExtension('Resume.PDF'), 'pdf');
    assert.equal(safeExtension('photo.final.JPEG'), 'jpeg');
    assert.equal(safeExtension('noext', 'pdf'), 'pdf');
    assert.equal(safeExtension('x.p/df', 'pdf'), 'pdf');
    assert.equal(safeExtension('x.toolongextension', 'bin'), 'bin');
  });
});
