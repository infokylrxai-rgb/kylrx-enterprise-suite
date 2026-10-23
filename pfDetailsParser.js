/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - EPFO / PF & UAN STATUTORY MASTER PARSER & VALIDATOR
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes employee EPFO statutory profiles
 * matching all 19 columns from the 'PF Details' / 'EPFO Master' sheet of
 * Templates.xlsx and PRD Sections 1, 4, 11, & 13:
 * 
 * Exact 19 Attributes:
 * 1.  Employee ID (string, foreign key referencing active employee in `employees` collection)
 * 2.  Organization ID (string, tenant/org identifier e.g. ORG_KYLRX_01)
 * 3.  PF Applicable (boolean: true for "Yes", false for "No")
 * 4.  UAN (string, 12 digits; mandatory if PF Applicable is true)
 * 5.  Current Member ID (string, active establishment member ID)
 * 6.  Previous UAN (string | null, 12 digits if historical account exists)
 * 7.  Previous Member ID (string | null, previous employer PF member code)
 * 8.  EPFO Establishment ID (string, employer registration code e.g. KN/BNG/0012345/000)
 * 9.  Date of PF Joining (string / ISO Date: YYYY-MM-DD)
 * 10. Date of PF Exit (string | null / ISO Date: YYYY-MM-DD)
 * 11. EPS Applicable (boolean: true for "Yes", false for "No")
 * 12. EDLI Applicable (boolean: true for "Yes", false for "No")
 * 13. KYC Status (string enum: "VERIFIED", "PENDING", "REJECTED", "NOT_INITIATED")
 * 14. Aadhaar KYC (string enum: "VERIFIED", "PENDING", "NOT_SEEDED")
 * 15. PAN KYC (string enum: "VERIFIED", "PENDING", "NOT_SEEDED")
 * 16. Bank KYC (string enum: "VERIFIED", "PENDING", "REJECTED")
 * 17. UAN Status (string enum: "ACTIVE", "INACTIVE", "BLOCKED")
 * 18. UAN Verification Status (string enum: "SUCCESS", "PENDING", "FAILED")
 * 19. Official Source (string: e.g. "EPFO Unified Portal", "Decentro Fabric", "Manual Upload", "Admin Override")
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
        root.KylrxPfDetailsParser = factory();
        root.pfDetailsParser = root.KylrxPfDetailsParser;
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
        pfApplicable: [
            'pf applicable', 'pf_applicable', 'pfapplicable', 'is_pf_applicable',
            'pf eligible', 'epf_applicable', 'pf_flag', 'epf applicable', 'is pf applicable'
        ],
        uan: [
            'uan', 'uan_number', 'uannumber', 'universal_account_number', 'universal account number',
            'uan no', 'uanno', 'uan id', 'employee_uan'
        ],
        currentMemberId: [
            'current member id', 'current_member_id', 'currentmemberid', 'member_id', 'memberid',
            'pf_member_id', 'pf member id', 'pfmemberid', 'current_pf_member_id', 'active_member_id',
            'establishment_member_id'
        ],
        previousUan: [
            'previous uan', 'previous_uan', 'previousuan', 'prev_uan', 'prevuan', 'prior_uan',
            'old_uan', 'historical_uan', 'previous universal account number'
        ],
        previousMemberId: [
            'previous member id', 'previous_member_id', 'previousmemberid', 'prev_member_id',
            'prevmemberid', 'prior_member_id', 'old_member_id', 'previous_pf_member_id'
        ],
        epfoEstablishmentId: [
            'epfo establishment id', 'epfo_establishment_id', 'epfoestablishmentid',
            'establishment_id', 'establishmentid', 'establishment_code', 'establishmentcode',
            'epfo establishment code', 'est_id', 'est_code', 'pf_establishment_id'
        ],
        dateOfPfJoining: [
            'date of pf joining', 'date_of_pf_joining', 'dateofpfjoining', 'pf_joining_date',
            'pf joining date', 'pf_doj', 'pfdoj', 'pf_join_date', 'date_of_joining_pf',
            'joining_date_pf', 'epf_doj'
        ],
        dateOfPfExit: [
            'date of pf exit', 'date_of_pf_exit', 'dateofpfexit', 'pf_exit_date', 'pf exit date',
            'pf_doe', 'pfdoe', 'date_of_exit_pf', 'pf_leaving_date', 'exit_date_pf'
        ],
        epsApplicable: [
            'eps applicable', 'eps_applicable', 'epsapplicable', 'is_eps_applicable',
            'eps eligible', 'pension_applicable', 'is_pension_applicable', 'is eps applicable'
        ],
        edliApplicable: [
            'edli applicable', 'edli_applicable', 'edliapplicable', 'is_edli_applicable',
            'edli eligible', 'insurance_applicable', 'is edli applicable'
        ],
        kycStatus: [
            'kyc status', 'kyc_status', 'kycstatus', 'overall_kyc_status', 'overall kyc',
            'kyc_overall_status', 'epfo_kyc_status', 'status_kyc'
        ],
        aadhaarKyc: [
            'aadhaar kyc', 'aadhaar_kyc', 'aadhaarkyc', 'aadhaar_status', 'aadhaar_kyc_status',
            'aadhaar seeded', 'uidai_kyc', 'aadhaar_verification_status'
        ],
        panKyc: [
            'pan kyc', 'pan_kyc', 'pankyc', 'pan_status', 'pan_kyc_status', 'pan_seeded',
            'income_tax_pan_kyc', 'pan_verification_status'
        ],
        bankKyc: [
            'bank kyc', 'bank_kyc', 'bankkyc', 'bank_status', 'bank_kyc_status', 'bank_seeded',
            'bank_account_kyc', 'bank_verification_status'
        ],
        uanStatus: [
            'uan status', 'uan_status', 'uanstatus', 'account_status', 'epfo_uan_status',
            'member_uan_status'
        ],
        uanVerificationStatus: [
            'uan verification status', 'uan_verification_status', 'uanverificationstatus',
            'verification_status', 'verificationstatus', 'uan_verify_status', 'decentro_verification_status'
        ],
        officialSource: [
            'official source', 'official_source', 'officialsource', 'source', 'verification_source',
            'data_source', 'provenance', 'kyc_source', 'auth_source'
        ]
    };

    /**
     * Exact 19 Attributes Schema Definition matching PRD Sections 1, 4, 11, & 13
     */
    const PF_DETAILS_ATTRIBUTES = [
        { key: "Employee ID", label: "1. Employee ID", required: true, synonyms: HEADER_SYNONYMS.employeeId },
        { key: "Organization ID", label: "2. Organization ID", required: true, defaultValue: "ORG_KYLRX_01", synonyms: HEADER_SYNONYMS.organizationId },
        { key: "PF Applicable", label: "3. PF Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.pfApplicable },
        { key: "UAN", label: "4. UAN (12 Digits)", required: false, synonyms: HEADER_SYNONYMS.uan },
        { key: "Current Member ID", label: "5. Current Member ID", required: false, synonyms: HEADER_SYNONYMS.currentMemberId },
        { key: "Previous UAN", label: "6. Previous UAN", required: false, synonyms: HEADER_SYNONYMS.previousUan },
        { key: "Previous Member ID", label: "7. Previous Member ID", required: false, synonyms: HEADER_SYNONYMS.previousMemberId },
        { key: "EPFO Establishment ID", label: "8. EPFO Establishment ID", required: false, defaultValue: "KN/BNG/0012345/000", synonyms: HEADER_SYNONYMS.epfoEstablishmentId },
        { key: "Date of PF Joining", label: "9. Date of PF Joining (YYYY-MM-DD)", required: false, synonyms: HEADER_SYNONYMS.dateOfPFJoining },
        { key: "Date of PF Exit", label: "10. Date of PF Exit (YYYY-MM-DD)", required: false, synonyms: HEADER_SYNONYMS.dateOfPFExit },
        { key: "EPS Applicable", label: "11. EPS Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.epsApplicable },
        { key: "EDLI Applicable", label: "12. EDLI Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.edliApplicable },
        { key: "KYC Status", label: "13. KYC Status", required: true, defaultValue: "NOT_INITIATED", synonyms: HEADER_SYNONYMS.kycStatus },
        { key: "Aadhaar KYC", label: "14. Aadhaar KYC", required: true, defaultValue: "NOT_SEEDED", synonyms: HEADER_SYNONYMS.aadhaarKyc },
        { key: "PAN KYC", label: "15. PAN KYC", required: true, defaultValue: "NOT_SEEDED", synonyms: HEADER_SYNONYMS.panKyc },
        { key: "Bank KYC", label: "16. Bank KYC", required: true, defaultValue: "PENDING", synonyms: HEADER_SYNONYMS.bankKyc },
        { key: "UAN Status", label: "17. UAN Status", required: true, defaultValue: "ACTIVE", synonyms: HEADER_SYNONYMS.uanStatus },
        { key: "UAN Verification Status", label: "18. UAN Verification Status", required: true, defaultValue: "PENDING", synonyms: HEADER_SYNONYMS.uanVerificationStatus },
        { key: "Official Source", label: "19. Official Source", required: true, defaultValue: "Manual Upload", synonyms: HEADER_SYNONYMS.officialSource }
    ];

    // Allowed Enum Definitions strictly adhering to PRD Sections 1 & 13
    const VALID_ENUMS = {
        kycStatus: ['VERIFIED', 'PENDING', 'REJECTED', 'NOT_INITIATED'],
        aadhaarKyc: ['VERIFIED', 'PENDING', 'NOT_SEEDED'],
        panKyc: ['VERIFIED', 'PENDING', 'NOT_SEEDED'],
        bankKyc: ['VERIFIED', 'PENDING', 'REJECTED'],
        uanStatus: ['ACTIVE', 'INACTIVE', 'BLOCKED'],
        uanVerificationStatus: ['SUCCESS', 'PENDING', 'FAILED']
    };

    const UAN_REGEX = /^\d{12}$/;
    const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

    /**
     * Normalizes an arbitrary header or synonym string into a clean lookup key.
     */
    function normalizeKey(str) {
        return String(str || '').toLowerCase().replace(/[\s_\-()/.]+/g, '');
    }

    /**
     * Resolves the value from raw row using synonyms list.
     */
    function getVal(row, synonyms) {
        if (!row || typeof row !== 'object') return null;
        const keys = Object.keys(row);
        for (const syn of synonyms) {
            const cleanSyn = normalizeKey(syn);
            const foundKey = keys.find(k => normalizeKey(k) === cleanSyn);
            if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
                const val = row[foundKey];
                if (typeof val === 'string') {
                    const trimmed = val.trim();
                    if (trimmed !== '') return trimmed;
                } else {
                    return val;
                }
            }
        }
        return null;
    }

    /**
     * Parses boolean representation from text, numbers, or boolean values.
     */
    function parseBoolean(val, defaultVal = true) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', '1', 't', 'active', 'applicable'].includes(s)) return true;
        if (['no', 'n', 'false', '0', 'f', 'inactive', 'not applicable', 'na'].includes(s)) return false;
        return defaultVal;
    }

    /**
     * Normalizes dates to strict ISO YYYY-MM-DD string.
     * Supports Excel serial days, Date objects, and standard string formats.
     */
    function sanitizeDate(val) {
        if (!val) return null;
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'na' || trimmed.toLowerCase() === 'n/a') {
                return null;
            }
            if (ISO_DATE_REGEX.test(trimmed)) {
                return trimmed;
            }
            // Parse DD/MM/YYYY or DD-MM-YYYY
            const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (ddmmyyyy) {
                const day = ddmmyyyy[1].padStart(2, '0');
                const month = ddmmyyyy[2].padStart(2, '0');
                const year = ddmmyyyy[3];
                return `${year}-${month}-${day}`;
            }
            // Parse MM/DD/YYYY if valid
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString().split('T')[0];
            }
            return trimmed;
        }

        if (typeof val === 'number') {
            // Excel serial date number conversion (origin 1899-12-30)
            const utcDays = Math.floor(val - 25569);
            const utcValue = utcDays * 86400;
            const dateInfo = new Date(utcValue * 1000);
            return dateInfo.toISOString().split('T')[0];
        }

        if (val instanceof Date && !isNaN(val.getTime())) {
            return val.toISOString().split('T')[0];
        }

        return null;
    }

    /**
     * Validates strict 12-digit UAN number syntax.
     */
    function validateUAN(uan) {
        if (!uan) return false;
        return UAN_REGEX.test(String(uan).trim());
    }

    /**
     * Resolves matching enum or defaults gracefully.
     */
    function normalizeEnum(val, validList, defaultVal) {
        if (!val) return defaultVal;
        const upper = String(val).trim().toUpperCase().replace(/[\s-]+/g, '_');
        if (validList.includes(upper)) return upper;
        // Check partial matches or aliases
        const match = validList.find(e => upper.includes(e) || e.includes(upper));
        return match || defaultVal;
    }

    /**
     * Validates a single EPFO statutory master record against PRD business constraints.
     */
    function validateRecord(record, options = {}) {
        const errors = [];
        const existingEmployeeIds = options.existingEmployeeIds || null;
        const tenantOrgId = options.orgId || options.tenantId || null;

        // 1. Employee ID check
        if (!record['Employee ID'] || String(record['Employee ID']).trim() === '') {
            errors.push("Attribute 'Employee ID' is mandatory and cannot be empty.");
        } else {
            const empId = String(record['Employee ID']).trim();
            // Foreign Key Check
            if (existingEmployeeIds instanceof Set && !existingEmployeeIds.has(empId)) {
                errors.push(`Foreign key validation failed: Employee ID '${empId}' does not map to any active employee profile in the catalog.`);
            }
        }

        // 2. Organization ID check
        if (!record['Organization ID'] || String(record['Organization ID']).trim() === '') {
            errors.push("Attribute 'Organization ID' is mandatory.");
        } else if (tenantOrgId && String(record['Organization ID']).trim() !== tenantOrgId) {
            errors.push(`Tenant mismatch: Organization ID '${record['Organization ID']}' does not match active tenant scope '${tenantOrgId}'.`);
        }

        const isPfApplicable = record['PF Applicable'] === true;

        // 3. Conditional PF Applicable validations
        if (isPfApplicable) {
            // UAN format validation
            if (!record['UAN'] || String(record['UAN']).trim() === '') {
                errors.push("Discrepancy detected: 'PF Applicable' is Yes, but 'UAN' is missing.");
            } else if (!validateUAN(record['UAN'])) {
                errors.push(`UAN '${record['UAN']}' is invalid: must strictly contain 12 numeric digits (/^\\d{12}$/).`);
            }

            // Current Member ID validation
            if (!record['Current Member ID'] || String(record['Current Member ID']).trim() === '') {
                errors.push("Attribute 'Current Member ID' is mandatory when PF is applicable.");
            }

            // Date of PF Joining validation
            if (!record['Date of PF Joining'] || String(record['Date of PF Joining']).trim() === '') {
                errors.push("Discrepancy detected: 'PF Applicable' is Yes, but 'Date of PF Joining' is empty.");
            } else if (!ISO_DATE_REGEX.test(record['Date of PF Joining'])) {
                errors.push(`'Date of PF Joining' (${record['Date of PF Joining']}) must be in valid ISO YYYY-MM-DD format.`);
            }
        }

        // 4. Previous UAN validation (if provided)
        if (record['Previous UAN'] && String(record['Previous UAN']).trim() !== '') {
            if (!validateUAN(record['Previous UAN'])) {
                errors.push(`'Previous UAN' (${record['Previous UAN']}) is invalid: must strictly contain 12 numeric digits.`);
            }
        }

        // 5. Date sequence integrity
        if (record['Date of PF Joining'] && record['Date of PF Exit']) {
            if (record['Date of PF Exit'] < record['Date of PF Joining']) {
                errors.push(`Date sequence violation: 'Date of PF Exit' (${record['Date of PF Exit']}) cannot precede 'Date of PF Joining' (${record['Date of PF Joining']}).`);
            }
        }

        // 6. Enum constraints
        if (record['KYC Status'] && !VALID_ENUMS.kycStatus.includes(record['KYC Status'])) {
            errors.push(`Invalid 'KYC Status' '${record['KYC Status']}'. Allowed: ${VALID_ENUMS.kycStatus.join(', ')}.`);
        }
        if (record['Aadhaar KYC'] && !VALID_ENUMS.aadhaarKyc.includes(record['Aadhaar KYC'])) {
            errors.push(`Invalid 'Aadhaar KYC' '${record['Aadhaar KYC']}'. Allowed: ${VALID_ENUMS.aadhaarKyc.join(', ')}.`);
        }
        if (record['PAN KYC'] && !VALID_ENUMS.panKyc.includes(record['PAN KYC'])) {
            errors.push(`Invalid 'PAN KYC' '${record['PAN KYC']}'. Allowed: ${VALID_ENUMS.panKyc.join(', ')}.`);
        }
        if (record['Bank KYC'] && !VALID_ENUMS.bankKyc.includes(record['Bank KYC'])) {
            errors.push(`Invalid 'Bank KYC' '${record['Bank KYC']}'. Allowed: ${VALID_ENUMS.bankKyc.join(', ')}.`);
        }
        if (record['UAN Status'] && !VALID_ENUMS.uanStatus.includes(record['UAN Status'])) {
            errors.push(`Invalid 'UAN Status' '${record['UAN Status']}'. Allowed: ${VALID_ENUMS.uanStatus.join(', ')}.`);
        }
        if (record['UAN Verification Status'] && !VALID_ENUMS.uanVerificationStatus.includes(record['UAN Verification Status'])) {
            errors.push(`Invalid 'UAN Verification Status' '${record['UAN Verification Status']}'. Allowed: ${VALID_ENUMS.uanVerificationStatus.join(', ')}.`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Converts raw parsed record into canonical Cloud Firestore document schema:
     * Path: organizations/{orgId}/employee_pf_details/{employeeId}
     */
    function toFirestoreDoc(record, options = {}) {
        const orgId = record['Organization ID'] || options.orgId || 'ORG_KYLRX_01';
        const empId = record['Employee ID'];
        const isPfApplicable = record['PF Applicable'] === true || String(record['PF Applicable']).trim().toLowerCase() === 'yes';

        const kycOverall = record['KYC Status'] || (
            (record['Aadhaar KYC'] === 'VERIFIED' && record['PAN KYC'] === 'VERIFIED' && record['Bank KYC'] === 'VERIFIED')
                ? 'VERIFIED'
                : 'PENDING'
        );

        const verificationStatus = record['UAN Verification Status'] || (
            kycOverall === 'VERIFIED' ? 'SUCCESS' : 'PENDING'
        );

        return {
            employeeId: empId,
            organizationId: orgId,
            isPfApplicable: isPfApplicable,
            uan: isPfApplicable ? (record['UAN'] || null) : null,
            currentMemberId: record['Current Member ID'] || null,
            previousUan: record['Previous UAN'] || null,
            previousMemberId: record['Previous Member ID'] || null,
            epfoEstablishmentId: record['EPFO Establishment ID'] || 'KN/BNG/0012345/000',
            dateOfPfJoining: record['Date of PF Joining'] || null,
            dateOfPfExit: record['Date of PF Exit'] || null,
            isEpsApplicable: record['EPS Applicable'] === true || String(record['EPS Applicable']).trim().toLowerCase() === 'yes' || record['EPS Applicable'] === undefined,
            isEdliApplicable: record['EDLI Applicable'] === true || String(record['EDLI Applicable']).trim().toLowerCase() === 'yes' || record['EDLI Applicable'] === undefined,
            kyc: {
                overallStatus: kycOverall,
                aadhaarKyc: record['Aadhaar KYC'] || 'NOT_SEEDED',
                panKyc: record['PAN KYC'] || 'NOT_SEEDED',
                bankKyc: record['Bank KYC'] || 'PENDING'
            },
            uanStatus: record['UAN Status'] || 'ACTIVE',
            verification: {
                status: verificationStatus,
                officialSource: record['Official Source'] || 'Decentro Fabric',
                verifiedAt: verificationStatus === 'SUCCESS' ? new Date().toISOString() : null
            },
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Ingests, normalizes, and validates all rows from 'PF Details' / 'EPFO Master' sheet.
     * Generates structured 19-attribute records, Firestore payloads, and row-level error reports.
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
                errors: [{ row: 0, message: "Input data must be a valid array of sheet row objects." }]
            };
        }

        const records = [];
        const firestoreDocs = [];
        const errors = [];
        const seenEmpIds = new Set();
        const seenUans = new Set();
        const defaultOrgId = options.orgId || 'ORG_KYLRX_01';

        rows.forEach((row, index) => {
            const rowNumber = index + 1;

            // Skip entirely blank rows
            const values = Object.values(row).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (values.length === 0) return;

            // Extract all 19 attributes using canonical synonyms
            const rawEmpId = getVal(row, HEADER_SYNONYMS.employeeId);
            const rawOrgId = getVal(row, HEADER_SYNONYMS.organizationId) || defaultOrgId;
            const rawPfApp = getVal(row, HEADER_SYNONYMS.pfApplicable);
            const rawUan = getVal(row, HEADER_SYNONYMS.uan);
            const rawCurrentMemberId = getVal(row, HEADER_SYNONYMS.currentMemberId);
            const rawPrevUan = getVal(row, HEADER_SYNONYMS.previousUan);
            const rawPrevMemberId = getVal(row, HEADER_SYNONYMS.previousMemberId);
            const rawEstId = getVal(row, HEADER_SYNONYMS.epfoEstablishmentId);
            const rawDoj = getVal(row, HEADER_SYNONYMS.dateOfPfJoining);
            const rawDoe = getVal(row, HEADER_SYNONYMS.dateOfPfExit);
            const rawEpsApp = getVal(row, HEADER_SYNONYMS.epsApplicable);
            const rawEdliApp = getVal(row, HEADER_SYNONYMS.edliApplicable);
            const rawKycStatus = getVal(row, HEADER_SYNONYMS.kycStatus);
            const rawAadhaarKyc = getVal(row, HEADER_SYNONYMS.aadhaarKyc);
            const rawPanKyc = getVal(row, HEADER_SYNONYMS.panKyc);
            const rawBankKyc = getVal(row, HEADER_SYNONYMS.bankKyc);
            const rawUanStatus = getVal(row, HEADER_SYNONYMS.uanStatus);
            const rawUanVerifyStatus = getVal(row, HEADER_SYNONYMS.uanVerificationStatus);
            const rawOfficialSource = getVal(row, HEADER_SYNONYMS.officialSource);

            const isPfApplicable = parseBoolean(rawPfApp, true);
            const uanNormalized = rawUan ? String(rawUan).trim().replace(/\D/g, '') : '';
            const prevUanNormalized = rawPrevUan ? String(rawPrevUan).trim().replace(/\D/g, '') : null;
            const pfDojSanitized = sanitizeDate(rawDoj);
            const pfDoeSanitized = sanitizeDate(rawDoe);

            const record = {
                'Employee ID': rawEmpId ? String(rawEmpId).trim() : '',
                'Organization ID': rawOrgId ? String(rawOrgId).trim() : defaultOrgId,
                'PF Applicable': isPfApplicable ? 'Yes' : 'No',
                'UAN': uanNormalized,
                'Current Member ID': rawCurrentMemberId ? String(rawCurrentMemberId).trim() : '',
                'Previous UAN': prevUanNormalized,
                'Previous Member ID': rawPrevMemberId ? String(rawPrevMemberId).trim() : null,
                'EPFO Establishment ID': rawEstId ? String(rawEstId).trim() : 'KN/BNG/0012345/000',
                'Date of PF Joining': pfDojSanitized,
                'Date of PF Exit': pfDoeSanitized,
                'EPS Applicable': parseBoolean(rawEpsApp, true) ? 'Yes' : 'No',
                'EDLI Applicable': parseBoolean(rawEdliApp, true) ? 'Yes' : 'No',
                'KYC Status': normalizeEnum(rawKycStatus, VALID_ENUMS.kycStatus, 'NOT_INITIATED'),
                'Aadhaar KYC': normalizeEnum(rawAadhaarKyc, VALID_ENUMS.aadhaarKyc, 'NOT_SEEDED'),
                'PAN KYC': normalizeEnum(rawPanKyc, VALID_ENUMS.panKyc, 'NOT_SEEDED'),
                'Bank KYC': normalizeEnum(rawBankKyc, VALID_ENUMS.bankKyc, 'PENDING'),
                'UAN Status': normalizeEnum(rawUanStatus, VALID_ENUMS.uanStatus, 'ACTIVE'),
                'UAN Verification Status': normalizeEnum(rawUanVerifyStatus, VALID_ENUMS.uanVerificationStatus, 'PENDING'),
                'Official Source': rawOfficialSource ? String(rawOfficialSource).trim() : 'Manual Upload'
            };

            // Convert string flags to boolean for validation engine
            const validationTarget = {
                ...record,
                'PF Applicable': isPfApplicable,
                'EPS Applicable': record['EPS Applicable'] === 'Yes',
                'EDLI Applicable': record['EDLI Applicable'] === 'Yes'
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

            if (isPfApplicable && record['UAN']) {
                if (seenUans.has(record['UAN'])) {
                    validation.valid = false;
                    validation.errors.push(`Duplicate UAN '${record['UAN']}' detected across sheet records at row ${rowNumber}.`);
                } else {
                    seenUans.add(record['UAN']);
                }
            }

            if (!validation.valid) {
                validation.errors.forEach(msg => {
                    errors.push({
                        row: rowNumber,
                        employeeId: record['Employee ID'] || `Row_${rowNumber}`,
                        message: `Row ${rowNumber}: ${msg}`
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
        PF_DETAILS_ATTRIBUTES,
        HEADER_SYNONYMS,
        VALID_ENUMS,
        normalizeKey,
        sanitizeDate,
        validateUAN,
        validateRecord,
        toFirestoreDoc,
        parseSheetRows
    };
}));
