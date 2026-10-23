/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - NATIONAL PENSION SYSTEM (NPS) STATUTORY MASTER PARSER
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes employee NPS statutory profiles
 * matching all 22 columns from the 'NPS Details' sheet of Templates.xlsx
 * and PRD Sections 1, 4, 11, & 13:
 * 
 * Exact 22 Attributes:
 * 1.  Employee ID (string, foreign key referencing active employee in Firestore)
 * 2.  Organization ID (string, tenant/org identifier matching active organization context)
 * 3.  NPS Applicable (boolean: true for "Yes", false for "No")
 * 4.  PRAN (string | null, 12-digit Permanent Retirement Account Number; mandatory if NPS Applicable is true)
 * 5.  NPS Account Status (string enum: "ACTIVE", "INACTIVE", "FROZEN", "SUSPENDED")
 * 6.  NPS Model (string enum: "Corporate Model", "All Citizen Model", "Government")
 * 7.  CRA / Recordkeeping Agency (string enum: "Protean (NSDL)", "KFintech", "CAMS", "Other")
 * 8.  POP / Intermediary (string, Point of Presence name or registered entity code)
 * 9.  Tier I Active (boolean: true for "Yes", false for "No")
 * 10. Tier II Active (boolean: true for "Yes", false for "No")
 * 11. Date of NPS Joining (string / ISO Date: YYYY-MM-DD)
 * 12. Date of NPS Exit (string | null / ISO Date: YYYY-MM-DD)
 * 13. Employee Contribution % (number | null, percentage rate e.g., 10.0)
 * 14. Employee Contribution Amount (number | null, fixed monthly amount)
 * 15. Employer Contribution % (number | null, corporate co-contribution percentage e.g., 10.0 or 14.0)
 * 16. Employer Contribution Amount (number | null, fixed corporate contribution amount)
 * 17. Total Contribution YTD (number, running financial-year total)
 * 18. Nominee Details Status (string enum: "SUBMITTED", "VERIFIED", "PENDING", "NOT_SUBMITTED")
 * 19. KYC Status (string enum: "VERIFIED", "PENDING", "REJECTED")
 * 20. PAN KYC (string enum: "VERIFIED", "PENDING", "NOT_SEEDED")
 * 21. Aadhaar KYC (string enum: "VERIFIED", "PENDING", "NOT_SEEDED")
 * 22. Bank KYC (string enum: "VERIFIED", "PENDING", "FAILED")
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
        root.KylrxNpsDetailsParser = factory();
        root.npsDetailsParser = root.KylrxNpsDetailsParser;
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
        npsApplicable: [
            'nps applicable', 'nps_applicable', 'npsapplicable', 'is_nps_applicable',
            'is nps applicable', 'nps eligible', 'nps flag', 'national pension system applicable',
            'nps applicable (yes/no)', 'is_national_pension_system_applicable'
        ],
        pran: [
            'pran', 'pran number', 'pran_number', 'prannumber', 'pran no', 'pran_no',
            'permanent retirement account number', 'permanent_retirement_account_number',
            'nps_pran', 'nps pran'
        ],
        npsAccountStatus: [
            'nps account status', 'nps_account_status', 'npsaccountstatus', 'account status',
            'account_status', 'nps status', 'nps_status', 'pran status', 'pran_status'
        ],
        npsModel: [
            'nps model', 'nps_model', 'npsmodel', 'model', 'scheme model', 'corporate model',
            'nps sector', 'nps category', 'nps plan'
        ],
        craRecordkeepingAgency: [
            'cra / recordkeeping agency', 'cra_recordkeeping_agency', 'crarecordkeepingagency',
            'cra / recordkeeping agenc', 'cra agency', 'cra_agency', 'recordkeeping agency',
            'recordkeeping_agency', 'cra', 'recordkeeper', 'central recordkeeping agency',
            'cra / rka', 'cra name'
        ],
        popIntermediary: [
            'pop / intermediary', 'pop_intermediary', 'popintermediary', 'pop / intermediar',
            'pop name', 'pop', 'point of presence', 'intermediary', 'pop code',
            'registered pop', 'pop entity'
        ],
        tier1Active: [
            'tier i active', 'tier_i_active', 'tieriactive', 'tier 1 active', 'tier_1_active',
            'tier1active', 'tier i', 'tier 1', 'is tier 1 active', 'is_tier_1_active',
            'tier 1 enabled', 'tier i enabled'
        ],
        tier2Active: [
            'tier ii active', 'tier_ii_active', 'tieriiactive', 'tier 2 active', 'tier_2_active',
            'tier2active', 'tier ii', 'tier 2', 'is tier 2 active', 'is_tier_2_active',
            'tier 2 enabled', 'tier ii enabled'
        ],
        dateOfNpsJoining: [
            'date of nps joining', 'date_of_nps_joining', 'dateofnpsjoining', 'nps joining date',
            'nps_joining_date', 'nps join date', 'nps doj', 'nps_doj', 'date of joining nps',
            'date of joining', 'joining date nps'
        ],
        dateOfNpsExit: [
            'date of nps exit', 'date_of_nps_exit', 'dateofnpsexit', 'nps exit date',
            'nps_exit_date', 'nps doe', 'nps_doe', 'date of exit nps', 'exit date',
            'retirement date', 'nps leaving date'
        ],
        employeeContributionPercent: [
            'employee contribution %', 'employee_contribution_%', 'employee contribution percentage',
            'employee contribution pct', 'ee contribution %', 'ee_contribution_%', 'ee %',
            'ee pct', 'employee contribution rate', 'ee contribution rate',
            'employee contribution % (80ccd1)', 'employeecontributionpct', 'eecontributionpct'
        ],
        employeeContributionAmount: [
            'employee contribution amount', 'employee_contribution_amount', 'employeecontributionamount',
            'employee contribution amour', 'employee contribution amt', 'ee contribution amount',
            'ee_contribution_amount', 'ee amount', 'employee deduction amount', 'ee contribution (inr)',
            'employee contribution inr'
        ],
        employerContributionPercent: [
            'employer contribution %', 'employer_contribution_%', 'employer contribution percentage',
            'employer contribution pct', 'er contribution %', 'er_contribution_%', 'er %',
            'er pct', 'employer contribution rate', 'er contribution rate',
            'employer contribution % (80ccd2)', 'employercontributionpct', 'ercontributionpct'
        ],
        employerContributionAmount: [
            'employer contribution amount', 'employer_contribution_amount', 'employercontributionamount',
            'employer contribution amoun', 'employer contribution amt', 'er contribution amount',
            'er_contribution_amount', 'er amount', 'employer co-contribution amount', 'er contribution (inr)',
            'employer contribution inr'
        ],
        totalContributionYtd: [
            'total contribution ytd', 'total_contribution_ytd', 'totalcontributionytd',
            'ytd contribution', 'ytd_contribution', 'total contribution', 'total_contribution',
            'ytd total', 'total nps ytd', 'running ytd total'
        ],
        nomineeDetailsStatus: [
            'nominee details status', 'nominee_details_status', 'nomineedetailsstatus',
            'nominee status', 'nominee_status', 'nominee', 'nominee details', 'nomination status'
        ],
        kycStatus: [
            'kyc status', 'kyc_status', 'kycstatus', 'overall kyc', 'overall_kyc_status',
            'cra kyc status', 'nps kyc status'
        ],
        panKyc: [
            'pan kyc', 'pan_kyc', 'pankyc', 'pan status', 'pan verification', 'pan seeding',
            'pan seeded'
        ],
        aadhaarKyc: [
            'aadhaar kyc', 'aadhaar_kyc', 'aadhaarkyc', 'aadhaar status', 'aadhaar verification',
            'aadhaar seeding', 'uidai kyc'
        ],
        bankKyc: [
            'bank kyc', 'bank_kyc', 'bankkyc', 'bank status', 'bank verification', 'bank account kyc',
            'penny drop status'
        ]
    };

    /**
     * Exact 22 Attributes Schema Definition matching PRD Sections 1, 4, 11, & 13
     */
    const NPS_DETAILS_ATTRIBUTES = [
        { key: "Employee ID", label: "1. Employee ID", required: true, synonyms: HEADER_SYNONYMS.employeeId },
        { key: "Organization ID", label: "2. Organization ID", required: true, defaultValue: "ORG_KYLRX_01", synonyms: HEADER_SYNONYMS.organizationId },
        { key: "NPS Applicable", label: "3. NPS Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.npsApplicable },
        { key: "PRAN", label: "4. PRAN (12 Digits)", required: true, defaultValue: "110023456789", synonyms: HEADER_SYNONYMS.pran },
        { key: "NPS Account Status", label: "5. NPS Account Status", required: true, defaultValue: "ACTIVE", synonyms: HEADER_SYNONYMS.npsAccountStatus },
        { key: "NPS Model", label: "6. NPS Model", required: true, defaultValue: "Corporate Model", synonyms: HEADER_SYNONYMS.npsModel },
        { key: "CRA / Recordkeeping Agency", label: "7. CRA / Recordkeeping Agency", required: true, defaultValue: "Protean (NSDL)", synonyms: HEADER_SYNONYMS.craRecordkeepingAgency },
        { key: "POP / Intermediary", label: "8. POP / Intermediary", required: false, defaultValue: "HDFC Pension Management Co.", synonyms: HEADER_SYNONYMS.popIntermediary },
        { key: "Tier I Active", label: "9. Tier I Active (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.tier1Active },
        { key: "Tier II Active", label: "10. Tier II Active (Yes/No)", required: true, defaultValue: false, synonyms: HEADER_SYNONYMS.tier2Active },
        { key: "Date of NPS Joining", label: "11. Date of NPS Joining (YYYY-MM-DD)", required: true, defaultValue: "2026-01-15", synonyms: HEADER_SYNONYMS.dateOfNpsJoining },
        { key: "Date of NPS Exit", label: "12. Date of NPS Exit (YYYY-MM-DD)", required: false, defaultValue: null, synonyms: HEADER_SYNONYMS.dateOfNpsExit },
        { key: "Employee Contribution %", label: "13. Employee Contribution %", required: false, defaultValue: 10.0, synonyms: HEADER_SYNONYMS.employeeContributionPercent },
        { key: "Employee Contribution Amount", label: "14. Employee Contribution Amount", required: false, defaultValue: null, synonyms: HEADER_SYNONYMS.employeeContributionAmount },
        { key: "Employer Contribution %", label: "15. Employer Contribution %", required: false, defaultValue: 10.0, synonyms: HEADER_SYNONYMS.employerContributionPercent },
        { key: "Employer Contribution Amount", label: "16. Employer Contribution Amount", required: false, defaultValue: null, synonyms: HEADER_SYNONYMS.employerContributionAmount },
        { key: "Total Contribution YTD", label: "17. Total Contribution YTD", required: false, defaultValue: 0.00, synonyms: HEADER_SYNONYMS.totalContributionYtd },
        { key: "Nominee Details Status", label: "18. Nominee Details Status", required: true, defaultValue: "SUBMITTED", synonyms: HEADER_SYNONYMS.nomineeDetailsStatus },
        { key: "KYC Status", label: "19. KYC Status", required: true, defaultValue: "VERIFIED", synonyms: HEADER_SYNONYMS.kycStatus },
        { key: "PAN KYC", label: "20. PAN KYC", required: true, defaultValue: "VERIFIED", synonyms: HEADER_SYNONYMS.panKyc },
        { key: "Aadhaar KYC", label: "21. Aadhaar KYC", required: true, defaultValue: "VERIFIED", synonyms: HEADER_SYNONYMS.aadhaarKyc },
        { key: "Bank KYC", label: "22. Bank KYC", required: true, defaultValue: "VERIFIED", synonyms: HEADER_SYNONYMS.bankKyc }
    ];

    /**
     * Canonical Enums
     */
    const ENUMS = {
        npsAccountStatus: ["ACTIVE", "INACTIVE", "FROZEN", "SUSPENDED"],
        npsModel: ["Corporate Model", "All Citizen Model", "Government"],
        craAgency: ["Protean (NSDL)", "KFintech", "CAMS", "Other"],
        nomineeStatus: ["SUBMITTED", "VERIFIED", "PENDING", "NOT_SUBMITTED"],
        kycStatus: ["VERIFIED", "PENDING", "REJECTED"],
        panKyc: ["VERIFIED", "PENDING", "NOT_SEEDED"],
        aadhaarKyc: ["VERIFIED", "PENDING", "NOT_SEEDED"],
        bankKyc: ["VERIFIED", "PENDING", "FAILED"]
    };

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
        
        // Pass 1: exact match
        for (const [k, v] of Object.entries(row)) {
            const normK = normalizeKey(k);
            if (normalizedSynonyms.some(syn => normK === syn)) {
                if (v !== undefined && v !== null && String(v).trim() !== '') {
                    return v;
                }
            }
        }

        // Pass 2: prefix / truncation match (e.g. 'cra / recordkeeping agenc', 'employee contribution amour')
        for (const [k, v] of Object.entries(row)) {
            const normK = normalizeKey(k);
            if (normalizedSynonyms.some(syn => {
                if (syn.length >= 8 && normK.length >= 8) {
                    return normK.startsWith(syn) || syn.startsWith(normK);
                }
                return false;
            })) {
                if (v !== undefined && v !== null && String(v).trim() !== '') {
                    return v;
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

        const ymdMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
        if (ymdMatch) {
            const year = ymdMatch[1];
            const month = ymdMatch[2].padStart(2, '0');
            const day = ymdMatch[3].padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

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
     * Normalizes enum with safe case-insensitive matching and default fallback.
     */
    function normalizeEnum(val, validList, defaultVal) {
        if (!val || String(val).trim() === '') return defaultVal;
        const clean = String(val).trim().toUpperCase();
        const found = validList.find(item => item.toUpperCase() === clean);
        return found || defaultVal;
    }

    /**
     * Validates a single record against NPS Statutory rules and PRD Section 1 constraints.
     */
    function validateRecord(record, optionsOrRowNumber = {}, maybeOptions = {}) {
        const options = (typeof optionsOrRowNumber === 'object' && optionsOrRowNumber !== null) 
            ? optionsOrRowNumber 
            : ((typeof maybeOptions === 'object' && maybeOptions !== null) ? maybeOptions : {});

        const errors = [];
        const warnings = [];

        const empId = record['Employee ID'] !== undefined ? record['Employee ID'] : record.employeeId;
        const orgId = record['Organization ID'] !== undefined ? record['Organization ID'] : record.organizationId;
        const isNpsApplicable = record['NPS Applicable'] === true || String(record['NPS Applicable']).toLowerCase() === 'yes' || record.isNpsApplicable === true;
        const pran = record['PRAN'] !== undefined ? record['PRAN'] : record.pran;
        const joiningDate = record['Date of NPS Joining'] !== undefined ? record['Date of NPS Joining'] : record.dateOfNpsJoining;
        const exitDate = record['Date of NPS Exit'] !== undefined ? record['Date of NPS Exit'] : record.dateOfNpsExit;

        const eePct = record['Employee Contribution %'] !== undefined ? record['Employee Contribution %'] : record.employeeContributionPercent;
        const eeAmt = record['Employee Contribution Amount'] !== undefined ? record['Employee Contribution Amount'] : record.employeeContributionAmount;
        const erPct = record['Employer Contribution %'] !== undefined ? record['Employer Contribution %'] : record.employerContributionPercent;
        const erAmt = record['Employer Contribution Amount'] !== undefined ? record['Employer Contribution Amount'] : record.employerContributionAmount;

        // 1. Mandatory Employee ID
        if (!empId || String(empId).trim() === '') {
            errors.push("Missing required field: 'Employee ID'.");
        }

        // 2. Cross-Sheet Foreign Key Validation
        if (empId && options.existingEmployeeIds && options.existingEmployeeIds instanceof Set) {
            if (!options.existingEmployeeIds.has(String(empId).trim())) {
                errors.push(`Foreign key validation failed: Employee ID '${empId}' does not match any active employee profile in the catalog.`);
            }
        }

        // 3. Organization ID Tenant Validation
        if (!orgId || String(orgId).trim() === '') {
            errors.push("Missing required field: 'Organization ID'.");
        } else if (options.orgId && String(orgId).trim().toLowerCase() !== String(options.orgId).trim().toLowerCase()) {
            errors.push(`Organization ID '${orgId}' does not match current tenant context '${options.orgId}'.`);
        }

        // 4. Conditional Integrity & PRAN Format Checking
        if (isNpsApplicable) {
            // PRAN Mandatory & 12 Digits
            if (!pran || String(pran).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory 12-digit PRAN when 'NPS Applicable' is Yes.");
            } else {
                const cleanPran = String(pran).trim();
                if (!/^\d{12}$/.test(cleanPran)) {
                    errors.push(`Invalid PRAN format '${cleanPran}'. PRAN must be strictly a 12-digit numeric identifier.`);
                }
            }

            // Date of NPS Joining
            if (!joiningDate || String(joiningDate).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory 'Date of NPS Joining' when 'NPS Applicable' is Yes.");
            }

            // Contribution Mutex: Employee (must provide either % or Amount)
            const hasEePct = eePct !== undefined && eePct !== null && String(eePct).trim() !== '';
            const hasEeAmt = eeAmt !== undefined && eeAmt !== null && String(eeAmt).trim() !== '';

            if (!hasEePct && !hasEeAmt) {
                errors.push("Contribution Mutex violation: Either 'Employee Contribution %' or 'Employee Contribution Amount' must be provided for active NPS subscriber.");
            } else {
                if (hasEePct) {
                    const num = Number(eePct);
                    if (isNaN(num) || num < 0 || num > 100) {
                        errors.push(`Invalid 'Employee Contribution %' value '${eePct}'. Percentage must be a valid number between 0 and 100.`);
                    }
                }
                if (hasEeAmt) {
                    const num = Number(eeAmt);
                    if (isNaN(num) || num < 0) {
                        errors.push(`Invalid 'Employee Contribution Amount' value '${eeAmt}'. Amount cannot be negative.`);
                    }
                }
            }

            // Contribution Mutex: Employer (must provide either % or Amount)
            const hasErPct = erPct !== undefined && erPct !== null && String(erPct).trim() !== '';
            const hasErAmt = erAmt !== undefined && erAmt !== null && String(erAmt).trim() !== '';

            if (!hasErPct && !hasErAmt) {
                errors.push("Contribution Mutex violation: Either 'Employer Contribution %' or 'Employer Contribution Amount' must be provided for active corporate NPS enrollment.");
            } else {
                if (hasErPct) {
                    const num = Number(erPct);
                    if (isNaN(num) || num < 0 || num > 100) {
                        errors.push(`Invalid 'Employer Contribution %' value '${erPct}'. Percentage must be a valid number between 0 and 100.`);
                    }
                }
                if (hasErAmt) {
                    const num = Number(erAmt);
                    if (isNaN(num) || num < 0) {
                        errors.push(`Invalid 'Employer Contribution Amount' value '${erAmt}'. Amount cannot be negative.`);
                    }
                }
            }
        }

        // 5. Date Sequence Integrity (Date of NPS Exit >= Date of NPS Joining)
        if (joiningDate && exitDate) {
            const fromDate = new Date(joiningDate);
            const toDate = new Date(exitDate);
            if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
                if (toDate < fromDate) {
                    errors.push(`Date sequence integrity violated: 'Date of NPS Exit' (${exitDate}) cannot precede 'Date of NPS Joining' (${joiningDate}). Exit date must be on or after joining date.`);
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
     * Path: organizations/{orgId}/employee_nps_details/{employeeId}
     */
    function toFirestoreDoc(record, options = {}) {
        const orgId = record['Organization ID'] || record.organizationId || options.orgId || 'ORG_KYLRX_01';
        const empId = record['Employee ID'] || record.employeeId;
        const isNpsApplicable = record['NPS Applicable'] === true || String(record['NPS Applicable']).trim().toLowerCase() === 'yes' || record.isNpsApplicable === true;
        const tier1Active = record['Tier I Active'] === true || String(record['Tier I Active']).trim().toLowerCase() === 'yes' || record.tier1Active === true;
        const tier2Active = record['Tier II Active'] === true || String(record['Tier II Active']).trim().toLowerCase() === 'yes' || record.tier2Active === true;

        // Parse contributions
        const rawEePct = record['Employee Contribution %'] !== undefined ? record['Employee Contribution %'] : record.employeeContributionPercent;
        const rawEeAmt = record['Employee Contribution Amount'] !== undefined ? record['Employee Contribution Amount'] : record.employeeContributionAmount;
        const rawErPct = record['Employer Contribution %'] !== undefined ? record['Employer Contribution %'] : record.employerContributionPercent;
        const rawErAmt = record['Employer Contribution Amount'] !== undefined ? record['Employer Contribution Amount'] : record.employerContributionAmount;
        const rawYtd = record['Total Contribution YTD'] !== undefined ? record['Total Contribution YTD'] : record.totalContributionYtd;

        const employeePercentage = (rawEePct !== null && rawEePct !== undefined && String(rawEePct).trim() !== '') ? Number(rawEePct) : null;
        const employeeAmount = (rawEeAmt !== null && rawEeAmt !== undefined && String(rawEeAmt).trim() !== '') ? Number(rawEeAmt) : null;
        const employerPercentage = (rawErPct !== null && rawErPct !== undefined && String(rawErPct).trim() !== '') ? Number(rawErPct) : null;
        const employerAmount = (rawErAmt !== null && rawErAmt !== undefined && String(rawErAmt).trim() !== '') ? Number(rawErAmt) : null;
        const totalContributionYtd = (rawYtd !== null && rawYtd !== undefined && String(rawYtd).trim() !== '') ? Math.max(0, Number(rawYtd)) : 0.00;

        return {
            employeeId: String(empId).trim(),
            organizationId: String(orgId).trim(),
            isNpsApplicable,
            pran: record['PRAN'] || record.pran || null,
            npsAccountStatus: normalizeEnum(record['NPS Account Status'] || record.npsAccountStatus, ENUMS.npsAccountStatus, "ACTIVE"),
            npsModel: normalizeEnum(record['NPS Model'] || record.npsModel, ENUMS.npsModel, "Corporate Model"),
            craAgency: normalizeEnum(record['CRA / Recordkeeping Agency'] || record.craRecordkeepingAgency || record.craAgency, ENUMS.craAgency, "Protean (NSDL)"),
            popIntermediary: record['POP / Intermediary'] || record.popIntermediary || "HDFC Pension Management Co.",
            tier1Active,
            tier2Active,
            dateOfNpsJoining: record['Date of NPS Joining'] || record.dateOfNpsJoining || "2026-01-15",
            dateOfNpsExit: record['Date of NPS Exit'] || record.dateOfNpsExit || null,
            contributions: {
                employeePercentage,
                employeeAmount,
                employerPercentage,
                employerAmount,
                totalContributionYtd
            },
            nomineeStatus: normalizeEnum(record['Nominee Details Status'] || record.nomineeDetailsStatus || record.nomineeStatus, ENUMS.nomineeStatus, "SUBMITTED"),
            kyc: {
                overallStatus: normalizeEnum(record['KYC Status'] || record.kycStatus, ENUMS.kycStatus, "VERIFIED"),
                panKyc: normalizeEnum(record['PAN KYC'] || record.panKyc, ENUMS.panKyc, "VERIFIED"),
                aadhaarKyc: normalizeEnum(record['Aadhaar KYC'] || record.aadhaarKyc, ENUMS.aadhaarKyc, "VERIFIED"),
                bankKyc: normalizeEnum(record['Bank KYC'] || record.bankKyc, ENUMS.bankKyc, "VERIFIED")
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Parses a single row into structured 22-attribute NPS record
     */
    function parseRecord(row, rowNumber = 1, options = {}) {
        const defaultOrgId = options.orgId || 'ORG_KYLRX_01';

        const rawEmpId = getVal(row, HEADER_SYNONYMS.employeeId);
        const rawOrgId = getVal(row, HEADER_SYNONYMS.organizationId) || defaultOrgId;
        const rawNpsApp = getVal(row, HEADER_SYNONYMS.npsApplicable);
        const rawPran = getVal(row, HEADER_SYNONYMS.pran);
        const rawStatus = getVal(row, HEADER_SYNONYMS.npsAccountStatus);
        const rawModel = getVal(row, HEADER_SYNONYMS.npsModel);
        const rawCra = getVal(row, HEADER_SYNONYMS.craRecordkeepingAgency);
        const rawPop = getVal(row, HEADER_SYNONYMS.popIntermediary);
        const rawTier1 = getVal(row, HEADER_SYNONYMS.tier1Active);
        const rawTier2 = getVal(row, HEADER_SYNONYMS.tier2Active);
        const rawJoining = getVal(row, HEADER_SYNONYMS.dateOfNpsJoining);
        const rawExit = getVal(row, HEADER_SYNONYMS.dateOfNpsExit);
        const rawEePct = getVal(row, HEADER_SYNONYMS.employeeContributionPercent);
        const rawEeAmt = getVal(row, HEADER_SYNONYMS.employeeContributionAmount);
        const rawErPct = getVal(row, HEADER_SYNONYMS.employerContributionPercent);
        const rawErAmt = getVal(row, HEADER_SYNONYMS.employerContributionAmount);
        const rawYtd = getVal(row, HEADER_SYNONYMS.totalContributionYtd);
        const rawNominee = getVal(row, HEADER_SYNONYMS.nomineeDetailsStatus);
        const rawKyc = getVal(row, HEADER_SYNONYMS.kycStatus);
        const rawPan = getVal(row, HEADER_SYNONYMS.panKyc);
        const rawAadhaar = getVal(row, HEADER_SYNONYMS.aadhaarKyc);
        const rawBank = getVal(row, HEADER_SYNONYMS.bankKyc);

        const isNpsApplicable = parseBoolean(rawNpsApp, true);
        const tier1Active = parseBoolean(rawTier1, isNpsApplicable);
        const tier2Active = parseBoolean(rawTier2, false);

        const sanitizedJoining = sanitizeDate(rawJoining);
        const sanitizedExit = sanitizeDate(rawExit);

        const employeeContributionPercent = (rawEePct !== undefined && rawEePct !== null && String(rawEePct).trim() !== '') ? Number(rawEePct) : null;
        const employeeContributionAmount = (rawEeAmt !== undefined && rawEeAmt !== null && String(rawEeAmt).trim() !== '') ? Number(rawEeAmt) : null;
        const employerContributionPercent = (rawErPct !== undefined && rawErPct !== null && String(rawErPct).trim() !== '') ? Number(rawErPct) : null;
        const employerContributionAmount = (rawErAmt !== undefined && rawErAmt !== null && String(rawErAmt).trim() !== '') ? Number(rawErAmt) : null;
        const totalContributionYtd = (rawYtd !== undefined && rawYtd !== null && String(rawYtd).trim() !== '') ? Number(rawYtd) : 0.00;

        const record = {
            'Employee ID': rawEmpId ? String(rawEmpId).trim() : '',
            'Organization ID': rawOrgId ? String(rawOrgId).trim() : defaultOrgId,
            'NPS Applicable': isNpsApplicable ? 'Yes' : 'No',
            'PRAN': rawPran ? String(rawPran).trim() : '',
            'NPS Account Status': normalizeEnum(rawStatus, ENUMS.npsAccountStatus, "ACTIVE"),
            'NPS Model': normalizeEnum(rawModel, ENUMS.npsModel, "Corporate Model"),
            'CRA / Recordkeeping Agency': normalizeEnum(rawCra, ENUMS.craAgency, "Protean (NSDL)"),
            'POP / Intermediary': rawPop ? String(rawPop).trim() : "HDFC Pension Management Co.",
            'Tier I Active': tier1Active ? 'Yes' : 'No',
            'Tier II Active': tier2Active ? 'Yes' : 'No',
            'Date of NPS Joining': sanitizedJoining,
            'Date of NPS Exit': sanitizedExit,
            'Employee Contribution %': employeeContributionPercent,
            'Employee Contribution Amount': employeeContributionAmount,
            'Employer Contribution %': employerContributionPercent,
            'Employer Contribution Amount': employerContributionAmount,
            'Total Contribution YTD': totalContributionYtd,
            'Nominee Details Status': normalizeEnum(rawNominee, ENUMS.nomineeStatus, "SUBMITTED"),
            'KYC Status': normalizeEnum(rawKyc, ENUMS.kycStatus, "VERIFIED"),
            'PAN KYC': normalizeEnum(rawPan, ENUMS.panKyc, "VERIFIED"),
            'Aadhaar KYC': normalizeEnum(rawAadhaar, ENUMS.aadhaarKyc, "VERIFIED"),
            'Bank KYC': normalizeEnum(rawBank, ENUMS.bankKyc, "VERIFIED"),

            // CamelCase aliases
            employeeId: rawEmpId ? String(rawEmpId).trim() : '',
            organizationId: rawOrgId ? String(rawOrgId).trim() : defaultOrgId,
            isNpsApplicable,
            pran: rawPran ? String(rawPran).trim() : '',
            npsAccountStatus: normalizeEnum(rawStatus, ENUMS.npsAccountStatus, "ACTIVE"),
            npsModel: normalizeEnum(rawModel, ENUMS.npsModel, "Corporate Model"),
            craRecordkeepingAgency: normalizeEnum(rawCra, ENUMS.craAgency, "Protean (NSDL)"),
            craAgency: normalizeEnum(rawCra, ENUMS.craAgency, "Protean (NSDL)"),
            popIntermediary: rawPop ? String(rawPop).trim() : "HDFC Pension Management Co.",
            tier1Active,
            tier2Active,
            dateOfNpsJoining: sanitizedJoining,
            dateOfNpsExit: sanitizedExit,
            employeeContributionPercent,
            employeeContributionAmount,
            employerContributionPercent,
            employerContributionAmount,
            totalContributionYtd,
            nomineeDetailsStatus: normalizeEnum(rawNominee, ENUMS.nomineeStatus, "SUBMITTED"),
            kycStatus: normalizeEnum(rawKyc, ENUMS.kycStatus, "VERIFIED"),
            panKyc: normalizeEnum(rawPan, ENUMS.panKyc, "VERIFIED"),
            aadhaarKyc: normalizeEnum(rawAadhaar, ENUMS.aadhaarKyc, "VERIFIED"),
            bankKyc: normalizeEnum(rawBank, ENUMS.bankKyc, "VERIFIED")
        };

        return record;
    }

    /**
     * Ingests, normalizes, and validates all rows from 'NPS Details' sheet.
     * Generates structured 22-attribute records, Firestore payloads, and row-level error reports.
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
                'NPS Applicable': record.isNpsApplicable
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
        NPS_DETAILS_ATTRIBUTES,
        HEADER_SYNONYMS,
        ENUMS,
        normalizeKey,
        sanitizeDate,
        normalizeDate: sanitizeDate,
        parseBoolean,
        normalizeBoolean: parseBoolean,
        normalizeEnum,
        parseRecord,
        validateRecord,
        toFirestoreDoc,
        parseSheetRows
    };
}));
