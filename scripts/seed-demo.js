/**
 * Creates (or refreshes) the DEMO organization and its four demo users, for 1-click demo login
 * (KYLRX_DEMO_MODE, see README). Run: npm run seed:demo
 *
 * - Organization org_demo only; it never touches another organization.
 * - Each demo user gets a RANDOM password generated now and printed once below; nothing stores it.
 *   Demo login does not need it (the server signs the demo user in with a custom token).
 * - Safe to run again: existing demo users are kept and their password is replaced.
 */
require('dotenv').config();
const crypto = require('crypto');
const { admin, db, firebaseProjectInfo } = require('../config/firebase');
const { DEMO_ORG_ID } = require('../config/demo');

const DEMO_USERS = [
    { role: 'admin', claimRole: 'super_admin', name: 'Demo Admin', department: 'Executive' },
    { role: 'hrms', claimRole: 'HRMS', name: 'Demo HR Admin', department: 'People Operations' },
    { role: 'manager', claimRole: 'Manager', name: 'Demo Manager', department: 'Cybersecurity' },
    { role: 'employee', claimRole: 'Employee', name: 'Demo Employee', department: 'Engineering' }
];

async function seedDemo({ auth = admin.auth(), firestore = db, log = console.log } = {}) {
    await firestore.collection('organizations').doc(DEMO_ORG_ID).set({
        orgId: DEMO_ORG_ID, displayName: 'Kylrx Demo', legalName: 'Kylrx Demo', orgConfigured: true, isDemo: true,
        updatedAt: new Date().toISOString()
    }, { merge: true });

    const created = [];
    for (const u of DEMO_USERS) {
        const email = `demo-${u.role}@demo.example.org`;
        const password = crypto.randomBytes(18).toString('base64url');
        let record;
        try {
            record = await auth.getUserByEmail(email);
            await auth.updateUser(record.uid, { password, displayName: u.name });
        } catch (err) {
            if (err.code !== 'auth/user-not-found') throw err;
            record = await auth.createUser({ email, password, displayName: u.name, emailVerified: true });
        }
        const claims = { role: u.claimRole, orgId: DEMO_ORG_ID, demo: true, ...(u.role === 'admin' ? { super_admin: true } : {}) };
        await auth.setCustomUserClaims(record.uid, claims);
        await firestore.collection('users').doc(record.uid).set({
            uid: record.uid, email, name: u.name, role: u.claimRole, orgId: DEMO_ORG_ID, status: 'Active',
            department: u.department, departmentName: u.department, isDemo: true, demoRole: u.role,
            createdAt: new Date().toISOString()
        }, { merge: true });
        created.push({ role: u.role, email, password });
    }
    log(`Demo organization ${DEMO_ORG_ID} is ready (${created.length} users).`);
    return created;
}

module.exports = { seedDemo, DEMO_USERS };

if (require.main === module) {
    if (!admin.apps.length) {
        console.error('Firebase Admin SDK is not configured (FIREBASE_PROJECT_ID and a service account are required).');
        process.exit(1);
    }
    console.log(`Project: ${firebaseProjectInfo().projectId}`);
    seedDemo().then((users) => {
        console.log('\nGenerated passwords (shown ONCE, not stored; demo login does not need them):');
        users.forEach(u => console.log(`  ${u.role.padEnd(9)} ${u.email}  ${u.password}`));
        process.exit(0);
    }).catch((err) => { console.error('Seeding failed:', err.message); process.exit(1); });
}
