/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - SALARY STRUCTURE PARSER & CALCULATION ENGINE
 * ============================================================================
 * 
 * Ingests, validates, and evaluates Employee Salary Structures from the
 * 'Salary Stcruture' / 'Salary Structure' sheet of Templates.xlsx or CSV uploads
 * matching PRD §§ 1 & 4:
 * 
 * Exact 9 Attributes:
 * 1. Employee_ID (string, foreign key referencing active employee in `employees` collection)
 * 2. Effective_From (string / ISO Date: YYYY-MM-DD)
 * 3. Pay_Frequency (string: e.g., "Monthly", "Bi-weekly", "Weekly")
 * 4. Salary_Structure_Code (string, grouped package template identifier)
 * 5. Component_Code (string, foreign key referencing Payroll Components)
 * 6. Amount (number | null, fixed numeric value if calculation is fixed)
 * 7. Percentage (number | null, rate applied to calculation basis)
 * 8. Calculation_Basis (string: e.g., "FLAT", "BASIC", "GROSS", "CTC")
 * 9. Active (boolean: true for "Yes", false for "No")
 * 
 * @version 1.0.0
 * @author Principal Full-Stack & Compensation Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxSalaryStructureParser = factory();
        root.salaryStructureParser = root.KylrxSalaryStructureParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        employeeId: [
            'employee_id', 'employeeid', 'emp_id', 'empid', 'emp id', 'employee no', 'staff_id'
        ],
        effectiveFrom: [
            'effective_from', 'effectivefrom', 'effective_date', 'effectivedate', 'start_date', 'date'
        ],
        payFrequency: [
            'pay_frequency', 'payfrequency', 'frequency', 'payout_frequency', 'periodicity', 'pay_cycle'
        ],
        salaryStructureCode: [
            'salary_structure_code', 'salarystructurecode', 'structure_code', 'structurecode',
            'salary_structure', 'salarystructure', 'package_code', 'packagecode', 'template_code'
        ],
        componentCode: [
            'component_code', 'componentcode', 'component', 'comp_code', 'compcode',
            'pay_component', 'salary_component', 'code'
        ],
        amount: [
            'amount', 'component_amount', 'fixed_amount', 'value', 'val', 'monthly_amount', 'component_val'
        ],
        percentage: [
            'percentage', 'pct', 'percent', 'rate', 'percentage_value', 'component_percentage'
        ],
        calculationBasis: [
            'calculation_basis', 'calculationbasis', 'calc_basis', 'calcbasis', 'basis',
            'formula_basis', 'reference_component', 'calculation_type'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'is_enabled'
        ]
    };

    /**
     * Exact 9 Attributes Schema Definition matching PRD Sections 1 & 4
     */
    const SALARY_STRUCTURE_ATTRIBUTES = [
        { key: "Employee_ID", label: "1. Employee ID", required: true, synonyms: HEADER_SYNONYMS.employeeId },
        { key: "Effective_From", label: "2. Effective From", required: true, defaultValue: "2026-01-01", synonyms: HEADER_SYNONYMS.effectiveFrom },
        { key: "Pay_Frequency", label: "3. Pay Frequency", required: false, defaultValue: "Monthly", synonyms: HEADER_SYNONYMS.payFrequency },
        { key: "Salary_Structure_Code", label: "4. Salary Structure Code", required: true, defaultValue: "STRUC_STANDARD", synonyms: HEADER_SYNONYMS.salaryStructureCode },
        { key: "Component_Code", label: "5. Component Code", required: true, synonyms: HEADER_SYNONYMS.componentCode },
        { key: "Amount", label: "6. Amount", required: false, synonyms: HEADER_SYNONYMS.amount },
        { key: "Percentage", label: "7. Percentage", required: false, synonyms: HEADER_SYNONYMS.percentage },
        { key: "Calculation_Basis", label: "8. Calculation Basis", required: true, defaultValue: "FLAT", synonyms: HEADER_SYNONYMS.calculationBasis },
        { key: "Active", label: "9. Active", required: false, defaultValue: true, synonyms: HEADER_SYNONYMS.active }
    ];

    /**
     * Standard Recognized Payroll Components catalog (Fallback reference)
     */
    const STANDARD_PAYROLL_COMPONENTS = new Set([
        'BASIC', 'HRA', 'SPECIAL_ALLOW', 'SPECIAL_ALLOWANCE', 'CONVEYANCE', 'MEDICAL',
        'VARIABLE_PAY', 'PERF_BONUS', 'LTA', 'COMMUNICATION', 'FOOD_ALLOWANCE',
        'PF_EE', 'PF_ER', 'ESIC_EE', 'ESIC_ER', 'PT', 'TDS', 'GRATUITY', 'NPS_EE', 'NPS_ER'
    ]);

    /**
     * Sanitizes boolean string / numeric representations
     */
    function sanitizeBoolean(val, defaultVal = true) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val === 1;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', 't', '1', 'active', 'enabled'].includes(s)) return true;
        if (['no', 'n', 'false', 'f', '0', 'inactive', 'disabled'].includes(s)) return false;
        return defaultVal;
    }

    /**
     * Parses numeric values safely, returning null if empty or non-numeric
     */
    function parseNumeric(val) {
        if (val === undefined || val === null || val === '') return null;
        if (typeof val === 'number') return isNaN(val) ? null : val;
        const clean = String(val).trim().replace(/,/g, '');
        if (clean === '') return null;
        const num = parseFloat(clean);
        return isNaN(num) ? null : num;
    }

    /**
     * Formats date string to YYYY-MM-DD
     */
    function formatDate(val) {
        if (!val) return new Date().toISOString().split('T')[0];
        if (val instanceof Date && !isNaN(val.getTime())) {
            const y = val.getFullYear();
            const m = String(val.getMonth() + 1).padStart(2, '0');
            const d = String(val.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(s)) {
            const parts = s.split(/[-/]/);
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        // Excel serial date number
        if (!isNaN(Number(s)) && Number(s) > 20000 && Number(s) < 80000) {
            const date = new Date((Number(s) - (25567 + 2)) * 86400 * 1000);
            return date.toISOString().split('T')[0];
        }
        const parsed = new Date(s);
        if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
        return new Date().toISOString().split('T')[0];
    }

    /**
     * Finds normalized field value from row using canonical synonyms
     */
    function findField(row, fieldKey) {
        if (!row || typeof row !== 'object') return undefined;
        const synonyms = HEADER_SYNONYMS[fieldKey] || [];

        // Exact property match
        if (row[fieldKey] !== undefined && row[fieldKey] !== '') return row[fieldKey];

        const rowKeys = Object.keys(row);

        // Pass 1: Exact case-insensitive match on fieldKey
        for (const key of rowKeys) {
            if (key.trim().toLowerCase() === fieldKey.toLowerCase()) {
                if (row[key] !== undefined && row[key] !== '') return row[key];
            }
        }

        // Pass 2: Exact match against canonical synonyms
        for (const syn of synonyms) {
            const normSyn = syn.toLowerCase().replace(/[\s\-_()]+/g, '_');
            for (const key of rowKeys) {
                const normalizedKey = key.trim().toLowerCase().replace(/[\s\-_()]+/g, '_');
                if (normalizedKey === normSyn) {
                    if (row[key] !== undefined && row[key] !== '') return row[key];
                }
            }
        }

        // Pass 3: Fuzzy match on specific synonyms
        for (const syn of synonyms) {
            if (syn.length < 5) continue;
            const normSyn = syn.toLowerCase().replace(/[\s\-_()]+/g, '_');
            for (const key of rowKeys) {
                const normalizedKey = key.trim().toLowerCase().replace(/[\s\-_()]+/g, '_');
                if (normalizedKey.startsWith(normSyn + '_') || normalizedKey.endsWith('_' + normSyn)) {
                    if (row[key] !== undefined && row[key] !== '') return row[key];
                }
            }
        }

        return undefined;
    }

    /**
     * Evaluates itemized components to compute resolved monthly amount, Gross Monthly, and Annual CTC
     * Strict PRD Section 4 Calculation Evaluation Engine:
     * - FLAT: resolves directly to amount
     * - Referenced component (e.g. BASIC): resolves as (percentage / 100) * referencedComponentAmount
     */
    function evaluateSalaryStructure(components = [], payFrequency = 'Monthly') {
        const resolvedValues = new Map();
        const evaluatedComponents = [];
        let grossMonthly = 0;

        // Pass 1: Resolve all FLAT calculation bases
        for (const comp of components) {
            const code = String(comp.componentCode || comp.Component_Code || '').trim().toUpperCase();
            const basis = String(comp.calculationBasis || comp.Calculation_Basis || 'FLAT').trim().toUpperCase();
            const rawAmt = parseNumeric(comp.amount !== undefined ? comp.amount : comp.Amount);
            const rawPct = parseNumeric(comp.percentage !== undefined ? comp.percentage : comp.Percentage);

            if (basis === 'FLAT' && rawAmt !== null) {
                resolvedValues.set(code, rawAmt);
                evaluatedComponents.push({
                    componentCode: code,
                    amount: rawAmt,
                    percentage: null,
                    calculationBasis: 'FLAT',
                    evaluatedAmount: rawAmt,
                    type: isDeduction(code) ? 'DEDUCTION' : 'EARNING'
                });
                if (!isDeduction(code)) {
                    grossMonthly += rawAmt;
                }
            }
        }

        // Pass 2: Resolve percentage-based components referencing resolved codes (e.g. HRA based on BASIC)
        for (const comp of components) {
            const code = String(comp.componentCode || comp.Component_Code || '').trim().toUpperCase();
            const basis = String(comp.calculationBasis || comp.Calculation_Basis || '').trim().toUpperCase();
            const rawAmt = parseNumeric(comp.amount !== undefined ? comp.amount : comp.Amount);
            const rawPct = parseNumeric(comp.percentage !== undefined ? comp.percentage : comp.Percentage);

            if (basis !== 'FLAT') {
                let computedAmount = 0;

                if (resolvedValues.has(basis) && rawPct !== null) {
                    const baseAmt = resolvedValues.get(basis);
                    computedAmount = Math.round(((rawPct / 100) * baseAmt) * 100) / 100;
                } else if (rawAmt !== null) {
                    computedAmount = rawAmt;
                } else if (rawPct !== null && basis === 'GROSS') {
                    // Temporary resolution against current accumulated earnings
                    computedAmount = Math.round(((rawPct / 100) * grossMonthly) * 100) / 100;
                }

                resolvedValues.set(code, computedAmount);
                evaluatedComponents.push({
                    componentCode: code,
                    amount: rawAmt,
                    percentage: rawPct,
                    calculationBasis: basis,
                    evaluatedAmount: computedAmount,
                    type: isDeduction(code) ? 'DEDUCTION' : 'EARNING'
                });

                if (!isDeduction(code)) {
                    grossMonthly += computedAmount;
                }
            }
        }

        // Pay Frequency Multiplier
        let annualMultiplier = 12;
        const normFreq = String(payFrequency || 'Monthly').toLowerCase();
        if (normFreq.includes('bi')) annualMultiplier = 26;
        else if (normFreq.includes('week')) annualMultiplier = 52;

        const annualCTC = Math.round((grossMonthly * annualMultiplier) * 100) / 100;

        return {
            evaluatedComponents,
            grossMonthly: Math.round(grossMonthly * 100) / 100,
            annualCTC: annualCTC,
            resolvedValues: Object.fromEntries(resolvedValues)
        };
    }

    /**
     * Determines whether a component code is a deduction
     */
    function isDeduction(code = '') {
        const upper = String(code).toUpperCase();
        return upper.includes('DEDUCT') || upper.startsWith('PF_') || upper.startsWith('ESIC_') ||
            upper === 'PT' || upper === 'TDS' || upper === 'LOP';
    }

    /**
     * Parses raw sheet rows into itemized 9-attribute records and grouped Firestore documents
     */
    function parseSalaryStructureSheet(rows, options = {}) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                records: [],
                firestoreDocs: [],
                errors: ["Input row array is empty or invalid."]
            };
        }

        const rawKnownEmp = options.knownEmployeeIds || options.existingEmployeeIds;
        const knownEmployeeIds = rawKnownEmp
            ? (Array.isArray(rawKnownEmp) ? new Set(rawKnownEmp) : rawKnownEmp)
            : null;

        const rawKnownComp = options.knownComponentCodes || options.existingComponentCodes || options.payrollComponents;
        const knownComponentCodes = rawKnownComp
            ? (Array.isArray(rawKnownComp) ? new Set(rawKnownComp.map(c => typeof c === 'string' ? c.toUpperCase() : (c.code || c.componentCode || '').toUpperCase())) : rawKnownComp)
            : null;

        const records = [];
        const errors = [];
        const groupedByEmpEffective = new Map(); // key: `${empId}__${effectiveFrom}`

        rows.forEach((row, idx) => {
            const rowNumber = idx + 2;
            const rowErrors = [];

            // 1. Employee_ID
            const rawEmpId = findField(row, 'employeeId');
            const employeeId = rawEmpId ? String(rawEmpId).trim().toUpperCase() : '';
            if (!employeeId) {
                rowErrors.push(`Row ${rowNumber}: Missing mandatory 'Employee_ID'.`);
            } else if (knownEmployeeIds && knownEmployeeIds.size > 0 && !knownEmployeeIds.has(employeeId)) {
                rowErrors.push(`Row ${rowNumber}: Foreign key validation failed - Employee_ID "${employeeId}" does not exist in active employees directory (not found).`);
            }

            // 2. Effective_From
            const rawEffective = findField(row, 'effectiveFrom');
            const effectiveFrom = formatDate(rawEffective);

            // 3. Pay_Frequency
            const rawFreq = findField(row, 'payFrequency');
            const payFrequency = String(rawFreq || 'Monthly').trim();

            // 4. Salary_Structure_Code
            const rawStrucCode = findField(row, 'salaryStructureCode');
            const salaryStructureCode = String(rawStrucCode || 'STRUC_DEFAULT').trim().toUpperCase().replace(/\s+/g, '_');
            if (!salaryStructureCode) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Missing mandatory 'Salary_Structure_Code'.`);
            }

            // 5. Component_Code
            const rawCompCode = findField(row, 'componentCode');
            const componentCode = String(rawCompCode || '').trim().toUpperCase().replace(/\s+/g, '_');
            if (!componentCode) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Missing mandatory 'Component_Code'.`);
            } else if (knownComponentCodes && knownComponentCodes.size > 0 && !knownComponentCodes.has(componentCode) && !STANDARD_PAYROLL_COMPONENTS.has(componentCode)) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Component_Code "${componentCode}" not found in active Payroll Components (does not match).`);
            }

            // 6. Amount
            const rawAmount = findField(row, 'amount');
            const amount = parseNumeric(rawAmount);

            // 7. Percentage
            const rawPct = findField(row, 'percentage');
            const percentage = parseNumeric(rawPct);

            // 8. Calculation_Basis
            const rawBasis = findField(row, 'calculationBasis');
            const calculationBasis = String(rawBasis || (percentage !== null ? 'BASIC' : 'FLAT')).trim().toUpperCase();
            const validBases = ['FLAT', 'BASIC', 'GROSS', 'CTC', 'SUBTOTAL'];
            if (!validBases.includes(calculationBasis) && (!knownComponentCodes || !knownComponentCodes.has(calculationBasis)) && !STANDARD_PAYROLL_COMPONENTS.has(calculationBasis)) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}, ${componentCode}): Invalid Calculation_Basis "${calculationBasis}". Allowed: FLAT, BASIC, GROSS, CTC, or valid component code.`);
            }

            // Numeric Validation: Either Amount or Percentage must be specified with a valid Calculation_Basis
            if (calculationBasis === 'FLAT' && amount === null) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}, ${componentCode}): When Calculation_Basis is FLAT, 'Amount' is mandatory.`);
            } else if (calculationBasis !== 'FLAT' && percentage === null) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}, ${componentCode}): When Calculation_Basis is '${calculationBasis}', requires a valid numeric Percentage.`);
            } else if (amount === null && percentage === null) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}, ${componentCode}): Numeric validation failed. Either 'Amount' or 'Percentage' must be specified.`);
            }

            // 9. Active
            const rawActive = findField(row, 'active');
            const isActive = sanitizeBoolean(rawActive, true);

            // Canonical 9-attribute record
            const itemizedRecord = {
                Employee_ID: employeeId,
                Effective_From: effectiveFrom,
                Pay_Frequency: payFrequency,
                Salary_Structure_Code: salaryStructureCode,
                Component_Code: componentCode,
                Amount: amount,
                Percentage: percentage,
                Calculation_Basis: calculationBasis,
                Active: isActive ? 'Yes' : 'No',
                _valid: rowErrors.length === 0,
                _errors: rowErrors
            };

            records.push(itemizedRecord);

            if (rowErrors.length > 0) {
                rowErrors.forEach(errStr => {
                    const errObj = new String(errStr);
                    errObj.message = errStr;
                    errObj.row = rowNumber;
                    errObj.employeeId = employeeId || 'Unknown';
                    errObj.componentCode = componentCode || 'Unknown';
                    errors.push(errObj);
                });
            } else if (employeeId) {
                // Group under (employeeId, effectiveFrom)
                const groupKey = `${employeeId}__${effectiveFrom}`;
                if (!groupedByEmpEffective.has(groupKey)) {
                    groupedByEmpEffective.set(groupKey, {
                        employeeId,
                        salaryStructureCode,
                        effectiveFrom,
                        payFrequency,
                        isActive,
                        rawComponents: []
                    });
                }
                const group = groupedByEmpEffective.get(groupKey);
                group.rawComponents.push({
                    componentCode,
                    amount,
                    percentage,
                    calculationBasis
                });
            }
        });

        // Build Structured Firestore Documents adhering to PRD Sections 1 & 4
        const firestoreDocs = [];
        for (const [groupKey, group] of groupedByEmpEffective.entries()) {
            const evaluated = evaluateSalaryStructure(group.rawComponents, group.payFrequency);

            const docId = `${group.employeeId}_v_${group.effectiveFrom}`;
            const firestoreDoc = {
                id: docId,
                employeeId: group.employeeId,
                salaryStructureCode: group.salaryStructureCode,
                effectiveFrom: group.effectiveFrom,
                payFrequency: group.payFrequency,
                isActive: group.isActive,
                components: group.rawComponents.map(c => ({
                    componentCode: c.componentCode,
                    amount: c.amount,
                    percentage: c.percentage,
                    calculationBasis: c.calculationBasis
                })),
                grossMonthly: evaluated.grossMonthly,
                annualCTC: evaluated.annualCTC,
                evaluatedComponents: evaluated.evaluatedComponents,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            firestoreDocs.push(firestoreDoc);
        }

        return {
            valid: errors.length === 0,
            totalRows: rows.length,
            validCount: records.filter(r => r._valid).length,
            errorCount: errors.length,
            records: records,
            firestoreDocs: firestoreDocs,
            errors: errors
        };
    }

    /**
     * Resolves the authoritative Salary Structure sheet name from a SheetJS workbook
     */
    function resolveSalaryStructureSheetName(sheetNames = []) {
        // Priority 1: Exact matches (including author prompt typo 'Salary Stcruture')
        const exactTargets = [
            'salary stcruture', // Exact prompt typo
            'salary structure',
            'salary_structure',
            'salarystructure',
            'salary structures',
            'salary_structures'
        ];

        for (const target of exactTargets) {
            const found = sheetNames.find(n => n.trim().toLowerCase() === target);
            if (found) return found;
        }

        // Priority 2: Fuzzy includes
        for (const name of sheetNames) {
            const lower = name.trim().toLowerCase();
            if ((lower.includes('salary') && lower.includes('struc')) || lower.includes('stcruture')) {
                return name;
            }
        }

        return null;
    }

    /**
     * Parses an uploaded SheetJS workbook for Salary Structure records
     */
    function parseSalaryStructureWorkbook(workbook, xlsxLib, options = {}) {
        let actualOptions = options;
        if (xlsxLib && typeof xlsxLib === 'object' && !xlsxLib.utils && !xlsxLib.readFile) {
            actualOptions = xlsxLib;
        }

        const XLSX = (xlsxLib && typeof xlsxLib === 'object' && xlsxLib.utils)
            ? xlsxLib
            : (typeof window !== 'undefined' ? window.XLSX : null)
                || (typeof require === 'function' ? (function() {
                    try { return require('../utils/xlsx.full.min.js'); } catch (_) {}
                    try { return require('./utils/xlsx.full.min.js'); } catch (_) {}
                    try { return require('xlsx'); } catch(_) { return null; }
                })() : null);

        if (!XLSX) {
            throw new Error("SheetJS (XLSX) library is required to parse workbooks.");
        }

        const sheetNames = workbook.SheetNames || [];
        const targetSheetName = resolveSalaryStructureSheetName(sheetNames);

        if (!targetSheetName) {
            return {
                valid: false,
                sheetName: null,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                records: [],
                firestoreDocs: [],
                errors: [`No 'Salary Stcruture' or 'Salary Structure' sheet found in workbook. Available sheets: [${sheetNames.join(', ')}]`]
            };
        }

        const worksheet = workbook.Sheets[targetSheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        const result = parseSalaryStructureSheet(rawRows, options);
        result.sheetName = targetSheetName;
        return result;
    }

    /**
     * Parses raw CSV text into Salary Structure records
     */
    function parseSalaryStructureCsv(csvText, options = {}) {
        if (!csvText || typeof csvText !== 'string') {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                records: [],
                firestoreDocs: [],
                errors: ["Invalid or empty CSV content."]
            };
        }

        const lines = csvText.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                records: [],
                firestoreDocs: [],
                errors: ["CSV must contain a header row and at least one data row."]
            };
        }

        function parseCsvLine(line) {
            const values = [];
            let inQuotes = false;
            let current = '';
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' || char === "'") {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    values.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            values.push(current.trim());
            return values;
        }

        const headers = parseCsvLine(lines[0]);
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const cells = parseCsvLine(lines[i]);
            const rowObj = {};
            headers.forEach((h, hIdx) => {
                rowObj[h] = cells[hIdx] !== undefined ? cells[hIdx] : '';
            });
            rows.push(rowObj);
        }

        return parseSalaryStructureSheet(rows, options);
    }

    /**
     * Validates a single salary structure component assignment row
     */
    function validateComponentRow(row, options = {}) {
        const res = parseSalaryStructureSheet([row], options);
        return {
            valid: res.valid,
            errors: res.errors.map(e => typeof e === 'object' && e.message ? e.message : String(e)),
            record: res.records[0] || null,
            firestoreDoc: res.firestoreDocs[0] || null
        };
    }

    return {
        SALARY_STRUCTURE_ATTRIBUTES,
        STANDARD_PAYROLL_COMPONENTS,
        HEADER_SYNONYMS,
        parseSalaryStructureSheet,
        parseSheetRows: parseSalaryStructureSheet,
        parseSalaryStructureWorkbook,
        parseSalaryStructureCsv,
        resolveSalaryStructureSheetName,
        evaluateSalaryStructure,
        validateComponentRow,
        sanitizeBoolean,
        parseNumeric,
        formatDate
    };
}));
