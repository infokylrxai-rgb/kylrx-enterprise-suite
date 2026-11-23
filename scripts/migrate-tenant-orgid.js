/**
 * One-time migration: multi-tenant orgId tagging.
 *
 * 1. Tags every document in every top-level collection that has no `orgId` with ONE organization
 *    (the one you pass). It does not work out whose a document is: only use it when everything
 *    untagged really belongs to that one organization.
 * 2. Gives every Firebase Auth user an `orgId` custom claim (from their users/{uid} profile,
 *    else the organization you pass), keeping any existing claims.
 * 3. Syncs users/{uid}.role with a `role` custom claim where they disagree.
 *
 * It is a DRY RUN unless you pass --write; nothing else changes that. There is no default organization.
 *
 *   node scripts/migrate-tenant-orgid.js --org-id org_acme              # preview (dry run)
 *   node scripts/migrate-tenant-orgid.js --org-id org_acme --write      # write
 *   ... --yes-really   needed when the project does not look like a test / emulator project
 *
 * A project "looks like production" unless the Firestore emulator is in use (FIRESTORE_EMULATOR_HOST)
 * or its id starts with "demo-" or ends with -dev, -test, -staging or -stg. In that case the script
 * refuses to run at all, even as a dry run, until --yes-really is given.
 *
 * Safe and idempotent: documents and users that already have an orgId are untouched.
 * After --write: set TENANT_READ_SCOPING=on in .env, set TENANT_READ_SCOPING = true in
 * firebase-config.js, and deploy firestore.rules + firestore.indexes.json.
 */
const BATCH_LIMIT = 400;

/** { orgId, write, yesReally } from argv, or throws a message that says what to do */
function parseArgs(argv) {
    const options = { orgId: null, write: false, yesReally: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--write') options.write = true;
        else if (arg === '--dry-run') options.write = false;
        else if (arg === '--yes-really') options.yesReally = true;
        else if (arg === '--org-id') options.orgId = argv[++i];
        else if (arg.startsWith('--org-id=')) options.orgId = arg.slice('--org-id='.length);
        else if (arg === '--apply') throw new Error('--apply was renamed: use --write (the default is a dry run).');
        else if (arg.startsWith('--org=')) throw new Error('--org was renamed: use --org-id <id>.');
        else throw new Error(`Unknown option: ${arg}`);
    }
    if (!options.orgId || options.orgId.startsWith('--')) throw new Error('--org-id <id> is required (there is no default organization).');
    if (!/^org_[a-z0-9_]+$/.test(options.orgId)) throw new Error(`--org-id "${options.orgId}" must look like org_acme (lower case letters, digits and underscores).`);
    return options;
}

/** True unless the target is clearly an emulator or a test project */
function looksLikeProduction(env, projectId) {
    if (env.FIRESTORE_EMULATOR_HOST) return false;
    if (!projectId) return true;
    return !/^demo-|-(dev|test|staging|stg)$/.test(projectId);
}

async function tagCollections({ db, GLOBAL_COLLECTIONS, orgId, write, log }) {
    const rows = [];
    for (const col of await db.listCollections()) {
        if (GLOBAL_COLLECTIONS.has(col.id) || col.id.startsWith('_')) continue;
        const snap = await col.get();
        const untagged = snap.docs.filter(d => !d.get('orgId'));
        rows.push({ collection: col.id, total: snap.size, untagged: untagged.length });
        if (!untagged.length || !write) continue;
        for (let i = 0; i < untagged.length; i += BATCH_LIMIT) {
            const batch = db.batch();
            untagged.slice(i, i + BATCH_LIMIT).forEach(d => batch.update(d.ref, { orgId }));
            await batch.commit();
        }
    }
    log('\nDocuments without an orgId, per collection:');
    log(`  ${'collection'.padEnd(34)}${'untagged'.padStart(9)}${'of total'.padStart(10)}`);
    rows.forEach(r => log(`  ${r.collection.padEnd(34)}${String(r.untagged).padStart(9)}${String(r.total).padStart(10)}`));
    return rows;
}

async function syncAuthUsers({ db, admin, orgId, write, log }) {
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
                const target = profileOrg || orgId;
                log(`  claim  ${String(user.email).padEnd(36)} orgId -> ${target}`);
                claimsSet++;
                if (write) await admin.auth().setCustomUserClaims(user.uid, { ...claims, orgId: target });
            }

            if (profile.exists && claims.role && profile.get('role') !== claims.role) {
                log(`  role   ${String(user.email).padEnd(36)} users doc ${profile.get('role')} -> ${claims.role}`);
                rolesSynced++;
                if (write) await profileRef.update({ role: claims.role });
            }
        }
        pageToken = page.pageToken;
    } while (pageToken);
    return { claimsSet, rolesSynced };
}

/** Runs the migration against the given db/admin. Returns the numbers; writes only when options.write */
async function runMigration({ db, admin, GLOBAL_COLLECTIONS, options, log = console.log }) {
    const { orgId, write } = options;
    log(`${write ? 'WRITING' : 'DRY RUN (nothing is written; pass --write to apply)'}: organization ${orgId}`);
    const rows = await tagCollections({ db, GLOBAL_COLLECTIONS, orgId, write, log });
    log('\nAuth users:');
    const { claimsSet, rolesSynced } = await syncAuthUsers({ db, admin, orgId, write, log });
    const documents = rows.reduce((sum, r) => sum + r.untagged, 0);
    log(`\n${write ? 'Updated' : 'Would update'}: ${documents} documents in ${rows.filter(r => r.untagged).length} collections, ${claimsSet} user claims, ${rolesSynced} profile roles.`);
    if (!write) log('Re-run with --write to apply these changes.');
    return { documents, claimsSet, rolesSynced, rows };
}

module.exports = { parseArgs, looksLikeProduction, runMigration };

if (require.main === module) {
    (async () => {
        let options;
        try {
            options = parseArgs(process.argv.slice(2));
        } catch (err) {
            console.error(err.message);
            process.exit(2);
        }
        require('dotenv').config();
        const { admin, db, firebaseProjectInfo } = require('../config/firebase');
        const { GLOBAL_COLLECTIONS } = require('../config/tenant');
        if (!admin.apps.length) {
            console.error('Firebase Admin SDK is not configured (FIREBASE_PROJECT_ID and a service account are required).');
            process.exit(1);
        }
        const projectId = firebaseProjectInfo().projectId;
        if (looksLikeProduction(process.env, projectId) && !options.yesReally) {
            console.error(`Refusing to run: project "${projectId}" does not look like a test project or emulator.`);
            console.error('Use the emulator or a demo-/-test project, or pass --yes-really if you are sure.');
            process.exit(3);
        }
        console.log(`Project: ${projectId}`);
        await runMigration({ db, admin, GLOBAL_COLLECTIONS, options });
        process.exit(0);
    })().catch(err => {
        console.error('Migration failed:', err.message);
        process.exit(1);
    });
}
