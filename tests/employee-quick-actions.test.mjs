import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT_DIR = path.resolve('.');

describe('PRD Section 15: Employee Quick Actions Drawer & Card Subsystem', () => {

    describe('1. Controller Architecture & Default Document Repository', async () => {
        const imported = await import('../quick-actions-controller.js');
        const { QuickActionsControllerClass, QuickActionsController, DEFAULT_DOCUMENTS } = imported.default || imported;

        test('QuickActionsControllerClass and singleton instance are exported', () => {
            assert.ok(QuickActionsControllerClass, 'QuickActionsControllerClass should be defined');
            assert.ok(QuickActionsController, 'QuickActionsController singleton should be defined');
            assert.equal(typeof QuickActionsController.init, 'function');
            assert.equal(typeof QuickActionsController.generateGridHTML, 'function');
            assert.equal(typeof QuickActionsController.openDocumentDrawer, 'function');
            assert.equal(typeof QuickActionsController.previewDocument, 'function');
            assert.equal(typeof QuickActionsController.downloadDocument, 'function');
        });

        test('DEFAULT_DOCUMENTS covers Company Policies, Signed Letters, Tax Slips, and Statutory Certificates', () => {
            assert.ok(Array.isArray(DEFAULT_DOCUMENTS), 'DEFAULT_DOCUMENTS should be an array');
            assert.ok(DEFAULT_DOCUMENTS.length >= 8, 'Should have rich default documents');

            const categories = new Set(DEFAULT_DOCUMENTS.map(d => d.category));
            assert.ok(categories.has('policies'), 'Must cover Company Policies');
            assert.ok(categories.has('letters'), 'Must cover Signed Letters & Contracts');
            assert.ok(categories.has('tax'), 'Must cover Tax Slips & Payslips');
            assert.ok(categories.has('statutory'), 'Must cover Statutory Certificates');

            DEFAULT_DOCUMENTS.forEach(doc => {
                assert.ok(doc.id, 'Document must have id');
                assert.ok(doc.category, 'Document must have category');
                assert.ok(doc.title, 'Document must have title');
                assert.ok(doc.type, 'Document must have type');
                assert.ok(doc.size, 'Document must have size');
                assert.ok(doc.status, 'Document must have status');
                assert.ok(doc.issuer, 'Document must have issuer');
                assert.ok(doc.summary, 'Document must have summary');
            });
        });

        test('Controller generateGridHTML generates unified grid with 6 standard PRD actions', () => {
            const html = QuickActionsController.generateGridHTML('employee');
            assert.ok(html.includes('quick-actions-grid'), 'Must contain quick-actions-grid');
            assert.ok(html.includes('data-quick-action="documents"'), 'Must have Documents action');
            assert.ok(html.includes('data-quick-action="attendance"'), 'Must have Attendance action');
            assert.ok(html.includes('data-quick-action="job-details"'), 'Must have Job Details action');
            assert.ok(html.includes('data-quick-action="payslips"'), 'Must have Payslips action');
            assert.ok(html.includes('data-quick-action="leave"'), 'Must have Apply Leave action');
            assert.ok(html.includes('data-quick-action="tasks"'), 'Must have Task Update action');
        });

        test('Category filter logic filters documents accurately', () => {
            const instance = new QuickActionsControllerClass();
            instance.setCategory('policies');
            assert.equal(instance.activeCategory, 'policies');
            const policies = instance.documents.filter(d => d.category === 'policies');
            assert.ok(policies.length >= 2, 'Should have at least 2 policies');
        });
    });

    describe('2. Design System & CSS Styling (quick-actions.css)', () => {
        const cssPath = path.join(ROOT_DIR, 'quick-actions.css');

        test('quick-actions.css exists and contains scoped design tokens and classes', () => {
            assert.ok(fs.existsSync(cssPath), 'quick-actions.css must exist');
            const css = fs.readFileSync(cssPath, 'utf8');

            assert.ok(css.includes('.quick-actions-container'), 'Must style container');
            assert.ok(css.includes('.quick-actions-grid'), 'Must style grid layout');
            assert.ok(css.includes('.quick-action-item'), 'Must style action item cards');
            assert.ok(css.includes('.quick-action-item:hover'), 'Must define interactive hover state');
            assert.ok(css.includes('.action-icon-wrap'), 'Must define icon wrappers');
            assert.ok(css.includes('.qa-drawer'), 'Must define slide-over drawer');
            assert.ok(css.includes('.qa-drawer.active'), 'Must define active drawer slide state');
            assert.ok(css.includes('.qa-tab-btn'), 'Must define category tab buttons');
            assert.ok(css.includes('.qa-preview-overlay'), 'Must define document preview modal');
        });
    });

    describe('3. Multi-Dashboard Integration (ESS, Manager, Super Admin)', () => {
        test('employee-dashboard.html integrates PRD §15 Quick Actions Hub', () => {
            const html = fs.readFileSync(path.join(ROOT_DIR, 'employee-dashboard.html'), 'utf8');
            assert.ok(html.includes('quick-actions.css'), 'Must link quick-actions.css');
            assert.ok(html.includes('quick-actions-controller.js'), 'Must include quick-actions-controller.js');
            assert.ok(html.includes('quick-actions-grid'), 'Must render quick-actions-grid');
            assert.ok(html.includes('data-quick-action="documents"'), 'Must feature Documents shortcut');
            assert.ok(html.includes('data-quick-action="attendance"'), 'Must feature Attendance shortcut');
            assert.ok(html.includes('data-quick-action="job-details"'), 'Must feature Job Details shortcut');
            assert.ok(html.includes('data-quick-action="payslips"'), 'Must feature Payslips shortcut');
            assert.ok(html.includes('data-quick-action="leave"'), 'Must feature Apply Leave shortcut');
        });

        test('manager-dashboard.html integrates PRD §15 Quick Actions Hub', () => {
            const html = fs.readFileSync(path.join(ROOT_DIR, 'manager-dashboard.html'), 'utf8');
            assert.ok(html.includes('quick-actions.css'), 'Must link quick-actions.css');
            assert.ok(html.includes('quick-actions-controller.js'), 'Must include quick-actions-controller.js');
            assert.ok(html.includes('quick-actions-grid'), 'Must render quick-actions-grid');
            assert.ok(html.includes('data-quick-action="documents"'), 'Must feature Documents shortcut');
            assert.ok(html.includes('Manager Oversight'), 'Must label role-scoped oversight');
        });

        test('admin-dashboard.html integrates PRD §15 Quick Actions Hub', () => {
            const html = fs.readFileSync(path.join(ROOT_DIR, 'admin-dashboard.html'), 'utf8');
            assert.ok(html.includes('quick-actions.css'), 'Must link quick-actions.css');
            assert.ok(html.includes('quick-actions-controller.js'), 'Must include quick-actions-controller.js');
            assert.ok(html.includes('quick-actions-grid'), 'Must render quick-actions-grid');
            assert.ok(html.includes('data-quick-action="documents"'), 'Must feature Documents shortcut');
            assert.ok(html.includes('Super Admin Hub'), 'Must label Super Admin scope');
        });
    });

    describe('4. Headless Browser End-to-End Test (Puppeteer)', () => {
        test('Documents Quick Action opens slide-over drawer, renders tabs and triggers preview', async () => {
            const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
            const page = await browser.newPage();

            const consoleErrors = [];
            page.on('console', msg => {
                if (msg.type() === 'error') consoleErrors.push(msg.text());
            });

            try {
                await page.goto('http://127.0.0.1:5502/kylrx-enterprise-suite-main/employee-dashboard.html', {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                });
                await new Promise(r => setTimeout(r, 1000));

                // Check quick action item for documents exists
                const docActionEl = await page.$('.quick-action-item[data-quick-action="documents"]');
                assert.ok(docActionEl, 'Documents quick action element must exist in DOM');

                // Click Documents Quick Action
                await page.$eval('.quick-action-item[data-quick-action="documents"]', el => el.click());
                await new Promise(r => setTimeout(r, 600));

                // Verify Slide-Over Drawer is now active
                const isDrawerActive = await page.$eval('#quickActionsDocDrawer', el => el.classList.contains('active'));
                assert.equal(isDrawerActive, true, 'Slide-over drawer #quickActionsDocDrawer must have .active class');

                // Verify Document cards rendered
                const docCardCount = await page.$$eval('.qa-doc-card', cards => cards.length);
                assert.ok(docCardCount >= 8, `Expected at least 8 document cards, got ${docCardCount}`);

                // Click "Company Policies" tab
                await page.$eval('.qa-tab-btn[data-cat="policies"]', el => el.click());
                await new Promise(r => setTimeout(r, 300));

                // Verify filtered policies
                const policyCardCount = await page.$$eval('.qa-doc-card', cards => cards.length);
                assert.ok(policyCardCount >= 2, `Policies tab should show at least 2 cards, got ${policyCardCount}`);

                // Click Preview button on first card
                await page.$eval('.qa-btn-action', el => el.click());
                await new Promise(r => setTimeout(r, 400));

                const isPreviewActive = await page.$eval('#qaPreviewOverlay', el => el.classList.contains('active'));
                assert.equal(isPreviewActive, true, 'Preview modal #qaPreviewOverlay must have .active class');

                // Close preview modal
                await page.$eval('#qaPreviewOverlay .qa-drawer-close', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                const isPreviewClosed = await page.$eval('#qaPreviewOverlay', el => !el.classList.contains('active'));
                assert.equal(isPreviewClosed, true, 'Preview modal should be closed');

                // Close slide-over drawer
                await page.$eval('#quickActionsDocDrawer .qa-drawer-close', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                const isDrawerClosed = await page.$eval('#quickActionsDocDrawer', el => !el.classList.contains('active'));
                assert.equal(isDrawerClosed, true, 'Drawer should be closed');

            } finally {
                await page.close();
                await browser.close();
            }
        });

        test('Attendance, Leave, Tasks, and Job Details Quick Actions open in-page modals without navigating away', async () => {
            const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
            const page = await browser.newPage();

            try {
                await page.evaluateOnNewDocument(() => {
                    localStorage.setItem('hr_logged_in', 'true');
                    localStorage.setItem('user_role', 'super_admin');
                    localStorage.setItem('hr_user_role', 'super_admin');
                });

                const initialUrl = 'http://127.0.0.1:5502/kylrx-enterprise-suite-main/admin-dashboard.html';
                await page.goto(initialUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                });
                await new Promise(r => setTimeout(r, 1000));

                // 1. Test Attendance Quick Action - Stays on page and opens modal
                await page.$eval('.quick-action-item[data-quick-action="attendance"]', el => el.click());
                await new Promise(r => setTimeout(r, 400));
                assert.equal(page.url().includes('admin-dashboard.html'), true, 'Must not navigate away from admin-dashboard.html on Attendance click');
                const isAttendanceActive = await page.$eval('#qaAttendanceModal', el => el.classList.contains('active'));
                assert.equal(isAttendanceActive, true, 'Attendance modal #qaAttendanceModal must have .active class');

                // Verify clean live clock banner
                const clockText = await page.$eval('#qaLiveClock', el => el.textContent.trim());
                assert.ok(clockText.length > 0, 'Live clock time must be rendered');
                const punchStatusText = await page.$eval('#qaPunchStatusBadge', el => el.textContent.trim());
                assert.ok(punchStatusText.includes('Punched In'), 'Initial status should be Punched In');

                // Toggle punch out
                await page.$eval('#qaBtnPunchToggle', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                assert.equal(page.url().includes('admin-dashboard.html'), true, 'Must remain on page after punch toggle');
                const statusAfterPunchOut = await page.$eval('#qaPunchStatusBadge', el => el.textContent.trim());
                assert.ok(statusAfterPunchOut.includes('Punched Out'), 'Status should transition to Punched Out');

                // Toggle punch back in
                await page.$eval('#qaBtnPunchToggle', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                const statusAfterPunchIn = await page.$eval('#qaPunchStatusBadge', el => el.textContent.trim());
                assert.ok(statusAfterPunchIn.includes('Punched In'), 'Status should transition back to Punched In');

                // Close Attendance modal
                await page.$eval('#qaAttendanceModal .qa-drawer-close', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                const isAttendanceClosed = await page.$eval('#qaAttendanceModal', el => !el.classList.contains('active'));
                assert.equal(isAttendanceClosed, true, 'Attendance modal should be closed');

                // 2. Test Apply Leave Quick Action - Stays on page and opens modal
                await page.$eval('.quick-action-item[data-quick-action="leave"]', el => el.click());
                await new Promise(r => setTimeout(r, 400));
                assert.equal(page.url().includes('admin-dashboard.html'), true, 'Must not navigate away from admin-dashboard.html on Apply Leave click');
                const isLeaveActive = await page.$eval('#qaLeaveModal', el => el.classList.contains('active'));
                assert.equal(isLeaveActive, true, 'Leave modal #qaLeaveModal must have .active class');

                // Submit Leave Request
                await page.$eval('#qaLeaveModal .qa-btn-action.primary', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                assert.equal(page.url().includes('admin-dashboard.html'), true, 'Must remain on page after submitting leave');

                // Close Leave modal
                await page.$eval('#qaLeaveModal .qa-drawer-close', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                const isLeaveClosed = await page.$eval('#qaLeaveModal', el => !el.classList.contains('active'));
                assert.equal(isLeaveClosed, true, 'Leave modal should be closed');

                // 3. Test Task Update Quick Action - Stays on page and opens modal
                await page.$eval('.quick-action-item[data-quick-action="tasks"]', el => el.click());
                await new Promise(r => setTimeout(r, 400));
                assert.equal(page.url().includes('admin-dashboard.html'), true, 'Must not navigate away from admin-dashboard.html on Task Update click');
                const isTasksActive = await page.$eval('#qaTaskModal', el => el.classList.contains('active'));
                assert.equal(isTasksActive, true, 'Task modal #qaTaskModal must have .active class');

                // Submit Task Update
                await page.$eval('#qaTaskModal .qa-btn-action.primary', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                assert.equal(page.url().includes('admin-dashboard.html'), true, 'Must remain on page after submitting task update');

                // Close Task modal
                await page.$eval('#qaTaskModal .qa-drawer-close', el => el.click());
                await new Promise(r => setTimeout(r, 300));
                const isTasksClosed = await page.$eval('#qaTaskModal', el => !el.classList.contains('active'));
                assert.equal(isTasksClosed, true, 'Task modal should be closed');

                // 4. Test Job Details Quick Action - Stays on page
                await page.$eval('.quick-action-item[data-quick-action="job-details"]', el => el.click());
                await new Promise(r => setTimeout(r, 400));
                assert.equal(page.url().includes('admin-dashboard.html'), true, 'Must not navigate away from admin-dashboard.html on Job Details click');

            } finally {
                await page.close();
                await browser.close();
            }
        });
    });
});

