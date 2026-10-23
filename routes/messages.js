const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

// Thread endpoints
router.get('/thread/:chatId', messageController.getThreadMessages);
router.post('/send', messageController.sendMessage);
router.post('/clear/:chatId', messageController.clearChat);

// Standard endpoints
router.get('/:recipientId', messageController.getMessages);
router.post('/', messageController.sendMessage);
router.post('/broadcast', messageController.broadcastMessage);

module.exports = router;
