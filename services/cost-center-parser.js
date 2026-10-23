/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - COST CENTER SCHEMA & SHEETJS PARSER
 * ============================================================================
 * 
 * Implements Cost Center schema parsing and validation matching the official
 * 'Cost Center' / 'Cost Centre' sheet from Templates.xlsx and PRD Sections 1, 10, & 13:
 * 
 * 1. Exact Schema & Field Mapping (Strict 4 Attributes):
 *    - Cost_Center_Code (string, unique PK / Firestore document ID)
 *    - Cost_Center_Name (string, display title)
 *    - Owner_Employee_ID (string, reference to employee ID of the Cost Center Owner e.g., CEO, CTO, EVP, Director)
 *    - Active (boolean: true for "Yes", false for "No")
 * 
 * 2. Data Architecture (Cloud Firestore):
 *    - Path: organizations/{orgId}/cost_centers/{costCenterCode}
 *    - Document Schema:
 *      {
 *        "costCenterCode": "CC_ENG_DEV",
 *        "costCenterName": "Software Engineering & R&D",
 *        "ownerEmployeeId": "EMP0002",
 *        "ownerEmployeeName": "Vikram Malhotra",
 *        "isActive": true,
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
        root.KylrxCostCenterParser = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Canonical 4 attributes for Cost Center records (PRD §1 & §13)
     */
    const COST_CENTER_ATTRIBUTES = [
        {
            key: 'Cost_Center_Code',
            label: 'Cost Center Code',
            required: true,
            type: 'string',
            description: 'Unique primary key / Firestore document ID (e.g., CC_ENG_DEV, CC-ENG-101)'
        },
        {
            key: 'Cost_Center_Name',
            label: 'Cost Center Name',
            required: true,
            type: 'string',
            description: 'Display title for departmental budget and payroll expense attribution'
        },
        {
            key: 'Owner_Employee_ID',
            label: 'Owner Employee ID',
            required: false,
            type: 'string',
            description: 'Employee ID of budget owner (CEO, CTO, EVP, Director, VP)'
        },
        {
            key: 'Active',
            label: 'Active Status',
            required: false,
            type: 'boolean',
            defaultValue: true,
            description: "Active status: 'Yes' (true) or 'No' (false)"
        }
    ];

    /**
     * Common header synonym mappings for robust SheetJS parsing
     */
    const HEADER_SYNONYMS = {
        costCenterCode: [
            'cost_center_code', 'costcentercode', 'cc_code', 'cccode', 'code',
            'cost center code', 'cost centre code', 'cost_centre_code', 'costcentrecode'
        ],
        costCenterName: [
            'cost_center_name', 'costcentername', 'cc_name', 'ccname', 'name',
            'cost center name', 'cost centre name', 'cost_centre_name', 'costcentrename', 'title', 'display_name'
        ],
        ownerEmployeeId: [
            'owner_employee_id', 'owneremployeeid', 'owner_id', 'ownerid', 'owner',
            'owner employee id', 'owner employee id (ceo/cto/evp/director/vp)', 'owner employee id (ceo/cto/e...',
            'budget_owner', 'cost_center_owner', 'cc_owner', 'owner_emp_id'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'active status', 'is active'
        ]
    };

    /**
     * Normalizes a header or key string for lookup
     */
    function normalizeHeaderKey(key) {
        if (!key) return '';
        return String(key).trim().toLowerCase().replace(/[\s_\-./()\\]+/g, '');
    }

    /**
     * Extracts an attribute value from a raw row object by checking synonyms
     */
    function extractFieldValue(row, synonymList) {
        if (!row || typeof row !== 'object') return null;

        const rowKeys = Object.keys(row);
        for (const synonym of synonymList) {
            const cleanSyn = normalizeHeaderKey(synonym);
            const matchingKey = rowKeys.find(k => normalizeHeaderKey(k) === cleanSyn);
            if (matchingKey && row[matchingKey] !== undefined && row[matchingKey] !== null) {
                const val = row[matchingKey];
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
     * Parses the Active boolean value from spreadsheet or CSV
     * Supports "Yes"/"No", "Y"/"N", boolean true/false, 1/0, "True"/"False"
     * Defaults to true if empty or omitted.
     */
    function parseActiveBoolean(rawVal) {
        if (rawVal === undefined || rawVal === null || rawVal === '') {
            return true; // Default per PRD
        }
        if (typeof rawVal === 'boolean') {
            return rawVal;
        }
        if (typeof rawVal === 'number') {
            return rawVal === 1;
        }

        const normalized = String(rawVal).trim().toLowerCase();
        if (['no', 'n', 'false', '0', 'inactive', 'disabled', 'deactivated', 'off'].includes(normalized)) {
            return false;
        }
        return true;
    }

    /**
     * Resolves owner employee name and designation from an active personnel directory
     */
    function resolveOwnerDetails(ownerEmployeeId, employeeLookup) {
        if (!ownerEmployeeId) return { name: '', designation: '' };
        const cleanId = String(ownerEmployeeId).trim().toUpperCase();

        if (employeeLookup) {
            // If employeeLookup is a Map
            if (employeeLookup instanceof Map && employeeLookup.has(cleanId)) {
                const emp = employeeLookup.get(cleanId);
                return {
                    name: emp.fullName || emp.name || emp.displayName || '',
                    designation: emp.designation || emp.role || emp.jobTitle || ''
                };
            }

            // If employeeLookup is an Array
            if (Array.isArray(employeeLookup)) {
                const emp = employeeLookup.find(e => 
                    (e.employeeId || e.id || e.code || '').toUpperCase() === cleanId
                );
                if (emp) {
                    return {
                        name: emp.fullName || emp.name || emp.displayName || '',
                        designation: emp.designation || emp.role || emp.jobTitle || ''
                    };
                }
            }

            // If employeeLookup is a plain object
            if (typeof employeeLookup === 'object' && employeeLookup[cleanId]) {
                const emp = employeeLookup[cleanId];
                if (typeof emp === 'string') {
                    return { name: emp, designation: '' };
                }
                return {
                    name: emp.fullName || emp.name || emp.displayName || '',
                    designation: emp.designation || emp.role || emp.jobTitle || ''
                };
            }
        }

        // Built-in fallback lookup for standard seeded enterprise leaders
        const defaultOwners = {
            'EMP0001': { name: 'Devendra Sharma', designation: 'Chief Technology Officer (CTO)' },
            'EMP0002': { name: 'Vikram Malhotra', designation: 'Chief Executive Officer (CEO)' },
            'EMP0003': { name: 'Ananya Roy', designation: 'Chief People Officer (CPO)' },
            'EMP0004': { name: 'Rajesh Raman', designation: 'Chief Financial Officer (CFO)' },
            'EMP0005': { name: 'Sneha Sen', designation: 'EVP Global Operations' }
        };

        if (defaultOwners[cleanId]) {
            return defaultOwners[cleanId];
        }

        return { name: '', designation: '' };
    }

    /**
     * Parses and validates a single Cost Center row
     */
    function parseCostCenterRow(row, idx = 0, employeeLookup = null, seenCodes = new Set()) {
        const errors = [];

        const rawCode = extractFieldValue(row, HEADER_SYNONYMS.costCenterCode);
        const rawName = extractFieldValue(row, HEADER_SYNONYMS.costCenterName);
        const rawOwner = extractFieldValue(row, HEADER_SYNONYMS.ownerEmployeeId);
        const rawActive = extractFieldValue(row, HEADER_SYNONYMS.active);

        // Validation for required fields
        if (!rawCode || String(rawCode).trim() === '') {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Cost_Center_Code'.`);
        }
        if (!rawName || String(rawName).trim() === '') {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Cost_Center_Name'.`);
        }

        const costCenterCode = rawCode ? String(rawCode).trim().toUpperCase().replace(/\s+/g, '_') : '';
        const costCenterName = rawName ? String(rawName).trim() : '';
        const ownerEmployeeId = rawOwner ? String(rawOwner).trim().toUpperCase() : '';
        const isActive = parseActiveBoolean(rawActive);

        // Duplicate primary key check
        if (costCenterCode) {
            if (seenCodes.has(costCenterCode)) {
                errors.push(`Row ${idx + 1}: Duplicate Cost_Center_Code '${costCenterCode}' detected in dataset.`);
            } else {
                seenCodes.add(costCenterCode);
            }
        }

        // Resolve owner employee name & designation
        const ownerDetails = resolveOwnerDetails(ownerEmployeeId, employeeLookup);
        const ownerEmployeeName = ownerDetails.name;
        const ownerDesignation = ownerDetails.designation;

        // Construct normalized payload matching exact Firestore document schema
        const firestoreDocument = {
            costCenterCode,
            costCenterName,
            ownerEmployeeId,
            ownerEmployeeName,
            ownerDesignation,
            isActive,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Strict 4 attributes dictionary format matching Templates.xlsx
        const strictRecord = {
            Cost_Center_Code: costCenterCode,
            Cost_Center_Name: costCenterName,
            Owner_Employee_ID: ownerEmployeeId,
            Active: isActive ? "Yes" : "No",
            // Backwards compatibility aliases
            code: costCenterCode,
            name: costCenterName,
            ownerEmployeeId: ownerEmployeeId,
            ownerEmployeeName: ownerEmployeeName,
            ownerDesignation: ownerDesignation,
            isActive: isActive
        };

        return {
            valid: errors.length === 0,
            errors,
            record: strictRecord,
            firestoreDoc: firestoreDocument
        };
    }

    /**
     * Parses raw rows from SheetJS 'Cost Center' sheet or CSV rows
     * @param {Array<Object>} rows - Array of row objects from XLSX.utils.sheet_to_json
     * @param {Object|Array} [employeeLookup] - Optional active employees lookup map/array
     */
    function parseCostCenterSheet(rows, employeeLookup = null) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                valid: false,
                errors: ["The 'Cost Center' sheet is empty or contains no records."],
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
            // Skip completely empty rows
            const values = Object.values(row).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (values.length === 0) return;

            const res = parseCostCenterRow(row, idx, employeeLookup, seenCodes);
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
     * Parses raw CSV string for Cost Center records
     * @param {string} csvText - Raw CSV file content
     * @param {Object|Array} [employeeLookup]
     */
    function parseCostCenterCsv(csvText, employeeLookup = null) {
        if (!csvText || typeof csvText !== 'string' || csvText.trim() === '') {
            return {
                valid: false,
                errors: ["CSV content is empty."],
                data: [],
                firestoreDocs: [],
                stats: { totalRows: 0, validRows: 0, errorCount: 1 }
            };
        }

        const lines = csvText.trim().split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) {
            return {
                valid: false,
                errors: ["CSV must contain a header row and at least one data row."],
                data: [],
                firestoreDocs: [],
                stats: { totalRows: lines.length, validRows: 0, errorCount: 1 }
            };
        }

        function splitCsvLine(line) {
            const result = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
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

        return parseCostCenterSheet(rows, employeeLookup);
    }

    return {
        COST_CENTER_ATTRIBUTES,
        HEADER_SYNONYMS,
        parseActiveBoolean,
        resolveOwnerDetails,
        parseCostCenterRow,
        parseCostCenterSheet,
        parseCostCenterCsv
    };
}));
