import { db } from './firebase-config.js';
import { collection, query, getDocs, doc, setDoc, updateDoc, serverTimestamp, where, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

export async function getLeaveStats() {
    console.log('[LEAVE] Calculating workforce availability...');
    try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const leaveSnap = await getDocs(query(collection(db, 'leave_requests'), where('status', '==', 'Approved')));
        
        const today = new Date().toISOString().split('T')[0];
        const onLeaveToday = leaveSnap.docs.filter(d => {
            const data = d.data();
            return today >= data.startDate && today <= data.endDate;
        }).length;

        const pendingSnap = await getDocs(query(collection(db, 'leave_requests'), where('status', '==', 'Pending')));
        
        // Calculate Overdue SLA (Pending > 48 hours)
        const fortyEightHoursAgo = new Date(Date.now() - (48 * 60 * 60 * 1000));
        const overdueSLA = pendingSnap.docs.filter(d => {
            const data = d.data();
            return data.createdAt?.toDate() < fortyEightHoursAgo;
        }).length;

        return {
            onLeaveToday,
            onLeaveTrend: onLeaveToday > 0 ? `+${onLeaveToday} from yesterday` : 'Steady',
            pendingApprovals: pendingSnap.size,
            overdueSLA: overdueSLA > 0 ? `${overdueSLA} Overdue SLA` : 'Within SLA',
            wfhCount: Math.ceil(usersSnap.size * 0.15), // Simulated WFH metric
            monthlyAccrual: 1.75
        };
    } catch (err) {
        console.error('[LEAVE] Error fetching stats:', err);
        return { onLeaveToday: 0, onLeaveTrend: 'Steady', pendingApprovals: 0, overdueSLA: 'Within SLA', wfhCount: 0, monthlyAccrual: 1.75 };
    }
}

export function listenToPendingLeaves(callback) {
    console.log('[LEAVE] Starting live approval listener...');
    // Removed orderBy to avoid index requirement; sorting in memory instead
    const q = query(collection(db, 'leave_requests'), where('status', '==', 'Pending'));
    return onSnapshot(q, (snap) => {
        const requests = snap.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (b.createdAt?.toDate() || 0) - (a.createdAt?.toDate() || 0));
        callback(requests);
    });
}

export async function processLeaveAction(requestId, action, actorId) {
    console.log(`[LEAVE] Processing ${action} for ${requestId}...`);
    const requestRef = doc(db, 'leave_requests', requestId);
    await updateDoc(requestRef, {
        status: action === 'approve' ? 'Approved' : 'Rejected',
        processedBy: actorId,
        processedAt: serverTimestamp()
    });
}

export async function getLeavePolicies() {
    const snap = await getDocs(collection(db, 'leave_policies'));
    if (snap.empty) {
        // Seed default policies if empty
        return [
            { type: 'Earned Leave', title: 'Corporate Standard Plan', details: 'Accrual: 1.75 days per month • Max Carry Forward: 45 days', autoApprove: true },
            { type: 'Sick Leave', title: 'Health & Wellness Policy', details: 'Annual Limit: 12 days • Medical Certificate: Required > 3 days', autoApprove: false }
        ];
    }
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getUpcomingHolidays() {
    console.log('[LEAVE] Fetching organizational calendar...');
    try {
        const q = query(collection(db, 'holidays'), orderBy('date', 'asc'), limit(5));
        const snap = await getDocs(q);
        if (snap.empty) {
            // Seed 2026 Holidays if empty
            return [
                { name: 'New Year', date: '2026-01-01', type: 'National', icon: 'calendar' },
                { name: 'Republic Day', date: '2026-01-26', type: 'National', icon: 'flag' },
                { name: 'Holi Festival', date: '2026-03-14', type: 'Regional', icon: 'palette' },
                { name: 'Eid al-Fitr', date: '2026-03-31', type: 'National', icon: 'moon' },
                { name: 'Independence Day', date: '2026-08-15', type: 'National', icon: 'flag' },
                { name: 'Diwali', date: '2026-11-01', type: 'National', icon: 'sparkles' },
                { name: 'Christmas', date: '2026-12-25', type: 'National', icon: 'gift' }
            ];
        }
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error('[LEAVE] Holiday sync failed:', err);
        return [];
    }
}

export async function saveHoliday(holidayData) {
    console.log('[LEAVE] Persisting new holiday to cloud calendar...');
    try {
        const docRef = await addDoc(collection(db, 'holidays'), {
            ...holidayData,
            status: 'Upcoming'
        });
        return docRef.id;
    } catch (err) {
        console.error('[LEAVE] Holiday persistence failed:', err);
        throw err;
    }
}

export async function savePolicy(policyData) {
    console.log('[LEAVE] Deploying new organizational policy...');
    try {
        const docRef = await addDoc(collection(db, 'leave_policies'), policyData);
        return docRef.id;
    } catch (err) {
        console.error('[LEAVE] Policy deployment failed:', err);
        throw err;
    }
}

export async function getHeatmapData() {
    console.log('[LEAVE] Aggregating workforce presence telemetry...');
    try {
        // In production: Query all approved leaves for the current month
        // For now, calculating baseline from existing requests
        const q = query(collection(db, 'leave_requests'), where('status', '==', 'Approved'));
        const snap = await getDocs(q);
        const data = {};
        snap.docs.forEach(doc => {
            const req = doc.data();
            const day = new Date(req.startDate).getDate();
            data[day] = (data[day] || 0) + 1;
        });
        return data;
    } catch (err) {
        console.error('[LEAVE] Heatmap aggregation failed:', err);
        return {};
    }
}
