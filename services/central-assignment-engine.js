const { db } = require('../config/firebase');
const logger = require('../utils/logger');
const crypto = require('crypto');
const eventBus = require('./event-bus');

/**
 * Kylrx Central Configuration + Assignment Engine (Layer 3)
 * 
 * 5. Employee Type + Business Unit Assignment Engine
 * 
 * Configures requirements once and automatically assigns them whenever an employee
 * is created or a key employee attribute changes.
 * 
 * Assignment Inputs (7 Dimensions):
 * 1. Legal Entity
 * 2. Business Unit
 * 3. Employee Type (Full Time, Contractor, Intern, Part-Time, Executive)
 * 4. Location
 * 5. Department
 * 6. Grade
 * 7. Employee-specific override
 * 
 * Automatic Assignments (10 Functional Categories):
 * 1. Payroll structure
 * 2. Statutory configuration
 * 3. Policies
 * 4. Document requirements
 * 5. Onboarding flow
 * 6. PMS (Performance Management System)
 * 7. Attendance/Leave rules
 * 8. Exit flow
 * 9. Approval flow
 * 10. Alert rules
 * 
 * Temporal & Historical Preservation:
 * - Computes Configuration Impact Diff (Before vs After)
 * - Applies transition from specified Effective Date
 * - Strictly preserves historical payrolls, signed documents, and policy acknowledgements
 */
class CentralAssignmentEngine {
    constructor() {
        this.inMemoryConfig = new Map();
        this.inMemoryHierarchy = new Map(); // empId -> managerId
        this.matrixRules = new Map(); // ruleId -> matrixRule
        this.activeAssignments = new Map(); // empId -> active assignment
        this.assignmentHistory = new Map(); // empId -> array of historical versions

        this.initDefaultMatrixRules();
        this.initFirestoreSync().catch(() => {});
    }

    /**
     * Synchronize matrix rules with Firebase Cloud Firestore
     */
    async initFirestoreSync() {
        if (!db || typeof db.collection !== 'function') return;
        try {
            const rulesSnapshot = await db.collection('assignment_rules').limit(20).get().catch(() => ({ empty: true }));
            if (rulesSnapshot && rulesSnapshot.empty) {
                for (const rule of this.matrixRules.values()) {
                    await db.collection('assignment_rules').doc(rule.id).set({
                        ...rule,
                        createdAt: new Date().toISOString(),
                        syncedWithFirebase: true
                    }, { merge: true }).catch(() => {});
                }
                logger.info(`[AssignmentEngine] Seeded ${this.matrixRules.size} rules to Firebase collection 'assignment_rules'`);
            } else if (rulesSnapshot && !rulesSnapshot.empty) {
                rulesSnapshot.forEach(docSnap => {
                    const rule = docSnap.data();
                    if (rule && rule.id && rule.match) {
                        this.matrixRules.set(rule.id, rule);
                    }
                });
                logger.info(`[AssignmentEngine] Loaded ${rulesSnapshot.size} rules live from Firebase Firestore`);
            }
        } catch (e) {
            logger.warn(`[AssignmentEngine] Firestore rule sync notice: ${e.message}`);
        }
    }

