const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { db, admin, messaging } = require('../config/firebase');

// Persistent storage outside workspace so writes never trigger Live Server reloads
const USER_DIR = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\user';
const ROOT_DATA_DIR = path.join(USER_DIR, '.kylrx_enterprise_data');
if (!fs.existsSync(ROOT_DATA_DIR)) {
    try { fs.mkdirSync(ROOT_DATA_DIR, { recursive: true }); } catch (_) {}
}
const STORE_PATH = path.join(ROOT_DATA_DIR, 'notifications_store.json');

function loadStore() {
    try {
        if (!fs.existsSync(STORE_PATH)) {
            fs.writeFileSync(STORE_PATH, JSON.stringify({ notifications: [] }, null, 2));
            return { notifications: [] };
        }
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    } catch (e) {
        return { notifications: [] };
    }
}

function saveStore(data) {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Failed to write notifications store:', e);
    }
}

function normalizeTimestamp(ts) {
    if (!ts) return new Date().toISOString();
    if (typeof ts === 'string') return ts;
    if (typeof ts === 'number') return new Date(ts).toISOString();
    if (ts.seconds || ts._seconds) {
        const secs = ts.seconds || ts._seconds;
        return new Date(secs * 1000).toISOString();
    }
    if (typeof ts.toDate === 'function') {
        try { return ts.toDate().toISOString(); } catch (_) {}
    }
    return new Date().toISOString();
}

function normalizeNotification(id, d) {
    const title = d.title || (d.priority ? `${d.priority.toUpperCase()} ALERT` : 'System Notification');
    const text = d.message || d.text || d.desc || d.body || 'No details provided.';
    const timestamp = normalizeTimestamp(d.timestamp || d.created_at || d.createdAt);
    const read = d.read === true;
    const priority = (d.priority || 'normal').toLowerCase();
    const target = d.target || d.targetUid || d.userId || 'all';
    const category = d.category || d.type || 'system';

    return {
        id,
        title,
        text,
        message: text,
        timestamp,
        read,
        priority,
        target,
        targetUid: d.targetUid || target,
        recipient_role: d.recipient_role || d.targetRole || d.role || '',
        category,
        entity_id: d.entity_id || '',
        clearedBy: Array.isArray(d.clearedBy) ? d.clearedBy : []
    };
}

