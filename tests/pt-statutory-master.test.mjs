import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load ptDetailsParser (UMD module)
const parserPath = path.join(rootDir, 'ptDetailsParser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const ptParser = parserModule.exports;

// Load ptDetailsService (UMD module)
const servicePath = path.join(rootDir, 'ptDetailsService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const ptService = serviceModule.exports;

// Load ptProfileUIController (UMD module)
const uiPath = path.join(rootDir, 'ptProfileUIController.js');
const uiContent = fs.readFileSync(uiPath, 'utf8');
const uiModule = { exports: {} };
const uiFn = new Function('module', 'exports', 'require', uiContent);
uiFn(uiModule, uiModule.exports, (dep) => {
    if (dep.includes('ptDetailsService')) return ptService;
    return {};
});
const ptUi = uiModule.exports;

test('PRD Sections 1, 4, 11 & 13: Professional Tax (PT) Statutory Master Module', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (Strict 10 Attributes)', async (st) => {
        await st.test('Schema defines all 10 required columns matching Templates.xlsx and PRD', () => {
            const attrs = ptParser.PT_DETAILS_ATTRIBUTES;
            assert.equal(attrs.length, 10, 'Strictly 10 attributes must be defined');

            const expectedKeys = [
                'Employee ID',
                'Organization ID',
                'PT Applicable',
                'State',
                'PT Registration No',
                'PT Slab',
                'Monthly Deduction',
                'Effective From',
                'Effective To',
                'Active'
            ];

            const actualKeys = attrs.map(a => a.key);
            assert.deepEqual(actualKeys, expectedKeys, 'Attribute keys must match exact 10 column names');

            // Verify required flags and types
            assert.equal(attrs.find(a => a.key === 'Employee ID').required, true);
            assert.equal(attrs.find(a => a.key === 'Organization ID').required, true);
            assert.equal(attrs.find(a => a.key === 'PT Applicable').required, true);
            assert.equal(attrs.find(a => a.key === 'State').required, true);
            assert.equal(attrs.find(a => a.key === 'Active').required, true);
        });

        await st.test('Parses valid 10-column raw row into structured record and Cloud Firestore document', () => {
            const rawRow = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'PT Applicable': 'Yes',
                'State': 'Karnataka',
                'PT Registration No': 'PTRC1234567K',
                'PT Slab': 'KA_TIER_1',
                'Monthly Deduction': '200.00',
                'Effective From': '2026-01-01',
                'Effective To': '',
                'Active': 'Yes'
            };

            const record = ptParser.parseRecord(rawRow, 2);
            assert.equal(record.employeeId, 'EMP0001');
            assert.equal(record.organizationId, 'ORG_KYLRX_01');
            assert.equal(record.isPtApplicable, true);
            assert.equal(record.state, 'Karnataka');
            assert.equal(record.ptRegistrationNo, 'PTRC1234567K');
            assert.equal(record.ptSlab, 'KA_TIER_1');
            assert.equal(record.monthlyDeduction, 200);
            assert.equal(record.effectiveFrom, '2026-01-01');
            assert.equal(record.effectiveTo, null);
            assert.equal(record.isActive, true);

            // Document for Firestore
            const doc = ptParser.toFirestoreDoc(record);
            assert.equal(doc.employeeId, 'EMP0001');
            assert.equal(doc.organizationId, 'ORG_KYLRX_01');
            assert.equal(doc.isPtApplicable, true);
            assert.equal(doc.state, 'Karnataka');
            assert.equal(doc.ptRegistrationNo, 'PTRC1234567K');
            assert.equal(doc.monthlyDeduction, 200);
            assert.equal(doc.effectiveFrom, '2026-01-01');
            assert.equal(doc.effectiveTo, null);
            assert.equal(doc.isActive, true);
            assert.deepEqual(doc.overrides, { isManualOverride: false, exemptReason: null });
        });
    });

    await t.test('2. Ingestion & Validation Pipeline (PRD Section 1)', async (st) => {
        await st.test('Validates and normalizes Yes/No strings to booleans', () => {
            assert.equal(ptParser.normalizeBoolean('Yes'), true);
            assert.equal(ptParser.normalizeBoolean('YES'), true);
            assert.equal(ptParser.normalizeBoolean('true'), true);
            assert.equal(ptParser.normalizeBoolean('No'), false);
            assert.equal(ptParser.normalizeBoolean('no'), false);
            assert.equal(ptParser.normalizeBoolean('0'), false);
            assert.equal(ptParser.normalizeBoolean('', false), false);
        });

        await st.test('Validates strict ISO dates and rejects invalid format', () => {
            assert.equal(ptParser.normalizeDate('2026-01-01'), '2026-01-01');
            assert.equal(ptParser.normalizeDate('2026/01/01'), '2026-01-01');
            assert.equal(ptParser.normalizeDate('01-01-2026'), '2026-01-01');
            assert.equal(ptParser.normalizeDate(''), null);
            assert.equal(ptParser.normalizeDate('invalid-date'), null);
        });

        await st.test('Enforces Effective To >= Effective From when Effective To is present', () => {
            const invalidDateRow = {
                'Employee ID': 'EMP0002',
                'Organization ID': 'ORG_KYLRX_01',
                'PT Applicable': 'Yes',
                'State': 'Maharashtra',
                'PT Registration No': 'PTRC9876543M',
                'PT Slab': 'MH_MALE_TIER_2',
                'Monthly Deduction': 200,
                'Effective From': '2026-06-01',
                'Effective To': '2026-01-01', // Before Effective From!
                'Active': 'Yes'
            };

            const record = ptParser.parseRecord(invalidDateRow, 2);
            const val = ptParser.validateRecord(record, 2);
            assert.equal(val.valid, false);
            assert.ok(val.errors.some(e => e.includes('Effective To date must be on or after Effective From date')));
        });

        await st.test('Flags discrepancy where PT Applicable is Yes but State or PT Registration No is empty', () => {
            const missingStateRow = {
                'Employee ID': 'EMP0003',
                'Organization ID': 'ORG_KYLRX_01',
                'PT Applicable': 'Yes',
                'State': '',
                'PT Registration No': '',
                'PT Slab': 'KA_DEFAULT',
                'Monthly Deduction': 200,
                'Effective From': '2026-01-01',
                'Active': 'Yes'
            };

            const record = ptParser.parseRecord(missingStateRow, 2);
            const val = ptParser.validateRecord(record, 2);
            assert.equal(val.valid, false);
            assert.ok(val.errors.some(e => e.includes("Missing mandatory State jurisdiction")), 'Must flag missing State');
            assert.ok(val.errors.some(e => e.includes("Missing mandatory 'PT Registration No'")), 'Must flag missing PTRC registration number');
        });

        await st.test('Rejects negative Monthly Deduction amounts', () => {
            const negativeDeductionRow = {
                'Employee ID': 'EMP0004',
                'Organization ID': 'ORG_KYLRX_01',
                'PT Applicable': 'Yes',
                'State': 'Karnataka',
                'PT Registration No': 'PTRC1234567K',
                'Monthly Deduction': -50.00,
                'Effective From': '2026-01-01',
                'Active': 'Yes'
            };

            const record = ptParser.parseRecord(negativeDeductionRow, 2);
            const val = ptParser.validateRecord(record, 2);
            assert.equal(val.valid, false);
            assert.ok(val.errors.some(e => e.includes('Monthly Deduction cannot be negative')));
        });

        await st.test('Enforces foreign key integrity against active employee profiles', () => {
            const rows = [
                {
                    'Employee ID': 'UNKNOWN_999',
                    'Organization ID': 'ORG_KYLRX_01',
                    'PT Applicable': 'Yes',
                    'State': 'Karnataka',
                    'PT Registration No': 'PTRC1234567K',
                    'Effective From': '2026-01-01',
                    'Active': 'Yes'
                }
            ];

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002']);
            const result = ptParser.parseSheetRows(rows, { existingEmployeeIds });
            assert.ok(result.errors.some(e => e.includes("does not match any active employee")), 'Must enforce FK check');
        });

        await st.test('Detects duplicate Employee ID entries within the bulk upload sheet', () => {
            const rows = [
                {
                    'Employee ID': 'EMP0001',
                    'Organization ID': 'ORG_KYLRX_01',
                    'PT Applicable': 'Yes',
                    'State': 'Karnataka',
                    'PT Registration No': 'PTRC1234567K',
                    'Effective From': '2026-01-01',
                    'Active': 'Yes'
                },
                {
                    'Employee ID': 'EMP0001', // Duplicate
                    'Organization ID': 'ORG_KYLRX_01',
                    'PT Applicable': 'Yes',
                    'State': 'Karnataka',
                    'PT Registration No': 'PTRC1234567K',
                    'Effective From': '2026-01-01',
                    'Active': 'Yes'
                }
            ];

            const result = ptParser.parseSheetRows(rows);
            assert.ok(result.errors.some(e => e.includes("Duplicate Employee ID 'EMP0001'")));
        });
    });

    await t.test('3. Dynamic Multi-State PT Slab Engine (PRD Sections 4 & 11)', async (st) => {
        await st.test('Karnataka Slab: Gross >= INR 25,000 -> INR 200/month; Gross < INR 25,000 -> Nil', () => {
            // Above or equal to 25,000
            const resAbove = ptService.calculatePtDeduction({
                state: 'Karnataka',
                grossEarnings: 25000,
                gender: 'MALE',
                month: 5
            });
            assert.equal(resAbove.monthlyDeduction, 200);
            assert.equal(resAbove.ptSlab, 'KA_TIER_1');
            assert.equal(resAbove.isExempt, false);

            const resHigh = ptService.calculatePtDeduction({
                state: 'Karnataka',
                grossEarnings: 150000,
                gender: 'FEMALE',
                month: 8
            });
            assert.equal(resHigh.monthlyDeduction, 200);

            // Below 25,000
            const resBelow = ptService.calculatePtDeduction({
                state: 'Karnataka',
                grossEarnings: 24999,
                gender: 'MALE',
                month: 5
            });
            assert.equal(resBelow.monthlyDeduction, 0);
            assert.equal(resBelow.ptSlab, 'KA_EXEMPT');
        });

        await st.test('Maharashtra Slab: Males Gross > 10,000 -> 200 (300 in Feb); Females Gross > 25,000 -> 200 (300 in Feb)', () => {
            // Male - Regular month (October)
            const maleRegular = ptService.calculatePtDeduction({
                state: 'Maharashtra',
                grossEarnings: 15000,
                gender: 'MALE',
                month: 10
            });
            assert.equal(maleRegular.monthlyDeduction, 200);
            assert.equal(maleRegular.ptSlab, 'MH_MALE_TIER_2');

            // Male - February (month = 2) -> INR 300
            const maleFeb = ptService.calculatePtDeduction({
                state: 'Maharashtra',
                grossEarnings: 15000,
                gender: 'MALE',
                month: 2
            });
            assert.equal(maleFeb.monthlyDeduction, 300, 'February deduction in Maharashtra must be INR 300');
            assert.ok(maleFeb.ptSlab.includes('MH_MALE'), 'Slab code must indicate Maharashtra male tier');

            // Male - Gross between 7,501 and 10,000 -> INR 175
            const maleMid = ptService.calculatePtDeduction({
                state: 'Maharashtra',
                grossEarnings: 8500,
                gender: 'MALE',
                month: 5
            });
            assert.equal(maleMid.monthlyDeduction, 175);

            // Male - Gross <= 7,500 -> Nil
            const maleLow = ptService.calculatePtDeduction({
                state: 'Maharashtra',
                grossEarnings: 7500,
                gender: 'MALE',
                month: 5
            });
            assert.equal(maleLow.monthlyDeduction, 0);

            // Female - Gross <= 25,000 -> Exempt (0 deduction)
            const femaleLow = ptService.calculatePtDeduction({
                state: 'Maharashtra',
                grossEarnings: 24000,
                gender: 'FEMALE',
                month: 5
            });
            assert.equal(femaleLow.monthlyDeduction, 0);
            assert.equal(femaleLow.ptSlab, 'MH_FEMALE_EXEMPT');

            // Female - Gross > 25,000 -> Regular INR 200 (INR 300 in February)
            const femaleHighRegular = ptService.calculatePtDeduction({
                state: 'Maharashtra',
                grossEarnings: 30000,
                gender: 'FEMALE',
                month: 7
            });
            assert.equal(femaleHighRegular.monthlyDeduction, 200);

            const femaleHighFeb = ptService.calculatePtDeduction({
                state: 'Maharashtra',
                grossEarnings: 30000,
                gender: 'FEMALE',
                month: 2
            });
            assert.equal(femaleHighFeb.monthlyDeduction, 300, 'Female > 25,000 in Maharashtra February gets INR 300');
        });

        await st.test('Telangana & Andhra Pradesh: Tiered slab calculation based on monthly gross', () => {
            // <= 15,000 -> Nil
            const tgLow = ptService.calculatePtDeduction({
                state: 'Telangana',
                grossEarnings: 14000
            });
            assert.equal(tgLow.monthlyDeduction, 0);

            // 15,001 to 20,000 -> 150
            const tgMid = ptService.calculatePtDeduction({
                state: 'Telangana',
                grossEarnings: 18000
            });
            assert.equal(tgMid.monthlyDeduction, 150);
            assert.equal(tgMid.ptSlab, 'TG_TIER_1');

            // > 20,000 -> 200
            const tgHigh = ptService.calculatePtDeduction({
                state: 'Telangana',
                grossEarnings: 25000
            });
            assert.equal(tgHigh.monthlyDeduction, 200);
            assert.equal(tgHigh.ptSlab, 'TG_TIER_2');
        });

        await st.test('Administrative Manual Override Capability', () => {
            const overrideRes = ptService.calculatePtDeduction({
                state: 'Karnataka',
                grossEarnings: 100000,
                manualOverrideAmount: 0,
                exemptReason: 'SENIOR_CITIZEN_EXEMPTION'
            });
            assert.equal(overrideRes.monthlyDeduction, 0);
            assert.equal(overrideRes.isManualOverride, true);
            assert.equal(overrideRes.exemptReason, 'SENIOR_CITIZEN_EXEMPTION');
        });

        await st.test('Generates Statutory Remittance Return Row and Formatted File', () => {
            const row = ptService.generatePtReturnRow({
                employeeId: 'EMP0001',
                employeeName: 'Rahul Sharma',
                ptRegistrationNo: 'PTRC1234567K',
                grossWages: 85000,
                ptDeducted: 200,
                state: 'Karnataka',
                monthYear: '2026-10'
            });

            const expectedRow = 'EMP0001#Rahul Sharma#PTRC1234567K#85000.00#200.00#Karnataka#2026-10';
            assert.equal(row, expectedRow, 'Remittance row must match exact hash-delimited statutory return format');

            // Generate full return file
            const fileData = ptService.generatePtReturnFile([
                {
                    employeeId: 'EMP0001',
                    employeeName: 'Rahul Sharma',
                    ptRegistrationNo: 'PTRC1234567K',
                    grossWages: 85000,
                    ptDeducted: 200,
                    state: 'Karnataka',
                    monthYear: '2026-10'
                },
                {
                    employeeId: 'EMP0002',
                    employeeName: 'Priya Patel',
                    ptRegistrationNo: 'PTRC9876543M',
                    grossWages: 95000,
                    ptDeducted: 200,
                    state: 'Maharashtra',
                    monthYear: '2026-10'
                }
            ], '2026-10');

            assert.equal(fileData.totalEmployees, 2);
            assert.equal(fileData.totalPtDeducted, 400);
            assert.equal(fileData.byState['Karnataka'].totalPt, 200);
            assert.equal(fileData.byState['Maharashtra'].totalPt, 200);
            assert.ok(fileData.fileContent.includes(expectedRow));
        });
    });

    await t.test('4. Admin UI & Statutory Configuration Drawer (PRD Section 13)', async (st) => {
        await st.test('UI Controller renders Professional Tax Profile Card with State, PTRC, Slab and Recalculate PT', async () => {
            const mockContainer = {
                innerHTML: '',
                querySelector: () => null,
                querySelectorAll: () => []
            };
            const fakeDoc = {
                getElementById: (id) => {
                    if (id === 'ptTestContainer') return mockContainer;
                    return null;
                }
            };

            const prevDoc = globalThis.document;
            globalThis.document = fakeDoc;

            try {
                await ptUi.mountPtCard('ptTestContainer', 'EMP0001', {
                    state: 'Karnataka',
                    ptRegistrationNo: 'PTRC1234567K',
                    ptSlab: 'KA_TIER_1',
                    monthlyDeduction: 200.00,
                    isActive: true
                });

                assert.ok(mockContainer.innerHTML.includes('Professional Tax (PT) Statutory Profile'), 'Must render PT card header');
                assert.ok(mockContainer.innerHTML.includes('Karnataka'), 'Must render state jurisdiction');
                assert.ok(mockContainer.innerHTML.includes('PTRC1234567K'), 'Must render PTRC registration number');
                assert.ok(mockContainer.innerHTML.includes('KA_TIER_1'), 'Must render assigned slab');
                assert.ok(mockContainer.innerHTML.includes('200.00'), 'Must render monthly deduction amount');
                assert.ok(mockContainer.innerHTML.includes('btnRecalculatePt'), 'Must provide Recalculate PT inline action');
                assert.ok(mockContainer.innerHTML.includes('Active'), 'Must render Active status badge');
            } finally {
                globalThis.document = prevDoc;
            }
        });
    });

    await t.test('5. Data Architecture (Cloud Firestore)', async (st) => {
        await st.test('CRUD operations on organizations/{orgId}/employee_pt_details/{employeeId}', async () => {
            const orgId = 'ORG_KYLRX_TEST';
            const empId = 'EMP0099';

            const payload = {
                employeeId: empId,
                organizationId: orgId,
                isPtApplicable: true,
                state: 'Maharashtra',
                ptRegistrationNo: 'PTRC9988776M',
                ptSlab: 'MH_MALE_TIER_2',
                monthlyDeduction: 200.00,
                effectiveFrom: '2026-04-01',
                effectiveTo: null,
                isActive: true,
                overrides: {
                    isManualOverride: false,
                    exemptReason: null
                }
            };

            const saved = await ptService.saveEmployeePtDetails(orgId, empId, payload);
            assert.equal(saved.employeeId, empId);
            assert.equal(saved.state, 'Maharashtra');

            const retrieved = await ptService.getEmployeePtDetails(orgId, empId);
            assert.equal(retrieved.employeeId, empId);
            assert.equal(retrieved.ptRegistrationNo, 'PTRC9988776M');
            assert.equal(retrieved.monthlyDeduction, 200);

            const allDocs = await ptService.listAllPtDetails(orgId);
            assert.ok(allDocs.some(d => d.employeeId === empId));
        });
    });

    await t.test('6. Excel Workbook & Template Integrity (Templates.xlsx)', async (st) => {
        await st.test("Templates.xlsx contains 'PT Details' sheet matching all 10 canonical columns", () => {
            const workbookPath = path.join(rootDir, 'Templates.xlsx');
            assert.ok(fs.existsSync(workbookPath), 'Templates.xlsx must exist');

            const buffer = fs.readFileSync(workbookPath);
            const wb = xlsx.read(buffer, { type: 'buffer' });

            const hasPtDetails = wb.SheetNames.includes('PT Details');
            assert.ok(hasPtDetails, "'PT Details' sheet must exist in Templates.xlsx");

            const sheet = wb.Sheets['PT Details'];
            const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
            assert.ok(rows.length > 0, "'PT Details' sheet must not be empty");

            const headers = rows[0].map(h => String(h).trim());
            const expected10Cols = [
                'Employee ID',
                'Organization ID',
                'PT Applicable',
                'State',
                'PT Registration No',
                'PT Slab',
                'Monthly Deduction',
                'Effective From',
                'Effective To',
                'Active'
            ];

            assert.deepEqual(headers, expected10Cols, "Headers in 'PT Details' sheet must match all 10 canonical columns");
        });

        await st.test("admin-onboarding-upload.html has PT console tabs, preview and table container", () => {
            const htmlPath = path.join(rootDir, 'admin-onboarding-upload.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            assert.ok(html.includes('id="tabPtMaster"'), 'Must have #tabPtMaster');
            assert.ok(html.includes('id="ptMasterManagementView"'), 'Must have #ptMasterManagementView');
            assert.ok(html.includes('id="ptMasterParseResultsContainer"'), 'Must have #ptMasterParseResultsContainer');
            assert.ok(html.includes('id="parsedPtMasterTableBody"'), 'Must have #parsedPtMasterTableBody');
            assert.ok(html.includes('id="btnConfirmPtMasterIngest"'), 'Must have #btnConfirmPtMasterIngest');
            assert.ok(html.includes('id="onboardingPtMasterTableContainer"'), 'Must have #onboardingPtMasterTableContainer');
            assert.ok(html.includes('src="ptDetailsParser.js"'), 'Must import ptDetailsParser.js');
            assert.ok(html.includes('src="ptDetailsService.js"'), 'Must import ptDetailsService.js');
            assert.ok(html.includes('src="ptProfileUIController.js"'), 'Must import ptProfileUIController.js');
        });

        await st.test("admin-dashboard.html has PT statutory drawer container and script imports", () => {
            const htmlPath = path.join(rootDir, 'admin-dashboard.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            assert.ok(html.includes('id="ptStatutoryDrawerContainer"'), 'Must have #ptStatutoryDrawerContainer');
            assert.ok(html.includes('src="ptDetailsParser.js"'), 'Must import ptDetailsParser.js');
            assert.ok(html.includes('src="ptDetailsService.js"'), 'Must import ptDetailsService.js');
            assert.ok(html.includes('src="ptProfileUIController.js"'), 'Must import ptProfileUIController.js');
        });
    });
});