    /**
     * Seed baseline assignment matrix rules
     */
    initDefaultMatrixRules() {
        // Rule 1: Full-Time Technology (India)
        this.registerMatrixRule({
            id: 'RULE_FT_TECH_IN',
            name: 'Full-Time Technology Core (India)',
            match: {
                legalEntity: 'Kylrx Technologies India Pvt Ltd',
                businessUnit: 'Technology',
                employeeType: 'Full Time'
            },
            priority: 80,
            assignments: {
                payrollStructure: {
                    planName: 'Engineering Standard CTC Grade',
                    payoutCycle: 'MONTHLY_LAST_DAY',
                    basicSalaryPct: 50,
                    hraPct: 20,
                    specialAllowancePct: 20,
                    statutoryBonusPct: 10,
                    variablePayEligible: true
                },
                statutoryConfig: {
                    epfEnabled: true,
                    epfEmployerRate: 12,
                    epfEmployeeRate: 12,
                    esiEnabled: false, // Tech above threshold
                    professionalTaxState: 'Karnataka',
                    gratuityCovered: true,
                    tdsRegimeDefault: 'NEW_REGIME_2026'
                },
                policies: [
                    'Code of Business Conduct & Ethics',
                    'Information & Cloud Security Policy',
                    'Intellectual Property & Invention Assignment',
                    'Hybrid & Remote Work Agreement',
                    'Non-Disclosure Agreement (NDA)'
                ],
                documentRequirements: [
                    'PAN Card',
                    'Aadhaar Identity Proof',
                    'Degree Graduation Certificate',
                    'Previous Relieving Letter',
                    'Last 3 Months Payslips',
                    'Cancelled Cheque / Bank Statement'
                ],
                onboardingFlow: 'tech_engineering_onboarding_v2',
                pms: {
                    cadence: 'QUARTERLY_OKRS',
                    appraisalType: '360_DEGREE_FEEDBACK',
                    ratingScale: '5_POINT_SCALE',
                    goalSettingMandatory: true
                },
                attendanceLeaveRules: {
                    annualLeaveDays: 24,
                    sickLeaveDays: 12,
                    casualLeaveDays: 6,
                    maternityLeaveDays: 180,
                    paternityLeaveDays: 15,
                    biometricGeoFenceRequired: true,
                    regularizationLimitPerMonth: 3
                },
                exitFlow: 'standard_13_step_exit_flow',
                approvalFlow: {
                    tiers: ['Reporting Manager', 'Engineering VP', 'HRBP', 'Finance Controller'],
                    slaHours: 48
                },
                alertRules: [
                    'Probation 60-Day Review Notification',
                    'SLA Clearance Overdue Alert (48h)',
                    'PF Quarterly Compliance Advisory',
                    'Leave Balance Low Warning'
                ]
            }
        });

        // Rule 2: Contractor Technology (India)
        this.registerMatrixRule({
            id: 'RULE_CONTRACTOR_TECH_IN',
            name: 'Independent Contractor / Consultant (Technology)',
            match: {
                businessUnit: 'Technology',
                employeeType: 'Contractor'
            },
            priority: 70,
            assignments: {
                payrollStructure: {
                    planName: 'Professional Retainer Fee Contract',
                    payoutCycle: 'MONTHLY_NET_15',
                    isConsultancyFee: true,
                    tdsSection: '194J_PROFESSIONAL_FEES',
                    tdsRatePct: 10,
                    variablePayEligible: false
                },
                statutoryConfig: {
                    epfEnabled: false,
                    esiEnabled: false,
                    professionalTaxState: 'Exempt',
                    gratuityCovered: false,
                    gstInvoiceRequired: true
                },
                policies: [
                    'Contractor Services Agreement',
                    'Third-Party Confidentiality & NDA',
                    'Data Protection & Information Security Code'
                ],
                documentRequirements: [
                    'PAN Card',
                    'GST Registration Certificate',
                    'Cancelled Cheque for Vendor Account',
                    'Signed Independent Contractor Agreement'
                ],
                onboardingFlow: 'contractor_fasttrack_onboarding_v1',
                pms: {
                    cadence: 'MILESTONE_DELIVERY_REVIEW',
                    appraisalType: 'SOW_COMPLETION_SIGN_OFF',
                    ratingScale: 'PASS_FAIL',
                    goalSettingMandatory: false
                },
                attendanceLeaveRules: {
                    annualLeaveDays: 0,
                    sickLeaveDays: 0,
                    casualLeaveDays: 0,
                    isBillableDaysOnly: true,
                    biometricGeoFenceRequired: false,
                    regularizationLimitPerMonth: 0
                },
                exitFlow: 'contractor_release_expedited_flow',
                approvalFlow: {
                    tiers: ['Project Manager', 'Procurement Lead', 'Finance Accounts Payable'],
                    slaHours: 24
                },
                alertRules: [
                    'Contract Expiration 30-Day Renewal Alert',
                    'Monthly Invoice Submission Reminder',
                    'Vendor NDA Expiry Alert'
                ]
            }
        });

        // Rule 3: Full-Time Sales & Marketing
        this.registerMatrixRule({
            id: 'RULE_FT_SALES_IN',
            name: 'Full-Time Enterprise Sales & Marketing',
            match: {
                businessUnit: 'Sales & Marketing',
                employeeType: 'Full Time'
            },
            priority: 75,
            assignments: {
                payrollStructure: {
                    planName: 'Sales Base + Commission Structure',
                    payoutCycle: 'MONTHLY_LAST_DAY',
                    basicSalaryPct: 40,
                    hraPct: 20,
                    specialAllowancePct: 15,
                    incentiveCommissionPct: 25,
                    variablePayEligible: true
                },
                statutoryConfig: {
                    epfEnabled: true,
                    epfEmployerRate: 12,
                    epfEmployeeRate: 12,
                    esiEnabled: false,
                    professionalTaxState: 'Karnataka',
                    gratuityCovered: true,
                    tdsRegimeDefault: 'NEW_REGIME_2026'
                },
                policies: [
                    'Code of Business Conduct',
                    'Sales Incentive & Commission Policy',
                    'Travel & Enterprise Expense Reimbursement Policy',
                    'Anti-Bribery & Foreign Corrupt Practices Act (FCPA)'
                ],
                documentRequirements: [
                    'PAN Card',
                    'Aadhaar Proof',
                    'Degree Certificate',
                    'Experience Letter',
                    'Bank Proof'
                ],
                onboardingFlow: 'sales_go_to_market_onboarding',
                pms: {
                    cadence: 'MONTHLY_QUOTA_REVIEW',
                    appraisalType: 'PIPELINE_AND_QUOTA_ATTAINMENT',
                    ratingScale: 'QUOTA_PERCENTAGE',
                    goalSettingMandatory: true
                },
                attendanceLeaveRules: {
                    annualLeaveDays: 20,
                    sickLeaveDays: 10,
                    casualLeaveDays: 6,
                    maternityLeaveDays: 180,
                    paternityLeaveDays: 15,
                    biometricGeoFenceRequired: false,
                    regularizationLimitPerMonth: 5
                },
                exitFlow: 'standard_13_step_exit_flow',
                approvalFlow: {
                    tiers: ['Sales Director', 'VP Commercial', 'HRBP', 'Finance Approver'],
                    slaHours: 48
                },
                alertRules: [
                    'Monthly Quota Attainment Milestone Alert',
                    'Travel Expense Claim Pre-approval Alert',
                    'Quarterly Commission Payout Notice'
                ]
            }
        });
    }

