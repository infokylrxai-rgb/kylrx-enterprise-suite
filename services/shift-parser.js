/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - SHIFTS & WEEK-OFFS PARSER & VALIDATOR
 * ============================================================================
 * 
 * Ingests, validates, and normalizes Shift and Week-off policies from the
 * 'Shifts & Week-offs' sheet of Templates.xlsx or CSV uploads:
 * 
 * Exact 13 Attributes:
 * 1.  Shift_Code (string, unique PK / Firestore doc ID, e.g. SH_GEN_01)
 * 2.  Shift_Name (string, display title)
 * 3.  Start_Time (string, HH:mm format, e.g. 09:30)
 * 4.  End_Time (string, HH:mm format, e.g. 18:30)
 * 5.  Break_Minutes (number, total break duration in minutes)
 * 6.  Grace_In_Minutes (number, arrival grace tolerance)
 * 7.  Grace_Out_Minutes (number, departure grace tolerance)
 * 8.  Half_Day_Minutes (number, minimum duration required for half day)
 * 9.  Full_Day_Minutes (number, minimum duration required for full day)
 * 10. Night_Shift (boolean: true for "Yes", false for "No")
 * 11. Overtime_Eligible (boolean: true for "Yes", false for "No")
 * 12. Weekly_Off_Pattern (string: e.g. "Sun", "Sat,Sun", "2nd_4th_Sat,Sun")
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
        root.KylrxShiftParser = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Default Enterprise Shifts (PRD Sections 1, 13, & 16)
    const DEFAULT_SHIFTS = [
        {
            shiftCode: 'SH_GEN_01',
            shiftName: 'General Corporate Shift',
            startTime: '09:30',
            endTime: '18:30',
            breakMinutes: 60,
            graceInMinutes: 15,
            graceOutMinutes: 15,
            halfDayMinutes: 240,
            fullDayMinutes: 480,
            isNightShift: false,
            nightShift: false,
            isOvertimeEligible: true,
            overtimeEligible: true,
            weeklyOffPattern: 'Sun',
            isActive: true,
            active: true
        },
        {
            shiftCode: 'SHIFT-GEN',
            shiftName: 'Standard Day Shift',
            startTime: '09:00',
            endTime: '18:00',
            breakMinutes: 60,
            graceInMinutes: 15,
            graceOutMinutes: 15,
            halfDayMinutes: 240,
            fullDayMinutes: 480,
            isNightShift: false,
            nightShift: false,
            isOvertimeEligible: true,
            overtimeEligible: true,
            weeklyOffPattern: 'Sat,Sun',
            isActive: true,
            active: true
        },
        {
            shiftCode: 'SH_MORN_01',
            shiftName: 'Morning Production Shift',
            startTime: '06:00',
            endTime: '14:30',
            breakMinutes: 30,
            graceInMinutes: 10,
            graceOutMinutes: 10,
            halfDayMinutes: 210,
            fullDayMinutes: 450,
            isNightShift: false,
            nightShift: false,
            isOvertimeEligible: true,
            overtimeEligible: true,
            weeklyOffPattern: 'Sun',
            isActive: true,
            active: true
        },
        {
            shiftCode: 'SH_EVE_01',
            shiftName: 'Evening Technical Shift',
            startTime: '14:00',
            endTime: '22:30',
            breakMinutes: 45,
            graceInMinutes: 15,
            graceOutMinutes: 15,
            halfDayMinutes: 240,
            fullDayMinutes: 465,
            isNightShift: false,
            nightShift: false,
            isOvertimeEligible: true,
            overtimeEligible: true,
            weeklyOffPattern: 'Sun',
            isActive: true,
            active: true
        },
        {
            shiftCode: 'SH_NIGHT_01',
            shiftName: 'Overnight Mission-Critical Shift',
            startTime: '22:00',
            endTime: '06:30',
            breakMinutes: 45,
            graceInMinutes: 15,
            graceOutMinutes: 15,
            halfDayMinutes: 240,
            fullDayMinutes: 465,
            isNightShift: true,
            nightShift: true,
            isOvertimeEligible: true,
            overtimeEligible: true,
            weeklyOffPattern: 'Sat,Sun',
            isActive: true,
            active: true
        }
    ];

    // Canonical header synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        shiftCode: [
            'shift_code', 'shiftcode', 'shift-code', 'code', 'shift_id', 'shiftid'
        ],
        shiftName: [
            'shift_name', 'shiftname', 'shift-name', 'name', 'title', 'shift_title'
        ],
        startTime: [
            'start_time', 'starttime', 'start-time', 'start', 'shift_start', 'in_time'
        ],
        endTime: [
            'end_time', 'endtime', 'end-time', 'end', 'shift_end', 'out_time'
        ],
        breakMinutes: [
            'break_minutes', 'breakminutes', 'break-minutes', 'break_mins', 'break', 'lunch_break_minutes'
        ],
        graceInMinutes: [
            'grace_in_minutes', 'graceinminutes', 'grace_in', 'grace-in-minutes', 'grace_period_in', 'grace_period_minutes'
        ],
        graceOutMinutes: [
            'grace_out_minutes', 'graceoutminutes', 'grace_out', 'grace-out-minutes', 'grace_period_out'
        ],
        halfDayMinutes: [
            'half_day_minutes', 'halfdayminutes', 'half-day-minutes', 'half_day_mins', 'half_day_threshold'
        ],
        fullDayMinutes: [
            'full_day_minutes', 'fulldayminutes', 'full-day-minutes', 'full_day_mins', 'full_day_threshold'
        ],
        nightShift: [
            'night_shift', 'nightshift', 'night-shift', 'is_night_shift', 'isnightshift', 'overnight'
        ],
        overtimeEligible: [
            'overtime_eligible', 'overtimeeligible', 'overtime-eligible', 'ot_eligible', 'ot_allowed', 'is_overtime_eligible'
        ],
        weeklyOffPattern: [
            'weekly_off_pattern', 'weeklyoffpattern', 'weekly-off-pattern', 'weekly_off', 'week_off', 'weekoff', 'weekly_off_policy'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'operational_status'
        ]
    };

    /**
     * Normalizes an object key by removing whitespace, underscores, hyphens, and lowercase
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
     * Parses numeric minute duration with fallback
     */
    function parseMinutes(val, defaultVal = 0) {
        if (val === undefined || val === null || val === '') return defaultVal;
        const num = Number(val);
        if (isNaN(num) || num < 0) return defaultVal;
        return Math.round(num);
    }

    /**
     * Parses and normalizes time string to HH:mm
     */
    function parseTimeString(val, defaultVal = '09:00') {
        if (!val) return defaultVal;
        const str = String(val).trim();

        // Check if SheetJS parsed Excel time fraction (e.g. 0.3958333 for 09:30)
        if (!isNaN(Number(str)) && Number(str) > 0 && Number(str) < 1) {
            const totalMinutes = Math.round(Number(str) * 24 * 60);
            const hours = Math.floor(totalMinutes / 60) % 24;
            const mins = totalMinutes % 60;
            return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        }

        // HH:mm or HH:mm:ss regex
        const match = str.match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])(:[0-5][0-9])?$/);
        if (match) {
            const h = String(match[1]).padStart(2, '0');
            const m = String(match[2]).padStart(2, '0');
            return `${h}:${m}`;
        }

        // 12-hour AM/PM format (e.g. "9:30 AM", "6:00 PM")
        const ampmMatch = str.match(/^([0-1]?[0-9]):([0-5][0-9])\s*(AM|PM)$/i);
        if (ampmMatch) {
            let h = parseInt(ampmMatch[1], 10);
            const m = String(ampmMatch[2]).padStart(2, '0');
            const isPm = ampmMatch[3].toUpperCase() === 'PM';
            if (isPm && h < 12) h += 12;
            if (!isPm && h === 12) h = 0;
            return `${String(h).padStart(2, '0')}:${m}`;
        }

        return defaultVal;
    }

    /**
     * Validates if string strictly conforms to HH:mm
     */
    function isValidTimeFormat(val) {
        if (!val || typeof val !== 'string') return false;
        return /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(val.trim());
    }

    /**
     * Normalizes Yes/No boolean
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
     * Normalizes Weekly Off Pattern (e.g. "Sun", "Sat,Sun", "2nd_4th_Sat,Sun")
     */
    function normalizeWeeklyOffPattern(val) {
        if (!val || typeof val !== 'string') return 'Sun';
        return val.trim();
    }

    /**
     * Parses a single row into the strict 13 attributes and Firestore document structure
     */
    function parseShiftRow(row, idx = 0, seenCodes = new Set()) {
        const errors = [];
        const warnings = [];

        const rawCode = extractFieldValue(row, HEADER_SYNONYMS.shiftCode);
        const rawName = extractFieldValue(row, HEADER_SYNONYMS.shiftName);
        const rawStart = extractFieldValue(row, HEADER_SYNONYMS.startTime);
        const rawEnd = extractFieldValue(row, HEADER_SYNONYMS.endTime);
        const rawBreak = extractFieldValue(row, HEADER_SYNONYMS.breakMinutes);
        const rawGraceIn = extractFieldValue(row, HEADER_SYNONYMS.graceInMinutes);
        const rawGraceOut = extractFieldValue(row, HEADER_SYNONYMS.graceOutMinutes);
        const rawHalfDay = extractFieldValue(row, HEADER_SYNONYMS.halfDayMinutes);
        const rawFullDay = extractFieldValue(row, HEADER_SYNONYMS.fullDayMinutes);
        const rawNight = extractFieldValue(row, HEADER_SYNONYMS.nightShift);
        const rawOt = extractFieldValue(row, HEADER_SYNONYMS.overtimeEligible);
        const rawWeeklyOff = extractFieldValue(row, HEADER_SYNONYMS.weeklyOffPattern);
        const rawActive = extractFieldValue(row, HEADER_SYNONYMS.active);

        // 1. Shift Code (PK)
        if (!rawCode) {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Shift_Code'.`);
        }

        // 2. Shift Name
        if (!rawName) {
            errors.push(`Row ${idx + 1}: Missing required attribute 'Shift_Name'.`);
        }

        const shiftCode = rawCode ? String(rawCode).trim().toUpperCase().replace(/\s+/g, '_') : '';
        const shiftName = rawName ? String(rawName).trim() : '';

        // Check duplicates
        if (shiftCode) {
            if (seenCodes.has(shiftCode)) {
                errors.push(`Row ${idx + 1}: Duplicate Shift_Code '${shiftCode}' detected in dataset.`);
            } else {
                seenCodes.add(shiftCode);
            }
        }

        // Times
        const startTime = parseTimeString(rawStart, '09:30');
        const endTime = parseTimeString(rawEnd, '18:30');

        if (rawStart && !isValidTimeFormat(startTime)) {
            warnings.push(`Row ${idx + 1}: Start_Time '${rawStart}' was normalized to '${startTime}'.`);
        }
        if (rawEnd && !isValidTimeFormat(endTime)) {
            warnings.push(`Row ${idx + 1}: End_Time '${rawEnd}' was normalized to '${endTime}'.`);
        }

        // Durations
        const breakMinutes = parseMinutes(rawBreak, 60);
        const graceInMinutes = parseMinutes(rawGraceIn, 15);
        const graceOutMinutes = parseMinutes(rawGraceOut, 15);
        const halfDayMinutes = parseMinutes(rawHalfDay, 240);
        const fullDayMinutes = parseMinutes(rawFullDay, 480);

        // Booleans
        const isNightShift = parseBoolean(rawNight, false);
        const isOvertimeEligible = parseBoolean(rawOt, true);
        const weeklyOffPattern = normalizeWeeklyOffPattern(rawWeeklyOff);
        const isActive = parseBoolean(rawActive, true);

        // Logical Validation
        if (halfDayMinutes >= fullDayMinutes) {
            warnings.push(`Row ${idx + 1}: Half_Day_Minutes (${halfDayMinutes}) should be strictly less than Full_Day_Minutes (${fullDayMinutes}).`);
        }

        const record = {
            'Shift_Code': shiftCode,
            'Shift_Name': shiftName,
            'Start_Time': startTime,
            'End_Time': endTime,
            'Break_Minutes': breakMinutes,
            'Grace_In_Minutes': graceInMinutes,
            'Grace_Out_Minutes': graceOutMinutes,
            'Half_Day_Minutes': halfDayMinutes,
            'Full_Day_Minutes': fullDayMinutes,
            'Night_Shift': isNightShift ? 'Yes' : 'No',
            'Overtime_Eligible': isOvertimeEligible ? 'Yes' : 'No',
            'Weekly_Off_Pattern': weeklyOffPattern,
            'Active': isActive ? 'Yes' : 'No',

            // Normalized Properties
            shiftCode,
            shiftName,
            startTime,
            endTime,
            breakMinutes,
            graceInMinutes,
            graceOutMinutes,
            halfDayMinutes,
            fullDayMinutes,
            isNightShift,
            nightShift: isNightShift,
            isOvertimeEligible,
            overtimeEligible: isOvertimeEligible,
            weeklyOffPattern,
            isActive,
            active: isActive
        };

        const firestoreDoc = {
            shiftCode,
            shiftName,
            startTime,
            endTime,
            breakMinutes,
            graceInMinutes,
            graceOutMinutes,
            halfDayMinutes,
            fullDayMinutes,
            isNightShift,
            nightShift: isNightShift,
            isOvertimeEligible,
            overtimeEligible: isOvertimeEligible,
            weeklyOffPattern,
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
    function parseShiftRows(rows, options = {}) {
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
            if (vals.length === 0) return; // Skip empty rows

            const res = parseShiftRow(row, idx, seenCodes);
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
     * Dedicated 'Shifts & Week-offs' sheet parser
     */
    function parseShiftSheet(rows) {
        const res = parseShiftRows(rows);
        return {
            valid: res.valid,
            data: res.validRecords,
            firestoreDocs: res.firestoreDocs,
            errors: res.errors,
            warnings: res.warnings
        };
    }

    /**
     * Parses Shifts sheet from SheetJS workbook or binary buffer
     */
    async function parseShiftWorkbook(workbookOrBuffer, options = {}) {
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
                norm === 'shiftsweekoffs' ||
                norm === 'shiftsandweekoffs' ||
                norm === 'shifts' ||
                norm === 'shiftroster' ||
                norm === 'shift_roster' ||
                norm === 'shiftspolicies'
            );
        });

        if (!targetSheetName) {
            throw new Error("Could not find 'Shifts & Week-offs' or 'Shift_Roster' sheet in workbook.");
        }

        const sheet = workbook.Sheets[targetSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        return parseShiftRows(rows, options);
    }

    /**
     * Parses CSV text for Shifts & Week-offs
     */
    function parseShiftCsv(csvText, options = {}) {
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
            const line = lines[i];
            const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const rowObj = {};
            headers.forEach((h, hIdx) => {
                rowObj[h] = values[hIdx] !== undefined ? values[hIdx] : '';
            });
            rows.push(rowObj);
        }

        return parseShiftRows(rows, options);
    }

    return {
        DEFAULT_SHIFTS,
        HEADER_SYNONYMS,
        extractFieldValue,
        parseTimeString,
        isValidTimeFormat,
        parseMinutes,
        parseBoolean,
        parseShiftRow,
        parseShiftRows,
        parseShiftSheet,
        parseShiftWorkbook,
        parseShiftCsv
    };
}));
