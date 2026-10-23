/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - EMPLOYEE TYPE / CATEGORY PARSER & VALIDATOR
 * ============================================================================
 * 
 * Ingests, validates, and normalizes Employee Type records from the
 * 'Employee Type' sheet of Templates.xlsx or CSV uploads matching PRD §§ 1, 10, & 13:
 * 
 * Exact 7 Attributes:
 * 1. Category_Code (string, unique PK / Firestore doc ID, e.g. CAT_FT_REG)
 * 2. Category_Name (string, display title)
 * 3. Employment_Type (string: Permanent, Contract, Intern, Temporary, Consultant, etc.)
 * 4. Worker_Type (string: White Collar, Blue Collar, On-Roll, Off-Roll, etc.)
 * 5. Probation_Days (number, standard probation tenure in days)
 * 6. Notice_Period_Days (number, standard notice duration in days)
 * 7. Active (boolean: true for "Yes", false for "No")
 * 
 * @version 1.0.0
 * @author Senior Full-Stack Firebase Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxEmployeeTypeParser = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Canonical Enterprise Employee Types matching PRD Sections 1, 10, & 13
    const DEFAULT_EMPLOYEE_TYPES = [
        {
            categoryCode: 'CAT_FT_REG',
            categoryName: 'Full-Time Regular',
            employmentType: 'Permanent',
            workerType: 'White Collar',
            probationDays: 180,
            noticePeriodDays: 60,
            isActive: true
        },
        {
            categoryCode: 'CAT_FT_EXEC',
            categoryName: 'Executive Leadership',
            employmentType: 'Permanent',
            workerType: 'White Collar',
            probationDays: 90,
            noticePeriodDays: 90,
            isActive: true
        },
        {
            categoryCode: 'CAT_CON_TVC',
            categoryName: 'Contractor / TVC',
            employmentType: 'Contract',
            workerType: 'Off-Roll',
            probationDays: 30,
            noticePeriodDays: 30,
            isActive: true
        },
        {
            categoryCode: 'CAT_INT_GRAD',
            categoryName: 'Graduate Intern / Apprentice',
            employmentType: 'Intern',
            workerType: 'On-Roll',
            probationDays: 0,
            noticePeriodDays: 15,
            isActive: true
        },
        {
            categoryCode: 'CAT_TEMP_OPS',
            categoryName: 'Temporary & Seasonal Staff',
            employmentType: 'Temporary',
            workerType: 'Blue Collar',
            probationDays: 15,
            noticePeriodDays: 15,
            isActive: true
        },
        {
            categoryCode: 'CAT_PLANT_WKR',
            categoryName: 'Plant & Manufacturing Operative',
            employmentType: 'Permanent',
            workerType: 'Blue Collar',
            probationDays: 180,
            noticePeriodDays: 30,
            isActive: true
        }
    ];

    // Canonical header synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        categoryCode: [
            'category_code', 'categorycode', 'type_code', 'typecode', 'code', 'id',
            'employment_category_code', 'employee_type_code', 'cat_code'
        ],
        categoryName: [
            'category_name', 'categoryname', 'type_name', 'typename', 'name', 'title',
            'category_title', 'employee_type_name'
        ],
        employmentType: [
            'employment_type', 'employmenttype', 'type', 'nature_of_employment',
            'employment_nature', 'contract_type'
        ],
        workerType: [
            'worker_type', 'workertype', 'worker_classification', 'classification',
            'collar_type', 'payroll_type'
        ],
        probationDays: [
            'probation_days', 'probationdays', 'probation_period', 'probation_period_days',
            'probation_tenure_days', 'probation', 'probation_tenure'
        ],
        noticePeriodDays: [
            'notice_period_days', 'noticeperioddays', 'notice_days', 'noticedays',
            'notice_period', 'notice_duration_days', 'notice'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'operational_status'
        ]
    };

    /**
     * Normalizes an object key by removing whitespace, underscores, hyphens, and converting to lowercase
     */
    function normalizeKey(str) {
        return String(str || '').toLowerCase().replace(/[\s_-]+/g, '');
    }

    /**
     * Extracts field value by checking synonym keys
     */
    function extractFieldValue(row, synonyms) {
        if (!row || typeof row !== 'object') return null;
        const keys = Object.keys(row);
        for (const syn of synonyms) {
            const cleanSyn = normalizeKey(syn);
            const foundKey = keys.find(k => normalizeKey(k) === cleanSyn);
            if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
                const val = row[foundKey];
                if (typeof val === 'string' && val.trim() !== '') return val.trim();
                if (typeof val !== 'string') return val;
            }
        }
        return null;
    }

    /**
     * Parses numeric duration/count with fallback, stripping non-numeric suffixes (e.g. 'days', 'd', 'months')
     */
    function parseNumeric(val, defaultVal = 0) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'number') return isNaN(val) ? defaultVal : Math.round(val);
        const str = String(val).trim();
        const match = str.match(/^-?(\d+(\.\d+)?)/);
        if (!match) return defaultVal;
        const num = Math.round(parseFloat(match[1]));
        if (isNaN(num) || num < 0) return defaultVal;
        return num;
    }

    /**
     * Normalizes Yes/No boolean strings, numbers, or native booleans
     */
    function parseBoolean(val, defaultVal = true) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const str = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', '1', 'active', 'enabled'].includes(str)) return true;
        if (['no', 'n', 'false', '0', 'inactive', 'disabled'].includes(str)) return false;
        return defaultVal;
    }

    /**
     * Normalizes Employment Type strings into standard PRD classifications
     */
    function normalizeEmploymentType(val) {
        const str = String(val || 'Permanent').trim();
        const lower = str.toLowerCase();
        if (lower.includes('perm') || lower.includes('regular') || lower.includes('full')) return 'Permanent';
        if (lower.includes('cont') || lower.includes('tvc') || lower.includes('fixed')) return 'Contract';
        if (lower.includes('intern') || lower.includes('trainee') || lower.includes('apprentice')) return 'Intern';
        if (lower.includes('temp') || lower.includes('casual') || lower.includes('seasonal')) return 'Temporary';
        if (lower.includes('consult')) return 'Consultant';
        if (lower.includes('part')) return 'Part-Time';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Normalizes Worker Type strings into standard classifications
     */
    function normalizeWorkerType(val) {
        const str = String(val || 'White Collar').trim();
        const lower = str.toLowerCase();
        if (lower.includes('white') || lower.includes('desk') || lower.includes('prof')) return 'White Collar';
        if (lower.includes('blue') || lower.includes('plant') || lower.includes('factory') || lower.includes('field')) return 'Blue Collar';
        if (lower.includes('off') || lower.includes('contingent') || lower.includes('vendor')) return 'Off-Roll';
        if (lower.includes('on') || lower.includes('direct')) return 'On-Roll';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Parses a single row into the strict 7 attributes and Firestore document structure
     */
    function parseEmployeeTypeRow(row, idx = 0, seenCodes = new Set()) {
        const errors = [];
        const warnings = [];

        const rawCode = extractFieldValue(row, HEADER_SYNONYMS.categoryCode);
        const rawName = extractFieldValue(row, HEADER_SYNONYMS.categoryName);
        const rawEmploymentType = extractFieldValue(row, HEADER_SYNONYMS.employmentType);
        const rawWorkerType = extractFieldValue(row, HEADER_SYNONYMS.workerType);
        const rawProbation = extractFieldValue(row, HEADER_SYNONYMS.probationDays);
        const rawNotice = extractFieldValue(row, HEADER_SYNONYMS.noticePeriodDays);
        const rawActive = extractFieldValue(row, HEADER_SYNONYMS.active);

        // 1. Category Code (PK)
        if (!rawCode) {
            errors.push(`Row ${idx + 1}: Missing mandatory 'Category_Code' attribute.`);
        }

        // 2. Category Name
        if (!rawName) {
            errors.push(`Row ${idx + 1}: Missing mandatory 'Category_Name' attribute.`);
        }

        const categoryCode = rawCode ? String(rawCode).trim().toUpperCase().replace(/\s+/g, '_') : '';
        const categoryName = rawName ? String(rawName).trim() : '';

        // Enforce PK uniqueness
        if (categoryCode) {
            if (seenCodes.has(categoryCode)) {
                errors.push(`Row ${idx + 1}: Duplicate Category Code "${categoryCode}" detected.`);
            } else {
                seenCodes.add(categoryCode);
            }
        }

        // 3. Employment Type & 4. Worker Type
        const employmentType = normalizeEmploymentType(rawEmploymentType);
        const workerType = normalizeWorkerType(rawWorkerType);

        // 5. Probation Days (default: 180 for Permanent, 30 for Contract, 0 for Intern)
        let defaultProbation = 180;
        if (employmentType === 'Contract') defaultProbation = 30;
        if (employmentType === 'Intern') defaultProbation = 0;
        if (employmentType === 'Temporary') defaultProbation = 15;
        const probationDays = parseNumeric(rawProbation, defaultProbation);

        // 6. Notice Period Days (default: 60 for Permanent, 30 for Contract, 15 for Intern)
        let defaultNotice = 60;
        if (employmentType === 'Contract') defaultNotice = 30;
        if (employmentType === 'Intern') defaultNotice = 15;
        if (employmentType === 'Temporary') defaultNotice = 15;
        const noticePeriodDays = parseNumeric(rawNotice, defaultNotice);

        // 7. Active status
        const isActive = parseBoolean(rawActive, true);

        // Domain validation warnings
        if (probationDays > 365) {
            warnings.push(`Row ${idx + 1}: Probation_Days (${probationDays}) exceeds standard 1-year threshold.`);
        }
        if (noticePeriodDays > 180) {
            warnings.push(`Row ${idx + 1}: Notice_Period_Days (${noticePeriodDays}) exceeds standard 6-month threshold.`);
        }

        const record = {
            'Category_Code': categoryCode,
            'Category_Name': categoryName,
            'Employment_Type': employmentType,
            'Worker_Type': workerType,
            'Probation_Days': probationDays,
            'Notice_Period_Days': noticePeriodDays,
            'Active': isActive ? 'Yes' : 'No',

            // Canonical attributes
            categoryCode,
            categoryName,
            employmentType,
            workerType,
            probationDays,
            noticePeriodDays,
            isActive
        };

        const firestoreDoc = {
            categoryCode,
            categoryName,
            employmentType,
            workerType,
            probationDays,
            noticePeriodDays,
            isActive
        };

        return {
            valid: errors.length === 0,
            rowIndex: idx,
            errors,
            warnings,
            record,
            firestoreDoc
        };
    }

    /**
     * Parses multiple rows from SheetJS aoa or json
     */
    function parseEmployeeTypeSheet(sheetRows) {
        if (!Array.isArray(sheetRows) || sheetRows.length === 0) {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                errors: ['No data rows found in Employee Type sheet.'],
                warnings: [],
                records: [],
                firestoreDocs: []
            };
        }

        const seenCodes = new Set();
        const records = [];
        const firestoreDocs = [];
        const allErrors = [];
        const allWarnings = [];

        sheetRows.forEach((row, idx) => {
            if (!row || (Array.isArray(row) && row.length === 0)) return;
            const parsed = parseEmployeeTypeRow(row, idx, seenCodes);
            if (parsed.errors.length > 0) {
                allErrors.push(...parsed.errors);
            }
            if (parsed.warnings.length > 0) {
                allWarnings.push(...parsed.warnings);
            }
            if (parsed.valid) {
                records.push(parsed.record);
                firestoreDocs.push(parsed.firestoreDoc);
            }
        });

        return {
            valid: allErrors.length === 0 && records.length > 0,
            totalRows: sheetRows.length,
            validCount: records.length,
            errorCount: allErrors.length,
            errors: allErrors,
            warnings: allWarnings,
            records,
            firestoreDocs
        };
    }

    /**
     * Parses raw CSV content into Employee Type records
     */
    function parseEmployeeTypeCsv(csvContent) {
        if (!csvContent || typeof csvContent !== 'string') {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                errors: ['Empty or invalid CSV content provided.'],
                warnings: [],
                records: [],
                firestoreDocs: []
            };
        }

        const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            return {
                valid: false,
                totalRows: lines.length,
                validCount: 0,
                errorCount: 1,
                errors: ['CSV must contain at least a header row and one data row.'],
                warnings: [],
                records: [],
                firestoreDocs: []
            };
        }

        // Simple CSV splitter handling quoted cells
        function splitCsvLine(line) {
            const result = [];
            let insideQuote = false;
            let entry = '';
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    if (insideQuote && line[i + 1] === '"') {
                        entry += '"';
                        i++;
                    } else {
                        insideQuote = !insideQuote;
                    }
                } else if (char === ',' && !insideQuote) {
                    result.push(entry.trim());
                    entry = '';
                } else {
                    entry += char;
                }
            }
            result.push(entry.trim());
            return result;
        }

        const headers = splitCsvLine(lines[0]);
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const values = splitCsvLine(lines[i]);
            const rowObj = {};
            headers.forEach((h, colIdx) => {
                rowObj[h] = values[colIdx] !== undefined ? values[colIdx] : '';
            });
            rows.push(rowObj);
        }

        return parseEmployeeTypeSheet(rows);
    }
    /**
     * Parses an official SheetJS workbook object by inspecting sheet names
     */
    function parseEmployeeTypeWorkbook(workbook, XLSX_LIB) {
        const xlsx = (XLSX_LIB && typeof XLSX_LIB === 'object' && XLSX_LIB.utils)
            ? XLSX_LIB
            : (typeof window !== 'undefined' ? window.XLSX : null)
            || (typeof globalThis !== 'undefined' ? globalThis.XLSX : null)
            || (typeof require === 'function' ? (function() {
                try { return require('../utils/xlsx.full.min.js'); } catch (_) {}
                try { return require('./utils/xlsx.full.min.js'); } catch (_) {}
                try { return require('xlsx'); } catch (_) {}
                return null;
            })() : null);
        if (!workbook || !workbook.SheetNames) {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                errors: ['Invalid Workbook object provided.'],
                warnings: [],
                records: [],
                firestoreDocs: []
            };
        }

        // Strictly prioritize 'Employee Type' / 'Employee_Type' sheet from Templates.xlsx
        let targetSheetName = workbook.SheetNames.find(name => {
            const norm = name.trim().toLowerCase().replace(/[\s_-]+/g, '');
            return norm === 'employeetype' || norm === 'employeetypes';
        });

        // If not matched by name, check if single sheet or look for employee type headers
        if (!targetSheetName && xlsx) {
            for (const name of workbook.SheetNames) {
                const sheet = workbook.Sheets[name];
                if (!sheet) continue;
                const probeRows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                if (probeRows && probeRows.length > 0) {
                    const headerRow = (probeRows[0] || []).map(h => String(h || '').trim().toLowerCase().replace(/[\s_-]+/g, ''));
                    if (headerRow.includes('categorycode') && headerRow.includes('categoryname')) {
                        targetSheetName = name;
                        break;
                    }
                }
            }
        }

        // Secondary fallback
        if (!targetSheetName) {
            targetSheetName = workbook.SheetNames.find(name => {
                const norm = name.trim().toLowerCase().replace(/[\s_-]+/g, '');
                return ['employmenttype', 'employmenttypes', 'categories', 'workertype'].includes(norm);
            });
        }

        if (!targetSheetName) {
            return {
                valid: false,
                sheetFound: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                errors: [`Sheet 'Employee Type' not found in uploaded workbook. Available sheets: ${workbook.SheetNames.join(', ')}`],
                warnings: [],
                records: [],
                firestoreDocs: []
            };
        }

        const sheet = workbook.Sheets[targetSheetName];
        if (!xlsx) {
            throw new Error('SheetJS XLSX library is required to convert sheet to JSON.');
        }

        const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
        const result = parseEmployeeTypeSheet(rows);
        result.sheetName = targetSheetName;
        result.sheetFound = true;
        return result;
    }

    return {
        DEFAULT_EMPLOYEE_TYPES,
        HEADER_SYNONYMS,
        normalizeKey,
        extractFieldValue,
        parseNumeric,
        parseBoolean,
        normalizeEmploymentType,
        normalizeWorkerType,
        parseEmployeeTypeRow,
        parseEmployeeTypeSheet,
        parseEmployeeTypeCsv,
        parseEmployeeTypeWorkbook
    };
}));
