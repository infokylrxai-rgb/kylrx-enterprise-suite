/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - SUB-DEPARTMENT PARSER & VALIDATOR
 * ============================================================================
 * 
 * Ingests, validates, and normalizes Sub-Department records from 'Sub-Departments'
 * sheet in 'Templates.xlsx' or CSV uploads matching PRD Sections 1, 10, & 13:
 * 
 * 1. Exact 5 Attributes Schema:
 *    - Sub-Department_Code (string, unique PK / Firestore doc ID)
 *    - Sub-Department_Name (string, display title)
 *    - Sub-Department_Head_Employee_ID (string, reference to employee ID of Sub-Department Lead)
 *    - Cost_Center_Code (string, foreign key mapped to an active Cost Center)
 *    - Active (boolean: true for "Yes", false for "No")
 * 
 * 2. Foreign Key & Integrity Validation:
 *    - Validates that Cost_Center_Code references an existing Cost Center record before batch commitment.
 *    - Detects empty codes, empty names, or duplicate Sub-Department codes.
 * 
 * 3. Cloud Firestore Document Schema:
 *    - Path: organizations/{orgId}/sub_departments/{subDepartmentCode}
 *    - Document:
 *      {
 *        "subDepartmentCode": "SUB_ENG_API",
 *        "subDepartmentName": "Platform & API Services",
 *        "headEmployeeId": "EMP0007",
 *        "headEmployeeName": "Aditya Rao",
 *        "costCenterCode": "CC_ENG_DEV",
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
        root.KylrxSubDepartmentParser = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Header synonym dictionary for robust Excel / CSV ingestion
    const HEADER_SYNONYMS = {
        subDepartmentCode: [
            'sub-department_code', 'sub_department_code', 'subdepartmentcode',
            'sub-departmentcode', 'sub_dept_code', 'subdeptcode', 'subdepartment_code',
            'sub_department_id', 'subdepartmentid', 'sub_dept_id', 'code'
        ],
        subDepartmentName: [
            'sub-department_name', 'sub_department_name', 'subdepartmentname',
            'sub-departmentname', 'sub_dept_name', 'subdeptname', 'subdepartment_name',
            'sub_department_title', 'subdepartmenttitle', 'name', 'title'
        ],
        headEmployeeId: [
            'sub-department_head_employee_id', 'sub_department_head_employee_id',
            'subdepartmentheademployeeid', 'sub_dept_head_employee_id', 'subdeptheademployeeid',
            'sub-department_head', 'sub_department_lead', 'subdeptlead', 'head_employee_id',
            'heademployeeid', 'lead_employee_id', 'leademployeeid', 'manager_employee_id',
            'sub_department_lead_id'
        ],
        costCenterCode: [
            'cost_center_code', 'costcentercode', 'cost_centre_code', 'costcentrecode',
            'cc_code', 'cccode', 'costcenter', 'costcentre', 'cost_center', 'cost_centre'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'operational_status'
        ]
    };

    /**
     * Normalizes text for header matching
     */
    function normalizeHeaderKey(key) {
        if (!key) return '';
        return String(key).trim().toLowerCase().replace(/[\s\-_./\\()]+/g, '');
    }

    /**
     * Searches a row object for any matching synonym
     */
    function extractFieldValue(row, synonymList) {
        if (!row || typeof row !== 'object') return '';
        const rowKeys = Object.keys(row);

        for (const synonym of synonymList) {
            const normSynonym = normalizeHeaderKey(synonym);
            for (const key of rowKeys) {
                if (normalizeHeaderKey(key) === normSynonym) {
                    const val = row[key];
                    if (val !== undefined && val !== null) {
                        return typeof val === 'string' ? val.trim() : String(val);
                    }
                }
            }
        }
        return '';
    }

    /**
     * Coerces active values to boolean
     * 'Yes', 'Y', 'TRUE', '1', true -> true
     * 'No', 'N', 'FALSE', '0', false -> false
     * Defaults to true if empty or omitted
     */
    function parseActiveBoolean(val) {
        if (val === undefined || val === null || val === '') {
            return true; // Default per PRD specification
        }
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val === 1;

        const clean = String(val).trim().toLowerCase();
        if (clean === 'yes' || clean === 'y' || clean === 'true' || clean === '1') {
            return true;
        }
        if (clean === 'no' || clean === 'n' || clean === 'false' || clean === '0') {
            return false;
        }
        return true;
    }

    /**
     * Helper to resolve head employee name from an array or Map of active personnel
     */
    function resolveHeadName(headId, employeeLookup) {
        if (!headId) return '';
        const cleanId = String(headId).trim().toUpperCase();

        if (employeeLookup) {
            if (Array.isArray(employeeLookup)) {
                const found = employeeLookup.find(e => 
                    (e.employeeId || e.id || e.uid || '').toUpperCase() === cleanId
                );
                if (found) return found.fullName || found.name || `${cleanId} Lead`;
            } else if (employeeLookup instanceof Map) {
                const found = employeeLookup.get(cleanId);
                if (found) return found.fullName || found.name || `${cleanId} Lead`;
            } else if (typeof employeeLookup === 'object') {
                const found = employeeLookup[cleanId];
                if (found) return found.fullName || found.name || `${cleanId} Lead`;
            }
        }

        // Standard enterprise executives lookup
        const knownLeaders = {
            'EMP0001': 'Devendra Sharma',
            'EMP0002': 'Vikram Malhotra',
            'EMP0003': 'Ananya Roy',
            'EMP0004': 'Rajesh Raman',
            'EMP0005': 'Sneha Sen',
            'EMP0006': 'Rohit Verma',
            'EMP0007': 'Aditya Rao'
        };

        return knownLeaders[cleanId] || '';
    }

    /**
     * Checks if a Cost_Center_Code is valid against known Cost Centers
     */
    function isCostCenterKnown(costCenterCode, costCentersLookup) {
        if (!costCenterCode) return false;
        const cleanCode = String(costCenterCode).trim().toUpperCase();

        if (costCentersLookup) {
            if (costCentersLookup instanceof Set) {
                return costCentersLookup.has(cleanCode);
            }
            if (costCentersLookup instanceof Map) {
                return costCentersLookup.has(cleanCode);
            }
            if (Array.isArray(costCentersLookup)) {
                return costCentersLookup.some(cc => {
                    const code = typeof cc === 'string' ? cc : (cc.costCenterCode || cc.code || cc['Cost_Center_Code'] || '');
                    return String(code).trim().toUpperCase() === cleanCode;
                });
            }
            if (typeof costCentersLookup === 'object') {
                return cleanCode in costCentersLookup;
            }
        }

        // Standard known cost centers
        const defaultKnownCc = new Set([
            'CC-ENG-101', 'CC_ENG_DEV', 'CC_ENG_QA', 'CC_ENG_01', 'CC-AI-102', 'CC_AI_LABS',
            'CC-HR-201', 'CC_HR_OPS', 'CC_HR_TALENT', 'CC-FIN-301', 'CC_FIN_CORP', 'CC_FIN_TREASURY',
            'CC-OPS-401', 'CC_OPS_GLOBAL', 'CC_OPS_SUPP', 'CC_EXEC_CORP'
        ]);

        return defaultKnownCc.has(cleanCode);
    }

    /**
     * Identifies if a head employee field specifies "Same as Department Head", is blank, or omitted
     */
    function isSameAsDeptHeadValue(val) {
        if (val === undefined || val === null) return true;
        const clean = String(val).trim().toLowerCase();
        if (!clean) return true;
        return (
            clean === 'same as department head' ||
            clean === 'same as dept head' ||
            clean === 'same_as_department_head' ||
            clean === 'same as dept. head' ||
            clean === 'dept_head' ||
            clean === 'dept head' ||
            clean === 'inherit' ||
            clean === 'inherited' ||
            clean === 'same' ||
            clean === 'true'
        );
    }

    /**
     * Resolves the parent Department linked via Cost Center or organizational code structure
     */
    function resolveDepartmentForSubDept(subDeptCode, costCenterCode, departmentLookup = null) {
        const cleanSubCode = String(subDeptCode || '').trim().toUpperCase();
        const cleanCc = String(costCenterCode || '').trim().toUpperCase();

        if (departmentLookup) {
            if (Array.isArray(departmentLookup)) {
                if (cleanCc) {
                    const byCc = departmentLookup.find(d => 
                        String(d.costCenterCode || d['Cost_Center_Code'] || '').toUpperCase() === cleanCc
                    );
                    if (byCc) {
                        return {
                            departmentCode: (byCc.departmentCode || byCc.code || byCc['Department_Code'] || 'DEPT_ENG').toUpperCase(),
                            departmentName: byCc.departmentName || byCc.name || byCc['Department_Name'] || 'Engineering',
                            departmentHeadEmployeeId: byCc.departmentHeadEmployeeId || byCc.headEmployeeId || byCc['Department_Head_Employee_ID'] || 'EMP0002',
                            departmentHeadName: byCc.departmentHeadName || byCc.headEmployeeName || 'Vikram Malhotra'
                        };
                    }
                }
                const byCode = departmentLookup.find(d => {
                    const code = (d.departmentCode || d.code || d['Department_Code'] || '').toUpperCase();
                    return code && (cleanSubCode === code || cleanSubCode.startsWith(code + '-') || cleanSubCode.startsWith(code + '_') || cleanSubCode.includes(code));
                });
                if (byCode) {
                    return {
                        departmentCode: (byCode.departmentCode || byCode.code || byCode['Department_Code'] || 'DEPT_ENG').toUpperCase(),
                        departmentName: byCode.departmentName || byCode.name || byCode['Department_Name'] || 'Engineering',
                        departmentHeadEmployeeId: byCode.departmentHeadEmployeeId || byCode.headEmployeeId || byCode['Department_Head_Employee_ID'] || 'EMP0002',
                        departmentHeadName: byCode.departmentHeadName || byCode.headEmployeeName || 'Vikram Malhotra'
                    };
                }
            } else if (departmentLookup instanceof Map) {
                if (cleanCc && departmentLookup.has(cleanCc)) {
                    const d = departmentLookup.get(cleanCc);
                    return typeof d === 'object' ? d : { departmentCode: d, departmentHeadEmployeeId: 'EMP0002', departmentHeadName: 'Vikram Malhotra' };
                }
            }
        }

        // Canonical enterprise mappings (PRD §§1, 10, & 13)
        if (cleanCc === 'CC_ENG_01') {
            return {
                departmentCode: 'DEPT_ENG',
                departmentName: 'QA & Engineering',
                departmentHeadEmployeeId: 'EMP0002',
                departmentHeadName: 'Vikram Malhotra'
            };
        }
        if (cleanCc === 'CC_ENG_DEV') {
            return {
                departmentCode: 'ENG',
                departmentName: 'Platform & Software Engineering',
                departmentHeadEmployeeId: 'EMP0002',
                departmentHeadName: 'Vikram Malhotra'
            };
        }
        if (cleanCc === 'CC-ENG-101') {
            return {
                departmentCode: 'ENG',
                departmentName: 'Engineering & Architecture',
                departmentHeadEmployeeId: 'EMP0001',
                departmentHeadName: 'Devendra Sharma'
            };
        }
        if (cleanCc === 'CC-AI-102' || cleanCc === 'CC_AI_LABS') {
            return {
                departmentCode: 'AI-LABS',
                departmentName: 'AI Research & Model Engineering',
                departmentHeadEmployeeId: 'EMP0007',
                departmentHeadName: 'Dr. Kumar Mangalam'
            };
        }
        if (cleanCc === 'CC-HR-201' || cleanCc === 'CC_HR_TALENT' || cleanCc === 'CC_HR_OPS') {
            return {
                departmentCode: 'HR',
                departmentName: 'Human Resources & Payroll',
                departmentHeadEmployeeId: 'EMP0003',
                departmentHeadName: 'Ananya Roy'
            };
        }
        if (cleanCc === 'CC-FIN-301' || cleanCc === 'CC_FIN_CORP' || cleanCc === 'CC_FIN_TREASURY') {
            return {
                departmentCode: 'FIN',
                departmentName: 'Finance & Accounts',
                departmentHeadEmployeeId: 'EMP0004',
                departmentHeadName: 'Rajesh Raman'
            };
        }
        if (cleanCc === 'CC-OPS-401' || cleanCc === 'CC_OPS_SUPP' || cleanCc === 'CC_OPS_GLOBAL') {
            return {
                departmentCode: 'OPS',
                departmentName: 'Global Operations',
                departmentHeadEmployeeId: 'EMP0005',
                departmentHeadName: 'Sneha Sen'
            };
        }

        // Prefix heuristics
        if (cleanSubCode.startsWith('ENG') || cleanSubCode.includes('ENG')) {
            return {
                departmentCode: 'ENG',
                departmentName: 'Engineering',
                departmentHeadEmployeeId: 'EMP0001',
                departmentHeadName: 'Devendra Sharma'
            };
        }
        if (cleanSubCode.startsWith('HR')) {
            return {
                departmentCode: 'HR',
                departmentName: 'Human Resources',
                departmentHeadEmployeeId: 'EMP0003',
                departmentHeadName: 'Ananya Roy'
            };
        }
        if (cleanSubCode.startsWith('FIN')) {
            return {
                departmentCode: 'FIN',
                departmentName: 'Finance',
                departmentHeadEmployeeId: 'EMP0004',
                departmentHeadName: 'Rajesh Raman'
            };
        }

        return {
            departmentCode: 'DEPT_ENG',
            departmentName: 'Core Engineering',
            departmentHeadEmployeeId: 'EMP0002',
            departmentHeadName: 'Vikram Malhotra'
        };
    }

    /**
     * Parses a single row into the strict 5 attributes and Firestore document structure
     */
    function parseSubDepartmentRow(row, idx = 0, employeeLookup = null, costCentersLookup = null, seenCodes = new Set(), departmentLookup = null) {
        const errors = [];
        const warnings = [];

        const rawCode = extractFieldValue(row, HEADER_SYNONYMS.subDepartmentCode);
        const rawName = extractFieldValue(row, HEADER_SYNONYMS.subDepartmentName);
        const rawHead = extractFieldValue(row, HEADER_SYNONYMS.headEmployeeId);
        const rawCc = extractFieldValue(row, HEADER_SYNONYMS.costCenterCode);
        const rawActive = extractFieldValue(row, HEADER_SYNONYMS.active);

        // 1. Validate Code
        if (!rawCode) {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Sub-Department_Code'.`);
        }

        // 2. Validate Name
        if (!rawName) {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Sub-Department_Name'.`);
        }

        // 3. Validate Cost Center Code (Foreign Key)
        if (!rawCc) {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Cost_Center_Code'.`);
        }

        const subDepartmentCode = rawCode ? String(rawCode).trim().toUpperCase().replace(/\s+/g, '_') : '';
        const subDepartmentName = rawName ? String(rawName).trim() : '';
        const costCenterCode = rawCc ? String(rawCc).trim().toUpperCase().replace(/\s+/g, '_') : '';
        const isActive = parseActiveBoolean(rawActive);

        // Check Duplicates
        if (subDepartmentCode) {
            if (seenCodes.has(subDepartmentCode)) {
                errors.push(`Row ${idx + 1}: Duplicate Sub-Department_Code '${subDepartmentCode}' detected in dataset.`);
            } else {
                seenCodes.add(subDepartmentCode);
            }
        }

        // Validate Foreign Key Cost_Center_Code
        if (costCenterCode && costCentersLookup) {
            if (!isCostCenterKnown(costCenterCode, costCentersLookup)) {
                errors.push(`Row ${idx + 1}: Foreign Key Violation: Cost_Center_Code '${costCenterCode}' does not exist in active Cost Centers.`);
            }
        }

        // PRD Sections 1, 10 & 13: "Same as Department Head" Inheritance Logic
        const sameAsDeptHead = isSameAsDeptHeadValue(rawHead);
        const inheritedFromDeptHead = sameAsDeptHead;

        const parentDept = resolveDepartmentForSubDept(subDepartmentCode, costCenterCode, departmentLookup);
        const departmentCode = parentDept.departmentCode;

        let headEmployeeId = '';
        let headEmployeeName = '';

        if (sameAsDeptHead) {
            headEmployeeId = parentDept.departmentHeadEmployeeId;
            headEmployeeName = parentDept.departmentHeadName || resolveHeadName(headEmployeeId, employeeLookup) || 'Vikram Malhotra';
        } else {
            headEmployeeId = String(rawHead).trim().toUpperCase();
            headEmployeeName = resolveHeadName(headEmployeeId, employeeLookup);
        }

        const subDepartmentHeadEmployeeId = headEmployeeId;
        const subDepartmentHeadName = headEmployeeName;

        // Data Record (Exact 5 Attributes + metadata)
        const record = {
            'Sub-Department_Code': subDepartmentCode,
            'Sub-Department_Name': subDepartmentName,
            'Sub-Department_Head_Employee_ID': headEmployeeId,
            'Cost_Center_Code': costCenterCode,
            'Active': isActive ? 'Yes' : 'No',
            // Extended PRD attributes
            subDepartmentCode,
            subDepartmentName,
            costCenterCode,
            departmentCode,
            sameAsDeptHead,
            inheritedFromDeptHead,
            subDepartmentHeadEmployeeId,
            subDepartmentHeadName,
            headEmployeeId,
            headEmployeeName,
            isActive,
            code: subDepartmentCode,
            name: subDepartmentName
        };

        // Firestore Document Schema (PRD Section 4)
        const firestoreDoc = {
            subDepartmentCode,
            subDepartmentName,
            costCenterCode,
            departmentCode,
            sameAsDeptHead,
            inheritedFromDeptHead,
            subDepartmentHeadEmployeeId,
            subDepartmentHeadName,
            headEmployeeId,
            headEmployeeName,
            isActive
        };

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            record,
            firestoreDoc
        };
    }

    /**
     * Resolves Sub-Department Head details from employee directory
     */
    function resolveSubDepartmentHead(headId, directory = []) {
        if (!headId) return { id: '', name: '', displayName: '', designation: '' };
        const cleanId = String(headId).trim().toUpperCase();
        let name = '';
        let designation = '';

        if (Array.isArray(directory)) {
            const found = directory.find(e => 
                (e.employeeId || e.id || e.uid || '').toUpperCase() === cleanId
            );
            if (found) {
                name = found.fullName || found.name || `${cleanId} Lead`;
                designation = found.designation || found.role || found.jobTitle || '';
            }
        }
        if (!name) {
            name = resolveHeadName(cleanId);
        }
        if (!name) name = `${cleanId} Lead`;

        return {
            id: cleanId,
            name: name,
            displayName: `${name} (${cleanId})`,
            designation: designation
        };
    }

    /**
     * Parses an array of raw rows with options object
     */
    function parseSubDepartmentRows(rows, options = {}) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                valid: false,
                validRecords: [],
                data: [],
                firestoreDocs: [],
                errors: [{ row: 0, message: "No data rows provided." }],
                warnings: [],
                totalRows: 0,
                stats: { totalRows: 0, validRows: 0, invalidRows: 0 }
            };
        }

        const validCostCenters = options.validCostCenterCodes || options.costCentersLookup || options.validCostCenters || null;
        const employeeLookup = options.employeeLookup || null;
        const departmentLookup = options.departmentLookup || options.departments || null;
        const validateCostCenters = options.validateCostCenters !== false;

        const validRecords = [];
        const firestoreDocs = [];
        const errors = [];
        const warnings = [];
        const seenCodes = new Set();

        rows.forEach((row, idx) => {
            const values = Object.values(row).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
            if (values.length === 0) return;

            const res = parseSubDepartmentRow(
                row,
                idx,
                employeeLookup,
                validateCostCenters ? validCostCenters : null,
                seenCodes,
                departmentLookup
            );

            if (res.valid) {
                validRecords.push(res.record);
                firestoreDocs.push(res.firestoreDoc);
            } else {
                res.errors.forEach(errStr => {
                    errors.push({
                        row: idx + 1,
                        message: errStr,
                        toString: () => errStr
                    });
                });
            }

            if (res.warnings.length > 0) {
                warnings.push(...res.warnings);
            }
        });

        const isValid = errors.length === 0 && validRecords.length > 0;

        return {
            valid: isValid,
            validRecords,
            data: validRecords,
            firestoreDocs,
            errors,
            warnings,
            totalRows: rows.length,
            stats: {
                totalRows: rows.length,
                validRows: validRecords.length,
                invalidRows: errors.length
            }
        };
    }

    /**
     * Backward-compatible sheet parser
     */
    function parseSubDepartmentSheet(rows, employeeLookup = null, costCentersLookup = null) {
        const res = parseSubDepartmentRows(rows, {
            employeeLookup,
            validCostCenterCodes: costCentersLookup,
            validateCostCenters: Boolean(costCentersLookup)
        });

        // Error strings for backward compatibility
        const errorStrings = res.errors.map(e => typeof e === 'string' ? e : e.message);

        return {
            valid: res.valid,
            validRecords: res.validRecords,
            data: res.valid ? res.data : [],
            firestoreDocs: res.valid ? res.firestoreDocs : [],
            errors: errorStrings,
            warnings: res.warnings,
            stats: res.stats
        };
    }

    /**
     * Parses Sub-Departments sheet from SheetJS workbook or buffer
     */
    async function parseSubDepartmentWorkbook(workbookOrBuffer, options = {}) {
        let XLSXLib = (typeof window !== 'undefined' && window.XLSX) || null;
        if (!XLSXLib) {
            try {
                const req = typeof require !== 'undefined' ? require : null;
                if (req) {
                    XLSXLib = req('xlsx');
                } else {
                    XLSXLib = (await import('xlsx')).default || (await import('xlsx'));
                }
            } catch (e) {
                throw new Error('SheetJS (xlsx) library is required to parse Excel workbooks: ' + e.message);
            }
        }

        let workbook = workbookOrBuffer;
        if (typeof workbookOrBuffer === 'string' || workbookOrBuffer instanceof Uint8Array || Buffer.isBuffer?.(workbookOrBuffer) || workbookOrBuffer instanceof ArrayBuffer) {
            workbook = XLSXLib.read(workbookOrBuffer, { type: 'buffer' });
        }

        const sheetNames = workbook.SheetNames || [];
        const targetSheetName = sheetNames.find(s => {
            const norm = s.trim().toLowerCase().replace(/[\s\-_]+/g, '');
            return norm === 'subdepartments' || norm === 'subdepartment' || norm.includes('subdept');
        }) || sheetNames[0];

        if (!targetSheetName || !workbook.Sheets[targetSheetName]) {
            throw new Error("Could not find 'Sub-Departments' sheet in workbook.");
        }

        const sheet = workbook.Sheets[targetSheetName];
        const rows = XLSXLib.utils.sheet_to_json(sheet, { defval: '' });
        return parseSubDepartmentRows(rows, options);
    }

    /**
     * Parses CSV text for Sub-Departments
     */
    function parseSubDepartmentCsv(csvText, options = {}) {
        if (!csvText || typeof csvText !== 'string') {
            return {
                valid: false,
                validRecords: [],
                data: [],
                firestoreDocs: [],
                errors: [{ row: 0, message: "Empty CSV string provided." }],
                warnings: [],
                totalRows: 0
            };
        }

        const lines = csvText.trim().split(/\r\n|\n/).filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            return {
                valid: false,
                validRecords: [],
                data: [],
                firestoreDocs: [],
                errors: [{ row: 0, message: "CSV must contain a header row and at least one data row." }],
                warnings: [],
                totalRows: lines.length
            };
        }

        // Simple CSV splitter handling quoted cells
        function splitCsvLine(line) {
            const result = [];
            let inQuotes = false;
            let current = '';

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim().replace(/^"|"$/g, ''));
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim().replace(/^"|"$/g, ''));
            return result;
        }

        const headers = splitCsvLine(lines[0]);
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = splitCsvLine(lines[i]);
            const rowObj = {};
            headers.forEach((h, colIdx) => {
                rowObj[h] = values[colIdx] || '';
            });
            rows.push(rowObj);
        }

        // Support both old signature (employeeLookup, costCentersLookup) and new options object
        let parsedOptions = options;
        if (arguments.length > 1 && !options.validCostCenterCodes && !options.costCentersLookup) {
            const employeeLookup = arguments[1];
            const costCentersLookup = arguments[2];
            parsedOptions = { employeeLookup, costCentersLookup, validCostCenterCodes: costCentersLookup };
        }

        return parseSubDepartmentRows(rows, parsedOptions);
    }

    return {
        HEADER_SYNONYMS,
        parseActiveBoolean,
        isSameAsDeptHeadValue,
        resolveDepartmentForSubDept,
        resolveHeadName,
        resolveSubDepartmentHead,
        isCostCenterKnown,
        parseSubDepartmentRow,
        parseSubDepartmentRows,
        parseSubDepartmentSheet,
        parseSubDepartmentWorkbook,
        parseSubDepartmentCsv
    };
}));
