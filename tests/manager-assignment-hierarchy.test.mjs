import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('PRD Section 14: Manual L1 and L2 Manager Assignment Subsystem', () => {

    describe('1. Cycle Prevention Algorithm & Manager Assignment Service', async () => {
        const serviceModule = await import('../services/manager-assignment-service.js');
        const service = serviceModule.default || serviceModule;

        const mockEmployees = [
            {
                employeeId: 'EMP0001',
                fullName: 'Vikram Singh (CEO / Director)',
                reportingManagerId: '',
                secondaryManagerId: ''
            },
            {
                employeeId: 'EMP0002',
                fullName: 'Sarah Connor (VP Eng)',
                reportingManagerId: 'EMP0001',
                secondaryManagerId: ''
            },
            {
                employeeId: 'EMP0003',
                fullName: 'Rahul Sharma (Engineering Manager)',
                reportingManagerId: 'EMP0002',
                secondaryManagerId: 'EMP0001'
            },
            {
                employeeId: 'EMP0004',
                fullName: 'Priya Patel (Senior Developer)',
                reportingManagerId: 'EMP0003',
                secondaryManagerId: 'EMP0002'
            },
            {
                employeeId: 'EMP0005',
                fullName: 'Amit Kumar (Junior Developer)',
                reportingManagerId: 'EMP0004',
                secondaryManagerId: 'EMP0003'
            }
        ];

        test('Rejects self-assignment as reporting manager', () => {
            const check = service.validateAssignment('EMP0003', 'EMP0003', 'L1', mockEmployees);
            assert.equal(check.valid, false);
            assert.match(check.error, /Self-reporting prohibited/i);
        });

        test('Rejects direct subordinate as manager (circular reporting)', () => {
            // EMP0004 directly reports to EMP0003. EMP0003 cannot pick EMP0004 as manager!
            const check = service.validateAssignment('EMP0003', 'EMP0004', 'L1', mockEmployees);
            assert.equal(check.valid, false);
            assert.match(check.error, /Circular reporting detected/i);
        });

        test('Rejects transitive / indirect subordinate as manager', () => {
            // EMP0005 reports to EMP0004 who reports to EMP0003 who reports to EMP0002.
            // EMP0002 cannot select EMP0005 as manager!
            const check = service.validateAssignment('EMP0002', 'EMP0005', 'L1', mockEmployees);
            assert.equal(check.valid, false);
            assert.match(check.error, /Circular reporting detected/i);
        });

        test('Detects upstream reporting cycle leading back to employee', () => {
            // A -> B -> C -> A
            const circularTeam = [
                { employeeId: 'A', reportingManagerId: 'B' },
                { employeeId: 'B', reportingManagerId: 'C' },
                { employeeId: 'C', reportingManagerId: '' }
            ];
            // Assigning A as manager of C would form C -> A -> B -> C
            const check = service.validateAssignment('C', 'A', 'L1', circularTeam);
            assert.equal(check.valid, false);
            assert.match(check.error, /Circular/i);
        });

        test('Allows valid, non-circular manager assignment', () => {
            // EMP0005 can report to EMP0002 (skip level)
            const check = service.validateAssignment('EMP0005', 'EMP0002', 'L1', mockEmployees);
            assert.equal(check.valid, true);
        });

        test('Allows unassigned/empty manager (clearing manager)', () => {
            const checkEmpty = service.validateAssignment('EMP0004', '', 'L1', mockEmployees);
            assert.equal(checkEmpty.valid, true);

            const checkNone = service.validateAssignment('EMP0004', 'NONE', 'L2', mockEmployees);
            assert.equal(checkNone.valid, true);
        });
    });

    describe('2. Audit History & Firestore Payload Preparation', async () => {
        const serviceModule = await import('../services/manager-assignment-service.js');
        const service = serviceModule.default || serviceModule;

        test('Formats audit log entries recording level, oldManagerId, newManagerId, assignedBy, timestamp', () => {
            const entry = service.createAuditEntry({
                level: 'L1',
                oldManagerId: 'EMP0009',
                newManagerId: 'EMP0004',
                changedBy: 'superadmin_uid',
                timestamp: '2026-09-29T10:00:00.000Z'
            });

            assert.equal(entry.level, 'L1');
            assert.equal(entry.oldManagerId, 'EMP0009');
            assert.equal(entry.newManagerId, 'EMP0004');
            assert.equal(entry.changedBy, 'superadmin_uid');
            assert.equal(entry.changedAt, '2026-09-29T10:00:00.000Z');
        });

        test('Prepares Firestore update payload with history and generates audit records', () => {
            const currentEmployee = {
                employeeId: 'EMP0025',
                fullName: 'Priya Patel',
                reportingManagerId: 'EMP0009',
                secondaryManagerId: 'EMP0002',
                managerAssignmentHistory: []
            };

            const updateResult = service.prepareAssignmentUpdate(currentEmployee, {
                l1ManagerId: 'EMP0004',
                l2ManagerId: 'EMP0002', // unchanged
                changedBy: 'admin_uid'
            });

            assert.equal(updateResult.hasChanged, true);
            assert.equal(updateResult.payload.reportingManagerId, 'EMP0004');
            assert.equal(updateResult.payload.managers.l1ManagerId, 'EMP0004');
            assert.equal(updateResult.payload.secondaryManagerId, 'EMP0002');
            assert.equal(updateResult.payload.managerAssignmentHistory.length, 1);
            assert.equal(updateResult.payload.managerAssignmentHistory[0].level, 'L1');
            assert.equal(updateResult.payload.managerAssignmentHistory[0].oldManagerId, 'EMP0009');
            assert.equal(updateResult.payload.managerAssignmentHistory[0].newManagerId, 'EMP0004');

            // Global audit entries
            assert.equal(updateResult.auditEntries.length, 1);
            assert.equal(updateResult.auditEntries[0].employeeId, 'EMP0025');
            assert.equal(updateResult.auditEntries[0].managerLevel, 'L1');
            assert.equal(updateResult.auditEntries[0].previousManagerId, 'EMP0009');
            assert.equal(updateResult.auditEntries[0].newManagerId, 'EMP0004');
            assert.equal(updateResult.auditEntries[0].action, 'MANAGER_ASSIGNMENT_CHANGED');
        });

        test('Builds hierarchical organizational chart tree', () => {
            const team = [
                { employeeId: 'E1', fullName: 'CEO', reportingManagerId: '' },
                { employeeId: 'E2', fullName: 'VP Eng', reportingManagerId: 'E1' },
                { employeeId: 'E3', fullName: 'Dev Lead', reportingManagerId: 'E2' }
            ];

            const tree = service.buildOrgTree(team);
            assert.equal(tree.length, 1);
            assert.equal(tree[0].employeeId, 'E1');
            assert.equal(tree[0].children.length, 1);
            assert.equal(tree[0].children[0].employeeId, 'E2');
            assert.equal(tree[0].children[0].children.length, 1);
            assert.equal(tree[0].children[0].children[0].employeeId, 'E3');
        });
    });

    describe('3. Super Admin Assignment UI in admin-dashboard.html', () => {
        const dashboardHtml = fs.readFileSync(path.join(rootDir, 'admin-dashboard.html'), 'utf-8');

        test('Contains dedicated Super Admin Manager Assignment Modal (#managerAssignmentModal)', () => {
            assert.match(dashboardHtml, /id="managerAssignmentModal"/);
            assert.match(dashboardHtml, /id="mgrAssignEmpName"/);
            assert.match(dashboardHtml, /id="mgrAssignEmpId"/);
            assert.match(dashboardHtml, /id="mgrAssignEmpAvatar"/);
            assert.match(dashboardHtml, /id="mgrAssignL1Select"/);
            assert.match(dashboardHtml, /id="mgrAssignL2Select"/);
            assert.match(dashboardHtml, /id="mgrAssignValidationNotice"/);
            assert.match(dashboardHtml, /id="mgrAssignHistoryContainer"/);
            assert.match(dashboardHtml, /id="btnSaveManagerAssignment"/);
        });

        test('Contains Org Chart Modal (#orgChartModal) and toolbar launcher button', () => {
            assert.match(dashboardHtml, /id="orgChartModal"/);
            assert.match(dashboardHtml, /id="orgChartContainer"/);
            assert.match(dashboardHtml, /id="btnOpenOrgChart"/);
            assert.match(dashboardHtml, /ManagerAssignmentController\.openOrgChartModal\(\)/);
        });

        test('Directory table contains Reporting Hierarchy column and script tag', () => {
            assert.match(dashboardHtml, /Reporting Hierarchy \(L1 \/ L2\)/);
            assert.match(dashboardHtml, /<script src="manager-assignment-controller\.js"><\/script>/);
        });
    });

    describe('4. ES6 Frontend Controller (manager-assignment-controller.js)', () => {
        const controllerCode = fs.readFileSync(path.join(rootDir, 'manager-assignment-controller.js'), 'utf-8');

        test('Exports required controller methods', () => {
            assert.match(controllerCode, /openAssignmentModal/);
            assert.match(controllerCode, /closeAssignmentModal/);
            assert.match(controllerCode, /saveAssignment/);
            assert.match(controllerCode, /openOrgChartModal/);
            assert.match(controllerCode, /closeOrgChartModal/);
            assert.match(controllerCode, /validateManagerSelection/);
            assert.match(controllerCode, /getSubordinateIds/);
            assert.match(controllerCode, /getManagerDisplayString/);
        });

        test('Implements circular reporting detection on the client', () => {
            assert.match(controllerCode, /An employee cannot be selected as their own reporting manager/);
            assert.match(controllerCode, /Circular reporting detected/);
            assert.match(controllerCode, /Subordinate - Circular/);
            assert.match(controllerCode, /Self - Prohibited/);
        });

        test('Performs atomic write to Firestore and appends audit trail', () => {
            assert.match(controllerCode, /employees/);
            assert.match(controllerCode, /users/);
            assert.match(controllerCode, /audit_logs/);
            assert.match(controllerCode, /managerAssignmentHistory/);
            assert.match(controllerCode, /MANAGER_ASSIGNMENT_CHANGED/);
        });
    });

    describe('5. REST API Routes and Controllers', () => {
        const routesCode = fs.readFileSync(path.join(rootDir, 'routes', 'admin.js'), 'utf-8');
        const adminControllerCode = fs.readFileSync(path.join(rootDir, 'controllers', 'adminController.js'), 'utf-8');

        test('Routes declare manager and org-chart endpoints', () => {
            assert.match(routesCode, /router\.get\("\/employees\/:id\/managers",\s*adminController\.getEmployeeManagers\)/);
            assert.match(routesCode, /router\.put\("\/employees\/:id\/managers",\s*adminController\.updateEmployeeManagers\)/);
            assert.match(routesCode, /router\.get\("\/org-chart",\s*adminController\.getOrgChart\)/);
        });

        test('adminController implements getEmployeeManagers, updateEmployeeManagers, and getOrgChart', () => {
            assert.match(adminControllerCode, /exports\.getEmployeeManagers\s*=/);
            assert.match(adminControllerCode, /exports\.updateEmployeeManagers\s*=/);
            assert.match(adminControllerCode, /exports\.getOrgChart\s*=/);
            assert.match(adminControllerCode, /managerAssignmentService\.validateAssignment/);
            assert.match(adminControllerCode, /managerAssignmentService\.prepareAssignmentUpdate/);
        });
    });

    describe('6. Real-time Directory Table Reflection in admin-app.js', () => {
        const adminAppCode = fs.readFileSync(path.join(rootDir, 'admin-app.js'), 'utf-8');

        test('renderEmployeeTable displays L1 and L2 badges with Name and ID', () => {
            assert.match(adminAppCode, /badge-manager-l1/);
            assert.match(adminAppCode, /badge-manager-l2/);
            assert.match(adminAppCode, /resolveMgrDisplay/);
        });

        test('renderEmployeeTable includes Assign Managers action button', () => {
            assert.match(adminAppCode, /window\.ManagerAssignmentController/);
            assert.match(adminAppCode, /openAssignmentModal/);
        });
    });

    describe('7. Firestore Security Rules', () => {
        const firestoreRules = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf-8');

        test('firestore.rules protects employees collection and audit_logs', () => {
            assert.match(firestoreRules, /match\s+\/employees\/\{employeeId\}/);
            assert.match(firestoreRules, /match\s+\/audit_logs\/\{logId\}/);
        });
    });
});