    /**
     * Register a new Matrix Rule
     */
    registerMatrixRule(rule) {
        if (!rule || !rule.id || !rule.match) {
            throw new Error('Matrix rule must contain an id and match criteria');
        }
        this.matrixRules.set(rule.id, rule);
    }

    /**
     * Get all registered matrix rules
     */
    getMatrixRules() {
        return Array.from(this.matrixRules.values());
    }

    /**
     * Core Algorithm: Resolve Assignments across 10 functional modules for an employee
     * Evaluates 7 inputs:
     * - legalEntity, businessUnit, employeeType, location, department, grade, overrides
     */
    resolveAssignments(attributes = {}) {
        const {
            legalEntity = 'Kylrx Technologies India Pvt Ltd',
            businessUnit = 'Technology',
            employeeType = 'Full Time',
            location = 'Bengaluru',
            department = 'Engineering',
            grade = 'L3',
            overrides = {}
        } = attributes;

        // 1. Find best matching rule using specificity scoring
        let bestRule = null;
        let highestScore = -1;

        for (const rule of this.matrixRules.values()) {
            let score = 0;
            let isCandidate = true;

            const m = rule.match;

            if (m.legalEntity) {
                if (m.legalEntity === legalEntity) score += 20;
                else isCandidate = false;
            }

            if (m.businessUnit) {
                if (m.businessUnit === businessUnit) score += 30;
                else isCandidate = false;
            }

            if (m.employeeType) {
                if (m.employeeType === employeeType) score += 30;
                else isCandidate = false;
            }

            if (m.location) {
                if (m.location === location) score += 15;
                else isCandidate = false;
            }

            if (m.department) {
                if (m.department === department) score += 15;
                else isCandidate = false;
            }

            if (m.grade) {
                if (m.grade === grade) score += 10;
                else isCandidate = false;
            }

            if (isCandidate) {
                const totalScore = score + (rule.priority || 0);
                if (totalScore > highestScore) {
                    highestScore = totalScore;
                    bestRule = rule;
                }
            }
        }

        const base = bestRule ? JSON.parse(JSON.stringify(bestRule.assignments)) : this.getGlobalFallbackAssignments();

        // 2. Apply employee-specific overrides (100% priority)
        const resolved = {
            payrollStructure: { ...base.payrollStructure, ...(overrides.payrollStructure || {}) },
            statutoryConfig: { ...base.statutoryConfig, ...(overrides.statutoryConfig || {}) },
            policies: overrides.policies || base.policies,
            documentRequirements: overrides.documentRequirements || base.documentRequirements,
            onboardingFlow: overrides.onboardingFlow || base.onboardingFlow,
            pms: { ...base.pms, ...(overrides.pms || {}) },
            attendanceLeaveRules: { ...base.attendanceLeaveRules, ...(overrides.attendanceLeaveRules || {}) },
            exitFlow: overrides.exitFlow || base.exitFlow,
            approvalFlow: overrides.approvalFlow || base.approvalFlow,
            alertRules: overrides.alertRules || base.alertRules
        };

        return {
            matchedRuleId: bestRule ? bestRule.id : 'GLOBAL_FALLBACK',
            matchedRuleName: bestRule ? bestRule.name : 'Global Fallback Baseline',
            resolvedInputs: { legalEntity, businessUnit, employeeType, location, department, grade },
            assignments: resolved,
            resolvedAt: new Date().toISOString()
        };
    }

