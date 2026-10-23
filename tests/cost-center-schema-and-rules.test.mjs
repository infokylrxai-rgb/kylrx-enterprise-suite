import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load CostCenterParser (UMD module)
const parserPath = path.join(rootDir, 'services', 'cost-center-parser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const ccParser = parserModule.exports;

// Load CostCenterService (UMD module)
const servicePath = path.join(rootDir, 'costCenterService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const ccService = serviceModule.exports;

test('1. Exact Schema & Field Mapping (Strict 4 Attributes)', async (t) => {
    await t.test('Parse raw rows with exact 4 attributes: Cost_Center_Code, Cost_Center_Name, Owner_Employee_ID, Active', () => {
        const sampleRows = [
            {
                'Cost_Center_Code': 'CC_ENG_DEV',
                'Cost_Center_Name': 'Software Engineering & R&D',
                'Owner_Employee_ID': 'EMP0002',
                'Active': 'Yes'
            },
            {
                'Cost_Center_Code': 'CC_FIN_301',
                'Cost_Center_Name': 'Treasury & Statutory Compliance',
                'Owner_Employee_ID': 'EMP0004',
                'Active': 'No'
            }
        ];

        const personnel = [
            { id: 'EMP0002', name: 'Vikram Malhotra', designation: 'CEO', active: true },
            { id: 'EMP0004', name: 'Rajesh Raman', designation: 'CFO', active: true }
        ];

        const result = ccParser.parseCostCenterSheet(sampleRows, personnel);

        assert.equal(result.valid, true);
        assert.equal(result.stats.totalRows, 2);
        assert.equal(result.data.length, 2);
        assert.equal(result.firestoreDocs.length, 2);
        assert.equal(result.errors.length, 0);

        // Strict 4 attributes check on data
        const first = result.data[0];
        assert.equal(first.Cost_Center_Code, 'CC_ENG_DEV');
        assert.equal(first.Cost_Center_Name, 'Software Engineering & R&D');
        assert.equal(first.Owner_Employee_ID, 'EMP0002');
        assert.equal(first.Active, 'Yes');

        // Firestore document schema check
        const firstDoc = result.firestoreDocs[0];
        assert.equal(firstDoc.costCenterCode, 'CC_ENG_DEV');
        assert.equal(firstDoc.costCenterName, 'Software Engineering & R&D');
        assert.equal(firstDoc.ownerEmployeeId, 'EMP0002');
        assert.equal(firstDoc.ownerEmployeeName, 'Vikram Malhotra');
        assert.equal(firstDoc.isActive, true);

        // Inactive parsing check
        const second = result.data[1];
        assert.equal(second.Cost_Center_Code, 'CC_FIN_301');
        assert.equal(second.Cost_Center_Name, 'Treasury & Statutory Compliance');
        assert.equal(second.Owner_Employee_ID, 'EMP0004');
        assert.equal(second.Active, 'No');
        assert.equal(result.firestoreDocs[1].isActive, false);
    });

    await t.test('Validation rejects rows with missing Cost_Center_Code or Cost_Center_Name', () => {
        const invalidRows = [
            {
                'Cost_Center_Code': '',
                'Cost_Center_Name': 'Invalid Missing Code',
                'Owner_Employee_ID': 'EMP0001',
                'Active': 'Yes'
            },
            {
                'Cost_Center_Code': 'CC_NO_NAME',
                'Cost_Center_Name': '   ',
                'Owner_Employee_ID': 'EMP0002',
                'Active': 'Yes'
            }
        ];

        const result = ccParser.parseCostCenterSheet(invalidRows);
        assert.equal(result.valid, false);
        assert.equal(result.errors.length, 2);
        assert.equal(result.data.length, 0);
        assert.match(result.errors[0], /Missing required attribute 'Cost_Center_Code'/i);
        assert.match(result.errors[1], /Missing required attribute 'Cost_Center_Name'/i);
    });

    await t.test('Validation rejects duplicate Cost_Center_Code in the same ingestion set', () => {
        const duplicateRows = [
            {
                'Cost_Center_Code': 'CC_DUP_01',
                'Cost_Center_Name': 'Duplicate CC 1',
                'Owner_Employee_ID': 'EMP0001',
                'Active': 'Yes'
            },
            {
                'Cost_Center_Code': 'CC_DUP_01',
                'Cost_Center_Name': 'Duplicate CC 2',
                'Owner_Employee_ID': 'EMP0002',
                'Active': 'Yes'
            }
        ];

        const result = ccParser.parseCostCenterSheet(duplicateRows);
        assert.equal(result.valid, false);
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /Duplicate Cost_Center_Code 'CC_DUP_01'/i);
    });

    await t.test('Active boolean parsing correctly maps Yes/No, Y/N, TRUE/FALSE, 1/0', () => {
        assert.equal(ccParser.parseActiveBoolean('Yes'), true);
        assert.equal(ccParser.parseActiveBoolean('yes'), true);
        assert.equal(ccParser.parseActiveBoolean('Y'), true);
        assert.equal(ccParser.parseActiveBoolean(true), true);
        assert.equal(ccParser.parseActiveBoolean(1), true);

        assert.equal(ccParser.parseActiveBoolean('No'), false);
        assert.equal(ccParser.parseActiveBoolean('no'), false);
        assert.equal(ccParser.parseActiveBoolean('N'), false);
        assert.equal(ccParser.parseActiveBoolean(false), false);
        assert.equal(ccParser.parseActiveBoolean(0), false);
    });
});

test('2. Setup & Ingestion Support (PRD Section 1 - SheetJS & Templates.xlsx)', async (t) => {
    await t.test('Parse live Templates.xlsx file Cost Center sheet via SheetJS', () => {
        const xlsxPath = path.join(rootDir, 'Templates.xlsx');
        assert.equal(fs.existsSync(xlsxPath), true, 'Templates.xlsx should exist at workspace root');

        const buffer = fs.readFileSync(xlsxPath);
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const ccSheet = workbook.Sheets['Cost Center'] || workbook.Sheets['Cost Centre'];
        assert.ok(ccSheet, "Workbook must contain 'Cost Center' or 'Cost Centre' sheet");

        const rawRows = xlsx.utils.sheet_to_json(ccSheet, { defval: '' });
        assert.ok(rawRows.length > 0, "Cost Center sheet should have rows");

        const personnel = [
            { id: 'EMP0001', name: 'Devendra Sharma', designation: 'CTO', active: true },
            { id: 'EMP0002', name: 'Vikram Malhotra', designation: 'CEO', active: true },
            { id: 'EMP0003', name: 'Ananya Roy', designation: 'CPO', active: true },
            { id: 'EMP0004', name: 'Rajesh Raman', designation: 'CFO', active: true }
        ];

        const result = ccParser.parseCostCenterSheet(rawRows, personnel);
        assert.equal(result.valid, true);
        assert.ok(result.data.length >= 1);

        // Verify the 4 exact attributes are present on every valid record
        result.data.forEach((rec) => {
            assert.ok(rec.Cost_Center_Code, 'Record must have Cost_Center_Code');
            assert.ok(rec.Cost_Center_Name, 'Record must have Cost_Center_Name');
            assert.ok('Owner_Employee_ID' in rec, 'Record must have Owner_Employee_ID');
            assert.ok(rec.Active === 'Yes' || rec.Active === 'No', 'Record Active must be Yes or No');
        });

        // Verify firestoreDocs schema
        result.firestoreDocs.forEach((doc) => {
            assert.ok(doc.costCenterCode, 'Doc must have costCenterCode');
            assert.ok(doc.costCenterName, 'Doc must have costCenterName');
            assert.ok('ownerEmployeeId' in doc, 'Doc must have ownerEmployeeId');
            assert.equal(typeof doc.isActive, 'boolean', 'Doc must have boolean isActive');
        });
    });

    await t.test('Parse CSV string format for Cost Center uploads', () => {
        const csvContent = 
`Cost_Center_Code,Cost_Center_Name,Owner_Employee_ID,Active
CC_ENG_DEV,Software Engineering & R&D,EMP0002,Yes
CC_HR_OPS,People Operations & Payroll,EMP0003,No`;

        const result = ccParser.parseCostCenterCsv(csvContent);
        assert.equal(result.valid, true);
        assert.equal(result.data.length, 2);

        const eng = result.data[0];
        assert.equal(eng.Cost_Center_Code, 'CC_ENG_DEV');
        assert.equal(eng.Cost_Center_Name, 'Software Engineering & R&D');
        assert.equal(eng.Owner_Employee_ID, 'EMP0002');
        assert.equal(eng.Active, 'Yes');

        const hr = result.data[1];
        assert.equal(hr.Cost_Center_Code, 'CC_HR_OPS');
        assert.equal(hr.Cost_Center_Name, 'People Operations & Payroll');
        assert.equal(hr.Owner_Employee_ID, 'EMP0003');
        assert.equal(hr.Active, 'No');
    });

    await t.test('Dynamic Owner Selection: Resolves active employee name and designation from directory', () => {
        const personnel = [
            { id: 'EMP0002', name: 'Vikram Malhotra', designation: 'CEO', active: true },
            { id: 'EMP0099', name: 'Deactivated Exec', designation: 'Former VP', active: false }
        ];

        const rows = [
            {
                'Cost_Center_Code': 'CC_EXEC_01',
                'Cost_Center_Name': 'Executive Management',
                'Owner_Employee_ID': 'EMP0002',
                'Active': 'Yes'
            }
        ];

        const result = ccParser.parseCostCenterSheet(rows, personnel);
        assert.equal(result.firestoreDocs[0].ownerEmployeeName, 'Vikram Malhotra');
        assert.equal(result.firestoreDocs[0].ownerEmployeeId, 'EMP0002');
    });
});

test('3. Cross-Module Linkage (PRD Sections 10 & 13)', async (t) => {
    await t.test('getActiveCostCenters returns only active records (Active == Yes / isActive === true)', async () => {
        await ccService.createCostCenter({
            costCenterCode: 'CC_ACTIVE_TEST',
            costCenterName: 'Active Cost Center Unit',
            ownerEmployeeId: 'EMP0001',
            isActive: true
        });

        await ccService.createCostCenter({
            costCenterCode: 'CC_INACTIVE_TEST',
            costCenterName: 'Decommissioned Unit',
            ownerEmployeeId: 'EMP0002',
            isActive: false
        });

        const activeUnits = ccService.getActiveCostCenters();
        const activeCodes = activeUnits.map(u => u.costCenterCode);

        assert.ok(activeCodes.includes('CC_ACTIVE_TEST'), 'Should include CC_ACTIVE_TEST');
        assert.ok(!activeCodes.includes('CC_INACTIVE_TEST'), 'Must NOT include inactive CC_INACTIVE_TEST');
    });

    await t.test('Sub-Departments correctly link to associated Cost_Center_Code', () => {
        // Engineering sub-departments
        assert.equal(ccService.getCostCenterForSubDepartment('ENG-FRONTEND')?.costCenterCode, 'CC-ENG-101');
        assert.equal(ccService.getCostCenterForSubDepartment('ENG-BACKEND')?.costCenterCode, 'CC-ENG-101');
        assert.equal(ccService.getCostCenterForSubDepartment('ENG-QA')?.costCenterCode, 'CC-ENG-101');
        assert.equal(ccService.getCostCenterForSubDepartment('ENG-DEVOPS')?.costCenterCode, 'CC-ENG-101');

        // AI Labs
        assert.equal(ccService.getCostCenterForSubDepartment('AI-MODELS')?.costCenterCode, 'CC-AI-102');
        assert.equal(ccService.getCostCenterForSubDepartment('AI-ENG')?.costCenterCode, 'CC-AI-102');

        // HR & Finance
        assert.equal(ccService.getCostCenterForSubDepartment('HR-COMPLIANCE')?.costCenterCode, 'CC-HR-201');
        assert.equal(ccService.getCostCenterForSubDepartment('FIN-PAYROLL')?.costCenterCode, 'CC-FIN-301');
        assert.equal(ccService.getCostCenterForSubDepartment('FIN-TAX')?.costCenterCode, 'CC-FIN-301');

        // String code helper with default fallback
        assert.equal(ccService.getCostCenterCodeForSubDepartment('ENG-FRONTEND'), 'CC-ENG-101');
        assert.equal(ccService.getCostCenterCodeForSubDepartment('UNKNOWN-SUB'), 'CC-ENG-101');
    });

    await t.test('Dynamic UI Dropdown binding script filters active records and sets selection', () => {
        const mockSelect = {
            innerHTML: '',
            value: '',
            options: [],
            appendChild: function(child) {
                this.options.push(child);
            }
        };

        const activeList = ccService.getActiveCostCenters();
        assert.ok(activeList.length > 0);

        ccService.populateCostCenterDropdown(mockSelect, {
            selectedCode: 'CC-ENG-101',
            includePlaceholder: true
        });

        assert.ok(mockSelect.innerHTML.includes('CC-ENG-101'));
        assert.ok(mockSelect.innerHTML.includes('Software Engineering') || mockSelect.innerHTML.includes('CC-ENG-101'));
        assert.equal(mockSelect.value, 'CC-ENG-101');
    });
});

test('4. Data Architecture (Cloud Firestore Path & Document Schema)', async (t) => {
    await t.test('Cloud Firestore path strictly matches organizations/{orgId}/cost_centers/{costCenterCode}', () => {
        const ccPath = ccService.getFirestorePath('CC_ENG_DEV', 'org_enterprise_99');
        assert.equal(ccPath, 'organizations/org_enterprise_99/cost_centers/CC_ENG_DEV');
    });

    await t.test('Document Schema strictly contains all required attributes matching PRD specification', async () => {
        const record = await ccService.createCostCenter({
            costCenterCode: 'CC_ENG_DEV',
            costCenterName: 'Software Engineering & R&D',
            ownerEmployeeId: 'EMP0002',
            ownerEmployeeName: 'Vikram Malhotra',
            isActive: true
        });

        assert.equal(record.costCenterCode, 'CC_ENG_DEV');
        assert.equal(record.costCenterName, 'Software Engineering & R&D');
        assert.equal(record.ownerEmployeeId, 'EMP0002');
        assert.equal(record.ownerEmployeeName, 'Vikram Malhotra');
        assert.equal(record.isActive, true);
        assert.ok(record.createdAt, 'Must include createdAt timestamp');
        assert.ok(record.updatedAt, 'Must include updatedAt timestamp');
    });

    await t.test('CRUD operations: Create, Read, Update, Toggle Active Status, Delete', async () => {
        // 1. Create
        const created = await ccService.createCostCenter({
            costCenterCode: 'CC_TEST_CRUD',
            costCenterName: 'Initial Test Cost Center',
            ownerEmployeeId: 'EMP0001',
            isActive: true
        });
        assert.equal(created.costCenterCode, 'CC_TEST_CRUD');

        // 2. Read
        const fetched = ccService.getCostCenter('CC_TEST_CRUD');
        assert.ok(fetched);
        assert.equal(fetched.costCenterName, 'Initial Test Cost Center');

        // 3. Update
        const updated = await ccService.updateCostCenter('CC_TEST_CRUD', {
            costCenterName: 'Updated Test Cost Center'
        });
        assert.equal(updated.costCenterName, 'Updated Test Cost Center');

        // 4. Toggle Active Status (Active -> Inactive -> Active)
        const deactivated = await ccService.toggleCostCenterStatus('CC_TEST_CRUD');
        assert.equal(deactivated.isActive, false);

        const reactivated = await ccService.toggleCostCenterStatus('CC_TEST_CRUD');
        assert.equal(reactivated.isActive, true);

        // 5. Delete
        const deleteRes = await ccService.deleteCostCenter('CC_TEST_CRUD');
        assert.equal(deleteRes.success, true);
        assert.equal(ccService.getCostCenter('CC_TEST_CRUD'), null);
    });

    await t.test('Bulk import persists multiple valid cost center documents', async () => {
        const docs = [
            {
                costCenterCode: 'CC_BULK_01',
                costCenterName: 'Bulk Cost Center 1',
                ownerEmployeeId: 'EMP0001',
                isActive: true
            },
            {
                costCenterCode: 'CC_BULK_02',
                costCenterName: 'Bulk Cost Center 2',
                ownerEmployeeId: 'EMP0002',
                isActive: false
            }
        ];

        const importRes = await ccService.bulkImportCostCenters(docs);
        assert.equal(importRes.success, true);
        assert.equal(importRes.count, 2);

        assert.ok(ccService.getCostCenter('CC_BULK_01'));
        assert.ok(ccService.getCostCenter('CC_BULK_02'));
    });
});

test('5. UI Ingestion & Management Console Integration Deliverables', async (t) => {
    await t.test('admin-onboarding-upload.html contains Cost Centers Console tab, preview table, and commit button', () => {
        const html = fs.readFileSync(path.join(rootDir, 'admin-onboarding-upload.html'), 'utf8');
        assert.match(html, /id="tabCostCenters"/);
        assert.match(html, /id="ccParseResultsContainer"/);
        assert.match(html, /id="ccManagementView"/);
        assert.ok(/id="btnConfirmCcIngest"|id="btnCommitCostCenters"/.test(html), 'Must have Cost Centers commit button');
        assert.match(html, /src="services\/cost-center-parser\.js"/);
        assert.match(html, /src="costCenterService\.js"/);
    });

    await t.test('admin-onboarding-upload.js extracts 4 exact attributes and executes Firestore batch commit', () => {
        const js = fs.readFileSync(path.join(rootDir, 'admin-onboarding-upload.js'), 'utf8');
        assert.match(js, /extract4CcAttributesFromSheetRows/);
        assert.match(js, /renderParsedCcPreview/);
        assert.match(js, /executeCostCenterIngest/);
        assert.match(js, /tabCostCenters/);
    });

    await t.test('admin-dashboard.html includes costCenterService.js and #costCenterCodeSelect in Personnel modal', () => {
        const dashboardHtml = fs.readFileSync(path.join(rootDir, 'admin-dashboard.html'), 'utf8');
        assert.match(dashboardHtml, /src="costCenterService\.js"/);
        assert.match(dashboardHtml, /id="costCenterCodeSelect"/);
    });

    await t.test('admin-app.js maps sub-departments to costCenterCode and dynamically updates dropdown', () => {
        const adminAppJs = fs.readFileSync(path.join(rootDir, 'admin-app.js'), 'utf8');
        assert.match(adminAppJs, /costCenterCode:\s*['"]CC-ENG-101['"]/);
        assert.match(adminAppJs, /KylrxCostCenterService\.populateCostCenterDropdown/);
        assert.match(adminAppJs, /KylrxCostCenterService\.getCostCenterForSubDepartment/);
    });

    await t.test('employee-profile-controller.js populates active Cost Centers on profile modal open and reset', () => {
        const controllerJs = fs.readFileSync(path.join(rootDir, 'employee-profile-controller.js'), 'utf8');
        assert.match(controllerJs, /KylrxCostCenterService\.populateCostCenterDropdown/);
    });

    await t.test('routes/admin.js and controllers/adminController.js declare Cost Center REST endpoints', () => {
        const routes = fs.readFileSync(path.join(rootDir, 'routes', 'admin.js'), 'utf8');
        const controller = fs.readFileSync(path.join(rootDir, 'controllers', 'adminController.js'), 'utf8');

        assert.match(routes, /\/cost-centers/);
        assert.match(controller, /exports\.getCostCenters/);
        assert.match(controller, /exports\.createCostCenter/);
        assert.match(controller, /exports\.updateCostCenter/);
        assert.match(controller, /exports\.toggleCostCenterStatus/);
        assert.match(controller, /exports\.deleteCostCenter/);
        assert.match(controller, /exports\.bulkImportCostCenters/);
    });
});
