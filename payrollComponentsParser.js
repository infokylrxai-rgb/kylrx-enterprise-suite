/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PAYROLL COMPONENTS PARSER & VALIDATOR ENGINE
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes Payroll Component definitions
 * from the 'Payroll Components' sheet of Templates.xlsx or CSV uploads matching
 * PRD Sections 1 & 4.
 * 
 * Exact 13 Attributes Schema:
 * 1. Component_Code (string, unique primary key / Firestore document ID)
 * 2. Component_Name (string, display title)
 * 3. Component_Type (enum: "Earning", "Deduction", "Reimbursement", "Employer_Contribution")
 * 4. Calculation_Method (enum: "Flat_Amount", "Percentage", "Formula", "Slab")
 * 5. Value_or_Percentage (number | null, default value or percentage multiplier)
 * 6. Percentage_Basis (string | null: reference component code such as "BASIC", "GROSS", "CTC")
 * 7. Taxable (boolean: true for "Yes", false for "No")
 * 8. PF_Applicable (boolean: true for "Yes", false for "No")
 * 9. ESI_Applicable (boolean: true for "Yes", false for "No")
 * 10. PT_Applicable (boolean: true for "Yes", false for "No")
 * 11. TDS_Applicable (boolean: true for "Yes", false for "No")
 * 12. Prorate_On_LOP (boolean: true for "Yes", false for "No")
 * 13. Active (boolean: true for "Yes", false for "No")
 * 
 * Target Firestore Path:
 * organizations/{orgId}/payroll_components/{componentCode}
 * 
 * @version 1.0.0
 * @author Principal Fintech & Payroll Systems Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxPayrollComponentsParser = factory();
        root.payrollComponentsParser = root.KylrxPayrollComponentsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        componentCode: [
            'component_code', 'componentcode', 'code', 'comp_code', 'component_id',
            'comp_id', 'salary_component_code', 'salary_component', 'identifier'
        ],
        componentName: [
            'component_name', 'componentname', 'name', 'title', 'display_name',
            'salary_component_name', 'component_title', 'description'
        ],
        componentType: [
            'component_type', 'componenttype', 'type', 'category', 'comp_type',
            'classification', 'earning_or_deduction'
        ],
        calculationMethod: [
            'calculation_method', 'calculationmethod', 'calc_method', 'method',
            'computation_method', 'formula_type', 'calc_type'
        ],
        valueOrPercentage: [
            'value_or_percentage', 'valueorpercentage', 'value', 'percentage', 'pct',
            'rate', 'default_value', 'val_or_pct', 'amount_or_pct', 'multiplier'
        ],
        percentageBasis: [
            'percentage_basis', 'percentagebasis', 'basis', 'calculation_basis',
            'calc_basis', 'base_component', 'percentage_of', 'percent_basis'
        ],
        taxable: [
            'taxable', 'is_taxable', 'istaxable', 'tax_exempt', 'subject_to_tax'
        ],
        pfApplicable: [
            'pf_applicable', 'pfapplicable', 'is_pf_applicable', 'pf_eligible',
            'provident_fund_applicable', 'pf'
        ],
        esiApplicable: [
            'esi_applicable', 'esiapplicable', 'is_esi_applicable', 'esic_applicable',
            'esi_eligible', 'esi', 'esic'
        ],
        ptApplicable: [
            'pt_applicable', 'ptapplicable', 'is_pt_applicable', 'professional_tax_applicable',
            'pt_eligible', 'pt'
        ],
        tdsApplicable: [
            'tds_applicable', 'tdsapplicable', 'is_tds_applicable', 'tds_eligible',
            'tax_deducted_at_source', 'tds'
        ],
        prorateOnLop: [
            'prorate_on_lop', 'prorateonlop', 'is_prorate_on_lop', 'prorate',
            'lop_proration', 'prorate_lop', 'lop_prorated', 'loss_of_pay_proration'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'in_use'
        ]
    };

    // Allowed Enums
    const ALLOWED_COMPONENT_TYPES = [
        "Earning",
        "Deduction",
        "Reimbursement",
        "Employer_Contribution"
    ];

    const ALLOWED_CALCULATION_METHODS = [
        "Flat_Amount",
        "Percentage",
        "Formula",
        "Slab"
    ];

    const ALLOWED_PERCENTAGE_BASES = [
        "BASIC",
        "GROSS",
        "CTC",
        "SUBTOTAL",
        "TAXABLE"
    ];

    /**
     * Normalize key string for synonym matching
     */
    function normalizeHeaderKey(key) {
        if (!key) return '';
        return String(key)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    /**
     * Map a raw row object using synonyms to canonical attributes
     */
    function mapRowToCanonical(rawRow) {
        const canonical = {};
        const keys = Object.keys(rawRow);

        for (const [canonicalField, synonyms] of Object.entries(HEADER_SYNONYMS)) {
            for (const key of keys) {
                const normKey = normalizeHeaderKey(key);
                if (synonyms.includes(normKey)) {
                    canonical[canonicalField] = rawRow[key];
                    break;
                }
            }
        }
        return canonical;
    }

    /**
     * Parse boolean string / value
     */
    function parseBoolean(val, defaultVal = false) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'true', '1', 'y', 'active', 'enabled', 'applicable'].includes(s)) return true;
        if (['no', 'false', '0', 'n', 'inactive', 'disabled', 'not_applicable'].includes(s)) return false;
        return defaultVal;
    }

    /**
     * Sanitize Component_Type enum
     */
    function sanitizeComponentType(val) {
        if (!val || String(val).trim() === '') return { value: 'Earning', isValid: true, raw: '' };
        const raw = String(val).trim();
        const str = raw.replace(/[\s-]+/g, '_');
        const found = ALLOWED_COMPONENT_TYPES.find(t => t.toLowerCase() === str.toLowerCase());
        if (found) return { value: found, isValid: true, raw };

        const low = str.toLowerCase();
        if (low === 'earning' || low === 'earnings') return { value: 'Earning', isValid: true, raw };
        if (low === 'deduction' || low === 'deductions') return { value: 'Deduction', isValid: true, raw };
        if (low === 'reimbursement' || low === 'reimbursements') return { value: 'Reimbursement', isValid: true, raw };
        if (low === 'employer_contribution' || low === 'employer_contributions' || low === 'employer contribution') return { value: 'Employer_Contribution', isValid: true, raw };

        return { value: raw, isValid: false, raw };
    }

    /**
     * Sanitize Calculation_Method enum
     */
    function sanitizeCalculationMethod(val) {
        if (!val || String(val).trim() === '') return { value: 'Flat_Amount', isValid: true, raw: '' };
        const raw = String(val).trim();
        const str = raw.replace(/[\s-]+/g, '_');
        const found = ALLOWED_CALCULATION_METHODS.find(m => m.toLowerCase() === str.toLowerCase());
        if (found) return { value: found, isValid: true, raw };

        const low = str.toLowerCase();
        if (low === 'flat_amount' || low === 'flat' || low === 'fixed' || low === 'amount') return { value: 'Flat_Amount', isValid: true, raw };
        if (low === 'percentage' || low === 'percent' || low === 'pct' || low === '%') return { value: 'Percentage', isValid: true, raw };
        if (low === 'formula') return { value: 'Formula', isValid: true, raw };
        if (low === 'slab') return { value: 'Slab', isValid: true, raw };

        return { value: raw, isValid: false, raw };
    }

    /**
     * Sanitize Percentage_Basis
     */
    function sanitizePercentageBasis(val) {
        if (!val) return null;
        const str = String(val).trim().toUpperCase().replace(/[\s-]+/g, '_');
        if (str === '' || str === 'NONE' || str === 'NULL' || str === '-') return null;
        return str;
    }

    /**
     * Validate an individual row record
     */
    function validateComponentRecord(record, index, existingCodes = new Set()) {
        const errors = [];
        const warnings = [];

        // 1. Component_Code: Mandatory & Unique
        if (!record.componentCode || String(record.componentCode).trim() === '') {
            errors.push(`Row ${index + 1}: Missing mandatory Component_Code.`);
        } else {
            const code = record.componentCode;
            if (existingCodes.has(code)) {
                errors.push(`Row ${index + 1}: Duplicate Component_Code "${code}". Primary key must be unique.`);
            }
        }

        // 2. Component_Name: Mandatory
        if (!record.componentName || String(record.componentName).trim() === '') {
            warnings.push(`Row ${index + 1}: Component_Name is empty. Defaulted to "${record.componentCode}".`);
        }

        // 3. Component_Type validation
        if (record.isComponentTypeInvalid) {
            errors.push(`Row ${index + 1} (${record.componentCode}): Invalid Component_Type "${record.rawComponentType}". Allowed types: ${ALLOWED_COMPONENT_TYPES.join(', ')}.`);
        }

        // 4. Calculation_Method validation
        if (record.isCalculationMethodInvalid) {
            errors.push(`Row ${index + 1} (${record.componentCode}): Invalid Calculation_Method "${record.rawCalculationMethod}". Allowed methods: ${ALLOWED_CALCULATION_METHODS.join(', ')}.`);
        }

        // 5. Calculation_Method == "Percentage" relationship check:
        if (record.calculationMethod === 'Percentage') {
            if (!record.percentageBasis) {
                errors.push(`Row ${index + 1} (${record.componentCode}): Percentage_Basis is mandatory for Percentage calculation method (e.g. BASIC, GROSS, CTC).`);
            }
            if (record.defaultValueOrPercentage === null || isNaN(record.defaultValueOrPercentage)) {
                warnings.push(`Row ${index + 1} (${record.componentCode}): Value_or_Percentage is empty for Percentage method. Defaulted to 0.`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Main Sheet Parser Function
     */
    function parsePayrollComponentsSheet(rawRows, options = {}) {
        if (!Array.isArray(rawRows) || rawRows.length === 0) {
            return {
                success: false,
                totalRows: 0,
                validRowsCount: 0,
                invalidRowsCount: 0,
                records: [],
                firestoreDocs: [],
                errors: ['No data rows found in Payroll Components sheet.'],
                warnings: [],
                metadata: {
                    totalComponents: 0,
                    earningsCount: 0,
                    deductionsCount: 0,
                    activeCount: 0
                }
            };
        }

        const records = [];
        const firestoreDocs = [];
        const globalErrors = [];
        const globalWarnings = [];
        const seenCodes = new Set();

        rawRows.forEach((row, idx) => {
            const canonical = mapRowToCanonical(row);

            // Skip completely empty rows
            const hasData = Object.values(canonical).some(v => v !== undefined && v !== null && String(v).trim() !== '');
            if (!hasData) return;

            const componentCode = String(canonical.componentCode || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
            const componentName = String(canonical.componentName || componentCode || 'Unnamed Component').trim();
            const typeInfo = sanitizeComponentType(canonical.componentType);
            const methodInfo = sanitizeCalculationMethod(canonical.calculationMethod);
            const componentType = typeInfo.value;
            const calculationMethod = methodInfo.value;

            let valueOrPercentage = null;
            if (canonical.valueOrPercentage !== undefined && canonical.valueOrPercentage !== null && canonical.valueOrPercentage !== '') {
                const num = parseFloat(String(canonical.valueOrPercentage).replace(/[^0-9.-]/g, ''));
                if (!isNaN(num)) valueOrPercentage = num;
            }

            const percentageBasis = sanitizePercentageBasis(canonical.percentageBasis);
            const isTaxable = parseBoolean(canonical.taxable, componentType === 'Earning');
            const isPfApplicable = parseBoolean(canonical.pfApplicable, false);
            const isEsiApplicable = parseBoolean(canonical.esiApplicable, false);
            const isPtApplicable = parseBoolean(canonical.ptApplicable, false);
            const isTdsApplicable = parseBoolean(canonical.tdsApplicable, false);
            const prorateOnLop = parseBoolean(canonical.prorateOnLop, componentType === 'Earning');
            const isActive = parseBoolean(canonical.active, true);

            const record = {
                id: componentCode,
                componentCode,
                componentName,
                componentType,
                rawComponentType: typeInfo.raw,
                isComponentTypeInvalid: !typeInfo.isValid,
                calculationMethod,
                rawCalculationMethod: methodInfo.raw,
                isCalculationMethodInvalid: !methodInfo.isValid,
                defaultValueOrPercentage: valueOrPercentage,
                percentageBasis,
                isTaxable,
                isPfApplicable,
                isEsiApplicable,
                isPtApplicable,
                isTdsApplicable,
                prorateOnLop,
                isActive,
                rawRowIndex: idx + 1
            };

            const valRes = validateComponentRecord(record, idx, seenCodes);
            if (!valRes.isValid) {
                globalErrors.push(...valRes.errors);
            }
            if (valRes.warnings.length > 0) {
                globalWarnings.push(...valRes.warnings);
            }

            seenCodes.add(componentCode);

            // Tabular UI Preview Record
            records.push({
                Component_Code: componentCode,
                Component_Name: componentName,
                Component_Type: componentType,
                Calculation_Method: calculationMethod,
                Value_or_Percentage: valueOrPercentage,
                Percentage_Basis: percentageBasis || '',
                Taxable: isTaxable ? 'Yes' : 'No',
                PF_Applicable: isPfApplicable ? 'Yes' : 'No',
                ESI_Applicable: isEsiApplicable ? 'Yes' : 'No',
                PT_Applicable: isPtApplicable ? 'Yes' : 'No',
                TDS_Applicable: isTdsApplicable ? 'Yes' : 'No',
                Prorate_On_LOP: prorateOnLop ? 'Yes' : 'No',
                Active: isActive ? 'Yes' : 'No'
            });

            // Cloud Firestore Document Schema matching prompt Section 5
            firestoreDocs.push({
                componentCode,
                componentName,
                componentType,
                calculationMethod,
                defaultValueOrPercentage: valueOrPercentage,
                percentageBasis,
                isTaxable,
                isPfApplicable,
                isEsiApplicable,
                isPtApplicable,
                isTdsApplicable,
                prorateOnLop,
                isActive,
                createdAt: 'serverTimestamp()',
                updatedAt: 'serverTimestamp()'
            });
        });

        const earningsCount = firestoreDocs.filter(d => d.componentType === 'Earning').length;
        const deductionsCount = firestoreDocs.filter(d => d.componentType === 'Deduction').length;
        const activeCount = firestoreDocs.filter(d => d.isActive).length;

        return {
            success: globalErrors.length === 0,
            totalRows: records.length,
            validRowsCount: records.length - globalErrors.length,
            invalidRowsCount: globalErrors.length,
            records,
            firestoreDocs,
            errors: globalErrors,
            warnings: globalWarnings,
            metadata: {
                totalComponents: records.length,
                earningsCount,
                deductionsCount,
                activeCount
            }
        };
    }

    /**
     * Helper to detect and extract Payroll Components sheet from a SheetJS workbook
     */
    function findPayrollComponentsSheet(workbook) {
        if (!workbook || !workbook.SheetNames) return null;
        const regexes = [
            /^(Payroll[_\s]*Components)/i,
            /^(Payroll[_\s]*Component)/i,
            /^(Salary[_\s]*Components)/i,
            /^(Compensation[_\s]*Components)/i,
            /^(Components)/i
        ];

        for (const r of regexes) {
            const match = workbook.SheetNames.find(name => r.test(name));
            if (match) return match;
        }
        return null;
    }

    return {
        parsePayrollComponentsSheet,
        parsePayrollComponents: parsePayrollComponentsSheet,
        findPayrollComponentsSheet,
        validateComponentRecord,
        mapRowToCanonical,
        parseBoolean,
        sanitizeComponentType,
        sanitizeCalculationMethod,
        sanitizePercentageBasis,
        ALLOWED_COMPONENT_TYPES,
        ALLOWED_CALCULATION_METHODS,
        ALLOWED_PERCENTAGE_BASES,
        HEADER_SYNONYMS
    };
}));
