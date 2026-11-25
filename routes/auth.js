const express = require('express');
const router = express.Router();
const { register, registerOrganization, login, refreshToken, unlockAccount, verifyMfa, resendMfa, linkGoogleAccount } = require('../controllers/authController');
const { demoLogin } = require('../controllers/demoController');
const { requirePublicSignup } = require('../config/signup');

// Rate limiting specifically for Auth
const rateLimit = require('express-rate-limit');
const WINDOW_MS = 15 * 60 * 1000; // 15 mins

// Signup and organization registration: 10 per IP per window, shared by the two routes
const authLimiter = rateLimit({
    windowMs: WINDOW_MS,
    max: 10,
    message: { success: false, error: 'Too many authentication attempts, please try again later' }
});

// Login counts failed attempts only (a response >= 400); successful logins use no budget.
// Per IP: 50, because an office shares one address and mistyped passwords are normal.
// Per account: 10 per email (case-insensitive), which also covers emails that have no account.
// Both counters live in this process's memory (shortcut: use a shared store when running several servers).
const loginIpLimiter = rateLimit({
    windowMs: WINDOW_MS,
    max: 50,
    skipSuccessfulRequests: true,
    message: { success: false, error: 'Too many failed login attempts from this network, please try again later' }
});
const loginAccountLimiter = rateLimit({
    windowMs: WINDOW_MS,
    max: 10,
    skipSuccessfulRequests: true,
    skip: (req) => !(req.body && req.body.email),
    keyGenerator: (req) => String(req.body.email).trim().toLowerCase(),
    message: { success: false, error: 'Too many failed login attempts for this account, please try again later' }
});

// Demo login: 20 per IP per window (every use is also logged by the controller)
const demoLimiter = rateLimit({
    windowMs: WINDOW_MS,
    max: 20,
    message: { success: false, error: 'Too many demo logins, please try again later' }
});

router.post('/demo-login', demoLimiter, demoLogin);
// Provisioned product: self-service registration is closed unless KYLRX_ALLOW_PUBLIC_SIGNUP=true.
router.post('/signup', requirePublicSignup, authLimiter, register);
router.post('/register-organization', requirePublicSignup, authLimiter, registerOrganization);
router.post('/login', loginIpLimiter, loginAccountLimiter, login);
// Completes a Google sign-in: the server decides who may enter and attaches role + orgId.
// Authenticates from the Firebase ID token in the Authorization header, not a session.
router.post('/link-google', loginIpLimiter, linkGoogleAccount);
router.post('/refresh-token', refreshToken);
router.post('/verify-mfa', verifyMfa);
router.post('/verify-otp', verifyMfa);
router.post('/resend-mfa', resendMfa);

const { verifyToken, authorize } = require('../middleware/authMiddleware');

// Admin-only unlock endpoint (protected with verifyToken and Admin role)
router.get('/unlock/:email', verifyToken, authorize('Admin', 'Super Admin'), unlockAccount);

module.exports = router;
