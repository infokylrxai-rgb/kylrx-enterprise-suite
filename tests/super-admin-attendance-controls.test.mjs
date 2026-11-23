import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Use PUPPETEER_EXECUTABLE_PATH, else the system Chrome on Windows; Chrome is never downloaded
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p)) : undefined);

const { 
    AdminAttendanceControllerClass, 
    DEFAULT_SHIFT_ROSTER, 
    DEFAULT_ATTENDANCE_RULES, 
    DEFAULT_ATTENDANCE_RECORDS 
} = require('../admin-attendance-controller.js');

test('1. Schema Conformance: Shift Roster & Attendance Rules (Templates.xlsx & PRD §16)', () => {
    assert.ok(Array.isArray(DEFAULT_SHIFT_ROSTER), 'Shift roster must be an array');
    assert.equal(DEFAULT_SHIFT_ROSTER.length >= 4, true, 'At least 4 shifts must be defined');

    const genShift = DEFAULT_SHIFT_ROSTER.find(s => s.shiftCode === 'SH_GEN_01');
    assert.ok(genShift, 'General shift SH_GEN_01 must exist');
    assert.equal(genShift.startTime, '09:00:00');
    assert.equal(genShift.endTime, '18:00:00');
    assert.equal(genShift.gracePeriodMinutes, 15);
    assert.equal(genShift.breakMinutes, 45);
    assert.equal(genShift.fullDayHours, 8.0);
    assert.equal(genShift.halfDayHours, 4.5);

    assert.equal(DEFAULT_ATTENDANCE_RULES.weeklyOffPolicy, 'sat-sun');
    assert.equal(DEFAULT_ATTENDANCE_RULES.fullDayHours, 8.0);
    assert.equal(DEFAULT_ATTENDANCE_RULES.halfDayHours, 4.5);
    assert.equal(DEFAULT_ATTENDANCE_RULES.dailyOvertimeThresholdHours, 8.5);
});

test('2. Dynamic Recalculation Engine: Punctuality, Working Hours & Overtime', () => {
    const ctrl = new AdminAttendanceControllerClass();

    // Case A: On-time punch in (09:10:00, within 15m grace)
    const onTime = ctrl.calculateAttendanceMetrics('09:10:00', '18:00:00', 'SH_GEN_01');
    assert.equal(onTime.isLate, false, '09:10:00 should not be late under 15m grace');
    assert.equal(onTime.lateMinutes, 10);
    assert.equal(onTime.suggestedStatus, 'PRESENT');

    // Case B: Late punch in (09:25:00, beyond 15m grace)
    const late = ctrl.calculateAttendanceMetrics('09:25:00', '18:00:00', 'SH_GEN_01');
    assert.equal(late.isLate, true, '09:25:00 exceeds 15m grace');
    assert.equal(late.lateMinutes, 25);
    assert.equal(late.suggestedStatus, 'LATE');

    // Case C: Half-Day punch out (09:00:00 to 14:30:00 -> 5.5h gross - 45m break = 4.8h)
    const halfDay = ctrl.calculateAttendanceMetrics('09:00:00', '14:30:00', 'SH_GEN_01');
    assert.equal(halfDay.totalHoursWorked >= 4.5 && halfDay.totalHoursWorked < 8.0, true);
    assert.equal(halfDay.suggestedStatus, 'HALF_DAY');

    // Case D: Overtime (>8.5h net worked)
    const ot = ctrl.calculateAttendanceMetrics('09:00:00', '19:30:00', 'SH_GEN_01');
    assert.equal(ot.isOvertime, true);
    assert.equal(ot.overtimeHours > 1.0, true);

    // Case E: Absent (no punch in)
    const absent = ctrl.calculateAttendanceMetrics(null, null, 'SH_GEN_01');
    assert.equal(absent.suggestedStatus, 'ABSENT');
    assert.equal(absent.totalHoursWorked, 0);
});

