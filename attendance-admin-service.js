/**
 * Admin Attendance Monitor client service.
 *
 * All reads and writes go through the backend (/api/attendance-admin), which keeps each
 * organization's attendance separate and responds only after Firestore confirmed a write.
 * The page subscribes to one overview (employees, daily logs, manual records,
 * regularizations, shifts, holidays, weekly off) that is refreshed every 30 seconds and
 * right after every save.
 */
import { createApi, createOverviewStore, getWriteStatus, localDateStr } from './admin-api.js';

export { getWriteStatus, localDateStr };

const api = createApi('/api/attendance-admin');
const store = createOverviewStore(async () => (await api('/overview')).data);

// Punch times are wall-clock times in the browser's time zone
const withTz = (body) => ({ ...body, tzOffsetMinutes: new Date().getTimezoneOffset() });

export const refreshOverview = store.refresh;
export const subscribeOverview = store.subscribe;
export const getOverview = store.get;

/** Today's figures for the KPI cards, from this organization's daily logs */
export function computeStats(logs) {
    const today = localDateStr(new Date());
    let activeLogin = 0, lateLogin = 0, missingPunch = 0, onFieldWfh = 0;
    (logs || []).filter(l => l.date === today).forEach(l => {
        if (l.punchIn && !l.punchOut) activeLogin++;
        if (l.status === 'Late') lateLogin++;
        if (l.status === 'Missing' || (!l.punchIn && !l.punchOut && l.status !== 'Absent')) missingPunch++;
        if (l.type === 'On Field' || l.type === 'WFH') onFieldWfh++;
    });
    return { activeLogin, lateLogin, missingPunch, onFieldWfh };
}

/** Record or adjust one employee's attendance for a day */
export function recordAttendance(data) {
    return store.afterWrite(api('/records', { method: 'POST', body: withTz(data) }));
}

/** Raise a correction request for an employee */
export function raiseRegularization(data) {
    return store.afterWrite(api('/regularizations', { method: 'POST', body: data }));
}

/** Approve or reject a pending correction request */
export function decideRegularization(id, action, comment = '') {
    return store.afterWrite(api(`/regularizations/${encodeURIComponent(id)}/decision`, { method: 'POST', body: withTz({ action, comment }) }));
}

export function addShift(data) {
    return store.afterWrite(api('/shifts', { method: 'POST', body: data }));
}

export function deleteShift(id) {
    return store.afterWrite(api(`/shifts/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
