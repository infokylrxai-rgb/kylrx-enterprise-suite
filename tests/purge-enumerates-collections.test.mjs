/**
 * purge-demo-data.js carried a hand-written list of ~28 collection names. The project has 46, so
 * it reported success while leaving 158 documents behind across activities, pms_reviews,
 * document_audit_logs, otp_verifications and others. A deletion tool that fails silently is the
 * worst kind: you believe the data is gone.
 *
 * Any purge must enumerate the database instead of trusting a list, and must verify afterwards.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => fs.readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const orgPurge = read('../scripts/purge-org-data.js');

describe('the purge discovers collections rather than listing them', () => {
  it('enumerates the database', () => {
    assert.match(orgPurge, /listCollections\(\)/, 'must ask Firestore what exists');
  });

  it('carries no hand-written array of collection names', () => {
    // A literal list of quoted collection names is exactly the bug being prevented.
    const suspicious = /const\s+[A-Z_]*COLLECTIONS?[A-Z_]*\s*=\s*\[/.test(orgPurge);
    assert.ok(!suspicious, 'a hardcoded collection list is back');
  });

  it('matches the organizations doc by id as well as by field', () => {
    assert.match(orgPurge, /col\.id === 'organizations' && doc\.id === ORG_ID/);
  });

  it('verifies afterwards instead of assuming the deletes landed', () => {
    assert.match(orgPurge, /VERIFIED leftovers/);
    assert.match(orgPurge, /leftover === 0 \? 0 : 1/, 'a purge that leaves data must exit non-zero');
  });

  it('is a dry run unless --confirm is passed', () => {
    assert.match(orgPurge, /Dry run only/);
    assert.match(orgPurge, /args\.includes\('--confirm'\)/);
  });

  it('refuses a protected org and a malformed id', () => {
    assert.match(orgPurge, /PROTECTED\.has\(ORG_ID\)/);
    assert.match(orgPurge, /\^org_\[a-z0-9_\]\+\$/i);
  });

  it('deletes Auth users by their claim, not by guessing emails', () => {
    assert.match(orgPurge, /customClaims \|\| \{\}\)\.orgId === ORG_ID/);
  });
});
