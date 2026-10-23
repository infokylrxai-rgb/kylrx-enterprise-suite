import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load EmployeeTypeParser (UMD module)
const parserPath = path.join(rootDir, 'services', 'employee-type-parser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const empTypeParser = parserModule.exports;

// Load EmployeeTypeService (UMD module)
const servicePath = fs.existsSync(path.join(rootDir, 'services', 'employee-type-service.js'))
    ? path.join(rootDir, 'services', 'employee-type-service.js')
    : path.join(rootDir, 'employeeTypeService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const empTypeService = serviceModule.exports;

// Load BusinessUnitRules (UMD module)
const buRulesPath = path.join(rootDir, 'bu-employee-type-rules.js');
const buRulesContent = fs.readFileSync(buRulesPath, 'utf8');
const buRulesModule = { exports: {} };
const buRulesFn = new Function('module', 'exports', 'require', buRulesContent);
buRulesFn(buRulesModule, buRulesModule.exports, () => ({}));
const buRules = buRulesModule.exports;

// Load backend BuEmployeeTypeRulesService
import buRulesService from '../services/bu-employee-type-rules-service.js';

test('1. Exact Schema & Field Mapping (Strict 7 Attributes)', async (t) => {
    await t.test('Parse raw rows with exact 7 attributes: Category_Code, Category_Name, Employment_Type, Worker_Type, Probation_Days, Notice_Period_Days, Active', () => {
        const sampleRows = [
            {
                'Category_Code': 'CAT_FT_REG',
                'Category_Name': 'Full-Time Regular',
                'Employment_Type': 'Permanent',
                'Worker_Type': 'White Collar',
                'Probation_Days': 180,
                'Notice_Period_Days': 60,
                'Active': 'Yes'
            },
            {
                'Category_Code': 'CAT_INT_GRAD',
                'Category_Name': 'Graduate Intern / Apprentice',
                'Employment_Type': 'Intern',
                'Worker_Type': 'On-Roll',
                'Probation_Days': 0,
                'Notice_Period_Days': 15,
                'Active': 'No'
            }
        ];

        const result = empTypeParser.parseEmployeeTypeSheet(sampleRows);

        assert.equal(result.valid, true);
        assert.equal(result.totalRows, 2);
        assert.equal(result.validCount, 2);
        assert.equal(result.records.length, 2);
        assert.equal(result.firestoreDocs.length, 2);
        assert.equal(result.errors.length, 0);

        // Strict 7 attributes check on record
        const first = result.records[0];
        assert.equal(first.Category_Code, 'CAT_FT_REG');
        assert.equal(first.Category_Name, 'Full-Time Regular');
        assert.equal(first.Employment_Type, 'Permanent');
        assert.equal(first.Worker_Type, 'White Collar');
        assert.equal(first.Probation_Days, 180);
        assert.equal(first.Notice_Period_Days, 60);
        assert.equal(first.Active, 'Yes');

        // Firestore document schema check
        const firstDoc = result.firestoreDocs[0];
        assert.equal(firstDoc.categoryCode, 'CAT_FT_REG');
        assert.equal(firstDoc.categoryName, 'Full-Time Regular');
        assert.equal(firstDoc.employmentType, 'Permanent');
        assert.equal(firstDoc.workerType, 'White Collar');
        assert.equal(firstDoc.probationDays, 180);
        assert.equal(firstDoc.noticePeriodDays, 60);
        assert.equal(firstDoc.isActive, true);

        // Inactive parsing check
        const second = result.records[1];
        assert.equal(second.Category_Code, 'CAT_INT_GRAD');
        assert.equal(second.Active, 'No');
        assert.equal(result.firestoreDocs[1].isActive, false);
        assert.equal(result.firestoreDocs[1].probationDays, 0);
        assert.equal(result.firestoreDocs[1].noticePeriodDays, 15);
    });

    await t.test('Validation rejects rows with missing Category_Code or Category_Name', () => {
        const invalidRows = [
            {
                'Category_Code': '',
                'Category_Name': 'Missing Code',
                'Employment_Type': 'Permanent',
                'Worker_Type': 'White Collar',
                'Probation_Days': 180,
                'Notice_Period_Days': 60,
                'Active': 'Yes'
            },
            {
                'Category_Code': 'CAT_NO_NAME',
                'Category_Name': '   ',
                'Employment_Type': 'Contract',
                'Worker_Type': 'Off-Roll',
                'Probation_Days': 30,
                'Notice_Period_Days': 30,
                'Active': 'Yes'
            }
        ];

        const result = empTypeParser.parseEmployeeTypeSheet(invalidRows);
        assert.equal(result.valid, false);
        assert.equal(result.errorCount, 2);
        assert.ok(result.errors.some(e => e.includes("Missing mandatory 'Category_Code'")));
        assert.ok(result.errors.some(e => e.includes("Missing mandatory 'Category_Name'")));
    });

    await t.test('Validation rejects duplicate Category_Code in the same ingestion set', () => {
        const duplicateRows = [
            {
                'Category_Code': 'CAT_DUP_01',
                'Category_Name': 'First Instance',
                'Employment_Type': 'Permanent',
                'Worker_Type': 'White Collar',
                'Probation_Days': 180,
                'Notice_Period_Days': 60,
                'Active': 'Yes'
            },
            {
                'Category_Code': 'CAT_DUP_01',
                'Category_Name': 'Second Instance Duplicate',
                'Employment_Type': 'Contract',
                'Worker_Type': 'Off-Roll',
                'Probation_Days': 30,
                'Notice_Period_Days': 30,
                'Active': 'Yes'
            }
        ];

        const result = empTypeParser.parseEmployeeTypeSheet(duplicateRows);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('Duplicate Category Code "CAT_DUP_01"')));
    });

    await t.test('Active boolean sanitization maps Yes/No, Y/N, TRUE/FALSE, 1/0 into standard booleans', () => {
        const booleanTestRows = [
            { 'Category_Code': 'CAT_B1', 'Category_Name': 'B1', 'Active': 'Yes' },
            { 'Category_Code': 'CAT_B2', 'Category_Name': 'B2', 'Active': 'No' },
            { 'Category_Code': 'CAT_B3', 'Category_Name': 'B3', 'Active': 'TRUE' },
            { 'Category_Code': 'CAT_B4', 'Category_Name': 'B4', 'Active': 'false' },
            { 'Category_Code': 'CAT_B5', 'Category_Name': 'B5', 'Active': 1 },
            { 'Category_Code': 'CAT_B6', 'Category_Name': 'B6', 'Active': 0 }
        ];

        const result = empTypeParser.parseEmployeeTypeSheet(booleanTestRows);
        assert.equal(result.firestoreDocs[0].isActive, true);
        assert.equal(result.firestoreDocs[1].isActive, false);
        assert.equal(result.firestoreDocs[2].isActive, true);
        assert.equal(result.firestoreDocs[3].isActive, false);
        assert.equal(result.firestoreDocs[4].isActive, true);
        assert.equal(result.firestoreDocs[5].isActive, false);
    });

    await t.test('Numeric sanitization parses numbers, strings, and falls back to standard thresholds', () => {
        const numericRows = [
            { 'Category_Code': 'CAT_N1', 'Category_Name': 'N1', 'Probation_Days': '90 days', 'Notice_Period_Days': '45 d' },
            { 'Category_Code': 'CAT_N2', 'Category_Name': 'N2', 'Employment_Type': 'Permanent', 'Probation_Days': '', 'Notice_Period_Days': '' }
        ];

        const result = empTypeParser.parseEmployeeTypeSheet(numericRows);
        assert.equal(result.firestoreDocs[0].probationDays, 90);
        assert.equal(result.firestoreDocs[0].noticePeriodDays, 45);
        // Fallbacks for Permanent
        assert.equal(result.firestoreDocs[1].probationDays, 180);
        assert.equal(result.firestoreDocs[1].noticePeriodDays, 60);
    });
});

