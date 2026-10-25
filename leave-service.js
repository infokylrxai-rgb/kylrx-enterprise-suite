/**
 * Admin Leave & Holiday Management client service.
 *
 * All reads and writes go through the backend (/api/leave-admin), which keeps each
 * organization's leave data separate and responds only after Firestore confirmed a write.
 * The page subscribes to one overview (stats, pending and approved requests, policies, leave
 * types, holidays, departments and week-offs) refreshed every 30 seconds and after each save.
 */
import { createApi, createOverviewStore, getWriteStatus, localDateStr } from './admin-api.js';

export { getWriteStatus, localDateStr };

const api = createApi('/api/leave-admin');
const store = createOverviewStore(async () => (await api(`/overview?today=${localDateStr(new Date())}`)).data);
const write = (path, method, body) => store.afterWrite(api(path, { method, body }));
const id = (value) => encodeURIComponent(value);

export const subscribeOverview = store.subscribe;
export const refreshOverview = store.refresh;

/** Approve or reject a pending leave request (approval deducts the employee's balance) */
export const decideLeave = (requestId, action, comment = '') => write(`/requests/${id(requestId)}/decision`, 'POST', { action, comment });

export const createPolicy = (data) => write('/policies', 'POST', data);
export const updatePolicy = (policyId, data) => write(`/policies/${id(policyId)}`, 'PUT', data);
export const duplicatePolicy = (policyId) => write(`/policies/${id(policyId)}/duplicate`, 'POST');
export const deletePolicy = (policyId) => write(`/policies/${id(policyId)}`, 'DELETE');

/** One leave type, or a list from an import */
export const saveLeaveTypes = (items) => write('/leave-types', 'POST', { items: [].concat(items) });
export const deleteLeaveType = (typeId) => write(`/leave-types/${id(typeId)}`, 'DELETE');

/** One holiday, or a list from an import (a date already on the calendar is updated) */
export const saveHolidays = (items) => write('/holidays', 'POST', { items: [].concat(items) });
export const updateHoliday = (holidayId, data) => write(`/holidays/${id(holidayId)}`, 'PUT', data);
export const deleteHoliday = (holidayId) => write(`/holidays/${id(holidayId)}`, 'DELETE');

export const setWeeklyOff = (value) => write('/weekly-off', 'PUT', { value });
export const setDeptWeekOff = (deptId, value) => write(`/departments/${id(deptId)}/week-off`, 'PUT', { value });
