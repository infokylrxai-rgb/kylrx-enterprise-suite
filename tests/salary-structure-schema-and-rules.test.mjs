/**
 * KYLRX.AI ENTERPRISE HRMS - SALARY STRUCTURE & COMPENSATION TEST SUITE
 * 
 * Verifies Salary Structure configuration, sheet parsing, dynamic compensation
 * calculations, revision timeline versioning, and Cloud Firestore persistence
 * matching PRD Sections 1 & 4 and the 'Salary Stcruture' sheet from Templates.xlsx.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load SalaryStructureParser (UMD module)
const parserPath = path.join(rootDir, 'services', 'salary-structure-parser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const SalaryParser = parserModule.exports;

// Load SalaryStructureService (UMD module)
const servicePath = fs.existsSync(path.join(rootDir, 'services', 'salary-structure-service.js'))
    ? path.join(rootDir, 'services', 'salary-structure-service.js')
    : path.join(rootDir, 'salaryStructureService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const SalaryService = serviceModule.exports;

test('PRD Sections 1 & 4: Salary Structure & Dynamic Compensation Module', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (All 9 Attributes)', async (st) => {
        assert.ok(SalaryParser, 'KylrxSalaryStructureParser must be exported and available');
        const attrs = SalaryParser.SALARY_STRUCTURE_ATTRIBUTES;
        assert.equal(attrs.length, 9, 'Must have exactly 9 attribute keys');

        const expectedKeys = [
            'Employee_ID',
            'Effective_From',
            'Pay_Frequency',
            'Salary_Structure_Code',
            'Component_Code',
            'Amount',
            'Percentage',
            'Calculation_Basis',
            'Active'
        ];

        const actualKeys = attrs.map(a => a.key);
        for (const key of expectedKeys) {
            assert.ok(actualKeys.includes(key), `Attribute key list must include ${key}`);
        }

        // Test normalizer maps row properly
        const sampleRow = {
            'Employee_ID': 'EMP0001',
            'Effective_From': '2026-01-01',
            'Pay_Frequency': 'Monthly',
            'Salary_Structure_Code': 'STRUC_ENG_L2',
            'Component_Code': 'BASIC',
            'Amount': '50000.00',
            'Percentage': '',
            'Calculation_Basis': 'FLAT',
            'Active': 'Yes'
        };

        const res = SalaryParser.validateComponentRow(sampleRow);
        assert.equal(res.valid, true);
        assert.equal(res.record.Employee_ID, 'EMP0001');
        assert.equal(res.record.Effective_From, '2026-01-01');
        assert.equal(res.record.Pay_Frequency, 'Monthly');
        assert.equal(res.record.Salary_Structure_Code, 'STRUC_ENG_L2');
        assert.equal(res.record.Component_Code, 'BASIC');
        assert.equal(res.record.Amount, 50000);
        assert.equal(res.record.Percentage, null);
        assert.equal(res.record.Calculation_Basis, 'FLAT');
        assert.equal(res.record.Active, 'Yes');
    });

    await t.test('2. Foreign Key and Value Validation Rules', async (st) => {
        // Validation check: Missing Employee_ID
        const rowNoEmp = {
            'Employee_ID': '',
            'Effective_From': '2026-01-01',
            'Pay_Frequency': 'Monthly',
            'Salary_Structure_Code': 'STRUC_ENG_L2',
            'Component_Code': 'BASIC',
            'Amount': 50000,
            'Percentage': null,
            'Calculation_Basis': 'FLAT',
            'Active': 'Yes'
        };
        const resNoEmp = SalaryParser.validateComponentRow(rowNoEmp);
        assert.equal(resNoEmp.valid, false);
        assert.ok(resNoEmp.errors.some(e => e.includes('Employee_ID')));

        // Validation check: Unknown Employee_ID foreign key
        const rowBadEmp = { ...rowNoEmp, Employee_ID: 'EMP_NONEXISTENT' };
        const resBadEmp = SalaryParser.validateComponentRow(rowBadEmp, {
            existingEmployeeIds: new Set(['EMP0001', 'EMP0002'])
        });
        assert.equal(resBadEmp.valid, false);
        assert.ok(resBadEmp.errors.some(e => e.includes('does not exist in active employees')));

        // Validation check: Missing Component_Code
        const rowNoComp = {
            ...rowNoEmp,
            Employee_ID: 'EMP0001',
            Component_Code: ''
        };
        const resNoComp = SalaryParser.validateComponentRow(rowNoComp);
        assert.equal(resNoComp.valid, false);
        assert.ok(resNoComp.errors.some(e => e.includes('Component_Code')));

        // Validation check: Unknown Component_Code foreign key
        const rowBadComp = {
            ...rowNoEmp,
            Employee_ID: 'EMP0001',
            Component_Code: 'UNKNOWN_XYZ_COMP'
        };
        const resBadComp = SalaryParser.validateComponentRow(rowBadComp, {
            existingComponentCodes: new Set(['BASIC', 'HRA'])
        });
        assert.equal(resBadComp.valid, false);
        assert.ok(resBadComp.errors.some(e => e.includes('not found in active Payroll Components')));

        // Validation check: FLAT calculation basis requires numeric Amount
        const rowFlatNoAmt = {
            ...rowNoEmp,
            Employee_ID: 'EMP0001',
            Component_Code: 'BASIC',
            Calculation_Basis: 'FLAT',
            Amount: null,
            Percentage: null
        };
        const resFlatNoAmt = SalaryParser.validateComponentRow(rowFlatNoAmt);
        assert.equal(resFlatNoAmt.valid, false);
        assert.ok(resFlatNoAmt.errors.some(e => e.includes('Calculation_Basis is FLAT')));

        // Validation check: Referenced calculation basis (BASIC) requires valid Percentage
        const rowBasisNoPct = {
            ...rowNoEmp,
            Employee_ID: 'EMP0001',
            Component_Code: 'HRA',
            Calculation_Basis: 'BASIC',
            Amount: null,
            Percentage: null
        };
        const resBasisNoPct = SalaryParser.validateComponentRow(rowBasisNoPct);
        assert.equal(resBasisNoPct.valid, false);
        assert.ok(resBasisNoPct.errors.some(e => e.includes('requires a valid numeric Percentage')));

        // Validation check: Invalid Calculation_Basis
        const rowBadBasis = {
            ...rowNoEmp,
            Employee_ID: 'EMP0001',
            Component_Code: 'BASIC',
            Calculation_Basis: 'RANDOM_BASIS',
            Amount: 50000
        };
        const resBadBasis = SalaryParser.validateComponentRow(rowBadBasis);
        assert.equal(resBadBasis.valid, false);
        assert.ok(resBadBasis.errors.some(e => e.includes('Invalid Calculation_Basis')));
    });

    await t.test('3. Dynamic Calculation Engine & Payroll Linkage (PRD §4)', async (st) => {
        // Multi-row itemized structure for EMP0001 matching prompt specification
        const rows = [
            {
                Employee_ID: 'EMP0001',
                Effective_From: '2026-01-01',
                Pay_Frequency: 'Monthly',
                Salary_Structure_Code: 'STRUC_ENG_L2',
                Component_Code: 'BASIC',
                Amount: 50000.00,
                Percentage: null,
                Calculation_Basis: 'FLAT',
                Active: 'Yes'
            },
            {
                Employee_ID: 'EMP0001',
                Effective_From: '2026-01-01',
                Pay_Frequency: 'Monthly',
                Salary_Structure_Code: 'STRUC_ENG_L2',
                Component_Code: 'HRA',
                Amount: null,
                Percentage: 50.0,
                Calculation_Basis: 'BASIC',
                Active: 'Yes'
            },
            {
                Employee_ID: 'EMP0001',
                Effective_From: '2026-01-01',
                Pay_Frequency: 'Monthly',
                Salary_Structure_Code: 'STRUC_ENG_L2',
                Component_Code: 'SPECIAL_ALLOW',
                Amount: 25000.00,
                Percentage: null,
                Calculation_Basis: 'FLAT',
                Active: 'Yes'
            }
        ];

        const parseResult = SalaryParser.parseSheetRows(rows);
        assert.equal(parseResult.errors.length, 0, 'Should parse without errors');
        assert.equal(parseResult.firestoreDocs.length, 1, 'Should group rows into 1 Firestore document revision');

        const doc = parseResult.firestoreDocs[0];
        assert.equal(doc.employeeId, 'EMP0001');
        assert.equal(doc.salaryStructureCode, 'STRUC_ENG_L2');
        assert.equal(doc.effectiveFrom, '2026-01-01');
        assert.equal(doc.payFrequency, 'Monthly');
        assert.equal(doc.isActive, true);
        assert.equal(doc.components.length, 3);

        // Verify Formula evaluation
        // BASIC: 50,000 (FLAT)
        // HRA: (50 / 100) * 50,000 = 25,000 (referenced to BASIC)
        // SPECIAL_ALLOW: 25,000 (FLAT)
        // Gross Monthly = 50,000 + 25,000 + 25,000 = 100,000.00
        // Annual CTC = 100,000 * 12 = 1,200,000.00
        assert.equal(doc.grossMonthly, 100000.00, 'Gross monthly must equal 100,000.00');
        assert.equal(doc.annualCTC, 1200000.00, 'Annual CTC must equal 1,200,000.00');

        // Test component breakdown function directly
        const breakdown = SalaryService.computeCtcBreakdown(doc.components, 'Monthly');
        assert.equal(breakdown.grossMonthly, 100000.00);
        assert.equal(breakdown.annualCTC, 1200000.00);

        // Test Bi-weekly frequency computation
        const biweeklyBreakdown = SalaryService.computeCtcBreakdown(doc.components, 'Bi-weekly');
        assert.equal(biweeklyBreakdown.grossMonthly, 100000.00);
        assert.equal(biweeklyBreakdown.annualCTC, 2600000.00); // 100k * 26
    });

    await t.test('4. Data Architecture & Cloud Firestore Revision Management', async (st) => {
        assert.ok(SalaryService, 'KylrxSalaryStructureService must be available');

        const orgId = 'org_test_comp';
        const empId = 'EMP0001';

        // Rev 1: Effective 2026-01-01
        const rev1 = {
            employeeId: empId,
            salaryStructureCode: 'STRUC_ENG_L1',
            effectiveFrom: '2026-01-01',
            payFrequency: 'Monthly',
            isActive: true,
            components: [
                { componentCode: 'BASIC', amount: 40000, percentage: null, calculationBasis: 'FLAT' },
                { componentCode: 'HRA', amount: null, percentage: 50, calculationBasis: 'BASIC' },
                { componentCode: 'SPECIAL_ALLOW', amount: 20000, percentage: null, calculationBasis: 'FLAT' }
            ],
            grossMonthly: 80000,
            annualCTC: 960000
        };

        const savedRev1 = await SalaryService.saveSalaryStructure(orgId, empId, rev1);
        assert.equal(savedRev1.id, `${empId}_v_2026-01-01`);
        assert.equal(savedRev1.grossMonthly, 80000);

        // Fetch latest active structure
        const latest1 = await SalaryService.getSalaryStructure(orgId, empId);
        assert.ok(latest1, 'Must find saved salary structure');
        assert.equal(latest1.salaryStructureCode, 'STRUC_ENG_L1');
        assert.equal(latest1.grossMonthly, 80000);

        // Rev 2: Promotion / Revision effective 2026-07-01
        const rev2 = {
            employeeId: empId,
            salaryStructureCode: 'STRUC_ENG_L2',
            effectiveFrom: '2026-07-01',
            payFrequency: 'Monthly',
            isActive: true,
            components: [
                { componentCode: 'BASIC', amount: 50000, percentage: null, calculationBasis: 'FLAT' },
                { componentCode: 'HRA', amount: null, percentage: 50, calculationBasis: 'BASIC' },
                { componentCode: 'SPECIAL_ALLOW', amount: 25000, percentage: null, calculationBasis: 'FLAT' }
            ],
            grossMonthly: 100000,
            annualCTC: 1200000
        };

        const savedRev2 = await SalaryService.saveSalaryStructure(orgId, empId, rev2);
        assert.equal(savedRev2.id, `${empId}_v_2026-07-01`);

        // Check timeline returns both revisions preserved chronologically
        const timeline = await SalaryService.getRevisionTimeline(orgId, empId);
        assert.equal(timeline.length, 2, 'Timeline must preserve historical revisions');
        assert.equal(timeline[0].effectiveFrom, '2026-07-01', 'Most recent revision first');
        assert.equal(timeline[1].effectiveFrom, '2026-01-01', 'Historical revision second');

        // Clean up
        await SalaryService.deleteSalaryStructure(orgId, `${empId}_v_2026-01-01`);
        await SalaryService.deleteSalaryStructure(orgId, `${empId}_v_2026-07-01`);
    });

    await t.test('5. Live Templates.xlsx Ingestion Integration', async (st) => {
        const templatesPath = path.join(rootDir, 'Templates.xlsx');
        assert.ok(fs.existsSync(templatesPath), 'Templates.xlsx must exist in root directory');

        const fileData = fs.readFileSync(templatesPath);
        const workbook = xlsx.read(fileData, { type: 'buffer' });

        // PRD Section 1: Check for exact sheet name 'Salary Stcruture' (including exact typo)
        const sheetName = SalaryParser.resolveSalaryStructureSheetName(workbook.SheetNames);
        assert.ok(sheetName, `Templates.xlsx must contain 'Salary Stcruture' sheet (found: ${workbook.SheetNames.join(', ')})`);
        assert.equal(sheetName, 'Salary Stcruture', 'Must identify exact sheet name Salary Stcruture');

        // Parse official workbook
        const parseResult = SalaryParser.parseSalaryStructureWorkbook(workbook, xlsx);
        assert.equal(parseResult.errors.length, 0, `Templates.xlsx parsing should have 0 errors, got: ${parseResult.errors.join('; ')}`);
        assert.equal(parseResult.records.length, 9, 'Should parse all 9 itemized component rows');
        assert.equal(parseResult.firestoreDocs.length, 3, 'Should group into 3 employee salary structure documents');

        // Verify EMP0001
        const emp1Doc = parseResult.firestoreDocs.find(d => d.employeeId === 'EMP0001');
        assert.ok(emp1Doc, 'Must include EMP0001');
        assert.equal(emp1Doc.salaryStructureCode, 'STRUC_ENG_L2');
        assert.equal(emp1Doc.grossMonthly, 100000.00);
        assert.equal(emp1Doc.annualCTC, 1200000.00);

        // Verify EMP0002
        const emp2Doc = parseResult.firestoreDocs.find(d => d.employeeId === 'EMP0002');
        assert.ok(emp2Doc, 'Must include EMP0002');
        assert.equal(emp2Doc.salaryStructureCode, 'STRUC_ENG_L1');
        assert.equal(emp2Doc.grossMonthly, 75000.00);
        assert.equal(emp2Doc.annualCTC, 900000.00);

        // Verify EMP0003
        const emp3Doc = parseResult.firestoreDocs.find(d => d.employeeId === 'EMP0003');
        assert.ok(emp3Doc, 'Must include EMP0003');
        assert.equal(emp3Doc.salaryStructureCode, 'STRUC_OPERATIONS');
        assert.equal(emp3Doc.grossMonthly, 60000.00);
        assert.equal(emp3Doc.annualCTC, 720000.00);
    });

    await t.test('6. Frontend UI and Modal Integration Integrity', async (st) => {
        // admin-dashboard.html check
        const adminDashboardPath = path.join(rootDir, 'admin-dashboard.html');
        const adminDashboardHtml = fs.readFileSync(adminDashboardPath, 'utf8');

        assert.ok(adminDashboardHtml.includes('id="emp-tab-btn-salary"'), 'admin-dashboard.html must have #emp-tab-btn-salary');
        assert.ok(adminDashboardHtml.includes('id="emp-tab-content-salary"'), 'admin-dashboard.html must have #emp-tab-content-salary');
        assert.ok(adminDashboardHtml.includes('id="empSalaryStructureTitle"'), 'Must have empSalaryStructureTitle');
        assert.ok(adminDashboardHtml.includes('id="empSalaryGrossMonthlyDisplay"'), 'Must have empSalaryGrossMonthlyDisplay');
        assert.ok(adminDashboardHtml.includes('id="empSalaryAnnualCtcDisplay"'), 'Must have empSalaryAnnualCtcDisplay');
        assert.ok(adminDashboardHtml.includes('id="empSalaryRevisionSelect"'), 'Must have empSalaryRevisionSelect dropdown');
        assert.ok(adminDashboardHtml.includes('id="empSalaryComponentsTableBody"'), 'Must have empSalaryComponentsTableBody');
        assert.ok(adminDashboardHtml.includes('salaryStructureParser.js') || adminDashboardHtml.includes('salary-structure-parser.js'), 'Must import salaryStructureParser.js');
        assert.ok(adminDashboardHtml.includes('salaryStructureService.js') || adminDashboardHtml.includes('salary-structure-service.js'), 'Must import salaryStructureService.js');

        // employee-profile-controller.js check
        const controllerPath = path.join(rootDir, 'employee-profile-controller.js');
        const controllerCode = fs.readFileSync(controllerPath, 'utf8');

        assert.ok(controllerCode.includes("'salary'"), 'Controller switchTab must support salary tab');
        assert.ok(controllerCode.includes('populateSalaryStructureView'), 'Controller must implement populateSalaryStructureView');
        assert.ok(controllerCode.includes('renderSalaryStructureDetails'), 'Controller must implement renderSalaryStructureDetails');

        // admin-onboarding-upload.html check
        const onboardingHtmlPath = path.join(rootDir, 'admin-onboarding-upload.html');
        const onboardingHtml = fs.readFileSync(onboardingHtmlPath, 'utf8');

        assert.ok(onboardingHtml.includes('id="tabSalaryStructure"'), 'Must have tabSalaryStructure');
        assert.ok(onboardingHtml.includes('id="salaryStructureManagementView"'), 'Must have salaryStructureManagementView');
        assert.ok(onboardingHtml.includes('id="salaryStructureParseResultsContainer"'), 'Must have salaryStructureParseResultsContainer');
        assert.ok(onboardingHtml.includes('id="parsedSalaryStructureTableBody"'), 'Must have parsedSalaryStructureTableBody');
        assert.ok(onboardingHtml.includes('id="btnConfirmSalaryStructureIngest"'), 'Must have btnConfirmSalaryStructureIngest');
        assert.ok(onboardingHtml.includes('salaryStructureParser.js') || onboardingHtml.includes('salary-structure-parser.js'), 'Must import salary structure parser');
        assert.ok(onboardingHtml.includes('salaryStructureService.js') || onboardingHtml.includes('salary-structure-service.js'), 'Must import salaryStructureService.js');

        // admin-onboarding-upload.js check
        const onboardingJsPath = path.join(rootDir, 'admin-onboarding-upload.js');
        const onboardingJs = fs.readFileSync(onboardingJsPath, 'utf8');

        assert.ok(onboardingJs.includes('extract9SalaryStructureAttributesFromSheetRows'), 'Must implement extract9SalaryStructureAttributesFromSheetRows');
        assert.ok(onboardingJs.includes('renderParsedSalaryStructurePreview'), 'Must implement renderParsedSalaryStructurePreview');
        assert.ok(onboardingJs.includes('executeSalaryStructureIngest'), 'Must implement executeSalaryStructureIngest');
    });
});
