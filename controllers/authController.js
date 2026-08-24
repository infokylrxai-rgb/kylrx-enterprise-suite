const { admin, db } = require('../config/firebase');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Security Configurations
const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 8;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes (dev-friendly)
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-enterprise-key-hrflow-2026';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'super-refresh-secret-enterprise-key-hrflow-2026';

// Password Policy Enforcement
const validatePassword = (password) => {
    if (password.length < 14) return "Password must be at least 14 characters long";
    if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
    if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
    if (!/[0-9]/.test(password)) return "Password must contain a number";
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return "Password must contain a special character";
    
    const blacklist = ["Password123!", "Admin12345678!", "Qwertyuiop123!"];
    if (blacklist.includes(password)) return "Password is in the blacklist";
    
    return null; // Valid
};

exports.register = async (req, res, next) => {
    try {
        const { name, email, password, role, department } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, error: 'All fields are required' });
        }

        // 1. Password Policy Check
        const policyError = validatePassword(password);
        if (policyError) {
            return res.status(400).json({ success: false, error: policyError });
        }

        // 2. Check if email exists
        const userRef = db.collection('users').where('email', '==', email);
        const snapshot = await userRef.get();
        if (!snapshot.empty) {
            return res.status(400).json({ success: false, error: 'User already exists' });
        }

        // 3. Bcrypt Hashing
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // 4. Save to Firestore
        const newUserRef = db.collection('users').doc();
        await newUserRef.set({
            name,
            email,
            password: hashedPassword, // Custom Auth
            role: role || 'Employee',
            department: department || 'General Operations',
            managerAssigned: 'default-manager-queue',
            loginAttempts: 0,
            lockUntil: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(201).json({
            success: true,
            message: 'User registered successfully with strong security'
        });
    } catch (error) {
        next(error);
    }
};

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }

        const usersSnapshot = await db.collection('users').where('email', '==', email).limit(1).get();

        if (usersSnapshot.empty) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const userDoc = usersSnapshot.docs[0];
        const user = userDoc.data();
        const userId = userDoc.id;

        // 1. Check if account is locked
        if (user.lockUntil && typeof user.lockUntil.toDate === 'function') {
            const lockExpiry = user.lockUntil.toDate();
            if (lockExpiry > new Date()) {
                const remainingMs = lockExpiry - Date.now();
                const remainingMins = Math.ceil(remainingMs / 60000);
                return res.status(423).json({ 
                    success: false, 
                    error: `Account locked due to multiple failed attempts. Try again in ${remainingMins} minute${remainingMins !== 1 ? 's' : ''}.`
                });
            }
            // Lock expired — reset it automatically
            await db.collection('users').doc(userId).update({ loginAttempts: 0, lockUntil: null });
        }

        // 2. Verify Password (Supports both hashed 'password' and plain 'tempPassword')
        let isMatch = false;
        
        if (user.password && user.password.startsWith('$2')) {
            // Hashed password check
            isMatch = await bcrypt.compare(password, user.password);
        } else if (user.tempPassword) {
            // Plain text temp password check (Legacy/Sync fallback)
            isMatch = (password === user.tempPassword);
        } else if (user.password) {
            // Plain text password check
            isMatch = (password === user.password);
        }

        if (!isMatch) {
            // Increment attempts
            let attempts = (user.loginAttempts || 0) + 1;
            let updates = { loginAttempts: attempts };
            
            if (attempts >= MAX_LOGIN_ATTEMPTS) {
                // Handle missing lockUntil or Timestamp conversion
                updates.lockUntil = admin.firestore.Timestamp.fromMillis(Date.now() + LOCK_TIME);
                logger.warn(`Account locked for email: ${email}`);
            }
            
            await db.collection('users').doc(userId).update(updates);
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // 3. Reset attempts on success
        await db.collection('users').doc(userId).update({
            loginAttempts: 0,
            lockUntil: null,
            lastLogin: admin.firestore.FieldValue.serverTimestamp()
        });

        // 4. Generate JWTs
        const payload = { id: userId, email: user.email, role: user.role };
        const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
        const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });

        // MFA Trigger Logic (mocking OTP requirement)
        const requiresMfa = true;

        res.status(200).json({
            success: true,
            message: 'Login successful',
            accessToken,
            refreshToken,
            requiresMfa,
            user: { id: userId, name: user.name, role: user.role, department: user.department }
        });

    } catch (error) {
        next(error);
    }
};

exports.refreshToken = async (req, res, next) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ success: false, error: 'Refresh token required' });

        jwt.verify(token, REFRESH_SECRET, (err, decoded) => {
            if (err) return res.status(403).json({ success: false, error: 'Invalid refresh token' });

            const payload = { id: decoded.id, email: decoded.email, role: decoded.role };
            const newAccessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });

            res.status(200).json({ success: true, accessToken: newAccessToken });
        });
    } catch (error) {
        next(error);
    }
};
// Admin unlock route — resets lockUntil and loginAttempts for a given email
exports.unlockAccount = async (req, res, next) => {
    try {
        const { email } = req.params;
        if (!email) return res.status(400).json({ success: false, error: 'Email required' });

        const snap = await db.collection('users').where('email', '==', email).limit(1).get();
        if (snap.empty) return res.status(404).json({ success: false, error: 'User not found' });

        await snap.docs[0].ref.update({ loginAttempts: 0, lockUntil: null });
        logger.info(`Account manually unlocked: ${email}`);
        res.status(200).json({ success: true, message: `Account unlocked for ${email}` });
    } catch (error) {
        next(error);
    }
};
