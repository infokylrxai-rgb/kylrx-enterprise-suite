import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load lwfDetailsParser (UMD module)
const parserPath = path.join(rootDir, 'lwfDetailsParser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const lwfParser = parserModule.exports;

// Load lwfDetailsService (UMD module)
const servicePath = path.join(rootDir, 'lwfDetailsService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const lwfService = serviceModule.exports;

// Load lwfProfileUIController (UMD module)
const uiPath = path.join(rootDir, 'lwfProfileUIController.js');
const uiContent = fs.readFileSync(uiPath, 'utf8');
const uiModule = { exports: {} };
const uiFn = new Function('module', 'exports', 'require', uiContent);
uiFn(uiModule, uiModule.exports, (dep) => {
    if (dep.includes('lwfDetailsService')) return lwfService;
    return {};
});
const lwfUi = uiModule.exports;

test('PRD Sections 1, 4, 11 & 13: Labour Welfare Fund (LWF) Statutory Master Module', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (Strict 10 Attributes)', async (st) => {
        await st.test('Schema defines all 10 required columns matching Templates.xlsx and PRD', () => {
            const attrs = lwfParser.LWF_DETAILS_ATTRIBUTES;
            assert.equal(attrs.length, 10, 'Strictly 10 attributes must be defined');

            const expectedKeys = [
                'Employee ID',
                'Organization ID',
                'LWF Applicable',
                'State',
                'Employer Registration No',
                'Employee Contribution',
                'Employer Contribution',
                'Frequency',
                'Effective From',
                'Effective To'
            ];

            const actualKeys = attrs.map(a => a.key);
            assert.deepEqual(actualKeys, expectedKeys, 'Attribute keys must match exact 10 column names');

            // Verify required flags and types
            assert.equal(attrs.find(a => a.key === 'Employee ID').required, true);
            assert.equal(attrs.find(a => a.key === 'Organization ID').required, true);
            assert.equal(attrs.find(a => a.key === 'LWF Applicable').required, true);
            assert.equal(attrs.find(a => a.key === 'State').required, true);
            assert.equal(attrs.find(a => a.key === 'Employer Registration No').required, true);
            assert.equal(attrs.find(a => a.key === 'Employee Contribution').required, true);
            assert.equal(attrs.find(a => a.key === 'Employer Contribution').required, true);
            assert.equal(attrs.find(a => a.key === 'Frequency').required, true);
            assert.equal(attrs.find(a => a.key === 'Effective From').required, true);
        });

        await st.test('Parses valid 10-column raw row into structured record and Cloud Firestore document', () => {
            const rawRow = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'LWF Applicable': 'Yes',
                'State': 'Karnataka',
                'Employer Registration No': 'LWF/KA/BNG/2026/0912',
                'Employee Contribution': '20.00',
                'Employer Contribution': '40.00',
                'Frequency': 'Annual',
                'Effective From': '2026-01-01',
                'Effective To': ''
            };

            const record = lwfParser.parseRecord(rawRow, 2);
            assert.equal(record.employeeId, 'EMP0001');
            assert.equal(record.organizationId, 'ORG_KYLRX_01');
            assert.equal(record.isLwfApplicable, true);
            assert.equal(record.state, 'Karnataka');
            assert.equal(record.employerRegistrationNo, 'LWF/KA/BNG/2026/0912');
            assert.equal(record.employeeContribution, 20);
            assert.equal(record.employerContribution, 40);
            assert.equal(record.frequency, 'Annual');
            assert.equal(record.effectiveFrom, '2026-01-01');
            assert.equal(record.effectiveTo, null);

            // Document for Cloud Firestore
            const doc = lwfParser.toFirestoreDoc(record);
            assert.equal(doc.employeeId, 'EMP0001');
            assert.equal(doc.organizationId, 'ORG_KYLRX_01');
            assert.equal(doc.isLwfApplicable, true);
            assert.equal(doc.state, 'Karnataka');
            assert.equal(doc.employerRegistrationNo, 'LWF/KA/BNG/2026/0912');
            assert.equal(doc.employeeContribution, 20);
            assert.equal(doc.employerContribution, 40);
            assert.equal(doc.frequency, 'Annual');
            assert.equal(doc.effectiveFrom, '2026-01-01');
            assert.equal(doc.effectiveTo, null);
            assert.deepEqual(doc.deductionSchedule.deductionMonths, [12]);
            assert.ok(typeof doc.deductionSchedule.nextDeduction === 'string');
        });
    });

    await t.test('2. Ingestion & Validation Pipeline (PRD Section 1)', async (st) => {
        await st.test('Validates and normalizes Yes/No strings to booleans', () => {
            assert.equal(lwfParser.normalizeBoolean('Yes'), true);
            assert.equal(lwfParser.normalizeBoolean('YES'), true);
            assert.equal(lwfParser.normalizeBoolean('true'), true);
            assert.equal(lwfParser.normalizeBoolean('No'), false);
            assert.equal(lwfParser.normalizeBoolean('no'), false);
            assert.equal(lwfParser.normalizeBoolean('0'), false);
            assert.equal(lwfParser.normalizeBoolean('', false), false);
        });

        await st.test('Validates strict ISO dates and rejects invalid format', () => {
            assert.equal(lwfParser.normalizeDate('2026-01-01'), '2026-01-01');
            assert.equal(lwfParser.normalizeDate('2026/01/01'), '2026-01-01');
            assert.equal(lwfParser.normalizeDate('01-01-2026'), '2026-01-01');
            assert.equal(lwfParser.normalizeDate(''), null);
            assert.equal(lwfParser.normalizeDate('invalid-date'), null);
        });

        await st.test('Enforces Effective To >= Effective From when Effective To is present', () => {
            const invalidDateRow = {
                'Employee ID': 'EMP0002',
                'Organization ID': 'ORG_KYLRX_01',
                'LWF Applicable': 'Yes',
                'State': 'Maharashtra',
                'Employer Registration No': 'LWF/MH/MUM/2026/0881',
                'Employee Contribution': 12,
                'Employer Contribution': 36,
                'Frequency': 'Half-Yearly',
                'Effective From': '2026-06-01',
                'Effective To': '2026-01-01' // Before Effective From!
            };

            const record = lwfParser.parseRecord(invalidDateRow, 2);
            const val = lwfParser.validateRecord(record, 2);
            assert.equal(val.valid, false);
            assert.ok(val.errors.some(e => e.includes('Effective To date must be on or after Effective From date')));
        });

        await st.test('Conditional Integrity: Flags discrepancy when LWF Applicable is Yes but State, Frequency, or Reg No is missing', () => {
            const missingStateRow = {
                'Employee ID': 'EMP0003',
                'Organization ID': 'ORG_KYLRX_01',
                'LWF Applicable': 'Yes',
                'State': '',
                'Employer Registration No': '',
                'Employee Contribution': 20,
                'Employer Contribution': 40,
                'Frequency': '',
                'Effective From': '2026-01-01'
            };

            const record = lwfParser.parseRecord(missingStateRow, 2);
            const val = lwfParser.validateRecord(record, 2);
            assert.equal(val.valid, false);
            assert.ok(val.errors.some(e => e.includes("Missing mandatory State jurisdiction")), 'Must flag missing State');
            assert.ok(val.errors.some(e => e.includes("Missing mandatory 'Employer Registration No'")), 'Must flag missing Employer Registration No');
            assert.ok(val.errors.some(e => e.includes("Missing mandatory 'Frequency'")), 'Must flag missing Frequency');
        });

        await st.test('Rejects negative Employee and Employer Contribution amounts', () => {
            const negativeEeRow = {
                'Employee ID': 'EMP0004',
                'Organization ID': 'ORG_KYLRX_01',
                'LWF Applicable': 'Yes',
                'State': 'Karnataka',
                'Employer Registration No': 'LWF/KA/BNG/2026/0912',
                'Employee Contribution': -10.00,
                'Employer Contribution': 40.00,
                'Frequency': 'Annual',
                'Effective From': '2026-01-01'
            };

            const recordEe = lwfParser.parseRecord(negativeEeRow, 2);
            const valEe = lwfParser.validateRecord(recordEe, 2);
            assert.equal(valEe.valid, false);
            assert.ok(valEe.errors.some(e => e.includes('Employee Contribution cannot be negative')));

            const negativeErRow = {
                'Employee ID': 'EMP0005',
                'Organization ID': 'ORG_KYLRX_01',
                'LWF Applicable': 'Yes',
                'State': 'Karnataka',
                'Employer Registration No': 'LWF/KA/BNG/2026/0912',
                'Employee Contribution': 20.00,
                'Employer Contribution': -40.00,
                'Frequency': 'Annual',
                'Effective From': '2026-01-01'
            };

            const recordEr = lwfParser.parseRecord(negativeErRow, 2);
            const valEr = lwfParser.validateRecord(recordEr, 2);
            assert.equal(valEr.valid, false);
            assert.ok(valEr.errors.some(e => e.includes('Employer Contribution cannot be negative')));
        });

        await st.test('Frequency Validation: Rejects invalid frequency strings and validates canonical enums', () => {
            const invalidFreqRow = {
                'Employee ID': 'EMP0006',
                'Organization ID': 'ORG_KYLRX_01',
                'LWF Applicable': 'Yes',
                'State': 'Karnataka',
                'Employer Registration No': 'LWF/KA/BNG/2026/0912',
                'Employee Contribution': 20,
                'Employer Contribution': 40,
                'Frequency': 'Every_Two_Weeks', // Invalid!
                'Effective From': '2026-01-01'
            };

            const record = lwfParser.parseRecord(invalidFreqRow, 2);
            const val = lwfParser.validateRecord(record, 2);
            assert.equal(val.valid, false);
            assert.ok(val.errors.some(e => e.includes("Invalid Frequency 'Every_Two_Weeks'")));
        });

        await st.test('Enforces foreign key integrity against active employee profiles', () => {
            const rows = [
                {
                    'Employee ID': 'NON_EXISTENT_EMP',
                    'Organization ID': 'ORG_KYLRX_01',
                    'LWF Applicable': 'Yes',
                    'State': 'Karnataka',
                    'Employer Registration No': 'LWF/KA/BNG/2026/0912',
                    'Employee Contribution': 20,
                    'Employer Contribution': 40,
                    'Frequency': 'Annual',
                    'Effective From': '2026-01-01'
                }
            ];

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002']);
            const result = lwfParser.parseSheetRows(rows, { existingEmployeeIds });
            assert.ok(result.errors.some(e => e.includes("does not match any active employee")), 'Must enforce FK check');
        });

        await st.test('Detects duplicate Employee ID entries within the bulk upload sheet', () => {
            const rows = [
                {
                    'Employee ID': 'EMP0001',
                    'Organization ID': 'ORG_KYLRX_01',
                    'LWF Applicable': 'Yes',
                    'State': 'Karnataka',
                    'Employer Registration No': 'LWF/KA/BNG/2026/0912',
                    'Employee Contribution': 20,
                    'Employer Contribution': 40,
                    'Frequency': 'Annual',
                    'Effective From': '2026-01-01'
                },
                {
                    'Employee ID': 'EMP0001', // Duplicate
                    'Organization ID': 'ORG_KYLRX_01',
                    'LWF Applicable': 'Yes',
                    'State': 'Karnataka',
                    'Employer Registration No': 'LWF/KA/BNG/2026/0912',
                    'Employee Contribution': 20,
                    'Employer Contribution': 40,
                    'Frequency': 'Annual',
                    'Effective From': '2026-01-01'
                }
            ];

            const result = lwfParser.parseSheetRows(rows);
            assert.ok(result.errors.some(e => e.includes("Duplicate Employee ID 'EMP0001'")));
        });

        await st.test('Resiliently handles header truncations (e.g., Employee Contributior -> employeeContribution, Employer Contributior -> employerContribution)', () => {
            const truncatedHeaderRow = {
                'Employee ID': 'EMP0009',
                'Organization ID': 'ORG_KYLRX_01',
                'LWF Applicable': 'Yes',
                'State': 'Karnataka',
                'Employer Registration No': 'LWF/KA/BNG/2026/0912',
                'Employee Contributior': 20.00, // Truncated header
                'Employer Contributior': 40.00, // Truncated header
                'Frequency': 'Annual',
                'Effective From': '2026-01-01',
                'Effective To': ''
            };

            const record = lwfParser.parseRecord(truncatedHeaderRow, 2);
            assert.equal(record.employeeId, 'EMP0009');
            assert.equal(record.employeeContribution, 20.00, 'Must map truncated Employee Contributior to employeeContribution');
            assert.equal(record.employerContribution, 40.00, 'Must map truncated Employer Contributior to employerContribution');
        });
    });

    await t.test('3. Dynamic State-Specific Frequency Deduction & Remittance Engine (PRD Sections 4 & 11)', async (st) => {
        await st.test('Karnataka (Annual): Deducted in December pay run (EE: 20, ER: 40); Nil in other months', () => {
            const kaProfile = {
                employeeId: 'EMP0001',
                state: 'Karnataka',
                frequency: 'Annual',
                employeeContribution: 20,
                employerContribution: 40,
                isLwfApplicable: true
            };

            // December pay cycle (Month 12) -> Deduction triggered
            const resDec = lwfService.calculateLwfDeduction(kaProfile, 45000, { cycleMonth: 12, cycleYear: 2026 });
            assert.equal(resDec.isDeductionMonth, true);
            assert.equal(resDec.employeeContribution, 20.00);
            assert.equal(resDec.employerContribution, 40.00);
            assert.equal(resDec.employerLiability, 40.00);
            assert.equal(resDec.companyLiability, 40.00);
            assert.equal(resDec.totalRemittance, 60.00);
            assert.equal(resDec.deduction, 20.00);

            // June pay cycle (Month 6) -> Nil deduction for Annual Karnataka schedule
            const resJun = lwfService.calculateLwfDeduction(kaProfile, 45000, { cycleMonth: 6, cycleYear: 2026 });
            assert.equal(resJun.isDeductionMonth, false);
            assert.equal(resJun.employeeContribution, 0);
            assert.equal(resJun.employerContribution, 0);
            assert.equal(resJun.companyLiability, 0);
            assert.equal(resJun.totalRemittance, 0);
        });

        await st.test('Maharashtra (Half-Yearly): Deducted in June and December pay runs (EE: 12, ER: 36); Nil in other months', () => {
            const mhProfile = {
                employeeId: 'EMP0002',
                state: 'Maharashtra',
                frequency: 'Half-Yearly',
                employeeContribution: 12,
                employerContribution: 36,
                isLwfApplicable: true
            };

            // June pay cycle (Month 6) -> Triggered
            const resJun = lwfService.calculateLwfDeduction(mhProfile, 50000, { cycleMonth: 6, cycleYear: 2026 });
            assert.equal(resJun.isDeductionMonth, true);
            assert.equal(resJun.employeeContribution, 12.00);
            assert.equal(resJun.employerContribution, 36.00);
            assert.equal(resJun.totalRemittance, 48.00);

            // December pay cycle (Month 12) -> Triggered
            const resDec = lwfService.calculateLwfDeduction(mhProfile, 50000, { cycleMonth: 12, cycleYear: 2026 });
            assert.equal(resDec.isDeductionMonth, true);
            assert.equal(resDec.employeeContribution, 12.00);
            assert.equal(resDec.employerContribution, 36.00);
            assert.equal(resDec.totalRemittance, 48.00);

            // October pay cycle (Month 10) -> Non-deduction month
            const resOct = lwfService.calculateLwfDeduction(mhProfile, 50000, { cycleMonth: 10, cycleYear: 2026 });
            assert.equal(resOct.isDeductionMonth, false);
            assert.equal(resOct.employeeContribution, 0);
            assert.equal(resOct.employerContribution, 0);
        });

        await st.test('Delhi (Half-Yearly): Deducted in June and December pay runs (EE: 0.75, ER: 2.25)', () => {
            const dlProfile = {
                employeeId: 'EMP0003',
                state: 'Delhi',
                frequency: 'Half-Yearly',
                employeeContribution: 0.75,
                employerContribution: 2.25,
                isLwfApplicable: true
            };

            const resDec = lwfService.calculateLwfDeduction(dlProfile, 35000, { cycleMonth: 12, cycleYear: 2026 });
            assert.equal(resDec.isDeductionMonth, true);
            assert.equal(resDec.employeeContribution, 0.75);
            assert.equal(resDec.employerContribution, 2.25);
            assert.equal(resDec.totalRemittance, 3.00);
        });

        await st.test('Monthly Jurisdictions (e.g., Haryana): Deducted every monthly pay cycle', () => {
            const hrProfile = {
                employeeId: 'EMP0004',
                state: 'Haryana',
                frequency: 'Monthly',
                employeeContribution: 25.00,
                employerContribution: 50.00,
                isLwfApplicable: true
            };

            for (let month = 1; month <= 12; month++) {
                const res = lwfService.calculateLwfDeduction(hrProfile, 40000, { cycleMonth: month, cycleYear: 2026 });
                assert.equal(res.isDeductionMonth, true, `Month ${month} must trigger deduction for Monthly frequency`);
                assert.equal(res.employeeContribution, 25.00);
                assert.equal(res.employerContribution, 50.00);
                assert.equal(res.totalRemittance, 75.00);
            }
        });

        await st.test('Generates Statutory Remittance Return Row and Formatted File', () => {
            const row = lwfService.generateLwfReturnRow({
                employeeId: 'EMP0001',
                employeeName: 'Rahul Sharma',
                state: 'Karnataka',
                employerRegistrationNo: 'LWF/KA/BNG/2026/0912',
                grossPay: 85000,
                employeeContribution: 20,
                employerContribution: 40
            });

            const expectedRow = 'EMP0001#Rahul Sharma#Karnataka#LWF/KA/BNG/2026/0912#85000.00#20.00#40.00#60.00';
            assert.equal(row, expectedRow, 'Remittance row must match exact 8-column hash-delimited format');

            // Generate full return file
            const fileData = lwfService.generateLwfReturnFile([
                {
                    employeeId: 'EMP0001',
                    employeeName: 'Rahul Sharma',
                    state: 'Karnataka',
                    employerRegistrationNo: 'LWF/KA/BNG/2026/0912',
                    grossPay: 85000,
                    employeeContribution: 20,
                    employerContribution: 40
                },
                {
                    employeeId: 'EMP0002',
                    employeeName: 'Priya Patel',
                    state: 'Maharashtra',
                    employerRegistrationNo: 'LWF/MH/MUM/2026/0881',
                    grossPay: 95000,
                    employeeContribution: 12,
                    employerContribution: 36
                }
            ], '2026-12');

            assert.equal(fileData.totalEmployees, 2);
            assert.equal(fileData.totalEeContribution, 32);
            assert.equal(fileData.totalErContribution, 76);
            assert.equal(fileData.totalRemittance, 108);
            assert.equal(fileData.byState['Karnataka'].totalRemittance, 60);
            assert.equal(fileData.byState['Maharashtra'].totalRemittance, 48);
            assert.ok(fileData.fileContent.includes(expectedRow));

            // Test CSV Return export
            const csvExport = lwfService.exportLwfReturnCsv([
                {
                    employeeId: 'EMP0001',
                    employeeName: 'Rahul Sharma',
                    state: 'Karnataka',
                    employerRegistrationNo: 'LWF/KA/BNG/2026/0912',
                    grossPay: 85000,
                    employeeContribution: 20,
                    employerContribution: 40
                }
            ], '2026-12');
            assert.ok(csvExport.filename.endsWith('.csv'));
            assert.ok(csvExport.content.includes('Employee_ID#Employee_Name#State#LWF_Registration_No#Gross_Pay#EE_Contribution#ER_Contribution#Total_Remittance'));
            assert.ok(csvExport.content.includes(expectedRow));

            // Test Excel Return export
            const xlsxExport = lwfService.exportLwfReturnExcel([
                {
                    employeeId: 'EMP0001',
                    employeeName: 'Rahul Sharma',
                    state: 'Karnataka',
                    employerRegistrationNo: 'LWF/KA/BNG/2026/0912',
                    grossPay: 85000,
                    employeeContribution: 20,
                    employerContribution: 40
                }
            ], '2026-12');
            assert.ok(xlsxExport.filename.endsWith('.xlsx'));
            assert.equal(xlsxExport.dataRows.length, 2);
            assert.deepEqual(xlsxExport.dataRows[0], ['Employee ID', 'Employee Name', 'State', 'LWF Registration No', 'Gross Pay', 'EE Contribution', 'ER Contribution', 'Total Remittance']);
            assert.equal(xlsxExport.dataRows[1][0], 'EMP0001');
            assert.equal(xlsxExport.dataRows[1][7], 60.00);
        });
    });

    await t.test('4. Admin UI & Statutory Overview Drawer (PRD Section 13)', async (st) => {
        await st.test('UI Controller renders Labour Welfare Fund (LWF) status card with State, Frequency, Reg No and Next Deduction', async () => {
            const mockContainer = {
                innerHTML: '',
                querySelector: () => null,
                querySelectorAll: () => []
            };
            const fakeDoc = {
                getElementById: (id) => {
                    if (id === 'lwfTestContainer') return mockContainer;
                    return null;
                }
            };

            const prevDoc = globalThis.document;
            globalThis.document = fakeDoc;

            try {
                await lwfUi.mountLwfCard('lwfTestContainer', 'EMP0001', {
                    state: 'Karnataka',
                    employerRegistrationNo: 'LWF/KA/BNG/2026/0912',
                    frequency: 'Annual',
                    employeeContribution: 20.00,
                    employerContribution: 40.00,
                    isLwfApplicable: true
                });

                assert.ok(mockContainer.innerHTML.includes('Labour Welfare Fund (LWF) Statutory Profile'), 'Must render LWF card header');
                assert.ok(mockContainer.innerHTML.includes('Karnataka'), 'Must render state jurisdiction');
                assert.ok(mockContainer.innerHTML.includes('LWF/KA/BNG/2026/0912'), 'Must render establishment registration number');
                assert.ok(mockContainer.innerHTML.includes('Annual'), 'Must render frequency');
                assert.ok(mockContainer.innerHTML.includes('inputLwfApplicable'), 'Must provide inline toggle for LWF Applicable');
                assert.ok(mockContainer.innerHTML.includes('btnEvaluateLwf'), 'Must provide Evaluate Deduction action');
                assert.ok(mockContainer.innerHTML.includes('btnSaveLwfDetails'), 'Must provide Save LWF Profile action');
            } finally {
                globalThis.document = prevDoc;
            }
        });
    });

    await t.test('5. Data Architecture (Cloud Firestore)', async (st) => {
        await st.test('CRUD operations on organizations/{orgId}/employee_lwf_details/{employeeId}', async () => {
            const orgId = 'ORG_KYLRX_TEST';
            const empId = 'EMP0077';

            const payload = {
                employeeId: empId,
                organizationId: orgId,
                isLwfApplicable: true,
                state: 'Maharashtra',
                employerRegistrationNo: 'LWF/MH/PUN/2026/0999',
                employeeContribution: 12.00,
                employerContribution: 36.00,
                frequency: 'Half-Yearly',
                effectiveFrom: '2026-01-01',
                effectiveTo: null
            };

            const saved = await lwfService.saveEmployeeLwfDetails(orgId, empId, payload);
            assert.equal(saved.employeeId, empId);
            assert.equal(saved.state, 'Maharashtra');
            assert.equal(saved.employeeContribution, 12);
            assert.equal(saved.employerContribution, 36);
            assert.deepEqual(saved.deductionSchedule.deductionMonths, [6, 12]);

            const retrieved = await lwfService.getEmployeeLwfDetails(orgId, empId);
            assert.equal(retrieved.employeeId, empId);
            assert.equal(retrieved.employerRegistrationNo, 'LWF/MH/PUN/2026/0999');
            assert.equal(retrieved.frequency, 'Half-Yearly');

            const allDocs = await lwfService.listAllLwfDetails(orgId);
            assert.ok(allDocs.some(d => d.employeeId === empId));
        });
    });

    await t.test('6. Excel Workbook & Template Integrity (Templates.xlsx)', async (st) => {
        await st.test("Templates.xlsx contains 'LWF Details' sheet matching all 10 canonical columns", () => {
            const workbookPath = path.join(rootDir, 'Templates.xlsx');
            assert.ok(fs.existsSync(workbookPath), 'Templates.xlsx must exist');

            const buffer = fs.readFileSync(workbookPath);
            const wb = xlsx.read(buffer, { type: 'buffer' });

            const hasLwfDetails = wb.SheetNames.includes('LWF Details');
            assert.ok(hasLwfDetails, "'LWF Details' sheet must exist in Templates.xlsx");

            const sheet = wb.Sheets['LWF Details'];
            const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
            assert.ok(rows.length > 0, "'LWF Details' sheet must not be empty");

            const headers = rows[0].map(h => String(h).trim());
            const expected10Cols = [
                'Employee ID',
                'Organization ID',
                'LWF Applicable',
                'State',
                'Employer Registration No',
                'Employee Contribution',
                'Employer Contribution',
                'Frequency',
                'Effective From',
                'Effective To'
            ];

            assert.deepEqual(headers, expected10Cols, "Headers in 'LWF Details' sheet must match all 10 canonical columns");
        });

        await st.test("admin-onboarding-upload.html has LWF console tabs, preview and table container", () => {
            const htmlPath = path.join(rootDir, 'admin-onboarding-upload.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            assert.ok(html.includes('id="tabLwfMaster"'), 'Must have #tabLwfMaster');
            assert.ok(html.includes('id="lwfMasterManagementView"'), 'Must have #lwfMasterManagementView');
            assert.ok(html.includes('id="lwfMasterParseResultsContainer"'), 'Must have #lwfMasterParseResultsContainer');
            assert.ok(html.includes('id="parsedLwfMasterTableBody"'), 'Must have #parsedLwfMasterTableBody');
            assert.ok(html.includes('id="btnConfirmLwfMasterIngest"'), 'Must have #btnConfirmLwfMasterIngest');
            assert.ok(html.includes('id="onboardingLwfMasterTableContainer"'), 'Must have #onboardingLwfMasterTableContainer');
            assert.ok(html.includes('src="lwfDetailsParser.js"'), 'Must import lwfDetailsParser.js');
            assert.ok(html.includes('src="lwfDetailsService.js"'), 'Must import lwfDetailsService.js');
            assert.ok(html.includes('src="lwfProfileUIController.js"'), 'Must import lwfProfileUIController.js');
        });

        await st.test("admin-dashboard.html has LWF statutory drawer container and script imports", () => {
            const htmlPath = path.join(rootDir, 'admin-dashboard.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            assert.ok(html.includes('id="lwfStatutoryDrawerContainer"'), 'Must have #lwfStatutoryDrawerContainer');
            assert.ok(html.includes('src="lwfDetailsParser.js"'), 'Must import lwfDetailsParser.js');
            assert.ok(html.includes('src="lwfDetailsService.js"'), 'Must import lwfDetailsService.js');
            assert.ok(html.includes('src="lwfProfileUIController.js"'), 'Must import lwfProfileUIController.js');
        });

        await st.test("employee-profile-controller.js mounts LWF card via KylrxLwfProfileUIController", () => {
            const controllerPath = path.join(rootDir, 'employee-profile-controller.js');
            const code = fs.readFileSync(controllerPath, 'utf8');

            assert.ok(code.includes('KylrxLwfProfileUIController.mountLwfCard'), 'Must mount LWF card in employee-profile-controller.js');
            assert.ok(code.includes('lwfStatutoryDrawerContainer'), 'Must target lwfStatutoryDrawerContainer');
        });
    });
});
