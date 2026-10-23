import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load BusinessUnitParser (UMD module)
const parserPath = path.join(rootDir, 'services', 'business-unit-parser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const buParser = parserModule.exports;

// Load BusinessUnitController (UMD module)
const controllerPath = path.join(rootDir, 'services', 'business-unit-controller.js');
const controllerContent = fs.readFileSync(controllerPath, 'utf8');
const controllerModule = { exports: {} };
const controllerFn = new Function('module', 'exports', 'require', controllerContent);
controllerFn(controllerModule, controllerModule.exports, () => ({}));
const buController = controllerModule.exports;

// Load backend BuEmployeeTypeRulesService
import buRulesService from '../services/bu-employee-type-rules-service.js';

test('1. Exact Schema & Field Mapping (Strict 4 Attributes)', async (t) => {
    await t.test('Parse raw rows with exact 4 attributes: Business_Unit_Code, Business_Unit_Name, Head_Employee_ID, Active', () => {
        const sampleRows = [
            {
                'Business_Unit_Code': 'BU_CORP_01',
                'Business_Unit_Name': 'Corporate Operations',
                'Head_Employee_ID': 'EMP0003',
                'Active': 'Yes'
            },
            {
                'Business_Unit_Code': 'BU_ENG_01',
                'Business_Unit_Name': 'Engineering & Product',
                'Head_Employee_ID': 'EMP0001',
                'Active': 'No'
            }
        ];

        const personnel = [
            { id: 'EMP0003', name: 'Ananya Roy', active: true },
            { id: 'EMP0001', name: 'Devendra Sharma', active: true }
        ];

        const result = buParser.parseBusinessUnitSheet(sampleRows, personnel);

        assert.equal(result.valid, true);
        assert.equal(result.stats.totalRows, 2);
        assert.equal(result.data.length, 2);
        assert.equal(result.firestoreDocs.length, 2);
        assert.equal(result.errors.length, 0);

        // Strict 4 attributes check on data
        const first = result.data[0];
        assert.equal(first.Business_Unit_Code, 'BU_CORP_01');
        assert.equal(first.Business_Unit_Name, 'Corporate Operations');
        assert.equal(first.Head_Employee_ID, 'EMP0003');
        assert.equal(first.Active, 'Yes');

        // Firestore document schema check
        const firstDoc = result.firestoreDocs[0];
        assert.equal(firstDoc.businessUnitCode, 'BU_CORP_01');
        assert.equal(firstDoc.businessUnitName, 'Corporate Operations');
        assert.equal(firstDoc.headEmployeeId, 'EMP0003');
        assert.equal(firstDoc.headEmployeeName, 'Ananya Roy');
        assert.equal(firstDoc.isActive, true);

        // Inactive parsing check
        const second = result.data[1];
        assert.equal(second.Business_Unit_Code, 'BU_ENG_01');
        assert.equal(second.Business_Unit_Name, 'Engineering & Product');
        assert.equal(second.Head_Employee_ID, 'EMP0001');
        assert.equal(second.Active, 'No');
        assert.equal(result.firestoreDocs[1].isActive, false);
    });

    await t.test('Validation rejects rows with missing Business_Unit_Code or Business_Unit_Name', () => {
        const invalidRows = [
            {
                'Business_Unit_Code': '',
                'Business_Unit_Name': 'Invalid Missing Code',
                'Head_Employee_ID': 'EMP0001',
                'Active': 'Yes'
            },
            {
                'Business_Unit_Code': 'BU_NO_NAME',
                'Business_Unit_Name': '   ',
                'Head_Employee_ID': 'EMP0002',
                'Active': 'Yes'
            }
        ];

        const result = buParser.parseBusinessUnitSheet(invalidRows);
        assert.equal(result.valid, false);
        assert.equal(result.errors.length, 2);
        assert.equal(result.data.length, 0);
        assert.match(result.errors[0], /Missing required attribute 'Business_Unit_Code'/i);
        assert.match(result.errors[1], /Missing required attribute 'Business_Unit_Name'/i);
    });

    await t.test('Validation rejects duplicate Business_Unit_Code in the same ingestion set', () => {
        const duplicateRows = [
            {
                'Business_Unit_Code': 'BU_DUP_01',
                'Business_Unit_Name': 'Duplicate 1',
                'Head_Employee_ID': 'EMP0001',
                'Active': 'Yes'
            },
            {
                'Business_Unit_Code': 'BU_DUP_01',
                'Business_Unit_Name': 'Duplicate 2',
                'Head_Employee_ID': 'EMP0002',
                'Active': 'Yes'
            }
        ];

        const result = buParser.parseBusinessUnitSheet(duplicateRows);
        assert.equal(result.valid, false);
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /Duplicate Business_Unit_Code 'BU_DUP_01'/i);
    });

    await t.test('Active boolean parsing correctly maps Yes/No, Y/N, TRUE/FALSE, 1/0', () => {
        assert.equal(buParser.parseActiveBoolean('Yes'), true);
        assert.equal(buParser.parseActiveBoolean('yes'), true);
        assert.equal(buParser.parseActiveBoolean('Y'), true);
        assert.equal(buParser.parseActiveBoolean(true), true);
        assert.equal(buParser.parseActiveBoolean(1), true);

        assert.equal(buParser.parseActiveBoolean('No'), false);
        assert.equal(buParser.parseActiveBoolean('no'), false);
        assert.equal(buParser.parseActiveBoolean('N'), false);
        assert.equal(buParser.parseActiveBoolean(false), false);
        assert.equal(buParser.parseActiveBoolean(0), false);
    });
});

