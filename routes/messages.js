const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Permissive local session identity middleware
const optionalAuth = (req, res, next) => {
    if (!req.user) {
        req.user = {
            uid: req.headers['x-user-id'] || 'ADMIN_GLOBAL',
            name: req.headers['x-user-name'] || 'Super Admin',
            role: 'admin'
        };
    }
    next();
};

// Thread endpoints
router.get('/thread/:chatId', optionalAuth, messageController.getThreadMessages);
router.post('/send', optionalAuth, messageController.sendMessage);
router.post('/clear/:chatId', optionalAuth, messageController.clearChat);

// Standard endpoints
router.get('/:recipientId', optionalAuth, messageController.getMessages);
router.post('/', optionalAuth, messageController.sendMessage);
router.post('/broadcast', optionalAuth, messageController.broadcastMessage);

module.exports = router;
