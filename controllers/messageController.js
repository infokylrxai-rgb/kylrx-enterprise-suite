const fs = require('fs');
const path = require('path');
const { db, admin } = require('../config/firebase');

const STORE_PATH = path.join(__dirname, '..', 'data', 'messages_store.json');

function loadStore() {
    try {
        if (!fs.existsSync(STORE_PATH)) {
            fs.writeFileSync(STORE_PATH, JSON.stringify({ messages: [] }, null, 2));
            return { messages: [] };
        }
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    } catch (e) {
        return { messages: [] };
    }
}

function saveStore(data) {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Failed to write messages store:', e);
    }
}

function normalizeTimestamp(ts) {
    if (!ts) return new Date().toISOString();
    if (typeof ts === 'string') return ts;
    if (typeof ts === 'number') return new Date(ts).toISOString();
    if (ts.seconds) return new Date(ts.seconds * 1000).toISOString();
    if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
    return new Date().toISOString();
}

/**
 * GET /api/messages/thread/:chatId
 * Fast retrieval for deterministic chatId
 */
exports.getThreadMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const store = loadStore();
        let msgs = store.messages.filter(m => m.chatId === chatId);

        // Background attempt to pull from Firestore with tight timeout (1000ms)
        try {
            if (db) {
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000));
                const firestorePromise = db.collection('messages').where('chatId', '==', chatId).limit(100).get();
                const snap = await Promise.race([firestorePromise, timeoutPromise]);
                if (snap && snap.docs) {
                    const fsMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    const ids = new Set(msgs.map(m => m.id));
                    let added = false;
                    for (const fm of fsMsgs) {
                        if (!ids.has(fm.id)) {
                            msgs.push(fm);
                            store.messages.push(fm);
                            added = true;
                        }
                    }
                    if (added) saveStore(store);
                }
            }
        } catch (_) {}

        msgs.sort((a, b) => {
            const tA = new Date(normalizeTimestamp(a.timestamp)).getTime();
            const tB = new Date(normalizeTimestamp(b.timestamp)).getTime();
            return tA - tB;
        });

        res.json({ success: true, status: 'success', data: msgs });
    } catch (error) {
        res.status(500).json({ success: false, status: 'error', error: error.message });
    }
};

/**
 * GET /api/messages/:recipientId
 * Legacy & omni-channel retrieval
 */
exports.getMessages = async (req, res) => {
    try {
        const { recipientId } = req.params;
        const senderId = (req.user && req.user.uid) || 'hr_support';
        const candidate1 = [senderId, recipientId].sort().join('_');
        const candidate2 = ['hr_support', recipientId].sort().join('_');

        const store = loadStore();
        const msgs = store.messages.filter(m => m.chatId === candidate1 || m.chatId === candidate2 || m.receiverId === recipientId);

        msgs.sort((a, b) => {
            const tA = new Date(normalizeTimestamp(a.timestamp)).getTime();
            const tB = new Date(normalizeTimestamp(b.timestamp)).getTime();
            return tA - tB;
        });

        res.json({ success: true, status: 'success', data: msgs });
    } catch (error) {
        res.status(500).json({ success: false, status: 'error', error: error.message });
    }
};

/**
 * POST /api/messages/send or POST /api/messages
 * Send message with dual local + Firestore persistence
 */
exports.sendMessage = async (req, res) => {
    try {
        const { recipientId, receiverId, text, chatId: clientChatId, senderId: clientSenderId, senderName: clientSenderName, senderRole, attachments } = req.body;
        const targetId = recipientId || receiverId;
        const senderId = clientSenderId || (req.user && (req.user.uid || req.user.id)) || 'hr_support';
        const senderName = clientSenderName || (req.user && (req.user.name || req.user.displayName)) || 'Super Admin';

        if ((!text && (!attachments || attachments.length === 0)) || (!targetId && !clientChatId)) {
            return res.status(400).json({ status: 'error', message: 'Recipient and text/attachments are required' });
        }

        const chatId = clientChatId || (targetId ? ['hr_support', targetId].sort().join('_') : 'general');
        const now = new Date().toISOString();
        const msgId = req.body.id || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));

        const messageData = {
            id: msgId,
            chatId,
            senderId,
            senderUid: senderId,
            senderName,
            senderRole: senderRole || 'admin',
            receiverId: targetId,
            recipientId: targetId,
            participants: req.body.participants || [senderId, targetId, 'hr_support'].filter(Boolean),
            text: text || '',
            attachments: attachments || [],
            timestamp: now,
            read: false,
            type: 'direct'
        };

        const store = loadStore();
        // Replace or push
        const existingIdx = store.messages.findIndex(m => m.id === msgId);
        if (existingIdx >= 0) {
            store.messages[existingIdx] = messageData;
        } else {
            store.messages.push(messageData);
        }
        saveStore(store);

        // Fire-and-forget background sync to Firestore
        (async () => {
            try {
                if (db && admin && admin.firestore) {
                    await db.collection('messages').doc(msgId).set({
                        ...messageData,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            } catch (_) {}
        })().catch(() => {});

        res.status(201).json({ success: true, status: 'success', message: 'Message sent', data: messageData });
    } catch (error) {
        res.status(500).json({ success: false, status: 'error', error: error.message });
    }
};

/**
 * POST /api/messages/broadcast
 */
exports.broadcastMessage = async (req, res) => {
    try {
        const { recipientIds, text, attachments } = req.body;
        const senderId = (req.user && (req.user.uid || req.user.id)) || 'hr_support';
        const senderName = (req.user && (req.user.name || req.user.displayName)) || 'Super Admin';

        if (!recipientIds || !Array.isArray(recipientIds) || (!text && (!attachments || attachments.length === 0))) {
            return res.status(400).json({ status: 'error', message: 'Recipients array and text are required' });
        }

        const store = loadStore();
        const now = new Date().toISOString();
        const createdMsgs = [];

        recipientIds.forEach(recipientId => {
            const chatId = ['hr_support', recipientId].sort().join('_');
            const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            const msgObj = {
                id: msgId,
                chatId,
                senderId,
                senderUid: senderId,
                senderName,
                senderRole: 'admin',
                receiverId: recipientId,
                recipientId,
                participants: [senderId, recipientId, 'hr_support'],
                text: text || '',
                attachments: attachments || [],
                timestamp: now,
                read: false,
                type: 'broadcast'
            };
            store.messages.push(msgObj);
            createdMsgs.push(msgObj);
        });

        saveStore(store);
        res.status(201).json({ success: true, status: 'success', message: `Broadcast sent to ${recipientIds.length} people`, count: createdMsgs.length });
    } catch (error) {
        res.status(500).json({ success: false, status: 'error', error: error.message });
    }
};

/**
 * POST /api/messages/clear/:chatId
 */
exports.clearChat = async (req, res) => {
    try {
        const { chatId } = req.params;
        const store = loadStore();
        store.messages = store.messages.filter(m => m.chatId !== chatId);
        saveStore(store);
        res.json({ success: true, message: 'Chat cleared successfully' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