test('2. Setup & Ingestion Support (PRD Section 1 - SheetJS & Templates.xlsx)', async (t) => {
    await t.test('Parse live Templates.xlsx file Business Unit sheet via SheetJS', () => {
        const xlsxPath = path.join(rootDir, 'Templates.xlsx');
        assert.equal(fs.existsSync(xlsxPath), true, 'Templates.xlsx should exist at workspace root');

        const buffer = fs.readFileSync(xlsxPath);
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const buSheet = workbook.Sheets['Business Unit'];
        assert.ok(buSheet, "Workbook must contain 'Business Unit' sheet");

        const rawRows = xlsx.utils.sheet_to_json(buSheet, { defval: '' });
        assert.ok(rawRows.length > 0, "Business Unit sheet should have rows");

        const personnel = [
            { id: 'EMP0003', name: 'Ananya Roy', active: true },
            { id: 'EMP0001', name: 'Devendra Sharma', active: true }
        ];

        const result = buParser.parseBusinessUnitSheet(rawRows, personnel);
        assert.equal(result.valid, true);
        assert.ok(result.data.length >= 1);

        // Verify the 4 exact attributes are present on every valid record
        result.data.forEach((rec) => {
            assert.ok(rec.Business_Unit_Code, 'Record must have Business_Unit_Code');
            assert.ok(rec.Business_Unit_Name, 'Record must have Business_Unit_Name');
            assert.ok('Head_Employee_ID' in rec, 'Record must have Head_Employee_ID');
            assert.ok(rec.Active === 'Yes' || rec.Active === 'No', 'Record Active must be Yes or No');
        });

        // Verify firestoreDocs schema
        result.firestoreDocs.forEach((doc) => {
            assert.ok(doc.businessUnitCode, 'Doc must have businessUnitCode');
            assert.ok(doc.businessUnitName, 'Doc must have businessUnitName');
            assert.ok('headEmployeeId' in doc, 'Doc must have headEmployeeId');
            assert.equal(typeof doc.isActive, 'boolean', 'Doc must have boolean isActive');
            assert.ok(Array.isArray(doc.allowedEmployeeTypes), 'Doc must have allowedEmployeeTypes array');
        });
    });

    await t.test('Parse CSV string format for Business Unit uploads', () => {
        const csvContent = 
`Business_Unit_Code,Business_Unit_Name,Head_Employee_ID,Active
BU_FIN_01,Finance & Accounting,EMP0005,Yes
BU_MKT_01,Marketing & Growth,EMP0006,No`;

        const result = buParser.parseBusinessUnitCsv(csvContent);
        assert.equal(result.valid, true);
        assert.equal(result.data.length, 2);

        const fin = result.data[0];
        assert.equal(fin.Business_Unit_Code, 'BU_FIN_01');
        assert.equal(fin.Business_Unit_Name, 'Finance & Accounting');
        assert.equal(fin.Head_Employee_ID, 'EMP0005');
        assert.equal(fin.Active, 'Yes');

        const mkt = result.data[1];
        assert.equal(mkt.Business_Unit_Code, 'BU_MKT_01');
        assert.equal(mkt.Business_Unit_Name, 'Marketing & Growth');
        assert.equal(mkt.Head_Employee_ID, 'EMP0006');
        assert.equal(mkt.Active, 'No');
    });

    await t.test('Dynamic Head Selection: Resolves active employee name from directory', () => {
        const personnel = [
            { id: 'EMP0003', name: 'Ananya Roy', email: 'ananya@kylrx.ai', active: true },
            { id: 'EMP0099', name: 'Deactivated Head', email: 'inactive@kylrx.ai', active: false }
        ];

        const rows = [
            {
                'Business_Unit_Code': 'BU_CORP_01',
                'Business_Unit_Name': 'Corporate Operations',
                'Head_Employee_ID': 'EMP0003',
                'Active': 'Yes'
            }
        ];

        const result = buParser.parseBusinessUnitSheet(rows, personnel);
        assert.equal(result.firestoreDocs[0].headEmployeeName, 'Ananya Roy');
        assert.equal(result.firestoreDocs[0].headEmployeeId, 'EMP0003');
    });
});

