import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Alert Builder - HTML & UI Structure Verification', () => {

    test('1. admin-alert-builder.html exists and contains core prompt rules and UI components', () => {
        const html = fs.readFileSync('c:/Users/user/Desktop/kylrx-application/kylrx-enterprise-suite-main/admin-alert-builder.html', 'utf-8');
        
        assert.ok(html.includes('Alert Builder'), 'Should have Alert Builder in page title');
        assert.ok(html.includes('kpiActiveMonitors'), 'Should have Active Monitors KPI');
        assert.ok(html.includes('alertCardsContainer'), 'Should have container for alert cards');
        assert.ok(html.includes('simConsoleSection'), 'Should have Live Simulation Console section');
        assert.ok(html.includes('simLogTerminal'), 'Should have Terminal log viewer for stage 1-8 logs');
        assert.ok(html.includes('newRuleModal'), 'Should have New Alert Monitor modal');
        assert.ok(html.includes('admin-alert-builder.js'), 'Should link to admin-alert-builder.js');
    });

    test('2. Alert Builder link is present across all Admin sidebars', () => {
        const filesToCheck = [
            'admin-dashboard.html',
            'admin-dashboard-builder.html',
            'admin-automation-builder.html',
            'admin-assignment-matrix.html',
            'admin-alert-builder.html'
        ];

        for (const f of filesToCheck) {
            const content = fs.readFileSync(`c:/Users/user/Desktop/kylrx-application/kylrx-enterprise-suite-main/${f}`, 'utf-8');
            assert.ok(
                content.includes('admin-alert-builder.html'),
                `File ${f} must include a navigation link to admin-alert-builder.html`
            );
        }
    });

    test('3. admin-alert-builder.js contains all 5 prompt specifications', () => {
        const js = fs.readFileSync('c:/Users/user/Desktop/kylrx-application/kylrx-enterprise-suite-main/admin-alert-builder.js', 'utf-8');
        
        // 1. Attendance: 3 consecutive absences -> Manager + HR
        assert.ok(js.includes('alert-attendance-consecutive-absent'));
        assert.ok(js.includes('consecutive_absences_detected'));
        
        // 2. Payroll: variance > 10% -> Payroll Admin
        assert.ok(js.includes('alert-payroll-variance-exceeded'));
        assert.ok(js.includes('variance_calculated'));
        
        // 3. Policy: acknowledgement pending for 3 days -> reminder
        assert.ok(js.includes('alert-policy-acknowledgement-pending'));
        assert.ok(js.includes('acknowledgement_pending'));
        
        // 4. PMS: review deadline approaching -> Manager -> HR escalation
        assert.ok(js.includes('alert-pms-review-deadline-approaching'));
        assert.ok(js.includes('review_deadline_approaching'));
        
        // 5. Exit: clearance pending for 48 hours -> responsible person -> escalation
        assert.ok(js.includes('alert-exit-clearance-pending-48h'));
        assert.ok(js.includes('clearance_pending'));
    });
});
