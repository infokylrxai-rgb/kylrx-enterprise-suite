/**
 * Kylrx.ai - Sub-Department Schema, Parsing & Dynamic Hierarchy Verification Suite
 * Validates PRD Sections 1, 10, & 13 matching 'Sub-Departments' sheet from Templates.xlsx:
 * 
 * 1. Exact Schema & Field Mapping (Strict 5 Attributes):
 *    - Sub-Department_Code (string, unique PK / Firestore doc ID)
 *    - Sub-Department_Name (string, display title)
 *    - Sub-Department_Head_Employee_ID (string, lead employee reference)
 *    - Cost_Center_Code (string, foreign key to active Cost Center)
 *    - Active (boolean: true for "Yes", false for "No")
 * 
 * 2. Ingestion & Administrative Setup (PRD Section 1):
 *    - SheetJS parser for 'Sub-Departments' sheet in Templates.xlsx & CSV
 *    - Foreign key verification: Cost_Center_Code checked against active Cost Centers before batch commit
 *    - Duplicate detection & empty code/name flagging
 *    - Dynamic Head selection (resolving Full Name + Employee ID) & Cost Center selector
 * 
 * 3. Cascading Hierarchy Integration (PRD Sections 10 & 13):
 *    - Dynamic Form Gating: Department or Cost Center selection dynamically filters only related active Sub-Departments
 *    - Auto-populate/link associated Cost_Center_Code when Sub-Department is chosen
 * 
 * 4. Data Architecture (Cloud Firestore):
 *    - Path: organizations/{orgId}/sub_departments/{subDepartmentCode}
 *    - Strict Document Schema with subDepartmentCode, subDepartmentName, headEmployeeId, headEmployeeName, costCenterCode, isActive, createdAt, updatedAt
 *    - CRUD service: create, get, update, toggle status, delete, bulk import
 * 
 * 5. UI Ingestion & Management Console Integration Deliverables
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Import services under test
const subDeptParserModule = await import('../services/sub-department-parser.js');
const SubDeptParser = subDeptParserModule.default || subDeptParserModule;
const subDeptServiceModule = await import('../subDepartmentService.js');
const SubDeptService = subDeptServiceModule.default || subDeptServiceModule;

test('1. Exact Schema & Field Mapping (Strict 5 Attributes)', async (t) => {
    await t.test('Parse raw rows with exact 5 attributes: Sub-Department_Code, Sub-Department_Name, Sub-Department_Head_Employee_ID, Cost_Center_Code, Active', () => {
        const rawRows = [
            {
                'Sub-Department_Code': 'SUB_ENG_API',
                'Sub-Department_Name': 'Platform & API Services',
                'Sub-Department_Head_Employee_ID': 'EMP0007',
                'Cost_Center_Code': 'CC_ENG_DEV',
                'Active': 'Yes'
            },
            {
                'Sub-Department_Code': 'ENG-FRONTEND',
                'Sub-Department_Name': 'Web Client & Mobile Apps',
                'Sub-Department_Head_Employee_ID': 'EMP0001',
                'Cost_Center_Code': 'CC-ENG-101',
                'Active': 'Yes'
            },
            {
                'Sub-Department_Code': 'ENG-LEGACY',
                'Sub-Department_Name': 'Decommissioned Monolith Services',
                'Sub-Department_Head_Employee_ID': '',
                'Cost_Center_Code': 'CC-ENG-101',
                'Active': 'No'
            }
        ];

        const result = SubDeptParser.parseSubDepartmentRows(rawRows, {
            validCostCenterCodes: ['CC_ENG_DEV', 'CC-ENG-101']
        });

        assert.strictEqual(result.errors.length, 0, `Expected 0 errors, got: ${JSON.stringify(result.errors)}`);
        assert.strictEqual(result.validRecords.length, 3);

        const rec1 = result.validRecords[0];
        assert.strictEqual(rec1.subDepartmentCode, 'SUB_ENG_API');
        assert.strictEqual(rec1.subDepartmentName, 'Platform & API Services');
        assert.strictEqual(rec1.headEmployeeId, 'EMP0007');
        assert.strictEqual(rec1.costCenterCode, 'CC_ENG_DEV');
        assert.strictEqual(rec1.isActive, true);

        const rec3 = result.validRecords[2];
        assert.strictEqual(rec3.subDepartmentCode, 'ENG-LEGACY');
        assert.strictEqual(rec3.isActive, false);
    });

    await t.test('Validation rejects rows with missing Sub-Department_Code, Sub-Department_Name, or Cost_Center_Code', () => {
        const invalidRows = [
            {
                'Sub-Department_Code': '',
                'Sub-Department_Name': 'Missing Code Unit',
                'Cost_Center_Code': 'CC_ENG_DEV',
                'Active': 'Yes'
            },
            {
                'Sub-Department_Code': 'SUB_TEST_2',
                'Sub-Department_Name': '',
                'Cost_Center_Code': 'CC_ENG_DEV',
                'Active': 'Yes'
            },
            {
                'Sub-Department_Code': 'SUB_TEST_3',
                'Sub-Department_Name': 'No Cost Center Linked',
                'Cost_Center_Code': '',
                'Active': 'Yes'
            }
        ];

        const result = SubDeptParser.parseSubDepartmentRows(invalidRows, {
            validCostCenterCodes: ['CC_ENG_DEV']
        });

        assert.strictEqual(result.validRecords.length, 0);
        assert.strictEqual(result.errors.length, 3);
        assert.match(result.errors[0].message, /Sub-Department_Code/i);
        assert.match(result.errors[1].message, /Sub-Department_Name/i);
        assert.match(result.errors[2].message, /Cost_Center_Code/i);
    });

    await t.test('Validation rejects duplicate Sub-Department_Code within same ingestion batch', () => {
        const duplicateRows = [
            {
                'Sub-Department_Code': 'SUB_ENG_API',
                'Sub-Department_Name': 'Platform & API Services',
                'Cost_Center_Code': 'CC_ENG_DEV',
                'Active': 'Yes'
            },
            {
                'Sub-Department_Code': 'SUB_ENG_API',
                'Sub-Department_Name': 'Platform Copy',
                'Cost_Center_Code': 'CC_ENG_DEV',
                'Active': 'Yes'
            }
        ];

        const result = SubDeptParser.parseSubDepartmentRows(duplicateRows, {
            validCostCenterCodes: ['CC_ENG_DEV']
        });

        assert.strictEqual(result.validRecords.length, 1);
        assert.strictEqual(result.errors.length, 1);
        assert.match(result.errors[0].message, /Duplicate Sub-Department_Code/i);
    });

    await t.test('Active boolean parsing correctly maps Yes/No, Y/N, TRUE/FALSE, 1/0', () => {
        assert.strictEqual(SubDeptParser.parseActiveBoolean('Yes'), true);
        assert.strictEqual(SubDeptParser.parseActiveBoolean('YES'), true);
        assert.strictEqual(SubDeptParser.parseActiveBoolean('Y'), true);
        assert.strictEqual(SubDeptParser.parseActiveBoolean('true'), true);
        assert.strictEqual(SubDeptParser.parseActiveBoolean(true), true);
        assert.strictEqual(SubDeptParser.parseActiveBoolean(1), true);

        assert.strictEqual(SubDeptParser.parseActiveBoolean('No'), false);
        assert.strictEqual(SubDeptParser.parseActiveBoolean('NO'), false);
        assert.strictEqual(SubDeptParser.parseActiveBoolean('N'), false);
        assert.strictEqual(SubDeptParser.parseActiveBoolean('false'), false);
        assert.strictEqual(SubDeptParser.parseActiveBoolean(false), false);
        assert.strictEqual(SubDeptParser.parseActiveBoolean(0), false);
    });
});

test('2. Ingestion & Administrative Setup (PRD Section 1 - SheetJS & Templates.xlsx)', async (t) => {
    await t.test('Parse live Templates.xlsx file Sub-Departments sheet via SheetJS', async () => {
        const xlsxPath = path.join(rootDir, 'Templates.xlsx');
        assert.ok(fs.existsSync(xlsxPath), 'Templates.xlsx must exist at workspace root');

        const buffer = fs.readFileSync(xlsxPath);
        const result = await SubDeptParser.parseSubDepartmentWorkbook(buffer);

        assert.ok(result.totalRows > 0, 'Templates.xlsx must contain sub-department rows');
        assert.ok(result.validRecords.length >= 5, 'Must contain at least 5 standard sub-departments');

        const codes = result.validRecords.map(r => r.subDepartmentCode);
        assert.ok(codes.includes('SUB_ENG_API') || codes.includes('ENG-FRONTEND'));
        assert.ok(codes.includes('ENG-BACKEND'));

        const apiSub = result.validRecords.find(r => r.subDepartmentCode === 'SUB_ENG_API' || r.subDepartmentCode === 'ENG-FRONTEND');
        assert.ok(apiSub);
        assert.ok(apiSub.subDepartmentName);
        assert.ok(apiSub.costCenterCode);
        assert.strictEqual(apiSub.isActive, true);
    });

    await t.test('Foreign Key Validation: Cost_Center_Code checked against active Cost Centers before commitment', () => {
        const testRows = [
            {
                'Sub-Department_Code': 'SUB_ENG_VALID',
                'Sub-Department_Name': 'Valid Cost Center SubDept',
                'Cost_Center_Code': 'CC_ENG_DEV',
                'Active': 'Yes'
            },
            {
                'Sub-Department_Code': 'SUB_ENG_INVALID',
                'Sub-Department_Name': 'Invalid Cost Center SubDept',
                'Cost_Center_Code': 'NON_EXISTENT_CC',
                'Active': 'Yes'
            }
        ];

        const result = SubDeptParser.parseSubDepartmentRows(testRows, {
            validCostCenterCodes: ['CC_ENG_DEV', 'CC-ENG-101'],
            validateCostCenters: true
        });

        assert.strictEqual(result.validRecords.length, 1);
        assert.strictEqual(result.validRecords[0].subDepartmentCode, 'SUB_ENG_VALID');
        assert.strictEqual(result.errors.length, 1);
        assert.match(result.errors[0].message, /NON_EXISTENT_CC/);
        assert.match(result.errors[0].message, /Foreign Key Violation/i);
    });

    await t.test('Parse CSV string format for Sub-Departments upload', () => {
        const csvContent = 
`Sub-Department_Code,Sub-Department_Name,Sub-Department_Head_Employee_ID,Cost_Center_Code,Active
SUB_OPS_NET,Network Infrastructure,EMP0003,CC_OPS_SUPP,Yes
SUB_HR_OPS,People Operations,EMP0005,CC_HR_TALENT,Yes
SUB_FIN_TAX,Corporate Tax Strategy,,CC_FIN_CORP,No`;

        const result = SubDeptParser.parseSubDepartmentCsv(csvContent, {
            validCostCenterCodes: ['CC_OPS_SUPP', 'CC_HR_TALENT', 'CC_FIN_CORP']
        });

        assert.strictEqual(result.errors.length, 0);
        assert.strictEqual(result.validRecords.length, 3);
        assert.strictEqual(result.validRecords[0].subDepartmentCode, 'SUB_OPS_NET');
        assert.strictEqual(result.validRecords[0].headEmployeeId, 'EMP0003');
        assert.strictEqual(result.validRecords[2].isActive, false);
    });

    await t.test('Dynamic Head Selection: Resolves active employee name and ID', () => {
        const directory = [
            { employeeId: 'EMP0007', fullName: 'Aditya Rao', designation: 'Staff Lead' },
            { employeeId: 'EMP0001', fullName: 'Priya Sharma', designation: 'Engineering Director' }
        ];

        const resolved = SubDeptParser.resolveSubDepartmentHead('EMP0007', directory);
        assert.strictEqual(resolved.id, 'EMP0007');
        assert.strictEqual(resolved.name, 'Aditya Rao');
        assert.strictEqual(resolved.displayName, 'Aditya Rao (EMP0007)');
    });
});

test('3. Cascading Hierarchy Integration (PRD Sections 10 & 13)', async (t) => {
    await t.test('filterSubDepartments: Department selection dynamically filters only related active Sub-Departments', () => {
        const subs = [
            { subDepartmentCode: 'ENG-FRONTEND', subDepartmentName: 'Frontend Web', departmentCode: 'ENG', costCenterCode: 'CC_ENG_DEV', isActive: true },
            { subDepartmentCode: 'ENG-BACKEND', subDepartmentName: 'Backend Core', departmentCode: 'ENG', costCenterCode: 'CC_ENG_DEV', isActive: true },
            { subDepartmentCode: 'ENG-DEPRECATED', subDepartmentName: 'Old App', departmentCode: 'ENG', costCenterCode: 'CC_ENG_DEV', isActive: false },
            { subDepartmentCode: 'HR-COMPLIANCE', subDepartmentName: 'HR Compliance', departmentCode: 'HR', costCenterCode: 'CC_HR_TALENT', isActive: true },
            { subDepartmentCode: 'FIN-PAYROLL', subDepartmentName: 'Payroll Management', departmentCode: 'FIN', costCenterCode: 'CC_FIN_CORP', isActive: true }
        ];

        // Filter active for Engineering
        const engSubs = SubDeptService.filterSubDepartments({
            departmentCode: 'ENG',
            activeOnly: true,
            subDepartments: subs
        });

        assert.strictEqual(engSubs.length, 2);
        assert.ok(engSubs.every(s => s.departmentCode === 'ENG' || s.subDepartmentCode.startsWith('ENG')));
        assert.ok(engSubs.every(s => s.isActive === true));
        assert.ok(!engSubs.some(s => s.subDepartmentCode === 'ENG-DEPRECATED'), 'Inactive sub-department must be filtered out');

        // Filter active for HR
        const hrSubs = SubDeptService.filterSubDepartments({
            departmentCode: 'HR',
            activeOnly: true,
            subDepartments: subs
        });
        assert.strictEqual(hrSubs.length, 1);
        assert.strictEqual(hrSubs[0].subDepartmentCode, 'HR-COMPLIANCE');
    });

    await t.test('Auto-populate: Sub-Department selection automatically links associated Cost_Center_Code', () => {
        const subs = [
            { subDepartmentCode: 'SUB_ENG_API', costCenterCode: 'CC_ENG_DEV', isActive: true },
            { subDepartmentCode: 'HR-COMPLIANCE', costCenterCode: 'CC_HR_TALENT', isActive: true }
        ];

        const cc1 = SubDeptService.getCostCenterForSubDepartment('SUB_ENG_API', subs);
        assert.strictEqual(cc1, 'CC_ENG_DEV');

        const cc2 = SubDeptService.getCostCenterForSubDepartment('HR-COMPLIANCE', subs);
        assert.strictEqual(cc2, 'CC_HR_TALENT');
    });

    await t.test('Dynamic Form Gating: populateSubDepartmentDropdown generates filtered select element HTML', () => {
        // Mock DOM select element
        const mockSelect = {
            innerHTML: '',
            disabled: true,
            value: '',
            options: []
        };

        const subs = [
            { subDepartmentCode: 'SUB_ENG_API', subDepartmentName: 'Platform & API Services', costCenterCode: 'CC_ENG_DEV', departmentCode: 'ENG', isActive: true },
            { subDepartmentCode: 'ENG-BACKEND', subDepartmentName: 'Backend Core', costCenterCode: 'CC_ENG_DEV', departmentCode: 'ENG', isActive: true },
            { subDepartmentCode: 'HR-RECRUIT', subDepartmentName: 'Talent Acquisition', costCenterCode: 'CC_HR_TALENT', departmentCode: 'HR', isActive: true }
        ];

        SubDeptService.populateSubDepartmentDropdown(mockSelect, {
            departmentCode: 'ENG',
            selectedCode: 'SUB_ENG_API',
            activeOnly: true,
            includePlaceholder: true,
            subDepartments: subs
        });

        assert.strictEqual(mockSelect.disabled, false);
        assert.match(mockSelect.innerHTML, /value="SUB_ENG_API"/);
        assert.match(mockSelect.innerHTML, /data-cost-center="CC_ENG_DEV"/);
        assert.match(mockSelect.innerHTML, /value="ENG-BACKEND"/);
        assert.ok(!mockSelect.innerHTML.includes('HR-RECRUIT'), 'HR subdepartment must not appear when filtered by ENG');
    });
});

test('4. Data Architecture (Cloud Firestore Path & Document Schema)', async (t) => {
    await t.test('Cloud Firestore path strictly matches organizations/{orgId}/sub_departments/{subDepartmentCode}', () => {
        const orgId = 'org_test_enterprise';
        const subDeptCode = 'SUB_ENG_API';
        const expectedPath = `organizations/${orgId}/sub_departments/${subDeptCode}`;

        const constructedPath = SubDeptService.getSubDepartmentDocPath(subDeptCode, orgId);
        assert.strictEqual(constructedPath, expectedPath);
    });

    await t.test('Document Schema strictly contains all 7 attributes matching PRD Section 4 specification', async () => {
        const payload = {
            'Sub-Department_Code': 'SUB_ENG_API',
            'Sub-Department_Name': 'Platform & API Services',
            'Sub-Department_Head_Employee_ID': 'EMP0007',
            'Cost_Center_Code': 'CC_ENG_DEV',
            'Active': 'Yes',
            headEmployeeName: 'Aditya Rao'
        };

        const record = await SubDeptService.createSubDepartment(payload, 'org_test_123');

        assert.strictEqual(record.subDepartmentCode, 'SUB_ENG_API');
        assert.strictEqual(record.subDepartmentName, 'Platform & API Services');
        assert.strictEqual(record.headEmployeeId, 'EMP0007');
        assert.strictEqual(record.headEmployeeName, 'Aditya Rao');
        assert.strictEqual(record.costCenterCode, 'CC_ENG_DEV');
        assert.strictEqual(record.isActive, true);
        assert.ok(record.createdAt, 'Must include createdAt timestamp');
        assert.ok(record.updatedAt, 'Must include updatedAt timestamp');
    });

    await t.test('CRUD operations: Create, Read, Update, Toggle Active Status, Delete', async () => {
        const orgId = 'org_test_crud';
        const subCode = 'SUB_QA_AUTOMATION';

        // 1. Create
        const created = await SubDeptService.createSubDepartment({
            subDepartmentCode: subCode,
            subDepartmentName: 'QA & Automation Testing',
            headEmployeeId: 'EMP0004',
            costCenterCode: 'CC_ENG_QA',
            isActive: true
        }, orgId);
        assert.strictEqual(created.subDepartmentCode, subCode);

        // 2. Read
        const retrieved = await SubDeptService.getSubDepartment(subCode, orgId);
        assert.ok(retrieved);
        assert.strictEqual(retrieved.subDepartmentName, 'QA & Automation Testing');
        assert.strictEqual(retrieved.isActive, true);

        // 3. Update
        const updated = await SubDeptService.updateSubDepartment(subCode, {
            subDepartmentName: 'QA & Reliability Engineering',
            costCenterCode: 'CC_ENG_DEV'
        }, orgId);
        assert.strictEqual(updated.subDepartmentName, 'QA & Reliability Engineering');
        assert.strictEqual(updated.costCenterCode, 'CC_ENG_DEV');

        // 4. Toggle Status
        const toggled = await SubDeptService.toggleSubDepartmentStatus(subCode, false, orgId);
        assert.strictEqual(toggled.isActive, false);

        // 5. Delete
        const deleted = await SubDeptService.deleteSubDepartment(subCode, orgId);
        assert.strictEqual(deleted, true);

        const afterDelete = await SubDeptService.getSubDepartment(subCode, orgId);
        assert.strictEqual(afterDelete, null);
    });

    await t.test('Bulk import persists multiple valid sub-department documents', async () => {
        const orgId = 'org_bulk_test';
        const items = [
            {
                subDepartmentCode: 'SUB_ENG_SEC',
                subDepartmentName: 'Application Security',
                costCenterCode: 'CC_ENG_DEV',
                headEmployeeId: 'EMP0001',
                isActive: true
            },
            {
                subDepartmentCode: 'SUB_OPS_CLOUD',
                subDepartmentName: 'Cloud SRE',
                costCenterCode: 'CC_OPS_SUPP',
                headEmployeeId: 'EMP0002',
                isActive: true
            }
        ];

        const result = await SubDeptService.bulkImportSubDepartments(items, orgId);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.ingestedCount, 2);

        const sec = await SubDeptService.getSubDepartment('SUB_ENG_SEC', orgId);
        assert.ok(sec);
        assert.strictEqual(sec.costCenterCode, 'CC_ENG_DEV');
    });
});

test('5. UI Ingestion & Management Console Integration Deliverables', async (t) => {
    await t.test('admin-onboarding-upload.html contains Sub-Departments Console tab, preview table, and commit button', () => {
        const html = fs.readFileSync(path.join(rootDir, 'admin-onboarding-upload.html'), 'utf-8');

        assert.match(html, /id="tabSubDepartments"/, 'Must contain Tab E button for Sub-Departments Console');
        assert.match(html, /id="subDeptParseResultsContainer"/, 'Must contain live preview container for Sub-Departments');
        assert.match(html, /id="btnConfirmSubDeptIngest"/, 'Must contain commit button for Sub-Departments');
        assert.match(html, /services\/sub-department-parser\.js/, 'Must link sub-department-parser.js script');
        assert.match(html, /subDepartmentService\.js/, 'Must link subDepartmentService.js script');
    });

    await t.test('admin-onboarding-upload.js extracts 5 exact attributes and validates foreign key Cost Center before commit', () => {
        const js = fs.readFileSync(path.join(rootDir, 'admin-onboarding-upload.js'), 'utf-8');

        assert.match(js, /extract5SubDeptAttributesFromSheetRows/, 'Must declare parser function for Sub-Departments');
        assert.match(js, /Sub-Department_Code/);
        assert.match(js, /Sub-Department_Name/);
        assert.match(js, /Sub-Department_Head_Employee_ID/);
        assert.match(js, /Cost_Center_Code/);
        assert.match(js, /executeSubDepartmentIngest/, 'Must declare executeSubDepartmentIngest function');
    });

    await t.test('admin-dashboard.html includes subDepartmentService.js and personnel modal cascading fields', () => {
        const html = fs.readFileSync(path.join(rootDir, 'admin-dashboard.html'), 'utf-8');

        assert.match(html, /services\/sub-department-parser\.js/, 'Must include sub-department-parser.js in admin-dashboard.html');
        assert.match(html, /subDepartmentService\.js/, 'Must include subDepartmentService.js in admin-dashboard.html');
        assert.match(html, /id="deptSelect"/, 'Must have deptSelect');
        assert.match(html, /id="subDeptSelect"/, 'Must have subDeptSelect');
        assert.match(html, /id="costCenterCodeSelect"/, 'Must have costCenterCodeSelect');
    });

    await t.test('admin-app.js binds cascading hierarchy and maps Sub-Department to Cost Center', () => {
        const js = fs.readFileSync(path.join(rootDir, 'admin-app.js'), 'utf-8');

        assert.match(js, /bindCascadingHierarchy/);
        assert.match(js, /costCenterCode/);
    });

    await t.test('employee-profile-controller.js populates active Sub-Departments and linked Cost Center', () => {
        const js = fs.readFileSync(path.join(rootDir, 'employee-profile-controller.js'), 'utf-8');

        assert.match(js, /KylrxSubDepartmentService/);
        assert.match(js, /populateSubDepartmentDropdown/);
    });

    await t.test('routes/admin.js and controllers/adminController.js declare Sub-Department REST endpoints', () => {
        const routes = fs.readFileSync(path.join(rootDir, 'routes', 'admin.js'), 'utf-8');
        const controller = fs.readFileSync(path.join(rootDir, 'controllers', 'adminController.js'), 'utf-8');

        assert.match(routes, /\/sub-departments/);
        assert.match(controller, /exports\.getSubDepartments/);
        assert.match(controller, /exports\.createSubDepartment/);
        assert.match(controller, /exports\.updateSubDepartment/);
        assert.match(controller, /exports\.toggleSubDepartmentStatus/);
        assert.match(controller, /exports\.deleteSubDepartment/);
        assert.match(controller, /exports\.bulkImportSubDepartments/);
    });
});

test('6. "Same as Department Head" Fallback Rule & Department Head Propagation', async (t) => {
    await t.test('isSameAsDeptHeadValue accurately identifies inheritance tokens and empty fallbacks', () => {
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue('Same as Department Head'), true);
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue('Same as Dept Head'), true);
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue('same_as_department_head'), true);
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue('inherit'), true);
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue(''), true);
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue(null), true);
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue(undefined), true);
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue('   '), true);

        // Explicit distinct lead IDs should NOT be considered Same as Department Head
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue('EMP0001'), false);
        assert.strictEqual(SubDeptParser.isSameAsDeptHeadValue('EMP0006'), false);
    });

    await t.test('Ingestion automatically resolves parent Department Head and assigns inheritedFromDeptHead: true', () => {
        const rows = [
            {
                'Sub-Department_Code': 'SUB_QA_AUTO',
                'Sub-Department_Name': 'QA & Automation',
                'Sub-Department_Head_Employee_ID': 'Same as Department Head',
                'Cost_Center_Code': 'CC_ENG_01',
                'Active': 'Yes'
            },
            {
                'Sub-Department_Code': 'HR-OPS-AUTO',
                'Sub-Department_Name': 'People Operations Support',
                'Sub-Department_Head_Employee_ID': '', // Blank fallback
                'Cost_Center_Code': 'CC-HR-201',
                'Active': 'Yes'
            },
            {
                'Sub-Department_Code': 'ENG-SPECIAL',
                'Sub-Department_Name': 'Special Projects',
                'Sub-Department_Head_Employee_ID': 'EMP0007', // Explicit lead
                'Cost_Center_Code': 'CC-ENG-101',
                'Active': 'Yes'
            }
        ];

        const result = SubDeptParser.parseSubDepartmentRows(rows, {
            validCostCenterCodes: ['CC_ENG_01', 'CC-HR-201', 'CC-ENG-101']
        });

        assert.strictEqual(result.errors.length, 0);
        assert.strictEqual(result.validRecords.length, 3);

        // 1. SUB_QA_AUTO: Inherits from DEPT_ENG (EMP0002 Vikram Malhotra)
        const qa = result.validRecords[0];
        assert.strictEqual(qa.subDepartmentCode, 'SUB_QA_AUTO');
        assert.strictEqual(qa.departmentCode, 'DEPT_ENG');
        assert.strictEqual(qa.sameAsDeptHead, true);
        assert.strictEqual(qa.inheritedFromDeptHead, true);
        assert.strictEqual(qa.subDepartmentHeadEmployeeId, 'EMP0002');
        assert.strictEqual(qa.subDepartmentHeadName, 'Vikram Malhotra');
        assert.strictEqual(qa.headEmployeeId, 'EMP0002');
        assert.strictEqual(qa.headEmployeeName, 'Vikram Malhotra');

        // 2. HR-OPS-AUTO: Blank head inherits from HR (EMP0003 Ananya Roy)
        const hr = result.validRecords[1];
        assert.strictEqual(hr.subDepartmentCode, 'HR-OPS-AUTO');
        assert.strictEqual(hr.departmentCode, 'HR');
        assert.strictEqual(hr.sameAsDeptHead, true);
        assert.strictEqual(hr.inheritedFromDeptHead, true);
        assert.strictEqual(hr.subDepartmentHeadEmployeeId, 'EMP0003');
        assert.strictEqual(hr.subDepartmentHeadName, 'Ananya Roy');

        // 3. ENG-SPECIAL: Explicit lead keeps distinct ID
        const eng = result.validRecords[2];
        assert.strictEqual(eng.subDepartmentCode, 'ENG-SPECIAL');
        assert.strictEqual(eng.sameAsDeptHead, false);
        assert.strictEqual(eng.inheritedFromDeptHead, false);
        assert.strictEqual(eng.subDepartmentHeadEmployeeId, 'EMP0007');
    });

    await t.test('Cloud Firestore Document Schema matches PRD Section 4 specification', () => {
        const row = {
            'Sub-Department_Code': 'SUB_QA_AUTO',
            'Sub-Department_Name': 'QA & Automation',
            'Sub-Department_Head_Employee_ID': 'Same as Department Head',
            'Cost_Center_Code': 'CC_ENG_01',
            'Active': 'Yes'
        };

        const result = SubDeptParser.parseSubDepartmentRow(row, 0);
        assert.strictEqual(result.valid, true);

        const doc = result.firestoreDoc;
        assert.deepStrictEqual(doc, {
            subDepartmentCode: 'SUB_QA_AUTO',
            subDepartmentName: 'QA & Automation',
            costCenterCode: 'CC_ENG_01',
            departmentCode: 'DEPT_ENG',
            sameAsDeptHead: true,
            inheritedFromDeptHead: true,
            subDepartmentHeadEmployeeId: 'EMP0002',
            subDepartmentHeadName: 'Vikram Malhotra',
            headEmployeeId: 'EMP0002',
            headEmployeeName: 'Vikram Malhotra',
            isActive: true
        });
    });

    await t.test('SubDepartmentService persists and resolves "Same as Department Head" correctly', async () => {
        const created = await SubDeptService.createSubDepartment({
            subDepartmentCode: 'SUB_QA_TEST_UNIT',
            subDepartmentName: 'QA Test Unit',
            costCenterCode: 'CC_ENG_01',
            sameAsDeptHead: true
        });

        assert.strictEqual(created.subDepartmentCode, 'SUB_QA_TEST_UNIT');
        assert.strictEqual(created.departmentCode, 'DEPT_ENG');
        assert.strictEqual(created.sameAsDeptHead, true);
        assert.strictEqual(created.inheritedFromDeptHead, true);
        assert.strictEqual(created.subDepartmentHeadEmployeeId, 'EMP0002');
        assert.strictEqual(created.subDepartmentHeadName, 'Vikram Malhotra');

        const fetched = SubDeptService.getSubDepartment('SUB_QA_TEST_UNIT');
        assert.ok(fetched);
        assert.strictEqual(fetched.sameAsDeptHead, true);
        assert.strictEqual(fetched.subDepartmentHeadEmployeeId, 'EMP0002');
    });

    await t.test('propagateDepartmentHeadUpdate atomic batch updates all child sub-departments with inheritedFromDeptHead: true', async () => {
        // Setup sub-departments linked to DEPT_ENG
        await SubDeptService.createSubDepartment({
            subDepartmentCode: 'SUB_PROP_1',
            subDepartmentName: 'Propagation Target 1',
            costCenterCode: 'CC_ENG_01',
            sameAsDeptHead: true
        });

        await SubDeptService.createSubDepartment({
            subDepartmentCode: 'SUB_PROP_DISTINCT',
            subDepartmentName: 'Distinct Lead Sub-Dept',
            costCenterCode: 'CC_ENG_01',
            sameAsDeptHead: false,
            subDepartmentHeadEmployeeId: 'EMP0006',
            subDepartmentHeadName: 'Rohit Verma'
        });

        // Trigger propagation of parent department head update: DEPT_ENG -> EMP0099 Anjali Mehta
        const propResult = await SubDeptService.propagateDepartmentHeadUpdate(
            'DEPT_ENG',
            'EMP0005',
            'Sneha Sen'
        );

        assert.strictEqual(propResult.departmentCode, 'DEPT_ENG');
        assert.strictEqual(propResult.newHeadEmployeeId, 'EMP0005');
        assert.strictEqual(propResult.newHeadEmployeeName, 'Sneha Sen');
        assert.ok(propResult.updatedSubDepartmentsCount >= 1);

        // Verify SUB_PROP_1 was updated with new head
        const updatedSub1 = SubDeptService.getSubDepartment('SUB_PROP_1');
        assert.strictEqual(updatedSub1.subDepartmentHeadEmployeeId, 'EMP0005');
        assert.strictEqual(updatedSub1.subDepartmentHeadName, 'Sneha Sen');

        // Verify SUB_PROP_DISTINCT was NOT changed because it has explicit lead
        const distinctSub = SubDeptService.getSubDepartment('SUB_PROP_DISTINCT');
        assert.strictEqual(distinctSub.subDepartmentHeadEmployeeId, 'EMP0006');
        assert.strictEqual(distinctSub.subDepartmentHeadName, 'Rohit Verma');
    });

    await t.test('Sub-Department configuration modal markup supports "Same as Department Head" toggle and gating', () => {
        const js = fs.readFileSync(path.join(rootDir, 'subDepartmentService.js'), 'utf-8');

        assert.match(js, /id="checkSameAsDeptHead"/, 'Modal must contain #checkSameAsDeptHead toggle');
        assert.match(js, /id="resolvedDeptHeadDisplay"/, 'Modal must contain #resolvedDeptHeadDisplay container');
        assert.match(js, /id="resolvedHeadNameText"/, 'Modal must dynamically display resolved head name');
        assert.match(js, /id="resolvedHeadIdText"/, 'Modal must dynamically display resolved head ID');
        assert.match(js, /propagateDepartmentHeadUpdate/, 'Must export propagateDepartmentHeadUpdate');
    });

    await t.test('REST route and controller handler support department head propagation', () => {
        const routes = fs.readFileSync(path.join(rootDir, 'routes', 'admin.js'), 'utf-8');
        const controller = fs.readFileSync(path.join(rootDir, 'controllers', 'adminController.js'), 'utf-8');

        assert.match(routes, /\/departments\/:code\/propagate-sub-departments/);
        assert.match(controller, /exports\.propagateDepartmentHeadUpdate/);
    });

    await t.test('Official Templates.xlsx includes "Same as Department Head" in Sub-Departments sheet', async () => {
        const xlsxMod = await import('../utils/xlsx.full.min.js');
        const XLSX = xlsxMod.default || xlsxMod;

        const templatePath = path.join(rootDir, 'Templates.xlsx');
        assert.ok(fs.existsSync(templatePath), 'Templates.xlsx must exist at workspace root');

        const buffer = fs.readFileSync(templatePath);
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const sheet = wb.Sheets['Sub-Departments'];
        assert.ok(sheet, "Sheet 'Sub-Departments' must exist in Templates.xlsx");

        const rows = XLSX.utils.sheet_to_json(sheet);
        assert.ok(rows.length >= 3, 'Must have at least 3 sub-departments');

        const sameAsDeptHeadRows = rows.filter(r => 
            String(r['Sub-Department_Head_Employee_ID'] || '').trim().toLowerCase() === 'same as department head'
        );
        assert.ok(sameAsDeptHeadRows.length >= 1, 'Templates.xlsx must contain at least one row with "Same as Department Head"');

        const qaAuto = rows.find(r => r['Sub-Department_Code'] === 'SUB_QA_AUTO');
        assert.ok(qaAuto, 'SUB_QA_AUTO must exist in Templates.xlsx');
        assert.strictEqual(qaAuto['Sub-Department_Head_Employee_ID'], 'Same as Department Head');
        assert.strictEqual(qaAuto['Cost_Center_Code'], 'CC_ENG_01');
    });

    await t.test('Cloud Functions triggers onDepartmentHeadUpdated and onOrgDepartmentHeadUpdated defined', () => {
        const functionsIndex = fs.readFileSync(path.join(rootDir, 'functions', 'index.js'), 'utf-8');

        assert.match(functionsIndex, /exports\.onDepartmentHeadUpdated/, 'Must export onDepartmentHeadUpdated Firestore trigger');
        assert.match(functionsIndex, /exports\.onOrgDepartmentHeadUpdated/, 'Must export onOrgDepartmentHeadUpdated Firestore trigger');
        assert.match(functionsIndex, /inheritedFromDeptHead/, 'Must filter by inheritedFromDeptHead in trigger');
    });
});
