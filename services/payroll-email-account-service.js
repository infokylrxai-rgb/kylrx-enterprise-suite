const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * ============================================================================
 * PAYROLL, EMAIL AND ACCOUNT VIEWS SERVICE (PRD Section 3)
 * ============================================================================
 * 
 * Implements:
 * 
 * 3.1 Payroll Setup:
 *   • Authorised HR or payroll user opens payroll settings.
 *   • Selects relevant payroll event or rule.
 *   • Configures required dates or timing.
 *   • Selects an approved email template.
 *   • Selects permitted recipients.
 *   • System validates and saves the setup.
 *   • Approval required before activation.
 * 
 * 3.2 Deduction-Related Notification:
 *   • Supports configurable number of days from an agreed reference date (offsetDays).
 *   • Notification MUST be clearly distinguished from an actual payroll deduction
 *     (explicit informational reminder disclaimer, boolean non-financial tags).
 * 
 * 3.3 Account View:
 *   • Role-based view isolation (users see only information allowed by their role).
 *   • Employees access their own permitted information.
 *   • Payroll operators access approved payroll details.
 *   • Sensitive identifiers masked (bank accounts ••••••••1234, tax IDs, national IDs).
 *   • Relevant dates, statuses, and history visible.
 *   • Access to sensitive information is audited.
 * 
 * 3.4 Payroll Safeguards:
 *   • Only authorised roles can change payroll settings.
 *   • AI must not decide deduction amounts or dates (strict safeguard guardrail).
 *   • Payroll changes have an immutable audit history.
 *   • Approval rules defined by client policy (Maker-Checker / multi-tier).
 *   • Payroll calculations and statutory compliance require separate scope.
 * 
 * 3.5 Core User Roles:
 *   • Manager: Manage goals and permitted templates.
 *   • Administrator: Manage templates, roles and system settings.
 *   • HR / Payroll: Configure payroll-related settings and notifications.
 *   • Employee: View own permitted goals, notices and account details.
 */

class PayrollEmailAccountService {
    constructor() {
        // Payroll notification & event rules store: ruleId -> Rule
        this.payrollRules = new Map();

        // Approved email templates registry
        this.approvedTemplates = new Map();

        // Change history ledger: immutable records of all rule modifications
        this.changeHistory = [];

        // Sensitive access audit log: records all account view inspections
        this.accountViewAuditLogs = [];

        // Client Approval Policy Settings (PRD §3.4: Approval rules defined by client)
        this.clientPolicy = {
            requireApprovalForActivation: true,
            enforceMakerChecker: true,
            highValueDeductionThreshold: 10000,
            aiAutonomousDecisionsAllowed: false // STRICT: AI prohibited from deciding financial amounts/dates
        };

        // Core Role Capabilities Matrix (PRD §3.5)
        this.roleMatrix = {
            manager: {
                title: 'Manager',
                allowedActions: ['manage_goals', 'access_permitted_templates', 'view_team_attendance', 'view_team_reviews'],
                deniedActions: ['configure_payroll', 'activate_payroll_rule', 'view_company_payroll', 'modify_deductions'],
                scope: 'team_subordinates'
            },
            admin: {
                title: 'Administrator',
                allowedActions: ['manage_templates', 'manage_roles', 'configure_system_settings', 'view_audit_logs', 'activate_payroll_rule'],
                deniedActions: ['ai_financial_decision'],
                scope: 'system_wide'
            },
            super_admin: {
                title: 'Super Administrator',
                allowedActions: ['manage_templates', 'manage_roles', 'configure_system_settings', 'configure_payroll', 'activate_payroll_rule', 'view_audit_logs'],
                deniedActions: ['ai_financial_decision'],
                scope: 'system_wide'
            },
            hr_payroll: {
                title: 'HR / Payroll',
                allowedActions: ['configure_payroll', 'create_deduction_rule', 'view_approved_payroll', 'preview_deduction_notification', 'manage_payroll_templates'],
                deniedActions: ['self_approval_maker_checker', 'ai_financial_decision'],
                scope: 'payroll_cohort'
            },
            employee: {
                title: 'Employee',
                allowedActions: ['view_own_goals', 'view_own_notices', 'view_own_account_details', 'view_own_payslips', 'view_own_deductions'],
                deniedActions: ['configure_payroll', 'view_others_account', 'activate_payroll_rule', 'view_company_payroll'],
                scope: 'self_only'
            }
        };

        // Seed initial approved email templates and sample records
        this._seedApprovedTemplates();
        this._seedSampleEmployees();
        this._seedCanonicalRules();
    }

