const { db } = require('./config/firebase');

async function check() {
    console.log("=== Fetching users from Firestore ===");
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(doc => {
        console.log(`User ID: ${doc.id} =>`, doc.data());
    });

    console.log("\n=== Fetching command_centers from Firestore ===");
    const ccSnap = await db.collection('command_centers').get();
    console.log(`Total command centers found: ${ccSnap.size}`);
    ccSnap.forEach(doc => {
        console.log(`Command Center ID: ${doc.id} =>`, doc.data());
    });

    console.log("\n=== Fetching notifications from Firestore ===");
    const notifSnap = await db.collection('notifications').get();
    console.log(`Total notifications found: ${notifSnap.size}`);
    notifSnap.forEach(doc => {
        console.log(`Notification ID: ${doc.id} =>`, doc.data());
    });

    console.log("\n=== Fetching manager_change_requests from Firestore ===");
    const reqSnap = await db.collection('manager_change_requests').get();
    console.log(`Total requests found: ${reqSnap.size}`);
    reqSnap.forEach(doc => {
        console.log(`Request ID: ${doc.id} =>`, doc.data());
    });
}

check().catch(console.error);
