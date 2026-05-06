import { auth, db } from "./firebase-config.js";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, orderBy, limit, updateDoc, doc, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// --- Notification Logic ---
export async function sendNotification(targetId, title, message, type = 'info', isDepartment = false) {
    try {
        const notificationData = {
            title,
            message,
            type,
            read: false,
            createdAt: serverTimestamp()
        };

        if (isDepartment) {
            notificationData.departmentId = targetId;
        } else {
            notificationData.userId = targetId;
        }

        await addDoc(collection(db, 'notifications'), notificationData);
    } catch (err) {
        console.error('Error sending notification:', err);
    }
}

export function listenNotifications() {
    const userId = auth.currentUser ? auth.currentUser.uid : localStorage.getItem('hr_user_id');
    const userDept = localStorage.getItem('userDept'); // For manager department filtering
    const userRole = localStorage.getItem('userRole'); // 'manager' or 'employee'

    const notifDot = document.getElementById('notifDot') || document.querySelector('.notif-dot');
    const notifList = document.getElementById('notifList');

    if (!userId || (!auth.currentUser && !userId.startsWith('demo_'))) {
        console.log('Skipping live notifications (No active Firebase session)');
        if (notifList) notifList.innerHTML = '<div class="notif-empty" style="padding:1rem; text-align:center; color:var(--text-muted);">Notifications (Demo Mode)</div>';
        return;
    }
    
    // Build query based on role
    let q;
    if (userRole === 'manager' && userDept) {
        // Managers see notifications for their department
        q = query(
            collection(db, 'notifications'),
            where('departmentId', '==', userDept),
            limit(10)
        );
    } else if (userRole === 'admin') {
        // Admin sees global 'admin' notifications
        q = query(
            collection(db, 'notifications'),
            where('departmentId', '==', 'admin'),
            limit(10)
        );
    } else {
        // Employees only see their own specific notifications
        q = query(
            collection(db, 'notifications'),
            where('userId', '==', userId),
            limit(10)
        );
    }

    if (!auth.currentUser) return; // Final guard before Firestore call

    return onSnapshot(q, (snapshot) => {
        const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const unreadCount = notifications.filter(n => !n.read).length;

        // Update dot/badge
        if (notifDot) {
            if (unreadCount > 0) {
                notifDot.style.display = 'block';
                notifDot.textContent = unreadCount > 9 ? '9+' : unreadCount;
                if (!notifDot.classList.contains('active')) notifDot.classList.add('active');
            } else {
                notifDot.style.display = 'none';
                notifDot.classList.remove('active');
            }
        }

        // Update list
        if (notifList) {
            if (notifications.length === 0) {
                notifList.innerHTML = '<div class="notif-empty" style="padding:1rem; text-align:center; color:var(--text-muted);">No notifications</div>';
                return;
            }

            notifList.innerHTML = notifications.map(n => `
                <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markAsRead('${n.id}')" style="cursor:pointer; ${!n.read ? 'background: var(--primary-light);' : ''}">
                    <div class="notif-img" style="background:${getNotifColor(n.type)}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:0.8rem;">
                        ${getNotifIcon(n.type)}
                    </div>
                    <div class="notif-body" style="flex:1;">
                        <div class="notif-text"><b>${n.title}</b></div>
                        <div class="notif-msg" style="font-size:0.75rem; color:var(--text-muted);">${n.message}</div>
                        <div class="notif-time" style="font-size:0.65rem; color:var(--text-muted); margin-top:2px;">${formatTime(n.createdAt)}</div>
                    </div>
                </div>
            `).join('');
            
            if (window.lucide) { lucide.createIcons(); }
        }
    }, (err) => {
        const userId = localStorage.getItem('hr_user_id');
        if (!userId || !userId.startsWith('demo_')) {
            console.warn('Notification snapshot listener failed (likely missing index or permissions):', err.message);
        }
        if (notifList) {
            notifList.innerHTML = '<div class="notif-empty" style="padding:1rem; text-align:center; color:var(--text-muted);">Notifications unavailable (Local Mode)</div>';
        }
    });
}

function getNotifColor(type) {
    switch (type) {
        case 'task': return 'var(--primary)';
        case 'leave': return 'var(--warning)';
        case 'payroll': return 'var(--success)';
        default: return 'var(--text-muted)';
    }
}

function getNotifIcon(type) {
    switch (type) {
        case 'task': return '<i data-lucide="check-square" size="14"></i>';
        case 'leave': return '<i data-lucide="calendar" size="14"></i>';
        case 'payroll': return '<i data-lucide="banknote" size="14"></i>';
        default: return '<i data-lucide="bell" size="14"></i>';
    }
}

function formatTime(timestamp) {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate();
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

window.markAsRead = async (notifId) => {
    try {
        await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch (err) {
        console.error('Error marking as read:', err);
    }
};

window.markAllAsRead = async () => {
    const userId = auth.currentUser ? auth.currentUser.uid : localStorage.getItem('hr_user_id');
    const q = query(collection(db, 'notifications'), where('userId', '==', userId), where('read', '==', false));
    const snap = await getDocs(q);
    const batch = snap.docs.map(d => updateDoc(d.ref, { read: true }));
    await Promise.all(batch);
};

// Initialize listeners
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure auth is ready
    setTimeout(() => {
        listenNotifications();
        
        // Handle dropdown toggle if elements exist
        const btnNotif = document.getElementById('btnNotif');
        const notifDropdown = document.getElementById('notifDropdown');
        if (btnNotif && notifDropdown) {
            btnNotif.addEventListener('click', (e) => {
                e.stopPropagation();
                notifDropdown.classList.toggle('active');
            });
            document.addEventListener('click', () => notifDropdown.classList.remove('active'));
        }
    }, 1000);
});

