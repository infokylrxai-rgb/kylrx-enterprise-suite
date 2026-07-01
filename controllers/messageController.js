const { db, admin } = require('../config/firebase');

/**
 * GET /api/messages/:chatId
 * Get messages between current user and recipient
 * (Simplification: Just getting messages for a chatId)
 */
exports.getMessages = async (req, res, next) => {
    try {
        const { recipientId } = req.params;
        const senderId = req.user.uid; // From authMiddleware

        // For simplicity, we'll use a collection 'chats' where messages are stored
        // A more robust way would be a subcollection or a filtered collection
        // Let's use a unique chatId for 1-on-1: sort(senderId, recipientId).join('_')
        const chatId = [senderId, recipientId].sort().join('_');

        const snapshot = await db.collection('messages')
            .where('chatId', '==', chatId)
            .orderBy('timestamp', 'asc')
            .get();

        const messages = snapshot.docs.map(doc => doc.data());

        res.json({ status: 'success', data: messages });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/messages
 * Send a message to a recipient
 */
exports.sendMessage = async (req, res, next) => {
    try {
        const { recipientId, text } = req.body;
        const senderId = req.user.uid;
        const senderName = req.user.name || 'Admin';

        if (!recipientId || !text) {
            return res.status(400).json({ status: 'error', message: 'Recipient and text are required' });
        }

        const chatId = [senderId, recipientId].sort().join('_');
        const messageData = {
            chatId,
            senderId,
            senderName,
            recipientId,
            text,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            type: 'direct'
        };

        await db.collection('messages').add(messageData);

        res.status(201).json({ status: 'success', message: 'Message sent' });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/messages/broadcast
 * Send a message to multiple recipients
 */
exports.broadcastMessage = async (req, res, next) => {
    try {
        const { recipientIds, text } = req.body;
        const senderId = req.user.uid;
        const senderName = req.user.name || 'Admin';

        if (!recipientIds || !Array.isArray(recipientIds) || !text) {
            return res.status(400).json({ status: 'error', message: 'Recipients array and text are required' });
        }

        const batch = db.batch();
        recipientIds.forEach(recipientId => {
            const chatId = [senderId, recipientId].sort().join('_');
            const ref = db.collection('messages').doc();
            batch.set(ref, {
                chatId,
                senderId,
                senderName,
                recipientId,
                text,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'broadcast'
            });
        });

        await batch.commit();

        res.status(201).json({ status: 'success', message: `Broadcast sent to ${recipientIds.length} people` });
    } catch (error) {
        next(error);
    }
};
