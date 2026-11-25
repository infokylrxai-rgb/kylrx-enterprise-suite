const { admin, db } = require('../config/firebase');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { RESERVED_ORG_IDS } = require('../config/tenant');
const otpVerificationService = require('../services/otp-verification-service');

// Security Configurations
const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 8;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes (dev-friendly)
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is missing');
}
if (!process.env.REFRESH_SECRET) {
    throw new Error('REFRESH_SECRET environment variable is missing');
}
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_SECRET;

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
        const { name, email, password, department } = req.body;

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

        // 4. Save to Firestore (Always assign 'Employee'; ignore any role in req.body. Only authenticated admin endpoints may create privileged users.)
        const newUserRef = db.collection('users').doc();
        await newUserRef.set({
            name,
            email,
            password: hashedPassword, // Custom Auth
            role: 'Employee',
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

// Customer / CEO signup: creates the Auth user, Super Admin profile, organization and
// employee ID counter with the Admin SDK, since Firestore rules block these client writes.
exports.registerOrganization = async (req, res, next) => {
    const { fullName, email, password, organization = {} } = req.body || {};
    const officialEmail = String(email || '').trim().toLowerCase();
    const name = String(fullName || '').trim();
    const legalName = String(organization.legalName || '').trim();
    const displayName = String(organization.displayName || '').trim();

    if (!name || !officialEmail || !password || !(legalName || displayName)) {
        return res.status(400).json({ success: false, error: 'Name, email, password and company name are required' });
    }
    if (String(password).length < 8) {
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long' });
    }

    const orgSlug = (displayName || legalName).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const orgId = `org_${orgSlug}`;

    // Default/fallback tenants own legacy data and dev defaults; nobody may register as one
    if (RESERVED_ORG_IDS.has(orgId)) {
        return res.status(409).json({ success: false, error: `The organization name "${displayName || legalName}" is reserved. Please choose another name.` });
    }
    if (!admin.apps.length) {
        return res.status(503).json({ success: false, error: 'Firebase Admin SDK is not configured on the server' });
    }
    const orgRef = db.collection('organizations').doc(orgId);

    let uid;
    try {
        // Refuse to take over an organization that another account already owns
        const existingOrg = await orgRef.get();
        if (existingOrg.exists) {
            return res.status(409).json({ success: false, error: `An organization named "${displayName || legalName}" is already registered` });
        }

        try {
            const userRecord = await admin.auth().createUser({ email: officialEmail, password: String(password), displayName: name });
            uid = userRecord.uid;
        } catch (authErr) {
            if (authErr.code === 'auth/email-already-exists') {
                return res.status(409).json({ success: false, code: 'auth/email-already-in-use', error: 'An account with this official email already exists. Please log in.' });
            }
            if (authErr.code === 'auth/invalid-email' || authErr.code === 'auth/invalid-password') {
                return res.status(400).json({ success: false, error: authErr.message });
            }
            throw authErr;
        }

        // Set claims straight away so the onUserCreated Cloud Function sees them and skips
        await admin.auth().setCustomUserClaims(uid, { role: 'super_admin', super_admin: true, orgId });

        const ts = admin.firestore.FieldValue.serverTimestamp();
        const o = organization;
        const field = (v) => String(v || '').trim();
        const corpAddress = field(o.corporateAddress) || field(o.registeredAddress);
        const logoUrl = field(o.logoUrl) || 'https://kylrx.ai/logo.jpg';

        // Firestore retries silently when the project quota is exhausted, so cap the wait
        // and fail cleanly (rolling back the Auth user below) instead of hanging the request
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error('FIRESTORE_TIMEOUT');
                err.code = 'firestore-timeout';
                reject(err);
            }, 20000);
        });

        await Promise.race([timeout, db.runTransaction(async (tx) => {
            const orgSnap = await tx.get(orgRef);
            // Only an org doc created for this same user (e.g. by the Cloud Function) may be merged into
            if (orgSnap.exists && orgSnap.data().creatorUid !== uid && orgSnap.data().createdBy !== uid) {
                const conflict = new Error('ORG_EXISTS');
                conflict.code = 'org-exists';
                throw conflict;
            }

            tx.set(db.collection('users').doc(uid), {
                uid,
                name,
                displayName: name,
                email: officialEmail,
                company: displayName || legalName,
                role: 'super_admin',
                superAdmin: true,
                orgId,
                departmentId: 'executive',
                department: 'Executive Leadership',
                designation: 'CEO & Founder',
                status: 'active',
                createdAt: ts,
                updatedAt: ts
            }, { merge: true });

            tx.set(orgRef, {
                // Exact 21 attributes matching PRD and Templates.xlsx
                Legal_Name: legalName,
                Display_Name: displayName,
                Organization_Type: field(o.organizationType),
                Industry: field(o.industry),
                Website: field(o.website),
                Official_Email: officialEmail,
                Official_Phone: field(o.officialPhone),
                Country: field(o.country) || 'India',
                State: field(o.state),
                City: field(o.city),
                PIN_Code: field(o.pinCode),
                Registered_Address: field(o.registeredAddress),
                Corporate_Address: corpAddress,
                Time_Zone: field(o.timezone) || 'Asia/Kolkata',
                Currency: field(o.currency) || 'INR',
                Financial_Year_Start: field(o.financialYearStart) || '04-01',
                PAN: field(o.pan).toUpperCase(),
                TAN: field(o.tan).toUpperCase(),
                CIN_or_LLPIN: field(o.cinOrLlpin).toUpperCase(),
                GSTIN: field(o.gstin).toUpperCase(),
                Logo_URL: logoUrl,

                // Normalized camelCase mirrors for client interoperability
                legalName,
                displayName,
                organizationType: field(o.organizationType),
                industry: field(o.industry),
                website: field(o.website),
                officialEmail,
                officialPhone: field(o.officialPhone),
                country: field(o.country) || 'India',
                state: field(o.state),
                city: field(o.city),
                pinCode: field(o.pinCode),
                registeredAddress: field(o.registeredAddress),
                corporateAddress: corpAddress,
                timezone: field(o.timezone) || 'Asia/Kolkata',
                currency: field(o.currency) || 'INR',
                financialYearStart: field(o.financialYearStart) || '04-01',
                pan: field(o.pan).toUpperCase(),
                tan: field(o.tan).toUpperCase(),
                cinOrLlpin: field(o.cinOrLlpin).toUpperCase(),
                gstin: field(o.gstin).toUpperCase(),
                logoUrl,

                // PRD Governance & Setup State
                orgId,
                orgConfigured: true,
                initialEmployeeIdProvisioned: true,
                createdBy: uid,
                creatorUid: uid,
                creatorEmail: officialEmail,
                createdAt: ts,
                configuredAt: ts,
                updatedAt: ts
            }, { merge: true });

            tx.set(orgRef.collection('counters').doc('employees'), {
                currentSequence: 0,
                prefix: 'EMP',
                padLength: 4,
                nextIdPreview: 'EMP0001',
                initialProvisioned: true,
                orgId,
                initializedAt: ts,
                updatedAt: ts
            }, { merge: true });
        })]).finally(() => clearTimeout(timer));

        logger.info(`Organization signup completed: ${orgId} by ${uid}`);
        res.status(201).json({ success: true, uid, orgId });
    } catch (error) {
        // Roll back the Auth user so the person can retry with the same email
        if (uid) {
            await admin.auth().deleteUser(uid).catch((e) => logger.error(`Signup rollback failed for ${uid}: ${e.message}`));
        }
        if (error.code === 'org-exists') {
            return res.status(409).json({ success: false, error: 'This organization is already registered' });
        }
        if (error.code === 'firestore-timeout' || error.code === 8 || /quota|RESOURCE_EXHAUSTED/i.test(error.message)) {
            logger.error(`Organization signup failed for ${orgId}: Firestore unavailable (${error.message})`);
            return res.status(503).json({ success: false, error: 'The database is temporarily unavailable (Firestore quota exceeded or not responding). No account was created - please try again later.' });
        }
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

        // 2. Verify Password (Strict bcrypt comparison only; plaintext comparisons removed)
        let isMatch = false;
        if (user.password && typeof user.password === 'string' && user.password.startsWith('$2')) {
            isMatch = await bcrypt.compare(password, user.password);
        }

        if (!isMatch) {
            // Increment failed attempts
            let attempts = (user.loginAttempts || 0) + 1;
            let updates = { loginAttempts: attempts };
            
            if (attempts >= MAX_LOGIN_ATTEMPTS) {
                updates.lockUntil = admin.firestore.Timestamp.fromMillis(Date.now() + LOCK_TIME);
                logger.warn(`Account locked for email: ${email}`);
            }
            
            await db.collection('users').doc(userId).update(updates);
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // 3. Reset failed login attempts on successful password verification
        await db.collection('users').doc(userId).update({
            loginAttempts: 0,
            lockUntil: null
        });

        // 4. Multi-Factor Authentication: Generate real OTP via otpVerificationService
        let otpResult;
        try {
            otpResult = otpVerificationService.generateOtp({
                identifier: user.email,
                purpose: 'mfa_login',
                ttlSeconds: 300,
                metadata: { userId, role: user.role }
            });
        } catch (otpErr) {
            logger.error(`[MFA] OTP generation error for ${email}: ${otpErr.message}`);
            return res.status(500).json({ success: false, error: 'Failed to generate MFA OTP' });
        }

        // 5. Issue short-lived 'mfa_pending' token ONLY (No full access token or refresh token)
        const mfaPayload = {
            id: userId,
            email: user.email,
            role: user.role,
            type: 'mfa_pending',
            otpId: otpResult.otpId
        };
        const mfaToken = jwt.sign(mfaPayload, JWT_SECRET, { expiresIn: '5m' });

        res.status(200).json({
            success: true,
            requiresMfa: true,
            mfaToken,
            otpId: otpResult.otpId,
            message: 'Password verified. Please enter the OTP sent to complete authentication.',
            ...(process.env.NODE_ENV !== 'production' ? { code: otpResult.code } : {})
        });

    } catch (error) {
        next(error);
    }
};