    /**
     * Compute Configuration Impact Diff when Employee Type or Business Unit changes
     * Shows what requirements change across all 10 categories
     */
    calculateConfigurationImpact(currentAttributes = {}, prospectiveAttributes = {}) {
        const currentResolution = this.resolveAssignments(currentAttributes);
        const prospectiveResolution = this.resolveAssignments(prospectiveAttributes);

        const current = currentResolution.assignments;
        const prospective = prospectiveResolution.assignments;

        const categories = {};
        const diffSummaryList = [];
        let hasImpact = false;

        const categoryKeys = [
            'payrollStructure',
            'statutoryConfig',
            'policies',
            'documentRequirements',
            'onboardingFlow',
            'pms',
            'attendanceLeaveRules',
            'exitFlow',
            'approvalFlow',
            'alertRules'
        ];

        for (const cat of categoryKeys) {
            const curVal = current[cat];
            const nextVal = prospective[cat];

            const isJsonEqual = JSON.stringify(curVal) === JSON.stringify(nextVal);

            if (isJsonEqual) {
                categories[cat] = { status: 'UNCHANGED', current: curVal, prospective: nextVal, changes: [] };
            } else {
                hasImpact = true;
                const changeDetails = this.describeCategoryChanges(cat, curVal, nextVal);
                categories[cat] = {
                    status: 'MODIFIED',
                    current: curVal,
                    prospective: nextVal,
                    changes: changeDetails
                };
                diffSummaryList.push(...changeDetails);
            }
        }

        return {
            employeeId: prospectiveAttributes.employeeId || currentAttributes.employeeId || 'EMP_TARGET',
            hasImpact,
            currentAttributes,
            prospectiveAttributes,
            matchedRuleBefore: currentResolution.matchedRuleName,
            matchedRuleAfter: prospectiveResolution.matchedRuleName,
            categories,
            diffSummaryList,
            evaluatedAt: new Date().toISOString()
        };
    }

    /**
     * Helper to describe human-readable changes in a category
     */
    describeCategoryChanges(category, cur, next) {
        const changes = [];

        if (Array.isArray(cur) && Array.isArray(next)) {
            const added = next.filter(item => !cur.includes(item));
            const removed = cur.filter(item => !next.includes(item));

            if (added.length > 0) changes.push(`[${category}] Added: ${added.join(', ')}`);
            if (removed.length > 0) changes.push(`[${category}] Removed: ${removed.join(', ')}`);
            return changes;
        }

        if (typeof cur === 'object' && typeof next === 'object' && cur && next) {
            for (const key of Object.keys(next)) {
                if (JSON.stringify(cur[key]) !== JSON.stringify(next[key])) {
                    changes.push(`[${category}] ${key}: ${JSON.stringify(cur[key])} ➔ ${JSON.stringify(next[key])}`);
                }
            }
            return changes;
        }

        changes.push(`[${category}] Updated from "${cur}" to "${next}"`);
        return changes;
    }

