import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const signupForm = document.getElementById('signupForm');
const signupBtn = document.getElementById('signupBtn');
const errorMessage = document.getElementById('errorMessage');

// Validation Elements
const emailInput = document.getElementById('email');
const emailFeedback = document.getElementById('emailFeedback');

const passwordInput = document.getElementById('password');
const strengthFill = document.getElementById('strengthFill');
const strengthText = document.getElementById('strengthText');
const chkLength = document.getElementById('chkLength');
const chkUpper = document.getElementById('chkUpper');
const chkLower = document.getElementById('chkLower');
const chkNumber = document.getElementById('chkNumber');
const chkSpecial = document.getElementById('chkSpecial');

const confirmPasswordInput = document.getElementById('confirmPassword');
const confirmFeedback = document.getElementById('confirmFeedback');

// ===== Initialize International Phone Input =====
let iti = null;
const phoneInput = document.getElementById('phone');
if (phoneInput && window.intlTelInput) {
    iti = window.intlTelInput(phoneInput, {
        initialCountry: "in",
        separateDialCode: true,
        preferredCountries: ["in", "us", "gb", "ae"],
        autoPlaceholder: "off",
        utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.19/js/utils.js"
    });
    window.phoneInputIti = iti;
}

// ===== Dynamic Country & State Population =====
const countryStateMap = {
    "India": [
        "Andhra Pradesh", "Assam", "Bihar", "Delhi", "Gujarat", "Haryana", 
        "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Punjab", 
        "Rajasthan", "Tamil Nadu", "Telangana", "Uttar Pradesh", "West Bengal"
    ],
    "United States": [
        "California", "Texas", "Florida", "New York", "Illinois", "Pennsylvania", 
        "Ohio", "Georgia", "North Carolina", "Michigan", "Washington", "Massachusetts"
    ],
    "United Kingdom": [
        "England", "Scotland", "Wales", "Northern Ireland"
    ],
    "United Arab Emirates": [
        "Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"
    ],
    "Canada": [
        "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan", "Nova Scotia"
    ],
    "Australia": [
        "New South Wales", "Victoria", "Queensland", "Western Australia", "South Australia", "Tasmania"
    ]
};

const countrySelect = document.getElementById('country');
const stateSelect = document.getElementById('state');

if (countrySelect && stateSelect) {
    countrySelect.addEventListener('change', () => {
        const selectedCountry = countrySelect.value;
        stateSelect.innerHTML = '<option value="" disabled selected>Select State</option>';
        
        if (countryStateMap[selectedCountry]) {
            countryStateMap[selectedCountry].forEach(state => {
                const option = document.createElement('option');
                option.value = state;
                option.textContent = state;
                stateSelect.appendChild(option);
            });
            stateSelect.disabled = false;
        } else {
            stateSelect.disabled = true;
        }
    });
}

const VALID_INVITE_CODES = ['KYLRX-ADMIN-2026', 'HRFLOW-SECURE-ADMIN', 'ADMIN-INVITE-2026', 'SECRET-KYLRX-KEY', 'HRFLOW-2026'];

// ===== 1. Show/Hide Password Toggle =====
document.querySelectorAll('.eye-btnToggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        const icon = btn.querySelector('i');
        
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fa-regular fa-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'fa-regular fa-eye';
        }
    });
});

// ===== 2. Real-time Email Validation =====
emailInput.addEventListener('input', () => {
    const val = emailInput.value.trim();
    if (!val) {
        emailFeedback.textContent = '';
        emailFeedback.className = 'validation-feedback';
        return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(val)) {
        emailFeedback.textContent = '✗ Invalid email format';
        emailFeedback.className = 'validation-feedback invalid';
        emailFeedback.style.color = '#ef4444';
        return;
    }
    
    emailFeedback.textContent = '✓ Valid email format';
    emailFeedback.className = 'validation-feedback valid';
    emailFeedback.style.color = '#10b981';
});


