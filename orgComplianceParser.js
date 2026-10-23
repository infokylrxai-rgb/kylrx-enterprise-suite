/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - UNIFIED ORGANIZATION COMPLIANCE REGISTRATIONS PARSER
 * ============================================================================
 * 
 * Unified Template 3 Parser matching PRD Sections 1, 4, 11, & 13:
 * Ingests, validates, deduplicates, and normalizes Corporate Statutory Registrations
 * from Excel (.xlsx/.xls) or CSV files.
 * 
 * Exact 11 Header Fields:
 * 1.  Organization_ID (string, tenant primary key)
 * 2.  Legal_Entity_Name (string)
 * 3.  EPFO_Establishment_Code (string, e.g., "KN/BNG/0012345/000")
 * 4.  ESIC_Employer_Code (string, 17-digit code)
 * 5.  State_PT_Registrations (JSON string or delimiter-separated list, e.g., "KA:PTRC12345|MH:PTRC67890")
 * 6.  State_LWF_Registrations (JSON string or delimiter-separated list, e.g., "KA:LWF/KA/2026/01|MH:LWF/MH/2026/02")
 * 7.  NPS_Corporate_Head_Office_ID (string, CHO registration code)
 * 8.  NPS_POP_SP_Registration_No (string)
 * 9.  Authorized_Signatory_PAN (string, 10-character PAN regex)
 * 10. Effective_From (ISO Date: YYYY-MM-DD)
 * 11. Active (boolean)
 * 
 * @version 2.0.0
 * @author Principal Full-Stack & Statutory Compliance Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['xlsx'], factory);
    } else if (typeof module === 'object' && module.exports) {
        let xlsxModule;
        try {
            xlsxModule = require('xlsx');
        } catch (e) {
            xlsxModule = null;
        }
        module.exports = factory(xlsxModule);
    } else {
        root.KylrxOrgComplianceParser = factory(root.XLSX);
        root.orgComplianceParser = root.KylrxOrgComplianceParser;
    }
}(typeof self !== 'undefined' ? self : this, function (XLSX) {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        organizationId: [
            'organization_id', 'organizationid', 'org_id', 'orgid', 'tenant_id', 'tenantid', 'company_id', 'org'
        ],
        legalEntityName: [
            'legal_entity_name', 'legalentityname', 'legal_name', 'legalname', 'company_name', 'entity_name', 'name'
        ],
        epfoEstablishmentCode: [
            'epfo_establishment_code', 'epfoestablishmentcode', 'epfo_code', 'epfocode', 'pf_establishment_code',
            'pf_code', 'establishment_code', 'pf_registration_number', 'epfo_reg_no'
        ],
        esicEmployerCode: [
            'esic_employer_code', 'esicemployercode', 'esic_code', 'esiccode', 'esi_code', 'esic_reg_no',
            'esic_registration_number', 'employer_code'
        ],
        statePtRegistrations: [
            'state_pt_registrations', 'stateptregistrations', 'pt_registrations', 'ptregistrations', 'state_pt',
            'pt_states', 'ptrc_list', 'pt_numbers', 'pt_reg_list'
        ],
        stateLwfRegistrations: [
            'state_lwf_registrations', 'statelwfregistrations', 'lwf_registrations', 'lwfregistrations', 'state_lwf',
            'lwf_states', 'lwf_list', 'lwf_numbers', 'lwf_reg_list'
        ],
        npsChoId: [
            'nps_corporate_head_office_id', 'nps_cho_id', 'npscorporateheadofficeid', 'cho_id', 'nps_cho',
            'cho_registration_code', 'nps_head_office_id'
        ],
        npsPopSpRegNo: [
            'nps_pop_sp_registration_no', 'nps_pop_sp_reg_no', 'npspopspregistrationno', 'pop_sp_reg_no',
            'pop_sp_no', 'pop_sp_code', 'nps_pop_sp'
        ],
        authorizedSignatoryPan: [
            'authorized_signatory_pan', 'authorizedsignatorypan', 'signatory_pan', 'auth_signatory_pan',
            'director_pan', 'auth_pan', 'signatory_pan_no'
        ],
        effectiveFrom: [
            'effective_from', 'effectivefrom', 'effective_date', 'effectivedate', 'start_date', 'valid_from', 'date'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'is_enabled'
        ]
    };

    /**
     * Exact 11 Attributes Schema Definition matching PRD Sections 1, 4, 11, & 13
     */
    const ORG_COMPLIANCE_ATTRIBUTES = [
        { key: "Organization_ID", label: "1. Organization ID", required: true, synonyms: HEADER_SYNONYMS.organizationId },
        { key: "Legal_Entity_Name", label: "2. Legal Entity Name", required: true, synonyms: HEADER_SYNONYMS.legalEntityName },
        { key: "EPFO_Establishment_Code", label: "3. EPFO Establishment Code", required: true, synonyms: HEADER_SYNONYMS.epfoEstablishmentCode },
        { key: "ESIC_Employer_Code", label: "4. ESIC Employer Code (17 digits)", required: true, synonyms: HEADER_SYNONYMS.esicEmployerCode },
        { key: "State_PT_Registrations", label: "5. State PT Registrations (PTRC)", required: false, synonyms: HEADER_SYNONYMS.statePtRegistrations },
        { key: "State_LWF_Registrations", label: "6. State LWF Registrations", required: false, synonyms: HEADER_SYNONYMS.stateLwfRegistrations },
        { key: "NPS_Corporate_Head_Office_ID", label: "7. NPS Corporate Head Office ID (CHO)", required: false, synonyms: HEADER_SYNONYMS.npsChoId },
        { key: "NPS_POP_SP_Registration_No", label: "8. NPS POP-SP Registration No", required: false, synonyms: HEADER_SYNONYMS.npsPopSpRegNo },
        { key: "Authorized_Signatory_PAN", label: "9. Authorized Signatory PAN", required: true, synonyms: HEADER_SYNONYMS.authorizedSignatoryPan },
        { key: "Effective_From", label: "10. Effective From (YYYY-MM-DD)", required: true, defaultValue: "2026-01-01", synonyms: HEADER_SYNONYMS.effectiveFrom },
        { key: "Active", label: "11. Active (Yes/No)", required: false, defaultValue: true, synonyms: HEADER_SYNONYMS.active }
    ];

    /**
     * Sanitizes boolean string / numeric representations
     */
    function sanitizeBoolean(val, defaultVal = true) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val === 1;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', 't', '1', 'active', 'applicable', 'enabled'].includes(s)) return true;
        if (['no', 'n', 'false', 'f', '0', 'inactive', 'not applicable', 'disabled'].includes(s)) return false;
        return defaultVal;
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
        if (!isNaN(Number(s)) && Number(s) > 20000 && Number(s) < 80000) {
            const date = new Date((Number(s) - (25567 + 2)) * 86400 * 1000);
            return date.toISOString().split('T')[0];
        }
        return s;
    }

    /**
     * Validates PAN Number: 10-character alphanumeric
     * Regex: ^[A-Z]{5}[0-9]{4}[A-Z]{1}$
     */
    function validatePan(pan) {
        if (!pan) return false;
        const clean = String(pan).trim().toUpperCase();
        return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(clean);
    }

    /**
     * Validates ESIC Employer Code: 17 digits
     */
    function validateEsicEmployerCode(code) {
        if (!code) return false;
        const clean = String(code).trim();
        return /^\d{17}$/.test(clean);
    }

    /**
     * Validates EPFO Establishment Code
     * Standard Indian EPFO format: 22 alphanumeric characters or regional pattern (e.g. KN/BNG/0012345/000 or KDMUC0012345000)
     */
    function validateEpfoCode(code) {
        if (!code) return false;
        const clean = String(code).trim();
        // Accepts either slash-separated or continuous establishment format (between 7 and 25 chars)
        return /^[A-Z0-9/_-]{7,25}$/i.test(clean);
    }

    /**
     * Parses State-keyed registration pairs (e.g. "KA:PTRC12345|MH:PTRC67890" or JSON array)
     * Returns normalized map: { KA: "PTRC12345", MH: "PTRC67890" } and array of entries.
     */
    function parseStateRegistrations(rawInput) {
        if (!rawInput) return { map: {}, list: [], rawString: '' };
        
        // If already an object/array
        if (typeof rawInput === 'object') {
            if (Array.isArray(rawInput)) {
                const map = {};
                const list = [];
                rawInput.forEach(item => {
                    const state = String(item.state || item.stateCode || '').trim().toUpperCase();
                    const regNo = String(item.regNo || item.registrationNumber || item.ptrc || item.lwf || item.code || '').trim();
                    if (state && regNo) {
                        map[state] = regNo;
                        list.push({ state, regNo });
                    }
                });
                return { map, list, rawString: list.map(i => `${i.state}:${i.regNo}`).join('|') };
            } else {
                const map = {};
                const list = [];
                Object.entries(rawInput).forEach(([state, regNo]) => {
                    const s = String(state).trim().toUpperCase();
                    const r = String(regNo).trim();
                    if (s && r) {
                        map[s] = r;
                        list.push({ state: s, regNo: r });
                    }
                });
                return { map, list, rawString: list.map(i => `${i.state}:${i.regNo}`).join('|') };
            }
        }

        const str = String(rawInput).trim();
        if (!str) return { map: {}, list: [], rawString: '' };

        // Attempt JSON parse
        if (str.startsWith('{') || str.startsWith('[')) {
            try {
                const parsed = JSON.parse(str);
                return parseStateRegistrations(parsed);
            } catch (e) {
                // Fallback to delimiter parser
            }
        }

        // Delimiter parse (pipe '|', semicolon ';', or comma ',')
        const entries = str.split(/[|;,]+/).map(e => e.trim()).filter(Boolean);
        const map = {};
        const list = [];

        entries.forEach(entry => {
            const sepIdx = entry.indexOf(':') !== -1 ? entry.indexOf(':') : entry.indexOf('=');
            if (sepIdx !== -1) {
                const state = entry.slice(0, sepIdx).trim().toUpperCase();
                const regNo = entry.slice(sepIdx + 1).trim();
                if (state && regNo) {
                    map[state] = regNo;
                    list.push({ state, regNo });
                }
            } else if (entry.includes('-')) {
                const parts = entry.split('-');
                const state = parts[0].trim().toUpperCase();
                const regNo = parts.slice(1).join('-').trim();
                if (state && regNo) {
                    map[state] = regNo;
                    list.push({ state, regNo });
                }
            } else {
                // Single code without state prefix -> assign to DEFAULT/ALL
                map['ALL'] = entry;
                list.push({ state: 'ALL', regNo: entry });
            }
        });

        const normalizedRawString = list.map(i => `${i.state}:${i.regNo}`).join('|');
        return { map, list, rawString: normalizedRawString || str };
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

        // Pass 1: Case-insensitive match on fieldKey
        for (const key of rowKeys) {
            if (key.trim().toLowerCase() === fieldKey.toLowerCase()) {
                if (row[key] !== undefined && row[key] !== '') return row[key];
            }
        }

        // Pass 2: Canonical synonym match
        for (const syn of synonyms) {
            const normSyn = syn.toLowerCase().replace(/[\s\-_()]+/g, '_');
            for (const key of rowKeys) {
                const normalizedKey = key.trim().toLowerCase().replace(/[\s\-_()]+/g, '_');
                if (normalizedKey === normSyn) {
                    if (row[key] !== undefined && row[key] !== '') return row[key];
                }
            }
        }

        // Pass 3: Fuzzy boundary match
        for (const syn of synonyms) {
            if (syn.length < 4) continue;
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
     * Validates and normalizes a single raw row object
     */
    function validateRow(rawRow, index = 0, defaultOrgId = 'ORG_KYLRX_CORP') {
        const errors = [];
        const warnings = [];

        // 1. Organization_ID
        let orgId = findField(rawRow, 'organizationId');
        if (!orgId || String(orgId).trim() === '') {
            orgId = defaultOrgId;
        } else {
            orgId = String(orgId).trim();
        }

        // 2. Legal_Entity_Name
        let legalEntityNameRaw = findField(rawRow, 'legalEntityName');
        let legalEntityName = '';
        if (legalEntityNameRaw === undefined || legalEntityNameRaw === null || String(legalEntityNameRaw).trim() === '') {
            errors.push('Legal_Entity_Name is required.');
        } else {
            legalEntityName = String(legalEntityNameRaw).trim();
        }

        // 3. EPFO_Establishment_Code
        let epfoCodeRaw = findField(rawRow, 'epfoEstablishmentCode');
        let epfoEstablishmentCode = '';
        if (epfoCodeRaw === undefined || epfoCodeRaw === null || String(epfoCodeRaw).trim() === '') {
            errors.push('EPFO_Establishment_Code is required.');
        } else {
            epfoEstablishmentCode = String(epfoCodeRaw).trim().toUpperCase();
            if (!validateEpfoCode(epfoEstablishmentCode)) {
                warnings.push(`EPFO_Establishment_Code "${epfoEstablishmentCode}" has non-standard format; standard format is e.g. "KN/BNG/0012345/000".`);
            }
        }

        // 4. ESIC_Employer_Code
        let esicCodeRaw = findField(rawRow, 'esicEmployerCode');
        let esicEmployerCode = '';
        if (esicCodeRaw === undefined || esicCodeRaw === null || String(esicCodeRaw).trim() === '') {
            errors.push('ESIC_Employer_Code is required.');
        } else {
            esicEmployerCode = String(esicCodeRaw).trim();
            if (!validateEsicEmployerCode(esicEmployerCode)) {
                errors.push(`ESIC_Employer_Code must be exactly 17 numeric digits. Received: "${esicEmployerCode}".`);
            }
        }

        // 5. State_PT_Registrations
        let ptRaw = findField(rawRow, 'statePtRegistrations');
        const ptParsed = parseStateRegistrations(ptRaw);

        // 6. State_LWF_Registrations
        let lwfRaw = findField(rawRow, 'stateLwfRegistrations');
        const lwfParsed = parseStateRegistrations(lwfRaw);

        // 7. NPS_Corporate_Head_Office_ID
        let npsChoRaw = findField(rawRow, 'npsChoId');
        let npsChoId = npsChoRaw ? String(npsChoRaw).trim().toUpperCase() : '';

        // 8. NPS_POP_SP_Registration_No
        let npsPopSpRaw = findField(rawRow, 'npsPopSpRegNo');
        let npsPopSpRegNo = npsPopSpRaw ? String(npsPopSpRaw).trim().toUpperCase() : '';

        // 9. Authorized_Signatory_PAN
        let signatoryPanRaw = findField(rawRow, 'authorizedSignatoryPan');
        let authorizedSignatoryPan = '';
        if (signatoryPanRaw === undefined || signatoryPanRaw === null || String(signatoryPanRaw).trim() === '') {
            errors.push('Authorized_Signatory_PAN is required.');
        } else {
            authorizedSignatoryPan = String(signatoryPanRaw).trim().toUpperCase();
            if (!validatePan(authorizedSignatoryPan)) {
                errors.push(`Authorized_Signatory_PAN is invalid: "${authorizedSignatoryPan}". Must match 10-character alphanumeric regex ^[A-Z]{5}[0-9]{4}[A-Z]{1}$.`);
            }
        }

        // 10. Effective_From
        let effectiveFromRaw = findField(rawRow, 'effectiveFrom');
        let effectiveFrom = formatDate(effectiveFromRaw);
        if (!effectiveFromRaw || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
            warnings.push('Effective_From was invalid or missing; defaulted to 2026-01-01.');
            effectiveFrom = '2026-01-01';
        }

        // 11. Active
        let activeRaw = findField(rawRow, 'active');
        let active = sanitizeBoolean(activeRaw, true);

        const normalizedRecord = {
            rowIndex: index + 1,
            Organization_ID: orgId,
            Legal_Entity_Name: legalEntityName,
            EPFO_Establishment_Code: epfoEstablishmentCode,
            ESIC_Employer_Code: esicEmployerCode,
            State_PT_Registrations: ptParsed.rawString,
            State_PT_Map: ptParsed.map,
            State_PT_List: ptParsed.list,
            State_LWF_Registrations: lwfParsed.rawString,
            State_LWF_Map: lwfParsed.map,
            State_LWF_List: lwfParsed.list,
            NPS_Corporate_Head_Office_ID: npsChoId,
            NPS_POP_SP_Registration_No: npsPopSpRegNo,
            Authorized_Signatory_PAN: authorizedSignatoryPan,
            Effective_From: effectiveFrom,
            Active: active,
            isValid: errors.length === 0,
            errors,
            warnings
        };

        return normalizedRecord;
    }

    /**
     * Parses array of raw row objects
     */
    function parseArray(rawRows, options = {}) {
        const defaultOrgId = options.defaultOrgId || options.orgId || 'ORG_KYLRX_CORP';
        if (!Array.isArray(rawRows)) {
            return {
                success: false,
                count: 0,
                validRows: [],
                invalidRows: [],
                data: [],
                errors: ['Input data is not a valid array of row records.'],
                warnings: []
            };
        }

        const validRows = [];
        const invalidRows = [];
        const allRecords = [];
        const seenOrgIds = new Set();

        rawRows.forEach((raw, idx) => {
            const values = Object.values(raw).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (values.length === 0) return;

            const record = validateRow(raw, idx, defaultOrgId);

            if (record.Organization_ID) {
                if (seenOrgIds.has(record.Organization_ID)) {
                    record.warnings.push(`Duplicate Organization_ID "${record.Organization_ID}" in batch; will overwrite previous configuration.`);
                }
                seenOrgIds.add(record.Organization_ID);
            }

            allRecords.push(record);
            if (record.isValid) {
                validRows.push(record);
            } else {
                invalidRows.push(record);
            }
        });

        return {
            success: invalidRows.length === 0 && validRows.length > 0,
            count: allRecords.length,
            validCount: validRows.length,
            invalidCount: invalidRows.length,
            validRows,
            invalidRows,
            data: allRecords,
            errors: invalidRows.flatMap(r => r.errors.map(err => `Row ${r.rowIndex} (${r.Organization_ID || 'No Org ID'}): ${err}`)),
            warnings: allRecords.flatMap(r => r.warnings.map(w => `Row ${r.rowIndex} (${r.Organization_ID || 'No Org ID'}): ${w}`))
        };
    }

    /**
     * Parses workbook / binary / text file data
     */
    function parse(fileData, options = {}) {
        let sheetJs = options.xlsx || XLSX;
        if (!sheetJs && typeof window !== 'undefined' && window.XLSX) {
            sheetJs = window.XLSX;
        }

        if (!sheetJs) {
            throw new Error("SheetJS (XLSX) library is required to parse spreadsheet files.");
        }

        let workbook;
        try {
            if (typeof fileData === 'string') {
                workbook = sheetJs.read(fileData, { type: 'string', cellDates: true });
            } else if (fileData instanceof ArrayBuffer || ArrayBuffer.isView(fileData)) {
                workbook = sheetJs.read(fileData, { type: 'array', cellDates: true });
            } else {
                workbook = sheetJs.read(fileData, { type: 'binary', cellDates: true });
            }
        } catch (err) {
            return {
                success: false,
                count: 0,
                validRows: [],
                invalidRows: [],
                data: [],
                errors: [`Failed to parse spreadsheet file: ${err.message}`],
                warnings: []
            };
        }

        let targetSheetName = workbook.SheetNames[0];
        const preferredSheets = [
            'Organization Compliance', 'Compliance Master', 'Compliance Registrations',
            'Organization Registrations', 'Statutory Registrations', 'Statuatory Compliance', 'Statutory Compliance'
        ];
        for (const name of preferredSheets) {
            const match = workbook.SheetNames.find(s => s.trim().toLowerCase() === name.toLowerCase());
            if (match) {
                targetSheetName = match;
                break;
            }
        }

        const sheet = workbook.Sheets[targetSheetName];
        if (!sheet) {
            return {
                success: false,
                count: 0,
                validRows: [],
                invalidRows: [],
                data: [],
                errors: [`Sheet "${targetSheetName}" not found in workbook.`],
                warnings: []
            };
        }

        const rawRows = sheetJs.utils.sheet_to_json(sheet, { defval: '', raw: false });
        const result = parseArray(rawRows, options);
        result.sheetName = targetSheetName;
        result.sheetNames = workbook.SheetNames;
        return result;
    }

    /**
     * Generates a sample CSV template
     */
    function generateTemplateCSV() {
        const headers = ORG_COMPLIANCE_ATTRIBUTES.map(a => a.key).join(',');
        const sampleRows = [
            'ORG_KYLRX_CORP,Kylrx Technologies Private Limited,KN/BNG/0012345/000,53000123456780001,"KA:PTRC12345|MH:PTRC67890","KA:LWF/KA/2026/01|MH:LWF/MH/2026/02",CHO1098765,POP987654321,AAACK1234F,2026-01-01,Yes'
        ];
        return [headers, ...sampleRows].join('\n');
    }

    /**
     * Generates downloadable Excel Template using SheetJS
     */
    function generateTemplateWorkbook(options = {}) {
        let sheetJs = options.xlsx || XLSX;
        if (!sheetJs && typeof window !== 'undefined' && window.XLSX) {
            sheetJs = window.XLSX;
        }
        if (!sheetJs) throw new Error("SheetJS is required to generate Excel workbook.");

        const headers = ORG_COMPLIANCE_ATTRIBUTES.map(a => a.key);
        const data = [
            headers,
            ['ORG_KYLRX_CORP', 'Kylrx Technologies Private Limited', 'KN/BNG/0012345/000', '53000123456780001', 'KA:PTRC12345|MH:PTRC67890', 'KA:LWF/KA/2026/01|MH:LWF/MH/2026/02', 'CHO1098765', 'POP987654321', 'AAACK1234F', '2026-01-01', 'Yes']
        ];

        const ws = sheetJs.utils.aoa_to_sheet(data);
        const wb = sheetJs.utils.book_new();
        sheetJs.utils.book_append_sheet(wb, ws, "Organization Compliance");
        return wb;
    }

    return {
        ORG_COMPLIANCE_ATTRIBUTES,
        HEADER_SYNONYMS,
        parse,
        parseArray,
        validateRow,
        validatePan,
        validateEsicEmployerCode,
        validateEpfoCode,
        parseStateRegistrations,
        generateTemplateCSV,
        generateTemplateWorkbook
    };
}));