test('2. Setup & Ingestion Support (PRD Section 1 - SheetJS & Templates.xlsx)', async (t) => {
    await t.test('Parse live Templates.xlsx file Employee Type sheet via SheetJS', () => {
        const templatesPath = path.join(rootDir, 'Templates.xlsx');
        assert.ok(fs.existsSync(templatesPath), 'Templates.xlsx must exist');

        const buffer = fs.readFileSync(templatesPath);
        const xlsxLib = xlsx.default || xlsx;
        const workbook = xlsxLib.read(buffer, { type: 'buffer' });
        const parsed = empTypeParser.parseEmployeeTypeWorkbook(workbook, xlsxLib);

        assert.equal(parsed.valid, true);
        assert.equal(parsed.sheetName, 'Employee Type');
        assert.equal(parsed.records.length, 6);
        assert.equal(parsed.errors.length, 0);

        // Verify the 6 standard categories
        const codes = parsed.records.map(r => r.Category_Code);
        assert.deepEqual(codes, [
            'CAT_FT_REG',
            'CAT_FT_EXEC',
            'CAT_CON_TVC',
            'CAT_INT_GRAD',
            'CAT_TEMP_OPS',
            'CAT_PLANT_WKR'
        ]);

        // Specific category verification
        const ft = parsed.records.find(r => r.Category_Code === 'CAT_FT_REG');
        assert.equal(ft.Category_Name, 'Full-Time Regular');
        assert.equal(ft.Employment_Type, 'Permanent');
        assert.equal(ft.Worker_Type, 'White Collar');
        assert.equal(ft.Probation_Days, 180);
        assert.equal(ft.Notice_Period_Days, 60);
        assert.equal(ft.Active, 'Yes');

        const intern = parsed.records.find(r => r.Category_Code === 'CAT_INT_GRAD');
        assert.equal(intern.Category_Name, 'Graduate Intern / Apprentice');
        assert.equal(intern.Employment_Type, 'Intern');
        assert.equal(intern.Probation_Days, 0);
        assert.equal(intern.Notice_Period_Days, 15);
    });

    await t.test('Parse CSV string format for Employee Type uploads', () => {
        const csvContent = `Category_Code,Category_Name,Employment_Type,Worker_Type,Probation_Days,Notice_Period_Days,Active
CAT_CSV_01,Full-Time Core,Permanent,White Collar,180,60,Yes
CAT_CSV_02,Contract Specialist,Contract,Off-Roll,30,30,Yes
CAT_CSV_03,Temporary Seasonal,Temporary,Blue Collar,15,15,No`;

        const parsed = empTypeParser.parseEmployeeTypeCsv(csvContent);

        assert.equal(parsed.valid, true);
        assert.equal(parsed.records.length, 3);
        assert.equal(parsed.firestoreDocs.length, 3);
        assert.equal(parsed.firestoreDocs[0].categoryCode, 'CAT_CSV_01');
        assert.equal(parsed.firestoreDocs[1].categoryCode, 'CAT_CSV_02');
        assert.equal(parsed.firestoreDocs[2].isActive, false);
    });
});

