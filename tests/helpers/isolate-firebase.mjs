// Import this FIRST in a test that boots the app. ES imports run in order, so these assignments
// happen before any later import can load config/firebase.js, and dotenv never overrides a
// variable that is already set (even to an empty string). Result: the in-memory store, never a
// real Firebase project.
process.env.FIREBASE_SERVICE_ACCOUNT = '';
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
