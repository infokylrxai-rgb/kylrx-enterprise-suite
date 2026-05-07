const express = require('express');
const router = express.Router();
const { messaging } = require('../config/firebase');

// 1. Specific Notify Endpoint (Requested)
// POST /notify
router.post('/notify', async (req, res) => {
  let { title, message } = req.body;

  // Sanitize and Validate
  title = title?.trim();
  message = message?.trim();

  if (!title || !message) {
    return res.status(400).json({
      success: false,
      message: 'Title and Message cannot be empty'
    });
  }


  const payload = {
    notification: {
      title: title,
      body: message
    },
    topic: 'announcements'
  };

  try {
    const response = await messaging.send(payload);
    res.status(200).json({
      success: true,
      message: 'Notification sent successfully to topic: announcements',
      messageId: response
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification',
      error: error.message
    });
  }
});

// 2. Generic Send Notification (Previous)
router.post('/send-notification', async (req, res) => {
  const { title, body, topic } = req.body;

  const payload = {
    notification: { title, body },
    topic: topic || 'all-employees'
  };

  try {
    const response = await messaging.send(payload);
    res.status(200).json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
