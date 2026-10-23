import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load pfDetailsParser (UMD module)
const parserPath = path.join(rootDir, 'pfDetailsParser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const pfParser = parserModule.exports;

// Load pfDetailsService (UMD module)
const servicePath = path.join(rootDir, 'pfDetailsService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const pfService = serviceModule.exports;

// Load epfoProfileUIController (UMD module)
const uiPath = path.join(rootDir, 'epfoProfileUIController.js');
const uiContent = fs.readFileSync(uiPath, 'utf8');
const uiModule = { exports: {} };
const uiFn = new Function('module', 'exports', 'require', uiContent);
uiFn(uiModule, uiModule.exports, () => ({}));
const epfoUi = uiModule.exports;

test('PRD Sections 1, 4, 11 & 13: EPFO / PF & UAN Statutory Master Module', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (Strict 19 Attributes)', async (st) => {
        await st.test('Schema defines all 19 required columns with correct metadata and keys', () => {
            const attrs = pfParser.PF_DETAILS_ATTRIBUTES;
            assert.equal(attrs.length, 19, 'Strictly 19 attributes must be defined');

            const expectedKeys = [
                'Employee ID',
                'Organization ID',
                'PF Applicable',
                'UAN',
                'Current Member ID',
                'Previous UAN',
                'Previous Member ID',
                'EPFO Establishment ID',
                'Date of PF Joining',
                'Date of PF Exit',
                'EPS Applicable',
                'EDLI Applicable',
                'KYC Status',
                'Aadhaar KYC',
                'PAN KYC',
                'Bank KYC',
                'UAN Status',
                'UAN Verification Status',
                'Official Source'
            ];

            const actualKeys = attrs.map(a => a.key);
            assert.deepEqual(actualKeys, expectedKeys, 'Attribute keys must match exact 19 column names');

            // Verify mandatory flags and defaults
            assert.equal(attrs.find(a => a.key === 'Employee ID').required, true);
            assert.equal(attrs.find(a => a.key === 'Organization ID').required, true);
            assert.equal(attrs.find(a => a.key === 'PF Applicable').required, true);
            assert.equal(attrs.find(a => a.key === 'EPS Applicable').required, true);
            assert.equal(attrs.find(a => a.key === 'EDLI Applicable').required, true);
        });

        await st.test('Parses valid 19-column raw row into structured record and Cloud Firestore document', () => {
            const rawRow = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'PF Applicable': 'Yes',
                'UAN': '100904829102',
                'Current Member ID': 'KNBNG00123450000010023',
                'Previous UAN': '100802341290',
                'Previous Member ID': 'DLCPM00987650000004521',
                'EPFO Establishment ID': 'KN/BNG/0012345/000',
                'Date of PF Joining': '2026-01-15',
                'Date of PF Exit': '',
                'EPS Applicable': 'Yes',
                'EDLI Applicable': 'Yes',
                'KYC Status': 'VERIFIED',
                'Aadhaar KYC': 'VERIFIED',
                'PAN KYC': 'VERIFIED',
                'Bank KYC': 'VERIFIED',
                'UAN Status': 'ACTIVE',
                'UAN Verification Status': 'SUCCESS',
                'Official Source': 'Decentro Fabric'
            };

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002']);
            const result = pfParser.parseSheetRows([rawRow], { existingEmployeeIds, orgId: 'ORG_KYLRX_01' });

            assert.equal(result.valid, true);
            assert.equal(result.totalRows, 1);
            assert.equal(result.validCount, 1);
            assert.equal(result.errors.length, 0);

            const rec = result.records[0];
            assert.equal(rec['Employee ID'], 'EMP0001');
            assert.equal(rec['Organization ID'], 'ORG_KYLRX_01');
            assert.equal(rec['PF Applicable'], 'Yes');
            assert.equal(rec['UAN'], '100904829102');
            assert.equal(rec['Current Member ID'], 'KNBNG00123450000010023');
            assert.equal(rec['Previous UAN'], '100802341290');
            assert.equal(rec['Previous Member ID'], 'DLCPM00987650000004521');
            assert.equal(rec['EPFO Establishment ID'], 'KN/BNG/0012345/000');
            assert.equal(rec['Date of PF Joining'], '2026-01-15');
            assert.equal(rec['Date of PF Exit'], null);
            assert.equal(rec['EPS Applicable'], 'Yes');
            assert.equal(rec['EDLI Applicable'], 'Yes');
            assert.equal(rec['KYC Status'], 'VERIFIED');
            assert.equal(rec['Aadhaar KYC'], 'VERIFIED');
            assert.equal(rec['PAN KYC'], 'VERIFIED');
            assert.equal(rec['Bank KYC'], 'VERIFIED');
            assert.equal(rec['UAN Status'], 'ACTIVE');
            assert.equal(rec['UAN Verification Status'], 'SUCCESS');
            assert.equal(rec['Official Source'], 'Decentro Fabric');

            // Verify Firestore document mapping
            const doc = result.firestoreDocs[0];
            assert.equal(doc.employeeId, 'EMP0001');
            assert.equal(doc.organizationId, 'ORG_KYLRX_01');
            assert.equal(doc.isPfApplicable, true);
            assert.equal(doc.uan, '100904829102');
            assert.equal(doc.currentMemberId, 'KNBNG00123450000010023');
            assert.equal(doc.previousUan, '100802341290');
            assert.equal(doc.previousMemberId, 'DLCPM00987650000004521');
            assert.equal(doc.epfoEstablishmentId, 'KN/BNG/0012345/000');
            assert.equal(doc.dateOfPfJoining, '2026-01-15');
            assert.equal(doc.dateOfPfExit, null);
            assert.equal(doc.isEpsApplicable, true);
            assert.equal(doc.isEdliApplicable, true);

            // Nested KYC object
            assert.equal(doc.kyc.overallStatus, 'VERIFIED');
            assert.equal(doc.kyc.aadhaarKyc, 'VERIFIED');
            assert.equal(doc.kyc.panKyc, 'VERIFIED');
            assert.equal(doc.kyc.bankKyc, 'VERIFIED');

            // Verification & audit
            assert.equal(doc.uanStatus, 'ACTIVE');
            assert.equal(doc.verification.status, 'SUCCESS');
            assert.equal(doc.verification.officialSource, 'Decentro Fabric');
            assert.ok(doc.verification.verifiedAt);
            assert.ok(doc.updatedAt);
        });
    });

    await t.test('2. Ingestion & Validation Pipeline (PRD Section 1 Validations)', async (st) => {
        await st.test('Foreign Key Validation: flags error when Employee ID does not exist in catalog', () => {
            const rawRow = {
                'Employee ID': 'EMP9999_UNKNOWN',
                'Organization ID': 'ORG_KYLRX_01',
                'PF Applicable': 'Yes',
                'UAN': '100904829102',
                'Current Member ID': 'KNBNG00123450000010023',
                'Date of PF Joining': '2026-01-15'
            };

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002']);
            const result = pfParser.parseSheetRows([rawRow], { existingEmployeeIds, orgId: 'ORG_KYLRX_01' });

            assert.equal(result.valid, false);
            assert.equal(result.errors.length, 1);
            assert.match(result.errors[0].message, /Foreign key validation failed/);
            assert.match(result.errors[0].message, /EMP9999_UNKNOWN/);
        });

        await st.test('UAN Strict 12-Digit Validation: accepts 12 digits, rejects non-12-digit strings', () => {
            const validCases = ['100904829102', '100802341290', '100123456789'];
            for (const uan of validCases) {
                assert.equal(pfParser.validateUAN(uan), true, `Should accept valid 12-digit UAN: ${uan}`);
            }

            const invalidCases = [
                '10090482910',    // 11 digits (too short)
                '1009048291023',  // 13 digits (too long)
                '10090482910A',  // contains letter
                '1009-0482-9102', // contains dashes
                '1009 0482 9102', // contains whitespace
                ''
            ];
            for (const uan of invalidCases) {
                assert.equal(pfParser.validateUAN(uan), false, `Should reject invalid UAN: ${uan}`);
            }
        });

        await st.test('Conditional Discrepancy Flagging: PF Applicable is "Yes" but UAN is empty', () => {
            const rawRow = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'PF Applicable': 'Yes',
                'UAN': '', // Missing
                'Current Member ID': 'KNBNG00123450000010023',
                'Date of PF Joining': '2026-01-15'
            };

            const result = pfParser.parseSheetRows([rawRow], { existingEmployeeIds: new Set(['EMP0001']) });
            assert.equal(result.valid, false);
            assert.match(result.errors[0].message, /PF Applicable' is Yes, but 'UAN' is missing/);
        });

        await st.test('Conditional Discrepancy Flagging: PF Applicable is "Yes" but Date of PF Joining is empty', () => {
            const rawRow = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'PF Applicable': 'Yes',
                'UAN': '100904829102',
                'Current Member ID': 'KNBNG00123450000010023',
                'Date of PF Joining': '' // Missing
            };

            const result = pfParser.parseSheetRows([rawRow], { existingEmployeeIds: new Set(['EMP0001']) });
            assert.equal(result.valid, false);
            assert.match(result.errors[0].message, /PF Applicable' is Yes, but 'Date of PF Joining' is empty/);
        });

        await st.test('Date Sequence Integrity: Date of PF Exit cannot precede Date of PF Joining', () => {
            const rawRow = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'PF Applicable': 'Yes',
                'UAN': '100904829102',
                'Current Member ID': 'KNBNG00123450000010023',
                'Date of PF Joining': '2026-06-01',
                'Date of PF Exit': '2026-01-15' // Exit before joining
            };

            const result = pfParser.parseSheetRows([rawRow], { existingEmployeeIds: new Set(['EMP0001']) });
            assert.equal(result.valid, false);
            assert.match(result.errors[0].message, /Date sequence violation/);
        });

        await st.test('Enum Validation: validates KYC Status and KYC channel enums', () => {
            assert.deepEqual(pfParser.VALID_ENUMS.kycStatus, ['VERIFIED', 'PENDING', 'REJECTED', 'NOT_INITIATED']);
            assert.deepEqual(pfParser.VALID_ENUMS.aadhaarKyc, ['VERIFIED', 'PENDING', 'NOT_SEEDED']);
            assert.deepEqual(pfParser.VALID_ENUMS.panKyc, ['VERIFIED', 'PENDING', 'NOT_SEEDED']);
            assert.deepEqual(pfParser.VALID_ENUMS.bankKyc, ['VERIFIED', 'PENDING', 'REJECTED']);
            assert.deepEqual(pfParser.VALID_ENUMS.uanStatus, ['ACTIVE', 'INACTIVE', 'BLOCKED']);
            assert.deepEqual(pfParser.VALID_ENUMS.uanVerificationStatus, ['SUCCESS', 'PENDING', 'FAILED']);
        });
    });

    await t.test('3. Statutory Calculation & ECR Report Engine (PRD Sections 4 & 11)', async (st) => {
        await st.test('Monthly Contribution Split: computes 12% EE, 8.33% EPS capped at ₹1,250, remainder 3.67% EPF', () => {
            const profile = {
                employeeId: 'EMP0001',
                isPfApplicable: true,
                isEpsApplicable: true,
                isEdliApplicable: true
            };

            // Standard case: PF gross ₹25,000 (above ₹15,000 ceiling)
            const calc = pfService.calculateMonthlyContributions(profile, { pfGrossWages: 25000 });

            assert.equal(calc.isApplicable, true);
            assert.equal(calc.grossWages, 25000);
            assert.equal(calc.epfWages, 15000, 'EPF wages capped at ₹15,000 ceiling');
            assert.equal(calc.epsWages, 15000, 'EPS wages capped at ₹15,000 ceiling');
            assert.equal(calc.employeeEpf, 1800, '12% of ₹15,000 = ₹1,800');
            assert.equal(calc.employerEps, 1250, '8.33% capped at statutory ₹1,250');
            assert.equal(calc.totalEmployerPf, 1800, 'Total employer PF 12% = ₹1,800');
            assert.equal(calc.employerEpfSplit, 550, 'Employer EPF remainder split = ₹1,800 - ₹1,250 = ₹550');
            assert.equal(calc.edliCharges, 75, '0.50% of ₹15,000 = ₹75');
            assert.equal(calc.adminCharges, 75, '0.50% of ₹15,000 = ₹75');
            assert.equal(calc.totalContribution, 1800 + 1250 + 550 + 75 + 75);
        });

        await st.test('Monthly Contribution Split: when wage is under ceiling (e.g. ₹12,000)', () => {
            const profile = {
                employeeId: 'EMP0002',
                isPfApplicable: true,
                isEpsApplicable: true,
                isEdliApplicable: true
            };

            const calc = pfService.calculateMonthlyContributions(profile, { pfGrossWages: 12000 });

            assert.equal(calc.epfWages, 12000);
            assert.equal(calc.epsWages, 12000);
            assert.equal(calc.employeeEpf, 1440, '12% of 12000');
            assert.equal(calc.employerEps, 1000, '8.33% of 12000 = 1000');
            assert.equal(calc.employerEpfSplit, 440, '1440 - 1000 = 440');
            assert.equal(calc.edliCharges, 60, '0.50% of 12000 = 60');
            assert.equal(calc.adminCharges, 60, '0.50% of 12000 = 60');
        });

        await st.test('Monthly Contribution Split: when EPS is not applicable, all employer 12% goes to EPF', () => {
            const profile = {
                employeeId: 'EMP0003',
                isPfApplicable: true,
                isEpsApplicable: false, // Opted out or over 58
                isEdliApplicable: true
            };

            const calc = pfService.calculateMonthlyContributions(profile, { pfGrossWages: 20000 });

            assert.equal(calc.employeeEpf, 1800);
            assert.equal(calc.employerEps, 0, 'EPS share is 0 when EPS is not applicable');
            assert.equal(calc.employerEpfSplit, 1800, 'Full 12% credited to EPF split');
        });

        await st.test('Electronic Challan-cum-Return (ECR) Row: formats strict 11-column hash-delimited row', () => {
            const profile = {
                employeeId: 'EMP0001',
                employeeName: 'Arun Kumar',
                uan: '100904829102',
                isPfApplicable: true,
                isEpsApplicable: true,
                isEdliApplicable: true
            };

            const ecrRow = pfService.generateEcrRow(profile, { pfGrossWages: 25000 }, { employeeName: 'Arun Kumar', ncpDays: 0, refundAdvances: 0 });

            // Expected 11 columns:
            // UAN#MemberName#GrossWages#EPFWages#EPSWages#EDLIWages#EE_Share#ER_EPS_Share#ER_EPF_Share#NCP_Days#Refund_Adv
            assert.equal(ecrRow, '100904829102#Arun Kumar#25000#15000#15000#15000#1800#1250#550#0#0');

            const parts = ecrRow.split('#');
            assert.equal(parts.length, 11, 'Strictly 11 #-delimited attributes in ECR row');
            assert.equal(parts[0], '100904829102');
            assert.equal(parts[1], 'Arun Kumar');
            assert.equal(parts[2], '25000');
            assert.equal(parts[3], '15000');
            assert.equal(parts[4], '15000');
            assert.equal(parts[5], '15000');
            assert.equal(parts[6], '1800');
            assert.equal(parts[7], '1250');
            assert.equal(parts[8], '550');
            assert.equal(parts[9], '0');
            assert.equal(parts[10], '0');
        });

        await st.test('ECR File Generation: produces multi-line submission text', () => {
            const list = [
                {
                    profile: { employeeId: 'EMP0001', uan: '100904829102', isPfApplicable: true, isEpsApplicable: true, isEdliApplicable: true },
                    wages: { pfGrossWages: 25000 },
                    employeeName: 'Arun Kumar',
                    ncpDays: 0
                },
                {
                    profile: { employeeId: 'EMP0002', uan: '100904829103', isPfApplicable: true, isEpsApplicable: true, isEdliApplicable: true },
                    wages: { pfGrossWages: 18000 },
                    employeeName: 'Priya Sharma',
                    ncpDays: 2
                }
            ];

            const fileContent = pfService.generateEcrFile(list);
            const lines = fileContent.split(/\r?\n/);
            assert.equal(lines.length, 2);
            assert.equal(lines[0], '100904829102#Arun Kumar#25000#15000#15000#15000#1800#1250#550#0#0');
            assert.equal(lines[1], '100904829103#Priya Sharma#18000#15000#15000#15000#1800#1250#550#2#0');
        });
    });

    await t.test('4. Decentro / EPFO KYC Verification Handshake', async (st) => {
        await st.test('Handshake succeeds with valid 12-digit UAN, updating KYC and Official Source', async () => {
            const orgId = 'org_kyc_test';
            const empId = 'EMP0001';

            const result = await pfService.verifyKycViaDecentroEpfo(orgId, empId, {
                uan: '100904829102',
                pan: 'ABCDE1234F',
                aadhaarLast4: '9021'
            });

            assert.equal(result.success, true);
            assert.equal(result.status, 'SUCCESS');
            assert.equal(result.profile.verification.status, 'SUCCESS');
            assert.equal(result.profile.verification.officialSource, 'Decentro Fabric');
            assert.equal(result.profile.kyc.overallStatus, 'VERIFIED');
            assert.equal(result.profile.kyc.aadhaarKyc, 'VERIFIED');
            assert.equal(result.profile.kyc.panKyc, 'VERIFIED');
            assert.equal(result.profile.kyc.bankKyc, 'VERIFIED');
            assert.ok(result.profile.verification.verifiedAt);
        });

        await st.test('Handshake fails with malformed UAN', async () => {
            const orgId = 'org_kyc_test';
            const empId = 'EMP0002';

            const result = await pfService.verifyKycViaDecentroEpfo(orgId, empId, {
                uan: '10090482' // Invalid 8 digits
            });

            assert.equal(result.success, false);
            assert.equal(result.status, 'FAILED');
            assert.equal(result.profile.verification.status, 'FAILED');
        });
    });

    await t.test('5. Data Architecture & Cloud Firestore CRUD', async (st) => {
        const testOrgId = 'ORG_KYLRX_TEST';
        const empId = 'EMP0010';

        await st.test('Persists and retrieves employee EPFO profile at organizations/{orgId}/employee_pf_details/{employeeId}', async () => {
            const payload = {
                employeeId: empId,
                organizationId: testOrgId,
                isPfApplicable: true,
                uan: '100904829102',
                currentMemberId: 'KNBNG00123450000010023',
                previousUan: '100802341290',
                previousMemberId: 'DLCPM00987650000004521',
                epfoEstablishmentId: 'KN/BNG/0012345/000',
                dateOfPfJoining: '2026-01-15',
                dateOfPfExit: null,
                isEpsApplicable: true,
                isEdliApplicable: true,
                kyc: {
                    overallStatus: 'VERIFIED',
                    aadhaarKyc: 'VERIFIED',
                    panKyc: 'VERIFIED',
                    bankKyc: 'VERIFIED'
                },
                uanStatus: 'ACTIVE',
                verification: {
                    status: 'SUCCESS',
                    officialSource: 'Decentro Fabric',
                    verifiedAt: '2026-01-15T00:00:00.000Z'
                }
            };

            const saved = await pfService.saveEmployeePfDetails(testOrgId, empId, payload);
            assert.ok(saved);
            assert.equal(saved.employeeId, empId);
            assert.equal(saved.uan, '100904829102');
            assert.equal(saved.currentMemberId, 'KNBNG00123450000010023');

            const fetched = await pfService.getEmployeePfDetails(testOrgId, empId);
            assert.ok(fetched);
            assert.equal(fetched.employeeId, empId);
            assert.equal(fetched.previousUan, '100802341290');
            assert.equal(fetched.kyc.overallStatus, 'VERIFIED');

            const list = await pfService.listEmployeePfDetails(testOrgId);
            assert.ok(Array.isArray(list));
            assert.ok(list.some(p => p.employeeId === empId));
        });
    });

    await t.test('6. Live Templates.xlsx Ingestion Integration', async (st) => {
        const templatesPath = path.join(rootDir, 'Templates.xlsx');
        assert.ok(fs.existsSync(templatesPath), 'Templates.xlsx must exist in root directory');

        const fileBuffer = fs.readFileSync(templatesPath);
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

        const sheetName = workbook.SheetNames.find(s => {
            const norm = s.trim().toLowerCase().replace(/[\s_-]+/g, '');
            return norm === 'pfdetails' || norm === 'epfomaster';
        });

        assert.ok(sheetName, `Templates.xlsx must contain 'PF Details' / 'EPFO Master' sheet (found sheets: ${workbook.SheetNames.join(', ')})`);

        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        assert.ok(rawRows.length > 0, `'${sheetName}' sheet must contain sample rows`);

        const firstRowKeys = Object.keys(rawRows[0]);
        assert.ok(firstRowKeys.includes('Employee ID'), 'Must have Employee ID header');
        assert.ok(firstRowKeys.includes('Organization ID'), 'Must have Organization ID header');
        assert.ok(firstRowKeys.includes('UAN'), 'Must have UAN header');
        assert.ok(firstRowKeys.includes('Current Member ID'), 'Must have Current Member ID header');
        assert.ok(firstRowKeys.includes('EPFO Establishment ID'), 'Must have EPFO Establishment ID header');
        assert.ok(firstRowKeys.includes('Date of PF Joining'), 'Must have Date of PF Joining header');

        const existingEmployeeIds = new Set(['EMP0001', 'EMP0002', 'EMP0003']);
        const parseResult = pfParser.parseSheetRows(rawRows, { existingEmployeeIds, orgId: 'ORG_KYLRX_01' });

        assert.equal(parseResult.valid, true, `All rows in Templates.xlsx '${sheetName}' must pass validation`);
        assert.equal(parseResult.records.length, 3, 'Must contain 3 sample rows');
        assert.equal(parseResult.firestoreDocs.length, 3, 'Must generate 3 Firestore docs');
        assert.equal(parseResult.errors.length, 0, 'Must have zero parsing errors');

        const emp1 = parseResult.firestoreDocs[0];
        assert.equal(emp1.employeeId, 'EMP0001');
        assert.equal(emp1.uan, '100904829102');
        assert.equal(emp1.isPfApplicable, true);
        assert.equal(emp1.isEpsApplicable, true);
        assert.equal(emp1.kyc.overallStatus, 'VERIFIED');
    });

    await t.test('7. Frontend UI and Modal Integration Integrity', async (st) => {
        // admin-dashboard.html check
        const adminDashboardPath = path.join(rootDir, 'admin-dashboard.html');
        const adminDashboardHtml = fs.readFileSync(adminDashboardPath, 'utf8');

        assert.ok(adminDashboardHtml.includes('id="epfoStatutoryDrawerContainer"'), 'admin-dashboard.html must have #epfoStatutoryDrawerContainer');
        assert.ok(adminDashboardHtml.includes('pfDetailsParser.js'), 'Must import pfDetailsParser.js');
        assert.ok(adminDashboardHtml.includes('pfDetailsService.js'), 'Must import pfDetailsService.js');
        assert.ok(adminDashboardHtml.includes('epfoProfileUIController.js'), 'Must import epfoProfileUIController.js');

        // employee-profile-controller.js check
        const controllerPath = path.join(rootDir, 'employee-profile-controller.js');
        const controllerCode = fs.readFileSync(controllerPath, 'utf8');

        assert.ok(controllerCode.includes('KylrxEpfoProfileUIController'), 'Controller must invoke KylrxEpfoProfileUIController');
        assert.ok(controllerCode.includes('mountEpfoCard'), 'Controller must call mountEpfoCard');

        // admin-onboarding-upload.html check
        const onboardingHtmlPath = path.join(rootDir, 'admin-onboarding-upload.html');
        const onboardingHtml = fs.readFileSync(onboardingHtmlPath, 'utf8');

        assert.ok(onboardingHtml.includes('id="tabEpfoMaster"'), 'Must have tabEpfoMaster');
        assert.ok(onboardingHtml.includes('id="epfoMasterManagementView"'), 'Must have epfoMasterManagementView');
        assert.ok(onboardingHtml.includes('id="epfoMasterParseResultsContainer"'), 'Must have epfoMasterParseResultsContainer');
        assert.ok(onboardingHtml.includes('id="parsedEpfoMasterTableBody"'), 'Must have parsedEpfoMasterTableBody');
        assert.ok(onboardingHtml.includes('id="btnConfirmEpfoMasterIngest"'), 'Must have btnConfirmEpfoMasterIngest');

        // admin-onboarding-upload.js check
        const onboardingJsPath = path.join(rootDir, 'admin-onboarding-upload.js');
        const onboardingJs = fs.readFileSync(onboardingJsPath, 'utf8');

        assert.ok(onboardingJs.includes('extract19EpfoMasterAttributesFromSheetRows'), 'Must implement extract19EpfoMasterAttributesFromSheetRows');
        assert.ok(onboardingJs.includes('renderParsedEpfoMasterPreview'), 'Must implement renderParsedEpfoMasterPreview');
        assert.ok(onboardingJs.includes('executeEpfoMasterIngest'), 'Must implement executeEpfoMasterIngest');

        // epfoProfileUIController.js check
        assert.ok(typeof epfoUi.renderCardHtml === 'function');
        assert.ok(typeof epfoUi.mountEpfoCard === 'function');

        const cardSample = epfoUi.renderCardHtml({
            uan: '100904829102',
            currentMemberId: 'KNBNG00123450000010023',
            kyc: { overallStatus: 'VERIFIED', aadhaarKyc: 'VERIFIED', panKyc: 'VERIFIED', bankKyc: 'VERIFIED' },
            verification: { status: 'SUCCESS', officialSource: 'Decentro Fabric' }
        });
        assert.ok(cardSample.includes('EPFO &amp; Statutory KYC Master Profile'));
        assert.ok(cardSample.includes('id="btnVerifyDecentroEpfo"'));
        assert.ok(cardSample.includes('id="pillAadhaarKyc"'));
        assert.ok(cardSample.includes('id="pillPanKyc"'));
        assert.ok(cardSample.includes('id="pillBankKyc"'));
    });
});
