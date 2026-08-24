const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { verifyToken } = require('../middleware/authMiddleware');

// All messaging routes require authentication
router.use(verifyToken);

router.get('/:recipientId', messageController.getMessages);
router.post('/', messageController.sendMessage);
router.post('/broadcast', messageController.broadcastMessage);

module.exports = router;
