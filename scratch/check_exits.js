const { db } = require('./config/firebase');

async function checkExits() {
    try {
        const snapshot = await db.collection('employee_exits').get();
        console.log(`📂 Collection: employee_exits (${snapshot.size} documents)`);
        snapshot.forEach(doc => {
            console.log(`   - [${doc.id}]: ${JSON.stringify(doc.data())}`);
        });
    } catch (e) {
        console.error("Failed to read employee_exits:", e);
    }
    process.exit(0);
}

checkExits();
