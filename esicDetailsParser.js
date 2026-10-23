/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ESIC STATUTORY MASTER PARSER & VALIDATOR ENGINE
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes employee ESIC statutory profiles
 * matching all 18 columns from the 'ESIC Details' sheet of Templates.xlsx
 * and PRD Sections 1, 4, 11, & 13:
 * 
 * Exact 18 Attributes:
 * 1.  Employee ID (string, foreign key referencing active employee in Firestore)
 * 2.  Organization ID (string, tenant/org identifier matching active organization context)
 * 3.  ESIC Applicable (boolean: true for "Yes", false for "No")
 * 4.  IP Number (string | null, 10 to 17-digit Insured Person number; mandatory if ESIC Applicable is true)
 * 5.  ESIC Employer Code (string, 17-digit establishment code e.g. 53000123450000001)
 * 6.  Date of ESIC Joining (string / ISO Date: YYYY-MM-DD)
 * 7.  Date of ESIC Exit (string | null / ISO Date: YYYY-MM-DD)
 * 8.  Insured Person Status (string enum: "ACTIVE", "INACTIVE", "SUSPENDED", "EXEMPTED")
 * 9.  Aadhaar Seeding (string enum: "VERIFIED", "PENDING", "NOT_SEEDED")
 * 10. Family/Dependent Details (string enum: "SUBMITTED", "VERIFIED", "PENDING", "NOT_APPLICABLE")
 * 11. Dispensary/Branch (string, designated medical dispensary or ESIC clinic code/name)
 * 12. Contribution State (string, state jurisdiction e.g. "Karnataka", "Maharashtra", "Delhi")
 * 13. Insurance Number Verified (boolean: true for "Yes" / "VERIFIED", false for "No" / "UNVERIFIED")
 * 14. Official Source (string: e.g. "ESIC Portal", "Decentro Fabric", "Manual Upload", "Admin Override")
 * 15. Verification Method (string enum: "API", "OTP_AADHAAR", "PORTAL_SCRAPE", "MANUAL")
 * 16. Verification Reference (string | null, external transaction reference or Decentro request ID)
 * 17. Last Verified (string / ISO timestamp: YYYY-MM-DD HH:mm:ss or ISO 8601 string or null)
 * 18. Last Synced (string / ISO timestamp: YYYY-MM-DD HH:mm:ss or ISO 8601 string or null)
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
        root.KylrxEsicDetailsParser = factory();
        root.esicDetailsParser = root.KylrxEsicDetailsParser;
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
        esicApplicable: [
            'esic applicable', 'esic_applicable', 'esicapplicable', 'is_esic_applicable',
            'esi_applicable', 'esi applicable', 'is esic applicable', 'esic_eligible',
            'esic flag', 'is_esi_applicable', 'esic applicable (yes/no)'
        ],
        ipNumber: [
            'ip number', 'ip_number', 'ipnumber', 'ip_no', 'ipno', 'insured_person_number',
            'insurance_number', 'esic_ip', 'esic_ip_number', 'esic no', 'esic_no',
            'ip_code', 'ip number (if applicable)'
        ],
        esicEmployerCode: [
            'esic employer code', 'esic_employer_code', 'esicemployercode', 'employer_code',
            'employercode', 'establishment_code', 'esic_establishment_code', 'employer_code_esic',
            'esic establishment id', 'esic_code', 'employer code'
        ],
        dateOfEsicJoining: [
            'date of esic joining', 'date_of_esic_joining', 'dateofesicjoining', 'esic_joining_date',
            'esic_doj', 'esic joining date', 'esi_doj', 'date_of_joining_esic', 'esic_join_date',
            'esi_join_date', 'date of esi joining'
        ],
        dateOfEsicExit: [
            'date of esic exit', 'date_of_esic_exit', 'dateofesicexit', 'esic_exit_date',
            'esic_doe', 'esic exit date', 'esi_doe', 'date_of_exit_esic', 'esic_leaving_date',
            'exit_date_esic', 'date of esi exit'
        ],
        insuredPersonStatus: [
            'insured person status', 'insured_person_status', 'insuredpersonstatus', 'ip_status',
            'ipstatus', 'person_status', 'status', 'esic_status', 'coverage_status'
        ],
        aadhaarSeeding: [
            'aadhaar seeding', 'aadhaar_seeding', 'aadhaarseeding', 'aadhaar_kyc',
            'aadhaarkyc', 'aadhaar_status', 'aadhaar seeded', 'uidai_seeding', 'aadhaar status'
        ],
        familyDependentDetails: [
            'family/dependent details', 'family_dependent_details', 'familydependentdetails',
            'dependent_details', 'family_details', 'dependent_status', 'family_status',
            'dependents', 'family details'
        ],
        dispensaryBranch: [
            'dispensary/branch', 'dispensary_branch', 'dispensarybranch', 'dispensary',
            'branch', 'esic_dispensary', 'clinic', 'medical_dispensary', 'dispensary name',
            'dispensary / branch'
        ],
        contributionState: [
            'contribution state', 'contribution_state', 'contributionstate', 'state',
            'jurisdiction', 'applicable_state', 'esic_state', 'region', 'state of contribution'
        ],
        insuranceNumberVerified: [
            'insurance number verified', 'insurance_number_verified', 'insurancenumberverified',
            'is_verified', 'verified', 'ip_verified', 'insurance_verified', 'ip number verified',
            'is insurance number verified'
        ],
        officialSource: [
            'official source', 'official_source', 'officialsource', 'source', 'verification_source',
            'data_source', 'provenance', 'auth_source'
        ],
        verificationMethod: [
            'verification method', 'verification_method', 'verificationmethod', 'method',
            'verify_method', 'auth_method'
        ],
        verificationReference: [
            'verification reference', 'verification_reference', 'verificationreference',
            'reference', 'ref_no', 'transaction_ref', 'decentro_ref', 'ref_id', 'request_id'
        ],
        lastVerified: [
            'last verified', 'last_verified', 'lastverified', 'verified_at', 'verification_date',
            'verified_date', 'last_verified_at', 'verification timestamp'
        ],
        lastSynced: [
            'last synced', 'last_synced', 'lastsynced', 'synced_at', 'sync_date', 'last_synced_at'
        ]
    };

    /**
     * Exact 18 Attributes Schema Definition matching PRD Sections 1, 4, 11, & 13
     */
    const ESIC_DETAILS_ATTRIBUTES = [
        { key: "Employee ID", label: "1. Employee ID", required: true, synonyms: HEADER_SYNONYMS.employeeId },
        { key: "Organization ID", label: "2. Organization ID", required: true, defaultValue: "ORG_KYLRX_01", synonyms: HEADER_SYNONYMS.organizationId },
        { key: "ESIC Applicable", label: "3. ESIC Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.esicApplicable },
        { key: "IP Number", label: "4. IP Number (10 to 17 Digits)", required: false, synonyms: HEADER_SYNONYMS.ipNumber },
        { key: "ESIC Employer Code", label: "5. ESIC Employer Code (17 Digits)", required: false, defaultValue: "53000123450000001", synonyms: HEADER_SYNONYMS.esicEmployerCode },
        { key: "Date of ESIC Joining", label: "6. Date of ESIC Joining (YYYY-MM-DD)", required: false, synonyms: HEADER_SYNONYMS.dateOfEsicJoining },
        { key: "Date of ESIC Exit", label: "7. Date of ESIC Exit (YYYY-MM-DD)", required: false, synonyms: HEADER_SYNONYMS.dateOfEsicExit },
        { key: "Insured Person Status", label: "8. Insured Person Status", required: true, defaultValue: "ACTIVE", synonyms: HEADER_SYNONYMS.insuredPersonStatus },
        { key: "Aadhaar Seeding", label: "9. Aadhaar Seeding", required: true, defaultValue: "NOT_SEEDED", synonyms: HEADER_SYNONYMS.aadhaarSeeding },
        { key: "Family/Dependent Details", label: "10. Family/Dependent Details", required: true, defaultValue: "PENDING", synonyms: HEADER_SYNONYMS.familyDependentDetails },
        { key: "Dispensary/Branch", label: "11. Dispensary/Branch", required: false, defaultValue: "ESIC Dispensary Indiranagar, BLR", synonyms: HEADER_SYNONYMS.dispensaryBranch },
        { key: "Contribution State", label: "12. Contribution State", required: true, defaultValue: "Karnataka", synonyms: HEADER_SYNONYMS.contributionState },
        { key: "Insurance Number Verified", label: "13. Insurance Number Verified (Yes/No)", required: true, defaultValue: false, synonyms: HEADER_SYNONYMS.insuranceNumberVerified },
        { key: "Official Source", label: "14. Official Source", required: true, defaultValue: "Manual Upload", synonyms: HEADER_SYNONYMS.officialSource },
        { key: "Verification Method", label: "15. Verification Method", required: true, defaultValue: "API", synonyms: HEADER_SYNONYMS.verificationMethod },
        { key: "Verification Reference", label: "16. Verification Reference", required: false, synonyms: HEADER_SYNONYMS.verificationReference },
        { key: "Last Verified", label: "17. Last Verified (Timestamp)", required: false, synonyms: HEADER_SYNONYMS.lastVerified },
        { key: "Last Synced", label: "18. Last Synced (Timestamp)", required: false, synonyms: HEADER_SYNONYMS.lastSynced }
    ];

    // Allowed Enum Definitions strictly adhering to PRD Sections 1 & 13
    const VALID_ENUMS = {
        insuredPersonStatus: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXEMPTED'],
        aadhaarSeeding: ['VERIFIED', 'PENDING', 'NOT_SEEDED'],
        familyDependentDetails: ['SUBMITTED', 'VERIFIED', 'PENDING', 'NOT_APPLICABLE'],
        verificationMethod: ['API', 'OTP_AADHAAR', 'PORTAL_SCRAPE', 'MANUAL']
    };

    const IP_NUMBER_REGEX = /^\d{10,17}$/;
    const EMPLOYER_CODE_REGEX = /^\d{17}$/;
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
        if (['yes', 'y', 'true', '1', 't', 'active', 'applicable', 'verified'].includes(s)) return true;
        if (['no', 'n', 'false', '0', 'f', 'inactive', 'not applicable', 'na', 'unverified'].includes(s)) return false;
        return defaultVal;
    }

    /**
     * Normalizes dates to strict ISO YYYY-MM-DD string.
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
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString().split('T')[0];
            }
            return trimmed;
        }

        if (typeof val === 'number') {
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
     * Validates strict 10 to 17-digit ESIC IP number syntax.
     */
    function validateIpNumber(ipNumber) {
        if (!ipNumber) return false;
        return IP_NUMBER_REGEX.test(String(ipNumber).trim());
    }

    /**
     * Validates standard 17-digit ESIC Employer Code establishment formatting.
     */
    function validateEmployerCode(code) {
        if (!code) return false;
        return EMPLOYER_CODE_REGEX.test(String(code).trim());
    }

    /**
     * Resolves matching enum or defaults gracefully.
     */
    function normalizeEnum(val, validList, defaultVal) {
        if (!val) return defaultVal;
        const upper = String(val).trim().toUpperCase().replace(/[\s-]+/g, '_');
        if (validList.includes(upper)) return upper;
        const match = validList.find(e => upper.includes(e) || e.includes(upper));
        return match || defaultVal;
    }

    /**
     * Validates a single ESIC statutory master record against PRD business constraints.
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
            // Cross-sheet foreign key validation against active employee catalog
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

        const isEsicApplicable = record['ESIC Applicable'] === true;

        // 3. Conditional ESIC Applicable validations
        if (isEsicApplicable) {
            // IP Number validation
            if (!record['IP Number'] || String(record['IP Number']).trim() === '') {
                errors.push("Discrepancy detected: 'ESIC Applicable' is Yes, but 'IP Number' is missing.");
            } else if (!validateIpNumber(record['IP Number'])) {
                errors.push(`IP Number '${record['IP Number']}' is invalid: must strictly contain 10 to 17 numeric digits (/^\\d{10,17}$/).`);
            }

            // Date of ESIC Joining validation
            if (!record['Date of ESIC Joining'] || String(record['Date of ESIC Joining']).trim() === '') {
                errors.push("Discrepancy detected: 'ESIC Applicable' is Yes, but 'Date of ESIC Joining' is empty.");
            } else if (!ISO_DATE_REGEX.test(record['Date of ESIC Joining'])) {
                errors.push(`'Date of ESIC Joining' (${record['Date of ESIC Joining']}) must be in valid ISO YYYY-MM-DD format.`);
            }
        }

        // 4. Employer Code validation
        if (record['ESIC Employer Code'] && String(record['ESIC Employer Code']).trim() !== '') {
            if (!validateEmployerCode(record['ESIC Employer Code'])) {
                errors.push(`'ESIC Employer Code' (${record['ESIC Employer Code']}) is invalid: must strictly contain 17 numeric digits (/^\\d{17}$/).`);
            }
        }

        // 5. Date sequence integrity
        if (record['Date of ESIC Joining'] && record['Date of ESIC Exit']) {
            if (record['Date of ESIC Exit'] < record['Date of ESIC Joining']) {
                errors.push(`Date sequence violation: 'Date of ESIC Exit' (${record['Date of ESIC Exit']}) cannot precede 'Date of ESIC Joining' (${record['Date of ESIC Joining']}).`);
            }
        }

        // 6. Enum constraints
        if (record['Insured Person Status'] && !VALID_ENUMS.insuredPersonStatus.includes(record['Insured Person Status'])) {
            errors.push(`Invalid 'Insured Person Status' '${record['Insured Person Status']}'. Allowed: ${VALID_ENUMS.insuredPersonStatus.join(', ')}.`);
        }
        if (record['Aadhaar Seeding'] && !VALID_ENUMS.aadhaarSeeding.includes(record['Aadhaar Seeding'])) {
            errors.push(`Invalid 'Aadhaar Seeding' '${record['Aadhaar Seeding']}'. Allowed: ${VALID_ENUMS.aadhaarSeeding.join(', ')}.`);
        }
        if (record['Family/Dependent Details'] && !VALID_ENUMS.familyDependentDetails.includes(record['Family/Dependent Details'])) {
            errors.push(`Invalid 'Family/Dependent Details' '${record['Family/Dependent Details']}'. Allowed: ${VALID_ENUMS.familyDependentDetails.join(', ')}.`);
        }
        if (record['Verification Method'] && !VALID_ENUMS.verificationMethod.includes(record['Verification Method'])) {
            errors.push(`Invalid 'Verification Method' '${record['Verification Method']}'. Allowed: ${VALID_ENUMS.verificationMethod.join(', ')}.`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Converts raw parsed record into canonical Cloud Firestore document schema:
     * Path: organizations/{orgId}/employee_esic_details/{employeeId}
     */
    function toFirestoreDoc(record, options = {}) {
        const orgId = record['Organization ID'] || options.orgId || 'ORG_KYLRX_01';
        const empId = record['Employee ID'];
        const isEsicApplicable = record['ESIC Applicable'] === true || String(record['ESIC Applicable']).trim().toLowerCase() === 'yes';
        const isVerified = record['Insurance Number Verified'] === true || String(record['Insurance Number Verified']).trim().toLowerCase() === 'yes' || String(record['Insurance Number Verified']).trim().toUpperCase() === 'VERIFIED';

        const lastVerifiedTime = record['Last Verified'] || (isVerified ? new Date().toISOString() : null);
        const lastSyncedTime = record['Last Synced'] || new Date().toISOString();

        return {
            employeeId: empId,
            organizationId: orgId,
            isEsicApplicable: isEsicApplicable,
            ipNumber: isEsicApplicable ? (record['IP Number'] || null) : null,
            esicEmployerCode: record['ESIC Employer Code'] || '53000123450000001',
            dateOfEsicJoining: record['Date of ESIC Joining'] || null,
            dateOfEsicExit: record['Date of ESIC Exit'] || null,
            insuredPersonStatus: record['Insured Person Status'] || 'ACTIVE',
            aadhaarSeeding: record['Aadhaar Seeding'] || 'NOT_SEEDED',
            familyDependentDetails: record['Family/Dependent Details'] || 'PENDING',
            dispensaryBranch: record['Dispensary/Branch'] || 'ESIC Dispensary Indiranagar, BLR',
            contributionState: record['Contribution State'] || 'Karnataka',
            isInsuranceNumberVerified: isVerified,
            verification: {
                officialSource: record['Official Source'] || 'Decentro Fabric',
                verificationMethod: record['Verification Method'] || 'API',
                verificationReference: record['Verification Reference'] || (isVerified ? `DEC_ESIC_VERIF_${(record['IP Number'] || '0000').slice(-6)}` : null),
                lastVerified: lastVerifiedTime,
                lastSynced: lastSyncedTime
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Ingests, normalizes, and validates all rows from 'ESIC Details' sheet.
     * Generates structured 18-attribute records, Firestore payloads, and row-level error reports.
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
        const seenIpNumbers = new Set();
        const defaultOrgId = options.orgId || 'ORG_KYLRX_01';

        rows.forEach((row, index) => {
            const rowNumber = index + 1;

            // Skip entirely blank rows
            const values = Object.values(row).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (values.length === 0) return;

            // Extract all 18 attributes using canonical synonyms
            const rawEmpId = getVal(row, HEADER_SYNONYMS.employeeId);
            const rawOrgId = getVal(row, HEADER_SYNONYMS.organizationId) || defaultOrgId;
            const rawEsicApp = getVal(row, HEADER_SYNONYMS.esicApplicable);
            const rawIpNum = getVal(row, HEADER_SYNONYMS.ipNumber);
            const rawEmployerCode = getVal(row, HEADER_SYNONYMS.esicEmployerCode);
            const rawDoj = getVal(row, HEADER_SYNONYMS.dateOfEsicJoining);
            const rawDoe = getVal(row, HEADER_SYNONYMS.dateOfEsicExit);
            const rawIpStatus = getVal(row, HEADER_SYNONYMS.insuredPersonStatus);
            const rawAadhaar = getVal(row, HEADER_SYNONYMS.aadhaarSeeding);
            const rawFamily = getVal(row, HEADER_SYNONYMS.familyDependentDetails);
            const rawDispensary = getVal(row, HEADER_SYNONYMS.dispensaryBranch);
            const rawState = getVal(row, HEADER_SYNONYMS.contributionState);
            const rawVerified = getVal(row, HEADER_SYNONYMS.insuranceNumberVerified);
            const rawSource = getVal(row, HEADER_SYNONYMS.officialSource);
            const rawMethod = getVal(row, HEADER_SYNONYMS.verificationMethod);
            const rawRef = getVal(row, HEADER_SYNONYMS.verificationReference);
            const rawLastVerified = getVal(row, HEADER_SYNONYMS.lastVerified);
            const rawLastSynced = getVal(row, HEADER_SYNONYMS.lastSynced);

            const isEsicApplicable = parseBoolean(rawEsicApp, true);
            const ipNumberNormalized = rawIpNum ? String(rawIpNum).trim().replace(/\D/g, '') : '';
            const employerCodeNormalized = rawEmployerCode ? String(rawEmployerCode).trim().replace(/\D/g, '') : '53000123450000001';
            const esicDojSanitized = sanitizeDate(rawDoj);
            const esicDoeSanitized = sanitizeDate(rawDoe);
            const isVerified = parseBoolean(rawVerified, false);

            const record = {
                'Employee ID': rawEmpId ? String(rawEmpId).trim() : '',
                'Organization ID': rawOrgId ? String(rawOrgId).trim() : defaultOrgId,
                'ESIC Applicable': isEsicApplicable ? 'Yes' : 'No',
                'IP Number': ipNumberNormalized,
                'ESIC Employer Code': employerCodeNormalized,
                'Date of ESIC Joining': esicDojSanitized,
                'Date of ESIC Exit': esicDoeSanitized,
                'Insured Person Status': normalizeEnum(rawIpStatus, VALID_ENUMS.insuredPersonStatus, 'ACTIVE'),
                'Aadhaar Seeding': normalizeEnum(rawAadhaar, VALID_ENUMS.aadhaarSeeding, 'NOT_SEEDED'),
                'Family/Dependent Details': normalizeEnum(rawFamily, VALID_ENUMS.familyDependentDetails, 'PENDING'),
                'Dispensary/Branch': rawDispensary ? String(rawDispensary).trim() : 'ESIC Dispensary Indiranagar, BLR',
                'Contribution State': rawState ? String(rawState).trim() : 'Karnataka',
                'Insurance Number Verified': isVerified ? 'Yes' : 'No',
                'Official Source': rawSource ? String(rawSource).trim() : 'Manual Upload',
                'Verification Method': normalizeEnum(rawMethod, VALID_ENUMS.verificationMethod, 'API'),
                'Verification Reference': rawRef ? String(rawRef).trim() : null,
                'Last Verified': rawLastVerified ? String(rawLastVerified).trim() : (isVerified ? new Date().toISOString() : null),
                'Last Synced': rawLastSynced ? String(rawLastSynced).trim() : new Date().toISOString()
            };

            const validationTarget = {
                ...record,
                'ESIC Applicable': isEsicApplicable,
                'Insurance Number Verified': isVerified
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

            if (isEsicApplicable && record['IP Number']) {
                if (seenIpNumbers.has(record['IP Number'])) {
                    validation.valid = false;
                    validation.errors.push(`Duplicate IP Number '${record['IP Number']}' detected across sheet records at row ${rowNumber}.`);
                } else {
                    seenIpNumbers.add(record['IP Number']);
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
        ESIC_DETAILS_ATTRIBUTES,
        HEADER_SYNONYMS,
        VALID_ENUMS,
        normalizeKey,
        sanitizeDate,
        validateIpNumber,
        validateEmployerCode,
        validateRecord,
        toFirestoreDoc,
        parseSheetRows
    };
}));
