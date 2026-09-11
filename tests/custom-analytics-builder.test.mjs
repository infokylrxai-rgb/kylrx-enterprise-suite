import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import analyticsEngine from '../services/custom-analytics-engine.js';

describe('Custom Analytics Builder - Domain Schemas, Aggregation Engine & Dashboard Suite', () => {

    test('1. Data Sources Catalog exposes all 6 prompt HR domains with exact metrics', () => {
        const sources = analyticsEngine.DATA_SOURCES;

        assert.ok(sources.workforce, 'Workforce data source must exist');
        assert.ok(sources.attendance, 'Attendance data source must exist');
        assert.ok(sources.payroll, 'Payroll data source must exist');
        assert.ok(sources.pms, 'PMS data source must exist');
        assert.ok(sources.exit, 'Exit data source must exist');
        assert.ok(sources.policy, 'Policy data source must exist');

        // 1. Workforce: headcount, hiring, attrition, employee type, BU and location
        const wfMetricIds = sources.workforce.metrics.map(m => m.id);
        assert.ok(wfMetricIds.includes('headcount'));
        assert.ok(wfMetricIds.includes('hiring'));
        assert.ok(wfMetricIds.includes('attrition'));
        assert.ok(wfMetricIds.includes('employee_type'));
        const wfGroupingIds = sources.workforce.groupingDimensions.map(g => g.id);
        assert.ok(wfGroupingIds.includes('bu'));
        assert.ok(wfGroupingIds.includes('location'));

        // 2. Attendance: absenteeism, late marks, WFH, overtime, regularization
        const attMetricIds = sources.attendance.metrics.map(m => m.id);
        assert.ok(attMetricIds.includes('absenteeism'));
        assert.ok(attMetricIds.includes('late_marks'));
        assert.ok(attMetricIds.includes('wfh'));
        assert.ok(attMetricIds.includes('overtime'));
        assert.ok(attMetricIds.includes('regularization'));

        // 3. Payroll: payroll cost, variance, deductions, exceptions, statutory totals
        const payMetricIds = sources.payroll.metrics.map(m => m.id);
        assert.ok(payMetricIds.includes('payroll_cost'));
        assert.ok(payMetricIds.includes('variance'));
        assert.ok(payMetricIds.includes('deductions'));
        assert.ok(payMetricIds.includes('exceptions'));
        assert.ok(payMetricIds.includes('statutory_totals'));

        // 4. PMS: review completion, goal completion, rating distribution
        const pmsMetricIds = sources.pms.metrics.map(m => m.id);
        assert.ok(pmsMetricIds.includes('review_completion'));
        assert.ok(pmsMetricIds.includes('goal_completion'));
        assert.ok(pmsMetricIds.includes('rating_distribution'));

        // 5. Exit: exits, reasons, tenure, department attrition, pending F&F
        const exitMetricIds = sources.exit.metrics.map(m => m.id);
        assert.ok(exitMetricIds.includes('exits'));
        assert.ok(exitMetricIds.includes('reasons'));
        assert.ok(exitMetricIds.includes('tenure'));
        assert.ok(exitMetricIds.includes('department_attrition'));
        assert.ok(exitMetricIds.includes('pending_fnf'));

        // 6. Policy: assigned, acknowledged, pending and overdue
        const polMetricIds = sources.policy.metrics.map(m => m.id);
        assert.ok(polMetricIds.includes('assigned'));
        assert.ok(polMetricIds.includes('acknowledged'));
        assert.ok(polMetricIds.includes('pending'));
        assert.ok(polMetricIds.includes('overdue'));
    });

    test('2. Workforce Aggregation Query: Headcount & Employee Type by BU and Location', () => {
        // Query Headcount grouped by BU
        const resBU = analyticsEngine.executeCustomQuery({
            dataSource: 'workforce',
            metric: 'headcount',
            grouping: 'bu',
            chartType: 'bar'
        });

        assert.strictEqual(resBU.success, true);
        assert.ok(resBU.chartData.labels.includes('Technology'));
        assert.ok(resBU.chartData.labels.includes('Sales & Marketing'));
        assert.ok(resBU.summary.total > 0);
        assert.strictEqual(resBU.chartData.datasets[0].data.length, resBU.chartData.labels.length);

        // Query Employee Type grouped by employeeType
        const resType = analyticsEngine.executeCustomQuery({
            dataSource: 'workforce',
            metric: 'employee_type',
            grouping: 'employeeType',
            chartType: 'doughnut'
        });
        assert.ok(resType.chartData.labels.includes('Full Time'));
        assert.ok(resType.chartData.labels.includes('Contractor'));
    });

    test('3. Attendance Aggregation Query: Absenteeism, Late Marks, WFH, Overtime & Regularization', () => {
        const resAtt = analyticsEngine.executeCustomQuery({
            dataSource: 'attendance',
            metric: 'absenteeism',
            grouping: 'department',
            chartType: 'bar'
        });

        assert.strictEqual(resAtt.success, true);
        assert.ok(resAtt.chartData.labels.includes('Engineering'));
        assert.ok(resAtt.chartData.labels.includes('Sales'));
        assert.ok(resAtt.summary.total > 0);

        const resWFH = analyticsEngine.executeCustomQuery({
            dataSource: 'attendance',
            metric: 'wfh',
            grouping: 'bu',
            chartType: 'line'
        });
        assert.strictEqual(resWFH.success, true);
        assert.ok(resWFH.chartData.labels.length >= 2);
    });

    test('4. Payroll Aggregation Query: Payroll Cost, Variance, Deductions, Exceptions & Statutory Totals', () => {
        const resCost = analyticsEngine.executeCustomQuery({
            dataSource: 'payroll',
            metric: 'payroll_cost',
            grouping: 'bu',
            chartType: 'bar'
        });
        assert.strictEqual(resCost.success, true);
        assert.ok(resCost.summary.total > 100, 'Gross payroll cost should sum across BUs');

        const resStat = analyticsEngine.executeCustomQuery({
            dataSource: 'payroll',
            metric: 'statutory_totals',
            grouping: 'department',
            chartType: 'doughnut'
        });
        assert.strictEqual(resStat.success, true);
        assert.ok(resStat.chartData.labels.includes('Engineering'));
    });

    test('5. PMS Aggregation Query: Review Completion, Goal Completion & Rating Distribution', () => {
        const resPMS = analyticsEngine.executeCustomQuery({
            dataSource: 'pms',
            metric: 'rating_distribution',
            grouping: 'rating',
            chartType: 'doughnut'
        });
        assert.strictEqual(resPMS.success, true);
        assert.ok(resPMS.chartData.labels.some(l => l.includes('5 - Outstanding')));
        assert.ok(resPMS.chartData.labels.some(l => l.includes('3 - Meets Expectations')));

        const resGoals = analyticsEngine.executeCustomQuery({
            dataSource: 'pms',
            metric: 'goal_completion',
            grouping: 'department',
            chartType: 'bar'
        });
        assert.strictEqual(resGoals.success, true);
        assert.ok(resGoals.summary.average > 50, 'Goal completion % should average positively');
    });

    test('6. Exit Aggregation Query: Exits, Reasons, Tenure, Dept Attrition & Pending F&F', () => {
        const resExit = analyticsEngine.executeCustomQuery({
            dataSource: 'exit',
            metric: 'reasons',
            grouping: 'reason',
            chartType: 'doughnut'
        });
        assert.strictEqual(resExit.success, true);
        assert.ok(resExit.chartData.labels.includes('Career Growth'));
        assert.ok(resExit.chartData.labels.includes('Compensation'));

        const resTenure = analyticsEngine.executeCustomQuery({
            dataSource: 'exit',
            metric: 'tenure',
            grouping: 'department',
            chartType: 'bar'
        });
        assert.strictEqual(resTenure.success, true);
        assert.ok(resTenure.summary.average > 0);
    });

    test('7. Policy Aggregation Query: Assigned, Acknowledged, Pending & Overdue Compliance', () => {
        const resPol = analyticsEngine.executeCustomQuery({
            dataSource: 'policy',
            metric: 'overdue',
            grouping: 'department',
            chartType: 'bar'
        });
        assert.strictEqual(resPol.success, true);
        assert.ok(resPol.chartData.labels.includes('Engineering'));
        assert.ok(resPol.chartData.labels.includes('Sales'));

        const resAck = analyticsEngine.executeCustomQuery({
            dataSource: 'policy',
            metric: 'acknowledged',
            grouping: 'policyDocument',
            chartType: 'bar'
        });
        assert.strictEqual(resAck.success, true);
        assert.ok(resAck.chartData.labels.includes('Code of Conduct 2026'));
    });

    test('8. Multi-Dimensional Filters Engine narrows dataset accurately', () => {
        // Query entire workforce
        const allRes = analyticsEngine.executeCustomQuery({
            dataSource: 'workforce',
            metric: 'headcount',
            grouping: 'department',
            filters: {}
        });

        // Filter only Technology BU
        const techRes = analyticsEngine.executeCustomQuery({
            dataSource: 'workforce',
            metric: 'headcount',
            grouping: 'department',
            filters: { bu: 'Technology' }
        });

        assert.ok(allRes.summary.total > techRes.summary.total, 'Filtered headcount should be a strict subset of total');
        assert.ok(techRes.chartData.labels.includes('Engineering'));
        assert.ok(!techRes.chartData.labels.includes('Sales'), 'Sales department should be excluded by Technology filter');
    });

    test('9. Dashboard Management: Save, Retrieve, Live Widget Refresh and Delete', () => {
        const initialCount = analyticsEngine.getAllDashboards().length;
        assert.ok(initialCount >= 6, 'Should have at least 6 pre-built enterprise dashboards');

        const newDash = analyticsEngine.saveDashboard({
            title: 'Q3 Talent Retention & Headcount Velocity',
            category: 'Workforce',
            description: 'Executive monitor for recruitment and attrition trends',
            widgets: [
                {
                    id: 'test-w1',
                    title: 'Headcount by Location',
                    dataSource: 'workforce',
                    metric: 'headcount',
                    grouping: 'location',
                    chartType: 'bar'
                }
            ]
        });

        assert.ok(newDash.id);
        assert.strictEqual(newDash.title, 'Q3 Talent Retention & Headcount Velocity');

        const fetched = analyticsEngine.getDashboardById(newDash.id);
        assert.ok(fetched);
        assert.strictEqual(fetched.widgets.length, 1);
        assert.ok(fetched.widgets[0].chartData, 'Widget should be enriched with dynamic live query results');
        assert.ok(fetched.widgets[0].chartData.labels.length > 0);

        // Clean up
        const deleted = analyticsEngine.deleteDashboard(newDash.id);
        assert.strictEqual(deleted, true);
    });

    test('10. UI & Navigation Verification: Analytics Builder links across all Admin pages', () => {
        const html = fs.readFileSync('c:/Users/user/Desktop/kylrx-application/kylrx-enterprise-suite-main/admin-analytics-builder.html', 'utf-8');
        assert.ok(html.includes('Custom Analytics Builder'));
        assert.ok(html.includes('customAnalyticsCanvas'));
        assert.ok(html.includes('stepperBar'));
        assert.ok(html.includes('saveDashboardModal'));

        const pages = [
            'admin-dashboard.html',
            'admin-dashboard-builder.html',
            'admin-automation-builder.html',
            'admin-assignment-matrix.html',
            'admin-alert-builder.html',
            'admin-analytics-builder.html'
        ];

        for (const page of pages) {
            const content = fs.readFileSync(`c:/Users/user/Desktop/kylrx-application/kylrx-enterprise-suite-main/${page}`, 'utf-8');
            assert.ok(content.includes('admin-analytics-builder.html'), `Page ${page} must link to admin-analytics-builder.html in sidebar navigation`);
        }
    });
});