    /**
     * SHA-256 hash generator for immutable audit trails
     */
    computeHash(data) {
        return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
    }

    /**
     * Mask sensitive identifiers (Bank Accounts, PAN, Tax IDs, SSN)
     */
    maskIdentifier(val, visibleTailCount = 4) {
        if (!val || typeof val !== 'string') return '••••';
        const str = val.trim();
        if (str.length <= visibleTailCount) return '••••' + str;
        return '••••••••' + str.slice(-visibleTailCount);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       SEED DATA INITIALIZERS
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    _seedApprovedTemplates() {
        const templates = [
            {
                id: 'TPL-PAY-DEDUCT-01',
                name: 'Pre-Deduction Informational Schedule Reminder',
                module: 'payroll',
                event: 'payroll.deduction_scheduled',
                status: 'approved',
                approvedBy: 'Compliance Director',
                approvedAt: '2026-09-01T10:00:00Z',
                subject: 'SCHEDULE REMINDER: Upcoming Scheduled Payroll Deduction for {{month}}',
                body: 'Dear {{employeeName}}, this is an advance schedule reminder that a scheduled deduction of {{currency}} {{amount}} for {{deductionReason}} is listed for the upcoming payroll cycle on {{deductionDate}}.\n\nDISCLAIMER: This notification is an informational reminder only and does NOT represent an actual financial transaction or bank debit.',
                disclaimerNotice: 'INFORMATIONAL NOTICE ONLY — NOT AN ACTUAL DEBIT OR DEDUCTION'
            },
            {
                id: 'TPL-PAY-ADVICE-02',
                name: 'Monthly Salary Disbursement Advice',
                module: 'payroll',
                event: 'payroll.salary_credited',
                status: 'approved',
                approvedBy: 'Head of Payroll',
                approvedAt: '2026-09-01T10:00:00Z',
                subject: 'Salary Credit Advice: Period {{period}}',
                body: 'Dear {{employeeName}}, your salary disbursement for {{period}} has been processed. Net Credit: {{currency}} {{netAmount}} to your account ending in {{maskedAccount}}.',
                disclaimerNotice: 'OFFICIAL SALARY DISBURSEMENT ADVICE'
            },
            {
                id: 'TPL-PAY-TAX-03',
                name: 'Statutory Tax Declaration Proofs Reminder',
                module: 'payroll',
                event: 'payroll.tax_declaration_reminder',
                status: 'approved',
                approvedBy: 'Taxation Lead',
                approvedAt: '2026-09-01T10:00:00Z',
                subject: 'Action Required: Submit Statutory Tax Saving Proofs for FY{{financialYear}}',
                body: 'Dear {{employeeName}}, please upload investment declarations before cut-off date {{cutoffDate}} to ensure accurate TDS calculation.',
                disclaimerNotice: 'STATUTORY COMPLIANCE REMINDER'
            }
        ];

        for (const t of templates) {
            this.approvedTemplates.set(t.id, t);
        }
    }

    _seedSampleEmployees() {
        this.sampleEmployees = new Map([
            [
                'EMP-1001',
                {
                    id: 'EMP-1001',
                    name: 'Alex Rivera',
                    email: 'alex.rivera@kylrxai.com',
                    role: 'employee',
                    department: 'Engineering',
                    managerId: 'MGR-2001',
                    bankAccount: '98765432109876',
                    taxId: 'PAN-ALEX-9988A',
                    nationalId: 'UID-776655443322',
                    salaryStructure: {
                        basic: 85000,
                        hra: 34000,
                        specialAllowance: 21000,
                        grossMonthly: 140000,
                        currency: 'INR',
                        effectiveDate: '2026-04-01'
                    },
                    scheduledDeductions: [
                        {
                            deductionId: 'DED-LOAN-01',
                            reason: 'Company Laptop Purchase Recovery',
                            amount: 5000,
                            referenceDate: '2026-10-31',
                            status: 'scheduled'
                        },
                        {
                            deductionId: 'DED-PF-02',
                            reason: 'Provident Fund (Statutory Employee Share)',
                            amount: 1800,
                            referenceDate: '2026-10-31',
                            status: 'scheduled'
                        }
                    ],
                    payslipHistory: [
                        { period: 'August 2026', gross: 140000, deductions: 16800, net: 123200, status: 'paid', paidAt: '2026-08-31' },
                        { period: 'September 2026', gross: 140000, deductions: 16800, net: 123200, status: 'paid', paidAt: '2026-09-30' }
                    ]
                }
            ],
            [
                'MGR-2001',
                {
                    id: 'MGR-2001',
                    name: 'David Sterling',
                    email: 'david.sterling@kylrxai.com',
                    role: 'manager',
                    department: 'Engineering',
                    managerId: 'ADM-001',
                    bankAccount: '11223344556677',
                    taxId: 'PAN-DAVS-1122B',
                    nationalId: 'UID-998877665544',
                    subordinates: ['EMP-1001']
                }
            ]
        ]);
    }

    _seedCanonicalRules() {
        const canonical = {
            id: 'RULE-PAY-DEDUCT-CANONICAL-01',
            name: 'Advance Laptop Purchase Loan Deduction Reminder (-3 Days)',
            event: 'payroll.deduction_scheduled',
            module: 'payroll',
            timing: {
                referenceDateType: 'deduction_effective_date',
                offsetDays: -3, // 3 days before deduction date
                dispatchTimeUtc: '09:00'
            },
            templateId: 'TPL-PAY-DEDUCT-01',
            recipients: {
                selector: 'cohort',
                cohortName: 'Employees With Active Asset Recoveries',
                permittedRoles: ['employee']
            },
            status: 'active',
            requiresApproval: true,
            approvalHistory: [
                {
                    status: 'approved',
                    approver: { id: 'ADM-001', name: 'Super Admin', role: 'super_admin' },
                    approvedAt: '2026-09-10T14:30:00Z',
                    notes: 'Validated against client payroll reminder policy.'
                }
            ],
            isAiAssisted: false,
            maker: { id: 'HR-PAY-01', name: 'Payroll Specialist', role: 'hr_payroll' },
            createdAt: '2026-09-10T12:00:00Z',
            updatedAt: '2026-09-10T14:30:00Z'
        };

        this.payrollRules.set(canonical.id, canonical);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.1 PAYROLL SETUP (PRD §3.1)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Check if actor role is authorised to configure payroll
     */
    verifyPayrollConfigurationAuthority(actor = {}) {
        const role = (actor.role || '').toLowerCase();
        const allowedRoles = ['super_admin', 'admin', 'hr_payroll', 'payroll_admin', 'hr_admin'];
        if (!allowedRoles.includes(role)) {
            throw new Error(`Permission Denied: Role '${role || 'unassigned'}' is not authorised to configure payroll settings. Required roles: [${allowedRoles.join(', ')}].`);
        }
        return true;
    }

    /**
     * Create and validate a new payroll notification / event rule
     * @param {object} rulePayload - Configuration parameters
     * @param {object} actor - Initiator
     * @returns {object} Validated payroll rule
     */
    createPayrollRule(rulePayload = {}, actor = {}) {
        // Step 1: Authorisation check
        this.verifyPayrollConfigurationAuthority(actor);

        // Step 2: AI Guardrail (PRD §3.4: AI must not decide deduction amounts or dates)
        if (rulePayload.isAiGeneratedFinancialDecision === true || rulePayload.sourceEngine === 'autonomous_ai') {
            throw new Error('Safeguard Violation: AI is strictly prohibited from deciding deduction amounts or calendar dates. Financial decisions must be manually defined by authorized human operators.');
        }

        // Step 3: Event selection check
        const validEvents = [
            'payroll.deduction_scheduled',
            'payroll.run_initiated',
            'payroll.salary_credited',
            'payroll.tax_declaration_reminder',
            'payroll.advance_recovery',
            'payroll.bonus_payout_scheduled'
        ];
        if (!rulePayload.event || !validEvents.includes(rulePayload.event)) {
            throw new Error(`Invalid payroll event '${rulePayload.event}'. Must be one of: ${validEvents.join(', ')}.`);
        }

        // Step 4: Timing & Date configuration check
        const timing = rulePayload.timing || {};
        if (timing.offsetDays === undefined || isNaN(parseInt(timing.offsetDays, 10))) {
            throw new Error('Timing configuration requires valid numeric offsetDays (e.g. -3 for 3 days before reference date).');
        }

        const validReferenceTypes = ['deduction_effective_date', 'payroll_cutoff_date', 'salary_disbursement_date'];
        if (!timing.referenceDateType || !validReferenceTypes.includes(timing.referenceDateType)) {
            throw new Error(`Timing referenceDateType must be one of: ${validReferenceTypes.join(', ')}.`);
        }

        // Step 5: Approved email template selection check
        if (!rulePayload.templateId) {
            throw new Error('An approved email template ID must be selected.');
        }
        const template = this.approvedTemplates.get(rulePayload.templateId);
        if (!template) {
            throw new Error(`Email template '${rulePayload.templateId}' not found in registry.`);
        }
        if (template.status !== 'approved') {
            throw new Error(`Template '${rulePayload.templateId}' is currently in '${template.status}' status. Only 'approved' templates can be linked to payroll rules.`);
        }

        // Step 6: Permitted recipients selection check
        const recipients = rulePayload.recipients || {};
        if (!recipients.selector || !recipients.permittedRoles || recipients.permittedRoles.length === 0) {
            throw new Error('Permitted recipients and authorized roles must be explicitly designated.');
        }

        // Step 7: Rule validation & saving
        const ruleId = `RULE-PAY-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = new Date().toISOString();

        // Approval gate requirement
        const requiresApproval = this.clientPolicy.requireApprovalForActivation;

        const newRule = {
            id: ruleId,
            name: (rulePayload.name || 'Untitled Payroll Rule').trim(),
            description: rulePayload.description || '',
            module: 'payroll',
            event: rulePayload.event,
            timing: {
                referenceDateType: timing.referenceDateType,
                offsetDays: parseInt(timing.offsetDays, 10),
                dispatchTimeUtc: timing.dispatchTimeUtc || '09:00'
            },
            templateId: template.id,
            templateSnapshot: {
                name: template.name,
                subject: template.subject,
                approvedBy: template.approvedBy
            },
            recipients: {
                selector: recipients.selector,
                cohortName: recipients.cohortName || 'Designated Cohort',
                permittedRoles: recipients.permittedRoles
            },
            status: requiresApproval ? 'pending_approval' : 'active',
            requiresApproval,
            approvalHistory: [],
            maker: {
                id: actor.id || 'OPERATOR-01',
                name: actor.name || 'Payroll Operator',
                role: actor.role || 'hr_payroll'
            },
            createdAt: now,
            updatedAt: now
        };

        this.payrollRules.set(ruleId, newRule);

        // Record Change History (PRD §3.4: Payroll changes should have an audit history)
        this._recordChangeHistory({
            ruleId,
            action: 'PAYROLL_RULE_CREATED',
            actor,
            previousState: null,
            newState: newRule,
            reason: rulePayload.creationReason || 'New payroll notification setup configured'
        });

        logger.info(`[PayrollSetup] Created rule ${ruleId} (${newRule.name}). Status: ${newRule.status}.`);

        return newRule;
    }

    /**
     * Approve and activate payroll rule (PRD §3.1 & §3.4: Maker-Checker separation)
     */
    approveAndActivateRule(ruleId, approver = {}, options = {}) {
        const rule = this.payrollRules.get(ruleId);
        if (!rule) {
            throw new Error(`Payroll rule '${ruleId}' not found.`);
        }

        this.verifyPayrollConfigurationAuthority(approver);

        // Enforce Maker-Checker Rule if enabled in client policy
        if (this.clientPolicy.enforceMakerChecker) {
            if (rule.maker && rule.maker.id && approver.id && rule.maker.id === approver.id) {
                throw new Error(`Maker-Checker Violation: Initiator '${approver.name || approver.id}' cannot approve their own payroll rule. Another authorized user must review and approve.`);
            }
        }

        const now = new Date().toISOString();
        const previousState = { ...rule };

        rule.status = 'active';
        rule.updatedAt = now;
        rule.approvalHistory.push({
            status: 'approved',
            approver: {
                id: approver.id || 'APPROVER-01',
                name: approver.name || 'Authorised Approver',
                role: approver.role || 'admin'
            },
            approvedAt: now,
            notes: options.notes || 'Formal approval granted by client authorized reviewer.'
        });

        this.payrollRules.set(ruleId, rule);

        this._recordChangeHistory({
            ruleId,
            action: 'PAYROLL_RULE_APPROVED_AND_ACTIVATED',
            actor: approver,
            previousState,
            newState: rule,
            reason: options.notes || 'Rule activated for production dispatch'
        });

        logger.info(`[PayrollSetup] Rule ${ruleId} approved & activated by ${approver.name}.`);

        return rule;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.2 DEDUCTION-RELATED NOTIFICATION (PRD §3.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Calculate timing and format deduction notification reminder
     * Strictly distinguishes notification from an actual financial deduction.
     * 
     * @param {object} params - { employeeId, deductionId, referenceDate, offsetDays }
     * @param {object} actor - Initiating operator
     * @returns {object} Formatted reminder with explicit disclaimer
     */
    generateDeductionNotificationPreview(params = {}, actor = {}) {
        const { employeeId, deductionId, referenceDate, offsetDays = -3 } = params;

        const employee = this.sampleEmployees.get(employeeId || 'EMP-1001');
        if (!employee) {
            throw new Error(`Employee '${employeeId}' not found.`);
        }

        const deduction = (employee.scheduledDeductions || []).find(d => d.deductionId === deductionId) ||
            employee.scheduledDeductions?.[0] || {
                deductionId: 'DED-STANDARD-01',
                reason: 'Scheduled Asset Recovery',
                amount: 5000,
                referenceDate: referenceDate || '2026-10-31'
            };

        const targetRefDate = new Date(referenceDate || deduction.referenceDate || '2026-10-31');
        const computedDispatchDate = new Date(targetRefDate);
        computedDispatchDate.setDate(computedDispatchDate.getDate() + parseInt(offsetDays, 10));

        // PRD §3.2 Mandatory Distinction:
        // "The notification must be clearly distinguished from an actual payroll deduction."
        const explicitDisclaimer = 'IMPORTANT NOTICE: This notification is an informational schedule reminder only and does NOT represent an actual financial transaction, deduction, or bank debit. Formal payroll deduction will be processed during scheduled payroll disbursement.';

        const notificationPayload = {
            notificationId: `NOTIF-DED-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
            recipient: {
                id: employee.id,
                name: employee.name,
                email: employee.email,
                department: employee.department
            },
            timing: {
                referenceDate: targetRefDate.toISOString().split('T')[0],
                offsetDays: parseInt(offsetDays, 10),
                scheduledDispatchDate: computedDispatchDate.toISOString().split('T')[0],
                offsetDescription: offsetDays < 0
                    ? `${Math.abs(offsetDays)} day(s) BEFORE scheduled deduction`
                    : offsetDays > 0
                        ? `${offsetDays} day(s) AFTER scheduled deduction`
                        : 'On scheduled deduction date'
            },
            deductionDetails: {
                deductionId: deduction.deductionId,
                reason: deduction.reason,
                amount: deduction.amount,
                currency: 'INR'
            },
            // STRICT NON-FINANCIAL DISTINCTION FLAGS
            classification: {
                type: 'INFORMATIONAL_SCHEDULE_REMINDER',
                isActualDeduction: false,            // MUST BE FALSE
                isFinancialDebit: false,             // MUST BE FALSE
                isInformationalReminder: true,       // MUST BE TRUE
                requiresEmployeeAction: false
            },
            message: {
                subject: `[SCHEDULE REMINDER - NOT A DEBIT] Upcoming Scheduled Payroll Deduction Notice`,
                body: `Dear ${employee.name},\n\nThis is an advance informational notification that a scheduled deduction of INR ${deduction.amount} for '${deduction.reason}' is configured for your payroll account for reference date ${targetRefDate.toISOString().split('T')[0]}.\n\nDISCLAIMER: ${explicitDisclaimer}`,
                disclaimerNotice: explicitDisclaimer
            },
            generatedAt: new Date().toISOString(),
            generatedBy: actor.name || 'System'
        };

        return notificationPayload;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.3 ACCOUNT VIEW & DATA MASKING (PRD §3.3)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Retrieve role-isolated, masked account view
     * @param {string} targetEmployeeId - Employee profile to view
     * @param {object} actor - Requesting user session { id, role }
     * @returns {object} Role-isolated account view with masked identifiers
     */
    getAccountView(targetEmployeeId, actor = {}) {
        const role = (actor.role || 'employee').toLowerCase();
        const actorId = actor.id || 'ANONYMOUS';

        // PRD §3.3: Role Isolation Enforcement
        // 1. Employee: Can strictly ONLY access their own account
        if (role === 'employee' && actorId !== targetEmployeeId) {
            this._logAccountViewAudit({
                actor,
                targetEmployeeId,
                authorized: false,
                reason: 'Employee attempted to inspect another employee account.'
            });
            throw new Error(`Access Denied: Employees are restricted to viewing their own permitted account details only. (Attempted to access: ${targetEmployeeId})`);
        }

        const employee = this.sampleEmployees.get(targetEmployeeId);
        if (!employee) {
            throw new Error(`Account record for '${targetEmployeeId}' not found.`);
        }

        // 2. Manager: Can view team subordinates' operational details, but not arbitrary accounts
        if (role === 'manager') {
            const managerRecord = this.sampleEmployees.get(actorId);
            const isSubordinate = managerRecord && managerRecord.subordinates && managerRecord.subordinates.includes(targetEmployeeId);
            if (!isSubordinate && actorId !== targetEmployeeId) {
                this._logAccountViewAudit({
                    actor,
                    targetEmployeeId,
                    authorized: false,
                    reason: 'Manager attempted to access account outside team hierarchy.'
                });
                throw new Error(`Access Denied: Managers can only view subordinate team members within their reporting hierarchy.`);
            }
        }

        // PRD §3.3: Sensitive Identifiers Masking
        const maskedBankAccount = this.maskIdentifier(employee.bankAccount, 4);
        const maskedTaxId = this.maskIdentifier(employee.taxId, 4);
        const maskedNationalId = this.maskIdentifier(employee.nationalId, 4);

        // Assemble permitted view by role
        let accountData = {
            employeeId: employee.id,
            name: employee.name,
            email: employee.email,
            department: employee.department,
            role: employee.role,
            // Masked Identifiers
            bankAccount: maskedBankAccount,
            taxId: maskedTaxId,
            nationalId: maskedNationalId,
            maskingApplied: true,
            // Dates, statuses & history visible
            relevantDates: {
                effectiveDate: employee.salaryStructure?.effectiveDate || '2026-04-01',
                nextPayrollCycle: '2026-10-31',
                lastAuditDate: new Date().toISOString()
            },
            status: 'active'
        };

        // Employees & Payroll Operators see financial breakdowns
        if (role === 'employee' || role === 'hr_payroll' || role === 'super_admin' || role === 'admin') {
            accountData.salaryStructure = {
                basic: employee.salaryStructure?.basic,
                hra: employee.salaryStructure?.hra,
                grossMonthly: employee.salaryStructure?.grossMonthly,
                currency: employee.salaryStructure?.currency
            };
            accountData.scheduledDeductions = employee.scheduledDeductions || [];
            accountData.payslipHistory = employee.payslipHistory || [];
        } else if (role === 'manager') {
            // Managers do not see detailed personal bank salary breakdown
            accountData.salaryStructure = { note: 'Protected: Financial figures restricted to Payroll & Employee.' };
            accountData.scheduledDeductions = [];
            accountData.payslipHistory = [];
        }

        // Audit the access to sensitive records (PRD §3.3: Access to sensitive information may be audited)
        this._logAccountViewAudit({
            actor,
            targetEmployeeId,
            authorized: true,
            fieldsAccessed: ['bankAccount (masked)', 'taxId (masked)', 'salaryStructure', 'payslips'],
            viewType: `ROLE_${role.toUpperCase()}_VIEW`
        });

        return accountData;
    }

    /**
     * Audit logger for account view accesses
     */
    _logAccountViewAudit(entry) {
        const auditRecord = {
            id: `AUD-ACC-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
            timestamp: new Date().toISOString(),
            actor: {
                id: entry.actor?.id || 'UNKNOWN',
                name: entry.actor?.name || 'Operator',
                role: entry.actor?.role || 'user'
            },
            targetEmployeeId: entry.targetEmployeeId,
            authorized: entry.authorized !== false,
            reason: entry.reason || null,
            fieldsAccessed: entry.fieldsAccessed || [],
            viewType: entry.viewType || 'STANDARD_VIEW',
            integrityHash: this.computeHash(entry)
        };

        this.accountViewAuditLogs.push(auditRecord);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.4 PAYROLL SAFEGUARDS & AUDIT TRAIL (PRD §3.4)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Record change in payroll configuration ledger
     */
    _recordChangeHistory(change = {}) {
        const record = {
            changeId: `CHG-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
            ruleId: change.ruleId,
            action: change.action,
            timestamp: new Date().toISOString(),
            modifiedBy: {
                id: change.actor?.id || 'OPERATOR',
                name: change.actor?.name || 'Admin',
                role: change.actor?.role || 'admin'
            },
            reason: change.reason,
            diff: {
                previousState: change.previousState,
                newState: change.newState
            },
            hash: this.computeHash(change)
        };

        this.changeHistory.push(record);
    }

    /**
     * Update client-defined approval policy
     */
    updateClientApprovalPolicy(newPolicy = {}, actor = {}) {
        const role = (actor.role || '').toLowerCase();
        if (role !== 'super_admin' && role !== 'admin') {
            throw new Error(`Unauthorized: Only super administrators can modify client approval policies. (Current role: ${role})`);
        }

        // Immutable safeguard: AI prohibited from deciding financial amounts or dates
        if (newPolicy.aiAutonomousDecisionsAllowed === true) {
            throw new Error('Non-Negotiable Safeguard: System strictly forbids enabling autonomous AI decision-making for financial deduction amounts or dates.');
        }

        this.clientPolicy = { ...this.clientPolicy, ...newPolicy };
        logger.info(`[PayrollSafeguard] Client approval policy updated by ${actor.name}.`);
        return { ...this.clientPolicy };
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3.5 QUERY METHODS & ROLE MATRIX (PRD §3.5)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    getRoleMatrix() {
        return { ...this.roleMatrix };
    }

    getAllRules(filter = {}) {
        let list = Array.from(this.payrollRules.values());
        if (filter.status) list = list.filter(r => r.status === filter.status);
        if (filter.event) list = list.filter(r => r.event === filter.event);
        return list;
    }

    getRuleById(ruleId) {
        return this.payrollRules.get(ruleId) || null;
    }

    getApprovedTemplates() {
        return Array.from(this.approvedTemplates.values());
    }

    getChangeHistory(ruleId = null) {
        if (ruleId) {
            return this.changeHistory.filter(c => c.ruleId === ruleId);
        }
        return [...this.changeHistory].reverse();
    }

    getAccountViewAuditLogs(limit = 50) {
        return this.accountViewAuditLogs.slice(-limit).reverse();
    }
}

// Export singleton
module.exports = new PayrollEmailAccountService();