test('3. Manual attendance is sent to the backend API with the computed metrics', async () => {
    const ctrl = new AdminAttendanceControllerClass();

    // The controller no longer writes to Firestore itself: it calls the backend attendance API,
    // which owns the attendance_records document (id, recordedBy and timestamps).
    let sent = null;
    ctrl.init({
        api: {
            localDateStr: (d) => d.toISOString().split('T')[0],
            recordAttendance: async (payload) => {
                sent = payload;
                return { success: true, data: { employeeName: 'Rahul Sharma', ...payload } };
            }
        },
        auth: { currentUser: { uid: 'super_admin_test_uid' } }
    });

    const formInput = {
        employeeId: "EMP0012",
        employeeName: "Rahul Sharma",
        department: "Engineering",
        date: "2026-09-30",
        punchIn: "09:12:00",
        punchOut: "18:30:00",
        shiftCode: "SH_GEN_01",
        status: "PRESENT",
        adminRemark: "Manual swipe regularization per manager approval"
    };

    const res = await ctrl.recordAttendance(formInput);
    assert.equal(res.success, true);
    assert.ok(sent, 'The backend API must be called');

    assert.equal(sent.employeeId, "EMP0012");
    assert.equal(sent.date, "2026-09-30");
    assert.equal(sent.punchIn, "09:12:00");
    assert.equal(sent.punchOut, "18:30:00");
    assert.equal(sent.shiftCode, "SH_GEN_01");
    assert.equal(sent.status, "PRESENT");
    assert.equal(sent.adminRemark, "Manual swipe regularization per manager approval");
    assert.equal(typeof sent.lateMinutes, "number");
    assert.equal(typeof sent.totalHoursWorked, "number");
});

test('3b. Manual attendance without an employee and date is rejected before any API call', async () => {
    const ctrl = new AdminAttendanceControllerClass();
    let called = false;
    ctrl.init({ api: { localDateStr: (d) => d.toISOString().split('T')[0], recordAttendance: async () => { called = true; return { success: true, data: {} }; } } });
    assert.equal(await ctrl.recordAttendance({ date: "2026-09-30" }), null);
    assert.equal(called, false);
});

test('4. Real-Time Team Attendance Filtering Engine (Tabs, Presets, Departments)', () => {
    const ctrl = new AdminAttendanceControllerClass();
    ctrl.filters.presetPeriod = 'all'; // fixture records are dated 2026-09-30; the default 'today' only matched on that day
    ctrl.records = [
        {
            attendanceId: "ATT-1",
            employeeId: "EMP0012",
            employeeName: "Rahul Sharma",
            department: "Engineering",
            date: "2026-09-30",
            punchIn: "09:12:00",
            punchOut: "18:30:00",
            shiftCode: "SH_GEN_01",
            status: "PRESENT",
            isLate: false,
            lateMinutes: 12,
            totalHoursWorked: 8.5
        },
        {
            attendanceId: "ATT-2",
            employeeId: "EMP0024",
            employeeName: "Priya Patel",
            department: "Finance & Accounts",
            date: "2026-09-30",
            punchIn: "09:35:00",
            punchOut: "18:00:00",
            shiftCode: "SH_GEN_01",
            status: "LATE",
            isLate: true,
            lateMinutes: 35,
            totalHoursWorked: 7.6
        },
        {
            attendanceId: "ATT-3",
            employeeId: "EMP0035",
            employeeName: "Amit Verma",
            department: "Sales & Client Delivery",
            date: "2026-09-30",
            punchIn: "--:--",
            punchOut: "--:--",
            shiftCode: "SH_GEN_01",
            status: "ABSENT",
            isLate: false,
            lateMinutes: 0,
            totalHoursWorked: 0
        }
    ];

    // Filter by Tab
    ctrl.filters.statusTab = 'PRESENT';
    const presentOnly = ctrl.getFilteredRecords();
    assert.equal(presentOnly.length, 1);
    assert.equal(presentOnly[0].employeeId, 'EMP0012');

    ctrl.filters.statusTab = 'LATE';
    const lateOnly = ctrl.getFilteredRecords();
    assert.equal(lateOnly.length, 1);
    assert.equal(lateOnly[0].employeeId, 'EMP0024');

    ctrl.filters.statusTab = 'ABSENT';
    const absentOnly = ctrl.getFilteredRecords();
    assert.equal(absentOnly.length, 1);
    assert.equal(absentOnly[0].employeeId, 'EMP0035');

    ctrl.filters.statusTab = 'ALL';
    assert.equal(ctrl.getFilteredRecords().length, 3);

    // Filter by Department
    ctrl.filters.department = 'Engineering';
    const engOnly = ctrl.getFilteredRecords();
    assert.equal(engOnly.length, 1);
    assert.equal(engOnly[0].employeeId, 'EMP0012');
    ctrl.filters.department = 'ALL';

    // Search query filter
    ctrl.filters.searchQuery = 'Priya';
    const searched = ctrl.getFilteredRecords();
    assert.equal(searched.length, 1);
    assert.equal(searched[0].employeeId, 'EMP0024');
    ctrl.filters.searchQuery = '';
});

