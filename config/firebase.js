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

let db;
let messaging;

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "planning-with-ai-c026b.firebasestorage.app"
  });
  console.log("Firebase Admin SDK initialized successfully!");
  db = admin.firestore();
  messaging = admin.messaging();
} else {
  console.error("Firebase Admin SDK failed to initialize: No credentials found.");
  // Provide mock db interface to prevent crashes in other server modules
  db = {
    collection: function() {
      return {
        doc: () => ({
          get: async () => ({ exists: () => false, data: () => null }),
          set: async () => {},
          update: async () => {},
          delete: async () => {}
        }),
        get: async () => ({ empty: true, docs: [] }),
        add: async () => ({ id: "mock-id" }),
        where: function() { return this; },
        orderBy: function() { return this; },
        limit: function() { return this; }
      };
    }
  };
  messaging = {
    send: async () => {}
  };
}

module.exports = { admin, db, messaging };

