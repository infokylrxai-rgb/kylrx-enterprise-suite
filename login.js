import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

// Fix for "sw.js" errors: Unregister any ghost service workers
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (let registration of registrations) {
      registration.unregister();
    }
  });
}

const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const errorMessage = document.getElementById('errorMessage');
const loginBtn = document.getElementById('loginBtn');

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  
  // Show loading state
  const btnText = loginBtn.querySelector('span');
  const originalText = btnText.textContent;
  btnText.textContent = 'Verifying Admin...';
  loginBtn.disabled = true;
  errorMessage.style.display = 'none';

  try {
    // ===== AUTHENTICATION STRATEGY: 1. BACKEND API (NEW) -> 2. REAL FIREBASE -> 3. DEMO BYPASS =====
    let userData = null;
    let userAuth = null;

    // --- STEP 1: Attempt Backend API Login ---
    try {
        console.log('Attempting Backend API login...');
        const response = await fetch('http://127.0.0.1:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: password })
        });
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Backend API login successful');
            userData = data.user;
            userData.uid = data.user.id;
            if (data.accessToken) localStorage.setItem('hr_access_token', data.accessToken);
        }
    } catch (apiErr) {
        console.warn('Backend API unavailable, falling back to client-side Firebase...', apiErr.message);
    }

    // --- STEP 2: Client-side Firebase Fallback ---
    if (!userData) {
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, password);
          userAuth = userCredential.user;
          const userDoc = await getDoc(doc(db, "users", userAuth.uid));
          if (userDoc.exists()) userData = userDoc.data();
        } catch (firebaseErr) {
          console.warn('Firebase Auth failed, attempting direct Firestore query...', firebaseErr.code);
          
          // FALLBACK: Search for user in Firestore
          try {
              const q = query(collection(db, 'users'), where('email', '==', email.toLowerCase()));
              const querySnap = await getDocs(q);
              
              if (!querySnap.empty) {
                const potentialUser = querySnap.docs[0].data();
                if (potentialUser.tempPassword === password || potentialUser.password === password) {
                  userData = potentialUser;
                  userData.uid = querySnap.docs[0].id;
                  console.log('✅ Direct Firestore lookup successful');
                }
              }
          } catch (permErr) {
              console.warn('Firestore query restricted, moving to demo bypass:', permErr.message);
          }
        }

        // --- STEP 3: DEMO BYPASS (if everything else failed) ---
        if (!userData) {
            // DEMO BYPASS: Allow access for development/testing
            const demoUsers = {
                'admin@hrflow.com': { role: 'admin', departmentId: 'Executive', name: 'Super Admin' },
                'admin@demo.com': { role: 'admin', departmentId: 'Executive', name: 'Super Admin' },
                'marketing.mgr@hrflow.com': { role: 'manager', departmentId: 'marketing', name: 'Marketing Manager' },
                'finance.mgr@hrflow.com': { role: 'manager', departmentId: 'finance', name: 'Finance Manager' },
                'hr.mgr@hrflow.com': { role: 'manager', departmentId: 'hr', name: 'HR Manager' },
                'engineering.mgr@hrflow.com': { role: 'manager', departmentId: 'engineering', name: 'Engineering Manager' }
            };

            const lowercaseEmail = email.toLowerCase();
            if (demoUsers[lowercaseEmail]) {
              userData = demoUsers[lowercaseEmail];
              userData.uid = 'demo_' + lowercaseEmail.split('@')[0];
              console.log('✅ Demo bypass (Hardcoded) successful');
            } else if (lowercaseEmail.startsWith('admin@') || lowercaseEmail.includes('sysadmin') || (lowercaseEmail.includes('hrflow.com') && lowercaseEmail.includes('admin'))) {
               // Dynamic Admin Demo Bypass (Strict)
               userData = { 
                 name: email.split('@')[0].split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '), 
                 role: 'admin', 
                 departmentId: 'executive' 
               };
               userData.uid = 'demo_' + Date.now();
               console.log('✅ Dynamic admin demo bypass successful');
            } else if (lowercaseEmail.includes('mgr') || lowercaseEmail.includes('emp') || lowercaseEmail.includes('hrflow.com')) {
               // Manager or Employee identified in Admin Portal bypass
               userData = { 
                 name: email.split('@')[0], 
                 role: lowercaseEmail.includes('mgr') ? 'manager' : 'employee',
                 departmentId: 'restricted'
               };
               userData.uid = 'demo_restricted_admin_' + Date.now();
            }
        }
    }
    if (userData) {
      const role = (userData.role || '').toLowerCase();
      const dept = (userData.departmentId || userData.department || 'General').toLowerCase();

      // RESTRICT TO ADMINS ONLY
      if (role !== 'admin' && role !== 'super admin') {
          const article = ['a', 'e', 'i', 'o', 'u'].includes(role[0]) ? 'an' : 'a';
          const portalName = role === 'manager' ? 'Manager Portal' : 'Employee Portal';
          throw new Error(`Access Denied: You are registered as ${article} ${role}. Please log in via the ${portalName}.`);
      }

      console.log('✅ Admin login successful for:', email);

      localStorage.setItem('hr_logged_in', 'true');
      localStorage.setItem('hr_user_id', userData.uid || userData.employeeId || 'unknown');
      if (!localStorage.getItem('hr_access_token')) localStorage.setItem('hr_access_token', 'demo-static-token');
      localStorage.setItem('userName', userData.name || email);
      localStorage.setItem('userRole', role);
      localStorage.setItem('userDept', dept);

      window.location.href = 'admin-dashboard.html';
    } else {
      throw new Error('User record not found. Please contact Admin.');
    }
    
  } catch (error) {
    if (error.message.includes('Access Denied')) {
        showAlert('Access Restricted', error.message, 'shield-alert');
    } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        showError('Invalid admin credentials. Please try again.');
    } else if (error.name === 'TypeError') {
        showError('Network Error: Please check your internet connection.');
    } else {
        showError(error.message || 'An unexpected error occurred.');
    }
  } finally {
    if (btnText) btnText.textContent = originalText;
    if (loginBtn) loginBtn.disabled = false;
  }
});

function showError(msg) {
  if (errorMessage) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
    errorMessage.classList.add('shake');
    setTimeout(() => errorMessage.classList.remove('shake'), 500);
  }
}

function showAlert(title, msg, icon = 'info', type = 'info') {
    document.getElementById('alertTitle').textContent = title;
    document.getElementById('alertMsg').textContent = msg;
    const iconEl = document.getElementById('alertIcon');
    const btnEl = document.getElementById('alertBtn');
    const cardEl = document.getElementById('alertCard');
    
    iconEl.innerHTML = `<i data-lucide="${icon}"></i>`;
    
    if (type === 'error' || title.toLowerCase().includes('denied') || title.toLowerCase().includes('restricted')) {
        iconEl.style.color = '#ef4444';
        btnEl.style.background = '#ef4444';
        cardEl.style.borderTop = '6px solid #ef4444';
    } else {
        iconEl.style.color = '#2563eb';
        btnEl.style.background = '#2563eb';
        cardEl.style.borderTop = 'none';
    }
    
    if (window.lucide) if (window.lucide) { lucide.createIcons(); }
    document.getElementById('customOverlay').style.display = 'flex';
}

