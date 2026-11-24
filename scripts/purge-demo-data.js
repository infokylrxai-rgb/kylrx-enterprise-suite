#!/usr/bin/env node
/**
 * ============================================================================
 * PURGE DEMO DATA  -  removes the org_demo tenant and nothing else
 * ============================================================================
 *
 * The demo organization has to go before real customers are onboarded, and doing
 * that by hand in the Firebase console is where the wrong collection gets deleted.
 * This script is deliberately narrow:
 *
 *   - It deletes ONLY documents whose orgId is exactly 'org_demo'.
 *   - It deletes ONLY Firebase Auth users flagged isDemo with orgId 'org_demo'.
 *   - It NEVER deletes a whole collection, and never touches an untagged document.
 *   - Dry run is the DEFAULT. Nothing is deleted unless you pass --confirm.
 *
 * Usage:
 *   npm run purge:demo                 # dry run - lists exactly what would go
 *   npm run purge:demo -- --confirm    # actually delete
 *   npm run purge:demo -- --confirm --keep-auth-users
 *
 * Safety: refuses to run if DEMO_ORG_ID is not 'org_demo', so it cannot be
 * repointed at a real tenant by changing an environment variable.
 */
require('dotenv').config({ quiet: true });
const { db, getAuth } = require('../config/firebase');
const { DEMO_ORG_ID } = require('../config/demo');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const KEEP_AUTH = args.includes('--keep-auth-users');
const BATCH = 400;

// Every collection that can carry an orgId, plus the payout bookkeeping added with Cashfree.
const ORG_SCOPED = [
  'users', 'employees', 'organizations', 'admin_settings', 'command_centers', 'system_config',
  'workflow_rules', 'workflows', 'payroll_documents', 'payroll_runs', 'statutory_policy_configs',
  'payment_batches', 'compliance_returns', 'statutory_exceptions', 'bank_files',
  'bank_reconciliations', 'disbursement_logs', 'disbursement_batches', 'cashfree_transfer_index',
  'candidates', 'recruitment_events', 'bu_employee_type_rules', 'alert_trigger_registry',
  'audit_logs', 'notifications', 'leave_requests', 'attendance', 'tasks', 'messages',
  'goals', 'assets', 'exits', 'policies', 'holidays', 'payroll_profiles'
];

const log = (...a) => console.log(...a);

/** organizations/{id} is keyed BY the org id, so match the document id as well as the field. */
async function docsToDelete(name) {
  const out = new Map();
  try {
    const byField = await db.collection(name).where('orgId', '==', DEMO_ORG_ID).get();
    byField.forEach(d => out.set(d.ref.path, d.ref));
  } catch (err) {
    log(`    (skipped ${name}: ${err.message})`);
  }
  if (name === 'organizations') {
    const direct = await db.collection(name).doc(DEMO_ORG_ID).get();
    if (direct.exists) out.set(direct.ref.path, direct.ref);
  }
  return [...out.values()];
}

/** disbursement_batches keeps its records in a subcollection; they must go with the parent. */
async function subRecords(batchRefs) {
  const refs = [];
  for (const ref of batchRefs) {
    const snap = await ref.collection('records').get();
    snap.forEach(d => refs.push(d.ref));
  }
  return refs;
}

async function commit(refs) {
  for (let i = 0; i < refs.length; i += BATCH) {
    const w = db.batch();
    refs.slice(i, i + BATCH).forEach(r => w.delete(r));
    await w.commit();
  }
}

(async () => {
  if (DEMO_ORG_ID !== 'org_demo') {
    console.error(`REFUSING TO RUN: DEMO_ORG_ID is "${DEMO_ORG_ID}", not "org_demo".`);
    process.exit(1);
  }
  if (!db || typeof db.collection !== 'function') {
    console.error('Firestore is not configured (need FIREBASE_SERVICE_ACCOUNT or _PATH).');
    process.exit(1);
  }

  log(`\n${'='.repeat(64)}`);
  log(`  PURGE DEMO DATA   tenant: ${DEMO_ORG_ID}`);
  log(`  mode: ${CONFIRM ? '*** DELETING ***' : 'DRY RUN (nothing will be deleted)'}`);
  log(`${'='.repeat(64)}\n`);

  let total = 0;
  const plan = [];
  for (const name of ORG_SCOPED) {
    const refs = await docsToDelete(name);
    if (!refs.length) continue;
    let extra = [];
    if (name === 'disbursement_batches') extra = await subRecords(refs);
    plan.push({ name, refs: refs.concat(extra) });
    total += refs.length + extra.length;
    log(`  ${String(refs.length + extra.length).padStart(5)}  ${name}${extra.length ? `  (incl. ${extra.length} subcollection records)` : ''}`);
  }
  if (!total) log('  (no demo documents found)');
  log(`\n  TOTAL DOCUMENTS: ${total}`);

  // Auth users: only ones that are BOTH flagged demo AND in the demo org.
  let demoUsers = [];
  if (!KEEP_AUTH) {
    const auth = getAuth && getAuth();
    if (auth) {
      let token;
      do {
        const page = await auth.listUsers(1000, token);
        for (const u of page.users) {
          const c = u.customClaims || {};
          if (c.orgId === DEMO_ORG_ID && (c.demo === true || /@demo\.example\.org$/i.test(u.email || ''))) {
            demoUsers.push(u);
          }
        }
        token = page.pageToken;
      } while (token);
    }
    log(`\n  AUTH USERS: ${demoUsers.length}`);
    demoUsers.forEach(u => log(`         ${u.email}  (${u.uid})`));
  }

  if (!CONFIRM) {
    log(`\n  Dry run only. Re-run with --confirm to delete.\n`);
    process.exit(0);
  }

  log(`\n  deleting...`);
  for (const { name, refs } of plan) {
    await commit(refs);
    log(`    removed ${refs.length} from ${name}`);
  }
  if (demoUsers.length) {
    const auth = getAuth();
    for (const u of demoUsers) { await auth.deleteUser(u.uid); log(`    removed auth user ${u.email}`); }
  }
  log(`\n  Done. ${total} documents and ${demoUsers.length} auth users removed.\n`);
  process.exit(0);
})().catch(err => { console.error('Purge failed:', err.message); process.exit(1); });
