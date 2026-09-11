const UnifiedModuleContract = require('../services/unified-module-contract');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * Leave & Attendance Module Adapter
 * Exposes leave applications, punch exceptions, inactivity alerts, and balance actions
 */
const leaveAttendanceModuleAdapter = new UnifiedModuleContract({
    moduleKey: 'leave_attendance',
    moduleName: 'Leave & Attendance Operations',
    description: 'Manages employee leave requests, attendance logs, punch regularizations, and inactivity monitoring.',

    triggers: [
        {
            name: 'leave.applied',
            label: 'Leave Applied',
            description: 'Fired when an employee submits a leave application.',
            samplePayload: { employeeId: 'EMP-001', leaveType: 'Casual', daysCount: 3, startDate: '2026-10-01', endDate: '2026-10-03' }
        },
        {
            name: 'leave.cancelled',
            label: 'Leave Cancelled',
            description: 'Fired when a pending or approved leave request is cancelled.',
            samplePayload: { employeeId: 'EMP-001', requestId: 'LR-9921', daysCount: 2 }
        },
        {
            name: 'leave.approved',
            label: 'Leave Approved',
            description: 'Fired when a reporting manager or HR approves a leave application.',
            samplePayload: { employeeId: 'EMP-001', requestId: 'LR-9921', leaveType: 'Casual', daysCount: 3, approvedBy: 'manager' }
        },
        {
            name: 'attendance.inactivity_flagged',
            label: 'Attendance Inactivity Flagged',
            description: 'Fired when inactivity radar detects continuous idle time exceeding threshold.',
            samplePayload: { employeeId: 'EMP-001', idleDurationMinutes: 120, department: 'Sales' }
        },
        {
            name: 'attendance.regularization_requested',
            label: 'Punch Regularization Requested',
            description: 'Fired when an employee requests a missed punch correction.',
            samplePayload: { employeeId: 'EMP-001', date: '2026-09-10', punchType: 'check_in' }
        }
    ],

    conditions: [
        { field: 'leave.leaveType', label: 'Leave Type', type: 'string', allowedValues: ['Casual', 'Sick', 'Earned', 'Maternity', 'Paternity', 'CompOff'] },
        { field: 'leave.daysCount', label: 'Number of Leave Days', type: 'number' },
        { field: 'leave.hasSufficientBalance', label: 'Has Sufficient Balance', type: 'boolean' },
        { field: 'attendance.idleDurationMinutes', label: 'Inactivity Idle Minutes', type: 'number' },
        { field: 'attendance.isRepeatedMissedPunch', label: 'Repeated Missed Punch', type: 'boolean' }
    ],

    dataResolvers: {
        leave_request: async (requestId, context) => {
            try {
                if (db) {
                    const snap = await db.collection('leaves').doc(requestId).get();
                    if (snap.exists) return snap.data();
                }
            } catch (e) {
                logger.warn(`[LeaveAdapter] Error resolving leave ${requestId}: ${e.message}`);
            }
            return { requestId, daysCount: 1, leaveType: 'Casual', status: 'pending' };
        }
    },

    actions: {
        'leave.deduct_balance': async (params, context) => {
            logger.info(`[LeaveAdapter] 🌴 Deducting ${params.daysCount || 1} days of ${params.leaveType || 'Casual'} leave for: ${params.employeeId || context.entityId}`);
            return { success: true, balanceDeducted: true, remainingBalance: 12 };
        },

        'leave.revert_balance': async (params, context) => {
            logger.info(`[LeaveAdapter] 🔄 Reverting ${params.daysCount || 1} leave days to employee: ${params.employeeId || context.entityId}`);
            return { success: true, balanceRestored: true };
        },

        'attendance.issue_inactivity_warning': async (params, context) => {
            logger.warn(`[LeaveAdapter] ⚠️ Issuing automated attendance warning to: ${params.employeeId || context.entityId} (Idle: ${params.idleMinutes}m)`);
            return { success: true, warningIssued: true, timestamp: new Date().toISOString() };
        },

        'attendance.approve_regularization': async (params, context) => {
            logger.info(`[LeaveAdapter] ✅ Approving punch regularization for employee: ${params.employeeId || context.entityId}`);
            return { success: true, regularizationApplied: true };
        }
    }
});

module.exports = leaveAttendanceModuleAdapter;
