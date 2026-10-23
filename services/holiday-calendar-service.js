/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - HOLIDAY CALENDAR & EVALUATION SERVICE
 * ============================================================================
 * 
 * Manages Holiday Calendar Configurations, Cloud Firestore Persistence,
 * Location-to-Employee Resolution, Daily Attendance Rules Interlock (PRD §§ 15 & 16),
 * and Payroll Calculation Linkage (PRD § 4).
 * 
 * 1. Cloud Firestore Data Architecture:
 *    - Path: organizations/{orgId}/holiday_calendars/{calendarCode}/holidays/{holidayId}
 *    - Subcollection Document Schema:
 *      {
 *        "calendarCode": "HOL_BLR_2026",
 *        "calendarName": "Bengaluru General Calendar 2026",
 *        "locationCode": "LOC_BLR_01",
 *        "holidayDate": "2026-10-02",
 *        "holidayName": "Gandhi Jayanti",
 *        "holidayType": "National",
 *        "isOptional": false,
 *        "isPaid": true,
 *        "isActive": true,
 *        "createdAt": "serverTimestamp()",
 *        "updatedAt": "serverTimestamp()"
 *      }
 * 
 * 2. Attendance & Leave Rules Interlock (PRD §§ 15 & 16):
 *    - Mandatory Holiday (Optional_Holiday == false): Flags punch date as 'HOLIDAY'.
 *    - Holiday Worked: If punched on Paid_Holiday, marks as 'HOLIDAY_WORKED' and
 *      flags record eligible for holiday overtime and comp-off accrual.
 *    - Optional / Floating Holiday: Employees claim against annual optional quota (2 days).
 * 
 * 3. Payroll Calculation Linkage (PRD § 4):
 *    - Paid_Holiday == true: full daily compensation credited with zero Loss of Pay (LOP).
 *    - Paid_Holiday == false: computes salary prorating deduction.
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
        root.KylrxHolidayCalendarService = factory();
        root.holidayCalendarService = root.KylrxHolidayCalendarService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for fast local lookups, offline mode, and deterministic unit testing
    const _localLedger = new Map();
    const _optionalClaimsLedger = new Map();

    // Default Seed Holiday Calendars matching Templates.xlsx and PRD Section 1 & 5
    const DEFAULT_SEED_CALENDARS = [
        {
            calendarCode: "HOL_BLR_2026",
            calendarName: "Bengaluru General Calendar 2026",
            locationCode: "LOC_BLR_01",
            year: 2026,
            isActive: true,
            holidays: [
                { id: "LOC_BLR_01_2026-01-26", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-01-26", holidayName: "Republic Day", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-03-04", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-03-04", holidayName: "Maha Shivratri", holidayType: "Restricted", isOptional: true, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-03-25", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-03-25", holidayName: "Holi", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-04-10", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-04-10", holidayName: "Good Friday", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-05-01", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-05-01", holidayName: "May Day", holidayType: "Regional", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-08-15", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-08-15", holidayName: "Independence Day", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-08-27", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-08-27", holidayName: "Raksha Bandhan", holidayType: "Restricted", isOptional: true, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-10-02", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-10-02", holidayName: "Gandhi Jayanti", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-10-20", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-10-20", holidayName: "Dussehra", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-11-01", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-11-01", holidayName: "Kannada Rajyotsava", holidayType: "Regional", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-11-08", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-11-08", holidayName: "Diwali", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_BLR_01_2026-12-25", calendarCode: "HOL_BLR_2026", calendarName: "Bengaluru General Calendar 2026", locationCode: "LOC_BLR_01", holidayDate: "2026-12-25", holidayName: "Christmas", holidayType: "National", isOptional: false, isPaid: true, isActive: true }
            ]
        },
        {
            calendarCode: "HOL_MUM_2026",
            calendarName: "Mumbai Commercial Hub Calendar 2026",
            locationCode: "LOC_MUM_01",
            year: 2026,
            isActive: true,
            holidays: [
                { id: "LOC_MUM_01_2026-01-26", calendarCode: "HOL_MUM_2026", calendarName: "Mumbai Commercial Hub Calendar 2026", locationCode: "LOC_MUM_01", holidayDate: "2026-01-26", holidayName: "Republic Day", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_MUM_01_2026-03-25", calendarCode: "HOL_MUM_2026", calendarName: "Mumbai Commercial Hub Calendar 2026", locationCode: "LOC_MUM_01", holidayDate: "2026-03-25", holidayName: "Holi", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_MUM_01_2026-05-01", calendarCode: "HOL_MUM_2026", calendarName: "Mumbai Commercial Hub Calendar 2026", locationCode: "LOC_MUM_01", holidayDate: "2026-05-01", holidayName: "Maharashtra Day", holidayType: "Regional", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_MUM_01_2026-08-15", calendarCode: "HOL_MUM_2026", calendarName: "Mumbai Commercial Hub Calendar 2026", locationCode: "LOC_MUM_01", holidayDate: "2026-08-15", holidayName: "Independence Day", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_MUM_01_2026-09-17", calendarCode: "HOL_MUM_2026", calendarName: "Mumbai Commercial Hub Calendar 2026", locationCode: "LOC_MUM_01", holidayDate: "2026-09-17", holidayName: "Ganesh Chaturthi", holidayType: "Regional", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_MUM_01_2026-10-02", calendarCode: "HOL_MUM_2026", calendarName: "Mumbai Commercial Hub Calendar 2026", locationCode: "LOC_MUM_01", holidayDate: "2026-10-02", holidayName: "Gandhi Jayanti", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_MUM_01_2026-11-08", calendarCode: "HOL_MUM_2026", calendarName: "Mumbai Commercial Hub Calendar 2026", locationCode: "LOC_MUM_01", holidayDate: "2026-11-08", holidayName: "Diwali", holidayType: "National", isOptional: false, isPaid: true, isActive: true },
                { id: "LOC_MUM_01_2026-12-25", calendarCode: "HOL_MUM_2026", calendarName: "Mumbai Commercial Hub Calendar 2026", locationCode: "LOC_MUM_01", holidayDate: "2026-12-25", holidayName: "Christmas", holidayType: "National", isOptional: false, isPaid: true, isActive: true }
            ]
        }
    ];

    function _initLedger(orgId = 'default') {
        if (!_localLedger.has(orgId)) {
            const orgMap = new Map();
            DEFAULT_SEED_CALENDARS.forEach(cal => {
                const calCopy = JSON.parse(JSON.stringify(cal));
                orgMap.set(calCopy.calendarCode, calCopy);
            });
            _localLedger.set(orgId, orgMap);
        }
        return _localLedger.get(orgId);
    }

    function getFirestoreDb() {
        if (typeof window !== 'undefined' && window.firebaseDb) {
            return window.firebaseDb;
        }
        if (typeof window !== 'undefined' && window.db) {
            return window.db;
        }
        return null;
    }

    function normalizeLocationCode(loc) {
        if (!loc) return '';
        return String(loc).trim().toUpperCase();
    }

    async function createOrUpdateCalendar(orgId, calendarData) {
        if (!orgId) throw new Error("Missing mandatory 'orgId'.");
        if (!calendarData || !calendarData.calendarCode) {
            throw new Error("Missing mandatory 'calendarCode'.");
        }

        const orgMap = _initLedger(orgId);
        const code = calendarData.calendarCode.toUpperCase();
        const existing = orgMap.get(code) || {};

        const record = {
            calendarCode: code,
            calendarName: calendarData.calendarName || existing.calendarName || code,
            locationCode: normalizeLocationCode(calendarData.locationCode || existing.locationCode || 'LOC_BLR_01'),
            year: Number(calendarData.year) || existing.year || 2026,
            isActive: calendarData.isActive !== undefined ? Boolean(calendarData.isActive) : true,
            holidays: Array.isArray(calendarData.holidays) ? calendarData.holidays : (existing.holidays || []),
            updatedAt: new Date().toISOString(),
            createdAt: existing.createdAt || new Date().toISOString()
        };

        orgMap.set(code, record);

        try {
            const db = getFirestoreDb();
            if (db && typeof window !== 'undefined' && window.firebaseFirestore) {
                const { doc, setDoc } = window.firebaseFirestore;
                const calRef = doc(db, `organizations/${orgId}/holiday_calendars`, code);
                await setDoc(calRef, {
                    calendarCode: record.calendarCode,
                    calendarName: record.calendarName,
                    locationCode: record.locationCode,
                    year: record.year,
                    isActive: record.isActive,
                    totalHolidays: record.holidays.length,
                    createdAt: record.createdAt,
                    updatedAt: record.updatedAt
                }, { merge: true });
            }
        } catch (e) {
            console.warn("Firestore calendar sync note:", e.message || e);
        }

        return record;
    }

    async function getCalendar(orgId, calendarCode) {
        const orgMap = _initLedger(orgId);
        const code = (calendarCode || '').toUpperCase();
        if (orgMap.has(code)) {
            return JSON.parse(JSON.stringify(orgMap.get(code)));
        }

        try {
            const db = getFirestoreDb();
            if (db && typeof window !== 'undefined' && window.firebaseFirestore) {
                const { doc, getDoc, collection, getDocs } = window.firebaseFirestore;
                const calRef = doc(db, `organizations/${orgId}/holiday_calendars`, code);
                const snap = await getDoc(calRef);
                if (snap.exists()) {
                    const data = snap.data();
                    const subColl = collection(db, `organizations/${orgId}/holiday_calendars/${code}/holidays`);
                    const subSnap = await getDocs(subColl);
                    data.holidays = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                    orgMap.set(code, data);
                    return data;
                }
            }
        } catch (e) {
            console.warn("Firestore fetch calendar note:", e.message || e);
        }

        return null;
    }

    async function listCalendars(orgId = 'default', filter = {}) {
        const orgMap = _initLedger(orgId);
        let list = Array.from(orgMap.values());

        if (filter.locationCode) {
            const targetLoc = normalizeLocationCode(filter.locationCode);
            list = list.filter(c => normalizeLocationCode(c.locationCode) === targetLoc || targetLoc === 'ALL');
        }
        if (filter.year) {
            list = list.filter(c => Number(c.year) === Number(filter.year));
        }
        if (filter.isActive !== undefined) {
            list = list.filter(c => Boolean(c.isActive) === Boolean(filter.isActive));
        }

        return JSON.parse(JSON.stringify(list));
    }

    async function deleteCalendar(orgId, calendarCode) {
        const orgMap = _initLedger(orgId);
        const code = (calendarCode || '').toUpperCase();
        const existed = orgMap.delete(code);

        try {
            const db = getFirestoreDb();
            if (db && typeof window !== 'undefined' && window.firebaseFirestore) {
                const { doc, deleteDoc } = window.firebaseFirestore;
                const calRef = doc(db, `organizations/${orgId}/holiday_calendars`, code);
                await deleteDoc(calRef);
            }
        } catch (e) {
            console.warn("Firestore calendar deletion note:", e.message || e);
        }

        return existed;
    }

    async function saveHoliday(orgId, calendarCode, holidayData) {
        if (!orgId) throw new Error("Missing mandatory 'orgId'.");
        if (!calendarCode) throw new Error("Missing mandatory 'calendarCode'.");
        if (!holidayData || !holidayData.holidayDate) {
            throw new Error("Missing mandatory 'holidayDate'.");
        }
        if (!holidayData.holidayName) {
            throw new Error("Missing mandatory 'holidayName'.");
        }

        const orgMap = _initLedger(orgId);
        const cCode = calendarCode.toUpperCase();
        let cal = orgMap.get(cCode);

        const locCode = normalizeLocationCode(holidayData.locationCode || (cal ? cal.locationCode : 'LOC_BLR_01'));
        if (!cal) {
            cal = await createOrUpdateCalendar(orgId, {
                calendarCode: cCode,
                calendarName: holidayData.calendarName || `${cCode} Calendar`,
                locationCode: locCode,
                year: parseInt(holidayData.holidayDate.split('-')[0], 10) || 2026,
                isActive: true,
                holidays: []
            });
        }

        const holidayId = holidayData.id || `${locCode}_${holidayData.holidayDate}`.replace(/[^A-Za-z0-9_-]/g, '_');
        const holidayDoc = {
            id: holidayId,
            calendarCode: cCode,
            calendarName: holidayData.calendarName || cal.calendarName,
            locationCode: locCode,
            holidayDate: holidayData.holidayDate,
            holidayName: holidayData.holidayName,
            holidayType: holidayData.holidayType || 'National',
            isOptional: Boolean(holidayData.isOptional),
            isPaid: holidayData.isPaid !== undefined ? Boolean(holidayData.isPaid) : true,
            isActive: holidayData.isActive !== undefined ? Boolean(holidayData.isActive) : true,
            createdAt: holidayData.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        cal.holidays = cal.holidays || [];
        const existingIdx = cal.holidays.findIndex(h => h.id === holidayId || (h.holidayDate === holidayDoc.holidayDate && normalizeLocationCode(h.locationCode) === locCode));

        if (existingIdx >= 0) {
            cal.holidays[existingIdx] = holidayDoc;
        } else {
            cal.holidays.push(holidayDoc);
        }

        cal.holidays.sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));

        try {
            const db = getFirestoreDb();
            if (db && typeof window !== 'undefined' && window.firebaseFirestore) {
                const { doc, setDoc } = window.firebaseFirestore;
                const hRef = doc(db, `organizations/${orgId}/holiday_calendars/${cCode}/holidays`, holidayId);
                await setDoc(hRef, holidayDoc, { merge: true });

                const globalHRef = doc(db, 'holidays', holidayId);
                await setDoc(globalHRef, {
                    name: holidayDoc.holidayName,
                    date: holidayDoc.holidayDate,
                    type: holidayDoc.holidayType,
                    locationCode: holidayDoc.locationCode,
                    calendarCode: holidayDoc.calendarCode,
                    isOptional: holidayDoc.isOptional,
                    isPaid: holidayDoc.isPaid,
                    isActive: holidayDoc.isActive,
                    updatedAt: holidayDoc.updatedAt
                }, { merge: true });
            }
        } catch (e) {
            console.warn("Firestore holiday persistence note:", e.message || e);
        }

        return holidayDoc;
    }

    async function ingestParsedHolidaySheet(orgId, parsedResult) {
        if (!parsedResult || !parsedResult.valid) {
            throw new Error("Cannot ingest invalid parsed holiday dataset.");
        }

        const firestoreDocs = parsedResult.firestoreDocs || [];
        const ingested = [];
        const errors = [];

        for (const docObj of firestoreDocs) {
            try {
                const saved = await saveHoliday(orgId, docObj.calendarCode, docObj);
                ingested.push(saved);
            } catch (err) {
                errors.push(`Holiday '${docObj.holidayName}' on ${docObj.holidayDate}: ${err.message}`);
            }
        }

        return {
            success: errors.length === 0,
            total: firestoreDocs.length,
            ingestedCount: ingested.length,
            errors,
            ingested
        };
    }

    async function deleteHoliday(orgId, calendarCode, holidayId) {
        const orgMap = _initLedger(orgId);
        const cCode = (calendarCode || '').toUpperCase();
        const cal = orgMap.get(cCode);
        if (!cal || !cal.holidays) return false;

        const idx = cal.holidays.findIndex(h => h.id === holidayId);
        if (idx === -1) return false;

        cal.holidays.splice(idx, 1);

        try {
            const db = getFirestoreDb();
            if (db && typeof window !== 'undefined' && window.firebaseFirestore) {
                const { doc, deleteDoc } = window.firebaseFirestore;
                const hRef = doc(db, `organizations/${orgId}/holiday_calendars/${cCode}/holidays`, holidayId);
                await deleteDoc(hRef);
                const globalHRef = doc(db, 'holidays', holidayId);
                await deleteDoc(globalHRef);
            }
        } catch (e) {
            console.warn("Firestore holiday deletion note:", e.message || e);
        }

        return true;
    }

    async function toggleHolidayFlag(orgId, calendarCode, holidayId, flagName) {
        const orgMap = _initLedger(orgId);
        const cCode = (calendarCode || '').toUpperCase();
        const cal = orgMap.get(cCode);
        if (!cal || !cal.holidays) throw new Error("Calendar not found.");

        const holiday = cal.holidays.find(h => h.id === holidayId);
        if (!holiday) throw new Error("Holiday not found in calendar.");

        if (!['isOptional', 'isPaid', 'isActive'].includes(flagName)) {
            throw new Error(`Invalid flagName: ${flagName}`);
        }

        holiday[flagName] = !holiday[flagName];
        holiday.updatedAt = new Date().toISOString();

        await saveHoliday(orgId, cCode, holiday);
        return holiday;
    }

    async function resolveEmployeeHolidayCalendar(orgId, employeeOrLocation, asOfDate = new Date()) {
        const orgMap = _initLedger(orgId);
        let locationCode = 'LOC_BLR_01';

        if (typeof employeeOrLocation === 'string') {
            if (employeeOrLocation.startsWith('LOC') || employeeOrLocation === 'ALL') {
                locationCode = employeeOrLocation;
            } else {
                locationCode = await getEmployeeLocation(orgId, employeeOrLocation);
            }
        } else if (employeeOrLocation && typeof employeeOrLocation === 'object') {
            locationCode = employeeOrLocation.locationCode || employeeOrLocation.location || 'LOC_BLR_01';
        }

        const normLoc = normalizeLocationCode(locationCode);
        const targetYear = typeof asOfDate === 'string' 
            ? parseInt(asOfDate.split('-')[0], 10) 
            : (asOfDate instanceof Date ? asOfDate.getFullYear() : 2026);

        let matched = null;
        for (const cal of orgMap.values()) {
            if (!cal.isActive) continue;
            const calLoc = normalizeLocationCode(cal.locationCode);
            if ((calLoc === normLoc || calLoc === 'ALL' || calLoc.replace(/-/g, '_') === normLoc.replace(/-/g, '_')) && Number(cal.year) === Number(targetYear)) {
                matched = cal;
                break;
            }
        }

        if (!matched) {
            for (const cal of orgMap.values()) {
                if (cal.isActive && Number(cal.year) === Number(targetYear)) {
                    matched = cal;
                    break;
                }
            }
        }

        if (!matched && orgMap.size > 0) {
            matched = Array.from(orgMap.values())[0];
        }

        return matched ? JSON.parse(JSON.stringify(matched)) : null;
    }

    async function getEmployeeLocation(orgId, employeeId) {
        if (!employeeId) return 'LOC_BLR_01';
        try {
            const db = getFirestoreDb();
            if (db && typeof window !== 'undefined' && window.firebaseFirestore) {
                const { doc, getDoc } = window.firebaseFirestore;
                const uRef = doc(db, 'users', employeeId);
                const snap = await getDoc(uRef);
                if (snap.exists()) {
                    const d = snap.data();
                    return d.locationCode || d.location || d.branchCode || 'LOC_BLR_01';
                }
            }
        } catch (e) {
            // ignore
        }
        return 'LOC_BLR_01';
    }

    async function isDateHolidayForEmployee(orgId, employeeOrLocation, dateStr) {
        const cal = await resolveEmployeeHolidayCalendar(orgId, employeeOrLocation, dateStr);
        if (!cal || !Array.isArray(cal.holidays)) {
            return { isHoliday: false, holiday: null };
        }

        const match = cal.holidays.find(h => h.holidayDate === dateStr && h.isActive !== false);
        if (!match) {
            return { isHoliday: false, holiday: null };
        }

        return {
            isHoliday: true,
            isMandatory: !match.isOptional,
            isOptional: Boolean(match.isOptional),
            isPaid: Boolean(match.isPaid),
            holidayName: match.holidayName,
            holidayType: match.holidayType,
            calendarCode: cal.calendarCode,
            locationCode: match.locationCode,
            holiday: match
        };
    }

    async function evaluateDailyAttendance(punchLog, employeeOrLocation, dateStr, options = {}) {
        const orgId = options.orgId || 'default';
        const holidayStatus = await isDateHolidayForEmployee(orgId, employeeOrLocation, dateStr);

        const hasPunchIn = punchLog && (punchLog.punchIn || punchLog.inTime || (punchLog.durationHours && punchLog.durationHours > 0));

        if (holidayStatus.isHoliday && holidayStatus.isMandatory) {
            if (!hasPunchIn) {
                return {
                    status: 'HOLIDAY',
                    isHoliday: true,
                    holidayName: holidayStatus.holidayName,
                    holidayType: holidayStatus.holidayType,
                    isPaid: holidayStatus.isPaid,
                    holidayWorked: false,
                    holidayOvertimeEligible: false,
                    compOffAccrualEligible: false,
                    reason: `Official Organization Closure: ${holidayStatus.holidayName}`
                };
            }

            if (holidayStatus.isPaid) {
                return {
                    status: 'HOLIDAY_WORKED',
                    isHoliday: true,
                    holidayName: holidayStatus.holidayName,
                    holidayType: holidayStatus.holidayType,
                    isPaid: true,
                    holidayWorked: true,
                    holidayOvertimeEligible: true,
                    compOffAccrualEligible: true,
                    compOffCredits: 1,
                    reason: `Punched in on Paid Public Holiday: ${holidayStatus.holidayName}. Eligible for 2x overtime rate or 1 Comp-Off accrual.`
                };
            } else {
                return {
                    status: 'HOLIDAY_WORKED',
                    isHoliday: true,
                    holidayName: holidayStatus.holidayName,
                    holidayType: holidayStatus.holidayType,
                    isPaid: false,
                    holidayWorked: true,
                    holidayOvertimeEligible: false,
                    compOffAccrualEligible: true,
                    compOffCredits: 1,
                    reason: `Worked on Unpaid Holiday: ${holidayStatus.holidayName}. Eligible for 1 Comp-Off credit.`
                };
            }
        }

        if (holidayStatus.isHoliday && holidayStatus.isOptional) {
            const employeeId = typeof employeeOrLocation === 'string' ? employeeOrLocation : (punchLog?.employeeId || punchLog?.userId);
            const isClaimed = hasClaimedOptionalHoliday(orgId, employeeId, dateStr);

            if (isClaimed) {
                if (!hasPunchIn) {
                    return {
                        status: 'OPTIONAL_HOLIDAY_TAKEN',
                        isHoliday: true,
                        holidayName: holidayStatus.holidayName,
                        holidayType: holidayStatus.holidayType,
                        isPaid: holidayStatus.isPaid,
                        holidayWorked: false,
                        holidayOvertimeEligible: false,
                        compOffAccrualEligible: false,
                        reason: `Optional Floating Holiday claimed: ${holidayStatus.holidayName}`
                    };
                } else {
                    return {
                        status: 'HOLIDAY_WORKED',
                        isHoliday: true,
                        holidayName: holidayStatus.holidayName,
                        holidayType: holidayStatus.holidayType,
                        isPaid: holidayStatus.isPaid,
                        holidayWorked: true,
                        holidayOvertimeEligible: true,
                        compOffAccrualEligible: true,
                        compOffCredits: 1,
                        reason: `Punched in on claimed optional holiday: ${holidayStatus.holidayName}.`
                    };
                }
            }
        }

        return {
            status: hasPunchIn ? 'PRESENT' : 'ABSENT',
            isHoliday: false,
            holidayWorked: false,
            holidayOvertimeEligible: false,
            compOffAccrualEligible: false
        };
    }

    async function getOptionalHolidaysForEmployee(orgId, employeeId, year = 2026) {
        const cal = await resolveEmployeeHolidayCalendar(orgId, employeeId, `${year}-01-01`);
        if (!cal || !Array.isArray(cal.holidays)) return [];

        const claims = _getEmployeeClaims(orgId, employeeId);
        const claimedDates = new Set(claims.map(c => c.holidayDate));

        return cal.holidays
            .filter(h => h.isOptional && h.isActive !== false)
            .map(h => ({
                ...h,
                isClaimed: claimedDates.has(h.holidayDate),
                claimDetails: claims.find(c => c.holidayDate === h.holidayDate) || null
            }));
    }

    async function applyOptionalHoliday(orgId, employeeId, holidayId, dateStr, reason = 'Floating Holiday Request') {
        if (!employeeId) throw new Error("Missing mandatory 'employeeId'.");
        if (!holidayId && !dateStr) throw new Error("Missing holiday identifier or date.");

        const cal = await resolveEmployeeHolidayCalendar(orgId, employeeId, dateStr);
        if (!cal || !Array.isArray(cal.holidays)) {
            throw new Error("No active holiday calendar found for employee location.");
        }

        const holiday = cal.holidays.find(h => (holidayId && h.id === holidayId) || (dateStr && h.holidayDate === dateStr));
        if (!holiday) {
            throw new Error("Specified holiday was not found in employee's location calendar.");
        }
        if (!holiday.isOptional) {
            throw new Error(`'${holiday.holidayName}' is a mandatory organization holiday and does not need to be claimed.`);
        }

        const claims = _getEmployeeClaims(orgId, employeeId);
        const annualQuota = 2;

        if (claims.length >= annualQuota) {
            throw new Error(`Optional Holiday Quota exceeded. Annual maximum is ${annualQuota} floating holidays per year.`);
        }

        if (claims.some(c => c.holidayDate === holiday.holidayDate)) {
            throw new Error(`Optional holiday '${holiday.holidayName}' has already been claimed.`);
        }

        const claimRecord = {
            id: `OPT_CLAIM_${employeeId}_${holiday.holidayDate}`,
            employeeId,
            holidayId: holiday.id,
            holidayDate: holiday.holidayDate,
            holidayName: holiday.holidayName,
            calendarCode: cal.calendarCode,
            status: 'APPROVED',
            reason,
            claimedAt: new Date().toISOString()
        };

        claims.push(claimRecord);

        try {
            const db = getFirestoreDb();
            if (db && typeof window !== 'undefined' && window.firebaseFirestore) {
                const { doc, setDoc } = window.firebaseFirestore;
                const claimRef = doc(db, `organizations/${orgId}/optional_holiday_claims`, claimRecord.id);
                await setDoc(claimRef, claimRecord, { merge: true });
            }
        } catch (e) {
            console.warn("Firestore optional holiday claim sync note:", e.message || e);
        }

        return claimRecord;
    }

    function _getEmployeeClaims(orgId, employeeId) {
        const key = `${orgId}__${employeeId}`;
        if (!_optionalClaimsLedger.has(key)) {
            _optionalClaimsLedger.set(key, []);
        }
        return _optionalClaimsLedger.get(key);
    }

    function hasClaimedOptionalHoliday(orgId, employeeId, dateStr) {
        const claims = _getEmployeeClaims(orgId, employeeId);
        return claims.some(c => c.holidayDate === dateStr && c.status === 'APPROVED');
    }

    function evaluatePayrollHolidayImpact(params = {}) {
        const {
            monthlyGross = 60000,
            monthDays = 30,
            holidayRecords = [],
            workedHolidayDates = []
        } = params;

        const dailyRate = Number(monthlyGross) / Number(monthDays);
        let paidHolidayCount = 0;
        let unpaidHolidayCount = 0;
        let workedHolidayCount = 0;
        let lopDays = 0;
        let overtimePay = 0;

        const workedDatesSet = new Set(workedHolidayDates);

        holidayRecords.forEach(h => {
            if (h.isActive === false) return;

            const isWorked = workedDatesSet.has(h.holidayDate);
            if (isWorked) {
                workedHolidayCount++;
                overtimePay += (dailyRate * 1.0);
            }

            if (h.isPaid !== false) {
                paidHolidayCount++;
            } else {
                unpaidHolidayCount++;
                if (!isWorked) {
                    lopDays += 1;
                }
            }
        });

        const lopDeduction = lopDays * dailyRate;
        const holidayPayCredit = paidHolidayCount * dailyRate;

        return {
            totalHolidays: holidayRecords.length,
            paidHolidayCount,
            unpaidHolidayCount,
            workedHolidayCount,
            lopDays,
            lopDeduction: Math.round(lopDeduction * 100) / 100,
            holidayPayCredit: Math.round(holidayPayCredit * 100) / 100,
            overtimePay: Math.round(overtimePay * 100) / 100,
            dailyRate: Math.round(dailyRate * 100) / 100
        };
    }

    function renderAdminHolidayConsole(containerId, options = {}) {
        const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (!container) return;

        const orgId = options.orgId || 'default';
        const orgMap = _initLedger(orgId);
        const calendars = Array.from(orgMap.values());
        const selectedCalCode = options.selectedCalendarCode || (calendars[0]?.calendarCode || 'HOL_BLR_2026');
        const activeCal = orgMap.get(selectedCalCode) || calendars[0] || DEFAULT_SEED_CALENDARS[0];

        const holidays = activeCal.holidays || [];
        const totalHolidays = holidays.length;
        const mandatoryCount = holidays.filter(h => !h.isOptional).length;
        const optionalCount = holidays.filter(h => h.isOptional).length;

        const activeTab = options.activeTab || 'list';

        container.innerHTML = `
            <div class="holiday-admin-console" style="display: flex; flex-direction: column; gap: 1.5rem; font-family: inherit;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <h2 style="font-size: 1.45rem; font-weight: 800; color: #0f172a; margin: 0 0 4px 0; display: flex; align-items: center; gap: 10px;">
                            <span style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #ec4899, #be185d); color: white;">📅</span>
                            Holiday Calendars & Location Governance
                        </h2>
                        <p style="font-size: 0.85rem; color: #64748b; margin: 0;">PRD Sections 1, 4, 15, & 16: Configure regional office closures, optional floating quotas, and attendance/payroll interlocks.</p>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button type="button" class="btn" id="btnAdminAddHoliday" style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 12px; background: #4f46e5; color: white; font-weight: 700; border: none; cursor: pointer; font-size: 0.85rem; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.25);">
                            + Add Holiday
                        </button>
                        <button type="button" class="btn" id="btnAdminAddCalendar" style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border-radius: 12px; background: white; color: #0f172a; border: 1px solid #cbd5e1; font-weight: 700; cursor: pointer; font-size: 0.85rem;">
                            + New Calendar
                        </button>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Active Calendars</div>
                        <div style="font-size: 1.75rem; font-weight: 800; color: #4f46e5; margin-top: 4px;">${calendars.length}</div>
                        <div style="font-size: 0.72rem; color: #10b981; font-weight: 600; margin-top: 2px;">Multi-location sets mapped</div>
                    </div>
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Total Annual Holidays</div>
                        <div style="font-size: 1.75rem; font-weight: 800; color: #0f172a; margin-top: 4px;">${totalHolidays}</div>
                        <div style="font-size: 0.72rem; color: #64748b; font-weight: 600; margin-top: 2px;">Year ${activeCal.year || 2026} closures</div>
                    </div>
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Mandatory Closures</div>
                        <div style="font-size: 1.75rem; font-weight: 800; color: #059669; margin-top: 4px;">${mandatoryCount}</div>
                        <div style="font-size: 0.72rem; color: #059669; font-weight: 600; margin-top: 2px;">Compulsory paid leaves</div>
                    </div>
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Optional / Floating</div>
                        <div style="font-size: 1.75rem; font-weight: 800; color: #d97706; margin-top: 4px;">${optionalCount}</div>
                        <div style="font-size: 0.72rem; color: #d97706; font-weight: 600; margin-top: 2px;">Quota: 2 claims / year</div>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; background: white; padding: 1rem 1.25rem; border-radius: 16px; border: 1px solid #e2e8f0;">
                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <label style="font-size: 0.85rem; font-weight: 700; color: #334155;">Active Calendar Set:</label>
                        <select id="calSetSelect" style="padding: 8px 14px; border-radius: 10px; border: 1px solid #cbd5e1; font-weight: 700; font-size: 0.85rem; outline: none; background: #f8fafc;">
                            ${calendars.map(c => `
                                <option value="${c.calendarCode}" ${c.calendarCode === selectedCalCode ? 'selected' : ''}>
                                    ${c.calendarName} (${c.locationCode})
                                </option>
                            `).join('')}
                        </select>
                        <span style="display: inline-block; padding: 4px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 800; background: #dcfce7; color: #166534;">
                            ${activeCal.locationCode} ACTIVE
                        </span>
                    </div>

                    <div style="display: flex; gap: 6px; background: #f1f5f9; padding: 4px; border-radius: 12px;">
                        <button type="button" id="btnViewList" style="padding: 6px 16px; border-radius: 8px; font-size: 0.8rem; font-weight: 700; cursor: pointer; border: none; ${activeTab === 'list' ? 'background: white; color: #0f172a; box-shadow: 0 1px 2px rgba(0,0,0,0.1);' : 'background: transparent; color: #64748b;'}">
                            📋 List View
                        </button>
                        <button type="button" id="btnViewCalendar" style="padding: 6px 16px; border-radius: 8px; font-size: 0.8rem; font-weight: 700; cursor: pointer; border: none; ${activeTab === 'calendar' ? 'background: white; color: #0f172a; box-shadow: 0 1px 2px rgba(0,0,0,0.1);' : 'background: transparent; color: #64748b;'}">
                            🗓️ Annual Calendar View
                        </button>
                    </div>
                </div>

                ${activeTab === 'list' ? `
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="overflow-x: auto;">
                            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                                <thead>
                                    <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px;">
                                        <th style="padding: 12px 16px;">Date</th>
                                        <th style="padding: 12px 16px;">Holiday Name</th>
                                        <th style="padding: 12px 16px;">Type</th>
                                        <th style="padding: 12px 16px; text-align: center;">Optional (Floating)</th>
                                        <th style="padding: 12px 16px; text-align: center;">Paid Holiday</th>
                                        <th style="padding: 12px 16px; text-align: center;">Active</th>
                                        <th style="padding: 12px 16px; text-align: right;">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${holidays.length === 0 ? `
                                        <tr><td colspan="7" style="text-align: center; padding: 2rem; color: #94a3b8;">No holidays scheduled under this calendar. Click '+ Add Holiday' to create entries.</td></tr>
                                    ` : holidays.map((h, i) => `
                                        <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                                            <td style="padding: 14px 16px; font-weight: 700; color: #0f172a; font-family: monospace;">
                                                ${h.holidayDate}
                                            </td>
                                            <td style="padding: 14px 16px; font-weight: 700; color: #1e293b;">
                                                ${h.holidayName}
                                            </td>
                                            <td style="padding: 14px 16px;">
                                                <span style="display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 700; background: ${h.holidayType === 'National' ? '#dbeafe; color: #1e40af;' : (h.holidayType === 'Restricted' ? '#fef3c7; color: #92400e;' : '#e0e7ff; color: #3730a3;')};">
                                                    ${h.holidayType || 'National'}
                                                </span>
                                            </td>
                                            <td style="padding: 14px 16px; text-align: center;">
                                                <button type="button" class="toggle-flag-btn" data-cal="${activeCal.calendarCode}" data-id="${h.id}" data-flag="isOptional" style="background: none; border: none; cursor: pointer; font-size: 0.75rem; font-weight: 800; padding: 4px 10px; border-radius: 6px; ${h.isOptional ? 'background: #fef3c7; color: #b45309;' : 'background: #f1f5f9; color: #64748b;'}">
                                                    ${h.isOptional ? 'YES (Floating)' : 'NO (Mandatory)'}
                                                </button>
                                            </td>
                                            <td style="padding: 14px 16px; text-align: center;">
                                                <button type="button" class="toggle-flag-btn" data-cal="${activeCal.calendarCode}" data-id="${h.id}" data-flag="isPaid" style="background: none; border: none; cursor: pointer; font-size: 0.75rem; font-weight: 800; padding: 4px 10px; border-radius: 6px; ${h.isPaid ? 'background: #dcfce7; color: #15803d;' : 'background: #fee2e2; color: #b91c1c;'}">
                                                    ${h.isPaid ? 'PAID (0 LOP)' : 'UNPAID'}
                                                </button>
                                            </td>
                                            <td style="padding: 14px 16px; text-align: center;">
                                                <button type="button" class="toggle-flag-btn" data-cal="${activeCal.calendarCode}" data-id="${h.id}" data-flag="isActive" style="background: none; border: none; cursor: pointer; font-size: 0.75rem; font-weight: 800; padding: 4px 10px; border-radius: 6px; ${h.isActive !== false ? 'background: #ecfdf5; color: #047857;' : 'background: #f1f5f9; color: #94a3b8;'}">
                                                    ${h.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                                                </button>
                                            </td>
                                            <td style="padding: 14px 16px; text-align: right;">
                                                <button type="button" class="delete-holiday-btn" data-cal="${activeCal.calendarCode}" data-id="${h.id}" style="background: none; border: 1px solid #fee2e2; color: #ef4444; border-radius: 8px; padding: 4px 10px; font-size: 0.72rem; font-weight: 700; cursor: pointer;">
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ` : `
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 18px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem;">
                            ${[0,1,2,3,4,5,6,7,8,9,10,11].map(m => {
                                const monthName = new Date(2026, m, 1).toLocaleString('default', { month: 'long' });
                                const mHolidays = holidays.filter(h => {
                                    const parts = h.holidayDate.split('-');
                                    return parseInt(parts[1], 10) === (m + 1);
                                });
                                return `
                                    <div style="border: 1px solid #e2e8f0; border-radius: 14px; padding: 1rem; background: #fafbfc;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                                            <strong style="color: #0f172a; font-size: 0.95rem;">${monthName} 2026</strong>
                                            <span style="font-size: 0.75rem; font-weight: 800; color: ${mHolidays.length ? '#4f46e5' : '#94a3b8'};">
                                                ${mHolidays.length} holiday${mHolidays.length === 1 ? '' : 's'}
                                            </span>
                                        </div>
                                        <div style="display: flex; flex-direction: column; gap: 6px;">
                                            ${mHolidays.length === 0 ? `
                                                <div style="font-size: 0.75rem; color: #94a3b8; font-style: italic; padding: 4px 0;">No closures</div>
                                            ` : mHolidays.map(h => `
                                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; padding: 6px 8px; border-radius: 8px; background: ${h.isOptional ? '#fffbeb' : '#f0fdf4'}; border: 1px solid ${h.isOptional ? '#fef3c7' : '#dcfce7'};">
                                                    <div>
                                                        <strong style="color: #0f172a;">${h.holidayDate.split('-')[2]}</strong>: ${h.holidayName}
                                                    </div>
                                                    <span style="font-size: 0.68rem; font-weight: 800; color: ${h.isOptional ? '#b45309' : '#15803d'};">
                                                        ${h.isOptional ? 'FLOATING' : 'MANDATORY'}
                                                    </span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `}
            </div>
        `;

        const calSelect = container.querySelector('#calSetSelect');
        if (calSelect) {
            calSelect.addEventListener('change', (e) => {
                renderAdminHolidayConsole(container, { orgId, selectedCalendarCode: e.target.value, activeTab });
            });
        }

        const btnList = container.querySelector('#btnViewList');
        const btnCal = container.querySelector('#btnViewCalendar');
        if (btnList) {
            btnList.addEventListener('click', () => {
                renderAdminHolidayConsole(container, { orgId, selectedCalendarCode, activeTab: 'list' });
            });
        }
        if (btnCal) {
            btnCal.addEventListener('click', () => {
                renderAdminHolidayConsole(container, { orgId, selectedCalendarCode, activeTab: 'calendar' });
            });
        }

        container.querySelectorAll('.toggle-flag-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const calCode = btn.getAttribute('data-cal');
                const hId = btn.getAttribute('data-id');
                const flag = btn.getAttribute('data-flag');
                try {
                    await toggleHolidayFlag(orgId, calCode, hId, flag);
                    renderAdminHolidayConsole(container, { orgId, selectedCalendarCode: calCode, activeTab });
                } catch (err) {
                    alert("Error toggling flag: " + err.message);
                }
            });
        });

        container.querySelectorAll('.delete-holiday-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const calCode = btn.getAttribute('data-cal');
                const hId = btn.getAttribute('data-id');
                if (confirm("Are you sure you want to remove this holiday closure?")) {
                    await deleteHoliday(orgId, calCode, hId);
                    renderAdminHolidayConsole(container, { orgId, selectedCalendarCode: calCode, activeTab });
                }
            });
        });

        const btnAdd = container.querySelector('#btnAdminAddHoliday');
        if (btnAdd) {
            btnAdd.addEventListener('click', () => {
                openAddHolidayModal(orgId, activeCal.calendarCode, container, activeTab);
            });
        }

        const btnNewCal = container.querySelector('#btnAdminAddCalendar');
        if (btnNewCal) {
            btnNewCal.addEventListener('click', () => {
                openAddCalendarModal(orgId, container, activeTab);
            });
        }
    }

    function openAddHolidayModal(orgId, defaultCalendarCode, container, activeTab) {
        const modalId = 'addHolidayDialogOverlay';
        let overlay = document.getElementById(modalId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.style.cssText = "position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(4px); z-index: 99999; display: flex; align-items: center; justify-content: center;";

        overlay.innerHTML = `
            <div style="background: white; border-radius: 20px; width: 440px; padding: 2rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); border: 1px solid #e2e8f0; font-family: inherit;">
                <h3 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0 0 1rem 0;">Add Annual Holiday</h3>
                <form id="addHolidayInnerForm" style="display: flex; flex-direction: column; gap: 1rem;">
                    <div>
                        <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Calendar Code</label>
                        <input type="text" id="hInpCalCode" value="${defaultCalendarCode}" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;" />
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Holiday Date (YYYY-MM-DD)</label>
                        <input type="date" id="hInpDate" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;" />
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Holiday Name</label>
                        <input type="text" id="hInpName" placeholder="e.g. Gandhi Jayanti" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;" />
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div>
                            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Type</label>
                            <select id="hInpType" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;">
                                <option value="National">National</option>
                                <option value="Regional">Regional</option>
                                <option value="Restricted">Restricted</option>
                                <option value="Company Floating">Company Floating</option>
                            </select>
                        </div>
                        <div>
                            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Location Code</label>
                            <input type="text" id="hInpLoc" value="LOC_BLR_01" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;" />
                        </div>
                    </div>
                    <div style="display: flex; gap: 1.5rem; margin-top: 4px;">
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer;">
                            <input type="checkbox" id="hInpOptional" /> Optional (Floating)
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer;">
                            <input type="checkbox" id="hInpPaid" checked /> Paid Holiday
                        </label>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 1rem;">
                        <button type="button" id="btnCancelHModal" style="padding: 8px 16px; border-radius: 10px; border: 1px solid #cbd5e1; background: white; font-weight: 700; cursor: pointer;">Cancel</button>
                        <button type="submit" style="padding: 8px 18px; border-radius: 10px; border: none; background: #4f46e5; color: white; font-weight: 700; cursor: pointer;">Save Holiday</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#btnCancelHModal').onclick = () => overlay.remove();
        overlay.querySelector('#addHolidayInnerForm').onsubmit = async (e) => {
            e.preventDefault();
            const calCode = overlay.querySelector('#hInpCalCode').value.trim();
            const holidayDate = overlay.querySelector('#hInpDate').value;
            const holidayName = overlay.querySelector('#hInpName').value.trim();
            const holidayType = overlay.querySelector('#hInpType').value;
            const locationCode = overlay.querySelector('#hInpLoc').value.trim();
            const isOptional = overlay.querySelector('#hInpOptional').checked;
            const isPaid = overlay.querySelector('#hInpPaid').checked;

            try {
                await saveHoliday(orgId, calCode, {
                    calendarCode: calCode,
                    holidayDate,
                    holidayName,
                    holidayType,
                    locationCode,
                    isOptional,
                    isPaid,
                    isActive: true
                });
                overlay.remove();
                renderAdminHolidayConsole(container, { orgId, selectedCalendarCode: calCode, activeTab });
            } catch (err) {
                alert("Failed to save holiday: " + err.message);
            }
        };
    }

    function openAddCalendarModal(orgId, container, activeTab) {
        const modalId = 'addCalendarDialogOverlay';
        let overlay = document.getElementById(modalId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.style.cssText = "position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(4px); z-index: 99999; display: flex; align-items: center; justify-content: center;";

        overlay.innerHTML = `
            <div style="background: white; border-radius: 20px; width: 440px; padding: 2rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); border: 1px solid #e2e8f0; font-family: inherit;">
                <h3 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0 0 1rem 0;">Create Holiday Calendar</h3>
                <form id="addCalendarInnerForm" style="display: flex; flex-direction: column; gap: 1rem;">
                    <div>
                        <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Calendar Code</label>
                        <input type="text" id="cInpCode" placeholder="e.g. HOL_DEL_2026" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;" />
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Calendar Name</label>
                        <input type="text" id="cInpName" placeholder="e.g. New Delhi NCR Office Calendar 2026" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;" />
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div>
                            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Location Code</label>
                            <input type="text" id="cInpLoc" placeholder="e.g. LOC_DEL_01" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;" />
                        </div>
                        <div>
                            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Year</label>
                            <input type="number" id="cInpYear" value="2026" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600; font-size: 0.85rem;" />
                        </div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 1rem;">
                        <button type="button" id="btnCancelCModal" style="padding: 8px 16px; border-radius: 10px; border: 1px solid #cbd5e1; background: white; font-weight: 700; cursor: pointer;">Cancel</button>
                        <button type="submit" style="padding: 8px 18px; border-radius: 10px; border: none; background: #4f46e5; color: white; font-weight: 700; cursor: pointer;">Create Set</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#btnCancelCModal').onclick = () => overlay.remove();
        overlay.querySelector('#addCalendarInnerForm').onsubmit = async (e) => {
            e.preventDefault();
            const calendarCode = overlay.querySelector('#cInpCode').value.trim();
            const calendarName = overlay.querySelector('#cInpName').value.trim();
            const locationCode = overlay.querySelector('#cInpLoc').value.trim();
            const year = parseInt(overlay.querySelector('#cInpYear').value, 10);

            try {
                await createOrUpdateCalendar(orgId, {
                    calendarCode,
                    calendarName,
                    locationCode,
                    year,
                    isActive: true,
                    holidays: []
                });
                overlay.remove();
                renderAdminHolidayConsole(container, { orgId, selectedCalendarCode: calendarCode, activeTab });
            } catch (err) {
                alert("Failed to create calendar: " + err.message);
            }
        };
    }

    return {
        DEFAULT_SEED_CALENDARS,
        createOrUpdateCalendar,
        getCalendar,
        listCalendars,
        deleteCalendar,
        saveHoliday,
        ingestParsedHolidaySheet,
        deleteHoliday,
        toggleHolidayFlag,
        resolveEmployeeHolidayCalendar,
        getEmployeeLocation,
        isDateHolidayForEmployee,
        evaluateDailyAttendance,
        getOptionalHolidaysForEmployee,
        applyOptionalHoliday,
        evaluatePayrollHolidayImpact,
        renderAdminHolidayConsole
    };
}));