test('5. End-to-End Headless Browser Verification (Puppeteer UI & Interaction)', async () => {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: CHROME_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.goto('http://localhost:3000/admin-attendance-monitor.html', {
            waitUntil: 'networkidle0',
            timeout: 20000
        });

        // 1. Verify Super Admin Attendance Toolbar
        const toolbarTitle = await page.$eval('.att-toolbar-info h2', el => el.innerText);
        assert.ok(toolbarTitle.includes('Super Admin Attendance Controls'), 'Toolbar title must be present');

        // 2. Verify Action Buttons
        const hasExportBtn = await page.$('#btnExportAttendanceExcel');
        const hasRecordBtn = await page.$('#btnOpenRecordAttendanceModal');
        assert.ok(hasExportBtn, 'Export Excel button must exist');
        assert.ok(hasRecordBtn, 'Record Attendance button must exist');

        // 3. Verify Preset Intervals and Filter Bar
        const presetCount = await page.$$eval('.att-preset-btn', els => els.length);
        assert.equal(presetCount >= 5, true, 'At least 5 preset interval buttons');

        // 4. Verify Status Tabs
        const tabCount = await page.$$eval('.att-tab-item', els => els.length);
        assert.equal(tabCount >= 5, true, 'At least 5 status tabs (All, Present, Late, Absent, Reg)');

        // 5. Verify Centralized Attendance Table
        const tableHeader = await page.$eval('.att-console-title h3', el => el.innerText);
        assert.ok(tableHeader.includes('Organization-Wide Attendance Console'));

        const rowsCount = await page.$$eval('#attConsoleTableBody tr', els => els.length);
        assert.equal(rowsCount >= 1, true, 'Table rows must be rendered');

        // 6. Test Modal Trigger & Dynamic Recalculation Preview
        await page.click('#btnOpenRecordAttendanceModal');
        await page.waitForSelector('#attManualModal.active', { timeout: 3000 });

        // Update Punch In & Out times
        await page.$eval('#attManualPunchIn', el => {
            el.value = '09:30:00';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await page.$eval('#attManualPunchOut', el => {
            el.value = '18:30:00';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Check that dynamic recalculation preview updated to late
        const latePreviewText = await page.$eval('#attCalcLateVal', el => el.innerText);
        assert.ok(latePreviewText.includes('Late') || latePreviewText.includes('+30m'), 'Calculation preview should reflect late arrival');

        // 7. Close modal
        await page.$eval('#btnCancelManualAttModal', el => el.click());
        await page.waitForFunction(() => {
            const modal = document.getElementById('attManualModal');
            return !modal || !modal.classList.contains('active');
        }, { timeout: 3000 });

        // 8. Tab click delegation test (ensure no page redirect)
        const currentUrl = page.url();
        await page.$eval('.att-tab-item[data-tab="LATE"]', el => el.click());
        assert.equal(page.url(), currentUrl, 'Status tab clicks must not cause external page redirects');

    } finally {
        await browser.close();
    }
});
