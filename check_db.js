const { db } = require('./config/firebase');

async function check() {
    console.log("=== Fetching users from Firestore ===");
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(doc => {
        console.log(`User ID: ${doc.id} =>`, doc.data());
    });

    console.log("\n=== Fetching notifications from Firestore ===");
    const notifSnap = await db.collection('notifications').get();
    console.log(`Total notifications found: ${notifSnap.size}`);
    notifSnap.forEach(doc => {
        console.log(`Notification ID: ${doc.id} =>`, doc.data());
    });
}

check().catch(console.error);
