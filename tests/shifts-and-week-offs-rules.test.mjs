import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Import Shift Parser (CJS/UMD module)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const shiftParser = require('../services/shift-parser.js');
const shiftService = require('../shiftCalculationService.js');
const XLSX = require('../utils/xlsx.full.min.js');

// 2. Import Template Parser Service (ES module)
import { parseShiftSheet, ingestTemplatesWorkbook } from '../services/template-parser-service.js';

test('KYLRX SHIFTS & ATTENDANCE SUITE - PRD Sections 1, 13, & 16', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (13 Attributes)', () => {
        const rawRow = {
            'Shift_Code': 'SH_GEN_01',
            'Shift_Name': 'General Corporate Shift',
            'Start_Time': '09:30',
            'End_Time': '18:30',
            'Break_Minutes': '60',
            'Grace_In_Minutes': '15',
            'Grace_Out_Minutes': '15',
            'Half_Day_Minutes': '240',
            'Full_Day_Minutes': '480',
            'Night_Shift': 'No',
            'Overtime_Eligible': 'Yes',
            'Weekly_Off_Pattern': 'Sun',
            'Active': 'Yes'
        };

        const result = shiftParser.parseShiftRow(rawRow, 0, new Set());
        assert.equal(result.valid, true, 'Row must validate successfully');
        const rec = result.record;

        // Verify exact 13 attributes
        assert.equal(rec['Shift_Code'], 'SH_GEN_01');
        assert.equal(rec['Shift_Name'], 'General Corporate Shift');
        assert.equal(rec['Start_Time'], '09:30');
        assert.equal(rec['End_Time'], '18:30');
        assert.equal(rec['Break_Minutes'], 60);
        assert.equal(rec['Grace_In_Minutes'], 15);
        assert.equal(rec['Grace_Out_Minutes'], 15);
        assert.equal(rec['Half_Day_Minutes'], 240);
        assert.equal(rec['Full_Day_Minutes'], 480);
        assert.equal(rec['Night_Shift'], 'No');
        assert.equal(rec['Overtime_Eligible'], 'Yes');
        assert.equal(rec['Weekly_Off_Pattern'], 'Sun');
        assert.equal(rec['Active'], 'Yes');

        // Normalized properties
        assert.equal(rec.shiftCode, 'SH_GEN_01');
        assert.equal(rec.shiftName, 'General Corporate Shift');
        assert.equal(rec.breakMinutes, 60);
        assert.equal(rec.isNightShift, false);
        assert.equal(rec.isOvertimeEligible, true);
        assert.equal(rec.isActive, true);
    });

    await t.test('2. Numerical Validation & Yes/No Boolean Normalization', () => {
        const rowWithStringsAndVariants = {
            'Shift_Code': 'SH_MORN_01',
            'Shift_Name': 'Morning Shift',
            'Start_Time': '6:00 AM',
            'End_Time': '2:30 PM',
            'Break_Minutes': '30 mins',
            'Grace_In_Minutes': '10',
            'Grace_Out_Minutes': '10',
            'Half_Day_Minutes': '210',
            'Full_Day_Minutes': '450',
            'Night_Shift': 'false',
            'Overtime_Eligible': 'true',
            'Weekly_Off_Pattern': 'Sun',
            'Active': 'enabled'
        };

        const result = shiftParser.parseShiftRow(rowWithStringsAndVariants, 0, new Set());
        assert.equal(result.valid, true);
        assert.equal(result.record.startTime, '06:00');
        assert.equal(result.record.endTime, '14:30');
        assert.equal(result.record.graceInMinutes, 10);
        assert.equal(result.record.graceOutMinutes, 10);
        assert.equal(result.record.halfDayMinutes, 210);
        assert.equal(result.record.fullDayMinutes, 450);
        assert.equal(result.record.isNightShift, false);
        assert.equal(result.record.isOvertimeEligible, true);
        assert.equal(result.record.isActive, true);
    });

    await t.test('3. Rejects Missing PK and Flags Duplicate Shift Codes', () => {
        const seen = new Set();
        const rowMissingCode = { 'Shift_Name': 'No Code Shift' };
        const res1 = shiftParser.parseShiftRow(rowMissingCode, 0, seen);
        assert.equal(res1.valid, false);
        assert.ok(res1.errors.some(e => e.includes('Shift_Code')));

        const rowValid = { 'Shift_Code': 'SH_DUP_01', 'Shift_Name': 'Valid Shift' };
        const res2 = shiftParser.parseShiftRow(rowValid, 1, seen);
        assert.equal(res2.valid, true);

        const rowDuplicate = { 'Shift_Code': 'SH_DUP_01', 'Shift_Name': 'Duplicate Shift' };
        const res3 = shiftParser.parseShiftRow(rowDuplicate, 2, seen);
        assert.equal(res3.valid, false);
        assert.ok(res3.errors.some(e => e.includes('Duplicate Shift_Code')));
    });

    await t.test('4. Dynamic Attendance Engine: Standard Day Shift (On-Time Full Day)', () => {
        // Shift: 09:30 to 18:30, Break: 60m, GraceIn: 15m, GraceOut: 15m, FullDay: 480m
        const shift = {
            shiftCode: 'SH_GEN_01',
            shiftName: 'General Shift',
            startTime: '09:30',
            endTime: '18:30',
            breakMinutes: 60,
            graceInMinutes: 15,
            graceOutMinutes: 15,
            halfDayMinutes: 240,
            fullDayMinutes: 480,
            isNightShift: false,
            isOvertimeEligible: true
        };

        // Punch: 09:35 to 18:35 (9h duration = 540m. Net = 540 - 60 = 480m)
        const att = shiftService.calculateAttendance({
            punchIn: '09:35',
            punchOut: '18:35',
            shift
        });

        assert.equal(att.isLate, false, '09:35 is within 15 min grace (09:45 threshold)');
        assert.equal(att.lateMinutes, 0);
        assert.equal(att.isEarlyOut, false, '18:35 is after 18:15 threshold');
        assert.equal(att.earlyMinutes, 0);
        assert.equal(att.totalDurationMinutes, 540);
        assert.equal(att.netWorkedMinutes, 480);
        assert.equal(att.status, 'PRESENT', 'Net worked >= 480 minutes should be PRESENT');
        assert.equal(att.isOvertime, false);
        assert.equal(att.overtimeMinutes, 0);
    });

    await t.test('5. Dynamic Attendance Engine: Late In & Early Out Calculation', () => {
        const shift = {
            shiftCode: 'SH_GEN_01',
            startTime: '09:30',
            endTime: '18:30',
            breakMinutes: 60,
            graceInMinutes: 15,
            graceOutMinutes: 15,
            halfDayMinutes: 240,
            fullDayMinutes: 480,
            isNightShift: false,
            isOvertimeEligible: true
        };

        // Arrived at 10:00 (30 mins late from 09:30, exceeds 15m grace)
        // Left at 18:00 (30 mins early from 18:30, exceeds 15m grace)
        const att = shiftService.calculateAttendance({
            punchIn: '10:00',
            punchOut: '18:00',
            shift
        });

        assert.equal(att.isLate, true);
        assert.equal(att.lateMinutes, 30, 'Late minutes = 10:00 - 09:30 = 30m');
        assert.equal(att.isEarlyOut, true);
        assert.equal(att.earlyMinutes, 30, 'Early minutes = 18:30 - 18:00 = 30m');
        assert.equal(att.totalDurationMinutes, 480);
        assert.equal(att.netWorkedMinutes, 420); // 480 - 60
        assert.equal(att.status, 'HALF_DAY', '420m is < 480m but >= 240m, so HALF_DAY');
    });

    await t.test('6. Dynamic Attendance Engine: Absent Threshold', () => {
        const shift = {
            shiftCode: 'SH_GEN_01',
            startTime: '09:30',
            endTime: '18:30',
            breakMinutes: 60,
            graceInMinutes: 15,
            graceOutMinutes: 15,
            halfDayMinutes: 240,
            fullDayMinutes: 480,
            isNightShift: false,
            isOvertimeEligible: true
        };

        // Worked from 10:00 to 13:00 (180 mins total. Net = 180 - 60 = 120m < 240m Half Day)
        const att = shiftService.calculateAttendance({
            punchIn: '10:00',
            punchOut: '13:00',
            shift
        });

        assert.equal(att.netWorkedMinutes, 120);
        assert.equal(att.status, 'ABSENT', 'Net worked < 240m must be ABSENT');
    });

    await t.test('7. Dynamic Attendance Engine: Overtime Calculation', () => {
        const shift = {
            shiftCode: 'SH_GEN_01',
            startTime: '09:30',
            endTime: '18:30',
            breakMinutes: 60,
            halfDayMinutes: 240,
            fullDayMinutes: 480,
            isOvertimeEligible: true
        };

        // Worked 11 hours (09:00 to 20:00 = 660 mins. Net = 660 - 60 = 600m. OT = 600 - 480 = 120m)
        const att = shiftService.calculateAttendance({
            punchIn: '09:00',
            punchOut: '20:00',
            shift
        });

        assert.equal(att.totalDurationMinutes, 660);
        assert.equal(att.netWorkedMinutes, 600);
        assert.equal(att.status, 'PRESENT');
        assert.equal(att.isOvertime, true);
        assert.equal(att.overtimeMinutes, 120, 'Overtime should be 120 minutes (2 hours)');
    });

    await t.test('8. Dynamic Attendance Engine: Night Shift Cross-Midnight Evaluation', () => {
        // Night Shift: 22:00 to 06:30 (cross-midnight), Break: 45m, FullDay: 465m
        const nightShift = {
            shiftCode: 'SH_NIGHT_01',
            shiftName: 'Overnight Shift',
            startTime: '22:00',
            endTime: '06:30',
            breakMinutes: 45,
            graceInMinutes: 15,
            graceOutMinutes: 15,
            halfDayMinutes: 240,
            fullDayMinutes: 465,
            isNightShift: true,
            isOvertimeEligible: true
        };

        // In at 22:05 (within grace), Out next day at 06:35
        // Duration: 22:05 to 06:35 = 8h 30m = 510m. Net = 510 - 45 = 465m
        const att = shiftService.calculateAttendance({
            punchIn: '22:05',
            punchOut: '06:35',
            shift: nightShift
        });

        assert.equal(att.isNightShift, true);
        assert.equal(att.isLate, false, '22:05 is within grace (threshold 22:15)');
        assert.equal(att.isEarlyOut, false, '06:35 is after 06:15 grace threshold');
        assert.equal(att.totalDurationMinutes, 510);
        assert.equal(att.netWorkedMinutes, 465);
        assert.equal(att.status, 'PRESENT', 'Should be marked PRESENT');
    });

    await t.test('9. Weekly Off Pattern Evaluator ("Sun", "Sat,Sun", "2nd_4th_Sat,Sun")', () => {
        // Test Sundays
        const sunday = new Date('2026-10-04'); // Sunday
        assert.equal(shiftService.isWeeklyOff(sunday, 'Sun'), true);
        assert.equal(shiftService.isWeeklyOff(sunday, 'Sat,Sun'), true);

        // Test Mondays
        const monday = new Date('2026-10-05'); // Monday
        assert.equal(shiftService.isWeeklyOff(monday, 'Sun'), false);
        assert.equal(shiftService.isWeeklyOff(monday, 'Mon'), true);

        // Test 2nd and 4th Saturday
        // 2026-10-03 is 1st Saturday (Day 3)
        const firstSat = new Date('2026-10-03');
        assert.equal(shiftService.isWeeklyOff(firstSat, '2nd_4th_Sat,Sun'), false);

        // 2026-10-10 is 2nd Saturday (Day 10)
        const secondSat = new Date('2026-10-10');
        assert.equal(shiftService.isWeeklyOff(secondSat, '2nd_4th_Sat,Sun'), true);

        // 2026-10-17 is 3rd Saturday (Day 17)
        const thirdSat = new Date('2026-10-17');
        assert.equal(shiftService.isWeeklyOff(thirdSat, '2nd_4th_Sat,Sun'), false);

        // 2026-10-24 is 4th Saturday (Day 24)
        const fourthSat = new Date('2026-10-24');
        assert.equal(shiftService.isWeeklyOff(fourthSat, '2nd_4th_Sat,Sun'), true);
    });

    await t.test('10. Cloud Firestore CRUD Operations and Schema Path', async () => {
        // Path verification: organizations/{orgId}/shifts/{shiftCode}
        const path = shiftService.getFirestorePath('SH_TEST_01', 'org_kylrx');
        assert.equal(path, 'organizations/org_kylrx/shifts/SH_TEST_01');

        // Create
        const created = await shiftService.createShift({
            shiftCode: 'SH_TEST_01',
            shiftName: 'Test Automation Shift',
            startTime: '08:00',
            endTime: '17:00',
            breakMinutes: 60,
            graceInMinutes: 10,
            graceOutMinutes: 10,
            halfDayMinutes: 240,
            fullDayMinutes: 480,
            isNightShift: false,
            isOvertimeEligible: true,
            weeklyOffPattern: 'Sun',
            isActive: true
        });

        assert.equal(created.shiftCode, 'SH_TEST_01');
        assert.equal(shiftService.getShift('SH_TEST_01').shiftName, 'Test Automation Shift');

        // Update
        const updated = await shiftService.updateShift('SH_TEST_01', {
            shiftName: 'Updated Shift Name',
            breakMinutes: 45
        });
        assert.equal(updated.shiftName, 'Updated Shift Name');
        assert.equal(updated.breakMinutes, 45);

        // Toggle Status
        const toggled = await shiftService.toggleShiftStatus('SH_TEST_01');
        assert.equal(toggled.isActive, false);

        // Delete
        const deleted = await shiftService.deleteShift('SH_TEST_01');
        assert.equal(deleted, true);
        assert.equal(shiftService.getShift('SH_TEST_01'), null);
    });

    await t.test('11. Ingest Templates.xlsx Official Workbook with "Shifts & Week-offs"', async () => {
        const templatePath = path.join(rootDir, 'assets/Templates.xlsx');
        assert.ok(fs.existsSync(templatePath), 'Templates.xlsx must exist');

        const buffer = fs.readFileSync(templatePath);
        const wb = XLSX.read(buffer, { type: 'buffer' });

        // Verify sheet exists
        assert.ok(wb.SheetNames.includes('Shifts & Week-offs'), 'Workbook must contain "Shifts & Week-offs" sheet');

        // Parse with template-parser-service
        const result = ingestTemplatesWorkbook(wb, XLSX.utils);
        assert.ok(result.shifts && result.shifts.length >= 5, 'Must parse at least 5 default enterprise shifts');

        const genShift = result.shifts.find(s => s.Shift_Code === 'SH_GEN_01');
        assert.ok(genShift, 'Must find SH_GEN_01');
        assert.equal(genShift.Shift_Name, 'General Corporate Shift');
        assert.equal(genShift.Start_Time, '09:30');
        assert.equal(genShift.End_Time, '18:30');
        assert.equal(genShift.Break_Minutes, 60);
        assert.equal(genShift.Grace_In_Minutes, 15);
        assert.equal(genShift.Grace_Out_Minutes, 15);
        assert.equal(genShift.Half_Day_Minutes, 240);
        assert.equal(genShift.Full_Day_Minutes, 480);
        assert.equal(genShift.Night_Shift, 'No');
        assert.equal(genShift.Overtime_Eligible, 'Yes');
        assert.equal(genShift.Weekly_Off_Pattern, 'Sun');
        assert.equal(genShift.Active, 'Yes');

        const nightShift = result.shifts.find(s => s.Shift_Code === 'SH_NIGHT_01');
        assert.ok(nightShift, 'Must find SH_NIGHT_01');
        assert.equal(nightShift.Night_Shift, 'Yes');
        assert.equal(nightShift.isNightShift, true);
    });
});
