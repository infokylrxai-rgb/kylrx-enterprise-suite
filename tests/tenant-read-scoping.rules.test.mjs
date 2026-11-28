/**
 * Proves, against the real firestore.rules and the real client SDK, what turning on
 * TENANT_READ_SCOPING changes for a browser.
 *
 * 110 browser reads in 26 files fetch a whole collection with no orgId predicate. The
 * rules require resource.data.orgId == the caller's org, and Firestore refuses a query
 * it cannot prove safe rather than filtering it - so each of those reads failed outright
 * and its screen rendered empty.
 *
 * firebase-config.js already wraps getDocs and onSnapshot with scopeToTenant(), which
 * adds where('orgId', '==', <active org>) to any unscoped tenant read. It was switched
 * off pending a data migration; production has since been checked and every untagged
 * document is already invisible to browsers under the same rules, so enabling it hides
 * nothing that is visible today.
 *
 * For each collection the dashboards read most, this asserts:
 *   1. the unscoped query is REJECTED  - the bug: why those screens were empty;
 *   2. the scoped query SUCCEEDS       - the fix: what the wrapper now sends;
 *   3. it returns ONLY the caller's org - and in doing so leaks nothing.
 *
 * Needs the Firestore emulator:  npm run test:rules-scoping
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection, query, where } from 'firebase/firestore';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let env;

// The collections behind most of the 110 reads, by count.
const COLLECTIONS = ['users', 'command_centers', 'attendance', 'department_teams',
                     'payroll_profiles', 'departments', 'holidays', 'shifts', 'alertEvents'];

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'kylrx-scoping-test',
    firestore: { rules: readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') }
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // A configured organisation for each tenant, as production has.
    await setDoc(doc(db, 'organizations/orgA'), { orgId: 'orgA', name: 'A', orgConfigured: true });
    await setDoc(doc(db, 'organizations/orgB'), { orgId: 'orgB', name: 'B', orgConfigured: true });
    await setDoc(doc(db, 'users/sa_a'), { uid: 'sa_a', orgId: 'orgA', role: 'super_admin' });
    for (const c of COLLECTIONS) {
      if (c === 'users') {
        await setDoc(doc(db, 'users/a_emp'), { orgId: 'orgA', name: 'A employee' });
        await setDoc(doc(db, 'users/b_emp'), { orgId: 'orgB', name: 'B employee' });
        await setDoc(doc(db, 'users/untagged'), { name: 'no org' });
        continue;
      }
      await setDoc(doc(db, c + '/a1'), { orgId: 'orgA', marker: 'A' });
      await setDoc(doc(db, c + '/a2'), { orgId: 'orgA', marker: 'A' });
      await setDoc(doc(db, c + '/b1'), { orgId: 'orgB', marker: 'B' });
      await setDoc(doc(db, c + '/untagged'), { marker: 'none' });     // like the 30 in production
    }
  });
});

after(async () => { if (env) await env.cleanup(); });

const asOrgA = () => env.authenticatedContext('sa_a', { orgId: 'orgA', role: 'super_admin' }).firestore();

describe('unscoped tenant reads are rejected, scoped ones return only the caller\'s org', () => {
  for (const c of COLLECTIONS) {
    describe(c, () => {
      it('an unscoped read is rejected - which is why the screen was empty', async () => {
        await assertFails(getDocs(collection(asOrgA(), c)));
      });

      it('the scoped read the wrapper sends succeeds', async () => {
        await assertSucceeds(getDocs(query(collection(asOrgA(), c), where('orgId', '==', 'orgA'))));
      });

      it('and returns only the caller\'s own documents', async () => {
        const snap = await getDocs(query(collection(asOrgA(), c), where('orgId', '==', 'orgA')));
        assert.ok(snap.size > 0, 'expected orgA\'s own documents');
        snap.forEach(d => assert.equal(d.data().orgId, 'orgA', 'leaked ' + c + '/' + d.id));
      });
    });
  }

  it('asking for another org\'s data by name is still refused', async () => {
    // The wrapper only ever uses the caller's own org, but a hand-written query naming a
    // different org must fail at the rules regardless.
    await assertFails(getDocs(query(collection(asOrgA(), 'attendance'), where('orgId', '==', 'orgB'))));
  });
});