exports.verifyMfa = async (req, res, next) => {
    try {
        const { code, otp } = req.body || {};
        const candidateCode = code || otp;

        let mfaToken;
        const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
            mfaToken = authHeader.slice(7).trim();
        }
        if (!mfaToken && req.body && req.body.mfaToken) {
            mfaToken = req.body.mfaToken;
        }

        if (!mfaToken) {
            return res.status(401).json({ success: false, error: 'MFA token required' });
        }

        if (!candidateCode) {
            return res.status(400).json({ success: false, error: 'Verification code required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(mfaToken, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ success: false, error: 'Invalid or expired MFA session' });
        }

        if (decoded.type !== 'mfa_pending') {
            return res.status(401).json({ success: false, error: 'Token is not an MFA pending token' });
        }

        const otpId = req.body.otpId || decoded.otpId;
        const verifyResult = otpVerificationService.verifyOtp({
            otpId,
            identifier: decoded.email,
            purpose: 'mfa_login',
            code: String(candidateCode).trim(),
            actor: { id: decoded.id, role: decoded.role }
        });

        if (!verifyResult.success) {
            return res.status(401).json({
                success: false,
                error: verifyResult.message || 'Invalid or expired OTP',
                reason: verifyResult.reason
            });
        }

        // Fetch latest user document from Firestore to verify status and mustResetPassword
        let userData = {};
        try {
            const userDoc = await db.collection('users').doc(decoded.id).get();
            if (userDoc.exists) {
                userData = userDoc.data();
            }
        } catch (dbErr) {
            logger.warn(`[MFA] User doc fetch warning: ${dbErr.message}`);
        }

        // Update lastLogin
        try {
            await db.collection('users').doc(decoded.id).update({
                lastLogin: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (_) {}

        // Issue full access token and refresh token upon successful OTP verification
        const fullPayload = {
            id: decoded.id,
            email: decoded.email,
            role: userData.role || decoded.role
        };
        const accessToken = jwt.sign(fullPayload, JWT_SECRET, { expiresIn: '15m' });
        const refreshToken = jwt.sign(fullPayload, REFRESH_SECRET, { expiresIn: '7d' });

        res.status(200).json({
            success: true,
            message: 'MFA verified successfully',
            accessToken,
            refreshToken,
            mustResetPassword: userData.mustResetPassword === true,
            user: {
                id: decoded.id,
                email: decoded.email,
                name: userData.name || '',
                role: userData.role || decoded.role,
                department: userData.department || 'General',
                mustResetPassword: userData.mustResetPassword === true
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.resendMfa = async (req, res, next) => {
    try {
        let mfaToken;
        const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
            mfaToken = authHeader.slice(7).trim();
        }
        if (!mfaToken && req.body && req.body.mfaToken) {
            mfaToken = req.body.mfaToken;
        }

        if (!mfaToken) {
            return res.status(401).json({ success: false, error: 'MFA token required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(mfaToken, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ success: false, error: 'Invalid or expired MFA session' });
        }

        if (decoded.type !== 'mfa_pending') {
            return res.status(401).json({ success: false, error: 'Token is not an MFA pending token' });
        }

        const newOtp = otpVerificationService.generateOtp({
            identifier: decoded.email,
            purpose: 'mfa_login',
            ttlSeconds: 300,
            metadata: { userId: decoded.id, role: decoded.role }
        });

        const newMfaToken = jwt.sign({
            id: decoded.id,
            email: decoded.email,
            role: decoded.role,
            type: 'mfa_pending',
            otpId: newOtp.otpId
        }, JWT_SECRET, { expiresIn: '5m' });

        res.status(200).json({
            success: true,
            message: 'Fresh OTP generated successfully',
            mfaToken: newMfaToken,
            otpId: newOtp.otpId,
            ...(process.env.NODE_ENV !== 'production' ? { code: newOtp.code } : {})
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

/**
 * POST /api/auth/link-google
 *
 * Completes a Google sign-in. The browser authenticates with Google, then calls this with the
 * resulting Firebase ID token; the server decides whether that person may enter and, if so, gives
 * their Google identity the role and organisation it needs.
 *
 * It exists because Google sign-in alone leaves a user the backend cannot place. A Google account
 * arrives with no custom claims, and firestore.rules only lets a user create their OWN profile when
 * the role is 'Employee' and the orgId already matches their token - so the client's attempt to
 * write users/{googleUid} is denied for everyone else, silently. The result was a person who
 * appeared signed in while req.user.orgId was undefined and every tenant-scoped read was refused:
 * logged in, and able to see nothing.
 *
 * Two rules keep it safe:
 *   - The role and orgId are read from the EXISTING record only, never from the request body, so
 *     this cannot be used to grant anyone a role they were not already given.
 *   - A Google account with no matching record is deleted rather than left behind, so strangers
 *     who click the button do not accumulate as orphan Auth users. The deletion is deliberately
 *     narrow: see the guards below.
 */
exports.linkGoogleAccount = async (req, res) => {
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!idToken) {
        return res.status(401).json({ success: false, error: 'Missing Google ID token.' });
    }

    let decoded;
    try {
        decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Invalid or expired Google sign-in token.' });
    }

    const uid = decoded.uid;
    const email = String(decoded.email || '').toLowerCase().trim();
    if (!email) {
        return res.status(400).json({ success: false, error: 'Google account has no email address.' });
    }

    // Resolve the canonical record. lookupFailed is tracked separately from "not found": a
    // Firestore outage must never be mistaken for an unknown person, because the not-found branch
    // deletes the account.
    let record = null;
    let recordRef = null;
    let lookupFailed = false;

    try {
        const byUid = await db.collection('users').doc(uid).get();
        if (byUid.exists) { record = byUid.data(); recordRef = byUid.ref; }
    } catch (err) {
        lookupFailed = true;
        logger.warn(`[linkGoogle] users/${uid} lookup failed: ${err.message}`);
    }

    for (const collection of ['users', 'employees']) {
        if (record || lookupFailed) break;
        try {
            const snap = await db.collection(collection).where('email', '==', email).limit(1).get();
            if (!snap.empty) { record = snap.docs[0].data(); recordRef = snap.docs[0].ref; }
        } catch (err) {
            lookupFailed = true;
            logger.warn(`[linkGoogle] ${collection} lookup for ${email} failed: ${err.message}`);
        }
    }

    if (lookupFailed) {
        // Never delete on a lookup we could not complete.
        return res.status(503).json({ success: false, error: 'Could not verify your account right now. Please try again.' });
    }

    if (!record) {
        await deleteUnprovisionedGoogleUser(uid);
        return res.status(403).json({
            success: false,
            error: `No Kylrx account exists for ${email}. Sign in with the email your company registered, or ask your administrator to add you.`
        });
    }

    const role = record.role || 'employee';
    const orgId = record.orgId || null;
    if (!orgId) {
        logger.warn(`[linkGoogle] record for ${email} has no orgId; refusing to link an unscoped identity`);
        return res.status(409).json({
            success: false,
            error: 'Your account is not attached to an organization yet. Please contact your administrator.'
        });
    }

    // Claims are what the API middleware and the security rules read, so they are the part that
    // actually lets this person see their own data.
    try {
        const existing = (await admin.auth().getUser(uid)).customClaims || {};
        await admin.auth().setCustomUserClaims(uid, { ...existing, role, orgId });
    } catch (err) {
        logger.error(`[linkGoogle] could not set claims for ${uid}: ${err.message}`);
        return res.status(500).json({ success: false, error: 'Could not complete sign-in. Please try again.' });
    }

    // The profile must live at the signed-in uid: authMiddleware reads users/{uid} and the rules
    // fall back to userDoc(request.auth.uid).orgId. Written with the Admin SDK, which is not bound
    // by the self-create restriction that was silently blocking the browser.
    const canonicalIsElsewhere = recordRef && recordRef.id !== uid;
    try {
        await db.collection('users').doc(uid).set({
            ...record,
            uid,
            email,
            role,
            orgId,
            googleLinked: true,
            ...(canonicalIsElsewhere ? { migratedFrom: recordRef.path } : {}),
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (err) {
        logger.error(`[linkGoogle] could not write users/${uid}: ${err.message}`);
        return res.status(500).json({ success: false, error: 'Could not complete sign-in. Please try again.' });
    }

    // Retire the source record so one person does not end up as two. Only a record with no Auth
    // account of its own is retired - that is an onboarding placeholder. If it has its own login it
    // is a real separate account and is left completely alone.
    if (canonicalIsElsewhere) {
        try {
            await admin.auth().getUser(recordRef.id);
        } catch (_) {
            try {
                await recordRef.set({ supersededByUid: uid, active: false, updatedAt: new Date().toISOString() }, { merge: true });
            } catch (err) {
                logger.warn(`[linkGoogle] could not retire ${recordRef.path}: ${err.message}`);
            }
        }
    }

    // Only presentational fields: the browser must not receive anything it could replay as
    // authority. Role and orgId are already fixed in the token's claims above.
    const profile = {
        name: record.name || record.displayName || '',
        departmentId: record.departmentId || '',
        departmentName: record.departmentName || record.department || '',
        departmentCode: record.departmentCode || '',
        status: record.status || 'Active'
    };

    return res.json({ success: true, uid, role, orgId, profile, migrated: Boolean(canonicalIsElsewhere) });
};

/**
 * Removes a Google account that has no Kylrx record, so clicking "Sign in with Google" does not
 * leave an Auth user behind. Narrow on purpose - it will not touch an account that looks
 * established, because the cost of deleting a real person's login far exceeds the cost of leaving
 * one stray record.
 */
async function deleteUnprovisionedGoogleUser(uid) {
    try {
        const user = await admin.auth().getUser(uid);

        const providers = (user.providerData || []).map(p => p.providerId);
        const onlyGoogle = providers.length === 1 && providers[0] === 'google.com';
        const hasClaims = user.customClaims && Object.keys(user.customClaims).length > 0;
        const createdAt = Date.parse(user.metadata && user.metadata.creationTime) || 0;
        const justCreated = createdAt > 0 && (Date.now() - createdAt) < 10 * 60 * 1000;

        if (onlyGoogle && !hasClaims && justCreated) {
            await admin.auth().deleteUser(uid);
            logger.info(`[linkGoogle] removed unprovisioned Google account ${uid}`);
        } else {
            logger.warn(`[linkGoogle] left ${uid} in place (onlyGoogle=${onlyGoogle} hasClaims=${Boolean(hasClaims)} justCreated=${justCreated})`);
        }
    } catch (err) {
        logger.warn(`[linkGoogle] cleanup skipped for ${uid}: ${err.message}`);
    }
}