test('3. Employee-Type Rule Integration (PRD Section 10)', async (t) => {
    await t.test('Filter active units allowed for FULL_TIME vs CONTRACT', async () => {
        // Seed mock business units via buController
        await buController.createBusinessUnit({
            businessUnitCode: 'BU_CORP_01',
            businessUnitName: 'Corporate Operations',
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT']
        });

        await buController.createBusinessUnit({
            businessUnitCode: 'BU_INTERN_ONLY',
            businessUnitName: 'Academic Research Lab',
            headEmployeeId: 'EMP0007',
            headEmployeeName: 'Dr. Kumar',
            isActive: true,
            allowedEmployeeTypes: ['INTERN']
        });

        await buController.createBusinessUnit({
            businessUnitCode: 'BU_INACTIVE',
            businessUnitName: 'Decommissioned Unit',
            headEmployeeId: 'EMP0008',
            headEmployeeName: 'Nobody',
            isActive: false,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'INTERN']
        });

        // FULL_TIME query: BU_CORP_01 should be returned, BU_INTERN_ONLY and BU_INACTIVE should NOT
        const ftUnits = buController.getAllowedBusinessUnits('FULL_TIME');
        const ftCodes = ftUnits.map(u => u.businessUnitCode);
        assert.ok(ftCodes.includes('BU_CORP_01'), 'FULL_TIME should include BU_CORP_01');
        assert.ok(!ftCodes.includes('BU_INTERN_ONLY'), 'FULL_TIME must not include INTERN-only unit');
        assert.ok(!ftCodes.includes('BU_INACTIVE'), 'Inactive unit must not be included');

        // CONTRACT query: BU_CORP_01 should be returned
        const contractUnits = buController.getAllowedBusinessUnits('CONTRACT');
        const contractCodes = contractUnits.map(u => u.businessUnitCode);
        assert.ok(contractCodes.includes('BU_CORP_01'));
        assert.ok(!contractCodes.includes('BU_INTERN_ONLY'));

        // INTERN query: BU_INTERN_ONLY should be returned
        const internUnits = buController.getAllowedBusinessUnits('INTERN');
        const internCodes = internUnits.map(u => u.businessUnitCode);
        assert.ok(internCodes.includes('BU_INTERN_ONLY'));
        assert.ok(!internCodes.includes('BU_CORP_01'));
    });

    await t.test('Block or disable invalid business unit selections automatically', async () => {
        await buController.createBusinessUnit({
            businessUnitCode: 'BU_CORP_01',
            businessUnitName: 'Corporate Operations',
            headEmployeeId: 'EMP0003',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT']
        });

        // Valid selection: FULL_TIME + BU_CORP_01
        const validCheck = buController.isCombinationValid('BU_CORP_01', 'FULL_TIME');
        assert.equal(validCheck.valid, true);

        // Invalid selection: INTERN + BU_CORP_01
        const invalidCheck = buController.isCombinationValid('BU_CORP_01', 'INTERN');
        assert.equal(invalidCheck.valid, false);
        assert.match(invalidCheck.error, /does not permit 'INTERN'/i);

        // Unknown BU
        const unknownCheck = buController.isCombinationValid('BU_NONEXISTENT', 'FULL_TIME');
        assert.equal(unknownCheck.valid, false);
        assert.match(unknownCheck.error, /not recognized/i);
    });

    await t.test('Backend buRulesService aligns with CONTRACT and BU_CORP_01 rules', () => {
        const corpRule = buRulesService.getRuleByCode('BU_CORP_01');
        assert.ok(corpRule, 'BU_CORP_01 rule should exist in backend rules service');
        assert.equal(corpRule.businessUnitName, 'Corporate Operations');
        assert.equal(corpRule.headEmployeeId, 'EMP0003');
        assert.equal(corpRule.isActive, true);

        const checkValid = buRulesService.isCombinationValid('BU_CORP_01', 'CONTRACT');
        assert.equal(checkValid.valid, true);

        const checkValidFT = buRulesService.isCombinationValid('BU_CORP_01', 'FULL_TIME');
        assert.equal(checkValidFT.valid, true);

        const checkInvalid = buRulesService.isCombinationValid('BU_CORP_01', 'EXECUTIVE');
        assert.equal(checkInvalid.valid, false);
    });
});

