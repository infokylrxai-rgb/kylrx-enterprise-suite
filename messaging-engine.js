/**
 * HRFlow Enterprise Messaging Engine v2.0
 * Supports: 1:1, 1:Many (Broadcast), Many:Many (Groups)
 * Firebase Firestore Free Tier Optimized
 * Role-Based Access Control (Employee | Manager | HRMS | Admin)
 */

import { db, auth } from './firebase-config.js';
import {
    collection, doc, addDoc, setDoc, getDoc, getDocs,
    onSnapshot, query, where, orderBy, limit,
    serverTimestamp, updateDoc, arrayUnion, arrayRemove,
    deleteField, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js';

// ─────────────────────────────────────────────
// ROLE PERMISSION MAP
// ─────────────────────────────────────────────
const ROLE_PERMISSIONS = {
    admin:    { canBroadcast: true,  canAccessAll: true,  canManageGroups: true,  canDM: true  },
    hrms:     { canBroadcast: true,  canAccessAll: false, canManageGroups: true,  canDM: true  },
    hr:       { canBroadcast: true,  canAccessAll: false, canManageGroups: true,  canDM: true  },
    manager:  { canBroadcast: false, canAccessAll: false, canManageGroups: true,  canDM: true  },
    employee: { canBroadcast: false, canAccessAll: false, canManageGroups: false, canDM: true  },
};

export function getPermissions(role) {
    const r = (role || 'employee').toLowerCase();
    return ROLE_PERMISSIONS[r] || ROLE_PERMISSIONS.employee;
}

// ─────────────────────────────────────────────
// ONLINE PRESENCE
// ─────────────────────────────────────────────
export async function setOnlineStatus(userId, isOnline) {
    if (!userId) return;
    try {
        await setDoc(doc(db, 'user_presence', userId), {
            online: isOnline,
            lastSeen: serverTimestamp(),
            userId
        }, { merge: true });
    } catch (e) { console.warn('Presence update failed:', e); }
}

export function listenPresence(userId, callback) {
    if (!userId) return () => {};
    return onSnapshot(doc(db, 'user_presence', userId), snap => {
        callback(snap.exists() ? snap.data() : { online: false });
    });
}

// ─────────────────────────────────────────────
// TYPING INDICATORS
// ─────────────────────────────────────────────
let typingTimer = null;
export async function setTypingIndicator(conversationId, userId, isTyping) {
    if (!conversationId || !userId) return;
    clearTimeout(typingTimer);
    try {
        await setDoc(doc(db, 'typing_indicators', conversationId), {
            [userId]: isTyping ? serverTimestamp() : deleteField()
        }, { merge: true });
        if (isTyping) {
            typingTimer = setTimeout(() => setTypingIndicator(conversationId, userId, false), 3000);
        }
    } catch (e) {}
}

export function listenTyping(conversationId, currentUserId, callback) {
    if (!conversationId) return () => {};
    return onSnapshot(doc(db, 'typing_indicators', conversationId), snap => {
        if (!snap.exists()) { callback([]); return; }
        const data = snap.data();
        const typingUsers = Object.keys(data).filter(uid => uid !== currentUserId);
        callback(typingUsers);
    });
}

// ─────────────────────────────────────────────
// CONVERSATION MANAGEMENT
// ─────────────────────────────────────────────
export function buildConversationId(uid1, uid2) {
    return [uid1, uid2].sort().join('__');
}

export async function ensureConversation(uid1, uid2, meta = {}) {
    const convId = buildConversationId(uid1, uid2);
    const ref = doc(db, 'conversations', convId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
        await setDoc(ref, {
            type: 'direct',
            participants: [uid1, uid2],
            createdAt: serverTimestamp(),
            lastMessage: '',
            lastMessageAt: serverTimestamp(),
            unread: { [uid1]: 0, [uid2]: 0 },
            ...meta
        });
    }
    return convId;
}

export async function createGroupConversation(name, members, creatorId, role = 'group') {
    const ref = await addDoc(collection(db, 'conversations'), {
        type: role, // 'group' | 'department' | 'broadcast'
        name,
        members,
        createdBy: creatorId,
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        unreadCount: 0
    });
    return ref.id;
}

export function listenConversations(userId, role, callback) {
    const perms = getPermissions(role);
    let q;
    if (perms.canAccessAll) {
        // Admin sees ALL conversations
        q = query(
            collection(db, 'conversations'),
            orderBy('lastMessageAt', 'desc'),
            limit(50)
        );
    } else {
        // Others see their own
        q = query(
            collection(db, 'conversations'),
            where('participants', 'array-contains', userId),
            orderBy('lastMessageAt', 'desc'),
            limit(50)
        );
    }
    return onSnapshot(q, snap => {
        const convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(convs);
    });
}

// Listen group conversations (by member UID)
export function listenGroupConversations(userId, callback) {
    const q = query(
        collection(db, 'conversations'),
        where('members', 'array-contains', userId),
        orderBy('lastMessageAt', 'desc'),
        limit(30)
    );
    return onSnapshot(q, snap => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

// ─────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────
export async function sendMessage(conversationId, senderId, senderName, senderRole, text, extra = {}) {
    if (!text?.trim() && !extra.attachments?.length) return null;
    const batch = writeBatch(db);

    const msgRef = doc(collection(db, 'conversations', conversationId, 'messages'));
    batch.set(msgRef, {
        senderId,
        senderName,
        senderRole,
        text: text || '',
        timestamp: serverTimestamp(),
        read: false,
        readBy: [senderId],
        delivered: true,
        ...extra
    });

    // Update conversation metadata
    batch.update(doc(db, 'conversations', conversationId), {
        lastMessage: (text || '[Attachment]').slice(0, 80),
        lastMessageAt: serverTimestamp(),
        lastSenderId: senderId,
        [`unread.${senderId}`]: 0 // reset sender's own unread
    });

    await batch.commit();
    return msgRef.id;
}

export async function sendBroadcast(senderId, senderName, senderRole, text, targetRole, departmentId = null) {
    // Broadcast creates a message in a shared broadcast channel
    const perms = getPermissions(senderRole);
    if (!perms.canBroadcast) return null;

    const broadcastRef = await addDoc(collection(db, 'broadcasts'), {
        senderId,
        senderName,
        senderRole,
        text,
        targetRole: targetRole || 'all',
        departmentId: departmentId || null,
        timestamp: serverTimestamp(),
        readBy: [senderId]
    });

    // Push notification to relevant users
    await addDoc(collection(db, 'notifications'), {
        type: 'broadcast',
        title: `Announcement from ${senderName}`,
        body: text.slice(0, 100),
        targetRole: targetRole || 'all',
        departmentId: departmentId || null,
        senderId,
        broadcastId: broadcastRef.id,
        timestamp: serverTimestamp(),
        readBy: []
    });

    return broadcastRef.id;
}

export function listenMessages(conversationId, callback, msgLimit = 80) {
    const q = query(
        collection(db, 'conversations', conversationId, 'messages'),
        orderBy('timestamp', 'asc'),
        limit(msgLimit)
    );
    return onSnapshot(q, snap => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

export async function markMessagesRead(conversationId, userId) {
    try {
        const q = query(
            collection(db, 'conversations', conversationId, 'messages'),
            where('read', '==', false)
        );
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        snap.docs.forEach(d => {
            if (!d.data().readBy?.includes(userId)) {
                batch.update(d.ref, {
                    read: true,
                    readBy: arrayUnion(userId)
                });
            }
        });
        // Reset unread counter
        batch.update(doc(db, 'conversations', conversationId), {
            [`unread.${userId}`]: 0
        });
        await batch.commit();
    } catch (e) {}
}

// ─────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────
export async function sendNotification(toUserId, title, body, type = 'message', extra = {}) {
    try {
        await addDoc(collection(db, 'notifications'), {
            toUserId,
            title,
            body,
            type, // 'message' | 'leave' | 'attendance' | 'broadcast' | 'system' | 'alert'
            read: false,
            timestamp: serverTimestamp(),
            ...extra
        });
    } catch (e) {}
}

export function listenNotifications(userId, role, callback) {
    const perms = getPermissions(role);
    // Base user-specific notifications
    const q = query(
        collection(db, 'notifications'),
        where('toUserId', '==', userId),
        orderBy('timestamp', 'desc'),
        limit(30)
    );
    return onSnapshot(q, snap => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

export function listenBroadcasts(userId, userRole, userDept, callback) {
    // Listen to broadcasts targeting this role or 'all'
    const role = (userRole || 'employee').toLowerCase();
    const q = query(
        collection(db, 'broadcasts'),
        orderBy('timestamp', 'desc'),
        limit(20)
    );
    return onSnapshot(q, snap => {
        const broadcasts = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(b => {
                if (b.targetRole === 'all') return true;
                if (b.targetRole === role) return true;
                if (b.senderId === userId) return true;
                return false;
            });
        callback(broadcasts);
    });
}

export async function markNotificationRead(notifId) {
    try {
        await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch (e) {}
}

// ─────────────────────────────────────────────
// USER DIRECTORY
// ─────────────────────────────────────────────
export function listenUserDirectory(currentUserId, role, callback) {
    const perms = getPermissions(role);
    const q = query(collection(db, 'users'), limit(200));
    return onSnapshot(q, snap => {
        const users = snap.docs
            .map(d => ({ uid: d.id, ...d.data() }))
            .filter(u => {
                if (u.uid === currentUserId) return false;
                if (!perms.canAccessAll && role === 'employee') {
                    // Employees see only their dept + managers + HR
                    return true; // liberal for now; scope by department in production
                }
                return true;
            });
        callback(users);
    });
}

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────
export function formatTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export function stringToColor(str) {
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e', '#84cc16'];
    let hash = 0;
    for (let i = 0; i < (str || '').length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

export function getRoleBadgeStyle(role) {
    const styles = {
        admin:    { bg: '#fef3c7', color: '#b45309', label: 'Admin' },
        hrms:     { bg: '#ede9fe', color: '#7c3aed', label: 'HRMS' },
        hr:       { bg: '#ede9fe', color: '#7c3aed', label: 'HR' },
        manager:  { bg: '#fee2e2', color: '#dc2626', label: 'Manager' },
        employee: { bg: '#dcfce7', color: '#16a34a', label: 'Employee' },
    };
    return styles[(role || '').toLowerCase()] || styles.employee;
}
