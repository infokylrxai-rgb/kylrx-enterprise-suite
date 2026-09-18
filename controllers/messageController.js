const fs = require('fs');
const path = require('path');
const { db, admin } = require('../config/firebase');

const USER_DIR = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\user';
const ROOT_DATA_DIR = path.join(USER_DIR, '.kylrx_enterprise_data');
if (!fs.existsSync(ROOT_DATA_DIR)) {
    try { fs.mkdirSync(ROOT_DATA_DIR, { recursive: true }); } catch (_) {}
}
const STORE_PATH = path.join(ROOT_DATA_DIR, 'messages_store.json');

// Initialize or migrate existing data if needed
function loadStore() {
    try {
        if (!fs.existsSync(STORE_PATH)) {
            // Check if legacy file exists to migrate
            const legacyPath = path.join(__dirname, '..', '..', 'data', 'messages_store.json');
            if (fs.existsSync(legacyPath)) {
                try {
                    const legacyData = fs.readFileSync(legacyPath, 'utf8');
                    fs.writeFileSync(STORE_PATH, legacyData);
                    return JSON.parse(legacyData);
                } catch (_) {}
            }
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
        const rawParam = req.params.chatId || '';
        const targetIds = rawParam.split(',').map(s => s.trim()).filter(Boolean);
        const store = loadStore();

        const isMarryAdminQuery = targetIds.some(t => 
            (t.includes('hr_support') || t.includes('ADMIN')) && 
            (t.includes('EMP_1789230184645') || t.toLowerCase().includes('marry'))
        );

        let msgs = store.messages.filter(m => {
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
