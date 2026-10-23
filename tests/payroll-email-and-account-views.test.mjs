import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import payrollService from '../services/payroll-email-account-service.js';

describe('3. Payroll, Email and Account Views Suite (PRD §3)', () => {

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.1 PAYROLL SETUP (PRD §3.1)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('3.1 Payroll Setup & Rules Configuration', () => {

        test('3.1.1 Authorisation: Only authorised HR or payroll roles can open and configure payroll settings', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };
            const adminActor = { id: 'ADM-01', name: 'Super Admin', role: 'super_admin' };
            const employeeActor = { id: 'EMP-01', name: 'Regular Staff', role: 'employee' };
            const managerActor = { id: 'MGR-01', name: 'Dept Manager', role: 'manager' };

            // HR and Super Admin succeed
            assert.equal(payrollService.verifyPayrollConfigurationAuthority(hrActor), true);
            assert.equal(payrollService.verifyPayrollConfigurationAuthority(adminActor), true);

            // Employee and Manager are blocked
            assert.throws(() => {
                payrollService.verifyPayrollConfigurationAuthority(employeeActor);
            }, /Permission Denied: Role 'employee' is not authorised to configure payroll settings/);

            assert.throws(() => {
                payrollService.verifyPayrollConfigurationAuthority(managerActor);
            }, /Permission Denied: Role 'manager' is not authorised to configure payroll settings/);
        });

        test('3.1.2 Event Selection: Validates supported payroll events and rejects unrecognized triggers', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };

            // Valid event
            const validRule = payrollService.createPayrollRule({
                name: 'Laptop Asset Loan Reminder',
                event: 'payroll.deduction_scheduled',
                timing: { referenceDateType: 'deduction_effective_date', offsetDays: -3 },
                templateId: 'TPL-PAY-DEDUCT-01',
                recipients: { selector: 'cohort', permittedRoles: ['employee'] }
            }, hrActor);

            assert.ok(validRule.id);
            assert.equal(validRule.event, 'payroll.deduction_scheduled');

            // Invalid event rejected
            assert.throws(() => {
                payrollService.createPayrollRule({
                    name: 'Invalid Rule',
                    event: 'unsupported.random_event',
                    timing: { referenceDateType: 'deduction_effective_date', offsetDays: -1 },
                    templateId: 'TPL-PAY-DEDUCT-01',
                    recipients: { selector: 'cohort', permittedRoles: ['employee'] }
                }, hrActor);
            }, /Invalid payroll event 'unsupported.random_event'/);
        });

        test('3.1.3 Timing & Date Configuration: Validates reference date type and numeric offset days', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };

            // Missing offsetDays
            assert.throws(() => {
                payrollService.createPayrollRule({
                    name: 'Bad Timing Rule',
                    event: 'payroll.deduction_scheduled',
                    timing: { referenceDateType: 'deduction_effective_date' }, // missing offsetDays
                    templateId: 'TPL-PAY-DEDUCT-01',
                    recipients: { selector: 'cohort', permittedRoles: ['employee'] }
                }, hrActor);
            }, /Timing configuration requires valid numeric offsetDays/);

            // Invalid referenceDateType
            assert.throws(() => {
                payrollService.createPayrollRule({
                    name: 'Bad Ref Rule',
                    event: 'payroll.deduction_scheduled',
                    timing: { referenceDateType: 'invalid_calendar_type', offsetDays: -2 },
                    templateId: 'TPL-PAY-DEDUCT-01',
                    recipients: { selector: 'cohort', permittedRoles: ['employee'] }
                }, hrActor);
            }, /Timing referenceDateType must be one of/);
        });

        test('3.1.4 Approved Email Template Selection: Only approved templates can be linked; unapproved rejected', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };

            // Missing template
            assert.throws(() => {
                payrollService.createPayrollRule({
                    name: 'No Template Rule',
                    event: 'payroll.deduction_scheduled',
                    timing: { referenceDateType: 'deduction_effective_date', offsetDays: -3 },
                    templateId: 'NON_EXISTENT_TEMPLATE_ID',
                    recipients: { selector: 'cohort', permittedRoles: ['employee'] }
                }, hrActor);
            }, /Email template 'NON_EXISTENT_TEMPLATE_ID' not found in registry/);

            // Valid approved template links successfully
            const rule = payrollService.createPayrollRule({
                name: 'Salary Credit Advice Rule',
                event: 'payroll.salary_credited',
                timing: { referenceDateType: 'salary_disbursement_date', offsetDays: 0 },
                templateId: 'TPL-PAY-ADVICE-02',
                recipients: { selector: 'all_employees', permittedRoles: ['employee'] }
            }, hrActor);

            assert.equal(rule.templateId, 'TPL-PAY-ADVICE-02');
            assert.equal(rule.templateSnapshot.approvedBy, 'Head of Payroll');
        });

        test('3.1.5 Permitted Recipients: Enforces selector and authorized target roles', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };

            assert.throws(() => {
                payrollService.createPayrollRule({
                    name: 'Empty Recipients Rule',
                    event: 'payroll.deduction_scheduled',
                    timing: { referenceDateType: 'deduction_effective_date', offsetDays: -3 },
                    templateId: 'TPL-PAY-DEDUCT-01',
                    recipients: { selector: '', permittedRoles: [] } // empty
                }, hrActor);
            }, /Permitted recipients and authorized roles must be explicitly designated/);
        });

        test('3.1.6 Approval Required Before Activation: Status is pending_approval until authorized reviewer approves', () => {
            const makerActor = { id: 'HR-MAKER-01', name: 'Payroll Specialist', role: 'hr_payroll' };
            const approverActor = { id: 'ADM-APPROVER-02', name: 'Senior Director', role: 'super_admin' };

            // 1. Create rule -> Saved in 'pending_approval'
            const rule = payrollService.createPayrollRule({
                name: 'Advance Recovery 48-Hour Notice',
                event: 'payroll.advance_recovery',
                timing: { referenceDateType: 'deduction_effective_date', offsetDays: -2 },
                templateId: 'TPL-PAY-DEDUCT-01',
                recipients: { selector: 'cohort', permittedRoles: ['employee'] }
            }, makerActor);

            assert.equal(rule.status, 'pending_approval', 'Must be pending_approval before activation');
            assert.equal(rule.requiresApproval, true);

            // 2. Approver approves and activates
            const activated = payrollService.approveAndActivateRule(rule.id, approverActor, { notes: 'Approved for Q4 payroll' });
            assert.equal(activated.status, 'active');
            assert.equal(activated.approvalHistory.length, 1);
            assert.equal(activated.approvalHistory[0].approver.id, 'ADM-APPROVER-02');
        });
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.2 DEDUCTION-RELATED NOTIFICATION (PRD §3.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('3.2 Deduction-Related Notification & Non-Financial Distinction', () => {

        test('3.2.1 Configurable Days From Reference Date: Supports offsets before, on, or after reference date', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };

            // Case A: 3 days before (-3)
            const previewBefore = payrollService.generateDeductionNotificationPreview({
                employeeId: 'EMP-1001',
                referenceDate: '2026-10-31',
                offsetDays: -3
            }, hrActor);

            assert.equal(previewBefore.timing.referenceDate, '2026-10-31');
            assert.equal(previewBefore.timing.offsetDays, -3);
            assert.equal(previewBefore.timing.scheduledDispatchDate, '2026-10-28');
            assert.ok(previewBefore.timing.offsetDescription.includes('BEFORE'));

            // Case B: 2 days after (+2)
            const previewAfter = payrollService.generateDeductionNotificationPreview({
                employeeId: 'EMP-1001',
                referenceDate: '2026-10-31',
                offsetDays: 2
            }, hrActor);

            assert.equal(previewAfter.timing.scheduledDispatchDate, '2026-11-02');
            assert.ok(previewAfter.timing.offsetDescription.includes('AFTER'));
        });

        test('3.2.2 Clear Distinction From Actual Payroll Deduction: Mandatory safety disclaimer and boolean flags', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };

            const notification = payrollService.generateDeductionNotificationPreview({
                employeeId: 'EMP-1001',
                referenceDate: '2026-10-31',
                offsetDays: -3
            }, hrActor);

            // Strict Non-Financial Classification Checks (PRD §3.2)
            assert.equal(notification.classification.isActualDeduction, false, 'MUST NOT be classified as an actual deduction');
            assert.equal(notification.classification.isFinancialDebit, false, 'MUST NOT execute a financial debit');
            assert.equal(notification.classification.isInformationalReminder, true, 'MUST be an informational reminder');

            // Subject line distinct tag
            assert.ok(notification.message.subject.includes('[SCHEDULE REMINDER - NOT A DEBIT]'));

            // Body explicit disclaimer text
            assert.ok(notification.message.disclaimerNotice.includes('informational schedule reminder only'));
            assert.ok(notification.message.disclaimerNotice.includes('NOT represent an actual financial transaction'));
            assert.ok(notification.message.body.includes('DISCLAIMER:'));
        });
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.3 ACCOUNT VIEW (PRD §3.3)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('3.3 Account View, Role Isolation & Sensitive Data Masking', () => {

        test('3.3.1 Role-Based Access: Employees access their own permitted details only; blocked from other accounts', () => {
            const employeeSelf = { id: 'EMP-1001', name: 'Alex Rivera', role: 'employee' };

            // Access own account: SUCCEEDS
            const ownView = payrollService.getAccountView('EMP-1001', employeeSelf);
            assert.equal(ownView.employeeId, 'EMP-1001');
            assert.ok(ownView.salaryStructure);
            assert.ok(ownView.scheduledDeductions);

            // Attempt to access another employee: BLOCKED with 403 Access Denied
            assert.throws(() => {
                payrollService.getAccountView('EMP-OTHER-99', employeeSelf);
            }, /Access Denied: Employees are restricted to viewing their own permitted account details only/);
        });

        test('3.3.2 Sensitive Identifiers Masking: Bank account, tax ID, and national ID masked in API payload', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };
            const accountView = payrollService.getAccountView('EMP-1001', hrActor);

            // Bank Account raw: '98765432109876' -> Must be masked as '••••••••9876'
            assert.equal(accountView.bankAccount, '••••••••9876');
            assert.equal(accountView.maskingApplied, true);

            // Tax ID raw: 'PAN-ALEX-9988A' -> Must be masked as '••••••••988A'
            assert.equal(accountView.taxId, '••••••••988A');

            // National ID raw: 'UID-776655443322' -> Must be masked as '••••••••3322'
            assert.equal(accountView.nationalId, '••••••••3322');
        });

        test('3.3.3 Relevant Dates, Statuses and History Visible', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };
            const accountView = payrollService.getAccountView('EMP-1001', hrActor);

            assert.ok(accountView.relevantDates.effectiveDate);
            assert.ok(accountView.relevantDates.nextPayrollCycle);
            assert.equal(accountView.status, 'active');
            assert.ok(accountView.payslipHistory.length >= 2);
            assert.equal(accountView.payslipHistory[0].period, 'August 2026');
            assert.equal(accountView.payslipHistory[0].status, 'paid');
        });

        test('3.3.4 Access to Sensitive Information is Audited: Logs actor, target, timestamp, and fields accessed', () => {
            const hrActor = { id: 'HR-AUDITOR-01', name: 'Payroll Compliance Officer', role: 'hr_payroll' };

            // Read account view
            payrollService.getAccountView('EMP-1001', hrActor);

            // Inspect audit logs
            const auditLogs = payrollService.getAccountViewAuditLogs(5);
            assert.ok(auditLogs.length > 0);

            const latestLog = auditLogs[0];
            assert.equal(latestLog.actor.id, 'HR-AUDITOR-01');
            assert.equal(latestLog.targetEmployeeId, 'EMP-1001');
            assert.equal(latestLog.authorized, true);
            assert.ok(latestLog.fieldsAccessed.some(f => f.includes('bankAccount (masked)')));
            assert.ok(latestLog.integrityHash);
            assert.equal(latestLog.integrityHash.length, 64);
        });
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.4 PAYROLL SAFEGUARDS (PRD §3.4)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('3.4 Payroll Safeguards & Non-Negotiable Guardrails', () => {

        test('3.4.1 AI Restriction Guardrail: AI must NOT decide deduction amounts or dates', () => {
            const hrActor = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };

            // Autonomous AI decision attempt: BLOCKED
            assert.throws(() => {
                payrollService.createPayrollRule({
                    name: 'AI Generated Deduction Rule',
                    event: 'payroll.deduction_scheduled',
                    timing: { referenceDateType: 'deduction_effective_date', offsetDays: -3 },
                    templateId: 'TPL-PAY-DEDUCT-01',
                    recipients: { selector: 'cohort', permittedRoles: ['employee'] },
                    isAiGeneratedFinancialDecision: true, // FLAG TRIGGER
                    sourceEngine: 'autonomous_ai'
                }, hrActor);
            }, /Safeguard Violation: AI is strictly prohibited from deciding deduction amounts or calendar dates/);

            // Client Policy cannot override this non-negotiable safeguard
            assert.throws(() => {
                payrollService.updateClientApprovalPolicy({
                    aiAutonomousDecisionsAllowed: true
                }, { role: 'super_admin', name: 'Admin' });
            }, /System strictly forbids enabling autonomous AI decision-making for financial deduction amounts or dates/);
        });

        test('3.4.2 Immutable Change History: Payroll configuration modifications record previous/new states', () => {
            const hrMaker = { id: 'HR-01', name: 'HR Admin', role: 'hr_payroll' };
            const adminApprover = { id: 'ADM-01', name: 'Super Admin', role: 'super_admin' };

            const rule = payrollService.createPayrollRule({
                name: 'Tax Proof Nudge Rule',
                event: 'payroll.tax_declaration_reminder',
                timing: { referenceDateType: 'payroll_cutoff_date', offsetDays: -5 },
                templateId: 'TPL-PAY-TAX-03',
                recipients: { selector: 'all_employees', permittedRoles: ['employee'] }
            }, hrMaker);

            payrollService.approveAndActivateRule(rule.id, adminApprover, { notes: 'Policy verified' });

            const history = payrollService.getChangeHistory(rule.id);
            assert.ok(history.length >= 2, 'Should have at least 2 change records (created + approved)');
            
            const createChange = history.find(h => h.action === 'PAYROLL_RULE_CREATED');
            assert.ok(createChange);
            assert.equal(createChange.modifiedBy.id, 'HR-01');

            const approveChange = history.find(h => h.action === 'PAYROLL_RULE_APPROVED_AND_ACTIVATED');
            assert.ok(approveChange);
            assert.equal(approveChange.modifiedBy.id, 'ADM-01');
            assert.ok(approveChange.diff.previousState);
            assert.ok(approveChange.diff.newState);
            assert.ok(approveChange.hash);
        });

        test('3.4.3 Maker-Checker Segregation: Creator cannot self-approve payroll rule', () => {
            const hrMaker = { id: 'HR-SELF-01', name: 'Sam Maker', role: 'hr_payroll' };

            const rule = payrollService.createPayrollRule({
                name: 'Maker Checker Test Rule',
                event: 'payroll.deduction_scheduled',
                timing: { referenceDateType: 'deduction_effective_date', offsetDays: -3 },
                templateId: 'TPL-PAY-DEDUCT-01',
                recipients: { selector: 'cohort', permittedRoles: ['employee'] }
            }, hrMaker);

            // Same user attempts to approve their own rule: BLOCKED
            assert.throws(() => {
                payrollService.approveAndActivateRule(rule.id, hrMaker);
            }, /Maker-Checker Violation: Initiator 'Sam Maker' cannot approve their own payroll rule/);
        });
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.5 CORE USER ROLES (PRD §3.5)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('3.5 Core User Roles & Responsibility Scopes', () => {

        test('3.5.1 Role Matrix Verification: Enforces four canonical roles and scope boundaries', () => {
            const matrix = payrollService.getRoleMatrix();

            // 1. Manager: Manage goals and permitted templates
            assert.ok(matrix.manager);
            assert.ok(matrix.manager.allowedActions.includes('manage_goals'));
            assert.ok(matrix.manager.allowedActions.includes('access_permitted_templates'));
            assert.ok(matrix.manager.deniedActions.includes('configure_payroll'));

            // 2. Administrator: Manage templates, roles and system settings
            assert.ok(matrix.admin);
            assert.ok(matrix.admin.allowedActions.includes('manage_templates'));
            assert.ok(matrix.admin.allowedActions.includes('manage_roles'));
            assert.ok(matrix.admin.allowedActions.includes('configure_system_settings'));

            // 3. HR / Payroll: Configure payroll-related settings and notifications
            assert.ok(matrix.hr_payroll);
            assert.ok(matrix.hr_payroll.allowedActions.includes('configure_payroll'));
            assert.ok(matrix.hr_payroll.allowedActions.includes('create_deduction_rule'));
            assert.ok(matrix.hr_payroll.allowedActions.includes('preview_deduction_notification'));

            // 4. Employee: View own permitted goals, notices and account details
            assert.ok(matrix.employee);
            assert.ok(matrix.employee.allowedActions.includes('view_own_goals'));
            assert.ok(matrix.employee.allowedActions.includes('view_own_notices'));
            assert.ok(matrix.employee.allowedActions.includes('view_own_account_details'));
            assert.ok(matrix.employee.deniedActions.includes('configure_payroll'));
            assert.ok(matrix.employee.deniedActions.includes('view_others_account'));
        });
    });
});
