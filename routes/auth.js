const express = require('express');
const router = express.Router();
const { register, registerOrganization, login, refreshToken, unlockAccount, verifyMfa, resendMfa } = require('../controllers/authController');

// Rate limiting specifically for Auth
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 10, // Max 10 attempts
    message: { success: false, error: 'Too many authentication attempts, please try again later' }
});

router.post('/signup', authLimiter, register);
router.post('/register-organization', authLimiter, registerOrganization);
router.post('/login', authLimiter, login);
router.post('/refresh-token', refreshToken);
router.post('/verify-mfa', verifyMfa);
router.post('/verify-otp', verifyMfa);
router.post('/resend-mfa', resendMfa);

const { verifyToken, authorize } = require('../middleware/authMiddleware');

// Admin-only unlock endpoint (protected with verifyToken and Admin role)
router.get('/unlock/:email', verifyToken, authorize('Admin', 'Super Admin'), unlockAccount);

module.exports = router;
