import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Import Attendance Policy Parser (CJS/UMD module)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const policyParser = require('../services/attendance-policy-parser.js');
const policyService = require('../attendancePolicyService.js');
const XLSX = require('../utils/xlsx.full.min.js');

// 2. Import Template Parser Service (ES module)
import { parseAttendancePolicySheet, ingestTemplatesWorkbook } from '../services/template-parser-service.js';

test('KYLRX ATTENDANCE RULES & POLICIES SUITE - PRD Sections 1, 15, & 16', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (Strict 13 Attributes)', () => {
        const rawRow = {
            'Attendance_Policy_Code': 'POL_STD_CORP',
            'Policy_Name': 'Standard Corporate Policy',
            'Late_After_Minutes': '15',
            'Early_Leaving_Grace_Minute': '10',
            'Absent_After_Hours': '4',
            'Regularization_Allowed': 'Yes',
            'Regularization_Window_Days': '7',
            'WFH_Allowed': 'Yes',
            'OT_Minimum_Minutes': '60',
            'OT_Approval_Required': 'Yes',
            'GeoFence_Required': 'No',
            'IP_Restricted': 'No',
            'Active': 'Yes'
        };

        const result = policyParser.parseAttendancePolicyRow(rawRow, 0, new Set());
        assert.equal(result.valid, true, 'Row must validate successfully');
        const rec = result.record;

        // Verify exact 13 attributes
        assert.equal(rec['Attendance_Policy_Code'], 'POL_STD_CORP');
        assert.equal(rec['Policy_Name'], 'Standard Corporate Policy');
        assert.equal(rec['Late_After_Minutes'], 15);
        assert.equal(rec['Early_Leaving_Grace_Minute'], 10);
        assert.equal(rec['Absent_After_Hours'], 4);
        assert.equal(rec['Regularization_Allowed'], 'Yes');
        assert.equal(rec['Regularization_Window_Days'], 7);
        assert.equal(rec['WFH_Allowed'], 'Yes');
        assert.equal(rec['OT_Minimum_Minutes'], 60);
        assert.equal(rec['OT_Approval_Required'], 'Yes');
        assert.equal(rec['GeoFence_Required'], 'No');
        assert.equal(rec['IP_Restricted'], 'No');
        assert.equal(rec['Active'], 'Yes');

        // Verify camelCase canonical properties
        assert.equal(rec.attendancePolicyCode, 'POL_STD_CORP');
        assert.equal(rec.policyName, 'Standard Corporate Policy');
        assert.equal(rec.lateAfterMinutes, 15);
        assert.equal(rec.earlyLeavingGraceMinute, 10);
        assert.equal(rec.absentAfterHours, 4);
        assert.equal(rec.regularizationAllowed, true);
        assert.equal(rec.regularizationWindowDays, 7);
        assert.equal(rec.wfhAllowed, true);
        assert.equal(rec.otMinimumMinutes, 60);
        assert.equal(rec.otApprovalRequired, true);
        assert.equal(rec.geoFenceRequired, false);
        assert.equal(rec.ipRestricted, false);
        assert.equal(rec.isActive, true);
    });

    await t.test('2. Numerical Validation & Yes/No Normalization to Booleans', () => {
        const rowWithFuzzyValues = {
            'Attendance_Policy_Code': 'POL_FACTORY_OPS',
            'Policy_Name': 'Plant Operations',
            'Late_After_Minutes': '5 mins',
            'Early_Leaving_Grace_Minute': '5 mins',
            'Absent_After_Hours': '2.5 hrs',
            'Regularization_Allowed': 'TRUE',
            'Regularization_Window_Days': '3 days',
            'WFH_Allowed': 'false',
            'OT_Minimum_Minutes': '30 mins',
            'OT_Approval_Required': 'YES',
            'GeoFence_Required': '1',
            'IP_Restricted': 'active',
            'Active': 'Y'
        };

        const result = policyParser.parseAttendancePolicyRow(rowWithFuzzyValues, 0, new Set());
        assert.equal(result.valid, true);
        const rec = result.record;

        assert.equal(rec.lateAfterMinutes, 5);
        assert.equal(rec.earlyLeavingGraceMinute, 5);
        assert.equal(rec.absentAfterHours, 2.5);
        assert.equal(rec.regularizationAllowed, true);
        assert.equal(rec.regularizationWindowDays, 3);
        assert.equal(rec.wfhAllowed, false);
        assert.equal(rec.otMinimumMinutes, 30);
        assert.equal(rec.otApprovalRequired, true);
        assert.equal(rec.geoFenceRequired, true);
        assert.equal(rec.ipRestricted, true);
        assert.equal(rec.isActive, true);
    });

    await t.test('3. Rejects Missing PK and Duplicate Policy Codes', () => {
        const seen = new Set();
        const rowMissingCode = { 'Policy_Name': 'Uncoded Policy' };
        const resMissing = policyParser.parseAttendancePolicyRow(rowMissingCode, 0, seen);
        assert.equal(resMissing.valid, false);
        assert.ok(resMissing.errors.some(e => e.includes("Missing mandatory 'Attendance_Policy_Code'")));

        const rowValid = { 'Attendance_Policy_Code': 'POL_DUP_01', 'Policy_Name': 'Dup 1' };
        const resValid = policyParser.parseAttendancePolicyRow(rowValid, 1, seen);
        assert.equal(resValid.valid, true);

        const rowDup = { 'Attendance_Policy_Code': 'POL_DUP_01', 'Policy_Name': 'Dup 2' };
        const resDup = policyParser.parseAttendancePolicyRow(rowDup, 2, seen);
        assert.equal(resDup.valid, false);
        assert.ok(resDup.errors.some(e => e.includes('Duplicate Attendance Policy Code "POL_DUP_01"')));
    });

    await t.test('4. Parse live Templates.xlsx Official Workbook with "Attendance Rules"', async () => {
        const templatePath = path.join(rootDir, 'assets/Templates.xlsx');
        assert.ok(fs.existsSync(templatePath), 'assets/Templates.xlsx must exist');

        const buffer = fs.readFileSync(templatePath);
        const wb = XLSX.read(buffer, { type: 'buffer' });

        const sheetName = wb.SheetNames.find(s => s === 'Attendance Rules' || s === 'Attendance_Rules');
        assert.ok(sheetName, "'Attendance Rules' sheet must exist in Templates.xlsx");

        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        assert.ok(rows.length >= 4, 'Templates.xlsx should have at least 4 default attendance policies');

        const parsed = policyParser.parseAttendancePolicyRows(rows);
        assert.equal(parsed.valid, true);
        assert.equal(parsed.errors.length, 0);
        assert.equal(parsed.validRecords.length >= 4, true);

        const corpPolicy = parsed.validRecords.find(p => p.attendancePolicyCode === 'POL_STD_CORP');
        assert.ok(corpPolicy, 'POL_STD_CORP must exist');
        assert.equal(corpPolicy.lateAfterMinutes, 15);
        assert.equal(corpPolicy.absentAfterHours, 4);
        assert.equal(corpPolicy.regularizationWindowDays, 7);

        const factoryPolicy = parsed.validRecords.find(p => p.attendancePolicyCode === 'POL_FACTORY_OPS');
        assert.ok(factoryPolicy, 'POL_FACTORY_OPS must exist');
        assert.equal(factoryPolicy.geoFenceRequired, true);
        assert.equal(factoryPolicy.ipRestricted, true);
        assert.equal(factoryPolicy.wfhAllowed, false);
    });

    await t.test('5. CSV Ingestion Parser Support (parseAttendancePolicyCsv)', () => {
        const csv = `Attendance_Policy_Code,Policy_Name,Late_After_Minutes,Early_Leaving_Grace_Minute,Absent_After_Hours,Regularization_Allowed,Regularization_Window_Days,WFH_Allowed,OT_Minimum_Minutes,OT_Approval_Required,GeoFence_Required,IP_Restricted,Active
POL_CSV_01,CSV Corporate Policy,15,10,4,Yes,7,Yes,60,Yes,No,No,Yes
POL_CSV_02,Strict Security Ops,10,5,3,No,0,No,60,Yes,Yes,Yes,Yes`;

        const parsed = policyParser.parseAttendancePolicyCsv(csv);
        assert.equal(parsed.valid, true);
        assert.equal(parsed.validRecords.length, 2);
        assert.equal(parsed.validRecords[0].attendancePolicyCode, 'POL_CSV_01');
        assert.equal(parsed.validRecords[1].attendancePolicyCode, 'POL_CSV_02');
        assert.equal(parsed.validRecords[1].regularizationAllowed, false);
        assert.equal(parsed.validRecords[1].geoFenceRequired, true);
    });

    await t.test('6. template-parser-service Ingestion & Workbook Integration', () => {
        const sampleRows = [
            {
                'Attendance_Policy_Code': 'POL_SVC_01',
                'Policy_Name': 'Service Standard Policy',
                'Late_After_Minutes': 20,
                'Early_Leaving_Grace_Minute': 10,
                'Absent_After_Hours': 4,
                'Regularization_Allowed': 'Yes',
                'Regularization_Window_Days': 10,
                'WFH_Allowed': 'Yes',
                'OT_Minimum_Minutes': 45,
                'OT_Approval_Required': 'No',
                'GeoFence_Required': 'No',
                'IP_Restricted': 'No',
                'Active': 'Yes'
            }
        ];

        const sheetResult = parseAttendancePolicySheet(sampleRows);
        assert.equal(sheetResult.valid, true);
        assert.equal(sheetResult.data.length, 1);
        assert.equal(sheetResult.data[0].attendancePolicyCode, 'POL_SVC_01');
        assert.equal(sheetResult.data[0].otApprovalRequired, false);

        // Test ingestTemplatesWorkbook integration
        const templatePath = path.join(rootDir, 'Templates.xlsx');
        const buffer = fs.readFileSync(templatePath);
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const multiResult = ingestTemplatesWorkbook(wb, XLSX.utils);

        assert.ok(multiResult.isOfficialTemplatesWorkbook);
        assert.ok(Array.isArray(multiResult.attendancePolicies));
        assert.ok(multiResult.attendancePolicies.length >= 4);
    });

    await t.test('7. Geofence Clock-In Verification (Haversine Formula)', () => {
        // Office Branch: Outer Ring Road Bellandur (12.9279, 77.6833) with 100m radius
        const branchLocation = { latitude: 12.9279, longitude: 77.6833, radiusMeters: 100 };

        // User punch inside perimeter (50m away)
        const insideUser = { latitude: 12.9281, longitude: 77.6835 };
        const insideRes = policyService.verifyGeoFence(insideUser, branchLocation);
        assert.equal(insideRes.verified, true);
        assert.ok(insideRes.distanceMeters <= 100);

        // User punch outside perimeter (5km away)
        const outsideUser = { latitude: 12.9716, longitude: 77.5946 };
        const outsideRes = policyService.verifyGeoFence(outsideUser, branchLocation);
        assert.equal(outsideRes.verified, false);
        assert.equal(outsideRes.reason, 'OUTSIDE_GEOFENCE');
        assert.ok(outsideRes.distanceMeters > 1000);

        // Missing coordinates check
        const missingRes = policyService.verifyGeoFence(null, branchLocation);
        assert.equal(missingRes.verified, false);
        assert.equal(missingRes.reason, 'MISSING_COORDINATES');
    });

    await t.test('8. IP Restriction Validation (CIDR and IP Whitelist)', () => {
        const allowed = ['127.0.0.1', '10.14.0.0/16', '192.168.1.0/24'];

        const loopbackRes = policyService.verifyIpAllowed('127.0.0.1', allowed);
        assert.equal(loopbackRes.verified, true);

        const officeSubnetRes = policyService.verifyIpAllowed('10.14.22.85', allowed);
        assert.equal(officeSubnetRes.verified, true);

        const externalIpRes = policyService.verifyIpAllowed('203.0.113.195', allowed);
        assert.equal(externalIpRes.verified, false);
        assert.equal(externalIpRes.reason, 'IP_NOT_AUTHORIZED');
    });

    await t.test('9. Full Clock-In Policy Evaluation (Geofence + IP + WFH)', () => {
        const strictPolicy = {
            attendancePolicyCode: 'POL_STRICT',
            policyName: 'Strict Onsite Only',
            wfhAllowed: false,
            geoFenceRequired: true,
            ipRestricted: true,
            lateAfterMinutes: 15,
            absentAfterHours: 4
        };

        const branch = { latitude: 12.9279, longitude: 77.6833, radiusMeters: 100 };
        const allowedIps = ['10.14.0.0/16'];

        // Reject WFH attempt on onsite policy
        const wfhAttempt = policyService.validateClockIn({
            policy: strictPolicy,
            isWfh: true
        });
        assert.equal(wfhAttempt.allowed, false);
        assert.equal(wfhAttempt.reason, 'WFH_NOT_PERMITTED');

        // Reject outside geofence
        const outsidePunch = policyService.validateClockIn({
            policy: strictPolicy,
            isWfh: false,
            userLocation: { latitude: 13.0827, longitude: 80.2707 }, // Chennai
            branchLocation: branch,
            clientIp: '10.14.1.5',
            allowedIps
        });
        assert.equal(outsidePunch.allowed, false);
        assert.equal(outsidePunch.reason, 'OUTSIDE_GEOFENCE');

        // Reject invalid IP
        const badIpPunch = policyService.validateClockIn({
            policy: strictPolicy,
            isWfh: false,
            userLocation: { latitude: 12.9279, longitude: 77.6833 },
            branchLocation: branch,
            clientIp: '198.51.100.12',
            allowedIps
        });
        assert.equal(badIpPunch.allowed, false);
        assert.equal(badIpPunch.reason, 'IP_NOT_AUTHORIZED');

        // Successful validation
        const successPunch = policyService.validateClockIn({
            policy: strictPolicy,
            isWfh: false,
            userLocation: { latitude: 12.9280, longitude: 77.6833 },
            branchLocation: branch,
            clientIp: '10.14.1.5',
            allowedIps
        });
        assert.equal(successPunch.allowed, true);
    });

    await t.test('10. Status & Penalty Determination (LATE and ABSENT Cutoff)', () => {
        const policy = {
            attendancePolicyCode: 'POL_STD',
            lateAfterMinutes: 15,
            absentAfterHours: 4
        };

        // Shift Start 09:30. Grace = 15m (up to 09:45). Absent cutoff = 4h (13:30).

        // Punch at 09:25 -> ON_TIME
        const onTime = policyService.evaluatePunchStatus('09:30', '09:25', 15, policy);
        assert.equal(onTime.attendanceStatus, 'ON_TIME');
        assert.equal(onTime.isLate, false);
        assert.equal(onTime.isAbsent, false);

        // Punch at 09:40 -> ON_TIME (within 15m grace)
        const withinGrace = policyService.evaluatePunchStatus('09:30', '09:40', 15, policy);
        assert.equal(withinGrace.attendanceStatus, 'ON_TIME');

        // Punch at 09:55 -> LATE (25 mins late)
        const latePunch = policyService.evaluatePunchStatus('09:30', '09:55', 15, policy);
        assert.equal(latePunch.attendanceStatus, 'LATE');
        assert.equal(latePunch.isLate, true);
        assert.equal(latePunch.isAbsent, false);
        assert.equal(latePunch.lateMinutes, 25);

        // Punch at 14:00 (> 4 hours from 09:30 start) -> ABSENT
        const absentPunch = policyService.evaluatePunchStatus('09:30', '14:00', 15, policy);
        assert.equal(absentPunch.attendanceStatus, 'ABSENT');
        assert.equal(absentPunch.isAbsent, true);
    });

    await t.test('11. Regularization Governance & Window Expiry Enforcement', () => {
        const standardPolicy = {
            attendancePolicyCode: 'POL_STD_CORP',
            policyName: 'Standard Corporate Policy',
            regularizationAllowed: true,
            regularizationWindowDays: 7
        };

        const strictPolicy = {
            attendancePolicyCode: 'POL_NO_REG',
            policyName: 'Zero Regularization Policy',
            regularizationAllowed: false,
            regularizationWindowDays: 0
        };

        // Button state check for Employee ESS Quick Actions
        assert.equal(policyService.isRegularizationButtonEnabled(standardPolicy), true);
        assert.equal(policyService.isRegularizationButtonEnabled(strictPolicy), false);

        // Within 7 days window (3 days elapsed)
        const recentPunch = '2026-10-01';
        const today = '2026-10-04';
        const validClaim = policyService.validateRegularization(recentPunch, today, standardPolicy);
        assert.equal(validClaim.eligible, true);
        assert.equal(validClaim.daysElapsed, 3);
        assert.equal(validClaim.allowedWindowDays, 7);

        // Outside window (10 days elapsed on a 7-day window) -> REJECTED
        const oldPunch = '2026-09-20';
        const expiredClaim = policyService.validateRegularization(oldPunch, today, standardPolicy);
        assert.equal(expiredClaim.eligible, false);
        assert.equal(expiredClaim.reason, 'WINDOW_EXPIRED');
        assert.ok(expiredClaim.daysElapsed > 7);

        // Regularization disabled under policy
        const disabledClaim = policyService.validateRegularization(recentPunch, today, strictPolicy);
        assert.equal(disabledClaim.eligible, false);
        assert.equal(disabledClaim.reason, 'REGULARIZATION_NOT_ALLOWED');
    });

    await t.test('12. Overtime Validation & L1 Manager Approval Routing', () => {
        const approvalPolicy = {
            otMinimumMinutes: 60,
            otApprovalRequired: true
        };

        const autoPolicy = {
            otMinimumMinutes: 30,
            otApprovalRequired: false
        };

        // Below threshold (45 mins when minimum is 60) -> No OT
        const belowMin = policyService.evaluateOvertime(45, approvalPolicy);
        assert.equal(belowMin.eligible, false);
        assert.equal(belowMin.creditedMinutes, 0);
        assert.equal(belowMin.reason, 'BELOW_MINIMUM_THRESHOLD');

        // Above threshold with approval required -> Routed to L1 Manager with PENDING_APPROVAL
        const approvalClaim = policyService.evaluateOvertime(90, approvalPolicy);
        assert.equal(approvalClaim.eligible, true);
        assert.equal(approvalClaim.creditedMinutes, 90);
        assert.equal(approvalClaim.requiresApproval, true);
        assert.equal(approvalClaim.status, 'PENDING_APPROVAL');
        assert.equal(approvalClaim.routedTo, 'L1_MANAGER_QUEUE');

        // Above threshold without approval -> Direct to payroll
        const autoClaim = policyService.evaluateOvertime(45, autoPolicy);
        assert.equal(autoClaim.eligible, true);
        assert.equal(autoClaim.creditedMinutes, 45);
        assert.equal(autoClaim.requiresApproval, false);
        assert.equal(autoClaim.status, 'APPROVED');
        assert.equal(autoClaim.routedTo, 'PAYROLL_DIRECT');
    });

    await t.test('13. Cloud Firestore Document Structure Conformance', () => {
        const pathGenerated = policyService.getFirestorePath('org_kylrx', 'POL_STD_CORP');
        assert.equal(pathGenerated, 'organizations/org_kylrx/attendance_policies/POL_STD_CORP');

        const sample = policyService.DEFAULT_ATTENDANCE_POLICIES[0];
        const keys = Object.keys(sample);

        const expectedKeys = [
            'attendancePolicyCode',
            'policyName',
            'lateAfterMinutes',
            'earlyLeavingGraceMinute',
            'absentAfterHours',
            'regularizationAllowed',
            'regularizationWindowDays',
            'wfhAllowed',
            'otMinimumMinutes',
            'otApprovalRequired',
            'geoFenceRequired',
            'ipRestricted',
            'isActive'
        ];

        expectedKeys.forEach(k => {
            assert.ok(keys.includes(k), `Firestore document must include attribute: ${k}`);
        });
    });

});
