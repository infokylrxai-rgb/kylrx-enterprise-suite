#!/usr/bin/env node
/**
 * ============================================================================
 * PURGE AN ORGANIZATION'S DATA
 * ============================================================================
 *
 * Removes every document belonging to one tenant, plus its Auth users.
 *
 * It ENUMERATES the database rather than working from a list of collection names. The earlier
 * purge-demo-data.js carried a hand-written list of ~28 collections; the project actually has 46,
 * so it reported success while leaving 158 documents behind across activities, pms_reviews,
 * document_audit_logs, otp_verifications and others. A list like that is wrong the moment a
 * feature adds a collection, and it fails silently - which is the worst way for a deletion tool
 * to fail, because you believe the data is gone.
 *
 * Usage:
 *   node scripts/purge-org-data.js --org-id=org_demo              # dry run (the default)
 *   node scripts/purge-org-data.js --org-id=org_demo --confirm
 *   node scripts/purge-org-data.js --org-id=org_x --confirm --keep-auth-users
 *
 * Safety: refuses an empty or obviously wrong --org-id, and refuses any org listed in PROTECTED.
 */
require('dotenv').config({ quiet: true });
const { db, getAuth } = require('../config/firebase');

const args = process.argv.slice(2);
const arg = (name) => { const hit = args.find(a => a.startsWith('--' + name + '=')); return hit ? hit.split('=').slice(1).join('=') : null; };
const ORG_ID = arg('org-id');
const CONFIRM = args.includes('--confirm');
const KEEP_AUTH = args.includes('--keep-auth-users');
const BATCH = 400;

// Orgs this tool will never delete. Add your own tenant here before anyone runs it in anger.
const PROTECTED = new Set(['org_kylrx']);

(async () => {
    if (!ORG_ID || !/^org_[a-z0-9_]+$/i.test(ORG_ID)) {
        console.error('Usage: node scripts/purge-org-data.js --org-id=org_something [--confirm]');
        process.exit(1);
    }
    if (PROTECTED.has(ORG_ID)) {
        console.error(`REFUSING: ${ORG_ID} is protected. Edit PROTECTED in this script if that is truly intended.`);
        process.exit(1);
    }
    if (!db || typeof db.listCollections !== 'function') {
        console.error('Firestore is not configured (need FIREBASE_SERVICE_ACCOUNT or _PATH, and FIREBASE_PROJECT_ID).');
        process.exit(1);
    }

    console.log(`\n${'='.repeat(64)}`);
    console.log(`  PURGE ORGANIZATION   ${ORG_ID}`);
    console.log(`  mode: ${CONFIRM ? '*** DELETING ***' : 'DRY RUN (nothing will be deleted)'}`);
    console.log(`${'='.repeat(64)}\n`);

    const collections = await db.listCollections();
    const refs = [];
    const perCollection = [];

    for (const col of collections) {
        let snap;
        try { snap = await col.get(); } catch (err) { console.log(`  (skipped ${col.id}: ${err.message})`); continue; }
        let n = 0;
        snap.forEach(doc => {
            const data = doc.data() || {};
            // Match the tenant field, and the organizations doc which is keyed BY the org id.
            if (data.orgId === ORG_ID || (col.id === 'organizations' && doc.id === ORG_ID)) {
                refs.push(doc.ref); n++;
            }
        });
        if (n) perCollection.push([col.id, n]);
    }

    perCollection.sort((a, b) => b[1] - a[1]).forEach(([name, n]) => console.log(`  ${String(n).padStart(5)}  ${name}`));
    console.log(`  ${'-'.repeat(5)}`);
    console.log(`  ${String(refs.length).padStart(5)}  TOTAL   (scanned ${collections.length} collections)`);

    let authUsers = [];
    if (!KEEP_AUTH) {
        const auth = getAuth && getAuth();
        if (auth) {
            let token;
            do {
                const page = await auth.listUsers(1000, token);
                for (const u of page.users) if ((u.customClaims || {}).orgId === ORG_ID) authUsers.push(u);
                token = page.pageToken;
            } while (token);
        }
        console.log(`\n  AUTH USERS: ${authUsers.length}`);
        authUsers.forEach(u => console.log(`         ${u.email}  (${u.uid})`));
    }

    if (!CONFIRM) {
        console.log(`\n  Dry run only. Re-run with --confirm to delete.\n`);
        process.exit(0);
    }

    for (let i = 0; i < refs.length; i += BATCH) {
        const writer = db.batch();
        refs.slice(i, i + BATCH).forEach(r => writer.delete(r));
        await writer.commit();
    }
    console.log(`\n  deleted ${refs.length} documents`);

    for (const u of authUsers) { await getAuth().deleteUser(u.uid); console.log(`  deleted auth user ${u.email}`); }

    // Prove it, rather than assuming the deletes landed.
    let leftover = 0;
    for (const col of await db.listCollections()) {
        const snap = await col.get();
        snap.forEach(doc => {
            const data = doc.data() || {};
            if (data.orgId === ORG_ID || (col.id === 'organizations' && doc.id === ORG_ID)) leftover++;
        });
    }
    console.log(`\n  VERIFIED leftovers for ${ORG_ID}: ${leftover}`);
    process.exit(leftover === 0 ? 0 : 1);
})().catch(err => { console.error('Purge failed:', err.message); process.exit(1); });
