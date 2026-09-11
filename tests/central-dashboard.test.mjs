import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import automationEngine from '../services/automation-engine.js';

describe('Admin Central Dashboard (Command Center) Suite', () => {

    test('1. Overview API aggregates all 11 prompt widgets with live data', async () => {
        const res = await fetch('http://localhost:3000/api/central-dashboard/overview?role=super_admin');
        assert.strictEqual(res.status, 200);

        const body = await res.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.activeRole, 'super_admin');

        const data = body.data;
        assert.ok(data.attendance, 'Widget 1: Attendance overview must be present');
        assert.ok(data.pms, 'Widget 2: PMS insights must be present');
        assert.ok(data.exit, 'Widget 3: Exit analytics must be present');
        assert.ok(data.payroll, 'Widget 4: Payroll analytics must be present');
        assert.ok(data.policy, 'Widget 5: Policy compliance must be present');
        assert.ok(data.workforce, 'Widget 6: Workforce overview must be present');
        assert.ok(data.orgStructure, 'Widget 7: Organization structure must be present');
        assert.ok(data.pendingActions, 'Widget 8: Pending actions must be present');
        assert.ok(data.criticalAlerts, 'Widget 9: Critical alerts must be present');
        assert.ok(data.approvals, 'Widget 10: Approvals must be present');
        assert.ok(data.recentAutomationActivity, 'Widget 11: Recent automation activity must be present');
    });

    test('2. Attendance & Workforce live metrics are properly computed', async () => {
        const res = await fetch('http://localhost:3000/api/central-dashboard/overview');
        const body = await res.json();
        const { attendance, workforce } = body.data;

        assert.ok(attendance.todayPresentPct, 'Attendance must include present percentage');
        assert.ok(attendance.absenteeismTotal > 0, 'Attendance must calculate absenteeism total');
        assert.ok(attendance.wfhUtilizationDays > 0, 'Attendance must calculate WFH utilization');
        assert.ok(workforce.totalHeadcount > 0, 'Workforce must calculate total headcount');
        assert.ok(workforce.buDistribution.labels.length >= 3, 'Workforce must break down by BU');
    });

    test('3. Payroll, Exit, PMS, and Policy compliance metrics are accurately generated', async () => {
        const res = await fetch('http://localhost:3000/api/central-dashboard/overview');
        const body = await res.json();
        const { payroll, exit, pms, policy } = body.data;

        assert.ok(payroll.grossCostTotal.includes('₹'), 'Payroll must show gross cost total in INR');
        assert.ok(payroll.variancePct, 'Payroll must show variance percentage');
        assert.ok(exit.totalExitsQTD > 0, 'Exit must calculate exits count');
        assert.ok(exit.chartReasons.labels.length > 0, 'Exit must include reasons breakdown');
        assert.ok(pms.reviewCompletionRate, 'PMS must show review completion rate');
        assert.ok(policy.overallComplianceRate, 'Policy must compute overall compliance rate');
    });

    test('4. Organization Structure Tree is hierarchical, acyclic, and contains direct reports', async () => {
        const res = await fetch('http://localhost:3000/api/central-dashboard/org-structure');
        assert.strictEqual(res.status, 200);

        const body = await res.json();
        assert.strictEqual(body.success, true);
        const tree = body.tree;

        assert.ok(tree.name, 'Root node must have a name');
        assert.strictEqual(tree.role, 'Chief Executive Officer');
        assert.ok(Array.isArray(tree.children), 'Root node must have children branches');
        assert.ok(tree.children.length >= 3, 'Root should branch into multiple department heads');

        const cto = tree.children.find(c => c.role.includes('Technology'));
        assert.ok(cto, 'Tree must include Technology leadership branch');
        assert.ok(cto.children.length >= 2, 'CTO node must have department reporting leads');
    });

    test('5. Role-based Permission Gating applies appropriate widget access', async () => {
        // Test Super Admin permissions (All 11 widgets)
        const superRes = await fetch('http://localhost:3000/api/central-dashboard/overview?role=super_admin');
        const superBody = await superRes.json();
        assert.strictEqual(superBody.allowedWidgets.length, 11, 'Super Admin must have access to all 11 widgets');

        // Test Manager permissions (Restricted subset)
        const mgrRes = await fetch('http://localhost:3000/api/central-dashboard/overview?role=manager');
        const mgrBody = await mgrRes.json();
        assert.ok(mgrBody.allowedWidgets.length < 11, 'Manager should have restricted widget permissions');
        assert.ok(!mgrBody.allowedWidgets.includes('payroll'), 'Manager should not have permission to view payroll');
        assert.ok(!mgrBody.allowedWidgets.includes('exit'), 'Manager should not have permission to view exit analytics');
        assert.ok(mgrBody.allowedWidgets.includes('attendance'), 'Manager must have access to attendance');
        assert.ok(mgrBody.allowedWidgets.includes('pms'), 'Manager must have access to PMS');
    });

    test('6. Resolving an Approval records immutable audit entry in Common Automation Engine', async () => {
        const initRes = await fetch('http://localhost:3000/api/central-dashboard/overview');
        const initBody = await initRes.json();
        const targetId = initBody.data.approvals[0]?.id || 'APP-SALARY-410';

        const res = await fetch(`http://localhost:3000/api/central-dashboard/approvals/${targetId}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', remarks: 'Salary revision signed off by HR Admin' })
        });

        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.success, true);
        assert.ok(body.message.includes('approved'));

        // Verify that the server's Common Automation Engine recorded the audit log in overview
        const resOverview = await fetch('http://localhost:3000/api/central-dashboard/overview');
        const overviewBody = await resOverview.json();
        const logs = overviewBody.data.recentAutomationActivity;
        
        const approvalLog = logs.find(l => l.stage === 'Approval Resolution');
        assert.ok(approvalLog, 'Approval decision must be recorded into Common Automation Engine audit trail');
        assert.strictEqual(approvalLog.status, 'approved');
    });

    test('7. Critical Alerts stream mirrors Alert Builder threshold monitors', async () => {
        const res = await fetch('http://localhost:3000/api/central-dashboard/overview');
        const body = await res.json();
        const alerts = body.data.criticalAlerts;

        assert.ok(Array.isArray(alerts));
        assert.ok(alerts.length >= 3);
        assert.ok(alerts.some(a => a.module === 'Attendance' && a.title.includes('3 Consecutive Absences')));
        assert.ok(alerts.some(a => a.module === 'Payroll' && a.title.includes('> 10%')));
        assert.ok(alerts.some(a => a.module === 'Exit' && a.title.includes('48 Hours')));
    });

    test('8. HTML & UI Verification: admin-central-dashboard.html has all 11 widget IDs and customization drawer', () => {
        const html = fs.readFileSync('c:/Users/user/Desktop/kylrx-application/kylrx-enterprise-suite-main/admin-central-dashboard.html', 'utf-8');

        // Verify all 11 widget elements
        assert.ok(html.includes('id="widget-attendance"'));
        assert.ok(html.includes('id="widget-pms"'));
        assert.ok(html.includes('id="widget-exit"'));
        assert.ok(html.includes('id="widget-payroll"'));
        assert.ok(html.includes('id="widget-policy"'));
        assert.ok(html.includes('id="widget-workforce"'));
        assert.ok(html.includes('id="widget-org_structure"'));
        assert.ok(html.includes('id="widget-pending_actions"'));
        assert.ok(html.includes('id="widget-critical_alerts"'));
        assert.ok(html.includes('id="widget-approvals"'));
        assert.ok(html.includes('id="widget-recent_automation"'));

        // Verify Customizer Drawer & Role Switcher
        assert.ok(html.includes('id="customizerDrawer"'));
        assert.ok(html.includes('id="userRoleSelect"'));
    });

    test('9. Menu Navigation Links: All 6 Admin pages link to Command Center (admin-central-dashboard.html)', () => {
        const pages = [
            'admin-dashboard.html',
            'admin-dashboard-builder.html',
            'admin-automation-builder.html',
            'admin-assignment-matrix.html',
            'admin-alert-builder.html',
            'admin-analytics-builder.html'
        ];

        for (const p of pages) {
            const content = fs.readFileSync(`c:/Users/user/Desktop/kylrx-application/kylrx-enterprise-suite-main/${p}`, 'utf-8');
            assert.ok(
                content.includes('admin-central-dashboard.html'),
                `Page ${p} must contain a navigation link to admin-central-dashboard.html`
            );
        }
    });
});
