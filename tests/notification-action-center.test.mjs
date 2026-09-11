import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Import Service
const servicePath = path.resolve(rootDir, 'services', 'notification-action-center-service.js');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const notificationActionCenterService = require(servicePath);

test('Notification & Action Centre - Schema & Enforced Fields Validation', async (t) => {
    await t.test('Separates actionable items from informational notices', () => {
        const feed = notificationActionCenterService.getFeed({ type: 'all' });
        assert.ok(Array.isArray(feed.actionable), 'Actionable should be an array');
        assert.ok(Array.isArray(feed.informational), 'Informational should be an array');
        assert.ok(feed.actionable.length > 0, 'Should have pre-seeded actionable items');
        assert.ok(feed.informational.length > 0, 'Should have pre-seeded informational notices');

        // Test type filtering
        const onlyActionable = notificationActionCenterService.getFeed({ type: 'actionable' });
        assert.strictEqual(onlyActionable.informational.length, 0, 'Informational list should be empty when filtering type=actionable');
        assert.ok(onlyActionable.actionable.length > 0);

        const onlyInformational = notificationActionCenterService.getFeed({ type: 'information' });
        assert.strictEqual(onlyInformational.actionable.length, 0, 'Actionable list should be empty when filtering type=information');
        assert.ok(onlyInformational.informational.length > 0);
    });

    await t.test('Every actionable item strictly supports dueTime, reminderTime, escalationTime, assignee, and status', () => {
        const feed = notificationActionCenterService.getFeed({ type: 'actionable' });
        const validStatuses = ['pending', 'in_progress', 'completed', 'escalated', 'snoozed', 'rejected'];

        feed.actionable.forEach((item) => {
            // dueTime
            assert.ok(item.dueTime, `Item ${item.id} must have dueTime`);
            assert.ok(!isNaN(Date.parse(item.dueTime)), `Item ${item.id} dueTime must be valid ISO timestamp`);

            // reminderTime
            assert.ok(item.reminderTime, `Item ${item.id} must have reminderTime`);
            assert.ok(!isNaN(Date.parse(item.reminderTime)), `Item ${item.id} reminderTime must be valid ISO timestamp`);

            // escalationTime
            assert.ok(item.escalationTime, `Item ${item.id} must have escalationTime`);
            assert.ok(!isNaN(Date.parse(item.escalationTime)), `Item ${item.id} escalationTime must be valid ISO timestamp`);

            // assignee
            assert.ok(item.assignee, `Item ${item.id} must have assignee`);
            assert.ok(item.assignee.id, `Item ${item.id} assignee must have id`);
            assert.ok(item.assignee.name, `Item ${item.id} assignee must have name`);
            assert.ok(item.assignee.role, `Item ${item.id} assignee must have role`);

            // status
            assert.ok(item.status, `Item ${item.id} must have status`);
            assert.ok(validStatuses.includes(item.status), `Item ${item.id} status '${item.status}' is not valid`);
        });
    });
});

test('Notification & Action Centre - All 11 Facets Verification', async (t) => {
    const facets = [
        'critical',
        'due_today',
        'upcoming',
        'approvals',
        'attendance',
        'payroll',
        'pms',
        'policy',
        'exit',
        'documents',
        'system'
    ];

    const summary = notificationActionCenterService.getSummary();

    await t.test('Summary contains non-zero counts across all 11 required dimensions', () => {
        facets.forEach((facetKey) => {
            const camelKey = facetKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            assert.ok(
                summary[camelKey] !== undefined && summary[camelKey] > 0,
                `Summary dimension '${camelKey}' should exist and be > 0 (received: ${summary[camelKey]})`
            );
        });
    });

    await t.test('Feed filters correctly for each of the 11 facets', () => {
        facets.forEach((facet) => {
            const filtered = notificationActionCenterService.getFeed({ facet });
            const totalItems = filtered.actionable.length + filtered.informational.length;
            assert.ok(totalItems > 0, `Facet '${facet}' should return matching feed items`);
        });
    });
});

