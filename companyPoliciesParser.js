/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - COMPANY POLICIES SHEETJS PARSER & VALIDATOR
 * ============================================================================
 * Conforms strictly to 'Company Policies' Sheet from Templates.xlsx and
 * PRD Sections 1, 10, 13, 17, & 18.
 *
 * All 11 Attributes:
 *  1. Policy_Code                 (string, unique PK / Firestore doc ID)
 *  2. Policy_Name                 (string, display title)
 *  3. Version                     (string, semantic version e.g. "1.0")
 *  4. Policy_Type                 (string enum: "Statutory", "Operational", "Code_of_Conduct", "IT_Security", "HR_Handbook")
 *  5. Effective_From              (string / ISO Date: YYYY-MM-DD)
 *  6. Acknowledgement_Required    (boolean: "Yes"/"No" -> boolean)
 *  7. Acknowledgement_Due_Days    (number, turnaround days allowed for sign-off)
 *  8. Applies_To_Category_Code    (string: e.g. "CAT_FT_REG" or "ALL")
 *  9. Applies_To_Location_Code    (string: e.g. "LOC_BLR_01" or "ALL")
 * 10. Document_URL_or_File_Name   (string, URL or Cloud Storage path to PDF asset)
 * 11. Active                      (boolean: "Yes"/"No" -> boolean)
 * ============================================================================
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxCompanyPoliciesParser = factory();
        root.companyPoliciesParser = root.KylrxCompanyPoliciesParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms Mapping
    const HEADER_SYNONYMS = {
        policyCode: [
            'policy_code', 'policycode', 'code', 'id', 'policy_id', 'policyid'
        ],
        policyName: [
            'policy_name', 'policyname', 'name', 'title', 'display_title', 'policy_title'
        ],
        version: [
            'version', 'policy_version', 'policyversion', 'ver', 'revision'
        ],
        policyType: [
            'policy_type', 'policytype', 'type', 'category', 'policy_category'
        ],
        effectiveFrom: [
            'effective_from', 'effectivefrom', 'effective_date', 'effectivedate', 'start_date'
        ],
        acknowledgementRequired: [
            'acknowledgement_required', 'acknowledgementrequired', 'acknowledgment_required',
            'ack_required', 'mandatory_signoff', 'mandatory', 'requires_ack'
        ],
        acknowledgementDueDays: [
            'acknowledgement_due_days', 'acknowledgementduedays', 'acknowledgment_due_days',
            'due_days', 'turnaround_days', 'sla_days', 'days_to_sign'
        ],
        appliesToCategoryCode: [
            'applies_to_category_code', 'appliestocategorycode', 'category_code', 'employment_category',
            'worker_type', 'target_category', 'applies_to_category'
        ],
        appliesToLocationCode: [
            'applies_to_location_code', 'appliestolocationcode', 'location_code', 'branch_code',
            'target_location', 'applies_to_location'
        ],
        documentUrl: [
            'document_url_or_file_name', 'documenturlorfilename', 'document_url', 'file_name',
            'pdf_url', 'url', 'storage_path', 'document_path', 'asset_url'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled'
        ]
    };

    // Allowed Policy_Type Enums
    const ALLOWED_POLICY_TYPES = [
        "Statutory",
        "Operational",
        "Code_of_Conduct",
        "IT_Security",
        "HR_Handbook"
    ];

    // Canonical Employee Category Codes (PRD §10 & Templates.xlsx)
    const DEFAULT_KNOWN_CATEGORIES = new Set([
        "ALL",
        "CAT_FT_REG",
        "CAT_FT_EXEC",
        "CAT_CON_TVC",
        "CAT_INT_GRAD",
        "CAT_TEMP_OPS",
        "FT",
        "CT",
        "IN"
    ]);

    // Canonical Location Codes (PRD §1 & Templates.xlsx)
    const DEFAULT_KNOWN_LOCATIONS = new Set([
        "ALL",
        "LOC-BLR",
        "LOC-MUM",
        "LOC_BLR_01",
        "LOC_BLR_CORP",
        "LOC_MUM_01",
        "LOC_HYD_01",
        "LOC_DEL_01",
        "LOC_PUN_01"
    ]);

    /**
     * Normalize key string for synonym matching
     */
    function normalizeHeaderKey(key) {
        if (!key) return '';
        return String(key)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_');
    }

    /**
     * Map raw row object using synonym dictionary
     */
    function mapRowToCanonical(rawRow) {
        const canonical = {};
        const keys = Object.keys(rawRow || {});

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
        if (['yes', 'true', '1', 'y', 'active', 'enabled', 'mandatory', 'required'].includes(s)) return true;
        if (['no', 'false', '0', 'n', 'inactive', 'disabled', 'optional'].includes(s)) return false;
        return defaultVal;
    }

    /**
     * Sanitize Policy_Type enum
     */
    function sanitizePolicyType(val) {
        if (!val || String(val).trim() === '') return { value: 'Operational', isValid: false, isMissing: true, raw: '' };
        const raw = String(val).trim();
        const str = raw.replace(/[\s-]+/g, '_');
        const found = ALLOWED_POLICY_TYPES.find(t => t.toLowerCase() === str.toLowerCase());
        if (found) return { value: found, isValid: true, raw };

        const low = str.toLowerCase();
        if (low.includes('statutory') || low.includes('legal') || low.includes('compliance')) {
            return { value: 'Statutory', isValid: true, raw };
        }
        if (low.includes('conduct') || low.includes('ethics') || low.includes('coc')) {
            return { value: 'Code_of_Conduct', isValid: true, raw };
        }
        if (low.includes('security') || low.includes('it') || low.includes('cyber')) {
            return { value: 'IT_Security', isValid: true, raw };
        }
        if (low.includes('handbook') || low.includes('hr') || low.includes('guide')) {
            return { value: 'HR_Handbook', isValid: true, raw };
        }
        if (low.includes('operational') || low.includes('sop') || low.includes('facility')) {
            return { value: 'Operational', isValid: true, raw };
        }

        return { value: raw, isValid: false, isMissing: false, raw };
    }

    /**
     * Normalize Date to YYYY-MM-DD
     */
    function normalizeIsoDate(val) {
        if (!val) return new Date().toISOString().substring(0, 10);
        if (typeof val === 'number') {
            // Excel serial date number
            const date = new Date((val - (25567 + 2)) * 86400 * 1000);
            if (!isNaN(date.getTime())) return date.toISOString().substring(0, 10);
        }
        const s = String(val).trim();
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            return d.toISOString().substring(0, 10);
        }
        // Match DD/MM/YYYY or DD-MM-YYYY
        const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (dmy) {
            const [, day, month, year] = dmy;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        return s;
    }

    /**
     * Validate an individual row record
     */
    function validatePolicyRecord(record, index, existingCodes, options = {}) {
        const errors = [];
        const warnings = [];

        // 1. Policy_Code: Mandatory & Unique PK
        if (!record.policyCode || String(record.policyCode).trim() === '') {
            errors.push(`Row ${index + 1}: Missing mandatory Policy_Code.`);
        } else {
            const code = record.policyCode;
            if (existingCodes.has(code)) {
                errors.push(`Row ${index + 1}: Duplicate Policy_Code "${code}". Primary key must be unique.`);
            }
        }

        // 2. Policy_Name: Mandatory
        if (!record.policyName || String(record.policyName).trim() === '') {
            errors.push(`Row ${index + 1} (${record.policyCode || 'Unknown'}): Missing mandatory Policy_Name.`);
        }

        // 3. Version: Mandatory
        if (!record.version || String(record.version).trim() === '') {
            warnings.push(`Row ${index + 1} (${record.policyCode}): Version was missing. Defaulted to "1.0".`);
        }

        // 4. Policy_Type: Enum check
        if (record.isPolicyTypeInvalid) {
            errors.push(`Row ${index + 1} (${record.policyCode}): Invalid Policy_Type "${record.rawPolicyType}". Allowed types: ${ALLOWED_POLICY_TYPES.join(', ')}.`);
        }

        // 5. Acknowledgement_Due_Days: Must be positive integer
        if (record.acknowledgementRequired) {
            const dueDays = record.acknowledgementDueDays;
            if (dueDays === null || dueDays === undefined || isNaN(dueDays) || dueDays <= 0 || !Number.isInteger(dueDays)) {
                errors.push(`Row ${index + 1} (${record.policyCode}): Acknowledgement_Due_Days must be a positive integer (> 0). Received: "${record.rawAcknowledgementDueDays}".`);
            }
        }

        // 6. Foreign Key: Applies_To_Category_Code
        const targetCat = record.appliesToCategoryCode;
        if (targetCat && targetCat.toUpperCase() !== 'ALL') {
            const knownCats = options.knownCategories instanceof Set ? options.knownCategories : DEFAULT_KNOWN_CATEGORIES;
            if (!knownCats.has(targetCat.toUpperCase()) && !knownCats.has(targetCat)) {
                errors.push(`Row ${index + 1} (${record.policyCode}): Invalid Applies_To_Category_Code "${targetCat}". Foreign key must exist in 'employee_types' or be "ALL".`);
            }
        }

        // 7. Foreign Key: Applies_To_Location_Code
        const targetLoc = record.appliesToLocationCode;
        if (targetLoc && targetLoc.toUpperCase() !== 'ALL') {
            const knownLocs = options.knownLocations instanceof Set ? options.knownLocations : DEFAULT_KNOWN_LOCATIONS;
            if (!knownLocs.has(targetLoc.toUpperCase()) && !knownLocs.has(targetLoc)) {
                errors.push(`Row ${index + 1} (${record.policyCode}): Invalid Applies_To_Location_Code "${targetLoc}". Foreign key must exist in 'locations' or be "ALL".`);
            }
        }

        // 8. Document URL or File Name warning
        if (!record.documentUrl || String(record.documentUrl).trim() === '') {
            warnings.push(`Row ${index + 1} (${record.policyCode}): Document_URL_or_File_Name is missing. Users will not have a downloadable PDF asset.`);
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
    function parseCompanyPoliciesSheet(rawRows, options = {}) {
        if (!Array.isArray(rawRows) || rawRows.length === 0) {
            return {
                success: false,
                totalRows: 0,
                validRowsCount: 0,
                invalidRowsCount: 0,
                records: [],
                firestoreDocs: [],
                errors: ['No data rows found in Company Policies sheet.'],
                warnings: [],
                metadata: {
                    totalPolicies: 0,
                    mandatoryAcknowledgementCount: 0,
                    statutoryCount: 0,
                    activeCount: 0
                }
            };
        }

        const orgId = options.orgId || 'org_kylrx_default';
        const records = [];
        const firestoreDocs = [];
        const globalErrors = [];
        const globalWarnings = [];
        const seenCodes = new Set();

        // Custom known categories / locations sets if provided in options
        let knownCategories = DEFAULT_KNOWN_CATEGORIES;
        if (Array.isArray(options.employeeTypes) || Array.isArray(options.knownCategories)) {
            const arr = options.employeeTypes || options.knownCategories;
            knownCategories = new Set(arr.map(c => typeof c === 'string' ? c.toUpperCase() : (c.categoryCode || c.Category_Code || c.typeCode || c.Type_Code || '').toUpperCase()));
            knownCategories.add('ALL');
        }

        let knownLocations = DEFAULT_KNOWN_LOCATIONS;
        if (Array.isArray(options.locations) || Array.isArray(options.knownLocations)) {
            const arr = options.locations || options.knownLocations;
            knownLocations = new Set(arr.map(l => typeof l === 'string' ? l.toUpperCase() : (l.locationCode || l.Location_Code || '').toUpperCase()));
            knownLocations.add('ALL');
        }

        rawRows.forEach((row, idx) => {
            const canonical = mapRowToCanonical(row);

            // Skip completely empty rows
            const hasData = Object.values(canonical).some(v => v !== undefined && v !== null && String(v).trim() !== '');
            if (!hasData) return;

            const policyCode = String(canonical.policyCode || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
            const policyName = String(canonical.policyName || '').trim();
            const version = String(canonical.version || '1.0').trim();

            const typeInfo = sanitizePolicyType(canonical.policyType);
            const policyType = typeInfo.value;

            const effectiveFrom = normalizeIsoDate(canonical.effectiveFrom);
            const acknowledgementRequired = parseBoolean(canonical.acknowledgementRequired, true);

            const rawDueDays = canonical.acknowledgementDueDays;
            let acknowledgementDueDays = 14;
            if (rawDueDays !== undefined && rawDueDays !== null && rawDueDays !== '') {
                const parsedDays = parseInt(String(rawDueDays).replace(/[^0-9-]/g, ''), 10);
                acknowledgementDueDays = !isNaN(parsedDays) ? parsedDays : 14;
            }

            const appliesToCategoryCode = String(canonical.appliesToCategoryCode || 'ALL').trim().toUpperCase();
            const appliesToLocationCode = String(canonical.appliesToLocationCode || 'ALL').trim().toUpperCase();
            const documentUrl = String(canonical.documentUrl || '').trim();
            const isActive = parseBoolean(canonical.active, true);

            const record = {
                id: policyCode,
                policyCode,
                policyName,
                version,
                policyType,
                rawPolicyType: typeInfo.raw,
                isPolicyTypeInvalid: !typeInfo.isValid,
                effectiveFrom,
                acknowledgementRequired,
                acknowledgementDueDays,
                rawAcknowledgementDueDays: rawDueDays,
                appliesToCategoryCode,
                appliesToLocationCode,
                documentUrl,
                isActive,
                rawRowIndex: idx + 1
            };

            const valRes = validatePolicyRecord(record, idx, seenCodes, { knownCategories, knownLocations });
            if (!valRes.isValid) {
                globalErrors.push(...valRes.errors);
            }
            if (valRes.warnings.length > 0) {
                globalWarnings.push(...valRes.warnings);
            }

            seenCodes.add(policyCode);

            // Tabular UI Preview Record
            records.push({
                Policy_Code: policyCode,
                Policy_Name: policyName,
                Version: version,
                Policy_Type: policyType,
                Effective_From: effectiveFrom,
                Acknowledgement_Required: acknowledgementRequired ? 'Yes' : 'No',
                Acknowledgement_Due_Days: acknowledgementDueDays,
                Applies_To_Category_Code: appliesToCategoryCode,
                Applies_To_Location_Code: appliesToLocationCode,
                Document_URL_or_File_Name: documentUrl,
                Active: isActive ? 'Yes' : 'No'
            });

            // Cloud Firestore Document Payload: organizations/{orgId}/policies/{policyCode}
            firestoreDocs.push({
                collectionPath: `organizations/${orgId}/policies`,
                docId: policyCode,
                data: {
                    policyCode,
                    policyName,
                    version,
                    policyType,
                    effectiveFrom,
                    acknowledgementRequired,
                    acknowledgementDueDays,
                    appliesToCategoryCode,
                    appliesToLocationCode,
                    documentUrl,
                    isActive,
                    createdAt: 'serverTimestamp()',
                    updatedAt: 'serverTimestamp()'
                }
            });
        });

        const mandatoryAcknowledgementCount = records.filter(r => r.Acknowledgement_Required === 'Yes').length;
        const statutoryCount = records.filter(r => r.Policy_Type === 'Statutory').length;
        const activeCount = records.filter(r => r.Active === 'Yes').length;

        return {
            success: globalErrors.length === 0,
            totalRows: rawRows.length,
            validRowsCount: records.length,
            invalidRowsCount: globalErrors.length,
            records,
            firestoreDocs,
            errors: globalErrors,
            warnings: globalWarnings,
            metadata: {
                totalPolicies: records.length,
                mandatoryAcknowledgementCount,
                statutoryCount,
                activeCount
            }
        };
    }

    return {
        ALLOWED_POLICY_TYPES,
        DEFAULT_KNOWN_CATEGORIES,
        DEFAULT_KNOWN_LOCATIONS,
        mapRowToCanonical,
        parseBoolean,
        sanitizePolicyType,
        normalizeIsoDate,
        validatePolicyRecord,
        parseCompanyPoliciesSheet,
        parseCompanyPolicies: parseCompanyPoliciesSheet
    };
}));
