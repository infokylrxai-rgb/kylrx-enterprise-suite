import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const signupForm = document.getElementById('signupForm');
const signupBtn = document.getElementById('signupBtn');
const errorMessage = document.getElementById('errorMessage');

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    signupBtn.disabled = true;
    signupBtn.querySelector('span').textContent = 'Creating Admin...';
    errorMessage.style.display = 'none';

    try {
        // 1. Create User in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Create Admin Record in Firestore
        await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            name: name,
            email: email,
            role: 'admin',
            createdAt: new Date().toISOString()
        });

        window.showAlert('Admin Created', 'Admin account created successfully! Redirecting to login...', 'circle-check');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2500);

    } catch (error) {
        console.error('Signup Error:', error);
        errorMessage.textContent = error.message;
        errorMessage.style.display = 'block';
    } finally {
        signupBtn.disabled = false;
        signupBtn.querySelector('span').textContent = 'Register Admin Portal';
    }
});

