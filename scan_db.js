const { db } = require('./config/firebase');

async function scanFirebase() {
    console.log("--- 🔍 FIREBASE DATA REPORT ---");
    const collections = ['employees', 'attendance', 'users', 'activities', 'system_intelligence', 'employee_eods', 'intelligence_insights', 'ai_chat_logs'];
    
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

scanFirebase();

