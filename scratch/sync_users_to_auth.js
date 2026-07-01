const { admin, db } = require('../config/firebase');

async function syncUsers() {
    console.log("=== Syncing Firestore Users to Firebase Auth ===");
    try {
        const usersSnap = await db.collection('users').get();
        if (usersSnap.empty) {
            console.log("No users found in Firestore.");
            process.exit(0);
        }

        console.log(`Found ${usersSnap.size} users in Firestore.`);

        for (const docObj of usersSnap.docs) {
            const data = docObj.data();
            const email = data.email;
            const uid = docObj.id; // Use Firestore document ID as Auth UID
            const name = data.name || data.fullName || email.split('@')[0];
            
            if (!email) {
                console.log(`Skipping user doc ${uid} - no email address.`);
                continue;
            }

            // Define a temporary password
            const password = data.tempPassword || data.password || 'TempPass123!';

            console.log(`Processing user: ${name} (${email}), UID: ${uid}`);

            try {
                // Check if user exists in Firebase Auth
                let userRecord;
                try {
                    userRecord = await admin.auth().getUser(uid);
                    console.log(`  ✓ User already exists in Firebase Auth with UID: ${uid}`);
                } catch (authErr) {
                    if (authErr.code === 'auth/user-not-found') {
                        // Attempt to get by email to check if they exist under a different UID
                        try {
                            const userByEmail = await admin.auth().getUserByEmail(email);
                            console.log(`  ⚠️ User exists under different UID (${userByEmail.uid}). Deleting old Auth record to sync.`);
                            await admin.auth().deleteUser(userByEmail.uid);
                        } catch (emailErr) {
                            // User truly doesn't exist
                        }

                        // Create the user with custom UID matching Firestore ID
                        userRecord = await admin.auth().createUser({
                            uid: uid,
                            email: email,
                            password: password,
                            displayName: name
                        });
                        console.log(`  🚀 Created User in Firebase Auth with UID: ${uid}`);
                    } else {
                        throw authErr;
                    }
                }
            } catch (err) {
                console.error(`  ✗ Error processing user ${email}:`, err.message);
            }
        }
        console.log("=== Syncing Complete ===");
        process.exit(0);
    } catch (err) {
        console.error("Sync failed:", err);
        process.exit(1);
    }
}

syncUsers();
