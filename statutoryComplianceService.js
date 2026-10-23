/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - STATUTORY COMPLIANCE SERVICE ENGINE
 * ============================================================================
 * 
 * Manages Statutory Policy Ledger, Firestore Ingestion, Dynamic Payroll Deductions,
 * State-specific Professional Tax / LWF Slabs, and Due Date Alert Reminders
 * matching PRD Sections 1, 4, 11, & 13:
 * 
 * 1. Cloud Firestore Data Architecture:
 *    - Path: organizations/{orgId}/statutory_rules/{complianceCode}
 *    - Document Schema:
 *      {
 *        "complianceCode": "COMP_PF",
 *        "complianceName": "Employees Provident Fund",
 *        "isApplicable": true,
 *        "registrationNumber": "KN/BNG/0012345/000",
 *        "state": "All India",
 *        "effectiveFrom": "2026-01-01",
 *        "wageCeiling": 15000,
 *        "employeeContributionRate": 12.0,
 *        "employerContributionRate": 12.0,
 *        "dueDateDay": 15,
 *        "isActive": true,
 *        "createdAt": "2026-01-01T00:00:00.000Z",
 *        "updatedAt": "2026-01-01T00:00:00.000Z"
 *      }
 * 
 * 2. Dynamic Payroll Deduction Engine (PRD §4):
 *    - EPF / EPS computation with wage ceiling cap (15,000 threshold)
 *    - ESIC eligibility (<= 21,000 gross) with 0.75% EE and 3.25% ER split
 *    - Regional PT slab matrices (Karnataka, Maharashtra, etc.)
 *    - LWF & Gratuity employer liabilities
 * 
 * 3. Alert Monitor & Deadline Tracking (PRD §11):
 *    - Automated reminders at 5 days and 2 days prior to statutory Due_Date_Day
 *    - Direct export link generators (ECR EPFO #~# format, ESIC return)
 * 
 * @version 1.0.0
 * @author Principal Fintech & Statutory Compliance Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxStatutoryComplianceService = factory();
        root.statutoryComplianceService = root.KylrxStatutoryComplianceService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for tests / offline mode / caching
    const _localLedger = new Map();

    // Default Enterprise Seed Policies matching Templates.xlsx & Indian Statutory Framework
    const DEFAULT_STATUTORY_POLICIES = [
        {
            complianceCode: "COMP_PF",
            complianceName: "Employees Provident Fund (EPF & EPS)",
            isApplicable: true,
            registrationNumber: "KN/BNG/0012345/000",
            state: "All India",
            effectiveFrom: "2026-01-01",
            wageCeiling: 15000,
            employeeContributionRate: 12.0,
            employerContributionRate: 12.0,
            dueDateDay: 15,
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
            complianceCode: "COMP_ESI",
            complianceName: "Employees State Insurance (ESIC)",
            isApplicable: true,
            registrationNumber: "31000123450000101",
            state: "All India",
            effectiveFrom: "2026-01-01",
            wageCeiling: 21000,
            employeeContributionRate: 0.75,
            employerContributionRate: 3.25,
            dueDateDay: 15,
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
            complianceCode: "COMP_PT_KA",
            complianceName: "Professional Tax (Karnataka)",
            isApplicable: true,
            registrationNumber: "PT/KA/BNG/98765",
            state: "Karnataka",
            effectiveFrom: "2026-01-01",
            wageCeiling: 25000,
            employeeContributionRate: 200,
            employerContributionRate: 0,
            dueDateDay: 20,
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
            complianceCode: "COMP_PT_MH",
            complianceName: "Professional Tax (Maharashtra)",
            isApplicable: true,
            registrationNumber: "PT/MH/MUM/12345",
            state: "Maharashtra",
            effectiveFrom: "2026-01-01",
            wageCeiling: 10000,
            employeeContributionRate: 200,
            employerContributionRate: 0,
            dueDateDay: 20,
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
            complianceCode: "COMP_LWF_KA",
            complianceName: "Labour Welfare Fund (Karnataka)",
            isApplicable: true,
            registrationNumber: "LWF/KA/2026/01",
            state: "Karnataka",
            effectiveFrom: "2026-01-01",
            wageCeiling: 15000,
            employeeContributionRate: 20,
            employerContributionRate: 40,
            dueDateDay: 15,
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
            complianceCode: "COMP_GRATUITY",
            complianceName: "Payment of Gratuity Scheme",
            isApplicable: true,
            registrationNumber: "GRAT/EST/00918",
            state: "All India",
            effectiveFrom: "2026-01-01",
            wageCeiling: "15/26 Formula",
            employeeContributionRate: 0,
            employerContributionRate: 4.81,
            dueDateDay: 30,
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        }
    ];

    /**
     * Initializes the in-memory ledger with default seed data
     */
    function _initializeLedger(orgId = 'org_default') {
        if (!_localLedger.has(orgId)) {
            const orgMap = new Map();
            DEFAULT_STATUTORY_POLICIES.forEach(p => {
                orgMap.set(p.complianceCode, { ...p, orgId });
            });
            _localLedger.set(orgId, orgMap);
        }
        return _localLedger.get(orgId);
    }

    /**
     * Retrieves all compliance rules for an organization
     */
    function getAllComplianceRules(orgId = 'org_default') {
        const orgMap = _initializeLedger(orgId);
        return Array.from(orgMap.values());
    }

    /**
     * Retrieves a single compliance rule by code
     */
    function getComplianceRuleByCode(complianceCode, orgId = 'org_default') {
        const orgMap = _initializeLedger(orgId);
        return orgMap.get(complianceCode) || null;
    }

    /**
     * Creates a new statutory compliance rule
     */
    function createComplianceRule(ruleData, orgId = 'org_default') {
        if (!ruleData || !ruleData.complianceCode) {
            throw new Error("Missing required 'complianceCode'.");
        }
        const orgMap = _initializeLedger(orgId);
        if (orgMap.has(ruleData.complianceCode)) {
            throw new Error(`Compliance rule '${ruleData.complianceCode}' already exists.`);
        }

        const now = new Date().toISOString();
        const newRecord = {
            complianceCode: String(ruleData.complianceCode).trim().toUpperCase(),
            complianceName: ruleData.complianceName || ruleData.complianceCode,
            isApplicable: ruleData.isApplicable !== false,
            registrationNumber: ruleData.registrationNumber || "",
            state: ruleData.state || "All India",
            effectiveFrom: ruleData.effectiveFrom || "2026-01-01",
            wageCeiling: ruleData.wageCeiling !== undefined ? ruleData.wageCeiling : 15000,
            employeeContributionRate: ruleData.employeeContributionRate !== undefined ? ruleData.employeeContributionRate : 12.0,
            employerContributionRate: ruleData.employerContributionRate !== undefined ? ruleData.employerContributionRate : 12.0,
            dueDateDay: ruleData.dueDateDay || 15,
            isActive: ruleData.isActive !== false,
            orgId: orgId,
            createdAt: now,
            updatedAt: now
        };

        // Consistency check: if applicable, require registration number and effective from
        if (newRecord.isApplicable) {
            if (!newRecord.registrationNumber) {
                throw new Error("When 'isApplicable' is true, 'registrationNumber' is mandatory.");
            }
            if (!newRecord.effectiveFrom) {
                throw new Error("When 'isApplicable' is true, 'effectiveFrom' is mandatory.");
            }
        }

        orgMap.set(newRecord.complianceCode, newRecord);
        return { success: true, record: newRecord };
    }

    /**
     * Updates an existing compliance rule
     */
    function updateComplianceRule(complianceCode, updateData, orgId = 'org_default') {
        const orgMap = _initializeLedger(orgId);
        const existing = orgMap.get(complianceCode);
        if (!existing) {
            throw new Error(`Compliance rule '${complianceCode}' not found.`);
        }

        const updated = {
            ...existing,
            ...updateData,
            complianceCode: existing.complianceCode, // immutable
            updatedAt: new Date().toISOString()
        };

        if (updated.isApplicable) {
            if (!updated.registrationNumber) {
                throw new Error("When 'isApplicable' is true, 'registrationNumber' is mandatory.");
            }
            if (!updated.effectiveFrom) {
                throw new Error("When 'isApplicable' is true, 'effectiveFrom' is mandatory.");
            }
        }

        orgMap.set(complianceCode, updated);
        return { success: true, record: updated };
    }

    /**
     * Deletes a compliance rule
     */
    function deleteComplianceRule(complianceCode, orgId = 'org_default') {
        const orgMap = _initializeLedger(orgId);
        if (!orgMap.has(complianceCode)) {
            return { success: false, message: "Rule not found." };
        }
        orgMap.delete(complianceCode);
        return { success: true, deletedCode: complianceCode };
    }

    /**
     * Toggles applicable status of a compliance rule
     */
    function toggleComplianceApplicable(complianceCode, isApplicable, orgId = 'org_default') {
        return updateComplianceRule(complianceCode, { isApplicable }, orgId);
    }

    /**
     * Toggles active status of a compliance rule
     */
    function toggleComplianceActive(complianceCode, isActive, orgId = 'org_default') {
        return updateComplianceRule(complianceCode, { isActive }, orgId);
    }

    /**
     * Batch upserts statutory compliance records (e.g. from SheetJS ingestion)
     */
    function batchUpsertRules(rulesList, orgId = 'org_default') {
        if (!Array.isArray(rulesList)) {
            throw new Error("batchUpsertRules requires an array of rule objects.");
        }
        const orgMap = _initializeLedger(orgId);
        let inserted = 0;
        let updated = 0;

        for (const item of rulesList) {
            const code = item.complianceCode || item.Compliance_Code;
            if (!code) continue;

            const existing = orgMap.get(code);
            const now = new Date().toISOString();

            const record = {
                complianceCode: code,
                complianceName: item.complianceName || item.Compliance_Name || code,
                isApplicable: item.isApplicable !== undefined ? item.isApplicable : (item.Applicable !== undefined ? item.Applicable : true),
                registrationNumber: item.registrationNumber || item.Registration_Number || "",
                state: item.state || item.State || "All India",
                effectiveFrom: item.effectiveFrom || item.Effective_From || "2026-01-01",
                wageCeiling: item.wageCeiling !== undefined ? item.wageCeiling : (item.Wage_Ceiling_or_Rule !== undefined ? item.Wage_Ceiling_or_Rule : 15000),
                employeeContributionRate: item.employeeContributionRate !== undefined ? item.employeeContributionRate : (item.Employee_Contribution_Rate !== undefined ? item.Employee_Contribution_Rate : 12.0),
                employerContributionRate: item.employerContributionRate !== undefined ? item.employerContributionRate : (item.Employer_Contribution_Rate !== undefined ? item.Employer_Contribution_Rate : 12.0),
                dueDateDay: item.dueDateDay || item.Due_Date_Day || 15,
                isActive: item.isActive !== undefined ? item.isActive : (item.Active !== undefined ? item.Active : true),
                orgId: orgId,
                createdAt: existing ? existing.createdAt : now,
                updatedAt: now
            };

            if (existing) {
                updated++;
            } else {
                inserted++;
            }
            orgMap.set(code, record);
        }

        return {
            success: true,
            insertedCount: inserted,
            updatedCount: updated,
            totalActive: Array.from(orgMap.values()).filter(r => r.isActive).length
        };
    }

    /**
     * Regional Professional Tax (PT) Slab Evaluator
     * Evaluates monthly gross earnings against regional slab matrices
     */
    function calculateProfessionalTax(state, monthlyGross, month = 1) {
        if (!state) state = "All India";
        const cleanState = String(state).trim().toLowerCase();

        // 1. Karnataka
        if (cleanState.includes('karnataka')) {
            // Slabs: Gross < 25000: 0; Gross >= 25000: 200
            return monthlyGross >= 25000 ? 200 : 0;
        }

        // 2. Maharashtra
        if (cleanState.includes('maharashtra')) {
            // Men / Unisex: Gross <= 7500: 0; 7501 to 10000: 175; > 10000: 200 (February: 300)
            if (monthlyGross <= 7500) return 0;
            if (monthlyGross <= 10000) return 175;
            return month === 2 ? 300 : 200;
        }

        // 3. Tamil Nadu
        if (cleanState.includes('tamil nadu') || cleanState.includes('tamilnadu')) {
            // Half-yearly divided by 6 (~approx monthly)
            if (monthlyGross < 21000) return 0;
            if (monthlyGross < 30000) return 100;
            if (monthlyGross < 45000) return 235;
            if (monthlyGross < 60000) return 310;
            return 370;
        }

        // 4. Telangana / Andhra Pradesh
        if (cleanState.includes('telangana') || cleanState.includes('andhra')) {
            if (monthlyGross <= 15000) return 0;
            if (monthlyGross <= 20000) return 150;
            return 200;
        }

        // 5. Gujarat
        if (cleanState.includes('gujarat')) {
            if (monthlyGross < 12000) return 0;
            return 200;
        }

        // 6. West Bengal
        if (cleanState.includes('bengal')) {
            if (monthlyGross <= 10000) return 0;
            if (monthlyGross <= 15000) return 110;
            if (monthlyGross <= 25000) return 130;
            if (monthlyGross <= 40000) return 150;
            return 200;
        }

        // 7. Delhi / Rajasthan / Other states with No PT
        if (cleanState.includes('delhi') || cleanState.includes('rajasthan') || cleanState.includes('all india')) {
            return 0;
        }

        // Generic fallback if unknown state but gross is significant
        return monthlyGross >= 25000 ? 200 : 0;
    }

    /**
     * Labour Welfare Fund (LWF) Calculator
     */
    function calculateLabourWelfareFund(state, monthlyGross, month = 12) {
        const cleanState = String(state || '').trim().toLowerCase();

        // Karnataka: Annual in December
        if (cleanState.includes('karnataka')) {
            if (month === 12) {
                return { employee: 20, employer: 40 };
            }
            return { employee: 0, employer: 0 };
        }

        // Maharashtra: Bi-annual in June & December
        if (cleanState.includes('maharashtra')) {
            if (month === 6 || month === 12) {
                const ee = monthlyGross > 3000 ? 12 : 6;
                const er = ee * 3;
                return { employee: ee, employer: er };
            }
            return { employee: 0, employer: 0 };
        }

        return { employee: 0, employer: 0 };
    }

    /**
     * ========================================================================
     * DYNAMIC PAYROLL STATUTORY DEDUCTION ENGINE (PRD Section 4)
     * ========================================================================
     * Evaluates employee gross earnings and structure against applicable rules:
     * - EPF & EPS (12% employee, 3.67% EPF + 8.33% EPS employer)
     * - ESIC (<= 21,000 ceiling, 0.75% EE, 3.25% ER)
     * - PT (State specific slab matrices)
     * - LWF & Gratuity liabilities
     */
    function calculateStatutoryDeductions(employee, compensation, payrollCycle = {}, orgId = 'org_default') {
        const rules = getAllComplianceRules(orgId);
        const cycleMonth = payrollCycle.month || (new Date().getMonth() + 1);
        const cycleYear = payrollCycle.year || new Date().getFullYear();

        const grossSalary = Number(compensation.grossSalary || compensation.gross_salary || 0);
        let basicSalary = Number(compensation.basic || compensation.basicSalary || (grossSalary * 0.5));
        if (isNaN(basicSalary) || basicSalary <= 0) {
            basicSalary = Math.round(grossSalary * 0.5);
        }

        const employeeState = employee.state || employee.locationState || employee.location_state || "All India";

        // Find configured rules
        const pfRule = rules.find(r => r.complianceCode === 'COMP_PF' && r.isApplicable && r.isActive);
        const esiRule = rules.find(r => r.complianceCode === 'COMP_ESI' && r.isApplicable && r.isActive);
        const ptRule = rules.find(r => (r.complianceCode.startsWith('COMP_PT') || r.complianceName.includes('Professional Tax')) && r.isApplicable && r.isActive);
        const lwfRule = rules.find(r => (r.complianceCode.startsWith('COMP_LWF') || r.complianceName.includes('Labour Welfare')) && r.isApplicable && r.isActive);
        const gratuityRule = rules.find(r => r.complianceCode === 'COMP_GRATUITY' && r.isApplicable && r.isActive);

        // -------------------------------------------------------------
        // 1. Employees Provident Fund (EPF & EPS)
        // -------------------------------------------------------------
        let epfWages = 0;
        let epsWages = 0;
        let employeePf = 0;
        let employerEps = 0;
        let employerPf = 0;
        let employerPfTotal = 0;

        // Check if employee opted out or exempt
        const pfApplicable = employee.pfApplicable !== false && employee.isPfEligible !== false;

        if (pfRule && pfApplicable) {
            const wageCeiling = typeof pfRule.wageCeiling === 'number' ? pfRule.wageCeiling : 15000;
            // Standard policy caps PF wages at 15,000 unless actual basic is mandated
            const restrictToCeiling = employee.pfContributionType !== 'ACTUAL_WAGE';
            epfWages = restrictToCeiling ? Math.min(basicSalary, wageCeiling) : basicSalary;

            // EPS is legally capped at 15,000 in India
            epsWages = Math.min(basicSalary, wageCeiling);

            // Employee PF: 12% of EPF wages
            const eeRate = typeof pfRule.employeeContributionRate === 'number' ? pfRule.employeeContributionRate : 12.0;
            employeePf = Math.round(epfWages * (eeRate / 100));

            // Employer Split: 8.33% to EPS (capped at 1250 INR for 15,000 wage), balance to EPF
            employerEps = Math.min(Math.round(epsWages * (8.33 / 100)), 1250);
            employerPf = Math.max(employeePf - employerEps, 0);
            employerPfTotal = employeePf; // Total ER PF match equals 12%
        }

        // -------------------------------------------------------------
        // 2. Employees State Insurance (ESIC)
        // -------------------------------------------------------------
        let esicWages = 0;
        let employeeEsic = 0;
        let employerEsic = 0;

        const esicApplicable = employee.esicApplicable !== false && employee.isEsicEligible !== false;
        if (esiRule && esicApplicable) {
            const esiCeiling = typeof esiRule.wageCeiling === 'number' ? esiRule.wageCeiling : 21000;
            // Eligible only if gross salary is within the wage ceiling
            if (grossSalary <= esiCeiling) {
                esicWages = grossSalary;
                const eeRate = typeof esiRule.employeeContributionRate === 'number' ? esiRule.employeeContributionRate : 0.75;
                const erRate = typeof esiRule.employerContributionRate === 'number' ? esiRule.employerContributionRate : 3.25;

                employeeEsic = Math.ceil(grossSalary * (eeRate / 100));
                employerEsic = Math.ceil(grossSalary * (erRate / 100));
            }
        }

        // -------------------------------------------------------------
        // 3. Professional Tax (PT)
        // -------------------------------------------------------------
        let professionalTax = 0;
        const ptApplicable = employee.ptApplicable !== false;
        if (ptRule && ptApplicable) {
            professionalTax = calculateProfessionalTax(employeeState, grossSalary, cycleMonth);
        }

        // -------------------------------------------------------------
        // 4. Labour Welfare Fund (LWF)
        // -------------------------------------------------------------
        let employeeLwf = 0;
        let employerLwf = 0;
        const lwfApplicable = employee.lwfApplicable !== false;
        if (lwfRule && lwfApplicable) {
            const lwfCalc = calculateLabourWelfareFund(employeeState, grossSalary, cycleMonth);
            employeeLwf = lwfCalc.employee;
            employerLwf = lwfCalc.employer;
        }

        // -------------------------------------------------------------
        // 5. Gratuity Accrual Provision (Employer Liability)
        // -------------------------------------------------------------
        let gratuityAccrual = 0;
        if (gratuityRule && employee.gratuityApplicable !== false) {
            // Standard gratuity formula: (15 / 26) * Basic / 12 months (~ 4.81% of Basic)
            const erRate = typeof gratuityRule.employerContributionRate === 'number' ? gratuityRule.employerContributionRate : 4.81;
            gratuityAccrual = Math.round(basicSalary * (erRate / 100));
        }

        // -------------------------------------------------------------
        // Aggregate Statutory Ledger Totals
        // -------------------------------------------------------------
        const totalEmployeeDeductions = employeePf + employeeEsic + professionalTax + employeeLwf;
        const totalEmployerContributions = employerPfTotal + employerEsic + employerLwf + gratuityAccrual;

        return {
            employeeDeductions: {
                pf: employeePf,
                esic: employeeEsic,
                pt: professionalTax,
                lwf: employeeLwf,
                total: totalEmployeeDeductions
            },
            employerContributions: {
                pfEpf: employerPf,
                pfEps: employerEps,
                pfTotal: employerPfTotal,
                esic: employerEsic,
                lwf: employerLwf,
                gratuity: gratuityAccrual,
                total: totalEmployerContributions
            },
            statutoryWages: {
                grossSalary: grossSalary,
                basicSalary: basicSalary,
                epfWages: epfWages,
                epsWages: epsWages,
                esicWages: esicWages
            },
            netTakeHomeImpact: -totalEmployeeDeductions,
            breakdownNotes: [
                `EPF Employee: ${employeePf} (Wages: ${epfWages})`,
                `ESIC Employee: ${employeeEsic} (Gross: ${grossSalary} <= 21000: ${grossSalary <= 21000 ? 'YES' : 'NO'})`,
                `PT (${employeeState}): ${professionalTax}`,
                `Total Statutory Deductions: ${totalEmployeeDeductions}`
            ]
        };
    }

    /**
     * ========================================================================
     * ALERT MONITOR & COMPLIANCE DEADLINE TRACKER (PRD Section 11)
     * ========================================================================
     * Evaluates active Due_Date_Day for each statutory policy against current date.
     * Fires automated reminders:
     * - 5-day warning (e.g. 10th for due date 15th)
     * - 2-day urgent reminder (e.g. 13th for due date 15th)
     * - Due today reminder (on 15th)
     * - Overdue alert (> 15th)
     */
    function evaluateComplianceDeadlines(currentDate = new Date(), orgId = 'org_default') {
        const rules = getAllComplianceRules(orgId);
        const refDate = currentDate instanceof Date ? currentDate : new Date(currentDate);
        const currentDay = refDate.getDate();
        const currentMonth = refDate.getMonth() + 1;
        const currentYear = refDate.getFullYear();

        const alerts = [];

        for (const rule of rules) {
            if (!rule.isActive || !rule.isApplicable) continue;

            const dueDay = rule.dueDateDay || 15;
            const daysRemaining = dueDay - currentDay;

            let status = 'UPCOMING';
            let shouldAlert = false;
            let severity = 'info';
            let message = '';

            if (daysRemaining === 5) {
                status = 'REMINDER_5_DAYS';
                shouldAlert = true;
                severity = 'warning';
                message = `${rule.complianceName} monthly challan is due in 5 days (Due Day: ${dueDay}). Ensure payroll reconciliation is complete.`;
            } else if (daysRemaining === 2) {
                status = 'URGENT_2_DAYS';
                shouldAlert = true;
                severity = 'critical';
                message = `URGENT: ${rule.complianceName} remittance is due in 48 hours (Due Day: ${dueDay}). Generate and file export returns immediately.`;
            } else if (daysRemaining === 0) {
                status = 'DUE_TODAY';
                shouldAlert = true;
                severity = 'critical';
                message = `ACTION REQUIRED TODAY: ${rule.complianceName} statutory remittance deadline is TODAY (Day ${dueDay}).`;
            } else if (daysRemaining < 0) {
                status = 'OVERDUE';
                shouldAlert = true;
                severity = 'critical';
                message = `ESCALATION: ${rule.complianceName} remittance deadline was missed on day ${dueDay} (${Math.abs(daysRemaining)} days overdue). Statutory penalties may apply.`;
            }

            // Export links based on compliance code
            let exportUrl = '';
            let exportFormat = '';
            if (rule.complianceCode === 'COMP_PF') {
                exportUrl = `/api/admin/statutory/export-ecr?cycleMonth=${currentYear}-${String(currentMonth).padStart(2, '0')}`;
                exportFormat = 'EPFO ECR (#~# Delimited Text)';
            } else if (rule.complianceCode === 'COMP_ESI') {
                exportUrl = `/api/admin/statutory/export-esic?cycleMonth=${currentYear}-${String(currentMonth).padStart(2, '0')}`;
                exportFormat = 'ESIC Monthly Return (CSV)';
            } else if (rule.complianceCode.startsWith('COMP_PT')) {
                exportUrl = `/api/admin/statutory/export-pt?state=${encodeURIComponent(rule.state)}&cycleMonth=${currentYear}-${String(currentMonth).padStart(2, '0')}`;
                exportFormat = `${rule.state} PT Challan Form`;
            } else {
                exportUrl = `/api/admin/statutory/export?code=${rule.complianceCode}&cycleMonth=${currentYear}-${String(currentMonth).padStart(2, '0')}`;
                exportFormat = 'Statutory Ledger Export';
            }

            alerts.push({
                complianceCode: rule.complianceCode,
                complianceName: rule.complianceName,
                dueDay: dueDay,
                currentDay: currentDay,
                daysRemaining: daysRemaining,
                status: status,
                shouldAlert: shouldAlert,
                severity: severity,
                message: message,
                exportUrl: exportUrl,
                exportFormat: exportFormat
            });
        }

        return {
            evaluationDate: refDate.toISOString().split('T')[0],
            activeAlertCount: alerts.filter(a => a.shouldAlert).length,
            alerts: alerts
        };
    }

    /**
     * Generates standard EPFO ECR (#~# delimited) format string
     */
    function generateEcrText(payrollRecords = []) {
        // Format: UAN#~#MemberName#~#GrossWages#~#EPFWages#~#EPSWages#~#EDLIWages#~#EE_PF#~#EPS#~#ER_PF#~#NCPDays#~#Refund
        const lines = [];
        for (const rec of payrollRecords) {
            const uan = rec.uan || rec.UAN || "100904829102";
            const name = rec.name || rec.employeeName || "Employee";
            const gross = Math.round(rec.grossSalary || 0);
            const epfWage = Math.round(rec.epfWages || Math.min(rec.basic || gross * 0.5, 15000));
            const epsWage = Math.round(rec.epsWages || Math.min(rec.basic || gross * 0.5, 15000));
            const edliWage = epsWage;
            const eePf = Math.round(rec.employeePf || epfWage * 0.12);
            const eps = Math.round(rec.employerEps || Math.min(epsWage * 0.0833, 1250));
            const erPf = Math.round(rec.employerPf || Math.max(eePf - eps, 0));
            const ncpDays = rec.ncpDays || 0;
            const refund = 0;

            lines.push(`${uan}#~#${name}#~#${gross}#~#${epfWage}#~#${epsWage}#~#${edliWage}#~#${eePf}#~#${eps}#~#${erPf}#~#${ncpDays}#~#${refund}`);
        }
        return lines.join('\n');
    }

    /**
     * Resets local ledger (for testing)
     */
    function _resetLedger() {
        _localLedger.clear();
    }

    return {
        DEFAULT_STATUTORY_POLICIES: DEFAULT_STATUTORY_POLICIES,
        getAllComplianceRules: getAllComplianceRules,
        getComplianceRuleByCode: getComplianceRuleByCode,
        createComplianceRule: createComplianceRule,
        updateComplianceRule: updateComplianceRule,
        deleteComplianceRule: deleteComplianceRule,
        toggleComplianceApplicable: toggleComplianceApplicable,
        toggleComplianceActive: toggleComplianceActive,
        batchUpsertRules: batchUpsertRules,
        calculateProfessionalTax: calculateProfessionalTax,
        calculateLabourWelfareFund: calculateLabourWelfareFund,
        calculateStatutoryDeductions: calculateStatutoryDeductions,
        evaluateComplianceDeadlines: evaluateComplianceDeadlines,
        generateEcrText: generateEcrText,
        _resetLedger: _resetLedger
    };
}));
