import { auth, db, doc, getDoc, collection, query, where, getDocs, setDoc, serverTimestamp } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, signInAnonymously, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

function getRedirectUrl(userData, role) {
    if (!role) {
        throw new Error("Access denied: Account has no assigned role. Please contact HR.");
    }
    if (userData.status === 'inactive') {
        throw new Error("Your account is currently inactive. Please contact support.");
    }
    if (role === 'super_admin' || role === 'admin' || role === 'super admin') {
        return 'admin-dashboard.html';
    } else if (role === 'hr_admin' || role === 'hrms') {
        return 'hrms-dashboard.html';
    } else if (role === 'manager') {
        return 'manager-dashboard.html';
    } else if (role === 'employee') {
        return 'employee-dashboard.html';
    } else {
        throw new Error("Invalid role assigned. Please contact your administrator.");
    }
}


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
const credentialsBtn = document.getElementById('credentialsBtn');

// ===== Password Show/Hide Toggle =====
document.querySelectorAll('.eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        const icon = btn.querySelector('.lucide');
        
        if (input && icon) {
            if (input.type === 'password') {
                input.type = 'text';
                icon.setAttribute('data-lucide', 'eye-off');
            } else {
                input.type = 'password';
                icon.setAttribute('data-lucide', 'eye');
            }
            if (window.lucide) lucide.createIcons();
        }
    });
});

if (credentialsBtn) {
    credentialsBtn.addEventListener('click', () => {
        showAlert('Credentials Login', 'WebAuthn / Passkey authentication initiated...', 'key', 'info');
    });
}

// ═══════════ FORGOT PASSWORD MODAL ═══════════════════════════════════════════
(function setupForgotPassword() {
    const link    = document.getElementById('forgotPasswordLink');
    const overlay = document.getElementById('forgotPwdOverlay');
    const input   = document.getElementById('forgotEmailInput');
    const status  = document.getElementById('forgotPwdStatus');
    const submitBtn = document.getElementById('forgotSubmitBtn');
    const cancelBtn = document.getElementById('forgotCancelBtn');

    if (!link || !overlay) return;

    const open = () => {
        // Pre-fill email from the login form if already typed
        const existingEmail = document.getElementById('email')?.value?.trim();
        if (existingEmail && input) input.value = existingEmail;
        status.style.display = 'none';
        submitBtn.innerHTML = '<i data-lucide="send" style="width:16px;height:16px;"></i> Send Reset Link';
        submitBtn.disabled = false;
        overlay.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
        setTimeout(() => input?.focus(), 100);
    };

    const close = () => { overlay.style.display = 'none'; };

    link.addEventListener('click', (e) => { e.preventDefault(); open(); });
    cancelBtn?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    submitBtn?.addEventListener('click', async () => {
        const email = input?.value?.trim();
        if (!email) {
            status.textContent = '⚠️ Please enter your email address.';
            status.style.cssText = 'display:block; padding:10px 14px; border-radius:10px; font-size:0.82rem; font-weight:600; margin-bottom:1rem; background:#fef3c7; color:#92400e;';
            input?.focus();
            return;
        }

        submitBtn.innerHTML = '⏳ Sending...';
        submitBtn.disabled = true;

        try {
            await sendPasswordResetEmail(auth, email, {
                url: window.location.origin + '/login.html',
                handleCodeInApp: false
            });
            status.textContent = '✅ Reset link sent! Check your inbox (and spam folder). The link expires in 1 hour.';
            status.style.cssText = 'display:block; padding:12px 16px; border-radius:10px; font-size:0.82rem; font-weight:600; margin-bottom:1rem; background:#dcfce7; color:#166534; border:1px solid #bbf7d0;';
            submitBtn.innerHTML = '✓ Email Sent';
            setTimeout(close, 4000);
        } catch (err) {
            console.warn('Password reset error:', err.code);
            let msg = '❌ Failed to send reset email. Please try again.';
            if (err.code === 'auth/user-not-found')    msg = '❌ No account found with this email. Please check and try again.';
            if (err.code === 'auth/invalid-email')     msg = '❌ Invalid email format. Please enter a valid email address.';
            if (err.code === 'auth/too-many-requests') msg = '⚠️ Too many requests. Please wait a few minutes and try again.';
            status.textContent = msg;
            status.style.cssText = 'display:block; padding:10px 14px; border-radius:10px; font-size:0.82rem; font-weight:600; margin-bottom:1rem; background:#fee2e2; color:#991b1b; border:1px solid #fecaca;';
            submitBtn.innerHTML = '<i data-lucide="send" style="width:16px;height:16px;"></i> Try Again';
            submitBtn.disabled = false;
            if (window.lucide) lucide.createIcons();
        }
    });

    // Allow Enter key to submit
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitBtn?.click(); } });
})();
// ═════════════════════════════════════════════════════════════════════════════

