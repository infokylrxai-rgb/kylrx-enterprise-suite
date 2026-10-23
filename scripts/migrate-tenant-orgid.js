/**
 * One-time Migration: multi-tenant orgId tagging.
 *
 * 1. Tags every document in every top-level collection that has no `orgId` with the
 *    default organization (existing data belongs to Kylrx AI).
 * 2. Gives every Firebase Auth user an `orgId` custom claim (from their users/{uid}
 *    profile, else the default org), keeping any existing claims.
 * 3. Syncs users/{uid}.role with a `role` custom claim where they disagree.
 *
 * Dry run by default (prints what would change). Writes only with --apply.
 * Safe and idempotent: documents/users that already have an orgId are untouched.
 *
 *   node scripts/migrate-tenant-orgid.js                 # preview
 *   node scripts/migrate-tenant-orgid.js --apply         # write
 *   node scripts/migrate-tenant-orgid.js --org=org_x     # different default org
 *
 * After --apply: set TENANT_READ_SCOPING=on in .env, set TENANT_READ_SCOPING = true in
 * firebase-config.js, and deploy firestore.rules + firestore.indexes.json.
 */
require('dotenv').config();
const { admin, db } = require('../config/firebase');
const { GLOBAL_COLLECTIONS } = require('../config/tenant');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DEFAULT_ORG = (args.find(a => a.startsWith('--org=')) || '--org=org_kylrx_ai').split('=')[1];
const BATCH_LIMIT = 400;

async function tagCollections() {
    const collections = await db.listCollections();
    let total = 0;
    for (const col of collections) {
        if (GLOBAL_COLLECTIONS.has(col.id) || col.id.startsWith('_')) continue;
        const snap = await col.get();
        const untagged = snap.docs.filter(d => !d.get('orgId'));
        if (!untagged.length) continue;
        console.log(`  ${col.id.padEnd(32)} ${untagged.length} of ${snap.size} docs -> orgId ${DEFAULT_ORG}`);
        total += untagged.length;
        if (!APPLY) continue;
        for (let i = 0; i < untagged.length; i += BATCH_LIMIT) {
            const batch = db.batch();
            untagged.slice(i, i + BATCH_LIMIT).forEach(d => batch.update(d.ref, { orgId: DEFAULT_ORG }));
            await batch.commit();
        }
    }
    return total;
}

async function syncAuthUsers() {
    let claimsSet = 0;
    let rolesSynced = 0;
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        for (const user of page.users) {
            const claims = user.customClaims || {};
            const profileRef = db.collection('users').doc(user.uid);
            const profile = await profileRef.get();
            const profileOrg = profile.exists ? profile.get('orgId') : null;

            if (!claims.orgId) {
                const orgId = profileOrg || DEFAULT_ORG;
                console.log(`  claim  ${String(user.email).padEnd(36)} orgId -> ${orgId}`);
                claimsSet++;
                if (APPLY) await admin.auth().setCustomUserClaims(user.uid, { ...claims, orgId });
            }

            if (profile.exists && claims.role && profile.get('role') !== claims.role) {
                console.log(`  role   ${String(user.email).padEnd(36)} users doc ${profile.get('role')} -> ${claims.role}`);
                rolesSynced++;
                if (APPLY) await profileRef.update({ role: claims.role });
            }
        }
        pageToken = page.pageToken;
    } while (pageToken);
    return { claimsSet, rolesSynced };
}

(async () => {
    if (!admin.apps.length) {
        console.error('Firebase Admin SDK is not configured (FIREBASE_SERVICE_ACCOUNT_PATH).');
        process.exit(1);
    }
    console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}: default organization ${DEFAULT_ORG}\n`);
    console.log('Documents without orgId:');
    const docs = await tagCollections();
    console.log('\nAuth users:');
    const { claimsSet, rolesSynced } = await syncAuthUsers();
    console.log(`\n${APPLY ? 'Updated' : 'Would update'}: ${docs} documents, ${claimsSet} user claims, ${rolesSynced} profile roles.`);
    if (!APPLY) console.log('Re-run with --apply to write these changes.');
    process.exit(0);
})().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
