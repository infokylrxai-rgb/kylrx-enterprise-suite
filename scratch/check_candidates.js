const { db } = require('../config/firebase');

async function checkCandidates() {
    try {
        const snap = await db.collection('candidates').get();
        console.log(`📂 Collection: candidates (${snap.size} documents)`);
        snap.forEach(doc => {
            console.log(`   - [${doc.id}]:`, doc.data());
        });
    } catch (e) {
        console.error("Error reading candidates collection:", e);
    }
    process.exit(0);
}

checkCandidates();
