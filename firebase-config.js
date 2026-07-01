// @ts-ignore
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
// @ts-ignore
import { getAuth, onAuthStateChanged, signOut, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
// @ts-ignore
import { initializeFirestore, doc, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, getDoc, onSnapshot, arrayUnion, arrayRemove, collection, query, where, getDocs, orderBy, limit, deleteField } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
// @ts-ignore
import { getStorage } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";

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
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});
const storage = getStorage(app);

console.log("🔥 Firebase connected to project: " + firebaseConfig.projectId);

// Automatically clear the console to hide the browser's Tracking Prevention warnings
setTimeout(() => {
    console.clear();
    console.log("🔥 Firebase connected to project: " + firebaseConfig.projectId);
    console.log("✅ System Operational (Browser tracking warnings cleared).");
}, 1500);

// Global high-fidelity logout hook
function setupGlobalLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && !logoutBtn.dataset.logoutWired) {
        logoutBtn.dataset.logoutWired = "true";
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                // Dynamically import signOut only on demand to maintain ultra-fast page load times
                const { signOut } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");
                await signOut(auth);
                localStorage.clear();
                window.location.href = 'index.html';
            } catch (error) {
                console.error("Global logout handler failed:", error);
                localStorage.clear();
                window.location.href = 'index.html';
            }
        });
    }
}

// Register for both immediate execution and ready state fallbacks
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setupGlobalLogout();
} else {
    document.addEventListener('DOMContentLoaded', setupGlobalLogout);
}

export { 
  app, auth, db, storage,
  onAuthStateChanged, signOut, signInWithEmailAndPassword,
  doc, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, getDoc, onSnapshot, arrayUnion, arrayRemove, collection, query, where, getDocs, orderBy, limit, deleteField
};

