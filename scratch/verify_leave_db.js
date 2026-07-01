const { db } = require('../config/firebase');

async function scanLeaveCollections() {
    console.log("--- 🔍 SCANNING LEAVE SYSTEM FIREBASE DATA ---");
    const collections = ['leave_types', 'dept_week_offs', 'holidays', 'leave_policies', 'command_centers'];
    
    for (const collName of collections) {
        try {
            const snapshot = await db.collection(collName).get();
            console.log(`\n📂 Collection: ${collName} (${snapshot.size} documents)`);
            snapshot.forEach(doc => {
                const data = doc.data();
                console.log(`   - [${doc.id}]: ${JSON.stringify(data)}`);
            });
        } catch (e) {
            console.log(`\n❌ Could not read ${collName}: ${e.message}`);
        }
    }
    console.log("\n--- REPORT COMPLETE ---");
    process.exit(0);
}

scanLeaveCollections();