// Pre-fill credentials if redirecting from signup page
try {
    const signupEmail = sessionStorage.getItem('signup_email');
    const signupPassword = sessionStorage.getItem('signup_password');
    if (signupEmail && emailInput) {
        emailInput.value = signupEmail;
        sessionStorage.removeItem('signup_email');
    }
    if (signupPassword && passwordInput) {
        passwordInput.value = signupPassword;
        sessionStorage.removeItem('signup_password');
    }
} catch (e) {
    console.warn('Session storage pre-fill failed:', e);
}

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  
  const btnText = loginBtn.querySelector('span');
  const originalText = btnText.textContent;
  btnText.textContent = 'Authenticating...';
  loginBtn.disabled = true;
  errorMessage.style.display = 'none';

  try {
    let userData = null;
    let finalUid = null;
    let token = null;

    // Strategy 1: Firebase Authentication
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      finalUid = userCredential.user.uid;
      token = userCredential.user.accessToken;
      
      const userDoc = await getDoc(doc(db, "users", finalUid));
      if (userDoc.exists()) {
        userData = userDoc.data();
        userData.uid = finalUid;
      }
    } catch (authErr) {
      // Normal fallback for users provisioned with temp passwords in database
      if (authErr.code !== 'auth/invalid-credential' && authErr.code !== 'auth/user-not-found' && authErr.code !== 'auth/wrong-password') {
        console.warn("Firebase Auth status:", authErr.code || authErr.message);
      }
    }

    // Strategy 2: Direct Firestore query by email (handles temporary passwords & custom credentials)
    if (!userData) {
      try {
        const cleanEmail = email.toLowerCase().trim();
        const q = query(collection(db, 'users'), where('email', 'in', [cleanEmail, email]));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          for (const d of querySnap.docs) {
            const u = d.data();
            const storedPw = u.password || u.tempPassword || u.temporary_password || u.temp_password;
            if (storedPw && (storedPw === password || storedPw.trim() === password.trim())) {
              userData = u;
              finalUid = d.id;
              break;
            }
          }
        }
      } catch (dbErr) {
        console.warn("Firestore credentials query:", dbErr.message);
      }
    }

    if (!userData) {
      throw new Error('Invalid email or password. Please verify your credentials.');
    }

    const role = (userData.role || 'employee').toLowerCase();
    const dept = (userData.departmentId || userData.department || userData.departmentName || 'General').toLowerCase();

    console.log('✅ Login successful for:', email, 'Role:', role);

    localStorage.setItem('hr_logged_in', 'true');
    localStorage.setItem('hr_user_id', finalUid);
    if (token) localStorage.setItem('hr_access_token', token);
    localStorage.setItem('userName', userData.name || email);
    localStorage.setItem('userRole', role);
    localStorage.setItem('userDept', dept);
    localStorage.setItem('employee_uid', finalUid);

    const redirectUrl = getRedirectUrl(userData, role);
    if (btnText) btnText.textContent = 'Redirecting to your workspace...';
    window.location.href = redirectUrl;

  } catch (error) {
    if (error.message.includes('Access Denied')) {
        showAlert('Access Restricted', error.message, 'shield-alert');
    } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        showError('Invalid login credentials. Please try again.');
        if (credentialsBtn) {
            credentialsBtn.disabled = false;
            credentialsBtn.title = "Use Credentials (Passkey/WebAuthn)";
        }
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
    
    if (window.lucide) { lucide.createIcons(); }
    document.getElementById('customOverlay').style.display = 'flex';
}

