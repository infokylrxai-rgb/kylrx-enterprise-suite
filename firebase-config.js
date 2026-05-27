import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBQCO1FI1mPsWxsTvInyLlwIQVFGnUBlco",
  authDomain: "kylrxai.firebaseapp.com",
  projectId: "kylrxai",
  storageBucket: "kylrxai.firebasestorage.app",
  messagingSenderId: "483232913511",
  appId: "1:483232913511:web:769faab820b2eead141cc2",
  measurementId: "G-3F6VW2MEJG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
});
const storage = getStorage(app);

console.log("🔥 Firebase connected to project: " + firebaseConfig.projectId);

// Automatically clear the console to hide the browser's Tracking Prevention warnings
setTimeout(() => {
    console.clear();
    console.log("🔥 Firebase connected to project: " + firebaseConfig.projectId);
    console.log("✅ System Operational (Browser tracking warnings cleared).");
}, 1500);

export { app, auth, db, storage };

