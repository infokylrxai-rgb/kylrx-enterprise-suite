/**
 * Guard: the browser must never take the organization from localStorage (or a built-in default
 * organization). The organization comes from the verified token (firebase-config.js getActiveOrgId /
 * tenantReady, or window.getActiveOrgId in classic scripts). firebase-config.js and the login/signup
 * pages may WRITE the 'orgId' cache; nothing may READ it, because it can belong to another session.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'netlify_site', 'tests', 'functions', 'scripts', 'assets', 'vendor']);

// a READ of the cached organization, in any quoting style
const READ = /(?:localStorage|sessionStorage)\s*(?:\.\s*getItem\s*\(\s*['"`](?:orgId|org_id|current_org_id|tenant_id)['"`]\s*\)|\[\s*['"`](?:orgId|org_id|current_org_id|tenant_id)['"`]\s*\]|\.\s*(?:orgId|org_id)\b)/;

function clientFiles(dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) clientFiles(path.join(dir, entry.name), out);
    } else if (/\.(js|mjs|html)$/.test(entry.name) && entry.name !== 'test.mjs') { // test.mjs: a scratch file the server never serves
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

describe('no localStorage organization fallback in browser code', () => {
  it('the detector recognises the patterns it is meant to catch', () => {
    for (const bad of [
      "localStorage.getItem('orgId') || 'org_kylrx'",
      'localStorage.getItem("orgId")',
      'localStorage.getItem(`orgId`)',
      "localStorage['orgId']",
      'localStorage.orgId',
      "sessionStorage.getItem('orgId')",
      "localStorage.getItem('current_org_id')"
    ]) assert.ok(READ.test(bad), bad);
    for (const fine of ["localStorage.setItem('orgId', orgId)", "localStorage.removeItem('orgId')", "window.getActiveOrgId()", "localStorage.getItem('orgConfigured')"]) {
      assert.ok(!READ.test(fine), fine);
    }
  });

  it('no file reads the organization from localStorage / sessionStorage', () => {
    const offenders = [];
    for (const file of clientFiles()) {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (READ.test(line)) offenders.push(`${path.relative(root, file).replace(/\\/g, '/')}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    assert.deepEqual(offenders, [], 'take the organization from getActiveOrgId() (verified token), not localStorage');
  });


  it('no file reads the user id from localStorage (it comes from the verified session, window.__kylrxUid)', () => {
    const READ_UID = /localStorage\s*\.\s*getItem\s*\(\s*['"`](?:employee_uid|hr_user_id|manager_uid)['"`]\s*\)/;
    const offenders = [];
    for (const file of clientFiles()) {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (READ_UID.test(line)) offenders.push(`${path.relative(root, file).split(path.sep).join('/')}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    assert.deepEqual(offenders, [], 'take the uid from window.__kylrxUid / loadIdentity(), not localStorage');
  });
});
