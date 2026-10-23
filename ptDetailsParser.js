/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PROFESSIONAL TAX (PT) STATUTORY MASTER PARSER
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes employee Professional Tax profiles
 * matching all 10 columns from the 'PT Details' sheet of Templates.xlsx
 * and PRD Sections 1, 4, 11, & 13:
 * 
 * Exact 10 Attributes:
 * 1.  Employee ID (string, foreign key referencing active employee in Firestore)
 * 2.  Organization ID (string, tenant/org identifier matching active organization context)
 * 3.  PT Applicable (boolean: true for "Yes", false for "No")
 * 4.  State (string: state jurisdiction e.g., "Karnataka", "Maharashtra", "Telangana", etc.)
 * 5.  PT Registration No (string, PTRC/PTEC registration number of the employer)
 * 6.  PT Slab (string, slab code or tier identifier e.g., "KA_DEFAULT", "MH_MALE_TIER_2")
 * 7.  Monthly Deduction (number, monthly tax deduction amount; 0.00 if exempt or below minimum slab)
 * 8.  Effective From (string / ISO Date: YYYY-MM-DD)
 * 9.  Effective To (string | null / ISO Date: YYYY-MM-DD)
 * 10. Active (boolean: true for "Yes", false for "No")
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
        root.KylrxPtDetailsParser = factory();
        root.ptDetailsParser = root.KylrxPtDetailsParser;
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
        ptApplicable: [
            'pt applicable', 'pt_applicable', 'ptapplicable', 'is_pt_applicable',
            'is pt applicable', 'pt_eligible', 'pt flag', 'professional tax applicable',
            'pt applicable (yes/no)', 'is_professional_tax_applicable'
        ],
        state: [
            'state', 'pt_state', 'jurisdiction', 'tax_state', 'state_jurisdiction',
            'applicable_state', 'pt jurisdiction', 'work_state', 'pt state'
        ],
        ptRegistrationNo: [
            'pt registration no', 'pt_registration_no', 'ptregistrationno', 'ptrc',
            'ptrc_number', 'ptrc_no', 'pt_reg_no', 'pt registration number', 'ptec',
            'ptrc no', 'pt_registration_number', 'ptrc number'
        ],
        ptSlab: [
            'pt slab', 'pt_slab', 'ptslab', 'slab', 'slab_code', 'tier',
            'pt_tier', 'slab code', 'tax_slab', 'pt_slab_code'
        ],
        monthlyDeduction: [
            'monthly deduction', 'monthly_deduction', 'monthlydeduction', 'deduction',
            'pt_amount', 'pt_deduction', 'monthly_pt', 'tax_amount', 'amount',
            'monthly deduction (inr)', 'pt deduction'
        ],
        effectiveFrom: [
            'effective from', 'effective_from', 'effectivefrom', 'start_date',
            'pt_effective_from', 'from_date', 'valid_from', 'effective_date'
        ],
        effectiveTo: [
            'effective to', 'effective_to', 'effectiveto', 'end_date',
            'pt_effective_to', 'to_date', 'valid_to', 'expiry_date'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'active (yes/no)'
        ]
    };

    /**
     * Exact 10 Attributes Schema Definition matching PRD Sections 1, 4, 11, & 13
     */
    const PT_DETAILS_ATTRIBUTES = [
        { key: "Employee ID", label: "1. Employee ID", required: true, synonyms: HEADER_SYNONYMS.employeeId },
        { key: "Organization ID", label: "2. Organization ID", required: true, defaultValue: "ORG_KYLRX_01", synonyms: HEADER_SYNONYMS.organizationId },
        { key: "PT Applicable", label: "3. PT Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.ptApplicable },
        { key: "State", label: "4. State Jurisdiction", required: true, defaultValue: "Karnataka", synonyms: HEADER_SYNONYMS.state },
        { key: "PT Registration No", label: "5. PT Registration No (PTRC)", required: false, defaultValue: "PTRC1234567K", synonyms: HEADER_SYNONYMS.ptRegistrationNo },
        { key: "PT Slab", label: "6. PT Slab / Tier", required: false, defaultValue: "KA_DEFAULT", synonyms: HEADER_SYNONYMS.ptSlab },
        { key: "Monthly Deduction", label: "7. Monthly Deduction (INR)", required: true, defaultValue: 200.00, synonyms: HEADER_SYNONYMS.monthlyDeduction },
        { key: "Effective From", label: "8. Effective From (YYYY-MM-DD)", required: true, defaultValue: "2026-01-01", synonyms: HEADER_SYNONYMS.effectiveFrom },
        { key: "Effective To", label: "9. Effective To (YYYY-MM-DD)", required: false, defaultValue: null, synonyms: HEADER_SYNONYMS.effectiveTo },
        { key: "Active", label: "10. Active (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.active }
    ];

    /**
     * Supported State Jurisdictions per Indian statutory rules
     */
    const SUPPORTED_STATES = [
        "Karnataka", "Maharashtra", "Telangana", "Andhra Pradesh",
        "Tamil Nadu", "West Bengal", "Gujarat", "Kerala", "Madhya Pradesh", "Odisha"
    ];

    /**
     * Normalizes an object key to lowercase alphanumeric string for robust matching.
     */
    function normalizeKey(str) {
        if (!str && str !== 0) return '';
        return String(str).toLowerCase().trim().replace(/[\s_\-/#()]+/g, '');
    }

    /**
     * Finds and retrieves value from row by canonical header synonyms.
     */
    function getVal(row, synonymList) {
        if (!row || typeof row !== 'object') return undefined;
        const normalizedSynonyms = synonymList.map(s => normalizeKey(s));
        
        for (const [k, v] of Object.entries(row)) {
            if (normalizedSynonyms.includes(normalizeKey(k))) {
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
        return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'active';
    }

    /**
     * Normalizes date inputs to strict ISO YYYY-MM-DD string.
     */
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
     * Validates a single record against PT Statutory rules and PRD Section 1 constraints.
     */
    function validateRecord(record, optionsOrRowNumber = {}, maybeOptions = {}) {
        const options = (typeof optionsOrRowNumber === 'object' && optionsOrRowNumber !== null) 
            ? optionsOrRowNumber 
            : ((typeof maybeOptions === 'object' && maybeOptions !== null) ? maybeOptions : {});

        const errors = [];
        const warnings = [];

        const empId = record['Employee ID'] !== undefined ? record['Employee ID'] : record.employeeId;
        const orgId = record['Organization ID'] !== undefined ? record['Organization ID'] : record.organizationId;
        const isPtApplicable = record['PT Applicable'] === true || String(record['PT Applicable']).toLowerCase() === 'yes' || record.isPtApplicable === true;
        const state = record['State'] !== undefined ? record['State'] : record.state;
        const ptrcNo = record['PT Registration No'] !== undefined ? record['PT Registration No'] : record.ptRegistrationNo;
        const monthlyDeduction = record['Monthly Deduction'] !== undefined ? record['Monthly Deduction'] : record.monthlyDeduction;
        const effectiveFrom = record['Effective From'] !== undefined ? record['Effective From'] : record.effectiveFrom;
        const effectiveTo = record['Effective To'] !== undefined ? record['Effective To'] : record.effectiveTo;

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

        // 4. Discrepancy Flagging when PT is Applicable
        if (isPtApplicable) {
            if (!state || String(state).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory State jurisdiction when 'PT Applicable' is Yes.");
            }

            if (!ptrcNo || String(ptrcNo).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory 'PT Registration No' (PTRC registration number) when 'PT Applicable' is Yes.");
            }

            if (!effectiveFrom || String(effectiveFrom).trim() === '') {
                errors.push("Discrepancy detected: Missing mandatory 'Effective From' date when 'PT Applicable' is Yes.");
            }
        }

        // 5. Numeric Monthly Deduction validation
        if (monthlyDeduction !== undefined && monthlyDeduction !== null && monthlyDeduction !== '') {
            const num = Number(monthlyDeduction);
            if (isNaN(num) || num < 0) {
                errors.push(`Invalid 'Monthly Deduction' value '${monthlyDeduction}'. Monthly Deduction cannot be negative (must be a non-negative number).`);
            }
        }

        // 6. Date Sequence Integrity (Effective To >= Effective From)
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
     * Path: organizations/{orgId}/employee_pt_details/{employeeId}
     */
    function toFirestoreDoc(record, options = {}) {
        const orgId = record['Organization ID'] || options.orgId || 'ORG_KYLRX_01';
        const empId = record['Employee ID'];
        const isPtApplicable = record['PT Applicable'] === true || String(record['PT Applicable']).trim().toLowerCase() === 'yes';
        const isActive = record['Active'] === true || String(record['Active']).trim().toLowerCase() === 'yes';

        let deductionNum = 0;
        if (record['Monthly Deduction'] !== undefined && record['Monthly Deduction'] !== null) {
            const parsedNum = parseFloat(record['Monthly Deduction']);
            deductionNum = !isNaN(parsedNum) ? Math.max(0, Math.round(parsedNum * 100) / 100) : 0;
        }

        const stateName = normalizeState(record['State']);
        const slabCode = record['PT Slab'] || `${stateName.slice(0, 2).toUpperCase()}_DEFAULT`;

        return {
            employeeId: empId,
            organizationId: orgId,
            isPtApplicable: isPtApplicable,
            state: stateName,
            ptRegistrationNo: record['PT Registration No'] || (isPtApplicable ? `PTRC_${stateName.slice(0, 2).toUpperCase()}_01` : null),
            ptSlab: slabCode,
            monthlyDeduction: deductionNum,
            effectiveFrom: record['Effective From'] || '2026-01-01',
            effectiveTo: record['Effective To'] || null,
            isActive: isActive,
            overrides: {
                isManualOverride: options.isManualOverride || Boolean(record.isManualOverride),
                exemptReason: record.exemptReason || null
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Parses a single row into structured 10-attribute PT record
     */
    function parseRecord(row, rowNumber = 1, options = {}) {
        const defaultOrgId = options.orgId || 'ORG_KYLRX_01';
        const rawEmpId = getVal(row, HEADER_SYNONYMS.employeeId);
        const rawOrgId = getVal(row, HEADER_SYNONYMS.organizationId) || defaultOrgId;
        const rawPtApp = getVal(row, HEADER_SYNONYMS.ptApplicable);
        const rawState = getVal(row, HEADER_SYNONYMS.state);
        const rawPtrc = getVal(row, HEADER_SYNONYMS.ptRegistrationNo);
        const rawSlab = getVal(row, HEADER_SYNONYMS.ptSlab);
        const rawDeduction = getVal(row, HEADER_SYNONYMS.monthlyDeduction);
        const rawEffectiveFrom = getVal(row, HEADER_SYNONYMS.effectiveFrom);
        const rawEffectiveTo = getVal(row, HEADER_SYNONYMS.effectiveTo);
        const rawActive = getVal(row, HEADER_SYNONYMS.active);

        const isPtApplicable = parseBoolean(rawPtApp, true);
        const isActive = parseBoolean(rawActive, true);
        const sanitizedFrom = sanitizeDate(rawEffectiveFrom);
        const sanitizedTo = sanitizeDate(rawEffectiveTo);

        let monthlyDeductionVal = 0;
        if (rawDeduction !== undefined && rawDeduction !== null && rawDeduction !== '') {
            const parsedVal = parseFloat(rawDeduction);
            monthlyDeductionVal = !isNaN(parsedVal) ? Math.round(parsedVal * 100) / 100 : 0;
        }

        const stateNormalized = rawState ? normalizeState(rawState) : '';

        const record = {
            'Employee ID': rawEmpId ? String(rawEmpId).trim() : '',
            'Organization ID': rawOrgId ? String(rawOrgId).trim() : defaultOrgId,
            'PT Applicable': isPtApplicable ? 'Yes' : 'No',
            'State': stateNormalized,
            'PT Registration No': rawPtrc ? String(rawPtrc).trim() : '',
            'PT Slab': rawSlab ? String(rawSlab).trim() : (stateNormalized ? `${stateNormalized.slice(0, 2).toUpperCase()}_DEFAULT` : ''),
            'Monthly Deduction': monthlyDeductionVal,
            'Effective From': sanitizedFrom,
            'Effective To': sanitizedTo,
            'Active': isActive ? 'Yes' : 'No',
            // CamelCase aliases
            employeeId: rawEmpId ? String(rawEmpId).trim() : '',
            organizationId: rawOrgId ? String(rawOrgId).trim() : defaultOrgId,
            isPtApplicable,
            state: stateNormalized,
            ptRegistrationNo: rawPtrc ? String(rawPtrc).trim() : '',
            ptSlab: rawSlab ? String(rawSlab).trim() : (stateNormalized ? `${stateNormalized.slice(0, 2).toUpperCase()}_DEFAULT` : ''),
            monthlyDeduction: monthlyDeductionVal,
            effectiveFrom: sanitizedFrom,
            effectiveTo: sanitizedTo,
            isActive
        };

        return record;
    }

    /**
     * Ingests, normalizes, and validates all rows from 'PT Details' sheet.
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
                'PT Applicable': record.isPtApplicable,
                'Active': record.isActive
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
        PT_DETAILS_ATTRIBUTES,
        HEADER_SYNONYMS,
        SUPPORTED_STATES,
        normalizeKey,
        sanitizeDate,
        normalizeDate: sanitizeDate,
        parseBoolean,
        normalizeBoolean: parseBoolean,
        normalizeState,
        parseRecord,
        validateRecord,
        toFirestoreDoc,
        parseSheetRows
    };
}));
