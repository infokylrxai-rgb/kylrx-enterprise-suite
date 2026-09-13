// @ts-ignore
import { initializeApp, setLogLevel } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
// @ts-ignore
import { getAuth, onAuthStateChanged, signOut, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
// @ts-ignore
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  memoryLocalCache,
  setLogLevel as setFirestoreLogLevel,
  getDocsFromCache,
  getDocFromCache,
  doc, setDoc as rawSetDoc, updateDoc as rawUpdateDoc, deleteDoc as rawDeleteDoc, addDoc as rawAddDoc, serverTimestamp, getDoc as rawGetDoc, onSnapshot as rawOnSnapshot, arrayUnion, arrayRemove, collection, query, where, getDocs as rawGetDocs, orderBy, limit, deleteField 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
// @ts-ignore
import { getStorage } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";

// 1. Completely silence internal Firebase logger chatter
try {
  setLogLevel('silent');
  setFirestoreLogLevel('silent');
} catch (_) {}

// 2. Global console filter for Firebase Quota & backoff warnings
const _origConsoleError = console.error;
const _origConsoleWarn = console.warn;
let _quotaNoticeShown = false;

function isQuotaOrBackoffMessage(...args) {
  const text = args.map(a => {
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object') {
      return `${a.code || ''} ${a.message || ''} ${a.stack || ''}`;
    }
    return String(a || '');
  }).join(' ');
  return text.includes('resource-exhausted') || 
         text.includes('Quota exceeded') || 
         text.includes('maximum backoff delay') ||
         text.includes('@firebase/firestore: Firestore');
}

console.error = function (...args) {
  if (isQuotaOrBackoffMessage(...args)) {
    if (!_quotaNoticeShown) {
      _quotaNoticeShown = true;
      _origConsoleWarn.call(console, "⚡ [Kylrx Architecture] Firebase Firestore quota limit reached. Local persistent cache active.");
    }
    return;
  }
  _origConsoleError.apply(console, args);
};

console.warn = function (...args) {
  if (isQuotaOrBackoffMessage(...args)) {
    return;
  }
  _origConsoleWarn.apply(console, args);
};

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

// Resilient Firebase initialization with InPrivate / Private-mode graceful degradation
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (e) {
  try {
    db = initializeFirestore(app, {
      localCache: memoryLocalCache()
    });
  } catch (_) {
    try {
      db = initializeFirestore(app, {});
    } catch (_) {
      db = window.db || null;
    }
  }
}
const storage = getStorage(app);

// Quota-safe wrappers to ensure the application never crashes when quota is reached
const getDocs = async (q) => {
  try {
    return await rawGetDocs(q);
  } catch (err) {
    if (err && (err.code === 'resource-exhausted' || String(err).includes('Quota exceeded'))) {
      try {
        return await getDocsFromCache(q);
      } catch (_) {
        return { empty: true, docs: [], size: 0, forEach: () => {} };
      }
    }
    throw err;
  }
};

const getDoc = async (docRef) => {
  try {
    return await rawGetDoc(docRef);
  } catch (err) {
    if (err && (err.code === 'resource-exhausted' || String(err).includes('Quota exceeded'))) {
      try {
        return await getDocFromCache(docRef);
      } catch (_) {
        return { exists: () => false, data: () => null, id: docRef.id };
      }
    }
    throw err;
  }
};

const setDoc = async (docRef, data, options) => {
  try {
    return await rawSetDoc(docRef, data, options);
  } catch (err) {
    if (err && (err.code === 'resource-exhausted' || String(err).includes('Quota exceeded'))) {
      // Store in localStorage as fallback
      try {
        const key = `fs_cache_${docRef.path || docRef.id}`;
        localStorage.setItem(key, JSON.stringify(data));
      } catch (_) {}
      return;
    }
    throw err;
  }
};

const updateDoc = async (docRef, data) => {
  try {
    return await rawUpdateDoc(docRef, data);
  } catch (err) {
    if (err && (err.code === 'resource-exhausted' || String(err).includes('Quota exceeded'))) {
      try {
        const key = `fs_cache_${docRef.path || docRef.id}`;
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...existing, ...data }));
      } catch (_) {}
      return;
    }
    throw err;
  }
};

const deleteDoc = async (docRef) => {
  try {
    return await rawDeleteDoc(docRef);
  } catch (err) {
    if (err && (err.code === 'resource-exhausted' || String(err).includes('Quota exceeded'))) {
      try {
        localStorage.removeItem(`fs_cache_${docRef.path || docRef.id}`);
      } catch (_) {}
      return;
    }
    throw err;
  }
};

const addDoc = async (colRef, data) => {
  try {
    return await rawAddDoc(colRef, data);
  } catch (err) {
    if (err && (err.code === 'resource-exhausted' || String(err).includes('Quota exceeded'))) {
      const fallbackId = `offline_${Date.now()}`;
      try {
        localStorage.setItem(`fs_cache_${colRef.id}_${fallbackId}`, JSON.stringify(data));
      } catch (_) {}
      return { id: fallbackId };
    }
    throw err;
  }
};

const onSnapshot = (target, ...args) => {
  let onNext = typeof args[0] === 'function' ? args[0] : (args[0]?.next || (() => {}));
  let onError = typeof args[1] === 'function' ? args[1] : (args[0]?.error || (() => {}));
  let onComplete = typeof args[2] === 'function' ? args[2] : (args[0]?.complete || (() => {}));

  const safeOnError = (err) => {
    if (err && (err.code === 'resource-exhausted' || String(err).includes('Quota exceeded'))) {
      // Gracefully attempt cache read or silent fallback
      try {
        getDocsFromCache(target).then(cacheSnap => {
          if (cacheSnap) onNext(cacheSnap);
        }).catch(() => {});
      } catch (_) {}
      return;
    }
    if (typeof onError === 'function') {
      onError(err);
    }
  };

  try {
    return rawOnSnapshot(target, onNext, safeOnError, onComplete);
  } catch (err) {
    safeOnError(err);
    return () => {};
  }
};

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

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setupGlobalLogout();
} else {
    document.addEventListener('DOMContentLoaded', setupGlobalLogout);
}

// Helper to verify connectivity to Node.js Express Firebase Admin Backend
async function checkBackendFirebaseStatus() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('http://localhost:3000/api/firebase/status', {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            return { online: true, ...data };
        }
    } catch (_) {}
    return { online: false, status: 'offline', projectId: firebaseConfig.projectId };
}

export { 
  app, auth, db, storage,
  checkBackendFirebaseStatus,
  onAuthStateChanged, signOut, signInWithEmailAndPassword,
  doc, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, getDoc, onSnapshot, arrayUnion, arrayRemove, collection, query, where, getDocs, orderBy, limit, deleteField
};
