/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - STATUTORY COMPLIANCE PARSER & VALIDATOR ENGINE
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes Statutory Compliance records
 * from the 'Statuatory Compliance' sheet of Templates.xlsx or CSV uploads
 * matching PRD Sections 1, 4, 11, & 13:
 * 
 * Exact 11 Attributes:
 * 1. Compliance_Code (string, unique PK / Firestore doc ID, e.g. COMP_PF, COMP_ESI)
 * 2. Compliance_Name (string, display title, e.g. Employees Provident Fund)
 * 3. Applicable (boolean: true for "Yes", false for "No")
 * 4. Registration_Number (string, employer statutory identifier)
 * 5. State (string: e.g. "All India", "Karnataka", "Maharashtra")
 * 6. Effective_From (string / ISO Date: YYYY-MM-DD)
 * 7. Wage_Ceiling_or_Rule (string | number, wage cutoff threshold e.g. 15000, 21000, or slab formula)
 * 8. Employee_Contribution_Rate (string | number, deduction rate e.g. 12%, 0.75%, or tiered slab)
 * 9. Employer_Contribution_Rate (string | number, employer contribution rate e.g. 12%, 3.25%)
 * 10. Due_Date_Day (number, day of month for statutory challan remittance e.g. 15, 20)
 * 11. Active (boolean: true for "Yes", false for "No")
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
        root.KylrxStatutoryComplianceParser = factory();
        root.statutoryComplianceParser = root.KylrxStatutoryComplianceParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        complianceCode: [
            'compliance_code', 'compliancecode', 'code', 'statutory_code', 'statutorycode',
            'rule_code', 'rulecode', 'policy_code', 'id', 'compliance_id'
        ],
        complianceName: [
            'compliance_name', 'compliancename', 'name', 'statutory_name', 'statutoryname',
            'title', 'compliance_title', 'display_name', 'description'
        ],
        applicable: [
            'applicable', 'is_applicable', 'isapplicable', 'enabled', 'applies', 'mandated'
        ],
        registrationNumber: [
            'registration_number', 'registrationnumber', 'reg_no', 'reg_number', 'registration_no',
            'establishment_code', 'employer_code', 'cin', 'pf_code', 'esic_code', 'pt_reg_no',
            'registration', 'license_no'
        ],
        state: [
            'state', 'jurisdiction', 'region', 'province', 'location_state', 'applicable_state'
        ],
        effectiveFrom: [
            'effective_from', 'effectivefrom', 'effective_date', 'start_date', 'valid_from',
            'from_date', 'inception_date'
        ],
        wageCeiling: [
            'wage_ceiling_or_rule', 'wage_ceiling', 'wageceiling', 'ceiling', 'wage_limit',
            'wage_cutoff', 'threshold', 'ceiling_or_rule', 'rule_or_ceiling', 'cutoff'
        ],
        employeeRate: [
            'employee_contribution_rate', 'employee_rate', 'ee_rate', 'ee_contribution',
            'employee_share', 'ee_share', 'employee_percentage', 'deduction_rate'
        ],
        employerRate: [
            'employer_contribution_rate', 'employer_rate', 'er_rate', 'er_contribution',
            'employer_share', 'er_share', 'employer_percentage', 'company_contribution'
        ],
        dueDateDay: [
            'due_date_day', 'duedateday', 'due_date', 'duedate', 'remittance_day', 'cutoff_day',
            'deposit_day', 'challan_due_day', 'day_of_month'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'in_use'
        ]
    };

    /**
     * Exact 11 Attributes Schema Definition matching PRD Sections 1, 4, 11, & 13
     */
    const STATUTORY_COMPLIANCE_ATTRIBUTES = [
        { key: "Compliance_Code", label: "1. Compliance Code", required: true, synonyms: HEADER_SYNONYMS.complianceCode },
        { key: "Compliance_Name", label: "2. Compliance Name", required: true, synonyms: HEADER_SYNONYMS.complianceName },
        { key: "Applicable", label: "3. Applicable (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.applicable },
        { key: "Registration_Number", label: "4. Registration Number", required: false, synonyms: HEADER_SYNONYMS.registrationNumber },
        { key: "State", label: "5. State / Jurisdiction", required: true, defaultValue: "All India", synonyms: HEADER_SYNONYMS.state },
        { key: "Effective_From", label: "6. Effective From (YYYY-MM-DD)", required: false, synonyms: HEADER_SYNONYMS.effectiveFrom },
        { key: "Wage_Ceiling_or_Rule", label: "7. Wage Ceiling or Rule", required: false, defaultValue: 15000, synonyms: HEADER_SYNONYMS.wageCeiling },
        { key: "Employee_Contribution_Rate", label: "8. Employee Contribution Rate", required: true, defaultValue: 12.0, synonyms: HEADER_SYNONYMS.employeeRate },
        { key: "Employer_Contribution_Rate", label: "9. Employer Contribution Rate", required: true, defaultValue: 12.0, synonyms: HEADER_SYNONYMS.employerRate },
        { key: "Due_Date_Day", label: "10. Due Date Day (1-31)", required: true, defaultValue: 15, synonyms: HEADER_SYNONYMS.dueDateDay },
        { key: "Active", label: "11. Active (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.active }
    ];

    /**
     * SheetJS Target Sheet Names to inspect for statutory policies
     */
    const TARGET_SHEET_NAMES = [
        'Statuatory Compliance',
        'Statutory Compliance',
        'Statutory_Compliance',
        'Statuatory_Compliance',
        'Statutory',
        'Statuatory',
        'Compliance Rules',
        'Statutory_Rules',
        'Statutory Rules'
    ];

    /**
     * Sanitizes boolean input from strings like 'Yes', 'No', 'Y', 'N', 1, 0, or booleans
     */
    function sanitizeBoolean(val, fallback = false) {
        if (val === undefined || val === null || val === '') return fallback;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val !== 0;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', '1', 't', 'active', 'applicable', 'enabled'].includes(s)) return true;
        if (['no', 'n', 'false', '0', 'f', 'inactive', 'not applicable', 'disabled'].includes(s)) return false;
        return fallback;
    }

    /**
     * Sanitizes dates into ISO 'YYYY-MM-DD'
     */
    function sanitizeIsoDate(val) {
        if (val === undefined || val === null || val === '') return null;

        // Native Date object
        if (val instanceof Date) {
            if (isNaN(val.getTime())) return null;
            return val.toISOString().split('T')[0];
        }

        // Excel serial date (days since Dec 30, 1899)
        if (typeof val === 'number') {
            if (val > 20000 && val < 90000) {
                const date = new Date(Math.round((val - 25569) * 86400 * 1000));
                const y = date.getUTCFullYear();
                const m = String(date.getUTCMonth() + 1).padStart(2, '0');
                const d = String(date.getUTCDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }
        }

        const raw = String(val).trim();
        if (!raw) return null;

        // Standard ISO YYYY-MM-DD
        const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (isoMatch) {
            const y = parseInt(isoMatch[1], 10);
            const m = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
            const d = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
            if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12 && parseInt(d, 10) >= 1 && parseInt(d, 10) <= 31) {
                return `${y}-${m}-${d}`;
            }
        }

        // Indian / European DD/MM/YYYY or DD-MM-YYYY
        const dmyMatch = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
        if (dmyMatch) {
            const d = String(parseInt(dmyMatch[1], 10)).padStart(2, '0');
            const m = String(parseInt(dmyMatch[2], 10)).padStart(2, '0');
            const y = parseInt(dmyMatch[3], 10);
            if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12 && parseInt(d, 10) >= 1 && parseInt(d, 10) <= 31) {
                return `${y}-${m}-${d}`;
            }
        }

        // Attempt Date.parse
        const parsed = Date.parse(raw);
        if (!isNaN(parsed)) {
            const d = new Date(parsed);
            return d.toISOString().split('T')[0];
        }

        return null;
    }

    /**
     * Sanitizes numerical rate or formula string
     * e.g. "12%", 12 -> 12.0
     * e.g. "0.75%", 0.75 -> 0.75
     * e.g. "Karnataka Slabs" -> "Karnataka Slabs"
     */
    function parseRateOrFormula(val, defaultRate = 0) {
        if (val === undefined || val === null || val === '') return defaultRate;
        if (typeof val === 'number') return val;

        const str = String(val).trim();
        // Check if percentage format: "12%" or "0.75%"
        const pctMatch = str.match(/^([0-9]+(?:\.[0-9]+)?)\s*%?$/);
        if (pctMatch) {
            return parseFloat(pctMatch[1]);
        }
        return str;
    }

    /**
     * Sanitizes wage ceiling or rule formula
     * e.g. 15000 -> 15000, "21000" -> 21000, or formula description
     */
    function parseWageCeiling(val, fallback = 15000) {
        if (val === undefined || val === null || val === '') return fallback;
        if (typeof val === 'number') return val;

        const str = String(val).trim();
        const numOnly = str.replace(/,/g, '');
        if (/^\d+(\.\d+)?$/.test(numOnly)) {
            return parseFloat(numOnly);
        }
        return str;
    }

    /**
     * Sanitizes Due Date Day (day of month: 1 to 31)
     */
    function parseDueDateDay(val, fallback = 15) {
        if (val === undefined || val === null || val === '') return fallback;
        const num = parseInt(val, 10);
        if (!isNaN(num) && num >= 1 && num <= 31) {
            return num;
        }
        return fallback;
    }

    /**
     * Finds normalized field value in an object using synonym list
     */
    function findField(row, synonyms) {
        if (!row || typeof row !== 'object') return undefined;

        // Direct matching
        for (const syn of synonyms) {
            if (row[syn] !== undefined && row[syn] !== null) return row[syn];
        }

        // Case-insensitive & normalized matching
        const rowKeys = Object.keys(row);
        for (const syn of synonyms) {
            const cleanSyn = syn.toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const rk of rowKeys) {
                const cleanRk = rk.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanRk === cleanSyn) {
                    if (row[rk] !== undefined && row[rk] !== null) return row[rk];
                }
            }
        }
        return undefined;
    }

    /**
     * Normalizes a raw statutory compliance row into the canonical 11 attributes
     */
    function normalizeComplianceRow(rawRow, index = 0) {
        const complianceCodeRaw = findField(rawRow, HEADER_SYNONYMS.complianceCode);
        const complianceCode = complianceCodeRaw 
            ? String(complianceCodeRaw).trim().toUpperCase().replace(/\s+/g, '_')
            : `COMP_${String(index + 1).padStart(3, '0')}`;

        const complianceNameRaw = findField(rawRow, HEADER_SYNONYMS.complianceName);
        const complianceName = complianceNameRaw ? String(complianceNameRaw).trim() : complianceCode;

        const applicableRaw = findField(rawRow, HEADER_SYNONYMS.applicable);
        const applicable = sanitizeBoolean(applicableRaw, true);

        const regNoRaw = findField(rawRow, HEADER_SYNONYMS.registrationNumber);
        const registrationNumber = regNoRaw ? String(regNoRaw).trim() : "";

        const stateRaw = findField(rawRow, HEADER_SYNONYMS.state);
        const state = stateRaw ? String(stateRaw).trim() : "All India";

        const effectiveFromRaw = findField(rawRow, HEADER_SYNONYMS.effectiveFrom);
        const effectiveFrom = sanitizeIsoDate(effectiveFromRaw) || "2026-01-01";

        const wageCeilingRaw = findField(rawRow, HEADER_SYNONYMS.wageCeiling);
        const wageCeiling = parseWageCeiling(wageCeilingRaw, 15000);

        const eeRateRaw = findField(rawRow, HEADER_SYNONYMS.employeeRate);
        const employeeContributionRate = parseRateOrFormula(eeRateRaw, 12.0);

        const erRateRaw = findField(rawRow, HEADER_SYNONYMS.employerRate);
        const employerContributionRate = parseRateOrFormula(erRateRaw, 12.0);

        const dueDateRaw = findField(rawRow, HEADER_SYNONYMS.dueDateDay);
        const dueDateDay = parseDueDateDay(dueDateRaw, 15);

        const activeRaw = findField(rawRow, HEADER_SYNONYMS.active);
        const active = sanitizeBoolean(activeRaw, true);

        return {
            Compliance_Code: complianceCode,
            Compliance_Name: complianceName,
            Applicable: applicable,
            Registration_Number: registrationNumber,
            State: state,
            Effective_From: effectiveFrom,
            Wage_Ceiling_or_Rule: wageCeiling,
            Employee_Contribution_Rate: employeeContributionRate,
            Employer_Contribution_Rate: employerContributionRate,
            Due_Date_Day: dueDateDay,
            Active: active
        };
    }

    /**
     * Converts normalized record to Cloud Firestore Document representation
     * Path: organizations/{orgId}/statutory_rules/{complianceCode}
     */
    function toFirestoreDocument(record, orgId = 'org_default') {
        return {
            complianceCode: record.Compliance_Code,
            complianceName: record.Compliance_Name,
            isApplicable: record.Applicable,
            registrationNumber: record.Registration_Number,
            state: record.State,
            effectiveFrom: record.Effective_From,
            wageCeiling: record.Wage_Ceiling_or_Rule,
            employeeContributionRate: record.Employee_Contribution_Rate,
            employerContributionRate: record.Employer_Contribution_Rate,
            dueDateDay: record.Due_Date_Day,
            isActive: record.Active,
            orgId: orgId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Validates and parses raw rows into statutory compliance records.
     * Enforces:
     * - Required attributes
     * - Primary key deduplication
     * - Consistency: If Applicable is true, Registration_Number and Effective_From must be non-empty
     * - Valid rate bounds and due dates (1-31)
     */
    function parseStatutoryComplianceSheet(rows, options = {}) {
        const errors = [];
        const warnings = [];
        const records = [];
        const firestoreDocs = [];
        const orgId = options.orgId || 'org_default';

        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                valid: false,
                errors: ["Statutory Compliance sheet contains no records or rows to parse."],
                warnings: [],
                records: [],
                firestoreDocs: [],
                stats: { totalRows: 0, validRows: 0, applicableCount: 0 }
            };
        }

        const seenCodes = new Set();
        let rowIndex = 0;

        for (const rawRow of rows) {
            rowIndex++;
            // Check for empty row
            const values = Object.values(rawRow).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (values.length === 0) continue;

            const normalized = normalizeComplianceRow(rawRow, rowIndex - 1);

            // 1. Primary Key validation & deduplication
            if (!normalized.Compliance_Code) {
                errors.push(`Row ${rowIndex}: 'Compliance_Code' is missing.`);
                continue;
            }

            if (seenCodes.has(normalized.Compliance_Code)) {
                errors.push(`Row ${rowIndex}: Duplicate 'Compliance_Code' detected: '${normalized.Compliance_Code}'. Code must be unique.`);
                continue;
            }
            seenCodes.add(normalized.Compliance_Code);

            // 2. Consistency: if Applicable is true, require non-empty Registration_Number and Effective_From
            if (normalized.Applicable === true) {
                if (!normalized.Registration_Number || String(normalized.Registration_Number).trim() === '') {
                    errors.push(`Row ${rowIndex} [${normalized.Compliance_Code}]: When 'Applicable' is Yes, 'Registration_Number' must be specified.`);
                }
                if (!normalized.Effective_From || String(normalized.Effective_From).trim() === '') {
                    errors.push(`Row ${rowIndex} [${normalized.Compliance_Code}]: When 'Applicable' is Yes, 'Effective_From' date must be specified.`);
                }
            }

            // 3. Due Date Day validation (1-31)
            if (normalized.Due_Date_Day < 1 || normalized.Due_Date_Day > 31) {
                errors.push(`Row ${rowIndex} [${normalized.Compliance_Code}]: 'Due_Date_Day' must be between 1 and 31. Found: ${normalized.Due_Date_Day}`);
            }

            // 4. Rate sanity checks
            if (typeof normalized.Employee_Contribution_Rate === 'number') {
                if (normalized.Employee_Contribution_Rate < 0) {
                    errors.push(`Row ${rowIndex} [${normalized.Compliance_Code}]: Employee contribution rate cannot be negative.`);
                }
            }
            if (typeof normalized.Employer_Contribution_Rate === 'number') {
                if (normalized.Employer_Contribution_Rate < 0) {
                    errors.push(`Row ${rowIndex} [${normalized.Compliance_Code}]: Employer contribution rate cannot be negative.`);
                }
            }

            // 5. Wage ceiling sanity check
            if (typeof normalized.Wage_Ceiling_or_Rule === 'number' && normalized.Wage_Ceiling_or_Rule < 0) {
                errors.push(`Row ${rowIndex} [${normalized.Compliance_Code}]: Wage ceiling cannot be negative.`);
            }

            records.push(normalized);
            firestoreDocs.push(toFirestoreDocument(normalized, orgId));
        }

        const applicableCount = records.filter(r => r.Applicable).length;

        return {
            valid: errors.length === 0,
            errors: errors,
            warnings: warnings,
            records: records,
            firestoreDocs: firestoreDocs,
            stats: {
                totalRows: records.length,
                validRows: records.length,
                applicableCount: applicableCount,
                activeCount: records.filter(r => r.Active).length
            }
        };
    }

    /**
     * Extracts and parses the Statutory Compliance sheet from a SheetJS workbook
     */
    function parseWorkbook(workbook, options = {}) {
        if (!workbook || !workbook.SheetNames || !workbook.Sheets) {
            return {
                valid: false,
                errors: ["Invalid SheetJS workbook object provided."],
                records: [],
                firestoreDocs: []
            };
        }

        let sheetName = null;
        for (const name of TARGET_SHEET_NAMES) {
            if (workbook.Sheets[name]) {
                sheetName = name;
                break;
            }
        }

        if (!sheetName) {
            // Case-insensitive fallback
            const lowerNames = workbook.SheetNames.map(n => ({ original: n, lower: n.toLowerCase().trim() }));
            for (const target of TARGET_SHEET_NAMES) {
                const match = lowerNames.find(l => l.lower === target.toLowerCase());
                if (match) {
                    sheetName = match.original;
                    break;
                }
            }
        }

        if (!sheetName) {
            return {
                valid: false,
                errors: [`Workbook does not contain a 'Statuatory Compliance' sheet. Available sheets: ${workbook.SheetNames.join(', ')}`],
                records: [],
                firestoreDocs: []
            };
        }

        const sheet = workbook.Sheets[sheetName];
        let rawRows = [];

        const globalScope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
        if (globalScope && globalScope.XLSX && globalScope.XLSX.utils && globalScope.XLSX.utils.sheet_to_json) {
            rawRows = globalScope.XLSX.utils.sheet_to_json(sheet, { defval: "" });
        } else if (typeof require !== 'undefined') {
            try {
                const xlsx = require('xlsx');
                const utils = xlsx.utils || (xlsx.default && xlsx.default.utils);
                if (utils && utils.sheet_to_json) {
                    rawRows = utils.sheet_to_json(sheet, { defval: "" });
                }
            } catch (e) {
                // fallback
            }
        }

        const result = parseStatutoryComplianceSheet(rawRows, options);
        result.sheetName = sheetName;
        return result;
    }

    // Public API
    return {
        STATUTORY_COMPLIANCE_ATTRIBUTES: STATUTORY_COMPLIANCE_ATTRIBUTES,
        TARGET_SHEET_NAMES: TARGET_SHEET_NAMES,
        HEADER_SYNONYMS: HEADER_SYNONYMS,
        sanitizeBoolean: sanitizeBoolean,
        sanitizeIsoDate: sanitizeIsoDate,
        parseRateOrFormula: parseRateOrFormula,
        parseWageCeiling: parseWageCeiling,
        parseDueDateDay: parseDueDateDay,
        normalizeComplianceRow: normalizeComplianceRow,
        toFirestoreDocument: toFirestoreDocument,
        parseStatutoryComplianceSheet: parseStatutoryComplianceSheet,
        parseWorkbook: parseWorkbook
    };
}));