test('3. Dynamic Tenure & Date Auto-Calculation (PRD Section 13)', async (t) => {
    await t.test('Fetches mapped Probation_Days and Notice_Period_Days for employee categories', () => {
        const ft = empTypeService.getEmployeeTypeDetails('CAT_FT_REG');
        assert.equal(ft.found, true);
        assert.equal(ft.probationDays, 180);
        assert.equal(ft.noticePeriodDays, 60);

        const exec = empTypeService.getEmployeeTypeDetails('CAT_FT_EXEC');
        assert.equal(exec.probationDays, 90);
        assert.equal(exec.noticePeriodDays, 90);

        const intern = empTypeService.getEmployeeTypeDetails('CAT_INT_GRAD');
        assert.equal(intern.probationDays, 0);
        assert.equal(intern.noticePeriodDays, 15);

        const contractor = empTypeService.getEmployeeTypeDetails('CAT_CON_TVC');
        assert.equal(contractor.probationDays, 30);
        assert.equal(contractor.noticePeriodDays, 30);
    });

    await t.test('Calculates probationEndDate: new Date(joiningDate.getTime() + (probationDays * 24 * 60 * 60 * 1000))', () => {
        // Standard Permanent: 180 days from 2026-04-01
        const res180 = empTypeService.calculateProbationEndDate('2026-04-01', 180);
        assert.equal(res180.valid, true);
        assert.equal(res180.days, 180);
        assert.equal(res180.formattedDate, '2026-09-28');

        // Executive: 90 days from 2026-04-01
        const res90 = empTypeService.calculateProbationEndDate('2026-04-01', 90);
        assert.equal(res90.valid, true);
        assert.equal(res90.days, 90);
        assert.equal(res90.formattedDate, '2026-06-30');

        // Contractor: 30 days from 2026-04-01
        const res30 = empTypeService.calculateProbationEndDate('2026-04-01', 30);
        assert.equal(res30.valid, true);
        assert.equal(res30.days, 30);
        assert.equal(res30.formattedDate, '2026-05-01');

        // Intern: 0 days from 2026-04-01 -> Same as joining date
        const res0 = empTypeService.calculateProbationEndDate('2026-04-01', 0);
        assert.equal(res0.valid, true);
        assert.equal(res0.days, 0);
        assert.equal(res0.formattedDate, '2026-04-01');

        // Accepts Date object directly
        const dateObj = new Date(2026, 3, 1); // 2026-04-01
        const resDate = empTypeService.calculateProbationEndDate(dateObj, 15);
        assert.equal(resDate.valid, true);
        assert.equal(resDate.formattedDate, '2026-04-16');
    });

    await t.test('Handles invalid or missing joining date gracefully', () => {
        const noDate = empTypeService.calculateProbationEndDate(null, 180);
        assert.equal(noDate.valid, false);
        assert.equal(noDate.date, null);
        assert.ok(noDate.error.includes('required'));

        const badDate = empTypeService.calculateProbationEndDate('not-a-date', 180);
        assert.equal(badDate.valid, false);
        assert.ok(badDate.error.includes('Invalid'));
    });
});

