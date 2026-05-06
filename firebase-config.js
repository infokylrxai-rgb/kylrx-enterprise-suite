import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDWD-g9jk7ybEhFx9kgA9ma9H7QJ4Axbl4",
  authDomain: "planning-with-ai-c026b.firebaseapp.com",
  projectId: "planning-with-ai-c026b",
  storageBucket: "planning-with-ai-c026b.firebasestorage.app",
  messagingSenderId: "718706133518",
  appId: "1:718706133518:web:2899152cc9140081054a5f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log("🔥 Firebase connected to project: " + firebaseConfig.projectId);

export { app, auth, db };

