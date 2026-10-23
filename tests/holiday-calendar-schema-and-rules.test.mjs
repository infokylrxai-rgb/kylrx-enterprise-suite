/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - HOLIDAY CALENDAR TEST SUITE
 * ============================================================================
 * 
 * Verifies Holiday Calendar configuration, sheet parsing, date sanitization,
 * foreign key validation, deduplication, dynamic attendance interlocks,
 * optional floating holiday workflow, and payroll calculation linkage
 * matching PRD Sections 1, 4, 15, & 16 and the 'Holiday Calendar' sheet from Templates.xlsx.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsxNamespace from 'xlsx';
const xlsx = xlsxNamespace.default || xlsxNamespace;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load HolidayCalendarParser (UMD module)
const parserPath = path.join(rootDir, 'holidayCalendarParser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const HolidayParser = parserModule.exports;

// Load HolidayCalendarService (UMD module)
const servicePath = path.join(rootDir, 'holidayCalendarService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const HolidayService = serviceModule.exports;

// Load AttendancePolicyService
const attServicePath = path.join(rootDir, 'attendancePolicyService.js');
const attContent = fs.readFileSync(attServicePath, 'utf8');
const attModule = { exports: {} };
const attFn = new Function('module', 'exports', 'require', attContent);
attFn(attModule, attModule.exports, () => ({}));
const AttendanceService = attModule.exports;

test('PRD Sections 1, 4, 15, & 16: Holiday Calendar & Evaluation Engine Suite', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (All 9 Attributes)', async (st) => {
        assert.ok(HolidayParser, 'KylrxHolidayCalendarParser must be exported and available');
        const attrs = HolidayParser.HOLIDAY_CALENDAR_ATTRIBUTES;
        assert.equal(attrs.length, 9, 'Must define exactly 9 canonical attributes');

        const expectedKeys = [
            'Holiday_Calendar_Code',
            'Holiday_Calendar_Name',
            'Location_Code',
            'Holiday_Date',
            'Holiday_Name',
            'Holiday_Type',
            'Optional_Holiday',
            'Paid_Holiday',
            'Active'
        ];

        const actualKeys = attrs.map(a => a.key);
        for (const key of expectedKeys) {
            assert.ok(actualKeys.includes(key), `Attribute catalog must contain '${key}'`);
        }

        // Test normalizer mapping row
        const rawRow = {
            'Holiday_Calendar_Code': 'HOL_BLR_2026',
            'Holiday_Calendar_Name': 'Bengaluru General Calendar 2026',
            'Location_Code': 'LOC_BLR_01',
            'Holiday_Date': '2026-10-02',
            'Holiday_Name': 'Gandhi Jayanti',
            'Holiday_Type': 'National',
            'Optional_Holiday': 'No',
            'Paid_Holiday': 'Yes',
            'Active': 'Yes'
        };

        const normalized = HolidayParser.normalizeHolidayRow(rawRow, 0);
        assert.equal(normalized.Holiday_Calendar_Code, 'HOL_BLR_2026');
        assert.equal(normalized.Holiday_Calendar_Name, 'Bengaluru General Calendar 2026');
        assert.equal(normalized.Location_Code, 'LOC_BLR_01');
        assert.equal(normalized.Holiday_Date, '2026-10-02');
        assert.equal(normalized.Holiday_Name, 'Gandhi Jayanti');
        assert.equal(normalized.Holiday_Type, 'National');
        assert.equal(normalized.Optional_Holiday, false);
        assert.equal(normalized.Paid_Holiday, true);
        assert.equal(normalized.Active, true);
    });

    await t.test('2. Setup & Ingestion Support (PRD Section 1 - SheetJS, Date Sanitization & Deduplication)', async (st) => {
        // Test date sanitization across multiple formats (ISO, DD/MM/YYYY, Excel serial)
        assert.equal(HolidayParser.sanitizeIsoDate('2026-10-02'), '2026-10-02');
        assert.equal(HolidayParser.sanitizeIsoDate('02/10/2026'), '2026-10-02');
        assert.equal(HolidayParser.sanitizeIsoDate('2026-10-02T10:30:00.000Z'), '2026-10-02');
        assert.equal(HolidayParser.sanitizeIsoDate(new Date('2026-10-02T00:00:00.000Z')), '2026-10-02');
        
        // Test Excel numeric serial
        const excelSerial = 46297; // 2026-10-02
        assert.equal(HolidayParser.sanitizeIsoDate(excelSerial), '2026-10-02');
        assert.equal(HolidayParser.sanitizeIsoDate(46298), '2026-10-03');

        // Test boolean normalization
        assert.equal(HolidayParser.sanitizeBoolean('Yes'), true);
        assert.equal(HolidayParser.sanitizeBoolean('No'), false);
        assert.equal(HolidayParser.sanitizeBoolean('Y'), true);
        assert.equal(HolidayParser.sanitizeBoolean('N'), false);
        assert.equal(HolidayParser.sanitizeBoolean(1), true);
        assert.equal(HolidayParser.sanitizeBoolean(0), false);

        // Test Foreign Key validation: verify Location_Code maps to active office location
        const invalidLocationRows = [
            {
                'Holiday_Calendar_Code': 'HOL_XYZ_2026',
                'Holiday_Calendar_Name': 'Invalid Location Calendar',
                'Location_Code': 'LOC_NONEXISTENT_99',
                'Holiday_Date': '2026-10-02',
                'Holiday_Name': 'Test Holiday',
                'Holiday_Type': 'National',
                'Optional_Holiday': 'No',
                'Paid_Holiday': 'Yes',
                'Active': 'Yes'
            }
        ];

        const invalidLocResult = HolidayParser.parseHolidayCalendarSheet(invalidLocationRows);
        assert.equal(invalidLocResult.valid, false);
        assert.ok(invalidLocResult.errors.some(e => e.includes('does not reference an active location in \'locations\' collection')));

        // Test Deduplication: prevent identical Holiday_Date entries under same Calendar Code and Location
        const duplicateDateRows = [
            {
                'Holiday_Calendar_Code': 'HOL_BLR_2026',
                'Holiday_Calendar_Name': 'Bengaluru General Calendar 2026',
                'Location_Code': 'LOC_BLR_01',
                'Holiday_Date': '2026-10-02',
                'Holiday_Name': 'Gandhi Jayanti',
                'Holiday_Type': 'National',
                'Optional_Holiday': 'No',
                'Paid_Holiday': 'Yes',
                'Active': 'Yes'
            },
            {
                'Holiday_Calendar_Code': 'HOL_BLR_2026',
                'Holiday_Calendar_Name': 'Bengaluru General Calendar 2026',
                'Location_Code': 'LOC_BLR_01',
                'Holiday_Date': '2026-10-02',
                'Holiday_Name': 'Duplicate Gandhi Jayanti Entry',
                'Holiday_Type': 'National',
                'Optional_Holiday': 'No',
                'Paid_Holiday': 'Yes',
                'Active': 'Yes'
            }
        ];

        const dedupeResult = HolidayParser.parseHolidayCalendarSheet(duplicateDateRows);
        assert.equal(dedupeResult.valid, false);
        assert.ok(dedupeResult.errors.some(e => e.includes('Duplicate entry detected')));

        // Test Live Templates.xlsx file ingestion via SheetJS
        const templatesPath = path.join(rootDir, 'Templates.xlsx');
        assert.ok(fs.existsSync(templatesPath), 'Templates.xlsx must exist');
        const wb = xlsx.readFile(templatesPath);
        const sheet = wb.Sheets['Holiday Calendar'] || wb.Sheets['Holiday_Calendar'];
        assert.ok(sheet, 'Holiday Calendar sheet must be present in Templates.xlsx');

        const rawRows = xlsx.utils.sheet_to_json(sheet);
        assert.ok(rawRows.length >= 10, 'Templates.xlsx must contain realistic holiday rows');

        const parseResult = HolidayParser.parseHolidayCalendarSheet(rawRows);
        assert.equal(parseResult.valid, true, `Ingestion of Templates.xlsx must have zero errors. Found: ${parseResult.errors.join(', ')}`);
        assert.ok(parseResult.records.length >= 10);
        assert.ok(parseResult.firestoreDocs.length >= 10);
    });

    await t.test('3. CRUD Operations and Location Resolution', async (st) => {
        const orgId = 'test_org_01';

        // Create new calendar
        const newCal = await HolidayService.createOrUpdateCalendar(orgId, {
            calendarCode: 'HOL_HYD_2026',
            calendarName: 'Hyderabad Tech Hub Calendar 2026',
            locationCode: 'LOC_HYD_01',
            year: 2026,
            isActive: true
        });
        assert.equal(newCal.calendarCode, 'HOL_HYD_2026');
        assert.equal(newCal.locationCode, 'LOC_HYD_01');

        // Add itemized holidays
        const savedH1 = await HolidayService.saveHoliday(orgId, 'HOL_HYD_2026', {
            holidayDate: '2026-06-02',
            holidayName: 'Telangana Formation Day',
            holidayType: 'Regional',
            isOptional: false,
            isPaid: true,
            isActive: true
        });
        assert.equal(savedH1.holidayName, 'Telangana Formation Day');
        assert.equal(savedH1.isPaid, true);

        // Add an optional floating holiday
        const savedH2 = await HolidayService.saveHoliday(orgId, 'HOL_HYD_2026', {
            holidayDate: '2026-08-27',
            holidayName: 'Varalakshmi Vratam',
            holidayType: 'Restricted',
            isOptional: true,
            isPaid: true,
            isActive: true
        });
        assert.equal(savedH2.isOptional, true);

        // Retrieve calendar
        const fetched = await HolidayService.getCalendar(orgId, 'HOL_HYD_2026');
        assert.ok(fetched);
        assert.equal(fetched.holidays.length, 2);

        // Location Resolution
        const resolvedCal = await HolidayService.resolveEmployeeHolidayCalendar(orgId, 'LOC_HYD_01', '2026-06-02');
        assert.equal(resolvedCal.calendarCode, 'HOL_HYD_2026');

        // Check date holiday status
        const isHoliday = await HolidayService.isDateHolidayForEmployee(orgId, 'LOC_HYD_01', '2026-06-02');
        assert.equal(isHoliday.isHoliday, true);
        assert.equal(isHoliday.isMandatory, true);
        assert.equal(isHoliday.holidayName, 'Telangana Formation Day');

        // Toggle flag
        const toggled = await HolidayService.toggleHolidayFlag(orgId, 'HOL_HYD_2026', savedH1.id, 'isPaid');
        assert.equal(toggled.isPaid, false);

        // Delete holiday
        const deleted = await HolidayService.deleteHoliday(orgId, 'HOL_HYD_2026', savedH1.id);
        assert.equal(deleted, true);
        const refetched = await HolidayService.getCalendar(orgId, 'HOL_HYD_2026');
        assert.equal(refetched.holidays.length, 1);
    });

    await t.test('4. Attendance Rules Interlock (PRD Sections 15 & 16)', async (st) => {
        const orgId = 'test_org_01';
        const locationCode = 'LOC_BLR_01';

        // Ensure Republic Day (Mandatory Paid Holiday) is in BLR calendar
        await HolidayService.saveHoliday(orgId, 'HOL_BLR_2026', {
            locationCode: 'LOC_BLR_01',
            holidayDate: '2026-01-26',
            holidayName: 'Republic Day',
            holidayType: 'National',
            isOptional: false,
            isPaid: true,
            isActive: true
        });

        // 1. Employee did NOT punch on mandatory holiday:
        // Automatically flag status as 'HOLIDAY'
        const evalNoPunch = await HolidayService.evaluateDailyAttendance(null, locationCode, '2026-01-26', { orgId });
        assert.equal(evalNoPunch.status, 'HOLIDAY');
        assert.equal(evalNoPunch.isHoliday, true);
        assert.equal(evalNoPunch.holidayWorked, false);
        assert.equal(evalNoPunch.isPaid, true);

        // Interlock with AttendancePolicyService:
        const polEvalNoPunch = AttendanceService.evaluatePunchStatus({
            punchIn: null,
            holiday: { holidayName: 'Republic Day', isMandatory: true, isPaid: true }
        });
        assert.equal(polEvalNoPunch.status, 'HOLIDAY');

        // 2. Employee punches in on a Paid_Holiday:
        // Mark status as 'HOLIDAY_WORKED' and make eligible for holiday overtime or Comp-Off accrual
        const evalWorked = await HolidayService.evaluateDailyAttendance({
            punchIn: '09:15',
            punchOut: '18:15',
            durationHours: 9.0
        }, locationCode, '2026-01-26', { orgId });

        assert.equal(evalWorked.status, 'HOLIDAY_WORKED');
        assert.equal(evalWorked.holidayWorked, true);
        assert.equal(evalWorked.holidayOvertimeEligible, true);
        assert.equal(evalWorked.compOffAccrualEligible, true);
        assert.equal(evalWorked.compOffCredits, 1);

        // Interlock with AttendancePolicyService:
        const polEvalWorked = AttendanceService.evaluatePunchStatus({
            punchIn: '09:15',
            startTime: '09:30',
            holiday: { holidayName: 'Republic Day', isMandatory: true, isPaid: true }
        });
        assert.equal(polEvalWorked.status, 'HOLIDAY_WORKED');
        assert.equal(polEvalWorked.holidayOvertimeEligible, true);
        assert.equal(polEvalWorked.compOffAccrualEligible, true);
    });

    await t.test('5. Optional / Floating Holiday Workflow & Annual Quota (PRD § 16)', async (st) => {
        const orgId = 'test_org_01';
        const empId = 'EMP0001';

        // Add 3 optional holidays in calendar
        await HolidayService.saveHoliday(orgId, 'HOL_BLR_2026', {
            locationCode: 'LOC_BLR_01',
            holidayDate: '2026-03-04',
            holidayName: 'Maha Shivratri',
            holidayType: 'Restricted',
            isOptional: true,
            isPaid: true,
            isActive: true
        });
        await HolidayService.saveHoliday(orgId, 'HOL_BLR_2026', {
            locationCode: 'LOC_BLR_01',
            holidayDate: '2026-08-27',
            holidayName: 'Raksha Bandhan',
            holidayType: 'Restricted',
            isOptional: true,
            isPaid: true,
            isActive: true
        });
        await HolidayService.saveHoliday(orgId, 'HOL_BLR_2026', {
            locationCode: 'LOC_BLR_01',
            holidayDate: '2026-11-09',
            holidayName: 'Balipratipada',
            holidayType: 'Restricted',
            isOptional: true,
            isPaid: true,
            isActive: true
        });

        // 1. Employee fetches available optional holidays
        const optList = await HolidayService.getOptionalHolidaysForEmployee(orgId, empId, 2026);
        assert.ok(optList.length >= 2);
        assert.ok(optList.every(h => h.isOptional));

        // 2. Claim 1st optional holiday
        const claim1 = await HolidayService.applyOptionalHoliday(orgId, empId, null, '2026-03-04', 'Maha Shivratri festival');
        assert.equal(claim1.status, 'APPROVED');
        assert.equal(claim1.holidayDate, '2026-03-04');

        // 3. Claim 2nd optional holiday
        const claim2 = await HolidayService.applyOptionalHoliday(orgId, empId, null, '2026-08-27', 'Family festival');
        assert.equal(claim2.status, 'APPROVED');

        // 4. Try to claim 3rd optional holiday (exceeds annual quota of 2)
        await assert.rejects(async () => {
            await HolidayService.applyOptionalHoliday(orgId, empId, null, '2026-11-09', 'Exceeds quota');
        }, /Optional Holiday Quota exceeded/);

        // 5. Evaluate attendance on claimed optional holiday
        const evalClaimedDay = await HolidayService.evaluateDailyAttendance(null, empId, '2026-03-04', { orgId });
        assert.equal(evalClaimedDay.status, 'OPTIONAL_HOLIDAY_TAKEN');
    });

    await t.test('6. Payroll Calculation Linkage (PRD Section 4)', async (st) => {
        const monthlyGross = 60000;
        const monthDays = 30; // daily rate = ₹2,000

        // Case A: Standard month with 2 Paid Holidays (0 LOP deduction, full compensation credited)
        const holidaysPaid = [
            { holidayDate: '2026-10-02', holidayName: 'Gandhi Jayanti', isPaid: true, isActive: true },
            { holidayDate: '2026-10-20', holidayName: 'Dussehra', isPaid: true, isActive: true }
        ];

        const payrollPaid = HolidayService.evaluatePayrollHolidayImpact({
            monthlyGross,
            monthDays,
            holidayRecords: holidaysPaid,
            workedHolidayDates: []
        });

        assert.equal(payrollPaid.dailyRate, 2000);
        assert.equal(payrollPaid.lopDays, 0, 'Paid holiday must have 0 LOP days');
        assert.equal(payrollPaid.lopDeduction, 0, 'Paid holiday must have zero salary deduction');
        assert.equal(payrollPaid.holidayPayCredit, 4000, '2 paid holidays credit ₹4,000 daily pay');

        // Case B: Unpaid Holiday (computes salary prorating / LOP deduction)
        const holidaysUnpaid = [
            { holidayDate: '2026-10-02', holidayName: 'Gandhi Jayanti', isPaid: true, isActive: true },
            { holidayDate: '2026-10-20', holidayName: 'Unpaid Special Closure', isPaid: false, isActive: true }
        ];

        const payrollUnpaid = HolidayService.evaluatePayrollHolidayImpact({
            monthlyGross,
            monthDays,
            holidayRecords: holidaysUnpaid,
            workedHolidayDates: []
        });

        assert.equal(payrollUnpaid.lopDays, 1, 'Unpaid holiday incurs 1 LOP day');
        assert.equal(payrollUnpaid.lopDeduction, 2000, 'Unpaid holiday incurs ₹2,000 salary deduction');

        // Case C: Employee worked on a Paid Holiday (HOLIDAY_WORKED) -> Statutory overtime multiplier
        const payrollWorked = HolidayService.evaluatePayrollHolidayImpact({
            monthlyGross,
            monthDays,
            holidayRecords: holidaysPaid,
            workedHolidayDates: ['2026-10-02']
        });

        assert.equal(payrollWorked.workedHolidayCount, 1);
        assert.equal(payrollWorked.overtimePay, 2000, 'Statutory holiday overtime credits additional daily rate');
    });

    await t.test('7. Data Architecture & Cloud Firestore Document Schema (PRD § 5)', async (st) => {
        const orgId = 'test_corp_hq';
        const holidayDoc = await HolidayService.saveHoliday(orgId, 'HOL_BLR_2026', {
            calendarCode: 'HOL_BLR_2026',
            calendarName: 'Bengaluru General Calendar 2026',
            locationCode: 'LOC_BLR_01',
            holidayDate: '2026-10-02',
            holidayName: 'Gandhi Jayanti',
            holidayType: 'National',
            isOptional: false,
            isPaid: true,
            isActive: true
        });

        // Exact Cloud Firestore document schema validation matching PRD Spec:
        assert.equal(holidayDoc.calendarCode, 'HOL_BLR_2026');
        assert.equal(holidayDoc.calendarName, 'Bengaluru General Calendar 2026');
        assert.equal(holidayDoc.locationCode, 'LOC_BLR_01');
        assert.equal(holidayDoc.holidayDate, '2026-10-02');
        assert.equal(holidayDoc.holidayName, 'Gandhi Jayanti');
        assert.equal(holidayDoc.holidayType, 'National');
        assert.equal(holidayDoc.isOptional, false);
        assert.equal(holidayDoc.isPaid, true);
        assert.equal(holidayDoc.isActive, true);
        assert.ok(holidayDoc.createdAt);
        assert.ok(holidayDoc.updatedAt);
    });
});
