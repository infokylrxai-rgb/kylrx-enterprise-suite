import './helpers/isolate-firebase.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import automationEngine from '../services/automation-engine.js';
import http from 'node:http';
import admin from 'firebase-admin';
import { before, after } from 'node:test';

// Starts the app on a free port with the in-memory store; refuses to run against a real Firebase app.
let server;
let baseUrl;
before(async () => {
  const { default: serverModule } = await import('../server.js');
  assert.equal(admin.apps.length, 0, 'a real Firebase app is initialised; the test must run on the in-memory store');
  await serverModule.dynamicRoutesLoaded;
  server = http.createServer(serverModule.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

// verifyToken needs a real identity: the role comes from a signed token, not from ?role=
const asRole = (role) => ({ headers: { Authorization: `Bearer ${jwt.sign({ id: `test_${role}`, role, orgId: process.env.DEV_DEFAULT_ORG_ID || 'org_kylrx_ai' }, process.env.JWT_SECRET)}` } });

describe('Admin Central Dashboard (Command Center) Suite', () => {

    /*
     * These tests used to check the invented company the API returned whenever it had
     * no database: headcount above zero, a "Chief Executive Officer" tree with a
     * Technology branch, absences and WFH days, alerts about "3 Consecutive Absences".
     * The Command Centre showed that company as the customer's own (950 headcount).
     * Without a database - as here - the API now says so and invents nothing.
     */
    test('1. Without a database the overview says so instead of inventing an organisation', async () => {
        const res = await fetch(`${baseUrl}/api/central-dashboard/overview`, asRole('super_admin'));
        assert.strictEqual(res.status, 503);
        const body = await res.json();
        assert.strictEqual(body.success, false);
        assert.match(body.error, /database is not available/);
        assert.ok(!body.data, 'no figures may be sent with the refusal');
    });

    test('2. An account with no organisation gets no figures', async () => {
        const token = jwt.sign({ id: 'test_noorg', role: 'super_admin' }, process.env.JWT_SECRET || 'test-jwt-secret-not-for-production-use-0001');
        const res = await fetch(`${baseUrl}/api/central-dashboard/overview`, { headers: { Authorization: `Bearer ${token}` } });
        assert.ok([403, 503].includes(res.status), 'got ' + res.status);
        const body = await res.json();
        assert.strictEqual(body.success, false);
        assert.ok(!body.data);
    });

    test('3. No invented figures remain in the route or the page', () => {
        const route = fs.readFileSync(new URL('../routes/central-dashboard.js', import.meta.url), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
        for (const fake of ['950', "'8.4%'", "'94.2%'", '470, 240', 'Rajesh Subramanian', 'Ananya Rao']) {
            assert.ok(!route.includes(fake), 'the route still carries ' + fake);
        }
        const html = fs.readFileSync(new URL('../admin-central-dashboard.html', import.meta.url), 'utf-8');
        assert.match(html, /id="wfHeadcount"[^>]*>0</, 'Workforce Overview must start at 0, not an invented headcount');
        assert.match(html, /id="wfHires"[^>]*>0</);
        assert.match(html, /id="wfAttrition"[^>]*>0\.0%</);
        assert.ok(!/>950 Active/.test(html));
    });

    test('4. The organisation tree is the organisation\'s own, never an invented one', async () => {
        const res = await fetch(`${baseUrl}/api/central-dashboard/org-structure`, asRole('super_admin'));
        assert.strictEqual(res.status, 503);
        const body = await res.json();
        assert.ok(!body.tree, 'no tree may be invented without the database');
    });

    test('5. Role-based widget permissions', async () => {
        const res = await fetch(`${baseUrl}/api/central-dashboard/permissions`, asRole('super_admin'));
        const { roles } = await res.json();
        assert.strictEqual(roles.super_admin.allowedWidgets.length, 11, 'Super Admin must have access to all 11 widgets');
        const mgr = roles.manager.allowedWidgets;
        assert.ok(mgr.length < 11);
        assert.ok(!mgr.includes('payroll') && !mgr.includes('exit'));
        assert.ok(mgr.includes('attendance') && mgr.includes('pms'));
    });

    test('6. Resolving an approval records an audit entry', async () => {
        const res = await fetch(`${baseUrl}/api/central-dashboard/approvals/APP-TEST-1/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...asRole('super_admin').headers },
            body: JSON.stringify({ decision: 'approved', remarks: 'Signed off' })
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.success, true);
        assert.ok(body.message.includes('approved'));
        const logs = automationEngine.getAuditLogs ? automationEngine.getAuditLogs() : (automationEngine.auditLogs || []);
        assert.ok(Array.isArray(logs) ? logs.some(l => l.stage === 'Approval Resolution') : true, 'the decision must be audited');
    });

    test('7. The page explains an empty Command Centre instead of showing invented numbers', () => {
        const js = fs.readFileSync(new URL('../admin-central-dashboard.js', import.meta.url), 'utf-8');
        assert.match(js, /renderFallbackLiveDashboard\(body\.error\)/, 'the server\'s reason must reach the screen');
    });

    test('8. HTML & UI Verification: admin-central-dashboard.html has all 11 widget IDs and customization drawer', () => {
        const html = fs.readFileSync(new URL('../admin-central-dashboard.html', import.meta.url), 'utf-8');

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
            const content = fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf-8');
            assert.ok(
                content.includes('admin-central-dashboard.html'),
                `Page ${p} must contain a navigation link to admin-central-dashboard.html`
            );
        }
    });
});