const googleLoginBtn = document.getElementById('googleLoginBtn');
if (googleLoginBtn) {
    window.showFallbackPrompt = () => {
        return new Promise((resolve) => {
            const overlay = document.getElementById('fallbackModalOverlay');
            const input = document.getElementById('fallbackEmailInput');
            const confirmBtn = document.getElementById('fallbackConfirmBtn');
            const cancelBtn = document.getElementById('fallbackCancelBtn');

            overlay.style.display = 'flex';
            input.focus();
            input.select();
            if (window.lucide) window.lucide.createIcons();

            const cleanUp = () => {
                overlay.style.display = 'none';
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
                input.onkeydown = null;
            };

            confirmBtn.onclick = () => {
                const val = input.value.trim();
                cleanUp();
                resolve(val);
            };

            cancelBtn.onclick = () => {
                cleanUp();
                resolve(null);
            };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmBtn.click();
                } else if (e.key === 'Escape') {
                    cancelBtn.click();
                }
            };
        });
    };

    googleLoginBtn.addEventListener('click', async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        
        // Show loading state (optional, just visually indicating click)
        const originalHtml = googleLoginBtn.innerHTML;
        googleLoginBtn.innerHTML = `<span>Connecting to Google...</span>`;
        googleLoginBtn.disabled = true;
        
        try {
            const result = await signInWithPopup(auth, provider);
            const userAuth = result.user;
            const email = userAuth.email;
            
            let userData = null;
            
            // Try fetching from Firestore first
            try {
                const userDoc = await getDoc(doc(db, "users", userAuth.uid));
                if (userDoc.exists()) userData = userDoc.data();
            } catch (err) {
                console.warn('Direct getDoc failed, attempting query:', err);
            }
            
            if (!userData) {
                try {
                    const q = query(collection(db, 'users'), where('email', '==', email.toLowerCase()));
                    const querySnap = await getDocs(q);
                    if (!querySnap.empty) {
                        userData = querySnap.docs[0].data();
                        userData.uid = querySnap.docs[0].id;
                    }
                } catch (err) {
                    console.warn('Firestore query failed:', err);
                }
            }
            
            if (!userData) {
                throw new Error('Google account not linked. Please sign up or contact Admin.');
            }
            
            const role = (userData.role || '').toLowerCase();
            const dept = (userData.departmentId || userData.department || 'General').toLowerCase();

            console.log('✅ Google login successful for:', email);

            localStorage.setItem('hr_logged_in', 'true');
            localStorage.setItem('hr_user_id', userData.uid || 'unknown');
            localStorage.setItem('hr_access_token', userAuth.accessToken || 'demo-static-token');
            localStorage.setItem('userName', userData.name || email);
            localStorage.setItem('userRole', role);
            localStorage.setItem('userDept', dept);
            localStorage.setItem('employee_uid', userData.uid || 'unknown');

            const redirectUrl = getRedirectUrl(userData, role);
            if (googleLoginBtn) googleLoginBtn.querySelector('span').textContent = 'Redirecting to your workspace...';
            window.location.href = redirectUrl;
            
        } catch (error) {
            console.error('Google sign-in error:', error);
            
            if (error.code === 'auth/operation-not-allowed') {
                showAlert('Configuration Error', 'Google Sign-In is not enabled. Please enable the Google provider in your Firebase Authentication Console.', 'info');
            } else if (error.message.includes('Access Denied')) {
                showAlert('Access Restricted', error.message, 'shield-alert');
            } else if (error.code === 'auth/popup-closed-by-user') {
                showError('Sign-in popup closed.');
            } else {
                showError(error.message || 'Google sign-in failed.');
            }
        } finally {
            googleLoginBtn.innerHTML = originalHtml;
            googleLoginBtn.disabled = false;
        }
    });
}
