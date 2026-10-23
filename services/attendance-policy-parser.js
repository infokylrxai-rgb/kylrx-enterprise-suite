/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ATTENDANCE RULES & POLICIES PARSER & VALIDATOR
 * ============================================================================
 * 
 * Ingests, validates, and normalizes Attendance Policy rules from the
 * 'Attendance Rules' sheet of Templates.xlsx or CSV uploads matching PRD §§ 1, 15, & 16:
 * 
 * Exact 13 Attributes:
 * 1.  Attendance_Policy_Code (string, unique PK / Firestore doc ID, e.g. POL_STD_CORP)
 * 2.  Policy_Name (string, display title)
 * 3.  Late_After_Minutes (number, grace minutes before flagging late)
 * 4.  Early_Leaving_Grace_Minute (number, grace minutes before shift end)
 * 5.  Absent_After_Hours (number, cutoff hours past start before auto-marking absent)
 * 6.  Regularization_Allowed (boolean: true for "Yes", false for "No")
 * 7.  Regularization_Window_Days (number, max days allowed to file a regularization)
 * 8.  WFH_Allowed (boolean: true for "Yes", false for "No")
 * 9.  OT_Minimum_Minutes (number, minimum duration in minutes to trigger overtime eligibility)
 * 10. OT_Approval_Required (boolean: true for "Yes", false for "No")
 * 11. GeoFence_Required (boolean: true for "Yes", false for "No")
 * 12. IP_Restricted (boolean: true for "Yes", false for "No")
 * 13. Active (boolean: true for "Yes", false for "No")
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
        root.KylrxAttendancePolicyParser = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Default Enterprise Attendance Policies (PRD Sections 1, 15, & 16)
    const DEFAULT_ATTENDANCE_POLICIES = [
        {
            attendancePolicyCode: 'POL_STD_CORP',
            policyName: 'Standard Corporate Policy',
            lateAfterMinutes: 15,
            earlyLeavingGraceMinute: 10,
            absentAfterHours: 4,
            regularizationAllowed: true,
            regularizationWindowDays: 7,
            wfhAllowed: true,
            otMinimumMinutes: 60,
            otApprovalRequired: true,
            geoFenceRequired: false,
            ipRestricted: false,
            isActive: true
        },
        {
            attendancePolicyCode: 'POL_FACTORY_OPS',
            policyName: 'Manufacturing & Plant Operations',
            lateAfterMinutes: 5,
            earlyLeavingGraceMinute: 5,
            absentAfterHours: 2,
            regularizationAllowed: true,
            regularizationWindowDays: 3,
            wfhAllowed: false,
            otMinimumMinutes: 30,
            otApprovalRequired: true,
            geoFenceRequired: true,
            ipRestricted: true,
            isActive: true
        },
        {
            attendancePolicyCode: 'POL_TECH_FLEX',
            policyName: 'Engineering & R&D Flex Policy',
            lateAfterMinutes: 30,
            earlyLeavingGraceMinute: 15,
            absentAfterHours: 5,
            regularizationAllowed: true,
            regularizationWindowDays: 14,
            wfhAllowed: true,
            otMinimumMinutes: 60,
            otApprovalRequired: false,
            geoFenceRequired: false,
            ipRestricted: false,
            isActive: true
        },
        {
            attendancePolicyCode: 'POL_SECURE_HQ',
            policyName: 'Corporate Security & Finance Strict',
            lateAfterMinutes: 10,
            earlyLeavingGraceMinute: 5,
            absentAfterHours: 3,
            regularizationAllowed: true,
            regularizationWindowDays: 5,
            wfhAllowed: false,
            otMinimumMinutes: 60,
            otApprovalRequired: true,
            geoFenceRequired: true,
            ipRestricted: true,
            isActive: true
        }
    ];

    // Canonical header synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        attendancePolicyCode: [
            'attendance_policy_code', 'attendancepolicycode', 'policy_code', 'policycode', 'code', 'id'
        ],
        policyName: [
            'policy_name', 'policyname', 'name', 'title', 'policy_title'
        ],
        lateAfterMinutes: [
            'late_after_minutes', 'lateafterminutes', 'late_after', 'late_grace_minutes', 'late_minutes'
        ],
        earlyLeavingGraceMinute: [
            'early_leaving_grace_minute', 'earlyleavinggraceminute', 'early_leaving_grace_minutes', 'early_grace_minutes', 'early_leaving_grace'
        ],
        absentAfterHours: [
            'absent_after_hours', 'absentafterhours', 'absent_after', 'absent_cutoff_hours', 'absent_hours'
        ],
        regularizationAllowed: [
            'regularization_allowed', 'regularizationallowed', 'allow_regularization', 'is_regularization_allowed'
        ],
        regularizationWindowDays: [
            'regularization_window_days', 'regularizationwindowdays', 'regularization_window', 'regularization_days', 'window_days'
        ],
        wfhAllowed: [
            'wfh_allowed', 'wfhallowed', 'allow_wfh', 'work_from_home_allowed', 'is_wfh_allowed'
        ],
        otMinimumMinutes: [
            'ot_minimum_minutes', 'otminimumminutes', 'ot_min_minutes', 'min_ot_minutes', 'overtime_minimum_minutes'
        ],
        otApprovalRequired: [
            'ot_approval_required', 'otapprovalrequired', 'overtime_approval_required', 'require_ot_approval'
        ],
        geoFenceRequired: [
            'geofence_required', 'geofencerequired', 'geo_fence_required', 'geo_fencing', 'require_geofence'
        ],
        ipRestricted: [
            'ip_restricted', 'iprestricted', 'is_ip_restricted', 'ip_restriction', 'restrict_ip'
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
     * Parses numeric duration/count with fallback, stripping non-numeric suffixes (e.g. 'mins', 'days', 'hrs')
     */
    function parseNumeric(val, defaultVal = 0, isFloat = false) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'number') return isNaN(val) ? defaultVal : (isFloat ? val : Math.round(val));
        const str = String(val).trim();
        const match = str.match(/^-?(\d+(\.\d+)?)/);
        if (!match) return defaultVal;
        const num = isFloat ? parseFloat(match[1]) : Math.round(parseFloat(match[1]));
        if (isNaN(num) || num < 0) return defaultVal;
        return num;
    }

    /**
     * Normalizes Yes/No boolean strings, numbers, or native booleans
     */
    function parseBoolean(val, defaultVal = false) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const str = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', '1', 'active', 'enabled'].includes(str)) return true;
        if (['no', 'n', 'false', '0', 'inactive', 'disabled'].includes(str)) return false;
        return defaultVal;
    }

    /**
     * Parses a single row into the strict 13 attributes and Firestore document structure
     */
    function parseAttendancePolicyRow(row, idx = 0, seenCodes = new Set()) {
        const errors = [];
        const warnings = [];

        const rawCode = extractFieldValue(row, HEADER_SYNONYMS.attendancePolicyCode);
        const rawName = extractFieldValue(row, HEADER_SYNONYMS.policyName);
        const rawLateAfter = extractFieldValue(row, HEADER_SYNONYMS.lateAfterMinutes);
        const rawEarlyGrace = extractFieldValue(row, HEADER_SYNONYMS.earlyLeavingGraceMinute);
        const rawAbsentHours = extractFieldValue(row, HEADER_SYNONYMS.absentAfterHours);
        const rawRegularizationAllowed = extractFieldValue(row, HEADER_SYNONYMS.regularizationAllowed);
        const rawRegularizationWindow = extractFieldValue(row, HEADER_SYNONYMS.regularizationWindowDays);
        const rawWfhAllowed = extractFieldValue(row, HEADER_SYNONYMS.wfhAllowed);
        const rawOtMin = extractFieldValue(row, HEADER_SYNONYMS.otMinimumMinutes);
        const rawOtApproval = extractFieldValue(row, HEADER_SYNONYMS.otApprovalRequired);
        const rawGeoFence = extractFieldValue(row, HEADER_SYNONYMS.geoFenceRequired);
        const rawIpRestricted = extractFieldValue(row, HEADER_SYNONYMS.ipRestricted);
        const rawActive = extractFieldValue(row, HEADER_SYNONYMS.active);

        // 1. Attendance Policy Code (PK)
        if (!rawCode) {
            errors.push(`Row ${idx + 1}: Missing mandatory 'Attendance_Policy_Code' attribute.`);
        }

        // 2. Policy Name
        if (!rawName) {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Policy_Name'.`);
        }

        const attendancePolicyCode = rawCode ? String(rawCode).trim().toUpperCase().replace(/\s+/g, '_') : '';
        const policyName = rawName ? String(rawName).trim() : '';

        // Check duplicates
        if (attendancePolicyCode) {
            if (seenCodes.has(attendancePolicyCode)) {
                errors.push(`Row ${idx + 1}: Duplicate Attendance Policy Code "${attendancePolicyCode}" detected.`);
            } else {
                seenCodes.add(attendancePolicyCode);
            }
        }

        // Numeric fields
        const lateAfterMinutes = parseNumeric(rawLateAfter, 15);
        const earlyLeavingGraceMinute = parseNumeric(rawEarlyGrace, 10);
        const absentAfterHours = parseNumeric(rawAbsentHours, 4, true);
        const regularizationWindowDays = parseNumeric(rawRegularizationWindow, 7);
        const otMinimumMinutes = parseNumeric(rawOtMin, 60);

        // Booleans
        const regularizationAllowed = parseBoolean(rawRegularizationAllowed, true);
        const wfhAllowed = parseBoolean(rawWfhAllowed, true);
        const otApprovalRequired = parseBoolean(rawOtApproval, true);
        const geoFenceRequired = parseBoolean(rawGeoFence, false);
        const ipRestricted = parseBoolean(rawIpRestricted, false);
        const isActive = parseBoolean(rawActive, true);

        // Logical warnings
        if (absentAfterHours <= 0) {
            warnings.push(`Row ${idx + 1}: Absent_After_Hours should be at least 1 hour.`);
        }

        const record = {
            'Attendance_Policy_Code': attendancePolicyCode,
            'Policy_Name': policyName,
            'Late_After_Minutes': lateAfterMinutes,
            'Early_Leaving_Grace_Minute': earlyLeavingGraceMinute,
            'Absent_After_Hours': absentAfterHours,
            'Regularization_Allowed': regularizationAllowed ? 'Yes' : 'No',
            'Regularization_Window_Days': regularizationWindowDays,
            'WFH_Allowed': wfhAllowed ? 'Yes' : 'No',
            'OT_Minimum_Minutes': otMinimumMinutes,
            'OT_Approval_Required': otApprovalRequired ? 'Yes' : 'No',
            'GeoFence_Required': geoFenceRequired ? 'Yes' : 'No',
            'IP_Restricted': ipRestricted ? 'Yes' : 'No',
            'Active': isActive ? 'Yes' : 'No',

            // Canonical attributes
            attendancePolicyCode,
            policyName,
            lateAfterMinutes,
            earlyLeavingGraceMinute,
            absentAfterHours,
            regularizationAllowed,
            regularizationWindowDays,
            wfhAllowed,
            otMinimumMinutes,
            otApprovalRequired,
            geoFenceRequired,
            ipRestricted,
            isActive
        };

        const firestoreDoc = {
            attendancePolicyCode,
            policyName,
            lateAfterMinutes,
            earlyLeavingGraceMinute,
            absentAfterHours,
            regularizationAllowed,
            regularizationWindowDays,
            wfhAllowed,
            otMinimumMinutes,
            otApprovalRequired,
            geoFenceRequired,
            ipRestricted,
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
     * Parses an array of raw row objects
     */
    function parseAttendancePolicyRows(rows, options = {}) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                success: false,
                valid: false,
                totalRows: 0,
                validCount: 0,
                errorCount: 1,
                errors: ['No data rows found to parse.'],
                warnings: [],
                validRecords: [],
                firestoreDocs: [],
                records: []
            };
        }

        const seenCodes = new Set();
        const validRecords = [];
        const firestoreDocs = [];
        const allErrors = [];
        const allWarnings = [];

        rows.forEach((row, idx) => {
            const vals = Object.values(row).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (vals.length === 0) return; // skip empty rows

            const res = parseAttendancePolicyRow(row, idx, seenCodes);
            if (res.valid) {
                validRecords.push(res.record);
                firestoreDocs.push(res.firestoreDoc);
            } else {
                allErrors.push(...res.errors);
            }
            if (res.warnings.length > 0) {
                allWarnings.push(...res.warnings);
            }
        });

        return {
            success: allErrors.length === 0,
            valid: allErrors.length === 0,
            totalRows: rows.length,
            validCount: validRecords.length,
            errorCount: allErrors.length,
            errors: allErrors,
            warnings: allWarnings,
            validRecords,
            firestoreDocs,
            records: validRecords
        };
    }

    /**
     * Dedicated 'Attendance Rules' sheet parser
     */
    function parseAttendancePolicySheet(rows) {
        const res = parseAttendancePolicyRows(rows);
        return {
            valid: res.valid,
            data: res.validRecords,
            firestoreDocs: res.firestoreDocs,
            errors: res.errors,
            warnings: res.warnings
        };
    }

    /**
     * Parses Attendance Rules sheet from SheetJS workbook or binary buffer
     */
    async function parseAttendancePolicyWorkbook(workbookOrBuffer, options = {}) {
        let XLSX;
        if (typeof window !== 'undefined' && window.XLSX) {
            XLSX = window.XLSX;
        } else {
            const xlsxMod = await import('../utils/xlsx.full.min.js').catch(() => null) ||
                            (typeof require === 'function' ? require('../utils/xlsx.full.min.js') : null);
            XLSX = xlsxMod.default || xlsxMod;
        }

        let workbook = workbookOrBuffer;
        if (Buffer.isBuffer(workbookOrBuffer) || workbookOrBuffer instanceof ArrayBuffer || workbookOrBuffer instanceof Uint8Array) {
            workbook = XLSX.read(workbookOrBuffer, { type: 'buffer' });
        }

        const targetSheetName = workbook.SheetNames.find(s => {
            const norm = normalizeKey(s);
            return (
                norm === 'attendancerules' ||
                norm === 'attendancepolicies' ||
                norm === 'attendancepolicy' ||
                norm === 'attendance_rules' ||
                norm === 'attendance_policies' ||
                norm === 'attendance'
            );
        });

        if (!targetSheetName) {
            throw new Error("Could not find 'Attendance Rules' or 'Attendance_Policies' sheet in workbook.");
        }

        const sheet = workbook.Sheets[targetSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        return parseAttendancePolicyRows(rows, options);
    }

    /**
     * Parses CSV text for Attendance Rules
     */
    function parseAttendancePolicyCsv(csvText, options = {}) {
        if (!csvText || typeof csvText !== 'string') {
            return {
                success: false,
                valid: false,
                errors: ['Empty CSV content.'],
                validRecords: [],
                firestoreDocs: []
            };
        }

        const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            return {
                success: false,
                valid: false,
                errors: ['CSV must contain a header row and at least one data row.'],
                validRecords: [],
                firestoreDocs: []
            };
        }

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const rowObj = {};
            headers.forEach((h, hIdx) => {
                rowObj[h] = values[hIdx] !== undefined ? values[hIdx] : '';
            });
            rows.push(rowObj);
        }

        return parseAttendancePolicyRows(rows, options);
    }

    return {
        DEFAULT_ATTENDANCE_POLICIES,
        HEADER_SYNONYMS,
        extractFieldValue,
        parseNumeric,
        parseBoolean,
        parseAttendancePolicyRow,
        parseAttendancePolicyRows,
        parseAttendancePolicySheet,
        parseAttendancePolicyWorkbook,
        parseAttendancePolicyCsv
    };
}));