test('Notification & Action Centre - Operational Lifecycle (Resolve, Remind, Escalate)', async (t) => {
    await t.test('Resolve an actionable item (Approve)', async () => {
        const testId = 'ACT-ATT-001';
        const resolved = await notificationActionCenterService.resolveAction(testId, {
            decision: 'approved',
            remarks: 'Manager investigated, medical note submitted.',
            actor: 'HR Test Runner'
        });

        assert.strictEqual(resolved.status, 'completed');
        assert.strictEqual(resolved.resolvedBy, 'HR Test Runner');
        assert.ok(resolved.resolvedAt);
    });

    await t.test('Trigger a reminder nudge', async () => {
        const testId = 'ACT-DOC-005';
        const reminded = await notificationActionCenterService.triggerReminder(testId, {
            actor: 'Automated Remind Daemon'
        });

        assert.ok(reminded.reminderCount >= 1);
        assert.ok(reminded.reminderTime);
    });

    await t.test('Trigger an SLA escalation', async () => {
        const testId = 'ACT-PAY-002';
        const escalated = await notificationActionCenterService.triggerEscalation(testId, {
            escalationAssignee: 'Chief Financial Officer',
            reason: 'Variance threshold exceeded without explanation',
            actor: 'HR Auditor'
        });

        assert.strictEqual(escalated.status, 'escalated');
        assert.strictEqual(escalated.severity, 'critical');
        assert.strictEqual(escalated.assignee.name, 'Chief Financial Officer');
        assert.strictEqual(escalated.escalationReason, 'Variance threshold exceeded without explanation');
    });

    await t.test('Mark informational notifications as read', () => {
        const noticeId = 'INF-NOTIF-101';
        const updated = notificationActionCenterService.markNoticeAsRead(noticeId);
        assert.strictEqual(updated.isRead, true);

        const bulkResult = notificationActionCenterService.markAllNoticesAsRead();
        assert.strictEqual(bulkResult.success, true);
        assert.ok(bulkResult.count > 0);

        const summary = notificationActionCenterService.getSummary();
        assert.strictEqual(summary.unreadInformational, 0);
    });
});

test('Notification & Action Centre - REST API Endpoints', async (t) => {
    const BASE_URL = 'http://localhost:3000/api/notification-center';

    await t.test('GET /api/notification-center/summary returns 200 and schema', async () => {
        const res = await fetch(`${BASE_URL}/summary`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.data.totalActionable > 0);
        assert.ok(data.data.critical > 0);
    });

    await t.test('GET /api/notification-center/feed returns separated lists', async () => {
        const res = await fetch(`${BASE_URL}/feed?type=all`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(Array.isArray(data.data.actionable));
        assert.ok(Array.isArray(data.data.informational));
    });

    await t.test('POST /api/notification-center/actions/:id/resolve resolves item', async () => {
        const res = await fetch(`${BASE_URL}/actions/ACT-EXIT-008/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved', remarks: 'Clearance verified', actor: 'Finance Admin' })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.data.status, 'completed');
    });

    await t.test('POST /api/notification-center/actions/:id/remind nudges assignee', async () => {
        const res = await fetch(`${BASE_URL}/actions/ACT-PMS-004/remind`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor: 'PMS Coordinator' })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.data.reminderCount > 0);
    });

    await t.test('POST /api/notification-center/actions/:id/escalate accelerates SLA', async () => {
        const res = await fetch(`${BASE_URL}/actions/ACT-SYS-009/escalate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                escalationAssignee: 'VP of Infrastructure',
                reason: 'Critical certificate expiration imminent'
            })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.data.status, 'escalated');
        assert.strictEqual(data.data.assignee.name, 'VP of Infrastructure');
    });
});

test('Notification & Action Centre - Sidebar Navigation Integration', async (t) => {
    const adminPages = [
        'admin-central-dashboard.html',
        'admin-dashboard.html',
        'admin-automation-builder.html',
        'admin-assignment-matrix.html',
        'admin-alert-builder.html',
        'admin-analytics-builder.html',
        'admin-dashboard-builder.html',
        'admin-notification-center.html'
    ];

    adminPages.forEach((page) => {
        const filePath = path.resolve(rootDir, page);
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(
            content.includes('admin-notification-center.html'),
            `Page ${page} must contain a navigation link to admin-notification-center.html`
        );
    });
});
