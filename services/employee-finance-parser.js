/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - EMPLOYEE FINANCE & STATUTORY PARSER & VALIDATOR
 * ============================================================================
 * 
 * Ingests, validates, and normalizes Employee Finance & Statutory records from the
 * 'Employee Finance Deatils' / 'Employee Finance Details' sheet of Templates.xlsx
 * or CSV uploads matching PRD §§ 1, 4, & 13:
 * 
 * Exact 17 Attributes:
 * 1.  Employee_ID (string, foreign key referencing active employee in `employees` collection)
 * 2.  Account_Holder_Name (string, display title / beneficiary name)
 * 3.  Bank_Name (string, registered financial institution)
 * 4.  Branch_Name (string, banking branch location)
 * 5.  Account_Number (string, 9-18 digits, masked in standard UI)
 * 6.  IFSC (string, 11 alphanumeric characters, regex: ^[A-Z]{4}0[A-Z0-9]{6}$)
 * 7.  Account_Type (string: Savings, Salary, Current)
 * 8.  Is_Primary (boolean: true for "Yes", false for "No")
 * 9.  Effective_From (string / ISO Date: YYYY-MM-DD)
 * 10. UAN (boolean: true for "Yes", false for "No")
 * 11. UAN No (If Applicable) (string, 12 digits, mandatory if UAN is "Yes")
 * 12. ESIC (boolean: true for "Yes", false for "No")
 * 13. ESIC No (If Applicable) (string, 10-17 digits, mandatory if ESIC is "Yes")
 * 14. NPS (boolean: true for "Yes", false for "No")
 * 15. NPS No (If Applicable) (string, 12-digit PRAN, mandatory if NPS is "Yes")
 * 16. Gratuity (boolean: true for "Yes", false for "No")
 * 17. Gratuity No (If Applicable) (string, gratuity ID, mandatory if Gratuity is "Yes")
 * 
 * @version 1.0.0
 * @author Principal Full-Stack & Fintech Integration Engineer
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxEmployeeFinanceParser = factory();
        root.employeeFinanceParser = root.KylrxEmployeeFinanceParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        employeeId: [
            'employee_id', 'employeeid', 'emp_id', 'empid', 'emp id', 'employee no', 'staff_id'
        ],
        accountHolderName: [
            'account_holder_name', 'accountholdername', 'account_holder', 'accountholder',
            'holder_name', 'name', 'beneficiary_name', 'employee_name', 'emp_name'
        ],
        bankName: [
            'bank_name', 'bankname', 'bank', 'bank_title', 'institution'
        ],
        branchName: [
            'branch_name', 'branchname', 'branch', 'location', 'bank_branch'
        ],
        accountNumber: [
            'account_number', 'accountnumber', 'acc_number', 'accnumber', 'acc_no', 'accno',
            'bank_account_number', 'bank_account_no', 'account'
        ],
        ifsc: [
            'ifsc', 'ifsc_code', 'ifsccode', 'ifsc code', 'rtgs_ifsc', 'neft_ifsc'
        ],
        accountType: [
            'account_type', 'accounttype', 'type', 'acc_type', 'acctype'
        ],
        isPrimary: [
            'is_primary', 'isprimary', 'primary', 'primary_account', 'is_primary_account', 'default_account'
        ],
        effectiveFrom: [
            'effective_from', 'effectivefrom', 'effective_date', 'effectivedate', 'start_date', 'date'
        ],
        uan: [
            'uan', 'uan_applicable', 'uanapplicable', 'pf_uan', 'is_uan', 'uan_flag'
        ],
        uanNumber: [
            'uan no (if applicable)', 'uan_no_(if_applicable)', 'uan_no', 'uanno',
            'uan_number', 'uannumber', 'uan_id', 'universal_account_number'
        ],
        esic: [
            'esic', 'esic_applicable', 'esicapplicable', 'esi', 'esi_applicable', 'is_esic', 'esic_flag'
        ],
        esicNumber: [
            'esic no (if applicable)', 'esic_no_(if_applicable)', 'esic_no', 'esicno',
            'esic_number', 'esicnumber', 'esic_ip', 'esic_ip_number', 'insurance_person_no'
        ],
        nps: [
            'nps', 'nps_applicable', 'npsapplicable', 'pran_applicable', 'is_nps', 'nps_flag'
        ],
        npsNumber: [
            'nps no (if applicable)', 'nps_no_(if_applicable)', 'nps_no', 'npsno',
            'nps_number', 'npsnumber', 'pran', 'pran_no', 'pran_number'
        ],
        gratuity: [
            'gratuity', 'gratuity_applicable', 'gratuityapplicable', 'is_gratuity', 'gratuity_flag'
        ],
        gratuityNumber: [
            'gratuity no (if applicable)', 'gratuity_no_(if_applicable)', 'gratuity_no', 'gratuityno',
            'gratuity_number', 'gratuitynumber', 'gratuity_id', 'gratuityid'
        ]
    };

    /**
     * Exact 17 Attributes Schema Definition matching PRD Sections 1, 4 & 13
     */
    const EMPLOYEE_FINANCE_ATTRIBUTES = [
        { key: "Employee_ID", label: "1. Employee ID", required: true, synonyms: HEADER_SYNONYMS.employeeId },
        { key: "Account_Holder_Name", label: "2. Account Holder Name", required: true, synonyms: HEADER_SYNONYMS.accountHolderName },
        { key: "Bank_Name", label: "3. Bank Name", required: true, synonyms: HEADER_SYNONYMS.bankName },
        { key: "Branch_Name", label: "4. Branch Name", required: false, defaultValue: "Main Corporate Branch", synonyms: HEADER_SYNONYMS.branchName },
        { key: "Account_Number", label: "5. Account Number", required: true, synonyms: HEADER_SYNONYMS.accountNumber },
        { key: "IFSC", label: "6. IFSC", required: true, synonyms: HEADER_SYNONYMS.ifsc },
        { key: "Account_Type", label: "7. Account Type", required: false, defaultValue: "Salary", synonyms: HEADER_SYNONYMS.accountType },
        { key: "Is_Primary", label: "8. Is Primary", required: false, defaultValue: true, synonyms: HEADER_SYNONYMS.isPrimary },
        { key: "Effective_From", label: "9. Effective From", required: false, synonyms: HEADER_SYNONYMS.effectiveFrom },
        { key: "UAN", label: "10. UAN", required: false, defaultValue: false, synonyms: HEADER_SYNONYMS.uan },
        { key: "UAN No (If Applicable)", label: "11. UAN No (If Applicable)", required: false, synonyms: HEADER_SYNONYMS.uanNumber },
        { key: "ESIC", label: "12. ESIC", required: false, defaultValue: false, synonyms: HEADER_SYNONYMS.esic },
        { key: "ESIC No (If Applicable)", label: "13. ESIC No (If Applicable)", required: false, synonyms: HEADER_SYNONYMS.esicNumber },
        { key: "NPS", label: "14. NPS", required: false, defaultValue: false, synonyms: HEADER_SYNONYMS.nps },
        { key: "NPS No (If Applicable)", label: "15. NPS No (If Applicable)", required: false, synonyms: HEADER_SYNONYMS.npsNumber },
        { key: "Gratuity", label: "16. Gratuity", required: false, defaultValue: false, synonyms: HEADER_SYNONYMS.gratuity },
        { key: "Gratuity No (If Applicable)", label: "17. Gratuity No (If Applicable)", required: false, synonyms: HEADER_SYNONYMS.gratuityNumber }
    ];

    /**
     * Sanitizes boolean string / numeric representations into standard boolean
     */
    function sanitizeBoolean(val, defaultVal = false) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val === 1;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', 't', '1', 'active', 'applicable', 'enabled'].includes(s)) return true;
        if (['no', 'n', 'false', 'f', '0', 'inactive', 'not applicable', 'disabled', 'na', 'n/a'].includes(s)) return false;
        return defaultVal;
    }

    /**
     * Masks account number for standard UI views (e.g. ••••••••••7890)
     */
    function maskAccountNumber(accountNumber) {
        if (!accountNumber) return '—';
        const clean = String(accountNumber).trim();
        if (!clean) return '—';
        if (clean.length <= 4) return clean;
        const last4 = clean.slice(-4);
        const maskedPortion = '•'.repeat(clean.length - 4);
        return `${maskedPortion}${last4}`;
    }

    /**
     * Validates IFSC code: 11 alphanumeric characters, 5th character must be '0'
     */
    function validateIfsc(ifsc) {
        if (!ifsc) return false;
        const clean = String(ifsc).trim().toUpperCase();
        return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(clean);
    }

    /**
     * Validates Account Number: Digits only, 9 to 18 characters
     */
    function validateAccountNumber(acc) {
        if (!acc) return false;
        const clean = String(acc).trim();
        return /^\d{9,18}$/.test(clean);
    }

    /**
     * Normalizes Account Type to 'Salary', 'Savings', or 'Current'
     */
    function normalizeAccountType(type) {
        if (!type) return 'Salary';
        const clean = String(type).trim().toLowerCase();
        if (clean.includes('sal')) return 'Salary';
        if (clean.includes('sav')) return 'Savings';
        if (clean.includes('curr')) return 'Current';
        return 'Salary';
    }

    /**
     * Finds normalized field value from row using synonyms
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

        // Pass 3: Fuzzy boundary match if synonym is specific enough (>= 4 chars)
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
     * Parses raw rows into standardized 17-column records & Firestore documents
     */
    function parseEmployeeFinanceSheet(rows, options = {}) {
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

        const rawKnown = options.knownEmployeeIds || options.existingEmployeeIds;
        const knownEmployeeIds = rawKnown
            ? (Array.isArray(rawKnown) ? new Set(rawKnown) : rawKnown)
            : null;

        const records = [];
        const firestoreDocs = [];
        const errors = [];
        const seenEmpIds = new Set();

        rows.forEach((row, idx) => {
            const rowNumber = idx + 2; // Assuming 1-based index with header at row 1
            const rowErrors = [];

            // 1. Employee_ID
            const rawEmpId = findField(row, 'employeeId');
            const employeeId = rawEmpId ? String(rawEmpId).trim().toUpperCase() : '';
            if (!employeeId) {
                rowErrors.push(`Row ${rowNumber}: Missing mandatory 'Employee_ID'.`);
            } else {
                if (seenEmpIds.has(employeeId)) {
                    rowErrors.push(`Row ${rowNumber}: Duplicate Employee_ID "${employeeId}" in upload set.`);
                }
                seenEmpIds.add(employeeId);

                // Foreign key validation against known employee catalog
                if (knownEmployeeIds && knownEmployeeIds.size > 0 && !knownEmployeeIds.has(employeeId)) {
                    rowErrors.push(`Row ${rowNumber}: Foreign key validation failed - Employee_ID "${employeeId}" not found in active employees directory (Foreign Key Mismatch).`);
                }
            }

            // 2. Account_Holder_Name
            const rawHolder = findField(row, 'accountHolderName');
            const accountHolderName = rawHolder ? String(rawHolder).trim() : '';
            if (!accountHolderName) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Missing mandatory 'Account_Holder_Name'.`);
            }

            // 3. Bank_Name
            const rawBank = findField(row, 'bankName');
            const bankName = rawBank ? String(rawBank).trim() : '';
            if (!bankName) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Missing mandatory 'Bank_Name'.`);
            }

            // 4. Branch_Name
            const rawBranch = findField(row, 'branchName');
            const branchName = rawBranch ? String(rawBranch).trim() : 'Main Corporate Branch';

            // 5. Account_Number
            const rawAcc = findField(row, 'accountNumber');
            const accountNumber = rawAcc ? String(rawAcc).trim().replace(/\s+/g, '') : '';
            if (!accountNumber) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Missing mandatory 'Account_Number'.`);
            } else if (!validateAccountNumber(accountNumber)) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Invalid 'Account_Number' "${accountNumber}". Must be 9 to 18 digits.`);
            }

            // 6. IFSC
            const rawIfsc = findField(row, 'ifsc');
            const ifsc = rawIfsc ? String(rawIfsc).trim().toUpperCase().replace(/\s+/g, '') : '';
            if (!ifsc) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Missing mandatory 'IFSC'.`);
            } else if (!validateIfsc(ifsc)) {
                rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Invalid 'IFSC' code "${ifsc}". Must be 11 alphanumeric characters matching ^[A-Z]{4}0[A-Z0-9]{6}$.`);
            }

            // 7. Account_Type
            const rawType = findField(row, 'accountType');
            const accountType = normalizeAccountType(rawType);

            // 8. Is_Primary
            const rawPrimary = findField(row, 'isPrimary');
            const isPrimary = sanitizeBoolean(rawPrimary, true);

            // 9. Effective_From
            const rawEffective = findField(row, 'effectiveFrom');
            const effectiveFrom = formatDate(rawEffective);

            // 10. UAN Applicable
            const rawUan = findField(row, 'uan');
            const uanApplicable = sanitizeBoolean(rawUan, false);

            // 11. UAN No (If Applicable)
            const rawUanNo = findField(row, 'uanNumber');
            let uanNumber = rawUanNo ? String(rawUanNo).trim().replace(/\s+/g, '') : '';
            if (uanApplicable) {
                if (!uanNumber) {
                    rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): UAN is flagged as applicable ('Yes'), so 'UAN No (If Applicable)' is mandatory.`);
                } else if (!/^\d{12}$/.test(uanNumber)) {
                    rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Invalid UAN "${uanNumber}". Universal Account Number must be exactly 12 digits.`);
                }
            } else {
                uanNumber = null;
            }

            // 12. ESIC Applicable
            const rawEsic = findField(row, 'esic');
            const esicApplicable = sanitizeBoolean(rawEsic, false);

            // 13. ESIC No (If Applicable)
            const rawEsicNo = findField(row, 'esicNumber');
            let esicNumber = rawEsicNo ? String(rawEsicNo).trim().replace(/\s+/g, '') : '';
            if (esicApplicable) {
                if (!esicNumber) {
                    rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): ESIC is flagged as applicable ('Yes'), so 'ESIC No (If Applicable)' is mandatory.`);
                } else if (!/^\d{10,17}$/.test(esicNumber)) {
                    rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Invalid ESIC Number "${esicNumber}". Must be 10 to 17 digits.`);
                }
            } else {
                esicNumber = null;
            }

            // 14. NPS Applicable
            const rawNps = findField(row, 'nps');
            const npsApplicable = sanitizeBoolean(rawNps, false);

            // 15. NPS No (If Applicable)
            const rawNpsNo = findField(row, 'npsNumber');
            let npsNumber = rawNpsNo ? String(rawNpsNo).trim().replace(/\s+/g, '') : '';
            if (npsApplicable) {
                if (!npsNumber) {
                    rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): NPS is flagged as applicable ('Yes'), so 'NPS No (If Applicable)' is mandatory.`);
                } else if (!/^\d{12}$/.test(npsNumber)) {
                    rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Invalid NPS PRAN "${npsNumber}". Must be a 12-digit PRAN.`);
                }
            } else {
                npsNumber = null;
            }

            // 16. Gratuity Applicable
            const rawGratuity = findField(row, 'gratuity');
            const gratuityApplicable = sanitizeBoolean(rawGratuity, false);

            // 17. Gratuity No (If Applicable)
            const rawGratuityNo = findField(row, 'gratuityNumber');
            let gratuityNumber = rawGratuityNo ? String(rawGratuityNo).trim() : '';
            if (gratuityApplicable) {
                if (!gratuityNumber) {
                    rowErrors.push(`Row ${rowNumber} (${employeeId || 'Unknown'}): Gratuity is flagged as applicable ('Yes'), so Gratuity ID is mandatory.`);
                }
            } else {
                gratuityNumber = null;
            }

            // Generate Decentro Beneficiary Metadata
            const decentroBeneficiaryId = (ifsc && accountNumber)
                ? `ben_${ifsc.slice(0, 4).toLowerCase()}_${accountNumber.slice(-4)}`
                : null;

            const maskedAccountNumber = maskAccountNumber(accountNumber);

            // Canonical 17-column record for tabular representation
            const record = {
                Employee_ID: employeeId,
                Account_Holder_Name: accountHolderName,
                Bank_Name: bankName,
                Branch_Name: branchName,
                Account_Number: accountNumber,
                Masked_Account_Number: maskedAccountNumber,
                IFSC: ifsc,
                Account_Type: accountType,
                Is_Primary: isPrimary ? 'Yes' : 'No',
                Effective_From: effectiveFrom,
                UAN: uanApplicable ? 'Yes' : 'No',
                'UAN No (If Applicable)': uanNumber || '',
                ESIC: esicApplicable ? 'Yes' : 'No',
                'ESIC No (If Applicable)': esicNumber || '',
                NPS: npsApplicable ? 'Yes' : 'No',
                'NPS No (If Applicable)': npsNumber || '',
                Gratuity: gratuityApplicable ? 'Yes' : 'No',
                'Gratuity No (If Applicable)': gratuityNumber || '',
                _valid: rowErrors.length === 0,
                _errors: rowErrors
            };

            // Firestore Document Schema strictly adhering to PRD Sections 1, 4 & 13
            const firestoreDoc = {
                employeeId: employeeId,
                banking: {
                    accountHolderName: accountHolderName,
                    bankName: bankName,
                    branchName: branchName,
                    accountNumber: accountNumber,
                    maskedAccountNumber: maskedAccountNumber,
                    ifsc: ifsc,
                    accountType: accountType,
                    isPrimary: isPrimary,
                    effectiveFrom: effectiveFrom,
                    decentroBeneficiaryId: decentroBeneficiaryId,
                    verificationStatus: 'VERIFIED'
                },
                statutory: {
                    uanApplicable: uanApplicable,
                    uanNumber: uanNumber,
                    esicApplicable: esicApplicable,
                    esicNumber: esicNumber,
                    npsApplicable: npsApplicable,
                    npsNumber: npsNumber,
                    gratuityApplicable: gratuityApplicable,
                    gratuityNumber: gratuityNumber
                },
                updatedAt: new Date().toISOString(),
                updatedBy: options.updatedBy || 'admin_uid'
            };

            records.push(record);
            firestoreDocs.push(firestoreDoc);

            if (rowErrors.length > 0) {
                rowErrors.forEach(errStr => {
                    const errObj = new String(errStr);
                    errObj.message = errStr;
                    errObj.row = rowNumber;
                    errObj.employeeId = employeeId || 'Unknown';
                    errors.push(errObj);
                });
            }
        });

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
     * Resolves the authoritative Employee Finance sheet from a SheetJS workbook
     */
    function resolveFinanceSheetName(sheetNames = []) {
        // Priority 1: Exact matches
        const exactTargets = [
            'employee finance deatils', // Exact prompt typo
            'employee finance details',
            'employee_finance_details',
            'employee finance',
            'employee_finance',
            'employeefinance'
        ];

        for (const target of exactTargets) {
            const found = sheetNames.find(n => n.trim().toLowerCase() === target);
            if (found) return found;
        }

        // Priority 2: Fuzzy includes
        for (const name of sheetNames) {
            const lower = name.trim().toLowerCase();
            if (lower.includes('finance') || lower.includes('deatils')) {
                return name;
            }
        }

        // Priority 3: Fallback Bank_Accounts
        return sheetNames.find(n => n.trim().toLowerCase().includes('bank')) || null;
    }

    /**
     * Parses an uploaded SheetJS workbook for Employee Finance records
     */
    function parseEmployeeFinanceWorkbook(workbook, xlsxLib, options = {}) {
        const XLSX = (xlsxLib && typeof xlsxLib === 'object' && xlsxLib.utils)
            ? xlsxLib
            : (typeof window !== 'undefined' ? window.XLSX : null)
            || (typeof globalThis !== 'undefined' ? globalThis.XLSX : null)
            || (typeof require === 'function' ? (function() {
                try { return require('../utils/xlsx.full.min.js'); } catch (_) {}
                try { return require('./utils/xlsx.full.min.js'); } catch (_) {}
                try { return require('xlsx'); } catch (_) {}
                return null;
            })() : null);
        if (!XLSX) {
            throw new Error("SheetJS (XLSX) library is required to parse workbooks.");
        }

        const sheetNames = workbook.SheetNames || [];
        const targetSheetName = resolveFinanceSheetName(sheetNames);

        if (!targetSheetName) {
            return {
                valid: false,
                sheetName: null,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                records: [],
                firestoreDocs: [],
                errors: [`No 'Employee Finance Deatils' or 'Employee Finance Details' sheet found in workbook. Available sheets: [${sheetNames.join(', ')}]`]
            };
        }

        const worksheet = workbook.Sheets[targetSheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        const result = parseEmployeeFinanceSheet(rawRows, options);
        result.sheetName = targetSheetName;
        return result;
    }

    /**
     * Parses raw CSV text into Employee Finance records
     */
    function parseEmployeeFinanceCsv(csvText, options = {}) {
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

        // CSV line parser handling quotes
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

        return parseEmployeeFinanceSheet(rows, options);
    }

    /**
     * Validates a single employee finance record
     */
    function validateRecord(record, options = {}) {
        const res = parseEmployeeFinanceSheet([record], options);
        return {
            valid: res.valid,
            errors: res.errors.map(e => typeof e === 'object' && e.message ? e.message : String(e)),
            record: res.records[0] || null,
            firestoreDoc: res.firestoreDocs[0] || null
        };
    }

    function validatePan(pan) {
        if (!pan) return false;
        return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(String(pan).trim().toUpperCase());
    }

    function maskPan(pan) {
        if (!pan) return '';
        const clean = String(pan).trim().toUpperCase();
        if (clean.length === 10) {
            return clean.substring(0, 5) + '••••' + clean.substring(9);
        }
        return clean;
    }

    function validateUan(uan) {
        if (!uan) return false;
        return /^[0-9]{12}$/.test(String(uan).trim());
    }

    function validateEsic(esic) {
        if (!esic) return false;
        return /^[0-9]{10,17}$/.test(String(esic).trim());
    }

    function validatePran(pran) {
        if (!pran) return false;
        return /^[0-9]{12}$/.test(String(pran).trim());
    }

    function parseArray(rows = [], options = {}) {
        const validRows = [];
        const invalidRows = [];
        let pendingPennyDropCount = 0;

        for (const row of rows) {
            const errors = [];
            const accNum = String(row.Bank_Account_Number || row.accountNumber || row.Account_Number || '').trim();
            const ifsc = String(row.Bank_IFSC_Code || row.ifsc || row.IFSC || '').trim().toUpperCase();
            const pan = String(row.PAN_Number || row.pan || row.PAN || '').trim().toUpperCase();
            const uan = String(row.UAN || row.uanNumber || '').trim();
            const esic = String(row.ESIC_IP_Number || row.esic || row.esicNumber || '').trim();
            const pran = String(row.PRAN || row.pranNumber || row.npsNumber || '').trim();
            const verificationStatus = String(row.Verification_Status || row.verificationStatus || 'PENDING_VERIFICATION').trim();

            if (!validateIfsc(ifsc)) {
                errors.push("Invalid Bank_IFSC_Code format: " + ifsc);
            }
            if (pan && !validatePan(pan)) {
                errors.push("Invalid PAN_Number format: " + pan);
            }
            if (uan && !validateUan(uan)) {
                errors.push("Invalid UAN format: " + uan);
            }
            if (esic && !validateEsic(esic)) {
                errors.push("Invalid ESIC_IP_Number format: " + esic);
            }
            if (pran && !validatePran(pran)) {
                errors.push("Invalid PRAN format: " + pran);
            }

            const isPendingPennyDrop = verificationStatus === 'PENDING_VERIFICATION';
            if (isPendingPennyDrop) pendingPennyDropCount++;

            if (errors.length > 0) {
                invalidRows.push({
                    ...row,
                    errors
                });
            } else {
                validRows.push({
                    ...row,
                    Bank_IFSC_Code: ifsc,
                    PAN_Number: pan,
                    UAN: uan,
                    ESIC_IP_Number: esic,
                    PRAN: pran,
                    Requires_Penny_Drop: isPendingPennyDrop,
                    Masked_Account_Number: maskAccountNumber(accNum),
                    Masked_PAN: maskPan(pan)
                });
            }
        }

        return {
            success: invalidRows.length === 0,
            validCount: validRows.length,
            invalidCount: invalidRows.length,
            validRows,
            invalidRows,
            pendingPennyDropCount
        };
    }

    return {
        EMPLOYEE_FINANCE_ATTRIBUTES,
        parseEmployeeFinanceSheet,
        parseSheetRows: parseEmployeeFinanceSheet,
        parseEmployeeFinanceWorkbook,
        parseEmployeeFinanceCsv,
        resolveFinanceSheetName,
        maskAccountNumber,
        validateIfsc,
        validateIFSC: validateIfsc,
        validateAccountNumber,
        validateRecord,
        sanitizeBoolean,
        normalizeAccountType,
        formatDate,
        HEADER_SYNONYMS,
        parseArray,
        parse: parseArray,
        validatePan,
        maskPan,
        validateUan,
        validateEsic,
        validatePran
    };
}));
