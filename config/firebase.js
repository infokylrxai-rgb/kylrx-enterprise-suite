const admin = require("firebase-admin");
require('dotenv').config();

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Load from Environment Variable (Recommended for Render/Railway)
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT env var:", error);
  }
} else {
  // Fallback to local file
  try {
    serviceAccount = require("./serviceAccountKey.json");
  } catch (error) {
    console.warn("Service account file not found, and FIREBASE_SERVICE_ACCOUNT env var is missing.");
  }
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase Admin SDK initialized successfully!");
} else {
  console.error("Firebase Admin SDK failed to initialize: No credentials found.");
}

const db = admin.firestore();
const messaging = admin.messaging();

module.exports = { admin, db, messaging };