// 1. GET /api/notifications - Real-time notification feed for Employee / User
router.get(['/', '/feed'], async (req, res) => {
    try {
        const uid = req.query.uid || 'demo_emp';
        const role = (req.query.role || 'employee').toLowerCase();
        const dept = (req.query.department || '').toLowerCase();
        
        // Build candidate user IDs for matching
        const candidateUids = [uid];
        if (uid.toLowerCase().includes('marry') || uid === 'EMP_1789230184645' || uid === 'ZnaGIFv88QRD8AD4xTJOJ1KZinE2') {
            candidateUids.push('EMP_1789230184645', 'ZnaGIFv88QRD8AD4xTJOJ1KZinE2', 'demo_emp');
        }

        let firestoreDocs = [];
        try {
            if (db && typeof db.collection === 'function') {
                const snap = await db.collection('notifications').get();
                snap.forEach(docSnap => {
                    firestoreDocs.push({ id: docSnap.id, data: docSnap.data() });
                });
            }
        } catch (dbErr) {
            console.warn('[NotificationsAPI] Direct Firestore read notice:', dbErr.message);
        }

        // Merge with local persistent store
        const store = loadStore();
        const storeMap = new Map();
        (store.notifications || []).forEach(n => storeMap.set(n.id, n));

        firestoreDocs.forEach(fd => {
            const normalized = normalizeNotification(fd.id, fd.data);
            storeMap.set(fd.id, normalized);
        });

        const mergedAll = Array.from(storeMap.values());
        // Save back merged results
        saveStore({ notifications: mergedAll.slice(-200) });

        // Filter for this user
        const matched = mergedAll.filter(n => {
            const cleared = n.clearedBy || [];
            if (cleared.some(c => candidateUids.includes(c))) return false;

            const t = (n.target || '').toLowerCase();
            const r = (n.recipient_role || '').toLowerCase();

            const isGlobal = t === 'employee' || t === 'all' || t === 'global' || t === 'all-employees' || r === 'employee' || r === role;
            const isDirect = candidateUids.some(cand => 
                n.target === cand || 
                n.targetUid === cand || 
                (n.userId && n.userId === cand)
            );
            const isDept = dept && t === dept;

            return isGlobal || isDirect || isDept;
        });

        // Sort newest first
        matched.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        res.status(200).json({
            success: true,
            count: matched.length,
            data: matched
        });
    } catch (error) {
        console.error('[NotificationsAPI] Error serving notifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. POST /api/notifications/read/:id - Mark single notification as read
router.post('/read/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const store = loadStore();
        const item = (store.notifications || []).find(n => n.id === id);
        if (item) {
            item.read = true;
            saveStore(store);
        }

        // Update Firestore asynchronously
        if (db && typeof db.collection === 'function') {
            db.collection('notifications').doc(id).update({ read: true }).catch(() => {});
        }

        res.status(200).json({ success: true, message: 'Notification marked as read' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. POST /api/notifications/read-all - Mark all unread notifications as read
router.post('/read-all', async (req, res) => {
    try {
        const uid = req.body.uid || 'demo_emp';
        const candidateUids = [uid, 'EMP_1789230184645', 'ZnaGIFv88QRD8AD4xTJOJ1KZinE2'];

        const store = loadStore();
        const updatedIds = [];
        (store.notifications || []).forEach(n => {
            const t = (n.target || '').toLowerCase();
            const isMatch = t === 'employee' || t === 'all' || t === 'global' || candidateUids.includes(n.target) || candidateUids.includes(n.targetUid);
            if (isMatch && !n.read) {
                n.read = true;
                updatedIds.push(n.id);
            }
        });
        saveStore(store);

        // Update Firestore asynchronously
        if (db && typeof db.collection === 'function') {
            updatedIds.forEach(id => {
                db.collection('notifications').doc(id).update({ read: true }).catch(() => {});
            });
        }

        res.status(200).json({ success: true, updatedCount: updatedIds.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. POST /api/notifications/clear/:id - Clear/delete notification for user
router.post('/clear/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const uid = req.body.uid || 'demo_emp';

        const store = loadStore();
        const item = (store.notifications || []).find(n => n.id === id);
        if (item) {
            item.clearedBy = item.clearedBy || [];
            if (!item.clearedBy.includes(uid)) item.clearedBy.push(uid);
            saveStore(store);
        }

        // Update Firestore asynchronously
        if (db && typeof db.collection === 'function') {
            db.collection('notifications').doc(id).update({
                clearedBy: admin.firestore.FieldValue.arrayUnion(uid)
            }).catch(() => {});
        }

        res.status(200).json({ success: true, message: 'Notification cleared' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. POST /api/notifications/clear-all - Clear all notifications for user
router.post('/clear-all', async (req, res) => {
    try {
        const uid = req.body.uid || 'demo_emp';
        const candidateUids = [uid, 'EMP_1789230184645', 'ZnaGIFv88QRD8AD4xTJOJ1KZinE2'];

        const store = loadStore();
        const clearedIds = [];
        (store.notifications || []).forEach(n => {
            n.clearedBy = n.clearedBy || [];
            if (!n.clearedBy.includes(uid)) {
                n.clearedBy.push(uid);
                clearedIds.push(n.id);
            }
        });
        saveStore(store);

        // Update Firestore asynchronously
        if (db && typeof db.collection === 'function') {
            clearedIds.forEach(id => {
                db.collection('notifications').doc(id).update({
                    clearedBy: admin.firestore.FieldValue.arrayUnion(uid)
                }).catch(() => {});
            });
        }

        res.status(200).json({ success: true, clearedCount: clearedIds.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 6. POST /api/notifications/send - Send new notification
router.post('/send', async (req, res) => {
    try {
        const notifData = req.body;
        const id = notifData.id || ('notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
        const normalized = normalizeNotification(id, notifData);

        const store = loadStore();
        store.notifications = store.notifications || [];
        store.notifications.unshift(normalized);
        saveStore({ notifications: store.notifications.slice(0, 200) });

        if (db && typeof db.collection === 'function') {
            db.collection('notifications').doc(id).set({
                ...normalized,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }).catch(() => {});
        }

        res.status(200).json({ success: true, data: normalized });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 7. Legacy notify & push endpoints (Preserved)
router.post('/notify', async (req, res) => {
    let { title, message } = req.body;
    title = title?.trim();
    message = message?.trim();

    if (!title || !message) {
        return res.status(400).json({ success: false, message: 'Title and Message cannot be empty' });
    }

    try {
        if (messaging && typeof messaging.send === 'function') {
            await messaging.send({
                notification: { title, body: message },
                topic: 'announcements'
            });
        }
        res.status(200).json({ success: true, message: 'Notification sent successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/send-notification', async (req, res) => {
    const { title, body, topic } = req.body;
    try {
        if (messaging && typeof messaging.send === 'function') {
            await messaging.send({
                notification: { title, body },
                topic: topic || 'all-employees'
            });
        }
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
