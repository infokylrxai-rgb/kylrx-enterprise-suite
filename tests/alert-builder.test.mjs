import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import automationEngine from '../services/automation-engine.js';

describe('Alert Builder - Unified Automation Engine Monitoring Rules Suite', () => {

    test('1. Default Alert Monitoring Rules are configured on Common Automation Engine', async () => {
        // Load the alert routes module which seeds the engine
        const alertsRouter = (await import('../routes/alerts.js')).default;
        
        const attendanceRule = automationEngine.inMemoryRules.get('alert-attendance-consecutive-absent');
        const payrollRule = automationEngine.inMemoryRules.get('alert-payroll-variance-exceeded');
        const policyRule = automationEngine.inMemoryRules.get('alert-policy-acknowledgement-pending');
        const pmsRule = automationEngine.inMemoryRules.get('alert-pms-review-deadline-approaching');
        const exitRule = automationEngine.inMemoryRules.get('alert-exit-clearance-pending-48h');

        assert.ok(attendanceRule, 'Attendance alert rule must be registered in automation engine');
        assert.ok(payrollRule, 'Payroll variance alert rule must be registered in automation engine');
        assert.ok(policyRule, 'Policy reminder alert rule must be registered in automation engine');
        assert.ok(pmsRule, 'PMS escalation alert rule must be registered in automation engine');
        assert.ok(exitRule, 'Exit clearance escalation alert rule must be registered in automation engine');
    });

    test('2. Attendance Alert: 3 Consecutive Absences → Triggers Manager + HR notifications', async () => {
        const startLogIdx = automationEngine.auditLogs.length;

        const eventData = {
            eventId: `evt-att-${Date.now()}`,
            eventName: 'attendance.consecutive_absences_detected',
            entityId: 'EMP-ATT-001',
            entityType: 'employee',
            payload: {
                employeeName: 'Rahul Verma',
                employeeId: 'EMP-ATT-001',
                department: 'Engineering',
                consecutiveAbsences: 3
            }
        };

        await automationEngine.processEvent(eventData);

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        const startedStage = logs.find(l => l.stage === 'Trigger & Conditions' && l.status === 'started');
        const completedStage = logs.find(l => l.stage === 'Pipeline Completed' && l.status === 'completed');
        const notifications = logs.filter(l => l.stage === 'Notification');

        assert.ok(startedStage, 'Attendance alert should satisfy condition (>= 3)');
        assert.ok(completedStage, 'Attendance pipeline should complete');
        assert.strictEqual(notifications.length, 2, 'Should send 2 notifications (Manager + HR Operations)');
        assert.strictEqual(notifications[0].details.target, 'Reporting Manager');
        assert.strictEqual(notifications[1].details.target, 'HR Operations');
    });

    test('3. Attendance Alert: 2 Consecutive Absences does NOT trigger alert (Conditions Unmet)', async () => {
        const startLogIdx = automationEngine.auditLogs.length;

        const eventData = {
            eventId: `evt-att-safe-${Date.now()}`,
            eventName: 'attendance.consecutive_absences_detected',
            entityId: 'EMP-ATT-002',
            entityType: 'employee',
            payload: {
                employeeName: 'Sneha Rao',
                employeeId: 'EMP-ATT-002',
                department: 'Design',
                consecutiveAbsences: 2 // below 3 threshold
            }
        };

        await automationEngine.processEvent(eventData);

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        const unmetLog = logs.find(l => l.status === 'conditions_unmet');
        assert.ok(unmetLog, 'Attendance event with 2 absences should result in conditions_unmet');
    });

    test('4. Payroll Alert: Variance > 10% → Triggers Payroll Admin notification', async () => {
        const startLogIdx = automationEngine.auditLogs.length;

        const eventData = {
            eventId: `evt-pay-spike-${Date.now()}`,
            eventName: 'payroll.variance_calculated',
            entityId: 'BATCH-SEP-2026',
            entityType: 'payroll_batch',
            payload: {
                batchId: 'BATCH-SEP-2026',
                cycleMonth: 'September 2026',
                variancePercentage: 14.2 // > 10%
            }
        };

        await automationEngine.processEvent(eventData);

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        const notif = logs.find(l => l.stage === 'Notification');
        assert.ok(notif, 'Should generate notification for payroll anomaly');
        assert.strictEqual(notif.details.target, 'Payroll Admin');
        assert.ok(notif.details.title.includes('10%'));
    });

    test('5. Payroll Alert: Variance 6% (<= 10%) does NOT trigger Payroll Admin notification', async () => {
        const startLogIdx = automationEngine.auditLogs.length;

        const eventData = {
            eventId: `evt-pay-safe-${Date.now()}`,
            eventName: 'payroll.variance_calculated',
            entityId: 'BATCH-AUG-2026',
            entityType: 'payroll_batch',
            payload: {
                batchId: 'BATCH-AUG-2026',
                cycleMonth: 'August 2026',
                variancePercentage: 6.1 // <= 10%
            }
        };

        await automationEngine.processEvent(eventData);

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        const unmetLog = logs.find(l => l.status === 'conditions_unmet');
        assert.ok(unmetLog, 'Variance under 10% should not trigger alert');
    });

    test('6. Policy Alert: Acknowledgement pending for 3 days → Triggers reminder to Employee + Manager', async () => {
        const startLogIdx = automationEngine.auditLogs.length;

        const eventData = {
            eventId: `evt-pol-${Date.now()}`,
            eventName: 'policy.acknowledgement_pending',
            entityId: 'EMP-POL-55',
            entityType: 'employee',
            payload: {
                employeeName: 'Kavita Joshi',
                employeeId: 'EMP-POL-55',
                policyTitle: 'Code of Conduct & Anti-Bribery 2026',
                pendingDays: 3 // threshold >= 3
            }
        };

        await automationEngine.processEvent(eventData);

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        const notifs = logs.filter(l => l.stage === 'Notification');
        assert.strictEqual(notifs.length, 2, 'Should send reminder to Employee and Reporting Manager');
        assert.strictEqual(notifs[0].details.target, 'Employee');
        assert.strictEqual(notifs[1].details.target, 'Reporting Manager');
    });

    test('7. PMS Alert: Review deadline approaching → Manager notification + HR Escalation', async () => {
        const startLogIdx = automationEngine.auditLogs.length;

        const eventData = {
            eventId: `evt-pms-esc-${Date.now()}`,
            eventName: 'pms.review_deadline_approaching',
            entityId: 'PMS-APPRAISAL-88',
            entityType: 'pms_review',
            payload: {
                employeeName: 'Amit Saxena',
                cycleName: 'Annual Appraisal FY26',
                daysUntilDeadline: 1 // <= 2 days for rule, <= 1 for escalation step
            }
        };

        await automationEngine.processEvent(eventData);

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        const notifs = logs.filter(l => l.stage === 'Notification');
        assert.ok(notifs.length >= 2, 'Should notify Manager and trigger HR Escalation');
        assert.strictEqual(notifs[0].details.target, 'Reporting Manager');
        assert.strictEqual(notifs[1].details.target, 'HR Escalation');
    });

    test('8. Exit Alert: Clearance pending for 48 hours → Responsible Person + Head of HR Escalation', async () => {
        const startLogIdx = automationEngine.auditLogs.length;

        const eventData = {
            eventId: `evt-exit-48h-${Date.now()}`,
            eventName: 'exit.clearance_pending',
            entityId: 'EXIT-REQ-901',
            entityType: 'exit_request',
            payload: {
                employeeName: 'Rohan Gupta',
                department: 'Information Technology',
                pendingHours: 48 // threshold >= 48
            }
        };

        await automationEngine.processEvent(eventData);

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        const notifs = logs.filter(l => l.stage === 'Notification');
        assert.strictEqual(notifs.length, 2, 'Should notify Responsible Person and escalate to Head of HR');
        assert.strictEqual(notifs[0].details.target, 'Responsible Person');
        assert.strictEqual(notifs[1].details.target, 'Head of HR');
        assert.ok(notifs[1].details.title.includes('Escalation'));
    });

    test('9. Dynamic Alert Monitor Registration & Execution via Automation Engine', async () => {
        const customRuleId = 'alert-custom-device-return';
        automationEngine.registerRule({
            id: customRuleId,
            name: 'Asset Return Overdue > 5 Days',
            trigger_event: 'asset.return_overdue',
            conditions: {
                field: 'overdueDays',
                op: '>',
                value: 5
            },
            pipeline: [
                {
                    type: 'notification',
                    target: 'IT Admin Lead',
                    title: 'Asset Overdue Alert',
                    message: 'Asset return overdue by {{overdueDays}} days.'
                }
            ],
            status: 'active'
        });

        const registered = automationEngine.inMemoryRules.get(customRuleId);
        assert.ok(registered, 'Custom rule should register in automation engine cache');

        const startLogIdx = automationEngine.auditLogs.length;
        await automationEngine.processEvent({
            eventId: `evt-asset-${Date.now()}`,
            eventName: 'asset.return_overdue',
            entityId: 'ASSET-404',
            entityType: 'asset',
            payload: { overdueDays: 7 }
        });

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        const notif = logs.find(l => l.stage === 'Notification');
        assert.ok(notif, 'Dynamic custom rule should execute through automation engine');
        assert.strictEqual(notif.details.target, 'IT Admin Lead');
    });

    test('10. Disabled alert rule is skipped by Automation Engine', async () => {
        const rule = automationEngine.inMemoryRules.get('alert-attendance-consecutive-absent');
        rule.status = 'disabled';

        const startLogIdx = automationEngine.auditLogs.length;
        await automationEngine.processEvent({
            eventId: `evt-disabled-test-${Date.now()}`,
            eventName: 'attendance.consecutive_absences_detected',
            entityId: 'EMP-DIS-01',
            entityType: 'employee',
            payload: { consecutiveAbsences: 5 }
        });

        const logs = automationEngine.auditLogs.slice(startLogIdx);
        assert.strictEqual(logs.length, 0, 'Disabled rule should not produce any audit logs or execution runs');

        // Re-enable for subsequent tests
        rule.status = 'active';
    });
});
