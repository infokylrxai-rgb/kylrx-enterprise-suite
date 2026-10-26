/**
 * Per-user read state and audience matching for notifications. Pure functions (no Firebase, no
 * DOM) so the pages and the unit tests share one implementation.
 *
 * Read state: a notification is read for a user when the user's uid is in `readBy` (an array
 * the user adds to or removes from, like `clearedBy`). Notifications written before `readBy`
 * existed carry the shared flag `read === true`; that still counts as read for everyone.
 */

export const isRead = (n, uid) => !!n && (n.read === true || (Array.isArray(n.readBy) && n.readBy.includes(uid)));

export const isUnread = (n, uid) => !isRead(n, uid);

// A notification that is read only because of the old shared flag cannot be marked unread for one user
export const canMarkUnread = (n) => !!n && n.read !== true;

export const unreadCount = (list, uid) => list.filter(n => isUnread(n, uid)).length;

// The notification as the page should show it right after the user marks it read or unread
export function withReadState(n, uid, read) {
    const others = (Array.isArray(n.readBy) ? n.readBy : []).filter(x => x !== uid);
    return { ...n, readBy: read ? [...others, uid] : others };
}

// Firestore allows at most 500 writes in one batch
export function chunk(items, size = 500) {
    const parts = [];
    for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
    return parts;
}

const normalizeRole = (role) => String(role || '').trim().toLowerCase().replace(/\s+/g, '_');

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'superadmin', 'hrms', 'hr', 'hr_admin', 'hr_payroll']);

// Audience names a notification's `target` / `recipient_role` can use for each kind of user
const AUDIENCES = {
    admin: ['admin', 'admins', 'admin_hr', 'super_admin', 'superadmin', 'hrms', 'hr', 'hr_admin', 'hr_payroll'],
    manager: ['manager', 'managers'],
    employee: ['employee', 'employees', 'all-employees', 'global']
};
const EVERYONE = ['all', 'enterprise'];
const PERSON_FIELDS = ['targetUid', 'userId', 'recipient_id', 'receiverId', 'employeeId', 'managerId'];

function listOf(value) {
    if (Array.isArray(value)) return value.map(String);
    if (value === undefined || value === null || value === '') return [];
    return String(value).split(/[,\s]+/).filter(Boolean);
}

/**
 * True when the notification is meant for this user: addressed to the user, to their role, or to
 * everyone ("all"). Written by the user counts too, so an admin sees the broadcasts they sent.
 * A notification with no audience at all is a system notice for admin roles only.
 */
export function isTargetedTo(n, { uid, role } = {}) {
    if (!n) return false;
    const mine = normalizeRole(role);
    const kind = ADMIN_ROLES.has(mine) ? 'admin' : (mine === 'manager' ? 'manager' : 'employee');

    if (uid && (n.createdByUid === uid || PERSON_FIELDS.some(f => n[f] === uid))) return true;

    const audience = [...listOf(n.target), ...listOf(n.recipient_role), ...listOf(n.targetRole)].map(x => x.toLowerCase());
    if (uid && audience.includes(String(uid).toLowerCase())) return true;
    if (audience.length === 0) return kind === 'admin';
    return audience.some(a => EVERYONE.includes(a) || AUDIENCES[kind].includes(a));
}

// HRMS inbox: notifications addressed to HRMS, and employee help requests
export function isHrmsNotification(n) {
    if (!n) return false;
    const tgt = String(n.target || n.departmentId || '').toLowerCase();
    const type = String(n.type || '').toLowerCase();
    return tgt === 'hrms' || type === 'employee_help' || type === 'employee_help_approved';
}

/**
 * Manager inbox: notices for managers, for this manager, their command center or department,
 * general or untargeted notices, and employee help requests.
 */
export function isManagerNotification(n, { uid = '', centerId = '', dept = '' } = {}) {
    if (!n) return false;
    const tgt = String(n.target || n.departmentId || '').toLowerCase();
    const type = String(n.type || '').toLowerCase();
    const mine = [uid, centerId, dept].map(x => String(x || '').toLowerCase()).filter(Boolean);
    return tgt === 'manager' || type === 'employee_help' || tgt === 'general' || !tgt || mine.includes(tgt);
}