    /**
     * Apply Assignment Transition with Effective Date & History Preservation
     * Historical payrolls, documents, and acknowledgements remain preserved.
     */
    async applyAssignmentTransition(employeeId, newAttributes = {}, effectiveDate = new Date().toISOString(), changedBy = 'HR Admin', reason = 'Role / BU Transition') {
        logger.info(`[AssignmentEngine] Applying assignment transition for ${employeeId} with effectiveDate: ${effectiveDate}`);

        const prospectiveResolution = this.resolveAssignments(newAttributes);
        const transitionId = `TR_${crypto.randomUUID().substring(0, 8)}`;

        // 1. Snapshot current active assignment to history if one already existed
        let historyEntry = null;
        const currentActive = this.activeAssignments.get(employeeId);
        if (currentActive) {
            historyEntry = {
                ...currentActive,
                validUntil: effectiveDate,
                transitionId,
                archivedAt: new Date().toISOString(),
                supersededBy: transitionId
            };

            if (!this.assignmentHistory.has(employeeId)) {
                this.assignmentHistory.set(employeeId, []);
            }
            this.assignmentHistory.get(employeeId).push(historyEntry);
        }

        // 2. Create the newly activated assignment record
        const now = new Date();
        const effective = new Date(effectiveDate);
        const isActiveNow = effective <= now;

        const newRecord = {
            transitionId,
            employeeId,
            attributes: newAttributes,
            assignments: prospectiveResolution.assignments,
            matchedRuleId: prospectiveResolution.matchedRuleId,
            validFrom: effectiveDate,
            validUntil: null,
            status: isActiveNow ? 'ACTIVE' : 'SCHEDULED',
            changedBy,
            reason,
            updatedAt: new Date().toISOString(),
            preservedHistoricalRecords: {
                historicalPayrollPreserved: true,
                historicalDocumentsPreserved: true,
                policyAcknowledgementsPreserved: true,
                auditSealedHash: crypto.createHash('sha256').update(JSON.stringify(historyEntry || newAttributes)).digest('hex')
            }
        };

        this.activeAssignments.set(employeeId, newRecord);

        // 3. Persist to Firestore if available
        if (db) {
            try {
                // Update active assignment document
                db.collection('employee_assignments').doc(employeeId).set(newRecord, { merge: true }).catch(() => {});

                // Append historical snapshot to immutable history subcollection
                if (historyEntry) {
                    db.collection('employee_assignments').doc(employeeId)
                        .collection('history').doc(transitionId).set(historyEntry).catch(() => {});
                }

                // Update employee core profile without mutating past records
                db.collection('employees').doc(employeeId).set({
                    businessUnit: newAttributes.businessUnit,
                    employeeType: newAttributes.employeeType,
                    department: newAttributes.department || 'Technology',
                    grade: newAttributes.grade || 'L3',
                    assignmentEffectiveDate: effectiveDate,
                    lastAssignmentUpdate: new Date().toISOString()
                }, { merge: true }).catch(() => {});
            } catch (e) {
                logger.warn(`[AssignmentEngine] Firestore write notice: ${e.message}`);
            }
        }

        // 4. Emit event to EventBus for downstream automations
        eventBus.emit('assignment.transition_applied', {
            employeeId,
            transitionId,
            effectiveDate,
            newAttributes,
            isActiveNow,
            timestamp: new Date().toISOString()
        });

        return {
            success: true,
            employeeId,
            transitionId,
            effectiveDate,
            status: newRecord.status,
            matchedRule: prospectiveResolution.matchedRuleName,
            assignments: prospectiveResolution.assignments,
            preservedHistoricalRecords: newRecord.preservedHistoricalRecords
        };
    }

    /**
     * Retrieve complete assignment timeline history for an employee
     */
    getAssignmentHistory(employeeId) {
        return this.assignmentHistory.get(employeeId) || [];
    }

    /**
     * Retrieve active assignment for an employee
     */
    getActiveAssignment(employeeId) {
        return this.activeAssignments.get(employeeId) || null;
    }

