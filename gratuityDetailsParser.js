/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - GRATUITY STATUTORY MASTER PARSER
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes employee Gratuity profiles
 * matching all 18 columns from the 'Gratuity Details' sheet of Templates.xlsx
 * and PRD Sections 1, 4, 11, & 13 (Payment of Gratuity Act, 1972):
 * 
 * Exact 18 Attributes:
 * 1.  Employee ID (string, foreign key referencing active employee in Firestore)
 * 2.  Organization ID (string, tenant/org identifier matching active organization context)
 * 3.  Gratuity Applicable (boolean: true for "Yes", false for "No")
 * 4.  Date of Joining (string / ISO Date: YYYY-MM-DD)
 * 5.  Date of Exit (string | null / ISO Date: YYYY-MM-DD)
 * 6.  Continuous Service (Years) (number, total tenure in years)
 * 7.  Gratuity Eligibility Status (string enum: "ELIGIBLE", "NOT_ELIGIBLE", "VESTED", "EXEMPTED")
 * 8.  Last Drawn Basic (number, last drawn Basic pay)
 * 9.  Last Drawn DA (number, last drawn Dearness Allowance)
 * 10. Last Drawn Wages / Eligible Salary (number, sum of Last Drawn Basic + DA)
 * 11. Completed Years for Gratuity (number, rounded qualifying service years)
 * 12. Accrued Gratuity Amount (number, accrued liability or settlement amount)
 * 13. Gratuity Calculation Basis (string enum: "15/26 Formula", "30/26 Formula", "Trust Rule", "Custom")
 * 14. Scheme / Policy Name (string, insurer trust scheme name e.g., "LIC Group Gratuity Scheme", "Self Managed Trust")
 * 15. Nominee Details Status (string enum: "SUBMITTED", "VERIFIED", "PENDING", "NOT_SUBMITTED")
 * 16. Payment Status (string enum: "ACCRUING", "PENDING_SETTLEMENT", "APPROVED", "DISBURSED", "FORFEITED")
 * 17. Payment Date (string | null / ISO Date: YYYY-MM-DD)
 * 18. Payment Reference (string | null, Decentro payout UTR or bank transaction reference)
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
        root.KylrxGratuityDetailsParser = factory();
        root.gratuityDetailsParser = root.KylrxGratuityDetailsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping with truncation resilience
    const HEADER_SYNONYMS = {
        employeeId: [
            'employee id', 'employee_id', 'employeeid', 'emp_id', 'empid', 'emp id',
            'employee no', 'staff_id', 'member_employee_id'
        ],
        organizationId: [
            'organization id', 'organization_id', 'organizationid', 'org_id', 'orgid',
            'org id', 'tenant_id', 'tenantid', 'company_id', 'entity_id'
        ],
        gratuityApplicable: [
            'gratuity applicable', 'gratuity_applicable', 'gratuityapplicable', 'is_gratuity_applicable',
            'is gratuity applicable', 'gratuity eligible', 'gratuity flag', 'payment of gratuity applicable',
            'gratuity applicable (yes/no)', 'is_payment_of_gratuity_applicable', 'gratuity applicable?'
        ],
        dateOfJoining: [
            'date of joining', 'date_of_joining', 'dateofjoining', 'joining date',
            'joining_date', 'join date', 'doj', 'emp_doj', 'appointment date',
            'date of appointment', 'service start date', 'start date'
        ],
        dateOfExit: [
            'date of exit', 'date_of_exit', 'dateofexit', 'exit date', 'exit_date',
            'separation date', 'date of separation', 'date of relief', 'relieving date',
            'doe', 'emp_doe', 'last working day', 'lwd', 'date of leaving'
        ],
        continuousServiceYears: [
            'continuous service (years)', 'continuous service (years', 'continuous service years',
            'continuous_service_years', 'continuousserviceyears', 'continuous service',
            'tenure years', 'tenure (years)', 'service tenure', 'service period (years)',
            'total service years', 'tenure_years'
        ],
        gratuityEligibilityStatus: [
            'gratuity eligibility status', 'gratuity_eligibility_status', 'gratuityeligibilitystatus',
            'eligibility status', 'eligibility_status', 'vesting status', 'vesting_status',
            'gratuity status', 'eligibility', 'vested status'
        ],
        lastDrawnBasic: [
            'last drawn basic', 'last_drawn_basic', 'lastdrawnbasic', 'basic pay',
            'basic salary', 'last basic', 'last basic salary', 'basic_pay', 'basic',
            'last drawn basic pay', 'monthly basic'
        ],
        lastDrawnDa: [
            'last drawn da', 'last_drawn_da', 'lastdrawnda', 'last drawn dearness allowance',
            'dearness allowance', 'da', 'da pay', 'last da', 'da salary',
            'last drawn da pay', 'monthly da'
        ],
        lastDrawnEligibleSalary: [
            'last drawn wages / eligible salary', 'last drawn wages / eligible sala',
            'last drawn wages / eligible', 'last drawn wages', 'eligible salary',
            'last_drawn_wages_/_eligible_salary', 'lastdrawnwageseligiblesalary',
            'eligible wages', 'last drawn eligible salary', 'salary basis',
            'wages for gratuity', 'last drawn salary (basic+da)', 'wages'
        ],
        completedYearsForGratuity: [
            'completed years for gratuity', 'completed years for gratui', 'completed years for grat',
            'completed_years_for_gratuity', 'completedyearsforgratuity', 'completed years',
            'qualifying years', 'gratuity years', 'rounded service years',
            'completed service years', 'qualifying service'
        ],
        accruedGratuityAmount: [
            'accrued gratuity amount', 'accrued gratuity amoun', 'accrued gratuity',
            'accrued_gratuity_amount', 'accruedgratuityamount', 'gratuity amount',
            'gratuity payable', 'gratuity liability', 'accrued liability',
            'gratuity payout', 'settlement amount', 'gratuity sum'
        ],
        gratuityCalculationBasis: [
            'gratuity calculation basis', 'gratuity calculation basi', 'gratuity calculation bas',
            'gratuity_calculation_basis', 'gratuitycalculationbasis', 'calculation basis',
            'calculation formula', 'gratuity formula', 'calculation rule', 'gratuity basis'
        ],
        schemePolicyName: [
            'scheme / policy name', 'scheme_/_policy_name', 'scheme policy name',
            'schemepolicyname', 'scheme name', 'policy name', 'trust name',
            'gratuity scheme', 'gratuity trust', 'insurer scheme', 'policy / trust name'
        ],
        nomineeDetailsStatus: [
            'nominee details status', 'nominee_details_status', 'nomineedetailsstatus',
            'nominee status', 'nominee_status', 'form f status', 'nomination status',
            'form f nominee status', 'nominee verification status'
        ],
        paymentStatus: [
            'payment status', 'payment_status', 'paymentstatus', 'settlement status',
            'gratuity payment status', 'disbursement status', 'claim status'
        ],
        paymentDate: [
            'payment date', 'payment_date', 'paymentdate', 'disbursement date',
            'settlement date', 'payout date', 'gratuity payment date'
        ],
        paymentReference: [
            'payment reference', 'payment_reference', 'paymentreference', 'transaction reference',
            'decentro payout utr', 'payout utr', 'utr', 'bank ref', 'transaction id',
            'decentro reference', 'payment utr', 'reference number'
        ]
    };

    /**
     * Exact 18 Attributes Schema Definition matching PRD Sections 1, 4, 11, & 13
     */
    const GRATUITY_DETAILS_ATTRIBUTES = [
        { key: "Employee ID", label: "1. Employee ID", required: true, synonyms: HEADER_SYNONYMS.employeeId },
        { key: "Organization ID", label: "2. Organization ID", required: true, defaultValue: "ORG_KYLRX_01", synonyms: HEADER_SYNONYMS.organizationId },
        { key: "Gratuity Applicable", label: "3. Gratuity Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.gratuityApplicable },
        { key: "Date of Joining", label: "4. Date of Joining (YYYY-MM-DD)", required: true, defaultValue: "2020-01-15", synonyms: HEADER_SYNONYMS.dateOfJoining },
        { key: "Date of Exit", label: "5. Date of Exit (YYYY-MM-DD)", required: false, defaultValue: null, synonyms: HEADER_SYNONYMS.dateOfExit },
        { key: "Continuous Service (Years)", label: "6. Continuous Service (Years)", required: false, defaultValue: 5.0, synonyms: HEADER_SYNONYMS.continuousServiceYears },
        { key: "Gratuity Eligibility Status", label: "7. Gratuity Eligibility Status", required: true, defaultValue: "VESTED", synonyms: HEADER_SYNONYMS.gratuityEligibilityStatus },
        { key: "Last Drawn Basic", label: "8. Last Drawn Basic (INR)", required: true, defaultValue: 60000.00, synonyms: HEADER_SYNONYMS.lastDrawnBasic },
        { key: "Last Drawn DA", label: "9. Last Drawn DA (INR)", required: false, defaultValue: 0.00, synonyms: HEADER_SYNONYMS.lastDrawnDa },
        { key: "Last Drawn Wages / Eligible Salary", label: "10. Last Drawn Wages / Eligible Salary", required: false, defaultValue: 60000.00, synonyms: HEADER_SYNONYMS.lastDrawnEligibleSalary },
        { key: "Completed Years for Gratuity", label: "11. Completed Years for Gratuity", required: false, defaultValue: 5, synonyms: HEADER_SYNONYMS.completedYearsForGratuity },
        { key: "Accrued Gratuity Amount", label: "12. Accrued Gratuity Amount (INR)", required: false, defaultValue: 173076.92, synonyms: HEADER_SYNONYMS.accruedGratuityAmount },
        { key: "Gratuity Calculation Basis", label: "13. Gratuity Calculation Basis", required: true, defaultValue: "15/26 Formula", synonyms: HEADER_SYNONYMS.gratuityCalculationBasis },
        { key: "Scheme / Policy Name", label: "14. Scheme / Policy Name", required: false, defaultValue: "LIC Group Gratuity Cash Accumulation", synonyms: HEADER_SYNONYMS.schemePolicyName },
        { key: "Nominee Details Status", label: "15. Nominee Details Status", required: true, defaultValue: "VERIFIED", synonyms: HEADER_SYNONYMS.nomineeDetailsStatus },
        { key: "Payment Status", label: "16. Payment Status", required: true, defaultValue: "ACCRUING", synonyms: HEADER_SYNONYMS.paymentStatus },
        { key: "Payment Date", label: "17. Payment Date (YYYY-MM-DD)", required: false, defaultValue: null, synonyms: HEADER_SYNONYMS.paymentDate },
        { key: "Payment Reference", label: "18. Payment Reference / UTR", required: false, defaultValue: null, synonyms: HEADER_SYNONYMS.paymentReference }
    ];

    /**
     * Canonical Enums per Payment of Gratuity Act, 1972 & PRD
     */
    const ENUMS = {
        eligibilityStatus: ["ELIGIBLE", "NOT_ELIGIBLE", "VESTED", "EXEMPTED"],
        calculationBasis: ["15/26 Formula", "30/26 Formula", "Trust Rule", "Custom"],
        nomineeStatus: ["SUBMITTED", "VERIFIED", "PENDING", "NOT_SUBMITTED"],
        paymentStatus: ["ACCRUING", "PENDING_SETTLEMENT", "APPROVED", "DISBURSED", "FORFEITED"]
    };

    const STATUTORY_TAX_FREE_CEILING = 2000000.00; // INR 20 Lakhs

    /**
     * Normalizes an object key to lowercase alphanumeric string for robust matching.
     */
    function normalizeKey(str) {
        if (!str && str !== 0) return '';
        return String(str).toLowerCase().trim()
            .replace(/%/g, 'pct')
            .replace(/[\s_\-/#()]+/g, '');
    }

    /**
     * Finds and retrieves value from row by canonical header synonyms.
     * Prioritizes exact matches, then falls back to prefix/truncation matching.
     */
    function getVal(row, synonymList) {
        if (!row || typeof row !== 'object') return undefined;
        const normalizedSynonyms = synonymList.map(s => normalizeKey(s));
        
        // Pass 1: exact normalized match
        for (const [k, v] of Object.entries(row)) {
            const normK = normalizeKey(k);
            if (normalizedSynonyms.includes(normK)) {
                if (v !== undefined && v !== null && String(v).trim() !== '') {
                    return v;
                }
            }
        }

        // Pass 2: prefix or truncated matching (e.g. "continuousserviceyears" starts with "continuousserviceyear")
        for (const [k, v] of Object.entries(row)) {
            const normK = normalizeKey(k);
            if (normK.length >= 8) {
                for (const syn of normalizedSynonyms) {
                    if (syn.startsWith(normK) || normK.startsWith(syn)) {
                        if (v !== undefined && v !== null && String(v).trim() !== '') {
                            return v;
                        }
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Parses boolean representation safely.
     */
    function parseBoolean(val, defaultVal = true) {
        if (val === undefined || val === null || String(val).trim() === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        if (s === 'yes' || s === 'true' || s === 'y' || s === '1' || s === 'applicable') return true;
        if (s === 'no' || s === 'false' || s === 'n' || s === '0' || s === 'exempted' || s === 'not applicable') return false;
        return defaultVal;
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
            const y = ymdMatch[1];
            const m = String(ymdMatch[2]).padStart(2, '0');
            const d = String(ymdMatch[3]).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        // Matches DD-MM-YYYY or DD/MM/YYYY
        const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (dmyMatch) {
            const d = String(dmyMatch[1]).padStart(2, '0');
            const m = String(dmyMatch[2]).padStart(2, '0');
            const y = dmyMatch[3];
            return `${y}-${m}-${d}`;
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
     * Safely parses non-negative number.
     */
    function parseNumber(val, defaultVal = 0.0) {
        if (val === undefined || val === null || String(val).trim() === '') return defaultVal;
        const cleaned = String(val).replace(/[^\d.-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? defaultVal : num;
    }

    /**
     * Computes service duration in years and completed years according to Payment of Gratuity Act:
     * Continuous service of > 6 months in excess of completed years rounds UP to next full year.
     */
    function computeTenure(joiningDateStr, exitDateStr = null) {
        if (!joiningDateStr) return { continuousYears: 0, completedYears: 0 };
        const doj = new Date(joiningDateStr);
        if (isNaN(doj.getTime())) return { continuousYears: 0, completedYears: 0 };

        const refDate = exitDateStr ? new Date(exitDateStr) : new Date();
        if (isNaN(refDate.getTime())) return { continuousYears: 0, completedYears: 0 };

        const diffMs = refDate.getTime() - doj.getTime();
        if (diffMs <= 0) return { continuousYears: 0, completedYears: 0 };

        const days = diffMs / (1000 * 60 * 60 * 24);
        const continuousYears = Math.round((days / 365.25) * 10) / 10;

        // Exact month difference calculation
        let yDiff = refDate.getFullYear() - doj.getFullYear();
        let mDiff = refDate.getMonth() - doj.getMonth();
        let dDiff = refDate.getDate() - doj.getDate();

        if (dDiff < 0) {
            mDiff -= 1;
        }
        if (mDiff < 0) {
            yDiff -= 1;
            mDiff += 12;
        }

        // Rounding rule: If remaining months > 6, round up to next full year; otherwise round down
        let completedYears = yDiff;
        if (mDiff > 6) {
            completedYears += 1;
        } else if (mDiff === 6 && dDiff >= 0) {
            // Exactly 6 months or more with positive days rounds up in standard Indian labor tribunal jurisprudence
            completedYears += 1;
        }

        return {
            continuousYears: Math.max(0, continuousYears),
            completedYears: Math.max(0, completedYears)
        };
    }

    /**
     * Calculates Gratuity by statutory formula:
     * Gratuity = (15 * Eligible Salary * Completed Years) / 26
     */
    function calculateAccruedGratuity(eligibleSalary, completedYears, calculationBasis = "15/26 Formula") {
        if (!eligibleSalary || eligibleSalary <= 0 || !completedYears || completedYears <= 0) {
            return 0.00;
        }

        let raw = 0;
        if (calculationBasis === "30/26 Formula") {
            raw = (30 * eligibleSalary * completedYears) / 26;
        } else {
            // Default 15/26 Formula (Payment of Gratuity Act, 1972)
            raw = (15 * eligibleSalary * completedYears) / 26;
        }

        const rounded = Math.round(raw * 100) / 100;
        return rounded;
    }

    /**
     * Resolves Eligibility Status
     */
    function resolveEligibilityStatus(isGratuityApplicable, completedYears, dateOfExit = null, explicitStatus = null) {
        if (!isGratuityApplicable) return "EXEMPTED";
        if (explicitStatus && ENUMS.eligibilityStatus.includes(explicitStatus)) {
            return explicitStatus;
        }
        if (completedYears >= 5) {
            return dateOfExit ? "ELIGIBLE" : "VESTED";
        }
        return "NOT_ELIGIBLE";
    }

    /**
     * Normalizes canonical enums with fallback.
     */
    function normalizeEnum(val, validList, defaultVal) {
        if (!val || String(val).trim() === '') return defaultVal;
        const s = String(val).trim().toUpperCase();
        for (const item of validList) {
            if (item.toUpperCase() === s) return item;
        }
        return defaultVal;
    }

    /**
     * Parses a single row object into structured Gratuity Master record matching all 18 attributes.
     */
    function parseRecord(row, rowIndex = 0, defaultOrgId = "ORG_KYLRX_01") {
        const employeeIdRaw = getVal(row, HEADER_SYNONYMS.employeeId);
        const employeeId = employeeIdRaw ? String(employeeIdRaw).trim() : '';

        const organizationIdRaw = getVal(row, HEADER_SYNONYMS.organizationId);
        const organizationId = organizationIdRaw ? String(organizationIdRaw).trim() : defaultOrgId;

        const isGratuityApplicable = parseBoolean(getVal(row, HEADER_SYNONYMS.gratuityApplicable), true);

        const dateOfJoining = sanitizeDate(getVal(row, HEADER_SYNONYMS.dateOfJoining)) || "2020-01-15";
        const dateOfExit = sanitizeDate(getVal(row, HEADER_SYNONYMS.dateOfExit));

        // Wages
        const lastDrawnBasic = parseNumber(getVal(row, HEADER_SYNONYMS.lastDrawnBasic), 60000.00);
        const lastDrawnDa = parseNumber(getVal(row, HEADER_SYNONYMS.lastDrawnDa), 0.00);
        
        let lastDrawnEligibleSalary = parseNumber(getVal(row, HEADER_SYNONYMS.lastDrawnEligibleSalary), 0.00);
        if (lastDrawnEligibleSalary <= 0) {
            lastDrawnEligibleSalary = lastDrawnBasic + lastDrawnDa;
        }

        // Tenure
        const tenureComputed = computeTenure(dateOfJoining, dateOfExit);
        const rawContinuousYears = parseNumber(getVal(row, HEADER_SYNONYMS.continuousServiceYears), -1);
        const continuousServiceYears = rawContinuousYears >= 0 ? rawContinuousYears : tenureComputed.continuousYears;

        const rawCompletedYears = parseInt(getVal(row, HEADER_SYNONYMS.completedYearsForGratuity), 10);
        const completedYearsForGratuity = !isNaN(rawCompletedYears) && rawCompletedYears >= 0 ? rawCompletedYears : tenureComputed.completedYears;

        // Calculation basis
        const calculationBasisRaw = getVal(row, HEADER_SYNONYMS.gratuityCalculationBasis);
        const calculationBasis = normalizeEnum(calculationBasisRaw, ENUMS.calculationBasis, "15/26 Formula");

        // Accrued amount
        let accruedGratuityAmount = parseNumber(getVal(row, HEADER_SYNONYMS.accruedGratuityAmount), -1);
        if (accruedGratuityAmount < 0) {
            accruedGratuityAmount = calculateAccruedGratuity(lastDrawnEligibleSalary, completedYearsForGratuity, calculationBasis);
        }

        // Eligibility Status
        const explicitEligibilityStatus = getVal(row, HEADER_SYNONYMS.gratuityEligibilityStatus);
        const eligibilityStatus = resolveEligibilityStatus(isGratuityApplicable, completedYearsForGratuity, dateOfExit, explicitEligibilityStatus);

        // Scheme / Policy Name
        const schemePolicyNameRaw = getVal(row, HEADER_SYNONYMS.schemePolicyName);
        const schemePolicyName = schemePolicyNameRaw ? String(schemePolicyNameRaw).trim() : "LIC Group Gratuity Cash Accumulation";

        // Nominee Status
        const nomineeStatusRaw = getVal(row, HEADER_SYNONYMS.nomineeDetailsStatus);
        const nomineeStatus = normalizeEnum(nomineeStatusRaw, ENUMS.nomineeStatus, "VERIFIED");

        // Payment Status
        const paymentStatusRaw = getVal(row, HEADER_SYNONYMS.paymentStatus);
        const defaultPaymentStatus = dateOfExit ? "PENDING_SETTLEMENT" : "ACCRUING";
        const paymentStatus = normalizeEnum(paymentStatusRaw, ENUMS.paymentStatus, defaultPaymentStatus);

        // Payment Date & Reference
        const paymentDate = sanitizeDate(getVal(row, HEADER_SYNONYMS.paymentDate));
        const paymentReferenceRaw = getVal(row, HEADER_SYNONYMS.paymentReference);
        const paymentReference = paymentReferenceRaw ? String(paymentReferenceRaw).trim() : null;

        return {
            rowIndex,
            employeeId,
            organizationId,
            isGratuityApplicable,
            dateOfJoining,
            dateOfExit,
            continuousServiceYears,
            eligibilityStatus,
            lastDrawnBasic,
            lastDrawnDa,
            lastDrawnEligibleSalary,
            completedYearsForGratuity,
            accruedGratuityAmount,
            calculationBasis,
            schemePolicyName,
            nomineeStatus,
            paymentStatus,
            paymentDate,
            paymentReference
        };
    }

    /**
     * Validates a parsed record against PRD Sections 1, 4, 11, & 13
     */
    function validateRecord(record, rowIndex = 0, options = {}) {
        const errors = [];
        const warnings = [];

        // 1. Employee ID Validation
        if (!record.employeeId) {
            errors.push(`Row ${rowIndex}: Missing mandatory 'Employee ID'`);
        } else if (options.existingEmployeeIds && !options.existingEmployeeIds.has(record.employeeId)) {
            errors.push(`Row ${rowIndex}: Employee ID '${record.employeeId}' does not match any active employee in Firestore.`);
        }

        // 2. Organization ID Validation
        if (!record.organizationId) {
            errors.push(`Row ${rowIndex}: Missing mandatory 'Organization ID'`);
        } else if (options.expectedOrgId && record.organizationId !== options.expectedOrgId) {
            warnings.push(`Row ${rowIndex}: Organization ID '${record.organizationId}' differs from active tenant '${options.expectedOrgId}'`);
        }

        // 3. Date Integrity Validation
        if (record.isGratuityApplicable) {
            if (!record.dateOfJoining) {
                errors.push(`Row ${rowIndex}: Mandatory 'Date of Joining' is missing or has an invalid format.`);
            }

            if (record.dateOfJoining && record.dateOfExit) {
                if (record.dateOfExit < record.dateOfJoining) {
                    errors.push(`Row ${rowIndex}: Date of Exit (${record.dateOfExit}) cannot precede Date of Joining (${record.dateOfJoining}).`);
                }
            }

            if (record.paymentDate && record.dateOfJoining) {
                if (record.paymentDate < record.dateOfJoining) {
                    errors.push(`Row ${rowIndex}: Payment Date (${record.paymentDate}) cannot precede Date of Joining (${record.dateOfJoining}).`);
                }
            }
        }

        // 4. Numeric Values Validation
        if (record.lastDrawnBasic < 0) {
            errors.push(`Row ${rowIndex}: Last Drawn Basic cannot be negative.`);
        }
        if (record.lastDrawnDa < 0) {
            errors.push(`Row ${rowIndex}: Last Drawn DA cannot be negative.`);
        }
        if (record.lastDrawnEligibleSalary < 0) {
            errors.push(`Row ${rowIndex}: Eligible Salary cannot be negative.`);
        }
        if (record.accruedGratuityAmount < 0) {
            errors.push(`Row ${rowIndex}: Accrued Gratuity Amount cannot be negative.`);
        }
        if (record.completedYearsForGratuity < 0) {
            errors.push(`Row ${rowIndex}: Completed Years cannot be negative.`);
        }
        if (record.continuousServiceYears < 0) {
            errors.push(`Row ${rowIndex}: Continuous Service (Years) cannot be negative.`);
        }

        // 5. Canonical Enums Validation
        if (!ENUMS.eligibilityStatus.includes(record.eligibilityStatus)) {
            errors.push(`Row ${rowIndex}: Invalid Gratuity Eligibility Status '${record.eligibilityStatus}'. Expected: ${ENUMS.eligibilityStatus.join(', ')}`);
        }
        if (!ENUMS.calculationBasis.includes(record.calculationBasis)) {
            errors.push(`Row ${rowIndex}: Invalid Gratuity Calculation Basis '${record.calculationBasis}'. Expected: ${ENUMS.calculationBasis.join(', ')}`);
        }
        if (!ENUMS.nomineeStatus.includes(record.nomineeStatus)) {
            errors.push(`Row ${rowIndex}: Invalid Nominee Details Status '${record.nomineeStatus}'. Expected: ${ENUMS.nomineeStatus.join(', ')}`);
        }
        if (!ENUMS.paymentStatus.includes(record.paymentStatus)) {
            errors.push(`Row ${rowIndex}: Invalid Payment Status '${record.paymentStatus}'. Expected: ${ENUMS.paymentStatus.join(', ')}`);
        }

        // 6. Payment Status Consistency
        if (record.paymentStatus === 'DISBURSED') {
            if (!record.paymentDate) {
                warnings.push(`Row ${rowIndex}: Payment Status is 'DISBURSED' but Payment Date is missing.`);
            }
            if (!record.paymentReference) {
                warnings.push(`Row ${rowIndex}: Payment Status is 'DISBURSED' but Decentro Payment Reference is missing.`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Converts a validated parsed record into canonical Cloud Firestore document.
     * Path: organizations/{orgId}/employee_gratuity_details/{employeeId}
     */
    function toFirestoreDoc(record) {
        return {
            employeeId: record.employeeId,
            organizationId: record.organizationId,
            isGratuityApplicable: record.isGratuityApplicable,
            dateOfJoining: record.dateOfJoining,
            dateOfExit: record.dateOfExit || null,
            continuousServiceYears: Number(Number(record.continuousServiceYears).toFixed(1)),
            eligibilityStatus: record.eligibilityStatus,
            wages: {
                lastDrawnBasic: Number(Number(record.lastDrawnBasic).toFixed(2)),
                lastDrawnDa: Number(Number(record.lastDrawnDa).toFixed(2)),
                eligibleSalary: Number(Number(record.lastDrawnEligibleSalary).toFixed(2))
            },
            completedYearsForGratuity: parseInt(record.completedYearsForGratuity, 10) || 0,
            accruedGratuityAmount: Number(Number(record.accruedGratuityAmount).toFixed(2)),
            calculationBasis: record.calculationBasis,
            schemePolicyName: record.schemePolicyName,
            nomineeStatus: record.nomineeStatus,
            settlement: {
                paymentStatus: record.paymentStatus,
                paymentDate: record.paymentDate || null,
                paymentReference: record.paymentReference || null,
                decentroDisbursementId: record.paymentReference ? `DEC_${record.paymentReference.replace(/[^A-Za-z0-9]/g, '_')}` : null
            },
            statutoryCeiling: STATUTORY_TAX_FREE_CEILING,
            createdAt: record.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Parses an array of raw sheet rows (e.g. from SheetJS sheet_to_json).
     */
    function parseSheetRows(rows, options = {}) {
        const records = [];
        const firestoreDocs = [];
        const allErrors = [];
        const allWarnings = [];
        const seenEmployeeIds = new Set();
        const duplicates = [];

        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                records: [],
                firestoreDocs: [],
                errors: ["The uploaded 'Gratuity Details' sheet is empty or contains no data rows."],
                warnings: [],
                duplicates: []
            };
        }

        const orgId = options.orgId || "ORG_KYLRX_01";

        rows.forEach((row, idx) => {
            const rowIndex = idx + 2; // 1-based, account for header row
            const record = parseRecord(row, rowIndex, orgId);

            // Skip completely empty rows
            if (!record.employeeId && !getVal(row, HEADER_SYNONYMS.gratuityApplicable)) {
                return;
            }

            // Deduplication Check
            if (record.employeeId) {
                if (seenEmployeeIds.has(record.employeeId)) {
                    duplicates.push(`Row ${rowIndex}: Duplicate Employee ID '${record.employeeId}' found in Gratuity Details sheet.`);
                    allErrors.push(`Row ${rowIndex}: Duplicate Employee ID '${record.employeeId}' found.`);
                    return;
                }
                seenEmployeeIds.add(record.employeeId);
            }

            const val = validateRecord(record, rowIndex, {
                existingEmployeeIds: options.existingEmployeeIds,
                expectedOrgId: orgId
            });

            if (!val.valid) {
                allErrors.push(...val.errors);
            }
            if (val.warnings.length > 0) {
                allWarnings.push(...val.warnings);
            }

            records.push(record);
            firestoreDocs.push(toFirestoreDoc(record));
        });

        return {
            records,
            firestoreDocs,
            errors: allErrors,
            warnings: allWarnings,
            duplicates
        };
    }

    return {
        GRATUITY_DETAILS_ATTRIBUTES,
        HEADER_SYNONYMS,
        ENUMS,
        STATUTORY_TAX_FREE_CEILING,
        normalizeKey,
        getVal,
        parseBoolean,
        sanitizeDate,
        parseNumber,
        computeTenure,
        calculateAccruedGratuity,
        resolveEligibilityStatus,
        parseRecord,
        validateRecord,
        toFirestoreDoc,
        parseSheetRows
    };
}));
