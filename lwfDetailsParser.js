/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - LABOUR WELFARE FUND (LWF) STATUTORY MASTER PARSER
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes employee Labour Welfare Fund profiles
 * matching all 10 columns from the 'LWF Details' sheet of Templates.xlsx
 * and PRD Sections 1, 4, 11, & 13:
 * 
 * Exact 10 Attributes:
 * 1.  Employee ID (string, foreign key referencing active employee in Firestore)
 * 2.  Organization ID (string, tenant/org identifier matching active organization context)
 * 3.  LWF Applicable (boolean: true for "Yes", false for "No")
 * 4.  State (string: state jurisdiction e.g., "Karnataka", "Maharashtra", "Delhi", "Tamil Nadu", "Gujarat", "Haryana")
 * 5.  Employer Registration No (string, establishment registration number under State LWF Act)
 * 6.  Employee Contribution (number, fixed statutory deduction amount e.g., 20.00)
 * 7.  Employer Contribution (number, matching employer statutory share e.g., 40.00)
 * 8.  Frequency (string enum: "Monthly", "Quarterly", "Half-Yearly", "Annual")
 * 9.  Effective From (string / ISO Date: YYYY-MM-DD)
 * 10. Effective To (string | null / ISO Date: YYYY-MM-DD)
 * 
 * @version 1.0.0
 * @author Principal Fintech & Statutory Payroll Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxLwfDetailsParser = factory();
        root.lwfDetailsParser = root.KylrxLwfDetailsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        employeeId: [
            'employee id', 'employee_id', 'employeeid', 'emp_id', 'empid', 'emp id',
            'employee no', 'staff_id', 'member_employee_id'
        ],
        organizationId: [
            'organization id', 'organization_id', 'organizationid', 'org_id', 'orgid',
            'org id', 'tenant_id', 'tenantid', 'company_id', 'entity_id'
        ],
        lwfApplicable: [
            'lwf applicable', 'lwf_applicable', 'lwfapplicable', 'is_lwf_applicable',
            'is lwf applicable', 'lwf eligible', 'lwf flag', 'labour welfare fund applicable',
            'lwf applicable (yes/no)', 'is_labour_welfare_fund_applicable'
        ],
        state: [
            'state', 'lwf_state', 'jurisdiction', 'state_jurisdiction', 'applicable_state',
            'lwf jurisdiction', 'work_state', 'lwf state', 'labour welfare fund state'
        ],
        employerRegistrationNo: [
            'employer registration no', 'employer_registration_no', 'employerregistrationno',
            'lwf_registration_no', 'lwf registration no', 'registration no', 'reg no',
            'lwf reg no', 'establishment registration number', 'establishment reg no',
            'employer lwf reg no', 'employer registration number', 'lwf registration number'
        ],
        employeeContribution: [
            'employee contribution', 'employee_contribution', 'employeecontribution',
            'employee contributior', 'employee contributio', 'employee contrib',
            'employeecontributior', 'employeecontributio', 'employeecontrib',
            'ee contribution', 'ee_contribution', 'ee_share', 'employee_share',
            'ee amount', 'employee deduction', 'lwf employee contribution',
            'employee contribution (inr)', 'employee contribution (rs)'
        ],
        employerContribution: [
            'employer contribution', 'employer_contribution', 'employercontribution',
            'employer contributior', 'employer contributio', 'employer contrib',
            'employercontributior', 'employercontributio', 'employercontrib',
            'er contribution', 'er_contribution', 'er_share', 'employer_share',
            'er amount', 'employer lwf share', 'lwf employer contribution',
            'employer contribution (inr)', 'employer contribution (rs)'
        ],
        frequency: [
            'frequency', 'lwf_frequency', 'lwffrequency', 'deduction_frequency',
            'cycle_frequency', 'schedule_frequency', 'contribution_frequency',
            'remittance_frequency', 'lwf frequency'
        ],
        effectiveFrom: [
            'effective from', 'effective_from', 'effectivefrom', 'start_date',
            'lwf_effective_from', 'from_date', 'valid_from', 'effective_date'
        ],
        effectiveTo: [
            'effective to', 'effective_to', 'effectiveto', 'end_date',
            'lwf_effective_to', 'to_date', 'valid_to', 'expiry_date'
        ]
    };

    /**
     * Exact 10 Attributes Schema Definition matching PRD Sections 1, 4, 11, & 13
     */
    const LWF_DETAILS_ATTRIBUTES = [
        { key: "Employee ID", label: "1. Employee ID", required: true, synonyms: HEADER_SYNONYMS.employeeId },
        { key: "Organization ID", label: "2. Organization ID", required: true, defaultValue: "ORG_KYLRX_01", synonyms: HEADER_SYNONYMS.organizationId },
        { key: "LWF Applicable", label: "3. LWF Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.lwfApplicable },
        { key: "State", label: "4. State Jurisdiction", required: true, defaultValue: "Karnataka", synonyms: HEADER_SYNONYMS.state },
        { key: "Employer Registration No", label: "5. Employer Registration No", required: true, defaultValue: "LWF/KA/BNG/2026/0912", synonyms: HEADER_SYNONYMS.employerRegistrationNo },
        { key: "Employee Contribution", label: "6. Employee Contribution (INR)", required: true, defaultValue: 20.00, synonyms: HEADER_SYNONYMS.employeeContribution },
        { key: "Employer Contribution", label: "7. Employer Contribution (INR)", required: true, defaultValue: 40.00, synonyms: HEADER_SYNONYMS.employerContribution },
        { key: "Frequency", label: "8. Frequency", required: true, defaultValue: "Annual", synonyms: HEADER_SYNONYMS.frequency },
        { key: "Effective From", label: "9. Effective From (YYYY-MM-DD)", required: true, defaultValue: "2026-01-01", synonyms: HEADER_SYNONYMS.effectiveFrom },
        { key: "Effective To", label: "10. Effective To (YYYY-MM-DD)", required: false, defaultValue: null, synonyms: HEADER_SYNONYMS.effectiveTo }
    ];

    /**
     * Supported Canonical Frequency Enums
     */
    const VALID_FREQUENCIES = ["Monthly", "Quarterly", "Half-Yearly", "Annual"];

    /**
     * Supported State Jurisdictions per State Labour Welfare Fund Acts
     */
    const SUPPORTED_STATES = [
        "Karnataka", "Maharashtra", "Delhi", "Tamil Nadu", "Gujarat",
        "Haryana", "Telangana", "Andhra Pradesh", "Kerala", "Madhya Pradesh",
        "West Bengal", "Punjab", "Odisha", "Goa", "Chandigarh"
    ];

    /**
     * Standard State LWF Rate & Schedule Configuration Mapping
     */
    const STATE_LWF_DEFAULTS = {
        "Karnataka": {
            frequency: "Annual",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            deductionMonths: [12],
            registrationPrefix: "LWF/KA"
        },
        "Maharashtra": {
            frequency: "Half-Yearly",
            employeeContribution: 12.00,
            employerContribution: 36.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/MH"
        },
        "Delhi": {
            frequency: "Half-Yearly",
            employeeContribution: 0.75,
            employerContribution: 2.25,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/DL"
        },
        "Tamil Nadu": {
            frequency: "Annual",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            deductionMonths: [12],
            registrationPrefix: "LWF/TN"
        },
        "Gujarat": {
            frequency: "Half-Yearly",
            employeeContribution: 6.00,
            employerContribution: 12.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/GJ"
        },
        "Haryana": {
            frequency: "Monthly",
            employeeContribution: 25.00,
            employerContribution: 50.00,
            deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            registrationPrefix: "LWF/HR"
        },
        "Telangana": {
            frequency: "Annual",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            deductionMonths: [12],
            registrationPrefix: "LWF/TS"
        },
        "Andhra Pradesh": {
            frequency: "Annual",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            deductionMonths: [12],
            registrationPrefix: "LWF/AP"
        },
        "Madhya Pradesh": {
            frequency: "Half-Yearly",
            employeeContribution: 10.00,
            employerContribution: 30.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/MP"
        },
        "Kerala": {
            frequency: "Half-Yearly",
            employeeContribution: 20.00,
            employerContribution: 20.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/KL"
        }
    };

    /**
     * Normalizes an object key to lowercase alphanumeric string for robust matching.
     */
    function normalizeKey(str) {
        if (!str && str !== 0) return '';
        return String(str).toLowerCase().trim().replace(/[\s_\-/#()]+/g, '');
    }

    /**
     * Finds and retrieves value from row by canonical header synonyms.
     * Resiliently handles header truncations (e.g., "Employee Contributior", "Employer Contributior").
     */
    function getVal(row, synonymList) {
        if (!row || typeof row !== 'object') return undefined;
        const normalizedSynonyms = synonymList.map(s => normalizeKey(s));
        
        // 1. Exact normalized match
        for (const [k, v] of Object.entries(row)) {
            if (normalizedSynonyms.includes(normalizeKey(k))) {
                if (v !== undefined && v !== null && String(v).trim() !== '') {
                    return v;
                }
            }
        }

        // 2. Fuzzy / truncation stem match (e.g. "employeecontributior", "employercontributior")
        for (const [k, v] of Object.entries(row)) {
            const normK = normalizeKey(k);
            if (v !== undefined && v !== null && String(v).trim() !== '') {
                for (const syn of normalizedSynonyms) {
                    if (syn.length >= 8 && (normK.startsWith(syn.slice(0, 12)) || syn.startsWith(normK.slice(0, 12)))) {
                        return v;
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Parses boolean representation safely.
     */
    function parseBoolean(val, defaultVal = false) {
        if (val === undefined || val === null || String(val).trim() === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'applicable' || s === 'active';
    }

    /**
     * Normalizes date inputs to strict ISO YYYY-MM-DD string.
     */
    function sanitizeDate(val) {
        if (!val && val !== 0) return null;
        if (typeof val === 'number') {
            // Excel serial date number
            const dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
            if (!isNaN(dateObj.getTime())) {
                const y = dateObj.getUTCFullYear();
                const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
                const d = String(dateObj.getUTCDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }
        }
        const str = String(val).trim();
        if (!str) return null;

        // Matches YYYY-MM-DD or YYYY/MM/DD
        const ymdMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
        if (ymdMatch) {
            const year = ymdMatch[1];
            const month = ymdMatch[2].padStart(2, '0');
            const day = ymdMatch[3].padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        // Matches DD-MM-YYYY or DD/MM/YYYY
        const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (dmyMatch) {
            const day = dmyMatch[1].padStart(2, '0');
            const month = dmyMatch[2].padStart(2, '0');
            const year = dmyMatch[3];
            return `${year}-${month}-${day}`;
        }

        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
            const y = parsed.getFullYear();
            const m = String(parsed.getMonth() + 1).padStart(2, '0');
            const d = String(parsed.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        return null;
    }

    /**
     * Normalizes state name to proper canonical capitalization.
     */
    function normalizeState(stateStr) {
        if (!stateStr) return 'Karnataka';
        const clean = String(stateStr).trim().toLowerCase();
        const found = SUPPORTED_STATES.find(s => s.toLowerCase() === clean);
        return found || String(stateStr).trim();
    }

    /**
     * Normalizes Frequency string to one of the canonical enums ("Monthly", "Quarterly", "Half-Yearly", "Annual").
     */
    function normalizeFrequency(freqStr, fallbackState = null) {
        if (!freqStr || String(freqStr).trim() === '') {
            if (fallbackState && STATE_LWF_DEFAULTS[fallbackState]) {
                return STATE_LWF_DEFAULTS[fallbackState].frequency;
            }
            return 'Annual';
        }
        const s = String(freqStr).trim().toLowerCase().replace(/[\s_-]+/g, '');
        if (s === 'monthly' || s === 'month') return 'Monthly';
        if (s === 'quarterly' || s === 'quarter' || s === 'qtr') return 'Quarterly';
        if (s === 'halfyearly' || s === 'halfyear' || s === 'semiannual' || s === 'semiannually' || s === 'biannual' || s === 'biannually') return 'Half-Yearly';
        if (s === 'annual' || s === 'annually' || s === 'yearly' || s === 'year') return 'Annual';

        // Check if raw string closely matches any valid enum
        const exact = VALID_FREQUENCIES.find(f => f.toLowerCase() === String(freqStr).trim().toLowerCase());
        return exact || String(freqStr).trim();
    }

    /**
     * Resolves statutory deduction schedule months given frequency and state.
     */
    function resolveDeductionSchedule(frequency, state = "Karnataka", referenceDate = new Date()) {
        const normFreq = normalizeFrequency(frequency, state);
        let deductionMonths = [12]; // Default Annual in December

        if (normFreq === 'Monthly') {
            deductionMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        } else if (normFreq === 'Quarterly') {
            deductionMonths = [3, 6, 9, 12];
        } else if (normFreq === 'Half-Yearly') {
            deductionMonths = [6, 12];
        } else if (normFreq === 'Annual') {
            if (state && STATE_LWF_DEFAULTS[state]?.deductionMonths) {
                deductionMonths = [...STATE_LWF_DEFAULTS[state].deductionMonths];
            } else {
                deductionMonths = [12];
            }
        }

        // Determine next upcoming deduction month
        const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
        const currYear = isNaN(ref.getTime()) ? new Date().getFullYear() : ref.getFullYear();
        const currMonth = isNaN(ref.getTime()) ? (new Date().getMonth() + 1) : (ref.getMonth() + 1);

        let nextMonth = null;
        let nextYear = currYear;

        const futureMonthInCurrYear = deductionMonths.find(m => m >= currMonth);
        if (futureMonthInCurrYear !== undefined) {
            nextMonth = futureMonthInCurrYear;
        } else {
            // Rolls over to the first deduction month in next calendar year
            nextMonth = deductionMonths[0];
            nextYear = currYear + 1;
        }

        const nextDeduction = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

        return {
            deductionMonths,
            nextDeduction
        };
    }

    /**
     * Validates a single record against LWF Statutory rules and PRD Section 1 constraints.
     */
    function validateRecord(record, optionsOrRowNumber = {}, maybeOptions = {}) {
        const options = (typeof optionsOrRowNumber === 'object' && optionsOrRowNumber !== null) 
            ? optionsOrRowNumber 
            : ((typeof maybeOptions === 'object' && maybeOptions !== null) ? maybeOptions : {});

        const errors = [];
        const warnings = [];

        const empId = record['Employee ID'] !== undefined ? record['Employee ID'] : record.employeeId;
        const orgId = record['Organization ID'] !== undefined ? record['Organization ID'] : record.organizationId;
        const isLwfApplicable = record['LWF Applicable'] === true || String(record['LWF Applicable']).toLowerCase() === 'yes' || record.isLwfApplicable === true;
        const state = record['State'] !== undefined ? record['State'] : record.state;
        const regNo = record['Employer Registration No'] !== undefined ? record['Employer Registration No'] : record.employerRegistrationNo;
        const eeContrib = record['Employee Contribution'] !== undefined ? record['Employee Contribution'] : record.employeeContribution;
        const erContrib = record['Employer Contribution'] !== undefined ? record['Employer Contribution'] : record.employerContribution;
        const frequency = record['Frequency'] !== undefined ? record['Frequency'] : record.frequency;
        const effectiveFrom = record['Effective From'] !== undefined ? record['Effective From'] : record.effectiveFrom;
        const effectiveTo = record['Effective To'] !== undefined ? record['Effective To'] : record.effectiveTo;

        // 1. Mandatory Employee ID
        if (!empId || String(empId).trim() === '') {
            errors.push("Missing required field: 'Employee ID'.");
        }

        // 2. Cross-Sheet Foreign Key Validation
        if (empId && options.existingEmployeeIds) {
            const hasEmp = options.existingEmployeeIds instanceof Set
                ? options.existingEmployeeIds.has(String(empId).trim())
                : Array.isArray(options.existingEmployeeIds)
                    ? options.existingEmployeeIds.includes(String(empId).trim())
                    : true;
            if (!hasEmp) {
                errors.push(`Foreign key validation failed: Employee ID '${empId}' does not match any active employee profile in the catalog.`);
            }
        }

        // 3. Organization ID Tenant Validation
        if (!orgId || String(orgId).trim() === '') {
            errors.push("Missing required field: 'Organization ID'.");
        } else if (options.orgId && String(orgId).trim().toLowerCase() !== String(options.orgId).trim().toLowerCase()) {
            errors.push(`Organization ID '${orgId}' does not match current tenant context '${options.orgId}'.`);
        }

        // 4. Conditional Integrity & Discrepancy Flagging when LWF is Applicable
        if (isLwfApplicable) {
            if (!state || String(state).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory State jurisdiction when 'LWF Applicable' is Yes.");
            }

            if (!regNo || String(regNo).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory 'Employer Registration No' (establishment registration under State LWF Act) when 'LWF Applicable' is Yes.");
            }

            if (!frequency || String(frequency).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory 'Frequency' when 'LWF Applicable' is Yes.");
            } else if (!VALID_FREQUENCIES.includes(normalizeFrequency(frequency))) {
                errors.push(`Invalid Frequency '${frequency}'. Must match canonical enum: "Monthly", "Quarterly", "Half-Yearly", or "Annual".`);
            }

            if (!effectiveFrom || String(effectiveFrom).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory 'Effective From' date when 'LWF Applicable' is Yes.");
            }
        } else {
            // When LWF is not applicable, frequency if supplied must still be valid enum if non-empty
            if (frequency && String(frequency).trim() !== '' && !VALID_FREQUENCIES.includes(normalizeFrequency(frequency))) {
                errors.push(`Invalid Frequency '${frequency}'. Must match canonical enum: "Monthly", "Quarterly", "Half-Yearly", or "Annual".`);
            }
        }

        // 5. Numeric Validation: Employee Contribution
        if (eeContrib !== undefined && eeContrib !== null && String(eeContrib).trim() !== '') {
            const num = Number(eeContrib);
            if (isNaN(num) || num < 0) {
                errors.push(`Invalid 'Employee Contribution' value '${eeContrib}'. Employee Contribution cannot be negative (must be a valid non-negative number).`);
            }
        }

        // 6. Numeric Validation: Employer Contribution
        if (erContrib !== undefined && erContrib !== null && String(erContrib).trim() !== '') {
            const num = Number(erContrib);
            if (isNaN(num) || num < 0) {
                errors.push(`Invalid 'Employer Contribution' value '${erContrib}'. Employer Contribution cannot be negative (must be a valid non-negative number).`);
            }
        }

        // 7. Date Sequence Integrity (Effective To >= Effective From)
        if (effectiveFrom && effectiveTo) {
            const fromDate = new Date(effectiveFrom);
            const toDate = new Date(effectiveTo);
            if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
                if (toDate < fromDate) {
                    errors.push(`Date sequence integrity violated: 'Effective To' (${effectiveTo}) cannot precede 'Effective From' (${effectiveFrom}). Effective To date must be on or after Effective From date.`);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Converts raw parsed record into canonical Cloud Firestore document schema:
     * Path: organizations/{orgId}/employee_lwf_details/{employeeId}
     */
    function toFirestoreDoc(record, options = {}) {
        const orgId = record['Organization ID'] || record.organizationId || options.orgId || 'ORG_KYLRX_01';
        const empId = record['Employee ID'] || record.employeeId;
        const isLwfApplicable = record['LWF Applicable'] === true || String(record['LWF Applicable']).trim().toLowerCase() === 'yes' || record.isLwfApplicable === true;
        const stateName = normalizeState(record['State'] || record.state);
        const normFrequency = normalizeFrequency(record['Frequency'] || record.frequency, stateName);

        let eeContribNum = 0;
        const rawEe = record['Employee Contribution'] !== undefined ? record['Employee Contribution'] : record.employeeContribution;
        if (rawEe !== undefined && rawEe !== null && String(rawEe).trim() !== '') {
            const p = parseFloat(rawEe);
            eeContribNum = !isNaN(p) ? Math.max(0, Math.round(p * 100) / 100) : 0;
        } else if (isLwfApplicable && STATE_LWF_DEFAULTS[stateName]) {
            eeContribNum = STATE_LWF_DEFAULTS[stateName].employeeContribution;
        }

        let erContribNum = 0;
        const rawEr = record['Employer Contribution'] !== undefined ? record['Employer Contribution'] : record.employerContribution;
        if (rawEr !== undefined && rawEr !== null && String(rawEr).trim() !== '') {
            const p = parseFloat(rawEr);
            erContribNum = !isNaN(p) ? Math.max(0, Math.round(p * 100) / 100) : 0;
        } else if (isLwfApplicable && STATE_LWF_DEFAULTS[stateName]) {
            erContribNum = STATE_LWF_DEFAULTS[stateName].employerContribution;
        }

        const schedule = resolveDeductionSchedule(normFrequency, stateName, record['Effective From'] || record.effectiveFrom || new Date());
        const defaultRegNo = isLwfApplicable ? `LWF/${stateName.slice(0, 2).toUpperCase()}/BNG/2026/0912` : null;

        return {
            employeeId: String(empId).trim(),
            organizationId: String(orgId).trim(),
            isLwfApplicable: isLwfApplicable,
            state: stateName,
            employerRegistrationNo: record['Employer Registration No'] || record.employerRegistrationNo || defaultRegNo,
            employeeContribution: eeContribNum,
            employerContribution: erContribNum,
            frequency: normFrequency,
            effectiveFrom: record['Effective From'] || record.effectiveFrom || '2026-01-01',
            effectiveTo: record['Effective To'] || record.effectiveTo || null,
            deductionSchedule: {
                deductionMonths: schedule.deductionMonths,
                nextDeduction: schedule.nextDeduction
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Parses a single row into structured 10-attribute LWF record
     */
    function parseRecord(row, rowNumber = 1, options = {}) {
        const defaultOrgId = options.orgId || 'ORG_KYLRX_01';
        const rawEmpId = getVal(row, HEADER_SYNONYMS.employeeId);
        const rawOrgId = getVal(row, HEADER_SYNONYMS.organizationId) || defaultOrgId;
        const rawLwfApp = getVal(row, HEADER_SYNONYMS.lwfApplicable);
        const rawState = getVal(row, HEADER_SYNONYMS.state);
        const rawRegNo = getVal(row, HEADER_SYNONYMS.employerRegistrationNo);
        const rawEe = getVal(row, HEADER_SYNONYMS.employeeContribution);
        const rawEr = getVal(row, HEADER_SYNONYMS.employerContribution);
        const rawFreq = getVal(row, HEADER_SYNONYMS.frequency);
        const rawEffectiveFrom = getVal(row, HEADER_SYNONYMS.effectiveFrom);
        const rawEffectiveTo = getVal(row, HEADER_SYNONYMS.effectiveTo);

        const isLwfApplicable = parseBoolean(rawLwfApp, true);
        const stateNormalized = rawState ? normalizeState(rawState) : '';
        const normFrequency = (rawFreq !== undefined && rawFreq !== null && String(rawFreq).trim() !== '')
            ? normalizeFrequency(rawFreq, stateNormalized)
            : '';

        const sanitizedFrom = sanitizeDate(rawEffectiveFrom);
        const sanitizedTo = sanitizeDate(rawEffectiveTo);

        let eeContribVal = 0;
        if (rawEe !== undefined && rawEe !== null && String(rawEe).trim() !== '') {
            const p = parseFloat(rawEe);
            eeContribVal = !isNaN(p) ? Math.round(p * 100) / 100 : 0;
        } else if (isLwfApplicable && stateNormalized && STATE_LWF_DEFAULTS[stateNormalized]) {
            eeContribVal = STATE_LWF_DEFAULTS[stateNormalized].employeeContribution;
        }

        let erContribVal = 0;
        if (rawEr !== undefined && rawEr !== null && String(rawEr).trim() !== '') {
            const p = parseFloat(rawEr);
            erContribVal = !isNaN(p) ? Math.round(p * 100) / 100 : 0;
        } else if (isLwfApplicable && stateNormalized && STATE_LWF_DEFAULTS[stateNormalized]) {
            erContribVal = STATE_LWF_DEFAULTS[stateNormalized].employerContribution;
        }

        const regNoVal = rawRegNo ? String(rawRegNo).trim() : '';

        const record = {
            'Employee ID': rawEmpId ? String(rawEmpId).trim() : '',
            'Organization ID': rawOrgId ? String(rawOrgId).trim() : defaultOrgId,
            'LWF Applicable': isLwfApplicable ? 'Yes' : 'No',
            'State': stateNormalized,
            'Employer Registration No': regNoVal,
            'Employee Contribution': eeContribVal,
            'Employer Contribution': erContribVal,
            'Frequency': normFrequency,
            'Effective From': sanitizedFrom,
            'Effective To': sanitizedTo,
            // CamelCase aliases
            employeeId: rawEmpId ? String(rawEmpId).trim() : '',
            organizationId: rawOrgId ? String(rawOrgId).trim() : defaultOrgId,
            isLwfApplicable,
            state: stateNormalized,
            employerRegistrationNo: regNoVal,
            employeeContribution: eeContribVal,
            employerContribution: erContribVal,
            frequency: normFrequency,
            effectiveFrom: sanitizedFrom,
            effectiveTo: sanitizedTo
        };

        return record;
    }

    /**
     * Ingests, normalizes, and validates all rows from 'LWF Details' sheet.
     * Generates structured 10-attribute records, Firestore payloads, and row-level error reports.
     * 
     * @param {Array<Object>} rows Raw SheetJS JSON rows
     * @param {Object} options Optional context { existingEmployeeIds, orgId }
     * @returns {Object} { valid, totalRows, validCount, errorCount, records, firestoreDocs, errors }
     */
    function parseSheetRows(rows, options = {}) {
        if (!Array.isArray(rows)) {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                records: [],
                firestoreDocs: [],
                errors: [{ row: 0, message: "Input data must be a valid array of sheet row objects.", includes: (s) => ("Input data must be a valid array of sheet row objects.").includes(s) }]
            };
        }

        const records = [];
        const firestoreDocs = [];
        const errors = [];
        const seenEmpIds = new Set();

        rows.forEach((row, index) => {
            const rowNumber = index + 1;

            // Skip entirely blank rows
            const values = Object.values(row).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (values.length === 0) return;

            const record = parseRecord(row, rowNumber, options);

            const validationTarget = {
                ...record,
                'LWF Applicable': record.isLwfApplicable
            };

            const validation = validateRecord(validationTarget, options);

            // Duplicate detection within the sheet
            if (record['Employee ID']) {
                if (seenEmpIds.has(record['Employee ID'])) {
                    validation.valid = false;
                    validation.errors.push(`Duplicate Employee ID '${record['Employee ID']}' detected in sheet at row ${rowNumber}.`);
                } else {
                    seenEmpIds.add(record['Employee ID']);
                }
            }

            if (!validation.valid) {
                validation.errors.forEach(msg => {
                    const fullMsg = `Row ${rowNumber}: ${msg}`;
                    errors.push({
                        row: rowNumber,
                        employeeId: record['Employee ID'] || `Row_${rowNumber}`,
                        message: fullMsg,
                        toString: () => fullMsg,
                        includes: (str) => fullMsg.includes(str)
                    });
                });
            } else {
                records.push(record);
                firestoreDocs.push(toFirestoreDoc(record, options));
            }
        });

        return {
            valid: errors.length === 0,
            totalRows: rows.length,
            validCount: records.length,
            errorCount: errors.length,
            records,
            firestoreDocs,
            errors
        };
    }

    return {
        LWF_DETAILS_ATTRIBUTES,
        HEADER_SYNONYMS,
        VALID_FREQUENCIES,
        SUPPORTED_STATES,
        STATE_LWF_DEFAULTS,
        normalizeKey,
        sanitizeDate,
        normalizeDate: sanitizeDate,
        parseBoolean,
        normalizeBoolean: parseBoolean,
        normalizeState,
        normalizeFrequency,
        resolveDeductionSchedule,
        parseRecord,
        validateRecord,
        toFirestoreDoc,
        parseSheetRows
    };
}));