test('4. Business Unit Rule Integration (PRD Section 10)', async (t) => {
    const testBus = [
        { businessUnitCode: 'BU_ENG', businessUnitName: 'Core Engineering', allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACT', 'CONTRACTOR'], isActive: true },
        { businessUnitCode: 'BU-OPS', businessUnitName: 'Global Operations', allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONTRACTOR'], isActive: true },
        { businessUnitCode: 'BU-EXEC', businessUnitName: 'Executive Strategy', allowedEmployeeTypes: ['EXECUTIVE', 'FULL_TIME'], isActive: true },
        { businessUnitCode: 'BU-DEACT', businessUnitName: 'Deactivated Unit', allowedEmployeeTypes: ['FULL_TIME'], isActive: false }
    ];

    await t.test('Filters Business Units allowed for selected Employee Category', () => {
        // CAT_INT_GRAD (Intern) should ONLY be allowed in BU_ENG
        const internAllowed = empTypeService.filterBusinessUnitsForEmployeeType('CAT_INT_GRAD', testBus);
        assert.equal(internAllowed.length, 1);
        assert.equal(internAllowed[0].businessUnitCode, 'BU_ENG');

        // CAT_FT_REG (Full-Time Regular) allowed in BU_ENG, BU-OPS, BU-EXEC (active only)
        const ftAllowed = empTypeService.filterBusinessUnitsForEmployeeType('CAT_FT_REG', testBus);
        assert.equal(ftAllowed.length, 3);
        const ftCodes = ftAllowed.map(b => b.businessUnitCode);
        assert.ok(ftCodes.includes('BU_ENG'));
        assert.ok(ftCodes.includes('BU-OPS'));
        assert.ok(ftCodes.includes('BU-EXEC'));
        assert.ok(!ftCodes.includes('BU-DEACT'), 'Deactivated unit must be excluded');

        // CAT_CON_TVC (Contractor) allowed in BU_ENG, BU-OPS. NOT in BU-EXEC
        const conAllowed = empTypeService.filterBusinessUnitsForEmployeeType('CAT_CON_TVC', testBus);
        const conCodes = conAllowed.map(b => b.businessUnitCode);
        assert.ok(conCodes.includes('BU_ENG'));
        assert.ok(conCodes.includes('BU-OPS'));
        assert.ok(!conCodes.includes('BU-EXEC'));
    });

    await t.test('Validates and flags invalid Business Unit selections', () => {
        // Valid combination
        const validRes = empTypeService.validateBuForEmployeeType('CAT_FT_REG', 'BU_ENG', testBus);
        assert.equal(validRes.valid, true);
        assert.equal(validRes.error, null);

        // Invalid combination: Intern in BU-OPS
        const invalidRes = empTypeService.validateBuForEmployeeType('CAT_INT_GRAD', 'BU-OPS', testBus);
        assert.equal(invalidRes.valid, false);
        assert.ok(invalidRes.error.includes("does not permit Employee Type 'Graduate Intern / Apprentice'"));
    });

    await t.test('Interoperability: buRules and backend buRulesService align with Category Codes', () => {
        // buRules client-side engine
        const buAllowedIntern = buRules.getAllowedBusinessUnits('CAT_INT_GRAD');
        const buAllowedInternCodes = buAllowedIntern.map(b => b.businessUnitCode);
        assert.ok(buAllowedInternCodes.includes('BU_ENG'));
        assert.ok(!buAllowedInternCodes.includes('BU-OPS'));

        // buRulesService backend engine
        const backendAllowed = buRulesService.getAllowedBusinessUnits('CAT_FT_REG');
        assert.ok(backendAllowed.length >= 5);

        const checkInvalid = buRulesService.isCombinationValid('BU-OPS', 'CAT_INT_GRAD');
        assert.equal(checkInvalid.valid, false);
    });
});

test('5. Data Architecture (Cloud Firestore Path & Document Schema)', async (t) => {
    await t.test('Cloud Firestore path strictly matches organizations/{orgId}/employee_types/{categoryCode}', () => {
        const path1 = empTypeService.getFirestorePath('org_test_01', 'CAT_FT_REG');
        assert.equal(path1, 'organizations/org_test_01/employee_types/CAT_FT_REG');

        const path2 = empTypeService.getFirestorePath('org_kylrx', 'cat_con_tvc');
        assert.equal(path2, 'organizations/org_kylrx/employee_types/CAT_CON_TVC');
    });

    await t.test('Document Schema strictly contains all required fields', async () => {
        const testPayload = {
            categoryCode: 'CAT_TEST_CUSTOM',
            categoryName: 'Custom Specialist',
            employmentType: 'Contract',
            workerType: 'White Collar',
            probationDays: 45,
            noticePeriodDays: 30,
            isActive: true
        };

        const result = await empTypeService.createEmployeeType('org_test_01', testPayload);
        assert.equal(result.success, true);
        assert.equal(result.categoryCode, 'CAT_TEST_CUSTOM');

        const doc = result.data;
        assert.equal(doc.categoryCode, 'CAT_TEST_CUSTOM');
        assert.equal(doc.categoryName, 'Custom Specialist');
        assert.equal(doc.employmentType, 'Contract');
        assert.equal(doc.workerType, 'White Collar');
        assert.equal(doc.probationDays, 45);
        assert.equal(doc.noticePeriodDays, 30);
        assert.equal(doc.isActive, true);
        assert.ok(doc.createdAt);
        assert.ok(doc.updatedAt);
    });

    await t.test('CRUD Service operations: Read, Update, Toggle Active Status, Delete', async () => {
        // Read
        const fetched = await empTypeService.getEmployeeTypeByCode('org_test_01', 'CAT_TEST_CUSTOM');
        assert.ok(fetched);
        assert.equal(fetched.categoryName, 'Custom Specialist');

        // Update
        const updated = await empTypeService.updateEmployeeType('org_test_01', 'CAT_TEST_CUSTOM', {
            categoryName: 'Updated Specialist',
            probationDays: 60
        });
        assert.equal(updated.success, true);
        const refetched = await empTypeService.getEmployeeTypeByCode('org_test_01', 'CAT_TEST_CUSTOM');
        assert.equal(refetched.categoryName, 'Updated Specialist');
        assert.equal(refetched.probationDays, 60);

        // Toggle Status
        await empTypeService.toggleEmployeeTypeStatus('org_test_01', 'CAT_TEST_CUSTOM', false);
        const deactivated = await empTypeService.getEmployeeTypeByCode('org_test_01', 'CAT_TEST_CUSTOM');
        assert.equal(deactivated.isActive, false);

        // Active only filter
        const activeList = await empTypeService.getAllEmployeeTypes('org_test_01', true);
        assert.ok(!activeList.some(t => t.categoryCode === 'CAT_TEST_CUSTOM'));

        // Delete
        const deleted = await empTypeService.deleteEmployeeType('org_test_01', 'CAT_TEST_CUSTOM');
        assert.equal(deleted.success, true);
        const afterDelete = await empTypeService.getEmployeeTypeByCode('org_test_01', 'CAT_TEST_CUSTOM');
        assert.equal(afterDelete, null);
    });
});