    /**
     * Fallback baseline assignment schema
     */
    getGlobalFallbackAssignments() {
        return {
            payrollStructure: { planName: 'Standard Base', payoutCycle: 'MONTHLY_LAST_DAY' },
            statutoryConfig: { epfEnabled: true, esiEnabled: false, professionalTaxState: 'Default' },
            policies: ['Code of Business Conduct', 'Information Security Policy'],
            documentRequirements: ['Identity Proof', 'Address Proof', 'Bank Account Proof'],
            onboardingFlow: 'standard_onboarding_flow',
            pms: { cadence: 'ANNUAL_REVIEW', appraisalType: 'MANAGER_EVALUATION' },
            attendanceLeaveRules: { annualLeaveDays: 18, sickLeaveDays: 12, casualLeaveDays: 6 },
            exitFlow: 'standard_13_step_exit_flow',
            approvalFlow: { tiers: ['Reporting Manager', 'HR Admin'] },
            alertRules: ['Probation End Alert']
        };
    }

    // ==========================================
    // Existing Layer 3 Methods (Preserved 100%)
    // ==========================================

    async getConfig(configKey, defaultValue = null) {
        if (this.inMemoryConfig.has(configKey)) {
            return this.inMemoryConfig.get(configKey);
        }

        if (db) {
            try {
                const snap = await db.collection('system_configs').doc(configKey).get();
                if (snap.exists) {
                    const val = snap.data().value !== undefined ? snap.data().value : snap.data();
                    this.inMemoryConfig.set(configKey, val);
                    return val;
                }
            } catch (e) {
                logger.warn(`[AssignmentEngine] Error reading config ${configKey}: ${e.message}`);
            }
        }

        return defaultValue;
    }

    async setConfig(configKey, value, updatedBy = 'system') {
        this.inMemoryConfig.set(configKey, value);

        if (db) {
            try {
                await db.collection('system_configs').doc(configKey).set({
                    key: configKey,
                    value,
                    updated_by: updatedBy,
                    updated_at: new Date().toISOString()
                }, { merge: true });
            } catch (e) {
                logger.warn(`[AssignmentEngine] Could not persist config ${configKey}: ${e.message}`);
            }
        }
        return { success: true, key: configKey, value };
    }

    async resolveReportingManager(employeeId) {
        if (!employeeId) return null;

        if (this.inMemoryHierarchy.has(employeeId)) {
            const mgrId = this.inMemoryHierarchy.get(employeeId);
            return { managerId: mgrId, email: `${mgrId.toLowerCase()}@kylrx.ai`, role: 'Reporting Manager' };
        }

        if (db) {
            try {
                const empDoc = await db.collection('users').doc(employeeId).get();
                if (empDoc.exists && empDoc.data().managerId) {
                    const mgrId = empDoc.data().managerId;
                    return { managerId: mgrId, email: empDoc.data().managerEmail || `${mgrId}@kylrx.ai`, role: 'Reporting Manager' };
                }
            } catch (e) {
                logger.warn(`[AssignmentEngine] Failed to resolve manager for ${employeeId}: ${e.message}`);
            }
        }

        return { managerId: 'MGR_DEFAULT', email: 'manager@kylrx.ai', role: 'Reporting Manager' };
    }

    async resolveHRBP(department = 'Engineering') {
        const hrbpMap = await this.getConfig('hrbp_assignments', {
            'Engineering': 'hrbp_tech@kylrx.ai',
            'Technology': 'hrbp_tech@kylrx.ai',
            'Cybersecurity': 'hrbp_cyber@kylrx.ai',
            'Sales': 'hrbp_sales@kylrx.ai',
            'Sales & Marketing': 'hrbp_sales@kylrx.ai',
            'Default': 'hrhead@kylrx.ai'
        });

        const email = hrbpMap[department] || hrbpMap['Default'] || 'hrhead@kylrx.ai';
        return { role: 'HRBP', email, department };
    }

    async resolveFinanceApprover(amount = 0) {
        const thresholds = await this.getConfig('disbursement_approval_thresholds', {
            managerLimit: 50000,
            financeLeadLimit: 500000,
            cfoLimit: Infinity
        });

        if (amount <= thresholds.managerLimit) {
            return { role: 'Finance Lead', email: 'finance_ops@kylrx.ai', level: 1 };
        } else if (amount <= thresholds.financeLeadLimit) {
            return { role: 'Head of Finance', email: 'finance_head@kylrx.ai', level: 2 };
        } else {
            return { role: 'CFO / Super Admin', email: 'cfo@kylrx.ai', level: 3 };
        }
    }

