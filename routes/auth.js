const express = require('express');
const router = express.Router();
const { register, login, refreshToken, unlockAccount } = require('../controllers/authController');

// Rate limiting specifically for Auth
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 10, // Max 10 attempts
    message: { success: false, error: 'Too many authentication attempts, please try again later' }
});

router.post('/signup', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/refresh-token', refreshToken);

// Admin-only unlock endpoint (dev + admin use)
router.get('/unlock/:email', unlockAccount);

module.exports = router;
