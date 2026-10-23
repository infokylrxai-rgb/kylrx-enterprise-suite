/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - HOLIDAY CALENDAR PARSER & VALIDATOR ENGINE
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes Holiday Calendar records
 * from the 'Holiday Calendar' sheet of Templates.xlsx or CSV uploads
 * matching PRD Sections 1, 4, 15, & 16:
 * 
 * Exact 9 Attributes:
 * 1. Holiday_Calendar_Code (string, grouped calendar identifier, e.g. HOL_BLR_2026)
 * 2. Holiday_Calendar_Name (string, display title, e.g. Bengaluru General Calendar 2026)
 * 3. Location_Code (string, foreign key linked to an active office location)
 * 4. Holiday_Date (string / ISO Date: YYYY-MM-DD)
 * 5. Holiday_Name (string, holiday title)
 * 6. Holiday_Type (string: National, Regional, Restricted, Company Floating, Gazetted)
 * 7. Optional_Holiday (boolean: true for "Yes", false for "No")
 * 8. Paid_Holiday (boolean: true for "Yes", false for "No")
 * 9. Active (boolean: true for "Yes", false for "No")
 * 
 * @version 1.0.0
 * @author Senior Frontend & Firebase Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxHolidayCalendarParser = factory();
        root.holidayCalendarParser = root.KylrxHolidayCalendarParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        calendarCode: [
            'holiday_calendar_code', 'holidaycalendarcode', 'calendar_code', 'calendarcode',
            'holiday_calendar', 'cal_code', 'calcode', 'calendar_id', 'calendarid', 'holiday_code'
        ],
        calendarName: [
            'holiday_calendar_name', 'holidaycalendarname', 'calendar_name', 'calendarname',
            'cal_name', 'calendar_title', 'calendartitle', 'title'
        ],
        locationCode: [
            'location_code', 'locationcode', 'location_id', 'locationid', 'location',
            'branch_code', 'branchcode', 'office_location', 'site_code'
        ],
        holidayDate: [
            'holiday_date', 'holidaydate', 'date', 'holiday_day', 'event_date', 'closure_date'
        ],
        holidayName: [
            'holiday_name', 'holidayname', 'name', 'holiday_title', 'holidaytitle',
            'holiday', 'festival', 'occasion'
        ],
        holidayType: [
            'holiday_type', 'holidaytype', 'type', 'category', 'nature', 'holiday_category'
        ],
        optionalHoliday: [
            'optional_holiday', 'optionalholiday', 'is_optional', 'isoptional', 'optional',
            'floating', 'is_floating', 'isfloating', 'restricted', 'is_restricted', 'restricted_holiday'
        ],
        paidHoliday: [
            'paid_holiday', 'paidholiday', 'is_paid', 'ispaid', 'paid', 'payable', 'paid_leave'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'is_enabled'
        ],
        // Inverse flag support: if sheet uses Is_Mandatory, Optional = !Is_Mandatory
        isMandatory: [
            'is_mandatory', 'ismandatory', 'mandatory', 'compulsory', 'is_compulsory'
        ]
    };

    /**
     * Exact 9 Attributes Schema Definition matching PRD Sections 1, 4, 15, & 16
     */
    const HOLIDAY_CALENDAR_ATTRIBUTES = [
        { key: "Holiday_Calendar_Code", label: "1. Calendar Code", required: true, defaultValue: "HOL_GEN_2026", synonyms: HEADER_SYNONYMS.calendarCode },
        { key: "Holiday_Calendar_Name", label: "2. Calendar Name", required: true, defaultValue: "General Holiday Calendar 2026", synonyms: HEADER_SYNONYMS.calendarName },
        { key: "Location_Code", label: "3. Location Code", required: true, synonyms: HEADER_SYNONYMS.locationCode },
        { key: "Holiday_Date", label: "4. Holiday Date (YYYY-MM-DD)", required: true, synonyms: HEADER_SYNONYMS.holidayDate },
        { key: "Holiday_Name", label: "5. Holiday Name", required: true, synonyms: HEADER_SYNONYMS.holidayName },
        { key: "Holiday_Type", label: "6. Holiday Type", required: false, defaultValue: "National", synonyms: HEADER_SYNONYMS.holidayType },
        { key: "Optional_Holiday", label: "7. Optional Holiday", required: false, defaultValue: false, synonyms: HEADER_SYNONYMS.optionalHoliday },
        { key: "Paid_Holiday", label: "8. Paid Holiday", required: false, defaultValue: true, synonyms: HEADER_SYNONYMS.paidHoliday },
        { key: "Active", label: "9. Active", required: false, defaultValue: true, synonyms: HEADER_SYNONYMS.active }
    ];

    /**
     * Standard Recognized Office Locations catalog (Default Fallback Reference)
     * Matches Templates.xlsx Locations_Branches and PRD Section 1 & 5
     */
    const STANDARD_ACTIVE_LOCATIONS = new Set([
        'LOC-BLR', 'LOC_BLR', 'LOC_BLR_01', 'LOC-BLR-01',
        'LOC-MUM', 'LOC_MUM', 'LOC_MUM_01', 'LOC-MUM-01',
        'LOC-DEL', 'LOC_DEL', 'LOC_DEL_01', 'LOC-DEL-01',
        'LOC-HYD', 'LOC_HYD', 'LOC_HYD_01', 'LOC-HYD-01',
        'LOC-PUN', 'LOC_PUN', 'LOC_PUN_01', 'LOC-PUN-01',
        'LOC-CHN', 'LOC_CHN', 'LOC_CHN_01', 'LOC-CHN-01',
        'LOC-KOL', 'LOC_KOL', 'LOC_KOL_01', 'LOC-KOL-01',
        'LOC_CORP_01', 'LOC_HQ', 'ALL', 'GLOBAL'
    ]);

    /**
     * Sanitizes boolean string / numeric representations
     */
    function sanitizeBoolean(val, defaultVal = true) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val === 1;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'y', 'true', 't', '1', 'active', 'enabled', 'mandatory'].includes(s)) return true;
        if (['no', 'n', 'false', 'f', '0', 'inactive', 'disabled', 'optional'].includes(s)) return false;
        return defaultVal;
    }

    /**
     * Sanitizes and formats date value into standard ISO YYYY-MM-DD format.
     * Supports:
     * - ISO strings: '2026-10-02'
     * - Dates with time: '2026-10-02T00:00:00.000Z'
     * - Date objects
     * - Excel numeric date serials (e.g. 46298)
     * - Formats like 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY'
     */
    function sanitizeIsoDate(val) {
        if (val === undefined || val === null || val === '') return null;

        // If native Date object
        if (val instanceof Date) {
            if (isNaN(val.getTime())) return null;
            return val.toISOString().split('T')[0];
        }

        // If Excel serial number (numeric)
        if (typeof val === 'number') {
            // Excel serials are days since 1899-12-30 (accounting for 1900 leap year bug)
            if (val > 20000 && val < 90000) {
                const utcDays = Math.floor(val - 25569);
                const utcValue = utcDays * 86400 * 1000;
                const d = new Date(utcValue);
                if (!isNaN(d.getTime())) {
                    return d.toISOString().split('T')[0];
                }
            }
        }

        const raw = String(val).trim();
        if (!raw) return null;

        // Standard ISO format YYYY-MM-DD
        const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (isoMatch) {
            const y = parseInt(isoMatch[1], 10);
            const m = String(parseInt(isoMatch[2], 10)).padStart(2, '0');
            const d = String(parseInt(isoMatch[3], 10)).padStart(2, '0');
            if (parseInt(m, 10) >= 1 && parseInt(m, 10) <= 12 && parseInt(d, 10) >= 1 && parseInt(d, 10) <= 31) {
                return `${y}-${m}-${d}`;
            }
        }

        // European / Indian format DD/MM/YYYY or DD-MM-YYYY
        const dmyMatch = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
        if (dmyMatch) {
            const first = parseInt(dmyMatch[1], 10);
            const second = parseInt(dmyMatch[2], 10);
            const y = parseInt(dmyMatch[3], 10);

            // If first > 12, it must be day
            let day = first;
            let month = second;
            if (first <= 12 && second > 12) {
                month = first;
                day = second;
            }

            const mStr = String(month).padStart(2, '0');
            const dStr = String(day).padStart(2, '0');
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return `${y}-${mStr}-${dStr}`;
            }
        }

        // Try standard Date.parse
        const parsedTimestamp = Date.parse(raw);
        if (!isNaN(parsedTimestamp)) {
            const d = new Date(parsedTimestamp);
            return d.toISOString().split('T')[0];
        }

        return null;
    }

    /**
     * Resolves value from raw row using case-insensitive header synonyms
     */
    function resolveRowValue(row, synonyms) {
        if (!row || typeof row !== 'object') return undefined;

        const rowKeys = Object.keys(row);
        for (const syn of synonyms) {
            const cleanSyn = syn.toLowerCase().replace(/[\s_-]+/g, '');
            for (const key of rowKeys) {
                const cleanKey = key.trim().toLowerCase().replace(/[\s_-]+/g, '');
                if (cleanKey === cleanSyn) {
                    return row[key];
                }
            }
        }
        return undefined;
    }

    /**
     * Normalizes a raw input row into canonical 9 attributes
     */
    function normalizeHolidayRow(row, rowIndex = 0, defaultCalendarCode = null, defaultCalendarName = null) {
        const rawCalendarCode = resolveRowValue(row, HEADER_SYNONYMS.calendarCode);
        const rawCalendarName = resolveRowValue(row, HEADER_SYNONYMS.calendarName);
        const rawLocationCode = resolveRowValue(row, HEADER_SYNONYMS.locationCode);
        const rawDate = resolveRowValue(row, HEADER_SYNONYMS.holidayDate);
        const rawName = resolveRowValue(row, HEADER_SYNONYMS.holidayName);
        const rawType = resolveRowValue(row, HEADER_SYNONYMS.holidayType);
        const rawOptional = resolveRowValue(row, HEADER_SYNONYMS.optionalHoliday);
        const rawMandatory = resolveRowValue(row, HEADER_SYNONYMS.isMandatory);
        const rawPaid = resolveRowValue(row, HEADER_SYNONYMS.paidHoliday);
        const rawActive = resolveRowValue(row, HEADER_SYNONYMS.active);

        const locationCode = rawLocationCode ? String(rawLocationCode).trim().toUpperCase() : '';
        const calendarCode = rawCalendarCode 
            ? String(rawCalendarCode).trim().toUpperCase() 
            : (defaultCalendarCode || (locationCode ? `HOL_${locationCode.replace(/[^A-Z0-9]/g, '_')}_2026` : 'HOL_GEN_2026'));
        const calendarName = rawCalendarName 
            ? String(rawCalendarName).trim() 
            : (defaultCalendarName || `${calendarCode.replace(/_/g, ' ')}`);

        const holidayDate = sanitizeIsoDate(rawDate);
        const holidayName = rawName ? String(rawName).trim() : '';
        
        let holidayType = rawType ? String(rawType).trim() : 'National';
        // Normalize common types
        const lowerType = holidayType.toLowerCase();
        if (lowerType.includes('nation')) holidayType = 'National';
        else if (lowerType.includes('region') || lowerType.includes('state')) holidayType = 'Regional';
        else if (lowerType.includes('restrict')) holidayType = 'Restricted';
        else if (lowerType.includes('float')) holidayType = 'Company Floating';
        else if (lowerType.includes('gazett')) holidayType = 'National';

        // Optional Holiday logic:
        // 1. If explicit Optional_Holiday provided
        // 2. If Is_Mandatory provided, Optional = !Is_Mandatory
        // 3. Fallback to false (mandatory by default unless Restricted or Floating)
        let isOptional = false;
        if (rawOptional !== undefined && rawOptional !== null && rawOptional !== '') {
            isOptional = sanitizeBoolean(rawOptional, false);
        } else if (rawMandatory !== undefined && rawMandatory !== null && rawMandatory !== '') {
            const isMand = sanitizeBoolean(rawMandatory, true);
            isOptional = !isMand;
        } else if (['restricted', 'company floating'].includes(holidayType.toLowerCase())) {
            isOptional = true;
        }

        const isPaid = sanitizeBoolean(rawPaid, true);
        const isActive = sanitizeBoolean(rawActive, true);

        return {
            rowIndex: rowIndex + 1,
            // Strict 9 attributes (PascalCase / Templates.xlsx keys)
            Holiday_Calendar_Code: calendarCode,
            Holiday_Calendar_Name: calendarName,
            Location_Code: locationCode,
            Holiday_Date: holidayDate,
            Holiday_Name: holidayName,
            Holiday_Type: holidayType,
            Optional_Holiday: isOptional,
            Paid_Holiday: isPaid,
            Active: isActive,

            // camelCase mirrors for JavaScript / Firestore models
            calendarCode,
            calendarName,
            locationCode,
            holidayDate,
            holidayName,
            holidayType,
            isOptional,
            isPaid,
            isActive
        };
    }

    /**
     * Parses and validates raw sheet rows against PRD Sections 1, 4, 15, & 16.
     * 
     * Enforces:
     * - Exact 9 Attributes mapping
     * - Foreign key validation on Location_Code (must map to active location)
     * - ISO Date sanitization (YYYY-MM-DD)
     * - Boolean normalization
     * - Deduplication of Holiday_Date under the same Holiday_Calendar_Code and Location_Code
     * 
     * @param {Array<Object>} rows - Raw rows from SheetJS or CSV
     * @param {Object} options - Configuration options:
     *        - activeLocations: Array | Set of valid location codes
     *        - defaultCalendarCode: Fallback code
     *        - defaultCalendarName: Fallback display name
     * @returns {Object} { valid, totalRows, validCount, records, firestoreDocs, errors, warnings, calendars }
     */
    function parseHolidayCalendarSheet(rows, options = {}) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                records: [],
                firestoreDocs: [],
                errors: ["Spreadsheet sheet contains no data rows."],
                warnings: [],
                calendars: {}
            };
        }

        const activeLocations = options.activeLocations instanceof Set
            ? options.activeLocations
            : (Array.isArray(options.activeLocations) && options.activeLocations.length > 0
                ? new Set(options.activeLocations.map(l => String(l).trim().toUpperCase()))
                : STANDARD_ACTIVE_LOCATIONS);

        const records = [];
        const firestoreDocs = [];
        const errors = [];
        const warnings = [];
        const seenDateKeys = new Set();
        const calendarsMap = {};

        rows.forEach((row, idx) => {
            // Skip empty rows
            const hasValues = Object.values(row || {}).some(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (!hasValues) return;

            const record = normalizeHolidayRow(row, idx, options.defaultCalendarCode, options.defaultCalendarName);
            const rowLabel = `Row #${record.rowIndex}`;

            // Validation 1: Required Calendar Code
            if (!record.Holiday_Calendar_Code) {
                errors.push(`${rowLabel}: 'Holiday_Calendar_Code' is required.`);
                return;
            }

            // Validation 2: Required Calendar Name
            if (!record.Holiday_Calendar_Name) {
                errors.push(`${rowLabel}: 'Holiday_Calendar_Name' is required.`);
                return;
            }

            // Validation 3: Required Location Code
            if (!record.Location_Code) {
                errors.push(`${rowLabel}: 'Location_Code' is required and must reference an active office location.`);
                return;
            }

            // Validation 4: Foreign Key Validation on Location_Code
            const normLoc = record.Location_Code.toUpperCase();
            if (!activeLocations.has(normLoc) && !activeLocations.has(normLoc.replace(/_/g, '-')) && !activeLocations.has(normLoc.replace(/-/g, '_'))) {
                errors.push(`${rowLabel}: Location_Code "${record.Location_Code}" does not reference an active location in 'locations' collection.`);
                return;
            }

            // Validation 5: Required and Valid ISO Date (YYYY-MM-DD)
            if (!record.Holiday_Date) {
                errors.push(`${rowLabel}: 'Holiday_Date' is missing or has an invalid date format. Expected standard ISO 'YYYY-MM-DD'.`);
                return;
            }

            // Validation 6: Required Holiday Name
            if (!record.Holiday_Name) {
                errors.push(`${rowLabel}: 'Holiday_Name' is required.`);
                return;
            }

            // Validation 7: Deduplication
            // Prevent identical Holiday_Date entries under the same Holiday_Calendar_Code and Location_Code
            const dedupeKey = `${record.Holiday_Calendar_Code}__${normLoc}__${record.Holiday_Date}`;
            if (seenDateKeys.has(dedupeKey)) {
                errors.push(`${rowLabel}: Duplicate entry detected! Holiday Date "${record.Holiday_Date}" already exists under Calendar "${record.Holiday_Calendar_Code}" and Location "${record.Location_Code}".`);
                return;
            }
            seenDateKeys.add(dedupeKey);

            // Document ID format for subcollection: ${locationCode}_${holidayDate} or ${holidayDate}
            const cleanHolidayId = `${normLoc}_${record.Holiday_Date}`.replace(/[^A-Za-z0-9_-]/g, '_');

            // Normalized Cloud Firestore Document Schema matching PRD Specification 5
            const firestoreDoc = {
                id: cleanHolidayId,
                calendarCode: record.Holiday_Calendar_Code,
                calendarName: record.Holiday_Calendar_Name,
                locationCode: record.Location_Code,
                holidayDate: record.Holiday_Date,
                holidayName: record.Holiday_Name,
                holidayType: record.Holiday_Type,
                isOptional: record.Optional_Holiday,
                isPaid: record.Paid_Holiday,
                isActive: record.Active,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Group by Calendar
            if (!calendarsMap[record.Holiday_Calendar_Code]) {
                calendarsMap[record.Holiday_Calendar_Code] = {
                    calendarCode: record.Holiday_Calendar_Code,
                    calendarName: record.Holiday_Calendar_Name,
                    locationCode: record.Location_Code,
                    year: parseInt(record.Holiday_Date.split('-')[0], 10) || 2026,
                    holidays: [],
                    totalCount: 0,
                    mandatoryCount: 0,
                    optionalCount: 0,
                    paidCount: 0
                };
            }

            calendarsMap[record.Holiday_Calendar_Code].holidays.push(firestoreDoc);
            calendarsMap[record.Holiday_Calendar_Code].totalCount++;
            if (record.Optional_Holiday) {
                calendarsMap[record.Holiday_Calendar_Code].optionalCount++;
            } else {
                calendarsMap[record.Holiday_Calendar_Code].mandatoryCount++;
            }
            if (record.Paid_Holiday) {
                calendarsMap[record.Holiday_Calendar_Code].paidCount++;
            }

            records.push(record);
            firestoreDocs.push(firestoreDoc);
        });

        return {
            valid: errors.length === 0,
            totalRows: rows.length,
            validCount: records.length,
            records,
            firestoreDocs,
            errors,
            warnings,
            calendars: calendarsMap
        };
    }

    /**
     * Parses raw CSV string data into parsed holiday records
     * @param {string} csvContent
     * @param {Object} options
     */
    function parseHolidayCalendarCsv(csvContent, options = {}) {
        if (!csvContent || typeof csvContent !== 'string') {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                records: [],
                firestoreDocs: [],
                errors: ["CSV content is empty."],
                warnings: [],
                calendars: {}
            };
        }

        const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            return {
                valid: false,
                totalRows: 0,
                validCount: 0,
                records: [],
                firestoreDocs: [],
                errors: ["CSV must contain a header row and at least one data row."],
                warnings: [],
                calendars: {}
            };
        }

        // Parse header
        const rawHeaders = splitCsvLine(lines[0]);
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = splitCsvLine(lines[i]);
            if (values.length === 0 || values.every(v => v.trim() === '')) continue;
            const rowObj = {};
            rawHeaders.forEach((header, idx) => {
                rowObj[header.trim()] = values[idx] !== undefined ? values[idx].trim() : '';
            });
            rows.push(rowObj);
        }

        return parseHolidayCalendarSheet(rows, options);
    }

    /**
     * Robust CSV line splitter supporting quoted strings
     */
    function splitCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"' || char === "'") {
                if (inQuotes && line[i + 1] === char) {
                    current += char;
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    /**
     * Returns canonical CSV template content for download
     */
    function getHolidayCalendarCsvTemplate() {
        const headers = HOLIDAY_CALENDAR_ATTRIBUTES.map(a => a.key).join(',');
        const sampleRows = [
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-01-26,Republic Day,National,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-03-04,Maha Shivratri,Restricted,Yes,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-03-25,Holi,National,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-04-10,Good Friday,National,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-05-01,May Day,Regional,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-08-15,Independence Day,National,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-10-02,Gandhi Jayanti,National,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-10-20,Dussehra / Vijayadashami,National,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-11-01,Kannada Rajyotsava,Regional,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-11-08,Diwali,National,No,Yes,Yes",
            "HOL_BLR_2026,Bengaluru General Calendar 2026,LOC_BLR_01,2026-12-25,Christmas,National,No,Yes,Yes"
        ];
        return [headers, ...sampleRows].join('\n');
    }

    return {
        HOLIDAY_CALENDAR_ATTRIBUTES,
        STANDARD_ACTIVE_LOCATIONS,
        HEADER_SYNONYMS,
        sanitizeBoolean,
        sanitizeIsoDate,
        normalizeHolidayRow,
        parseHolidayCalendarSheet,
        parseHolidayCalendarCsv,
        getHolidayCalendarCsvTemplate
    };
}));
