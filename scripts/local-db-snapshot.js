/**
 * Copies the live Firestore data into the local test database (Firestore emulator).
 *
 *   node scripts/local-db-snapshot.js export   -> reads live Firestore into .local-firestore/snapshot.json
 *   node scripts/local-db-snapshot.js import   -> writes that snapshot into the running emulator
 *
 * Only reads the live project; never writes to it. scripts/start-local.js runs both steps.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const SNAPSHOT = path.join(__dirname, '..', '.local-firestore', 'snapshot.json');
const mode = process.argv[2];

// Firestore Timestamps survive the JSON round trip
function encode(value) {
    if (value && typeof value.toDate === 'function' && typeof value.seconds === 'number') {
        return { __ts: [value.seconds, value.nanoseconds] };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
    }
    return value;
}

function decode(value, admin) {
    if (Array.isArray(value)) return value.map(v => decode(v, admin));
    if (value && typeof value === 'object') {
        if (Array.isArray(value.__ts)) return new admin.firestore.Timestamp(value.__ts[0], value.__ts[1]);
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v, admin)]));
    }
    return value;
}

async function exportLive() {
    if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('export must read the live project; unset FIRESTORE_EMULATOR_HOST');
    const { db } = require('../config/firebase');
    const docs = [];
    async function walk(collections) {
        for (const col of collections) {
            const snap = await col.get();
            for (const d of snap.docs) {
                docs.push({ path: d.ref.path, data: encode(d.data()) });
                await walk(await d.ref.listCollections());
            }
        }
    }
    await walk(await db.listCollections());
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, JSON.stringify(docs));
    console.log(`[local-db] Copied ${docs.length} documents from live Firestore.`);
}

async function importIntoEmulator() {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('import only runs against the emulator (FIRESTORE_EMULATOR_HOST not set)');
    const { admin, db } = require('../config/firebase');
    const docs = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        docs.slice(i, i + 400).forEach(d => batch.set(db.doc(d.path), decode(d.data, admin)));
        await batch.commit();
    }
    console.log(`[local-db] Loaded ${docs.length} documents into the local test database.`);
}

(mode === 'export' ? exportLive() : mode === 'import' ? importIntoEmulator() : Promise.reject(new Error('usage: export | import')))
    .then(() => process.exit(0))
    .catch(err => { console.error('[local-db]', err.message); process.exit(1); });
