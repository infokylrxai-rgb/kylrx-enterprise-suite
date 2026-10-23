import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const XLSX = require(path.join(rootDir, 'utils', 'xlsx.full.min.js'));
const workflowRulesParser = require(path.join(rootDir, 'workflowRulesParser.js'));
const workflowExecutionEngine = require(path.join(rootDir, 'workflowExecutionEngine.js'));
const workflowFlowDesigner = require(path.join(rootDir, 'workflowFlowDesigner.js'));

test('PRD Sections 1, 9, 12, 14, & 18: Workflow Automation & Multi-Step Approval Engine Suite', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (All 10 Attributes)', async () => {
        const rawRow = {
            Workflow_Code: "WF_LEAVE_STD",
            Module: "Leave",
            Transaction_Type: "Leave_Application",
            Step_No: 1,
            Approver_Type: "Reporting_Manager",
            Approver_Employee_ID: "",
            Approver_Role_Code: "",
            SLA_Hours: 24,
            Mandatory: "Yes",
            Active: "Yes"
        };

        const parsed = workflowRulesParser.parseWorkflowRulesSheet([rawRow]);
        assert.equal(parsed.success, true, 'Parsing should succeed');
        assert.equal(parsed.totalRows, 1, 'Should parse 1 row');
        const rec = parsed.records[0];

        // 1. Workflow_Code
        assert.equal(rec.workflowCode, "WF_LEAVE_STD", "Attribute 1: Workflow_Code");
        // 2. Module
        assert.equal(rec.module, "Leave", "Attribute 2: Module");
        // 3. Transaction_Type
        assert.equal(rec.transactionType, "Leave_Application", "Attribute 3: Transaction_Type");
        // 4. Step_No
        assert.equal(rec.stepNo, 1, "Attribute 4: Step_No");
        // 5. Approver_Type
        assert.equal(rec.approverType, "Reporting_Manager", "Attribute 5: Approver_Type");
        // 6. Approver_Employee_ID
        assert.equal(rec.approverEmployeeId, null, "Attribute 6: Approver_Employee_ID");
        // 7. Approver_Role_Code
        assert.equal(rec.approverRoleCode, null, "Attribute 7: Approver_Role_Code");
        // 8. SLA_Hours
        assert.equal(rec.slaHours, 24, "Attribute 8: SLA_Hours");
        // 9. Mandatory
        assert.equal(rec.isMandatory, true, "Attribute 9: Mandatory");
        // 10. Active
        assert.equal(rec.isActive, true, "Attribute 10: Active");
    });

    await t.test('2. Setup & Ingestion Support (SheetJS & Templates.xlsx Verification)', async () => {
        const templatePath = path.join(rootDir, 'assets', 'Templates.xlsx');
        assert.ok(fs.existsSync(templatePath), 'Templates.xlsx must exist');

        const buf = fs.readFileSync(templatePath);
        const wb = XLSX.read(buf, { type: 'buffer' });

        const sheetName = workflowRulesParser.findWorkflowRulesSheet(wb);
        assert.ok(sheetName, "Must find 'Workflow Rules' sheet in Templates.xlsx");

        const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
        assert.ok(rawRows.length >= 10, `Should contain at least 10 sample workflow steps, got ${rawRows.length}`);

        const result = workflowRulesParser.parseWorkflowRulesSheet(rawRows, {
            employees: ['EMP0001', 'EMP0002', 'EMP0003', 'EMP0004', 'EMP0005', 'EMP0012'],
            roles: ['ROLE_SUPER_ADMIN', 'ROLE_HRMS', 'ROLE_MANAGER', 'ROLE_EMPLOYEE', 'ROLE_FINANCE', 'ROLE_HR_EXEC']
        });

        assert.equal(result.success, true, 'Parsing official Templates.xlsx must succeed with 0 errors');
        assert.ok(result.workflowDocuments.length >= 5, 'Should produce at least 5 structured workflow documents');

        // Check document schema
        const leaveWf = result.workflowDocuments.find(w => w.workflowCode === 'WF_LEAVE_STD');
        assert.ok(leaveWf, 'WF_LEAVE_STD must exist');
        assert.equal(leaveWf.module, 'Leave');
        assert.equal(leaveWf.transactionType, 'Leave_Application');
        assert.equal(leaveWf.steps.length, 2);
        assert.equal(leaveWf.steps[0].stepNo, 1);
        assert.equal(leaveWf.steps[0].approverType, 'Reporting_Manager');
        assert.equal(leaveWf.steps[1].stepNo, 2);
        assert.equal(leaveWf.steps[1].approverType, 'Role_Based');
        assert.equal(leaveWf.steps[1].approverRoleCode, 'ROLE_HR_EXEC');
    });

    await t.test('3. Sequence Continuity & Foreign Key Validation', async () => {
        // Test missing Step 1 (starts at Step 2)
        const brokenStartRows = [
            {
                Workflow_Code: "WF_BROKEN_START",
                Module: "Leave",
                Transaction_Type: "Test",
                Step_No: 2,
                Approver_Type: "Reporting_Manager",
                SLA_Hours: 24,
                Mandatory: "Yes",
                Active: "Yes"
            }
        ];
        const resBrokenStart = workflowRulesParser.parseWorkflowRulesSheet(brokenStartRows);
        assert.equal(resBrokenStart.success, false, 'Should fail when step sequence does not start at 1');
        assert.ok(resBrokenStart.errors.some(e => e.includes('must begin at Step 1')));

        // Test non-monotonic sequence gap (Step 1, Step 3)
        const brokenGapRows = [
            {
                Workflow_Code: "WF_BROKEN_GAP",
                Module: "Attendance",
                Transaction_Type: "Regularization",
                Step_No: 1,
                Approver_Type: "Reporting_Manager",
                SLA_Hours: 24,
                Mandatory: "Yes",
                Active: "Yes"
            },
            {
                Workflow_Code: "WF_BROKEN_GAP",
                Module: "Attendance",
                Transaction_Type: "Regularization",
                Step_No: 3,
                Approver_Type: "Department_Head",
                SLA_Hours: 24,
                Mandatory: "Yes",
                Active: "Yes"
            }
        ];
        const resBrokenGap = workflowRulesParser.parseWorkflowRulesSheet(brokenGapRows);
        assert.equal(resBrokenGap.success, false, 'Should fail when step sequence has gaps');
        assert.ok(resBrokenGap.errors.some(e => e.includes('Broken sequence continuity')));

        // Test foreign key validation
        const missingSpecificEmp = [
            {
                Workflow_Code: "WF_FK_TEST",
                Module: "Payroll",
                Transaction_Type: "Revision",
                Step_No: 1,
                Approver_Type: "Specific_Employee",
                Approver_Employee_ID: "",
                SLA_Hours: 24,
                Mandatory: "Yes",
                Active: "Yes"
            }
        ];
        const resMissingEmp = workflowRulesParser.parseWorkflowRulesSheet(missingSpecificEmp);
        assert.equal(resMissingEmp.success, false, 'Should fail if Specific_Employee has no ID');
        assert.ok(resMissingEmp.errors.some(e => e.includes('Approver_Employee_ID is mandatory')));

        const missingRoleCode = [
            {
                Workflow_Code: "WF_FK_TEST_2",
                Module: "Payroll",
                Transaction_Type: "Revision",
                Step_No: 1,
                Approver_Type: "Role_Based",
                Approver_Role_Code: "",
                SLA_Hours: 24,
                Mandatory: "Yes",
                Active: "Yes"
            }
        ];
        const resMissingRole = workflowRulesParser.parseWorkflowRulesSheet(missingRoleCode);
        assert.equal(resMissingRole.success, false, 'Should fail if Role_Based has no Role Code');
        assert.ok(resMissingRole.errors.some(e => e.includes('Approver_Role_Code is mandatory')));
    });

    await t.test('4. Dynamic Approver Entity Resolution (All 5 Approver Types)', async () => {
        const initiator = {
            employeeId: 'EMP0010',
            reportingManagerId: 'EMP0002',
            secondaryManagerId: 'EMP0001',
            departmentId: 'DEPT_ENG',
            departmentHeadId: 'EMP0003'
        };

        const directory = {
            departments: [
                { departmentCode: 'DEPT_ENG', departmentHeadEmployeeId: 'EMP0003' }
            ],
            users: [
                { employeeId: 'EMP0006', roleCode: 'ROLE_FINANCE', active: true }
            ]
        };

        // 1. Reporting_Manager
        const resL1 = workflowExecutionEngine.resolveApproverEntity({ approverType: 'Reporting_Manager' }, initiator);
        assert.equal(resL1.targetId, 'EMP0002');
        assert.equal(resL1.isResolved, true);

        // 2. Secondary_Manager
        const resL2 = workflowExecutionEngine.resolveApproverEntity({ approverType: 'Secondary_Manager' }, initiator);
        assert.equal(resL2.targetId, 'EMP0001');
        assert.equal(resL2.isResolved, true);

        // 3. Department_Head
        const resHod = workflowExecutionEngine.resolveApproverEntity({ approverType: 'Department_Head' }, initiator, directory);
        assert.equal(resHod.targetId, 'EMP0003');
        assert.equal(resHod.isResolved, true);

        // 4. Specific_Employee
        const resSpecific = workflowExecutionEngine.resolveApproverEntity({ approverType: 'Specific_Employee', approverEmployeeId: 'EMP0012' }, initiator);
        assert.equal(resSpecific.targetId, 'EMP0012');
        assert.equal(resSpecific.isResolved, true);

        // 5. Role_Based
        const resRole = workflowExecutionEngine.resolveApproverEntity({ approverType: 'Role_Based', approverRoleCode: 'ROLE_FINANCE' }, initiator, directory);
        assert.equal(resRole.targetId, 'ROLE_FINANCE');
        assert.ok(resRole.candidateIds.includes('EMP0006'));
    });

    await t.test('5. Anti-Cycle & Self-Approval Prevention Engine', async () => {
        // Initiator EMP0002 is their own reporting manager
        const managerInitiator = {
            employeeId: 'EMP0002',
            reportingManagerId: 'EMP0002',
            secondaryManagerId: 'EMP0001',
            departmentId: 'DEPT_ENG',
            departmentHeadId: 'EMP0003'
        };

        const rawRes = workflowExecutionEngine.resolveApproverEntity({ approverType: 'Reporting_Manager' }, managerInitiator);
        assert.equal(rawRes.targetId, 'EMP0002', 'Raw resolution points to self');

        const antiCycle = workflowExecutionEngine.evaluateAntiCycle(rawRes, managerInitiator);
        assert.equal(antiCycle.isSelfApproval, true, 'Must detect self-approval condition');
        assert.equal(antiCycle.isEscalated, true, 'Must auto-escalate');
        assert.equal(antiCycle.finalTargetId, 'EMP0001', 'Must escalate to Secondary Manager (EMP0001)');
        assert.ok(antiCycle.reason.includes('cannot approve own request'));

        // If no Secondary Manager exists, escalate to Department Head or Super Admin
        const hodInitiator = {
            employeeId: 'EMP0001',
            reportingManagerId: 'EMP0001',
            secondaryManagerId: '',
            departmentHeadId: 'EMP0001'
        };
        const rawRes2 = workflowExecutionEngine.resolveApproverEntity({ approverType: 'Reporting_Manager' }, hodInitiator);
        const antiCycle2 = workflowExecutionEngine.evaluateAntiCycle(rawRes2, hodInitiator);
        assert.equal(antiCycle2.isSelfApproval, true);
        assert.equal(antiCycle2.finalTargetId, 'ROLE_SUPER_ADMIN', 'Should fall back to Super Admin queue');
    });

    await t.test('6. Multi-Step Execution State Machine, Delegation, & Immutable Audit Trail', async () => {
        const wfDoc = {
            workflowCode: "WF_TEST_MULTI",
            module: "Leave",
            transactionType: "Leave_Application",
            steps: [
                { stepNo: 1, approverType: "Reporting_Manager", slaHours: 24, isMandatory: true },
                { stepNo: 2, approverType: "Role_Based", approverRoleCode: "ROLE_HR_EXEC", slaHours: 48, isMandatory: true }
            ]
        };

        const initiator = {
            employeeId: 'EMP0010',
            reportingManagerId: 'EMP0002',
            secondaryManagerId: 'EMP0001'
        };

        // 1. Initiate workflow
        const instance = workflowExecutionEngine.initiateWorkflowInstance(wfDoc, initiator, { days: 3 });
        assert.equal(instance.status, 'IN_PROGRESS');
        assert.equal(instance.currentStepNo, 1);
        assert.equal(instance.currentStepDefinition.assignedApproverId, 'EMP0002');
        assert.ok(instance.slaDeadline);

        // 2. Delegate Step 1 to EMP0003
        const delegations = [
            { delegatedBy: 'EMP0002', delegatedTo: 'EMP0003', isActive: true }
        ];

        // 3. Process Step 1 approval by delegated proxy EMP0003
        const step1Approved = workflowExecutionEngine.processStepAction(
            instance,
            1,
            { employeeId: 'EMP0003' },
            'APPROVED',
            'Approved on behalf of manager',
            { workflowDoc: wfDoc, delegations }
        );

        assert.equal(step1Approved.currentStepNo, 2, 'Should advance to step 2');
        assert.equal(step1Approved.status, 'IN_PROGRESS');
        assert.equal(step1Approved.currentStepDefinition.assignedApproverId, 'ROLE_HR_EXEC');

        // Check Step 1 audit trail entry
        const step1Audit = step1Approved.auditTrail.find(a => a.stepNo === 1);
        assert.ok(step1Audit, 'Step 1 audit entry must exist');
        assert.equal(step1Audit.action, 'APPROVED');
        assert.equal(step1Audit.actorId, 'EMP0003');
        assert.equal(step1Audit.originalApproverId, 'EMP0002');
        assert.equal(step1Audit.delegatedTo, 'EMP0003');

        // 4. Process Step 2 approval by HR Executive
        const step2Approved = workflowExecutionEngine.processStepAction(
            step1Approved,
            2,
            { employeeId: 'EMP0007', roleCode: 'ROLE_HR_EXEC' },
            'APPROVED',
            'Final HR approval granted',
            { workflowDoc: wfDoc }
        );

        assert.equal(step2Approved.status, 'APPROVED', 'Workflow should be fully approved');
        assert.ok(step2Approved.completedAt, 'completedAt timestamp must be recorded');
        assert.equal(step2Approved.auditTrail.length, 3, 'Initial + 2 steps = 3 audit records');
    });

    await t.test('7. SLA Tracking & Automated Escalation Alerts', async () => {
        const now = Date.now();
        const pastDeadline = new Date(now - 2 * 3600 * 1000).toISOString(); // 2 hours ago
        const warningDeadline = new Date(now + 1 * 3600 * 1000).toISOString(); // 1 hour left
        const safeDeadline = new Date(now + 20 * 3600 * 1000).toISOString(); // 20 hours left

        const breachedStatus = workflowExecutionEngine.evaluateSLAStatus({ slaDeadline: pastDeadline, slaHours: 24 }, now);
        assert.equal(breachedStatus.isBreached, true);
        assert.equal(breachedStatus.statusBadge, 'BREACHED');
        assert.equal(breachedStatus.hoursOverdue, 2);

        const warningStatus = workflowExecutionEngine.evaluateSLAStatus({ slaDeadline: warningDeadline, slaHours: 24 }, now, 4);
        assert.equal(warningStatus.isBreached, false);
        assert.equal(warningStatus.isWarning, true);
        assert.equal(warningStatus.statusBadge, 'WARNING');

        const safeStatus = workflowExecutionEngine.evaluateSLAStatus({ slaDeadline: safeDeadline, slaHours: 24 }, now, 4);
        assert.equal(safeStatus.isBreached, false);
        assert.equal(safeStatus.isWarning, false);
        assert.equal(safeStatus.statusBadge, 'ON_TRACK');

        // Scan and trigger escalation hooks
        const instances = [
            {
                instanceId: 'INST_1',
                workflowCode: 'WF_1',
                status: 'IN_PROGRESS',
                slaDeadline: pastDeadline,
                slaHours: 24,
                currentStepNo: 1
            },
            {
                instanceId: 'INST_2',
                workflowCode: 'WF_2',
                status: 'IN_PROGRESS',
                slaDeadline: warningDeadline,
                slaHours: 24,
                currentStepNo: 1
            }
        ];

        let escalationTriggered = 0;
        const scanRes = workflowExecutionEngine.scanAndEscalateSLAs(instances, now, (payload) => {
            escalationTriggered++;
            assert.ok(payload.event === 'SLA_BREACHED' || payload.event === 'SLA_WARNING');
        });

        assert.equal(scanRes.breachedTasks.length, 1);
        assert.equal(scanRes.warningTasks.length, 1);
        assert.equal(escalationTriggered, 2, 'Should fire 2 escalation alerts');
    });

    await t.test('8. HTML & DOM Wiring Verification', async () => {
        const uploadHtmlPath = path.join(rootDir, 'admin-onboarding-upload.html');
        assert.ok(fs.existsSync(uploadHtmlPath), 'admin-onboarding-upload.html must exist');
        const uploadHtml = fs.readFileSync(uploadHtmlPath, 'utf8');

        assert.ok(uploadHtml.includes('id="workflowRulesParseResultsContainer"'), "Must contain workflowRulesParseResultsContainer");
        assert.ok(uploadHtml.includes('id="wfTotalStepRowsDisplay"'), "Must contain wfTotalStepRowsDisplay");
        assert.ok(uploadHtml.includes('id="wfTotalWorkflowsDisplay"'), "Must contain wfTotalWorkflowsDisplay");
        assert.ok(uploadHtml.includes('id="wfCanvasPreviewContainer"'), "Must contain wfCanvasPreviewContainer");
        assert.ok(uploadHtml.includes('workflowRulesParser.js'), "Must load workflowRulesParser.js");
        assert.ok(uploadHtml.includes('workflowExecutionEngine.js'), "Must load workflowExecutionEngine.js");
        assert.ok(uploadHtml.includes('workflowFlowDesigner.js'), "Must load workflowFlowDesigner.js");

        const uploadJsPath = path.join(rootDir, 'admin-onboarding-upload.js');
        const uploadJs = fs.readFileSync(uploadJsPath, 'utf8');
        assert.ok(uploadJs.includes('extract10WorkflowRulesAttributesFromSheetRows'), "Must implement extract10WorkflowRulesAttributesFromSheetRows");
        assert.ok(uploadJs.includes('renderParsedWorkflowRulesPreview'), "Must implement renderParsedWorkflowRulesPreview");
        assert.ok(uploadJs.includes('executeWorkflowRulesIngest'), "Must implement executeWorkflowRulesIngest");

        const firestoreRulesPath = path.join(rootDir, 'firestore.rules');
        const firestoreRules = fs.readFileSync(firestoreRulesPath, 'utf8');
        assert.ok(firestoreRules.includes('match /workflows/{workflowCode}'), "Must secure /workflows/{workflowCode}");
        assert.ok(firestoreRules.includes('match /workflow_instances/{instanceId}'), "Must secure /workflow_instances/{instanceId}");
    });
});
