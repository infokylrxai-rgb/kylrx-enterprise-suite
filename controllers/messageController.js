const { db, admin } = require('../config/firebase');

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
 * Fast retrieval for deterministic chatId from Firestore 'messages' collection
 */
exports.getThreadMessages = async (req, res) => {
    try {
        const rawParam = req.params.chatId || '';
        const targetIds = rawParam.split(',').map(s => s.trim()).filter(Boolean);

        const isMarryAdminQuery = targetIds.some(t => 
            (t.includes('hr_support') || t.includes('ADMIN')) && 
            (t.includes('EMP_1789230184645') || t.toLowerCase().includes('marry'))
        );

        const snapshot = await db.collection('messages').get();
        let msgs = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            msgs.push({ id: doc.id, ...data });
        });

        msgs = msgs.filter(m => {
            if (targetIds.includes(m.chatId)) return true;
            if (isMarryAdminQuery) {
                const hasAdmin = m.chatId?.includes('hr_support') || m.chatId?.includes('ADMIN') || 
                                 m.senderId === 'hr_support' || m.receiverId === 'hr_support' || m.senderRole === 'admin';
                const hasMarry = m.chatId?.includes('EMP_1789230184645') || m.chatId?.toLowerCase().includes('marry') ||
                                 m.senderId === 'EMP_1789230184645' || m.receiverId === 'EMP_1789230184645' ||
                                 (m.senderName && m.senderName.toLowerCase().includes('marry')) ||
                                 (m.senderId && m.senderId.toLowerCase().includes('marry'));
                if (hasAdmin && hasMarry) return true;
            }
            for (const t of targetIds) {
                if (t.includes('_')) {
                    const parts = t.split('_');
                    if (parts.length === 2) {
                        const [p1, p2] = parts;
                        if (m.chatId === `${p2}_${p1}`) return true;
                        if ((m.senderId === p1 && (m.receiverId === p2 || m.recipientId === p2)) ||
                            (m.senderId === p2 && (m.receiverId === p1 || m.recipientId === p1))) return true;
                    }
                }
            }
            return false;
        });

        // Deduplicate messages by id
        const seenIds = new Set();
        msgs = msgs.filter(m => {
            const key = m.id || `${m.timestamp}_${m.text}`;
            if (seenIds.has(key)) return false;
            seenIds.add(key);
            return true;
        });

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
 * Retrieval from Firestore 'messages' collection
 */
exports.getMessages = async (req, res) => {
    try {
        const { recipientId } = req.params;
        const senderId = (req.user && req.user.uid) || 'hr_support';
        const candidate1 = [senderId, recipientId].sort().join('_');
        const candidate2 = ['hr_support', recipientId].sort().join('_');

        const snapshot = await db.collection('messages').get();
        let msgs = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            msgs.push({ id: doc.id, ...data });
        });

        msgs = msgs.filter(m => m.chatId === candidate1 || m.chatId === candidate2 || m.receiverId === recipientId);

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
 * Send message with Firestore persistence
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

        await db.collection('messages').doc(msgId).set(messageData);

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

        const now = new Date().toISOString();
        const createdMsgs = [];
        const batch = (typeof db.batch === 'function') ? db.batch() : null;

        for (const recipientId of recipientIds) {
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
            createdMsgs.push(msgObj);
            if (batch) {
                batch.set(db.collection('messages').doc(msgId), msgObj);
            } else {
                await db.collection('messages').doc(msgId).set(msgObj);
            }
        }

        if (batch) {
            await batch.commit();
        }

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
        const snapshot = await db.collection('messages').where('chatId', '==', chatId).get();
        if (snapshot && snapshot.docs && snapshot.docs.length > 0) {
            const batch = (typeof db.batch === 'function') ? db.batch() : null;
            for (const doc of snapshot.docs) {
                if (batch) {
                    batch.delete(doc.ref || db.collection('messages').doc(doc.id));
                } else if (doc.ref && typeof doc.ref.delete === 'function') {
                    await doc.ref.delete();
                } else {
                    await db.collection('messages').doc(doc.id).delete();
                }
            }
            if (batch) await batch.commit();
        }
        res.json({ success: true, message: 'Chat cleared successfully' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