test('4. Data Architecture (Cloud Firestore Path & Document Schema)', async (t) => {
    await t.test('Cloud Firestore path matches organizations/{orgId}/business_units/{businessUnitCode}', () => {
        const buPath = buController.getFirestorePath('BU_CORP_01', 'org_enterprise_99');
        assert.equal(buPath, 'organizations/org_enterprise_99/business_units/BU_CORP_01');
    });

    await t.test('Document Schema strictly contains all required fields and timestamps', async () => {
        const record = await buController.createBusinessUnit({
            businessUnitCode: 'BU_CORP_01',
            businessUnitName: 'Corporate Operations',
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT']
        });

        assert.equal(record.businessUnitCode, 'BU_CORP_01');
        assert.equal(record.businessUnitName, 'Corporate Operations');
        assert.equal(record.headEmployeeId, 'EMP0003');
        assert.equal(record.headEmployeeName, 'Ananya Roy');
        assert.equal(record.isActive, true);
        assert.ok(record.allowedEmployeeTypes.includes('FULL_TIME'));
        assert.ok(record.allowedEmployeeTypes.includes('CONTRACT'));
        assert.ok(record.createdAt, 'Must include createdAt timestamp');
        assert.ok(record.updatedAt, 'Must include updatedAt timestamp');
    });

    await t.test('CRUD operations: Create, Read, Update, Toggle Status, Delete', async () => {
        // 1. Create
        const created = await buController.createBusinessUnit({
            businessUnitCode: 'BU_TEST_CRUD',
            businessUnitName: 'Initial Test BU',
            headEmployeeId: 'EMP0001',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME']
        });
        assert.equal(created.businessUnitCode, 'BU_TEST_CRUD');

        // 2. Read
        const fetched = buController.getBusinessUnit('BU_TEST_CRUD');
        assert.ok(fetched);
        assert.equal(fetched.businessUnitName, 'Initial Test BU');

        // 3. Update
        const updated = await buController.updateBusinessUnit('BU_TEST_CRUD', {
            businessUnitName: 'Updated Test BU',
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT']
        });
        assert.equal(updated.businessUnitName, 'Updated Test BU');
        assert.ok(updated.allowedEmployeeTypes.includes('FULL_TIME'));
        assert.ok(updated.allowedEmployeeTypes.includes('CONTRACT'));

        // 4. Toggle Status (Active -> Inactive -> Active)
        const deactivated = await buController.toggleBusinessUnitStatus('BU_TEST_CRUD');
        assert.equal(deactivated.isActive, false);

        const reactivated = await buController.toggleBusinessUnitStatus('BU_TEST_CRUD');
        assert.equal(reactivated.isActive, true);

        // 5. Delete
        const deleteRes = await buController.deleteBusinessUnit('BU_TEST_CRUD');
        assert.equal(deleteRes.success, true);
        assert.equal(buController.getBusinessUnit('BU_TEST_CRUD'), null);
    });
});

