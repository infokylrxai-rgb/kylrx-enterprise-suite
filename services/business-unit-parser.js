/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - BUSINESS UNIT SCHEMA & SHEETJS PARSER
 * ============================================================================
 * 
 * Implements Business Unit schema parsing and validation matching the official
 * 'Business Unit' sheet from Templates.xlsx and PRD Sections 1 & 10:
 * 
 * 1. Exact Schema & Field Mapping (Strict 4 Attributes):
 *    - Business_Unit_Code (string, unique PK / document ID)
 *    - Business_Unit_Name (string, display title)
 *    - Head_Employee_ID (string, reference to employee ID of BU head)
 *    - Active (boolean: true for "Yes", false for "No")
 * 
 * 2. Data Architecture (Cloud Firestore):
 *    - Path: organizations/{orgId}/business_units/{businessUnitCode}
 *    - Document Schema:
 *      {
 *        "businessUnitCode": "BU_CORP_01",
 *        "businessUnitName": "Corporate Operations",
 *        "headEmployeeId": "EMP0003",
 *        "headEmployeeName": "Ananya Roy",
 *        "isActive": true,
 *        "allowedEmployeeTypes": ["FULL_TIME", "CONTRACT"],
 *        "createdAt": "serverTimestamp()",
 *        "updatedAt": "serverTimestamp()"
 *      }
 * 
 * @version 2.0.0
 * @author Senior Frontend & Firebase Developer
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxBuParser = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Strict 4 Attributes Definition matching PRD & 'Business Unit' Sheet
    const BUSINESS_UNIT_ATTRIBUTES = [
        {
            key: "Business_Unit_Code",
            targetKey: "businessUnitCode",
            label: "Business Unit Code",
            type: "string",
            required: true,
            isPrimaryKey: true,
            description: "Unique alphanumeric business unit code (e.g. BU-TECH, BU_CORP_01)",
            synonyms: ["business_unit_code", "businessunitcode", "bucode", "bu_code", "code", "bu code", "unit_code"]
        },
        {
            key: "Business_Unit_Name",
            targetKey: "businessUnitName",
            label: "Business Unit Name",
            type: "string",
            required: true,
            isPrimaryKey: false,
            description: "Full descriptive business unit title",
            synonyms: ["business_unit_name", "businessunitname", "buname", "bu_name", "name", "bu name", "unit_name", "title"]
        },
        {
            key: "Head_Employee_ID",
            targetKey: "headEmployeeId",
            label: "Head Employee ID",
            type: "string",
            required: false,
            isPrimaryKey: false,
            description: "Employee ID of designated BU head (e.g. EMP0001)",
            synonyms: ["head_employee_id", "heademployeeid", "head_id", "headid", "head employee id", "bu_head", "buhead", "owner_employee_id", "leader_id"]
        },
        {
            key: "Active",
            targetKey: "isActive",
            label: "Active Status",
            type: "boolean",
            required: false,
            defaultValue: true,
            description: "Operational status: 'Yes' / true for active, 'No' / false for inactive",
            synonyms: ["active", "is_active", "isactive", "status", "enabled", "state"]
        }
    ];

    // Canonical Employee Types per PRD Section 10
    const CANONICAL_EMPLOYEE_TYPES = [
        'FULL_TIME',
        'CONTRACT',
        'CONTRACTOR',
        'INTERN',
        'CONSULTANT',
        'EXECUTIVE'
    ];

    // Standard fallback BU permitted employee types mapping
    const DEFAULT_TYPE_MAPPINGS = {
        'BU_ENG': ['FULL_TIME', 'CONTRACT', 'CONTRACTOR', 'INTERN'],
        'BU-TECH': ['FULL_TIME', 'CONTRACT', 'CONTRACTOR', 'INTERN'],
        'BU-OPS': ['FULL_TIME', 'CONTRACT', 'CONTRACTOR'],
        'BU-CORP': ['FULL_TIME', 'CONTRACT', 'CONSULTANT'],
        'BU-EXEC': ['EXECUTIVE', 'FULL_TIME'],
        'BU-SALES': ['FULL_TIME', 'CONTRACT', 'CONTRACTOR', 'CONSULTANT'],
        'BU_CORP_01': ['FULL_TIME', 'CONTRACT']
    };

    /**
     * Normalizes active boolean value from various spreadsheet representations.
     * "Yes" -> true, "No" -> false
     */
    function parseActiveBoolean(val) {
        if (val === undefined || val === null || val === '') return true;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val === 1;

        const str = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', '1', 'active', 'enabled'].includes(str)) {
            return true;
        }
        if (['no', 'n', 'false', '0', 'inactive', 'disabled', 'deactivated'].includes(str)) {
            return false;
        }
        return true;
    }

    /**
     * Helper to find a value in a row object using synonyms
     */
    function extractFieldValue(row, synonyms) {
        if (!row || typeof row !== 'object') return null;
        const keys = Object.keys(row);

        for (const syn of synonyms) {
            const cleanSyn = syn.toLowerCase().replace(/[\s_-]+/g, '');
            const foundKey = keys.find(k => k.trim().toLowerCase().replace(/[\s_-]+/g, '') === cleanSyn);
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
     * Resolves head employee name given a head ID and employee lookup map/array
     */
    function resolveHeadName(headId, employeeLookup) {
        if (!headId) return "";
        const cleanId = String(headId).trim().toUpperCase();

        if (Array.isArray(employeeLookup)) {
            const emp = employeeLookup.find(e => 
                (e.employeeId || e.id || e.uid || '').toUpperCase() === cleanId
            );
            if (emp) return emp.fullName || emp.name || "";
        } else if (employeeLookup && typeof employeeLookup === 'object') {
            const emp = employeeLookup[cleanId];
            if (emp) {
                return typeof emp === 'string' ? emp : (emp.fullName || emp.name || "");
            }
        }

        // Known default heads fallback
        const KNOWN_HEADS = {
            'EMP0001': 'Nandan Kumar',
            'EMP0002': 'Rajesh Sharma',
            'EMP0003': 'Ananya Roy',
            'EMP0004': 'Vikram Malhotra',
            'EMP0005': 'Priya Nair',
            'EMP0006': 'John Doe',
            'EMP0007': 'Marry Doe'
        };
        return KNOWN_HEADS[cleanId] || "";
    }

    /**
     * Normalizes allowed employee types array to uppercase valid types
     */
    function normalizeAllowedTypes(types, buCode) {
        if (Array.isArray(types) && types.length > 0) {
            const cleaned = types
                .map(t => String(t).trim().toUpperCase())
                .filter(t => CANONICAL_EMPLOYEE_TYPES.includes(t));
            if (cleaned.length > 0) return [...new Set(cleaned)];
        }

        const normalizedCode = (buCode || '').trim().toUpperCase();
        if (DEFAULT_TYPE_MAPPINGS[normalizedCode]) {
            return [...DEFAULT_TYPE_MAPPINGS[normalizedCode]];
        }

        // Default: Full-Time and Contract
        return ['FULL_TIME', 'CONTRACT'];
    }

    /**
     * Validates and maps a single row into the strict 4-attribute Business Unit record
     * and constructs the target Cloud Firestore document schema.
     */
    function parseBusinessUnitRow(row, idx = 0, employeeLookup = null, seenCodes = new Set()) {
        const errors = [];

        // 1. Extract 4 strictly defined attributes
        const codeAttr = BUSINESS_UNIT_ATTRIBUTES[0];
        const nameAttr = BUSINESS_UNIT_ATTRIBUTES[1];
        const headAttr = BUSINESS_UNIT_ATTRIBUTES[2];
        const activeAttr = BUSINESS_UNIT_ATTRIBUTES[3];

        const rawCode = extractFieldValue(row, [codeAttr.key, ...codeAttr.synonyms]);
        const rawName = extractFieldValue(row, [nameAttr.key, ...nameAttr.synonyms]);
        const rawHead = extractFieldValue(row, [headAttr.key, ...headAttr.synonyms]);
        const rawActive = extractFieldValue(row, [activeAttr.key, ...activeAttr.synonyms]);

        // Validation for required fields
        if (!rawCode || String(rawCode).trim() === '') {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Business_Unit_Code'.`);
        }
        if (!rawName || String(rawName).trim() === '') {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Business_Unit_Name'.`);
        }

        const businessUnitCode = rawCode ? String(rawCode).trim().toUpperCase().replace(/\s+/g, '_') : '';
        const businessUnitName = rawName ? String(rawName).trim() : '';
        const headEmployeeId = rawHead ? String(rawHead).trim().toUpperCase() : '';
        const isActive = parseActiveBoolean(rawActive);

        // Duplicate primary key check
        if (businessUnitCode) {
            if (seenCodes.has(businessUnitCode)) {
                errors.push(`Row ${idx + 1}: Duplicate Business_Unit_Code '${businessUnitCode}' detected in dataset.`);
            } else {
                seenCodes.add(businessUnitCode);
            }
        }

        // Resolve head employee name
        const headEmployeeName = resolveHeadName(headEmployeeId, employeeLookup);

        // Allowed employee types per PRD Section 10
        const rawTypes = row.allowedEmployeeTypes || row.allowed_employee_types || row['Allowed Employee Types'];
        let allowedEmployeeTypes;
        if (typeof rawTypes === 'string') {
            allowedEmployeeTypes = normalizeAllowedTypes(rawTypes.split(/[,;|]+/), businessUnitCode);
        } else if (Array.isArray(rawTypes)) {
            allowedEmployeeTypes = normalizeAllowedTypes(rawTypes, businessUnitCode);
        } else {
            allowedEmployeeTypes = normalizeAllowedTypes(null, businessUnitCode);
        }

        // Construct normalized payload matching exact Firestore document schema
        const firestoreDocument = {
            businessUnitCode,
            businessUnitName,
            headEmployeeId,
            headEmployeeName,
            isActive,
            allowedEmployeeTypes,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Strict 4 attributes dictionary format matching Templates.xlsx
        const strictRow = {
            Business_Unit_Code: businessUnitCode,
            Business_Unit_Name: businessUnitName,
            Head_Employee_ID: headEmployeeId,
            Active: isActive ? "Yes" : "No",
            // Backwards compatibility aliases
            code: businessUnitCode,
            name: businessUnitName,
            headEmployeeId: headEmployeeId,
            isActive: isActive
        };

        return {
            valid: errors.length === 0,
            errors,
            record: strictRow,
            firestoreDoc: firestoreDocument
        };
    }

    /**
     * Parses raw rows from SheetJS 'Business Unit' sheet or CSV rows
     * @param {Array<Object>} rows - Array of row objects from XLSX.utils.sheet_to_json
     * @param {Object|Array} [employeeLookup] - Optional active employees lookup map/array
     */
    function parseBusinessUnitSheet(rows, employeeLookup = null) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                valid: false,
                errors: ["The 'Business Unit' sheet is empty or contains no records."],
                data: [],
                firestoreDocs: [],
                stats: { totalRows: 0, validRows: 0, errorCount: 1 }
            };
        }

        const seenCodes = new Set();
        const records = [];
        const firestoreDocs = [];
        const allErrors = [];

        rows.forEach((row, idx) => {
            // Skip empty rows
            const values = Object.values(row).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (values.length === 0) return;

            const res = parseBusinessUnitRow(row, idx, employeeLookup, seenCodes);
            if (res.valid) {
                records.push(res.record);
                firestoreDocs.push(res.firestoreDoc);
            } else {
                allErrors.push(...res.errors);
            }
        });

        const isValid = allErrors.length === 0 && records.length > 0;

        return {
            valid: isValid,
            errors: allErrors,
            data: records,
            firestoreDocs: firestoreDocs,
            stats: {
                totalRows: rows.length,
                validRows: records.length,
                errorCount: allErrors.length
            }
        };
    }

    /**
     * Parses raw CSV string for Business Unit records
     * @param {string} csvText - Raw CSV file content
     * @param {Object|Array} [employeeLookup]
     */
    function parseBusinessUnitCsv(csvText, employeeLookup = null) {
        if (!csvText || typeof csvText !== 'string' || csvText.trim() === '') {
            return {
                valid: false,
                errors: ["CSV content is empty."],
                data: [],
                firestoreDocs: [],
                stats: { totalRows: 0, validRows: 0, errorCount: 1 }
            };
        }

        const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) {
            return {
                valid: false,
                errors: ["CSV must contain a header row and at least one data row."],
                data: [],
                firestoreDocs: [],
                stats: { totalRows: lines.length, validRows: 0, errorCount: 1 }
            };
        }

        // Helper to parse CSV line respecting quotes
        function splitCsvLine(line) {
            const result = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' || char === "'") {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim().replace(/^["']|["']$/g, ''));
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim().replace(/^["']|["']$/g, ''));
            return result;
        }

        const headers = splitCsvLine(lines[0]);
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const vals = splitCsvLine(lines[i]);
            const rowObj = {};
            headers.forEach((h, idx) => {
                rowObj[h] = vals[idx] !== undefined ? vals[idx] : "";
            });
            rows.push(rowObj);
        }

        return parseBusinessUnitSheet(rows, employeeLookup);
    }

    return {
        BUSINESS_UNIT_ATTRIBUTES,
        CANONICAL_EMPLOYEE_TYPES,
        DEFAULT_TYPE_MAPPINGS,
        parseActiveBoolean,
        resolveHeadName,
        normalizeAllowedTypes,
        parseBusinessUnitRow,
        parseBusinessUnitSheet,
        parseBusinessUnitCsv
    };
}));
