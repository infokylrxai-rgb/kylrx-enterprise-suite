/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - SHIFT CALCULATION & ATTENDANCE SERVICE
 * ============================================================================
 * 
 * Manages Shift policies, Firestore persistence, and Dynamic Attendance
 * Calculation Engine matching PRD Sections 1, 13, & 16:
 * 
 * 1. Cloud Firestore Data Architecture:
 *    - Path: organizations/{orgId}/shifts/{shiftCode}
 *    - Document Schema:
 *      {
 *        "shiftCode": "SH_GEN_01",
 *        "shiftName": "General Corporate Shift",
 *        "startTime": "09:30",
 *        "endTime": "18:30",
 *        "breakMinutes": 60,
 *        "graceInMinutes": 15,
 *        "graceOutMinutes": 15,
 *        "halfDayMinutes": 240,
 *        "fullDayMinutes": 480,
 *        "isNightShift": false,
 *        "isOvertimeEligible": true,
 *        "weeklyOffPattern": "Sun",
 *        "isActive": true,
 *        "createdAt": "serverTimestamp()",
 *        "updatedAt": "serverTimestamp()"
 *      }
 * 
 * 2. Dynamic Attendance Calculation Engine (PRD Section 16):
 *    - Late In: punchIn > (Start_Time + Grace_In_Minutes) => lateMinutes
 *    - Early Out: punchOut < (End_Time - Grace_Out_Minutes) => earlyMinutes
 *    - Net Duration: totalDurationMinutes - Break_Minutes
 *    - Status:
 *        netWorkedMinutes >= Full_Day_Minutes => 'PRESENT'
 *        netWorkedMinutes >= Half_Day_Minutes => 'HALF_DAY'
 *        else => 'ABSENT'
 *    - Overtime: if Overtime_Eligible & netWorkedMinutes > Full_Day_Minutes => overtimeMinutes
 *    - Night Shift: cross-midnight interval evaluation
 * 
 * 3. Weekly Off Pattern Evaluator:
 *    - Evaluates patterns like "Sun", "Sat,Sun", "2nd_4th_Sat,Sun"
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
        root.KylrxShiftCalculationService = factory();
        root.KylrxShiftService = root.KylrxShiftCalculationService;
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Default Enterprise Shifts seeded in accordance with PRD §§ 1, 13 & 16
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
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
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
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
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
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
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
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
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
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        }
    ];

    // In-memory store
    const shiftsMap = new Map();

    function initDefaults() {
        shiftsMap.clear();
        DEFAULT_SHIFTS.forEach(s => {
            shiftsMap.set(s.shiftCode.toUpperCase(), { ...s });
        });
    }
    initDefaults();

    /**
     * Resolves default organization ID
     */
    function getDefaultOrgId() {
        if (typeof window !== 'undefined' && window.state && window.state.orgId) {
            return window.state.orgId;
        }
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('orgId') || 'org_kylrx';
        }
        return 'org_kylrx';
    }

    /**
     * Firestore Path generator for shifts collection or document
     * Target: organizations/{orgId}/shifts/{shiftCode}
     */
    function getFirestorePath(shiftCode = '', orgId = getDefaultOrgId()) {
        const base = `organizations/${orgId}/shifts`;
        if (!shiftCode) return base;
        return `${base}/${String(shiftCode).trim().toUpperCase()}`;
    }

    /**
     * Helper to parse time string (HH:mm) into minutes from midnight (0 to 1439)
     */
    function timeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const clean = String(timeStr).trim();

        // Support full ISO / date strings (extract HH:mm)
        if (clean.includes('T') || clean.includes(' ') || clean.includes('-')) {
            const date = new Date(clean);
            if (!isNaN(date.getTime())) {
                return date.getHours() * 60 + date.getMinutes();
            }
        }

        const match = clean.match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])/);
        if (match) {
            return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
        }
        return 0;
    }

    /**
     * Helper to format minutes from midnight into HH:mm
     */
    function minutesToTime(totalMins) {
        const normalized = ((Math.floor(totalMins) % 1440) + 1440) % 1440;
        const h = Math.floor(normalized / 60);
        const m = normalized % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    /**
     * DYNAMIC ATTENDANCE CALCULATION ENGINE (PRD Section 16)
     * 
     * Ingests punch-in and punch-out events and evaluates against assigned shift rules:
     * - Late In: punchIn > (Start_Time + Grace_In_Minutes) => lateMinutes
     * - Early Out: punchOut < (End_Time - Grace_Out_Minutes) => earlyMinutes
     * - Duration: netWorkedMinutes = totalDurationMinutes - Break_Minutes
     * - Status:
     *     netWorkedMinutes >= Full_Day_Minutes => 'PRESENT'
     *     netWorkedMinutes >= Half_Day_Minutes => 'HALF_DAY'
     *     else => 'ABSENT'
     * - Overtime: if Overtime_Eligible & netWorkedMinutes > Full_Day_Minutes => overtimeMinutes
     * - Night Shift: Cross-midnight interval handling
     * 
     * @param {Object} params
     * @param {string|Date} params.punchIn - Punch in timestamp or "HH:mm"
     * @param {string|Date} params.punchOut - Punch out timestamp or "HH:mm"
     * @param {string} [params.shiftCode] - Shift code lookup
     * @param {Object} [params.shift] - Explicit shift object
     * @returns {Object} Evaluation report
     */
    function calculateAttendance({ punchIn, punchOut, shiftCode = 'SH_GEN_01', shift = null, punchDate = null } = {}) {
        const policy = shift || getShift(shiftCode) || DEFAULT_SHIFTS[0];

        const shiftStartTime = policy.startTime || '09:30';
        const shiftEndTime = policy.endTime || '18:30';
        const breakMinutes = Number(policy.breakMinutes !== undefined ? policy.breakMinutes : 60);
        const graceInMinutes = Number(policy.graceInMinutes !== undefined ? policy.graceInMinutes : 15);
        const graceOutMinutes = Number(policy.graceOutMinutes !== undefined ? policy.graceOutMinutes : 15);
        const halfDayMinutes = Number(policy.halfDayMinutes !== undefined ? policy.halfDayMinutes : 240);
        const fullDayMinutes = Number(policy.fullDayMinutes !== undefined ? policy.fullDayMinutes : 480);
        const isNightShift = Boolean(policy.isNightShift || policy.nightShift);
        const isOvertimeEligible = Boolean(policy.isOvertimeEligible || policy.overtimeEligible);

        // Missing punches check
        if (!punchIn && !punchOut) {
            return {
                shiftCode: policy.shiftCode,
                shiftName: policy.shiftName,
                status: 'ABSENT',
                punchIn: null,
                punchOut: null,
                totalDurationMinutes: 0,
                netWorkedMinutes: 0,
                breakMinutes,
                lateMinutes: 0,
                isLate: false,
                earlyMinutes: 0,
                isEarlyOut: false,
                overtimeMinutes: 0,
                isOvertime: false,
                isNightShift,
                isOvertimeEligible,
                remarks: 'No punch-in or punch-out recorded'
            };
        }

        // Single punch check
        if (!punchIn || !punchOut) {
            return {
                shiftCode: policy.shiftCode,
                shiftName: policy.shiftName,
                status: 'HALF_DAY',
                punchIn: punchIn ? String(punchIn) : null,
                punchOut: punchOut ? String(punchOut) : null,
                totalDurationMinutes: halfDayMinutes,
                netWorkedMinutes: halfDayMinutes,
                breakMinutes: 0,
                lateMinutes: 0,
                isLate: false,
                earlyMinutes: 0,
                isEarlyOut: false,
                overtimeMinutes: 0,
                isOvertime: false,
                isNightShift,
                isOvertimeEligible,
                remarks: 'Single punch detected (Missing punch in or punch out)'
            };
        }

        // Convert base shift times to minutes
        const shiftStartMins = timeToMinutes(shiftStartTime);
        let shiftEndMins = timeToMinutes(shiftEndTime);

        // Detect if shift spans cross-midnight
        const spansMidnight = isNightShift || (shiftEndMins < shiftStartMins);
        if (spansMidnight && shiftEndMins <= shiftStartMins) {
            shiftEndMins += 1440; // Add 24 hours
        }

        // Convert punch times to minutes
        let inMins = timeToMinutes(punchIn);
        let outMins = timeToMinutes(punchOut);

        // Handle cross-midnight punch timestamps
        if (punchIn instanceof Date && punchOut instanceof Date) {
            const diffMs = punchOut.getTime() - punchIn.getTime();
            const rawDiffMins = Math.max(0, Math.round(diffMs / 60000));
            outMins = inMins + rawDiffMins;
        } else if (typeof punchIn === 'string' && typeof punchOut === 'string' && punchIn.includes('-') && punchOut.includes('-')) {
            const inDate = new Date(punchIn);
            const outDate = new Date(punchOut);
            if (!isNaN(inDate.getTime()) && !isNaN(outDate.getTime())) {
                const rawDiffMins = Math.max(0, Math.round((outDate.getTime() - inDate.getTime()) / 60000));
                outMins = inMins + rawDiffMins;
            }
        } else if (spansMidnight) {
            // For time-only night shift evaluation (e.g. punchIn "22:10", punchOut "06:20")
            if (outMins < inMins) {
                outMins += 1440;
            } else if (inMins < 720 && outMins < 720) {
                // If both are early morning (e.g. arrived late at 01:00 and left 06:30)
                inMins += 1440;
                outMins += 1440;
            }
        } else if (outMins < inMins) {
            // Unintended cross-midnight on normal day shift
            outMins += 1440;
        }

        // 1. Late In Evaluation
        // Late In: punchIn > (Start_Time + Grace_In_Minutes)
        const graceInThreshold = shiftStartMins + graceInMinutes;
        const isLate = inMins > graceInThreshold;
        const lateMinutes = isLate ? Math.max(0, inMins - shiftStartMins) : 0;

        // 2. Early Out Evaluation
        // Early Out: punchOut < (End_Time - Grace_Out_Minutes)
        const graceOutThreshold = shiftEndMins - graceOutMinutes;
        const isEarlyOut = outMins < graceOutThreshold;
        const earlyMinutes = isEarlyOut ? Math.max(0, shiftEndMins - outMins) : 0;

        // 3. Duration & Break Deduction
        const totalDurationMinutes = Math.max(0, outMins - inMins);
        const netWorkedMinutes = Math.max(0, totalDurationMinutes - breakMinutes);

        // 4. Status Assignment
        // netWorkedMinutes >= Full_Day_Minutes => PRESENT
        // netWorkedMinutes >= Half_Day_Minutes => HALF_DAY
        // else => ABSENT
        let status = 'ABSENT';
        if (netWorkedMinutes >= fullDayMinutes) {
            status = 'PRESENT';
        } else if (netWorkedMinutes >= halfDayMinutes) {
            status = 'HALF_DAY';
        } else {
            status = 'ABSENT';
        }

        // 5. Overtime Calculation
        // If Overtime_Eligible is true and netWorkedMinutes > Full_Day_Minutes
        let overtimeMinutes = 0;
        let isOvertime = false;
        if (isOvertimeEligible && netWorkedMinutes > fullDayMinutes) {
            overtimeMinutes = netWorkedMinutes - fullDayMinutes;
            isOvertime = true;
        }

        return {
            shiftCode: policy.shiftCode,
            shiftName: policy.shiftName,
            punchIn: typeof punchIn === 'string' ? punchIn : minutesToTime(inMins),
            punchOut: typeof punchOut === 'string' ? punchOut : minutesToTime(outMins),
            startTime: shiftStartTime,
            endTime: shiftEndTime,
            totalDurationMinutes,
            netWorkedMinutes,
            breakMinutes,
            lateMinutes,
            isLate,
            earlyMinutes,
            isEarlyOut,
            overtimeMinutes,
            isOvertime,
            status,
            isNightShift,
            isOvertimeEligible,
            weeklyOffPattern: policy.weeklyOffPattern || 'Sun'
        };
    }

    /**
     * WEEKLY OFF PATTERN EVALUATOR
     * Evaluates if a given calendar date is an off-day based on the Weekly_Off_Pattern:
     * - "Sun" -> Every Sunday
     * - "Sat,Sun" -> Every Saturday and Sunday
     * - "2nd_4th_Sat,Sun" -> 2nd & 4th Saturday of the month and every Sunday
     * - "Fri" -> Every Friday
     * 
     * @param {Date|string} dateInput
     * @param {string} pattern
     * @returns {boolean} true if date is a scheduled weekly off
     */
    function isWeeklyOff(dateInput, pattern = 'Sun') {
        if (!dateInput) return false;
        const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
        if (isNaN(d.getTime())) return false;

        const dayOfWeek = d.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat
        const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        const currentDayName = dayNames[dayOfWeek];

        const cleanPattern = String(pattern || '').trim().toUpperCase();
        const tokens = cleanPattern.split(',').map(t => t.trim());

        // Check simple day match (e.g. "SUN", "SAT")
        if (tokens.includes(currentDayName)) {
            return true;
        }

        // Special rule for Saturdays (e.g. "2ND_4TH_SAT")
        if (dayOfWeek === 6) {
            // Find which Saturday of the month this is (1st, 2nd, 3rd, 4th, or 5th)
            const dateNum = d.getDate();
            const satIndex = Math.ceil(dateNum / 7);

            for (const t of tokens) {
                if (t === '2ND_4TH_SAT' || t === '2ND_4TH_SATURDAY') {
                    if (satIndex === 2 || satIndex === 4) return true;
                }
                if (t === '1ST_3RD_5TH_SAT') {
                    if (satIndex === 1 || satIndex === 3 || satIndex === 5) return true;
                }
                if (t === `${satIndex}TH_SAT` || t === `${satIndex}ND_SAT` || t === `${satIndex}RD_SAT` || t === `${satIndex}ST_SAT`) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * READ: Returns all shifts in cache
     */
    function getAllShifts() {
        return Array.from(shiftsMap.values());
    }

    /**
     * READ: Returns only active shifts
     */
    function getActiveShifts() {
        return Array.from(shiftsMap.values()).filter(s => s.isActive !== false && s.active !== false);
    }

    /**
     * READ: Returns single shift by code
     */
    function getShift(shiftCode) {
        if (!shiftCode) return null;
        return shiftsMap.get(String(shiftCode).trim().toUpperCase()) || null;
    }

    /**
     * CREATE: Adds a new Shift and persists to Cloud Firestore
     */
    async function createShift(shiftData, orgId = getDefaultOrgId()) {
        const rawCode = shiftData.shiftCode || shiftData['Shift_Code'] || shiftData.code;
        const rawName = shiftData.shiftName || shiftData['Shift_Name'] || shiftData.name;

        if (!rawCode) throw new Error("Shift Code ('Shift_Code') is required.");
        if (!rawName) throw new Error("Shift Name ('Shift_Name') is required.");

        const cleanCode = String(rawCode).trim().toUpperCase().replace(/\s+/g, '_');
        const cleanName = String(rawName).trim();

        const startTime = shiftData.startTime || shiftData['Start_Time'] || '09:30';
        const endTime = shiftData.endTime || shiftData['End_Time'] || '18:30';
        const breakMinutes = Number(shiftData.breakMinutes !== undefined ? shiftData.breakMinutes : (shiftData['Break_Minutes'] !== undefined ? shiftData['Break_Minutes'] : 60));
        const graceInMinutes = Number(shiftData.graceInMinutes !== undefined ? shiftData.graceInMinutes : (shiftData['Grace_In_Minutes'] !== undefined ? shiftData['Grace_In_Minutes'] : 15));
        const graceOutMinutes = Number(shiftData.graceOutMinutes !== undefined ? shiftData.graceOutMinutes : (shiftData['Grace_Out_Minutes'] !== undefined ? shiftData['Grace_Out_Minutes'] : 15));
        const halfDayMinutes = Number(shiftData.halfDayMinutes !== undefined ? shiftData.halfDayMinutes : (shiftData['Half_Day_Minutes'] !== undefined ? shiftData['Half_Day_Minutes'] : 240));
        const fullDayMinutes = Number(shiftData.fullDayMinutes !== undefined ? shiftData.fullDayMinutes : (shiftData['Full_Day_Minutes'] !== undefined ? shiftData['Full_Day_Minutes'] : 480));

        const isNightShift = Boolean(shiftData.isNightShift !== undefined ? shiftData.isNightShift : (shiftData['Night_Shift'] === 'Yes' || shiftData['Night_Shift'] === true));
        const isOvertimeEligible = Boolean(shiftData.isOvertimeEligible !== undefined ? shiftData.isOvertimeEligible : (shiftData['Overtime_Eligible'] !== 'No' && shiftData['Overtime_Eligible'] !== false));
        const weeklyOffPattern = shiftData.weeklyOffPattern || shiftData['Weekly_Off_Pattern'] || 'Sun';

        let isActive = true;
        const rawActive = shiftData.isActive !== undefined ? shiftData.isActive : shiftData['Active'];
        if (typeof rawActive === 'boolean') {
            isActive = rawActive;
        } else if (rawActive !== undefined && rawActive !== null) {
            const s = String(rawActive).trim().toLowerCase();
            isActive = (s === 'yes' || s === 'true' || s === '1' || s === 'active');
        }

        const nowIso = new Date().toISOString();
        const shiftRecord = {
            shiftCode: cleanCode,
            shiftName: cleanName,
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
            active: isActive,
            createdAt: shiftData.createdAt || nowIso,
            updatedAt: nowIso
        };

        // Persist to Cloud Firestore
        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'shifts', cleanCode);
                const firestorePayload = {
                    shiftCode: cleanCode,
                    shiftName: cleanName,
                    startTime,
                    endTime,
                    breakMinutes,
                    graceInMinutes,
                    graceOutMinutes,
                    halfDayMinutes,
                    fullDayMinutes,
                    isNightShift,
                    isOvertimeEligible,
                    weeklyOffPattern,
                    isActive,
                    createdAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso
                };
                await fb.setDoc(docRef, firestorePayload, { merge: true });
            }
        } catch (err) {
            console.warn('[ShiftCalculationService] Firestore setDoc notice:', err.message);
        }

        shiftsMap.set(cleanCode, shiftRecord);
        dispatchUpdateEvents();
        return shiftRecord;
    }

    /**
     * UPDATE: Modifies an existing Shift
     */
    async function updateShift(shiftCode, updates, orgId = getDefaultOrgId()) {
        const cleanCode = String(shiftCode).trim().toUpperCase();
        const existing = shiftsMap.get(cleanCode);

        if (!existing) {
            throw new Error(`Shift '${cleanCode}' does not exist.`);
        }

        const nowIso = new Date().toISOString();
        const updatedRecord = {
            ...existing,
            ...updates,
            shiftCode: cleanCode, // PK immutable
            updatedAt: nowIso
        };

        // Sync dual boolean aliases
        if (updates.isNightShift !== undefined) updatedRecord.nightShift = updates.isNightShift;
        if (updates.nightShift !== undefined) updatedRecord.isNightShift = updates.nightShift;
        if (updates.isOvertimeEligible !== undefined) updatedRecord.overtimeEligible = updates.isOvertimeEligible;
        if (updates.overtimeEligible !== undefined) updatedRecord.isOvertimeEligible = updates.overtimeEligible;
        if (updates.isActive !== undefined) updatedRecord.active = updates.isActive;

        // Cloud Firestore update
        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'shifts', cleanCode);
                const firestoreUpdates = {
                    ...updatedRecord,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso
                };
                await fb.setDoc(docRef, firestoreUpdates, { merge: true });
            }
        } catch (err) {
            console.warn('[ShiftCalculationService] Firestore update notice:', err.message);
        }

        shiftsMap.set(cleanCode, updatedRecord);
        dispatchUpdateEvents();
        return updatedRecord;
    }

    /**
     * TOGGLE STATUS: Switches active between true/false
     */
    async function toggleShiftStatus(shiftCode, orgId = getDefaultOrgId()) {
        const cleanCode = String(shiftCode).trim().toUpperCase();
        const existing = shiftsMap.get(cleanCode);

        if (!existing) {
            throw new Error(`Shift '${cleanCode}' not found.`);
        }

        const newStatus = !existing.isActive;
        return await updateShift(cleanCode, { isActive: newStatus }, orgId);
    }

    /**
     * DELETE: Removes a Shift
     */
    async function deleteShift(shiftCode, orgId = getDefaultOrgId()) {
        const cleanCode = String(shiftCode).trim().toUpperCase();

        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.deleteDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'shifts', cleanCode);
                await fb.deleteDoc(docRef);
            }
        } catch (err) {
            console.warn('[ShiftCalculationService] Firestore delete notice:', err.message);
        }

        shiftsMap.delete(cleanCode);
        dispatchUpdateEvents();
        return true;
    }

    /**
     * BULK IMPORT: Batch persists shifts to Firestore
     */
    async function bulkImportShifts(shiftsList, orgId = getDefaultOrgId()) {
        if (!Array.isArray(shiftsList) || shiftsList.length === 0) {
            throw new Error('No Shift records provided for ingestion.');
        }

        const results = [];
        const errors = [];

        for (const item of shiftsList) {
            try {
                const saved = await createShift(item, orgId);
                results.push(saved);
            } catch (err) {
                errors.push({ item, error: err.message });
            }
        }

        return {
            success: errors.length === 0,
            count: results.length,
            ingestedCount: results.length,
            total: shiftsList.length,
            successCount: results.length,
            errorCount: errors.length,
            results,
            errors
        };
    }

    /**
     * UI HELPER: Populates a shift selector element with active shifts
     */
    function populateShiftDropdown(selectElementOrId, selectedShiftCode = '') {
        const select = typeof selectElementOrId === 'string'
            ? document.getElementById(selectElementOrId)
            : selectElementOrId;

        if (!select) return;

        const shifts = getActiveShifts();
        let html = '<option value="">-- Select Shift Schedule --</option>';

        shifts.forEach(s => {
            const isSelected = selectedShiftCode && s.shiftCode.toUpperCase() === selectedShiftCode.toUpperCase();
            const timeSpan = `${s.startTime} - ${s.endTime}`;
            const nightBadge = s.isNightShift ? ' [Night]' : '';
            html += `<option value="${s.shiftCode}" ${isSelected ? 'selected' : ''}>${s.shiftCode} - ${s.shiftName} (${timeSpan})${nightBadge}</option>`;
        });

        select.innerHTML = html;
    }

    /**
     * Event Dispatcher for reactive UI updates
     */
    function dispatchUpdateEvents() {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('shifts-updated', {
                detail: { count: shiftsMap.size, timestamp: new Date().toISOString() }
            }));
        }
    }

    /**
     * ADMIN CONSOLE MODAL: Open Add/Edit Shift Modal Form
     */
    function openShiftModal(shiftCode = null) {
        if (typeof document === 'undefined') return;

        let modal = document.getElementById('shiftConfigModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'shiftConfigModal';
            modal.style.cssText = `
                position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
                backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center;
                z-index: 99999; animation: fadeIn 0.2s ease;
            `;
            modal.innerHTML = `
                <div style="background: white; border-radius: 24px; padding: 2rem; width: 92%; max-width: 620px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); border: 1px solid #e2e8f0; max-height: 90vh; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 1.5rem;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 36px; height: 36px; border-radius: 10px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center;">
                                <i data-lucide="clock" style="width: 20px; height: 20px;"></i>
                            </div>
                            <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;" id="shiftModalTitle">New Shift Policy</h2>
                        </div>
                        <button type="button" id="btnCloseShiftModal" style="background: none; border: none; font-size: 1.5rem; color: #64748b; cursor: pointer; padding: 4px;">&times;</button>
                    </div>

                    <form id="shiftForm">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">1. Shift Code * (Primary Key)</label>
                                <input type="text" id="inputShiftCode" placeholder="e.g. SH_GEN_01" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">2. Shift Name * (Display Title)</label>
                                <input type="text" id="inputShiftName" placeholder="e.g. General Corporate Shift" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                            </div>
                        </div>

                        <!-- Time Pickers -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">3. Start Time * (HH:mm)</label>
                                <input type="time" id="inputShiftStartTime" value="09:30" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">4. End Time * (HH:mm)</label>
                                <input type="time" id="inputShiftEndTime" value="18:30" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">5. Break Minutes *</label>
                                <input type="number" id="inputShiftBreakMinutes" value="60" min="0" max="240" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                            </div>
                        </div>

                        <!-- Grace Tolerances & Thresholds -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 0.75rem; margin-bottom: 1.25rem;">
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">6. Grace In (Mins)</label>
                                <input type="number" id="inputGraceInMinutes" value="15" min="0" max="60" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                            </div>
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">7. Grace Out (Mins)</label>
                                <input type="number" id="inputGraceOutMinutes" value="15" min="0" max="60" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                            </div>
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">8. Half Day (Mins)</label>
                                <input type="number" id="inputHalfDayMinutes" value="240" min="60" max="480" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                            </div>
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">9. Full Day (Mins)</label>
                                <input type="number" id="inputFullDayMinutes" value="480" min="120" max="720" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                            </div>
                        </div>

                        <!-- Flags: Night Shift & Overtime Eligible -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                            <label style="display: flex; align-items: center; gap: 8px; background: #f8fafc; padding: 10px 14px; border-radius: 12px; border: 1px solid #e2e8f0; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                <input type="checkbox" id="checkNightShift" style="width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer;">
                                10. Night Shift (Cross-Midnight)
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; background: #f8fafc; padding: 10px 14px; border-radius: 12px; border: 1px solid #e2e8f0; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                <input type="checkbox" id="checkOvertimeEligible" style="width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer;" checked>
                                11. Overtime Eligible
                            </label>
                        </div>

                        <!-- Weekly Off Pattern Multi-Select Checkboxes -->
                        <div style="margin-bottom: 1.25rem; background: #f8fafc; padding: 12px 14px; border-radius: 12px; border: 1px solid #e2e8f0;">
                            <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 8px;">12. Weekly Off Pattern (Structured Checkboxes)</label>
                            <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.82rem; font-weight: 600; color: #334155;">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" name="woDays" value="Sun" checked> Sunday</label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" name="woDays" value="Sat"> Saturday (All)</label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" name="woDays" value="2nd_4th_Sat"> 2nd & 4th Sat</label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" name="woDays" value="Fri"> Friday</label>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" name="woDays" value="Mon"> Monday</label>
                            </div>
                        </div>

                        <!-- Operational Status -->
                        <div style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 10px; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
                            <input type="checkbox" id="checkShiftActive" style="width: 18px; height: 18px; cursor: pointer;" checked>
                            <div>
                                <label for="checkShiftActive" style="font-size: 0.85rem; font-weight: 700; color: #0f172a; cursor: pointer;">13. Operational Status (Active)</label>
                                <p style="font-size: 0.72rem; color: #64748b; margin: 0;">Active shifts appear in roster assignment and employee profile dropdowns</p>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px;">
                            <button type="button" id="btnCancelShiftModal" style="padding: 10px 18px; border-radius: 12px; border: 1px solid #cbd5e1; background: white; font-weight: 700; cursor: pointer;">Cancel</button>
                            <button type="submit" id="btnSaveShiftModal" style="padding: 10px 22px; border-radius: 12px; border: none; background: #2563eb; color: white; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                                <i data-lucide="check"></i> Save Shift Policy
                            </button>
                        </div>
                    </form>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('btnCloseShiftModal').onclick = () => modal.style.display = 'none';
            document.getElementById('btnCancelShiftModal').onclick = () => modal.style.display = 'none';

            document.getElementById('shiftForm').onsubmit = async (e) => {
                e.preventDefault();
                const codeInput = document.getElementById('inputShiftCode');
                const nameInput = document.getElementById('inputShiftName');
                const startTimeInput = document.getElementById('inputShiftStartTime');
                const endTimeInput = document.getElementById('inputShiftEndTime');
                const breakInput = document.getElementById('inputShiftBreakMinutes');
                const graceInInput = document.getElementById('inputGraceInMinutes');
                const graceOutInput = document.getElementById('inputGraceOutMinutes');
                const halfDayInput = document.getElementById('inputHalfDayMinutes');
                const fullDayInput = document.getElementById('inputFullDayMinutes');
                const nightCheck = document.getElementById('checkNightShift');
                const otCheck = document.getElementById('checkOvertimeEligible');
                const activeCheck = document.getElementById('checkShiftActive');

                // Compute weekly off pattern string
                const selectedWo = Array.from(document.querySelectorAll('input[name="woDays"]:checked')).map(el => el.value);
                const weeklyOffPattern = selectedWo.length > 0 ? selectedWo.join(',') : 'Sun';

                const isEdit = codeInput.disabled;
                const payload = {
                    shiftCode: codeInput.value.trim(),
                    shiftName: nameInput.value.trim(),
                    startTime: startTimeInput.value,
                    endTime: endTimeInput.value,
                    breakMinutes: Number(breakInput.value),
                    graceInMinutes: Number(graceInInput.value),
                    graceOutMinutes: Number(graceOutInput.value),
                    halfDayMinutes: Number(halfDayInput.value),
                    fullDayMinutes: Number(fullDayInput.value),
                    isNightShift: nightCheck.checked,
                    isOvertimeEligible: otCheck.checked,
                    weeklyOffPattern,
                    isActive: activeCheck.checked
                };

                try {
                    if (isEdit) {
                        await updateShift(payload.shiftCode, payload);
                    } else {
                        await createShift(payload);
                    }
                    modal.style.display = 'none';
                    if (typeof window.showCustomAlert === 'function') {
                        window.showCustomAlert("Success", `Shift Policy ${payload.shiftCode} saved successfully.`, "success");
                    }
                    renderAdminConsole();
                } catch (err) {
                    alert("Error saving Shift Policy: " + err.message);
                }
            };
        }

        const titleEl = document.getElementById('shiftModalTitle');
        const codeInput = document.getElementById('inputShiftCode');
        const nameInput = document.getElementById('inputShiftName');
        const startTimeInput = document.getElementById('inputShiftStartTime');
        const endTimeInput = document.getElementById('inputShiftEndTime');
        const breakInput = document.getElementById('inputShiftBreakMinutes');
        const graceInInput = document.getElementById('inputGraceInMinutes');
        const graceOutInput = document.getElementById('inputGraceOutMinutes');
        const halfDayInput = document.getElementById('inputHalfDayMinutes');
        const fullDayInput = document.getElementById('inputFullDayMinutes');
        const nightCheck = document.getElementById('checkNightShift');
        const otCheck = document.getElementById('checkOvertimeEligible');
        const activeCheck = document.getElementById('checkShiftActive');

        if (shiftCode) {
            const shift = getShift(shiftCode);
            if (shift) {
                titleEl.textContent = `Edit Shift: ${shift.shiftCode}`;
                codeInput.value = shift.shiftCode;
                codeInput.disabled = true;
                nameInput.value = shift.shiftName;
                startTimeInput.value = shift.startTime;
                endTimeInput.value = shift.endTime;
                breakInput.value = shift.breakMinutes;
                graceInInput.value = shift.graceInMinutes;
                graceOutInput.value = shift.graceOutMinutes;
                halfDayInput.value = shift.halfDayMinutes;
                fullDayInput.value = shift.fullDayMinutes;
                nightCheck.checked = shift.isNightShift === true || shift.nightShift === true;
                otCheck.checked = shift.isOvertimeEligible !== false && shift.overtimeEligible !== false;
                activeCheck.checked = shift.isActive !== false && shift.active !== false;

                const pat = shift.weeklyOffPattern || 'Sun';
                document.querySelectorAll('input[name="woDays"]').forEach(cb => {
                    cb.checked = pat.includes(cb.value);
                });
            }
        } else {
            titleEl.textContent = 'New Shift Policy';
            codeInput.value = '';
            codeInput.disabled = false;
            nameInput.value = '';
            startTimeInput.value = '09:30';
            endTimeInput.value = '18:30';
            breakInput.value = 60;
            graceInInput.value = 15;
            graceOutInput.value = 15;
            halfDayInput.value = 240;
            fullDayInput.value = 480;
            nightCheck.checked = false;
            otCheck.checked = true;
            activeCheck.checked = true;
            document.querySelectorAll('input[name="woDays"]').forEach(cb => {
                cb.checked = (cb.value === 'Sun');
            });
        }

        modal.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    }

    /**
     * ADMIN CONSOLE: Renders Shifts Management Console table in admin dashboard
     */
    function renderAdminConsole(containerId = 'onboardingShiftTableContainer') {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;

        const shifts = getAllShifts();
        const activeCount = shifts.filter(s => s.isActive !== false).length;
        const totalCount = shifts.length;

        container.innerHTML = `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 24px; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 1.25rem; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 40px; height: 40px; border-radius: 12px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center;">
                                <i data-lucide="clock" style="width: 22px; height: 22px;"></i>
                            </div>
                            <div>
                                <h2 style="font-size: 1.3rem; font-weight: 800; color: #0f172a; margin: 0;">Shifts &amp; Week-offs Management Console</h2>
                                <p style="font-size: 0.8rem; color: #64748b; margin: 2px 0 0 0;">
                                    PRD Sections 1, 13 &amp; 16: Strict 13-attribute schema with dynamic attendance evaluation and cross-midnight support
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button type="button" class="btn btn-outline" id="btnAdminAddShift" style="font-size: 0.85rem; border: 1.5px solid #e2e8f0; background: white; cursor: pointer; padding: 10px 16px; border-radius: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
                            <i data-lucide="plus-circle" style="color: #2563eb;"></i> Add Shift Policy
                        </button>
                    </div>
                </div>

                <!-- Attributes Summary Cards -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem;">
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">1. Code Attribute</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-top: 2px;">Shift_Code (PK)</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">2. Schedule Hours</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-top: 2px;">Start_Time / End_Time (HH:mm)</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">3. Week-off Policy</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #2563eb; margin-top: 2px;">Weekly_Off_Pattern</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">4. Operational Status</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #166534; margin-top: 2px;">Active (${activeCount}/${totalCount})</p>
                    </div>
                </div>

                <!-- Shifts Table -->
                <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 16px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 1.5px solid #e2e8f0;">
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">#</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Shift Code</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Shift Name</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Timings</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Break &amp; Grace</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Thresholds (Half/Full)</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Week-Off</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569; text-align: center;">Flags</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569; text-align: center;">Status</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569; text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${shifts.map((s, idx) => {
                                const statusBadge = s.isActive
                                    ? '<span style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 800;">Active</span>'
                                    : '<span style="background: #fee2e2; color: #b91c1c; padding: 4px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 800;">Inactive</span>';

                                const nightBadge = s.isNightShift
                                    ? '<span style="background: #312e81; color: #e0e7ff; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">Night</span>'
                                    : '<span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem;">Day</span>';

                                const otBadge = s.isOvertimeEligible
                                    ? '<span style="background: #eff6ff; color: #1d4ed8; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; margin-left: 4px;">OT</span>'
                                    : '';

                                return `
                                    <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                                        <td style="padding: 12px 16px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
                                        <td style="padding: 12px 16px; font-weight: 800; color: #0f172a; font-family: monospace;">${s.shiftCode}</td>
                                        <td style="padding: 12px 16px; font-weight: 700; color: #334155;">${s.shiftName}</td>
                                        <td style="padding: 12px 16px; font-family: monospace; font-size: 0.82rem; font-weight: 700; color: #2563eb;">
                                            ${s.startTime} - ${s.endTime}
                                        </td>
                                        <td style="padding: 12px 16px; font-size: 0.78rem; color: #64748b;">
                                            Break: ${s.breakMinutes}m | Grace: +${s.graceInMinutes}/-${s.graceOutMinutes}m
                                        </td>
                                        <td style="padding: 12px 16px; font-size: 0.78rem; color: #334155; font-weight: 600;">
                                            ${s.halfDayMinutes}m / ${s.fullDayMinutes}m
                                        </td>
                                        <td style="padding: 12px 16px;">
                                            <span style="background: #f1f5f9; color: #0f172a; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.75rem; font-weight: 700;">${s.weeklyOffPattern}</span>
                                        </td>
                                        <td style="padding: 12px 16px; text-align: center;">
                                            ${nightBadge}${otBadge}
                                        </td>
                                        <td style="padding: 12px 16px; text-align: center;">${statusBadge}</td>
                                        <td style="padding: 12px 16px; text-align: right;">
                                            <div style="display: inline-flex; gap: 6px;">
                                                <button onclick="window.KylrxShiftCalculationService.openShiftModal('${s.shiftCode}')" style="padding: 6px 10px; border: 1px solid #cbd5e1; background: white; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Edit</button>
                                                <button onclick="window.KylrxShiftCalculationService.toggleShiftStatus('${s.shiftCode}').then(() => window.KylrxShiftCalculationService.renderAdminConsole())" style="padding: 6px 10px; border: 1px solid ${s.isActive ? '#fecaca' : '#bbf7d0'}; background: ${s.isActive ? '#fff1f2' : '#f0fdf4'}; color: ${s.isActive ? '#991b1b' : '#166534'}; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">${s.isActive ? 'Deactivate' : 'Activate'}</button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.getElementById('btnAdminAddShift')?.addEventListener('click', () => {
            openShiftModal();
        });

        if (window.lucide) lucide.createIcons();
    }

    return {
        DEFAULT_SHIFTS,
        getFirestorePath,
        timeToMinutes,
        minutesToTime,
        calculateAttendance,
        isWeeklyOff,
        getAllShifts,
        getActiveShifts,
        getShift,
        createShift,
        updateShift,
        toggleShiftStatus,
        deleteShift,
        bulkImportShifts,
        populateShiftDropdown,
        openShiftModal,
        renderAdminConsole
    };
}));
