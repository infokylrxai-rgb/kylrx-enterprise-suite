const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { verifyToken, authorize, ADMIN_HR_ROLES, requireOrg } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(requireOrg);

// Thread endpoints
router.get('/thread/:chatId', messageController.getThreadMessages);
router.post('/send', messageController.sendMessage);
router.post('/clear/:chatId', messageController.clearChat);

// Standard endpoints
router.get('/:recipientId', messageController.getMessages);
router.post('/', messageController.sendMessage);
router.post('/broadcast', authorize(ADMIN_HR_ROLES), messageController.broadcastMessage);

module.exports = router;
