import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load esicDetailsParser (UMD module)
const parserPath = path.join(rootDir, 'esicDetailsParser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const esicParser = parserModule.exports;

// Load esicDetailsService (UMD module)
const servicePath = path.join(rootDir, 'esicDetailsService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const esicService = serviceModule.exports;

// Load esicProfileUIController (UMD module)
const uiPath = path.join(rootDir, 'esicProfileUIController.js');
const uiContent = fs.readFileSync(uiPath, 'utf8');
const uiModule = { exports: {} };
const uiFn = new Function('module', 'exports', 'require', uiContent);
uiFn(uiModule, uiModule.exports, (dep) => {
    if (dep.includes('esicDetailsService')) return esicService;
    return {};
});
const esicUi = uiModule.exports;

test('PRD Sections 1, 4, 11 & 13: ESIC Statutory Master Module', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (Strict 18 Attributes)', async (st) => {
        await st.test('Schema defines all 18 required columns with correct metadata and keys', () => {
            const attrs = esicParser.ESIC_DETAILS_ATTRIBUTES;
            assert.equal(attrs.length, 18, 'Strictly 18 attributes must be defined');

            const expectedKeys = [
                'Employee ID',
                'Organization ID',
                'ESIC Applicable',
                'IP Number',
                'ESIC Employer Code',
                'Date of ESIC Joining',
                'Date of ESIC Exit',
                'Insured Person Status',
                'Aadhaar Seeding',
                'Family/Dependent Details',
                'Dispensary/Branch',
                'Contribution State',
                'Insurance Number Verified',
                'Official Source',
                'Verification Method',
                'Verification Reference',
                'Last Verified',
                'Last Synced'
            ];

            const actualKeys = attrs.map(a => a.key);
            assert.deepEqual(actualKeys, expectedKeys, 'Attribute keys must match exact 18 column names');

            // Verify required flags and defaults
            assert.equal(attrs.find(a => a.key === 'Employee ID').required, true);
            assert.equal(attrs.find(a => a.key === 'Organization ID').required, true);
            assert.equal(attrs.find(a => a.key === 'ESIC Applicable').required, true);
            assert.equal(attrs.find(a => a.key === 'Insured Person Status').required, true);
            assert.equal(attrs.find(a => a.key === 'Aadhaar Seeding').required, true);
            assert.equal(attrs.find(a => a.key === 'Contribution State').required, true);
        });

        await st.test('Parses valid 18-column raw row into structured record and Cloud Firestore document', () => {
            const rawRow = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'ESIC Applicable': 'Yes',
                'IP Number': '3100482910',
                'ESIC Employer Code': '53000123450000001',
                'Date of ESIC Joining': '2026-01-15',
                'Date of ESIC Exit': '',
                'Insured Person Status': 'ACTIVE',
                'Aadhaar Seeding': 'VERIFIED',
                'Family/Dependent Details': 'SUBMITTED',
                'Dispensary/Branch': 'ESIC Dispensary Indiranagar, BLR',
                'Contribution State': 'Karnataka',
                'Insurance Number Verified': 'Yes',
                'Official Source': 'Decentro Fabric',
                'Verification Method': 'API',
                'Verification Reference': 'DEC_ESIC_VERIF_8829102',
                'Last Verified': '2026-10-05 10:30:00',
                'Last Synced': '2026-10-05 10:30:00'
            };

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002']);
            const result = esicParser.parseSheetRows([rawRow], { existingEmployeeIds, orgId: 'ORG_KYLRX_01' });

            assert.equal(result.valid, true);
            assert.equal(result.validCount, 1);
            assert.equal(result.errorCount, 0);

            const doc = result.firestoreDocs[0];
            assert.equal(doc.employeeId, 'EMP0001');
            assert.equal(doc.organizationId, 'ORG_KYLRX_01');
            assert.equal(doc.isEsicApplicable, true);
            assert.equal(doc.ipNumber, '3100482910');
            assert.equal(doc.esicEmployerCode, '53000123450000001');
            assert.equal(doc.dateOfEsicJoining, '2026-01-15');
            assert.equal(doc.dateOfEsicExit, null);
            assert.equal(doc.insuredPersonStatus, 'ACTIVE');
            assert.equal(doc.aadhaarSeeding, 'VERIFIED');
            assert.equal(doc.familyDependentDetails, 'SUBMITTED');
            assert.equal(doc.dispensaryBranch, 'ESIC Dispensary Indiranagar, BLR');
            assert.equal(doc.contributionState, 'Karnataka');
            assert.equal(doc.isInsuranceNumberVerified, true);
            assert.equal(doc.verification.officialSource, 'Decentro Fabric');
            assert.equal(doc.verification.verificationMethod, 'API');
            assert.equal(doc.verification.verificationReference, 'DEC_ESIC_VERIF_8829102');
            assert.ok(doc.createdAt);
            assert.ok(doc.updatedAt);
        });
    });

    await t.test('2. Ingestion & Validation Pipeline (PRD Section 1)', async (st) => {
        await st.test('Validates IP Number format (10 to 17 digits) strictly when ESIC Applicable is true', () => {
            // Valid IP numbers (10 to 17 digits)
            assert.equal(esicParser.validateIpNumber('3100482910'), true);
            assert.equal(esicParser.validateIpNumber('12345678901234567'), true);

            // Invalid IP numbers
            assert.equal(esicParser.validateIpNumber('123456789'), false, '9 digits is too short');
            assert.equal(esicParser.validateIpNumber('123456789012345678'), false, '18 digits is too long');
            assert.equal(esicParser.validateIpNumber('310048291A'), false, 'Contains letter');
            assert.equal(esicParser.validateIpNumber(''), false, 'Empty IP number is invalid');
        });

        await st.test('Validates 17-digit ESIC Employer Code format', () => {
            assert.equal(esicParser.validateEmployerCode('53000123450000001'), true);
            assert.equal(esicParser.validateEmployerCode('5300012345000000'), false, '16 digits is too short');
            assert.equal(esicParser.validateEmployerCode('530001234500000001'), false, '18 digits is too long');
            assert.equal(esicParser.validateEmployerCode('5300012345000000A'), false, 'Contains letter');
        });

        await st.test('Enforces Cross-Sheet Foreign Key Integrity (checks active employee list)', () => {
            const rawRow = {
                'Employee ID': 'EMP_NOT_EXIST',
                'Organization ID': 'ORG_KYLRX_01',
                'ESIC Applicable': 'Yes',
                'IP Number': '3100482910',
                'Date of ESIC Joining': '2026-01-15'
            };

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002']);
            const result = esicParser.parseSheetRows([rawRow], { existingEmployeeIds });

            assert.equal(result.valid, false);
            assert.equal(result.errorCount > 0, true);
            assert.ok(result.errors.some(e => e.message.includes('EMP_NOT_EXIST') && e.message.includes('Foreign key')));
        });

        await st.test('Detects duplicate Employee ID and duplicate IP Number in sheet rows', () => {
            const row1 = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'ESIC Applicable': 'Yes',
                'IP Number': '3100482910',
                'Date of ESIC Joining': '2026-01-15'
            };
            const row2 = {
                'Employee ID': 'EMP0001', // duplicate employee
                'Organization ID': 'ORG_KYLRX_01',
                'ESIC Applicable': 'Yes',
                'IP Number': '3100482911',
                'Date of ESIC Joining': '2026-01-15'
            };
            const row3 = {
                'Employee ID': 'EMP0002',
                'Organization ID': 'ORG_KYLRX_01',
                'ESIC Applicable': 'Yes',
                'IP Number': '3100482910', // duplicate IP number
                'Date of ESIC Joining': '2026-01-15'
            };

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002']);
            const result = esicParser.parseSheetRows([row1, row2, row3], { existingEmployeeIds });

            assert.equal(result.valid, false);
            assert.ok(result.errors.some(e => e.message.includes("Duplicate Employee ID 'EMP0001'")));
            assert.ok(result.errors.some(e => e.message.includes("Duplicate IP Number '3100482910'")));
        });

        await st.test('Normalizes dates to strict ISO YYYY-MM-DD and booleans to true/false', () => {
            assert.equal(esicParser.sanitizeDate('15/01/2026'), '2026-01-15');
            assert.equal(esicParser.sanitizeDate('2026-01-15'), '2026-01-15');
            assert.equal(esicParser.sanitizeDate(''), null);
            assert.equal(esicParser.sanitizeDate(null), null);
        });
    });

    await t.test('3. Statutory Wage Ceiling & Monthly Contribution Engine (PRD Sections 4 & 11)', async (st) => {
        await st.test('Computes 0.75% EE deduction and 3.25% ER contribution when gross <= ₹21,000 ceiling', () => {
            const profile = { isEsicApplicable: true, ipNumber: '3100482910' };
            const wages = { grossWages: 20000 };
            const calc = esicService.calculateMonthlyContributions(profile, wages, { daysWorked: 30 });

            assert.equal(calc.isApplicable, true);
            assert.equal(calc.isExempt, false);
            assert.equal(calc.grossWages, 20000);
            assert.equal(calc.employeeDeduction, 150); // 20000 * 0.75% = 150
            assert.equal(calc.employerContribution, 650); // 20000 * 3.25% = 650
            assert.equal(calc.totalEsicRemittance, 800); // 150 + 650 = 800 (4.00%)
            assert.equal(calc.reasonCode, '0');
        });

        await st.test('Applies ₹25,000 ceiling for Persons with Disabilities (PWD)', () => {
            const profile = { isEsicApplicable: true, ipNumber: '3100482910', isPersonWithDisability: true };
            const wages = { grossWages: 24000 };
            
            // Standard person would be exempt at 24,000
            const regularCalc = esicService.calculateMonthlyContributions({ isEsicApplicable: true }, wages);
            assert.equal(regularCalc.isExempt, true);
            assert.equal(regularCalc.employeeDeduction, 0);

            // PWD person is covered up to ₹25,000
            const pwdCalc = esicService.calculateMonthlyContributions(profile, wages, { isPwd: true });
            assert.equal(pwdCalc.isExempt, false);
            assert.equal(pwdCalc.statutoryCeiling, 25000);
            assert.equal(pwdCalc.employeeDeduction, 180); // 24000 * 0.75% = 180
            assert.equal(pwdCalc.employerContribution, 780); // 24000 * 3.25% = 780
            assert.equal(pwdCalc.totalEsicRemittance, 960);
        });

        await st.test('Applies Contribution Period Rollover Rule (Apr-Sep, Oct-Mar coverage continuation)', () => {
            const profile = { isEsicApplicable: true, ipNumber: '3100482910' };
            const wages = { grossWages: 30000 }; // Exceeds ceiling

            // Without rollover flag: exempt
            const normalCalc = esicService.calculateMonthlyContributions(profile, wages);
            assert.equal(normalCalc.isExempt, true);
            assert.equal(normalCalc.employeeDeduction, 0);

            // With rollover flag (joined/covered earlier in cycle): covered until cycle end
            const rolloverCalc = esicService.calculateMonthlyContributions(profile, wages, { inContributionPeriodCoverage: true });
            assert.equal(rolloverCalc.isExempt, false);
            assert.equal(rolloverCalc.employeeDeduction, 225); // 30000 * 0.75% = 225
            assert.equal(rolloverCalc.employerContribution, 975); // 30000 * 3.25% = 975
            assert.equal(rolloverCalc.totalEsicRemittance, 1200);
            assert.equal(rolloverCalc.inContributionPeriodCoverage, true);
        });

        await st.test('Generates hash-delimited monthly return row matching 7-column PRD specification', () => {
            const profile = {
                ipNumber: '3100482910',
                employeeName: 'Aarav Patel',
                isEsicApplicable: true
            };
            const wages = { grossWages: 20000 };
            const row = esicService.generateMonthlyReturnRow(profile, wages, { daysWorked: 26 });

            // Expected columns: IP_Number#IP_Name#No_Of_Days_Worked#Total_Monthly_Wages#IP_Contribution#Employer_Contribution#Reason_Code
            const parts = row.split('#');
            assert.equal(parts.length, 7, 'Must have exactly 7 hash-delimited columns');
            assert.equal(parts[0], '3100482910');
            assert.equal(parts[1], 'Aarav Patel');
            assert.equal(parts[2], '26');
            assert.equal(parts[3], '20000.00');
            assert.equal(parts[4], '150.00');
            assert.equal(parts[5], '650.00');
            assert.equal(parts[6], '0');
        });

        await st.test('Compiles complete monthly return file with ledger totals and remittance sum', () => {
            const records = [
                {
                    profile: { ipNumber: '3100482910', isEsicApplicable: true },
                    wages: { grossWages: 20000 },
                    options: { employeeName: 'Employee 1', daysWorked: 30 }
                },
                {
                    profile: { ipNumber: '3100482911', isEsicApplicable: true },
                    wages: { grossWages: 15000 },
                    options: { employeeName: 'Employee 2', daysWorked: 30 }
                }
            ];

            const file = esicService.generateMonthlyReturnFile(records, {
                employerCode: '53000123450000001',
                returnMonth: '10',
                returnYear: 2026
            });

            assert.equal(file.filename, 'ESIC_Return_53000123450000001_202610.txt');
            assert.equal(file.rowCount, 2);
            assert.equal(file.totalWages, 35000);
            assert.equal(file.totalIpContribution, 262.5); // (20000 * 0.75%) + (15000 * 0.75%) = 150 + 112.5 = 262.5
            assert.equal(file.totalEmployerContribution, 1137.5); // (20000 * 3.25%) + (15000 * 3.25%) = 650 + 487.5 = 1137.5
            assert.equal(file.totalRemittance, 1400); // 35000 * 4.00% = 1400
        });
    });

    await t.test('4. Decentro / ESIC IP Verification Handshake (PRD Section 13)', async (st) => {
        await st.test('Dispatches Decentro verification, updates profile, and sets isInsuranceNumberVerified to true', async () => {
            const orgId = 'ORG_KYLRX_01';
            const empId = 'EMP0003'; // Unverified in defaults

            const res = await esicService.verifyIpNumberViaDecentro(orgId, empId, {
                officialSource: 'Decentro Fabric'
            });

            assert.equal(res.success, true);
            assert.equal(res.status, 'SUCCESS');
            assert.equal(res.profile.isInsuranceNumberVerified, true);
            assert.equal(res.profile.verification.officialSource, 'Decentro Fabric');
            assert.ok(res.profile.verification.verificationReference.startsWith('DEC_ESIC_VERIF_'));
            assert.ok(res.profile.verification.lastVerified);

            // Fetch to verify persistence in ledger
            const saved = await esicService.getEmployeeEsicDetails(orgId, empId);
            assert.equal(saved.isInsuranceNumberVerified, true);
        });

        await st.test('Rejects invalid IP Number during verification handshake', async () => {
            const res = await esicService.verifyIpNumberViaDecentro('ORG_KYLRX_01', 'EMP_TEST', {
                ipNumber: '123' // Invalid
            });

            assert.equal(res.success, false);
            assert.equal(res.status, 'FAILED');
            assert.ok(res.message.includes('Invalid IP Number'));
        });
    });

    await t.test('5. Admin UI & Verification Drawer Controller (PRD Section 13)', async (st) => {
        await st.test('Renders ESIC card with live status pills, dispensary, contribution state, and verify trigger', () => {
            const profile = {
                employeeId: 'EMP0001',
                ipNumber: '3100482910',
                esicEmployerCode: '53000123450000001',
                insuredPersonStatus: 'ACTIVE',
                aadhaarSeeding: 'VERIFIED',
                familyDependentDetails: 'SUBMITTED',
                dispensaryBranch: 'ESIC Dispensary Indiranagar, BLR',
                contributionState: 'Karnataka',
                isInsuranceNumberVerified: true,
                verification: {
                    officialSource: 'Decentro Fabric',
                    verificationReference: 'DEC_ESIC_VERIF_8829102',
                    lastVerified: '2026-10-05T10:30:00Z'
                }
            };

            const html = esicUi.renderCardHtml(profile, { employeeId: 'EMP0001' });

            assert.ok(html.includes('id="esicStatutoryMasterCard"'));
            assert.ok(html.includes('3100482910'), 'Must display IP number');
            assert.ok(html.includes('53000123450000001'), 'Must display employer code');
            assert.ok(html.includes('ESIC Dispensary Indiranagar, BLR'), 'Must display dispensary branch');
            assert.ok(html.includes('Karnataka'), 'Must display contribution state');
            assert.ok(html.includes('btnVerifyDecentroEsic'), 'Must have Decentro verify action button');
            assert.ok(html.includes('pillIpStatus'), 'Must display IP status pill');
            assert.ok(html.includes('pillAadhaarSeeding'), 'Must display Aadhaar pill');
            assert.ok(html.includes('pillFamilyDetails'), 'Must display Family pill');
            assert.ok(html.includes('pillIpVerification'), 'Must display IP verification pill');
        });
    });

    await t.test('6. Full End-to-End System Integration', async (st) => {
        await st.test('Templates.xlsx contains official ESIC Details sheet matching all 18 columns', () => {
            const templatesPath = path.join(rootDir, 'Templates.xlsx');
            assert.ok(fs.existsSync(templatesPath), 'Templates.xlsx must exist');

            const fileBuffer = fs.readFileSync(templatesPath);
            const wb = xlsx.read(fileBuffer, { type: 'buffer' });
            assert.ok(wb.SheetNames.includes('ESIC Details'), "Templates.xlsx must contain 'ESIC Details' sheet");

            const ws = wb.Sheets['ESIC Details'];
            const rows = xlsx.utils.sheet_to_json(ws);
            assert.ok(rows.length > 0, "'ESIC Details' sheet must have rows");

            const parseRes = esicParser.parseSheetRows(rows, { orgId: 'ORG_KYLRX_01', existingEmployeeIds: ['EMP0001', 'EMP0002', 'EMP0003'] });
            assert.equal(parseRes.valid, true, 'Parsing ESIC Details sheet must succeed with 0 errors');
            assert.equal(parseRes.validCount, rows.length);
        });

        await st.test('assets/Templates.xlsx contains official ESIC Details sheet', () => {
            const templatesPath = path.join(rootDir, 'assets', 'Templates.xlsx');
            assert.ok(fs.existsSync(templatesPath), 'assets/Templates.xlsx must exist');

            const fileBuffer = fs.readFileSync(templatesPath);
            const wb = xlsx.read(fileBuffer, { type: 'buffer' });
            assert.ok(wb.SheetNames.includes('ESIC Details'), "assets/Templates.xlsx must contain 'ESIC Details' sheet");
        });

        await st.test('admin-onboarding-upload.html contains ESIC elements and scripts', () => {
            const html = fs.readFileSync(path.join(rootDir, 'admin-onboarding-upload.html'), 'utf8');
            assert.ok(html.includes('id="tabEsicMaster"'), 'Must have tabEsicMaster');
            assert.ok(html.includes('id="esicMasterParseResultsContainer"'), 'Must have esicMasterParseResultsContainer');
            assert.ok(html.includes('id="esicMasterManagementView"'), 'Must have esicMasterManagementView');
            assert.ok(html.includes('esicDetailsParser.js'), 'Must include esicDetailsParser.js');
            assert.ok(html.includes('esicDetailsService.js'), 'Must include esicDetailsService.js');
            assert.ok(html.includes('esicProfileUIController.js'), 'Must include esicProfileUIController.js');
        });

        await st.test('admin-dashboard.html and employee-profile-controller.js integrate ESIC Statutory Card', () => {
            const dashHtml = fs.readFileSync(path.join(rootDir, 'admin-dashboard.html'), 'utf8');
            assert.ok(dashHtml.includes('id="esicStatutoryDrawerContainer"'), 'Must have esicStatutoryDrawerContainer');
            assert.ok(dashHtml.includes('esicDetailsParser.js'), 'Must include esicDetailsParser.js');
            assert.ok(dashHtml.includes('esicDetailsService.js'), 'Must include esicDetailsService.js');
            assert.ok(dashHtml.includes('esicProfileUIController.js'), 'Must include esicProfileUIController.js');

            const empCtrl = fs.readFileSync(path.join(rootDir, 'employee-profile-controller.js'), 'utf8');
            assert.ok(empCtrl.includes('mountEsicCard'), 'Must call mountEsicCard in employee profile drawer');
        });
    });
});
