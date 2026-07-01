const { db } = require('../config/firebase');

async function listAllCollections() {
    console.log("Listing all Firestore collections...");
    try {
        const collections = await db.listCollections();
        for (const col of collections) {
            const snap = await col.limit(5).get();
            console.log(`- ${col.id}: ${snap.size} documents (showing up to 5)`);
            snap.forEach(doc => {
                console.log(`  [${doc.id}]:`, doc.data());
            });
        }
    } catch (e) {
        console.error("Error listing collections:", e);
    }
    process.exit(0);
}

listAllCollections();