    async resolveApprovalChain(moduleKey, entityId, context = {}) {
        logger.info(`[AssignmentEngine] Resolving approval chain for module: ${moduleKey}, entity: ${entityId}`);

        switch (moduleKey) {
            case 'exit_offboarding': {
                const mgr = await this.resolveReportingManager(entityId);
                const hrbp = await this.resolveHRBP(context.department);
                return [
                    { tier: 1, role: 'Reporting Manager', actor: mgr.managerId, email: mgr.email },
                    { tier: 2, role: 'HRBP', actor: 'HRBP_UNIT', email: hrbp.email },
                    { tier: 3, role: 'HR Admin', actor: 'HR_ADMIN_DESK', email: 'hrhead@kylrx.ai' },
                    { tier: 4, role: 'Payroll Lead', actor: 'PAYROLL_OPS', email: 'payroll@kylrx.ai' }
                ];
            }

            case 'leave_attendance': {
                const mgr = await this.resolveReportingManager(entityId);
                const chain = [
                    { tier: 1, role: 'Reporting Manager', actor: mgr.managerId, email: mgr.email }
                ];
                if (context.daysCount > 5) {
                    const hrbp = await this.resolveHRBP(context.department);
                    chain.push({ tier: 2, role: 'HRBP', actor: 'HRBP_UNIT', email: hrbp.email });
                }
                return chain;
            }

            case 'payroll_disbursement': {
                const approver = await this.resolveFinanceApprover(context.netDisbursement || 0);
                return [
                    { tier: 1, role: 'Payroll Maker', actor: 'HR_ADMIN', email: 'hradmin@kylrx.ai' },
                    { tier: 2, role: 'Disbursement Checker', actor: approver.role, email: approver.email }
                ];
            }

            default: {
                const defaultMgr = await this.resolveReportingManager(entityId);
                return [
                    { tier: 1, role: 'Reporting Manager', actor: defaultMgr.managerId, email: defaultMgr.email },
                    { tier: 2, role: 'HR Admin', actor: 'HR_ADMIN', email: 'hradmin@kylrx.ai' }
                ];
            }
        }
    }

    async reassignReportingHierarchy(fromManagerId, toManagerId, employeeIds = []) {
        logger.info(`[AssignmentEngine] Reassigning ${employeeIds.length} direct reports from ${fromManagerId} to ${toManagerId}`);

        for (const empId of employeeIds) {
            if (empId === toManagerId) {
                throw new Error(`Invalid assignment: Employee ${empId} cannot report to themselves`);
            }
            if (this.detectHierarchyLoop(empId, toManagerId)) {
                throw new Error(`Circular hierarchy detected: Assigning ${empId} to ${toManagerId} creates an invalid loop.`);
            }
        }

        employeeIds.forEach(empId => {
            this.inMemoryHierarchy.set(empId, toManagerId);
        });

        if (db) {
            try {
                const batch = db.batch();
                employeeIds.forEach(empId => {
                    const ref = db.collection('users').doc(empId);
                    batch.set(ref, {
                        managerId: toManagerId,
                        managerReassignedAt: new Date().toISOString()
                    }, { merge: true });
                });
                await batch.commit();
            } catch (e) {
                logger.warn(`[AssignmentEngine] Failed to commit batch hierarchy update to Firestore: ${e.message}`);
            }
        }

        return {
            success: true,
            reassignedCount: employeeIds.length,
            fromManagerId,
            toManagerId
        };
    }

    detectHierarchyLoop(empId, prospectiveManagerId, visited = new Set()) {
        if (empId === prospectiveManagerId) return true;

        let current = prospectiveManagerId;
        while (current) {
            if (visited.has(current)) return true;
            visited.add(current);
            if (current === empId) return true;
            current = this.inMemoryHierarchy.get(current);
        }
        return false;
    }
}

const centralAssignmentEngine = new CentralAssignmentEngine();
module.exports = centralAssignmentEngine;