// ===== 3. Real-time Password Strength Validation =====
passwordInput.addEventListener('input', () => {
    const val = passwordInput.value;
    
    const hasLength = val.length >= 8;
    const hasUpper = /[A-Z]/.test(val);
    const hasLower = /[a-z]/.test(val);
    const hasNumber = /[0-9]/.test(val);
    const hasSpecial = /[@$!%*?&#]/.test(val);
    
    updateChecklistItem(chkLength, hasLength);
    updateChecklistItem(chkUpper, hasUpper);
    updateChecklistItem(chkLower, hasLower);
    updateChecklistItem(chkNumber, hasNumber);
    updateChecklistItem(chkSpecial, hasSpecial);
    
    let score = 0;
    if (hasLength) score++;
    if (hasUpper) score++;
    if (hasLower) score++;
    if (hasNumber) score++;
    if (hasSpecial) score++;
    
    let color = '#ef4444';
    let text = 'None';
    let width = '0%';
    
    if (val.length > 0) {
        if (score <= 2) {
            color = '#ef4444';
            text = 'Weak';
            width = '33%';
        } else if (score <= 4) {
            color = '#f59e0b';
            text = 'Medium';
            width = '66%';
        } else {
            color = '#10b981';
            text = 'Strong';
            width = '100%';
        }
    }
    
    strengthFill.style.width = width;
    strengthFill.style.backgroundColor = color;
    strengthText.textContent = `Password Strength: ${text}`;
    strengthText.style.color = color;
    
    validateConfirmPassword();
});

function updateChecklistItem(el, isValid) {
    if (isValid) {
        el.classList.add('valid');
        const icon = el.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-circle-check';
    } else {
        el.classList.remove('valid');
        const icon = el.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-circle-xmark';
    }
}

// ===== 4. Confirm Password Match Check =====
function validateConfirmPassword() {
    const pw = passwordInput.value;
    const cpw = confirmPasswordInput.value;
    
    if (!cpw) {
        confirmFeedback.textContent = '';
        confirmFeedback.className = 'validation-feedback';
        return false;
    }
    
    if (pw === cpw) {
        confirmFeedback.textContent = '✓ Passwords match';
        confirmFeedback.className = 'validation-feedback valid';
        confirmFeedback.style.color = '#10b981';
        return true;
    } else {
        confirmFeedback.textContent = '✗ Passwords do not match';
        confirmFeedback.className = 'validation-feedback invalid';
        confirmFeedback.style.color = '#ef4444';
        return false;
    }
}

confirmPasswordInput.addEventListener('input', validateConfirmPassword);

// ===== 5. Form Submission & API Call =====
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = window.phoneInputIti ? window.phoneInputIti.getNumber().trim() : document.getElementById('phone').value.trim();
    const company = document.getElementById('company').value.trim();
    const department = document.getElementById('department').value.trim();
    const country = document.getElementById('country').value;
    const state = document.getElementById('state').value;
    const password = document.getElementById('password').value;
    const confirmPassword = confirmPasswordInput.value;
    const termsChecked = document.getElementById('terms').checked;

    errorMessage.style.display = 'none';

    // Verification Checks
    if (!name || !email || !phone || !company || !department || !country || !state || !password || !confirmPassword) {
        showLocalError('Please fill in all required fields.');
        return;
    }

    // Phone format verification
    if (window.phoneInputIti && !window.phoneInputIti.isValidNumber()) {
        showLocalError('Please enter a valid phone number for the selected country.');
        return;
    }

    if (!termsChecked) {
        showLocalError('You must agree to the Terms & Conditions.');
        return;
    }

    // Email Check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showLocalError('Please enter a valid email address.');
        return;
    }

    // Password strength check
    const hasLength = password.length >= 8;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[@$!%*?&#]/.test(password);
    if (!(hasLength && hasUpper && hasLower && hasNumber && hasSpecial)) {
        showLocalError('Password does not meet all security requirements.');
        return;
    }

    // Password mismatch check
    if (password !== confirmPassword) {
        showLocalError('Passwords do not match.');
        return;
    }



    signupBtn.disabled = true;
    signupBtn.querySelector('span').textContent = 'Creating Admin...';

    try {
        // 1. Create User in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Create Admin Record in Firestore
        await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            name: name,
            email: email,
            phone: phone,
            company: company,
            department: department,
            departmentId: department.toLowerCase().replace(/\s+/g, '-'),
            country: country,
            state: state,
            role: 'admin',
            createdAt: new Date().toISOString()
        });

        // Save to sessionStorage for auto-prefill on login page
        try {
            sessionStorage.setItem('signup_email', email);
            sessionStorage.setItem('signup_password', password);
        } catch (e) {
            console.warn('Session storage write failed:', e);
        }

        window.showAlert('Admin Registered', 'Admin account successfully configured and saved! Redirecting to login...', 'circle-check');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 3000);

    } catch (error) {
        console.error('Signup Error:', error);
        showLocalError(error.message);
    } finally {
        signupBtn.disabled = false;
        signupBtn.querySelector('span').textContent = 'Register Admin Portal';
    }
});

function showLocalError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
    errorMessage.classList.add('shake');
    setTimeout(() => errorMessage.classList.remove('shake'), 500);
}


