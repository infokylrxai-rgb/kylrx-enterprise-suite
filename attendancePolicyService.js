/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ATTENDANCE RULES & POLICIES SERVICE
 * ============================================================================
 * 
 * Manages Attendance Rules, Firestore persistence, and Policy Evaluation
 * Engine matching PRD Sections 1, 15, & 16:
 * 
 * 1. Cloud Firestore Data Architecture:
 *    - Path: organizations/{orgId}/attendance_policies/{attendancePolicyCode}
 *    - Document Schema:
 *      {
 *        "attendancePolicyCode": "POL_STD_CORP",
 *        "policyName": "Standard Corporate Policy",
 *        "lateAfterMinutes": 15,
 *        "earlyLeavingGraceMinute": 10,
 *        "absentAfterHours": 4,
 *        "regularizationAllowed": true,
 *        "regularizationWindowDays": 7,
 *        "wfhAllowed": true,
 *        "otMinimumMinutes": 60,
 *        "otApprovalRequired": true,
 *        "geoFenceRequired": false,
 *        "ipRestricted": false,
 *        "isActive": true,
 *        "createdAt": "serverTimestamp()",
 *        "updatedAt": "serverTimestamp()"
 *      }
 * 
 * 2. Attendance Enforcement Logic:
 *    - Geofence checking using Haversine algorithm
 *    - IP Restriction validation
 *    - Status & Penalty determination (LATE, ABSENT)
 *    - Regularization window expiration gating
 *    - Overtime threshold & manager routing
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
        root.KylrxAttendancePolicyService = factory();
        root.KylrxAttendanceRulesService = root.KylrxAttendancePolicyService;
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Default Enterprise Attendance Policies
    const DEFAULT_POLICIES = [
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
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
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
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
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
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
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
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        }
    ];

    // In-memory cache
    const policiesMap = new Map();

    function initDefaults() {
        policiesMap.clear();
        DEFAULT_POLICIES.forEach(p => {
            policiesMap.set(p.attendancePolicyCode.toUpperCase(), { ...p });
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
     * Firestore Path generator for Attendance Policies collection or document
     * Target: organizations/{orgId}/attendance_policies/{attendancePolicyCode}
     */
    function getFirestorePath(arg1 = '', arg2 = '') {
        let orgId = getDefaultOrgId();
        let policyCode = '';

        if (arg1 && arg2) {
            if (arg1.toLowerCase().startsWith('org') || arg1 === 'organizations') {
                orgId = arg1;
                policyCode = arg2;
            } else if (arg2.toLowerCase().startsWith('org')) {
                orgId = arg2;
                policyCode = arg1;
            } else {
                policyCode = arg1;
                orgId = arg2;
            }
        } else if (arg1) {
            if (arg1.toLowerCase().startsWith('org')) {
                orgId = arg1;
            } else {
                policyCode = arg1;
            }
        }

        const base = `organizations/${orgId}/attendance_policies`;
        if (!policyCode) return base;
        return `${base}/${String(policyCode).trim().toUpperCase()}`;
    }

    /**
     * Helper to convert time string (HH:mm) into minutes from midnight
     */
    function timeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const clean = String(timeStr).trim();

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

    // =========================================================================
    // ENFORCEMENT ENGINE METHODS (PRD Sections 15 & 16)
    // =========================================================================

    /**
     * Haversine formula to calculate great-circle distance between two coordinates in meters
     */
    function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth radius in meters
        const phi1 = (lat1 * Math.PI) / 180;
        const phi2 = (lat2 * Math.PI) / 180;
        const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
        const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return Math.round(R * c);
    }

    /**
     * 1. GEOFENCE VERIFICATION
     * Validates client location against assigned branch coordinates and allowed radius.
     */
    function verifyGeoFence(userCoords, branchCoords, radiusMeters = null) {
        const radius = radiusMeters !== null
            ? Number(radiusMeters)
            : Number(branchCoords?.radiusMeters || 100);

        if (!userCoords || userCoords.latitude === undefined || userCoords.longitude === undefined) {
            return {
                valid: false,
                verified: false,
                distanceMeters: null,
                radiusMeters: radius,
                reason: 'MISSING_COORDINATES'
            };
        }
        if (!branchCoords || branchCoords.latitude === undefined || branchCoords.longitude === undefined) {
            return {
                valid: false,
                verified: false,
                distanceMeters: null,
                radiusMeters: radius,
                reason: 'MISSING_BRANCH_COORDINATES'
            };
        }

        const distance = calculateDistanceMeters(
            userCoords.latitude,
            userCoords.longitude,
            branchCoords.latitude,
            branchCoords.longitude
        );

        const isInside = distance <= radius;
        return {
            valid: isInside,
            verified: isInside,
            distanceMeters: distance,
            radiusMeters: radius,
            reason: isInside ? null : 'OUTSIDE_GEOFENCE'
        };
    }

    /**
     * 2. IP RESTRICTION VERIFICATION
     * Validates client IP against allowed IPs or CIDR blocks
     */
    function verifyIpAllowed(clientIp, allowedIps = []) {
        if (!clientIp) {
            return { valid: false, verified: false, clientIp: null, reason: 'MISSING_CLIENT_IP' };
        }
        const cleanClient = String(clientIp).trim();
        const whitelist = Array.isArray(allowedIps) && allowedIps.length > 0
            ? allowedIps
            : ['127.0.0.1', '::1', '10.0.0.0/8', '192.168.0.0/16'];

        const isMatched = whitelist.some(allowed => {
            const cleanAllowed = String(allowed).trim();
            if (cleanAllowed === '*' || cleanAllowed === cleanClient) return true;
            if (cleanAllowed.includes('/')) {
                const prefix = cleanAllowed.split('/')[0].split('.').slice(0, 2).join('.');
                return cleanClient.startsWith(prefix);
            }
            if (cleanAllowed.endsWith('*')) {
                return cleanClient.startsWith(cleanAllowed.slice(0, -1));
            }
            return false;
        });

        return {
            valid: isMatched,
            verified: isMatched,
            clientIp: cleanClient,
            reason: isMatched ? null : 'IP_NOT_AUTHORIZED'
        };
    }

    /**
     * 3. COMBINED CLOCK-IN VALIDATION
     * Enforces Geofence and IP restrictions based on policy flags
     */
    function validateClockIn(params = {}) {
        const pol = params.policy || getPolicy(params.policyCode) || DEFAULT_POLICIES[0];
        const isWfh = Boolean(params.isWfh);
        const userCoords = params.userLocation || params.userCoords;
        const branchCoords = params.branchLocation || params.branchCoords;
        const clientIp = params.clientIp;
        const allowedIps = params.allowedIps || [];

        // 1. WFH Check
        if (isWfh && !pol.wfhAllowed) {
            return {
                allowed: false,
                reason: 'WFH_NOT_PERMITTED',
                message: `Work From Home (WFH) is strictly prohibited under ${pol.policyName}.`,
                policyCode: pol.attendancePolicyCode,
                policyName: pol.policyName
            };
        }

        // 2. Geofence Check
        let geoCheck = { valid: true, verified: true };
        if (pol.geoFenceRequired && !isWfh) {
            geoCheck = verifyGeoFence(userCoords, branchCoords, branchCoords?.radiusMeters);
            if (!geoCheck.verified) {
                return {
                    allowed: false,
                    reason: geoCheck.reason,
                    geoFenceCheck: geoCheck,
                    policyCode: pol.attendancePolicyCode,
                    policyName: pol.policyName
                };
            }
        }

        // 3. IP Restriction Check
        let ipCheck = { valid: true, verified: true };
        if (pol.ipRestricted && !isWfh) {
            ipCheck = verifyIpAllowed(clientIp, allowedIps);
            if (!ipCheck.verified) {
                return {
                    allowed: false,
                    reason: ipCheck.reason,
                    ipCheck: ipCheck,
                    policyCode: pol.attendancePolicyCode,
                    policyName: pol.policyName
                };
            }
        }

        return {
            allowed: true,
            policyCode: pol.attendancePolicyCode,
            policyName: pol.policyName,
            geoFenceCheck: geoCheck,
            ipCheck: ipCheck,
            geoFenceRequired: pol.geoFenceRequired,
            ipRestricted: pol.ipRestricted,
            wfhAllowed: pol.wfhAllowed
        };
    }

    /**
     * 4. PUNCH STATUS & PENALTY DETERMINATION
     * - If punchIn > (Start_Time + Absent_After_Hours) => mark 'ABSENT'
     * - If punchIn > (Start_Time + Late_After_Minutes) => mark 'LATE'
     * - Else => mark 'ON_TIME'
     */
    function evaluatePunchStatus(arg1, arg2, arg3, arg4) {
        let startTime = '09:30';
        let punchIn = '09:30';
        let graceInMinutes = 15;
        let policy = null;
        let policyCode = 'POL_STD_CORP';

        if (typeof arg1 === 'object' && arg1 !== null) {
            startTime = arg1.startTime || '09:30';
            punchIn = arg1.punchIn || '09:30';
            graceInMinutes = arg1.graceInMinutes !== undefined ? arg1.graceInMinutes : 15;
            policy = arg1.policy;
            policyCode = arg1.policyCode || 'POL_STD_CORP';
        } else {
            startTime = arg1 || '09:30';
            punchIn = arg2 || '09:30';
            graceInMinutes = arg3 !== undefined ? arg3 : 15;
            policy = arg4 || null;
        }

        const pol = policy || getPolicy(policyCode) || DEFAULT_POLICIES[0];

        // PRD §§ 15 & 16 Holiday Rules Interlock
        if (typeof arg1 === 'object' && arg1 !== null && (arg1.isHoliday || arg1.holiday)) {
            const h = arg1.holiday || arg1;
            const isMandatory = h.isMandatory !== undefined ? Boolean(h.isMandatory) : (h.isOptional === false || h.Optional_Holiday === false || h.Optional_Holiday === 'No');
            const isPaid = h.isPaid !== undefined ? Boolean(h.isPaid) : (h.Paid_Holiday !== 'No');
            const holidayTitle = h.holidayName || h.name || 'Official Holiday';

            if (isMandatory) {
                if (!arg1.punchIn && !arg1.punchedIn && !arg1.hasPunch) {
                    return {
                        punchIn: null,
                        startTime,
                        policyCode: pol.attendancePolicyCode,
                        status: 'HOLIDAY',
                        attendanceStatus: 'HOLIDAY',
                        isHoliday: true,
                        holidayWorked: false,
                        holidayName: holidayTitle,
                        isPaid,
                        isLate: false,
                        isAbsent: false,
                        lateMinutes: 0,
                        holidayOvertimeEligible: false,
                        compOffAccrualEligible: false,
                        remarks: `Mandatory Holiday Closure: ${holidayTitle}`
                    };
                } else {
                    return {
                        punchIn,
                        startTime,
                        policyCode: pol.attendancePolicyCode,
                        status: 'HOLIDAY_WORKED',
                        attendanceStatus: 'HOLIDAY_WORKED',
                        isHoliday: true,
                        holidayWorked: true,
                        holidayName: holidayTitle,
                        isPaid,
                        isLate: false,
                        isAbsent: false,
                        lateMinutes: 0,
                        holidayOvertimeEligible: isPaid,
                        compOffAccrualEligible: true,
                        compOffCredits: 1,
                        remarks: isPaid
                            ? `Punched in on Paid Holiday (${holidayTitle}). Eligible for holiday overtime / comp-off accrual.`
                            : `Worked on unpaid holiday (${holidayTitle}).`
                    };
                }
            }
        }

        const punchMins = timeToMinutes(punchIn);
        const startMins = timeToMinutes(startTime);

        const absentCutoffMins = startMins + (Number(pol.absentAfterHours || 4) * 60);
        const lateThresholdMins = startMins + Math.min(Number(graceInMinutes), Number(pol.lateAfterMinutes || 15));

        let status = 'ON_TIME';
        let lateMinutes = 0;
        let isAbsent = false;
        let isLate = false;

        if (punchMins > absentCutoffMins) {
            status = 'ABSENT';
            isAbsent = true;
            isLate = true;
            lateMinutes = Math.max(0, punchMins - startMins);
        } else if (punchMins > lateThresholdMins) {
            status = 'LATE';
            isLate = true;
            lateMinutes = Math.max(0, punchMins - startMins);
        }

        return {
            punchIn,
            startTime,
            policyCode: pol.attendancePolicyCode,
            status,
            attendanceStatus: status,
            isLate,
            isAbsent,
            lateMinutes,
            lateAfterMinutes: pol.lateAfterMinutes,
            absentAfterHours: pol.absentAfterHours,
            remarks: isAbsent
                ? `Exceeded cutoff of ${pol.absentAfterHours}h past shift start (${punchMins - startMins}m late). Auto-flagged ABSENT.`
                : (isLate ? `Arrived ${lateMinutes}m late (grace allowance ${pol.lateAfterMinutes}m).` : 'Arrived on time within policy grace.')
        };
    }

    /**
     * 5. REGULARIZATION GOVERNANCE
     * - Validates if Regularization_Allowed is true
     * - Validates that (currentDate - punchDate) <= Regularization_Window_Days
     */
    function validateRegularization(arg1, arg2, arg3) {
        let punchDate;
        let currentDate = new Date();
        let policy = null;
        let policyCode = 'POL_STD_CORP';

        if (typeof arg1 === 'object' && arg1 !== null && !(arg1 instanceof Date) && arg1.punchDate !== undefined) {
            punchDate = arg1.punchDate;
            currentDate = arg1.currentDate || new Date();
            policy = arg1.policy;
            policyCode = arg1.policyCode || 'POL_STD_CORP';
        } else {
            punchDate = arg1;
            currentDate = arg2 || new Date();
            policy = arg3;
        }

        const pol = policy || getPolicy(policyCode) || DEFAULT_POLICIES[0];

        if (!pol.regularizationAllowed && pol['Regularization_Allowed'] !== 'Yes') {
            return {
                allowed: false,
                eligible: false,
                reason: 'REGULARIZATION_NOT_ALLOWED',
                message: `Regularization is not allowed under this attendance policy.`,
                isRegularizationAllowed: false,
                isWindowExpired: false,
                daysElapsed: 0,
                diffDays: 0,
                maxDays: pol.regularizationWindowDays
            };
        }

        const pDate = (punchDate instanceof Date) ? punchDate : new Date(punchDate);
        const cDate = (currentDate instanceof Date) ? currentDate : new Date(currentDate);

        if (isNaN(pDate.getTime()) || isNaN(cDate.getTime())) {
            return {
                allowed: false,
                eligible: false,
                reason: 'INVALID_DATE',
                message: 'Invalid punchDate or currentDate supplied.',
                isRegularizationAllowed: true,
                isWindowExpired: true,
                daysElapsed: 0,
                diffDays: 0,
                maxDays: pol.regularizationWindowDays
            };
        }

        const diffMs = cDate.getTime() - pDate.getTime();
        const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        const maxDays = Number(pol.regularizationWindowDays || 7);
        const isWindowExpired = diffDays > maxDays;

        return {
            allowed: !isWindowExpired,
            eligible: !isWindowExpired,
            isRegularizationAllowed: true,
            isWindowExpired,
            diffDays,
            daysElapsed: diffDays,
            maxDays,
            allowedWindowDays: maxDays,
            remainingDays: Math.max(0, maxDays - diffDays),
            reason: isWindowExpired ? 'WINDOW_EXPIRED' : null
        };
    }

    /**
     * Helper to determine if Employee ESS quick action "Regularize Attendance" button is enabled
     */
    function isRegularizationButtonEnabled(policy) {
        if (!policy) return true;
        return policy.regularizationAllowed !== false && policy['Regularization_Allowed'] !== 'No';
    }

    /**
     * 6. OVERTIME VALIDATION
     * - If excessWorkedMinutes < OT_Minimum_Minutes => overtimeMinutes = 0
     * - If OT_Approval_Required is true => status 'PENDING_APPROVAL', route to L1 Manager
     * - Else => status 'APPROVED'
     */
    function evaluateOvertime(arg1, arg2) {
        let excessWorkedMinutes = 0;
        let policy = null;
        let policyCode = 'POL_STD_CORP';

        if (typeof arg1 === 'object' && arg1 !== null) {
            excessWorkedMinutes = Number(arg1.excessWorkedMinutes || arg1.excessMinutes || 0);
            policy = arg1.policy;
            policyCode = arg1.policyCode || 'POL_STD_CORP';
        } else {
            excessWorkedMinutes = Number(arg1 || 0);
            policy = arg2;
        }

        const pol = policy || getPolicy(policyCode) || DEFAULT_POLICIES[0];
        const minOtMinutes = Number(pol.otMinimumMinutes || 60);
        const approvalRequired = Boolean(pol.otApprovalRequired);

        if (excessWorkedMinutes < minOtMinutes) {
            return {
                eligible: false,
                excessWorkedMinutes,
                otMinimumMinutes: minOtMinutes,
                creditedMinutes: 0,
                creditedOtMinutes: 0,
                status: 'REJECTED_BELOW_THRESHOLD',
                reason: 'BELOW_MINIMUM_THRESHOLD',
                requiresApproval: approvalRequired,
                approvalRequired,
                routedToManager: false,
                routedTo: null
            };
        }

        const status = approvalRequired ? 'PENDING_APPROVAL' : 'APPROVED';
        const routedTo = approvalRequired ? 'L1_MANAGER_QUEUE' : 'PAYROLL_DIRECT';

        return {
            eligible: true,
            excessWorkedMinutes,
            otMinimumMinutes: minOtMinutes,
            creditedMinutes: excessWorkedMinutes,
            creditedOtMinutes: excessWorkedMinutes,
            status,
            requiresApproval: approvalRequired,
            approvalRequired,
            routedToManager: approvalRequired,
            routedTo
        };
    }

    // =========================================================================
    // FIRESTORE CRUD OPERATIONS
    // =========================================================================

    function getAllPolicies() {
        return Array.from(policiesMap.values());
    }

    function getActivePolicies() {
        return Array.from(policiesMap.values()).filter(p => p.isActive !== false);
    }

    function getPolicy(policyCode) {
        if (!policyCode) return null;
        return policiesMap.get(String(policyCode).trim().toUpperCase()) || null;
    }

    async function createPolicy(policyData, orgId = getDefaultOrgId()) {
        const rawCode = policyData.attendancePolicyCode || policyData['Attendance_Policy_Code'] || policyData.code;
        const rawName = policyData.policyName || policyData['Policy_Name'] || policyData.name;

        if (!rawCode) throw new Error("Attendance Policy Code ('Attendance_Policy_Code') is required.");
        if (!rawName) throw new Error("Policy Name ('Policy_Name') is required.");

        const cleanCode = String(rawCode).trim().toUpperCase().replace(/\s+/g, '_');
        const cleanName = String(rawName).trim();

        const lateAfterMinutes = Number(policyData.lateAfterMinutes !== undefined ? policyData.lateAfterMinutes : (policyData['Late_After_Minutes'] || 15));
        const earlyLeavingGraceMinute = Number(policyData.earlyLeavingGraceMinute !== undefined ? policyData.earlyLeavingGraceMinute : (policyData['Early_Leaving_Grace_Minute'] || 10));
        const absentAfterHours = Number(policyData.absentAfterHours !== undefined ? policyData.absentAfterHours : (policyData['Absent_After_Hours'] || 4));
        const regularizationWindowDays = Number(policyData.regularizationWindowDays !== undefined ? policyData.regularizationWindowDays : (policyData['Regularization_Window_Days'] || 7));
        const otMinimumMinutes = Number(policyData.otMinimumMinutes !== undefined ? policyData.otMinimumMinutes : (policyData['OT_Minimum_Minutes'] || 60));

        const parseBoolVal = (val, def) => {
            if (val === undefined || val === null || val === '') return def;
            if (typeof val === 'boolean') return val;
            const s = String(val).trim().toLowerCase();
            return ['yes', 'true', '1', 'y', 'active'].includes(s);
        };

        const regularizationAllowed = parseBoolVal(policyData.regularizationAllowed ?? policyData['Regularization_Allowed'], true);
        const wfhAllowed = parseBoolVal(policyData.wfhAllowed ?? policyData['WFH_Allowed'], true);
        const otApprovalRequired = parseBoolVal(policyData.otApprovalRequired ?? policyData['OT_Approval_Required'], true);
        const geoFenceRequired = parseBoolVal(policyData.geoFenceRequired ?? policyData['GeoFence_Required'], false);
        const ipRestricted = parseBoolVal(policyData.ipRestricted ?? policyData['IP_Restricted'], false);
        const isActive = parseBoolVal(policyData.isActive ?? policyData['Active'], true);

        const nowIso = new Date().toISOString();
        const policyRecord = {
            attendancePolicyCode: cleanCode,
            policyName: cleanName,
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
            isActive,
            createdAt: policyData.createdAt || nowIso,
            updatedAt: nowIso
        };

        // Persist to Cloud Firestore
        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'attendance_policies', cleanCode);
                const firestorePayload = {
                    ...policyRecord,
                    createdAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso
                };
                await fb.setDoc(docRef, firestorePayload, { merge: true });
            }
        } catch (err) {
            console.warn('[AttendancePolicyService] Firestore setDoc notice:', err.message);
        }

        policiesMap.set(cleanCode, policyRecord);
        dispatchUpdateEvents();
        return policyRecord;
    }

    async function updatePolicy(policyCode, updates, orgId = getDefaultOrgId()) {
        const cleanCode = String(policyCode).trim().toUpperCase();
        const existing = policiesMap.get(cleanCode);

        if (!existing) {
            throw new Error(`Attendance Policy '${cleanCode}' does not exist.`);
        }

        const nowIso = new Date().toISOString();
        const updatedRecord = {
            ...existing,
            ...updates,
            attendancePolicyCode: cleanCode,
            updatedAt: nowIso
        };

        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'attendance_policies', cleanCode);
                const firestorePayload = {
                    ...updatedRecord,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso
                };
                await fb.setDoc(docRef, firestorePayload, { merge: true });
            }
        } catch (err) {
            console.warn('[AttendancePolicyService] Firestore update notice:', err.message);
        }

        policiesMap.set(cleanCode, updatedRecord);
        dispatchUpdateEvents();
        return updatedRecord;
    }

    async function togglePolicyStatus(policyCode, orgId = getDefaultOrgId()) {
        const cleanCode = String(policyCode).trim().toUpperCase();
        const existing = policiesMap.get(cleanCode);

        if (!existing) {
            throw new Error(`Attendance Policy '${cleanCode}' not found.`);
        }

        return await updatePolicy(cleanCode, { isActive: !existing.isActive }, orgId);
    }

    async function deletePolicy(policyCode, orgId = getDefaultOrgId()) {
        const cleanCode = String(policyCode).trim().toUpperCase();

        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.deleteDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'attendance_policies', cleanCode);
                await fb.deleteDoc(docRef);
            }
        } catch (err) {
            console.warn('[AttendancePolicyService] Firestore delete notice:', err.message);
        }

        policiesMap.delete(cleanCode);
        dispatchUpdateEvents();
        return true;
    }

    async function bulkImportPolicies(policiesList, orgId = getDefaultOrgId()) {
        if (!Array.isArray(policiesList) || policiesList.length === 0) {
            throw new Error('No Attendance Policy records provided for ingestion.');
        }

        const results = [];
        const errors = [];

        for (const item of policiesList) {
            try {
                const saved = await createPolicy(item, orgId);
                results.push(saved);
            } catch (err) {
                errors.push({ item, error: err.message });
            }
        }

        return {
            success: errors.length === 0,
            count: results.length,
            ingestedCount: results.length,
            total: policiesList.length,
            successCount: results.length,
            errorCount: errors.length,
            results,
            errors
        };
    }

    function dispatchUpdateEvents() {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('attendance-policies-updated', {
                detail: { count: policiesMap.size, timestamp: new Date().toISOString() }
            }));
        }
    }

    // =========================================================================
    // UI MODAL & ADMIN CONSOLE (PRD Sections 1 & 15)
    // =========================================================================

    function openPolicyModal(policyCode = null) {
        if (typeof document === 'undefined') return;

        let modal = document.getElementById('attendancePolicyModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'attendancePolicyModal';
            modal.style.cssText = `
                position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
                backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center;
                z-index: 99999; animation: fadeIn 0.2s ease;
            `;
            modal.innerHTML = `
                <div style="background: white; border-radius: 24px; padding: 2rem; width: 92%; max-width: 650px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); border: 1px solid #e2e8f0; max-height: 90vh; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 1.5rem;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 36px; height: 36px; border-radius: 10px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center;">
                                <i data-lucide="shield-alert" style="width: 20px; height: 20px;"></i>
                            </div>
                            <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;" id="policyModalTitle">New Attendance Policy</h2>
                        </div>
                        <button type="button" id="btnClosePolicyModal" style="background: none; border: none; font-size: 1.5rem; color: #64748b; cursor: pointer; padding: 4px;">&times;</button>
                    </div>

                    <form id="attendancePolicyForm">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">1. Policy Code * (PK)</label>
                                <input type="text" id="inputPolicyCode" placeholder="e.g. POL_STD_CORP" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: monospace; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">2. Policy Name * (Display Title)</label>
                                <input type="text" id="inputPolicyName" placeholder="e.g. Standard Corporate Policy" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                            </div>
                        </div>

                        <!-- Numeric Limits: Late, Early, Cutoff -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">3. Late After (Mins)</label>
                                <input type="number" id="inputLateAfterMinutes" value="15" min="0" max="120" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                                <span style="font-size: 0.68rem; color: #94a3b8;">Grace before LATE</span>
                            </div>
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">4. Early Leave (Mins)</label>
                                <input type="number" id="inputEarlyLeavingGraceMinute" value="10" min="0" max="120" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                                <span style="font-size: 0.68rem; color: #94a3b8;">Grace before shift end</span>
                            </div>
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">5. Absent Cutoff (Hours)</label>
                                <input type="number" id="inputAbsentAfterHours" value="4" min="1" max="12" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                                <span style="font-size: 0.68rem; color: #94a3b8;">Auto-mark ABSENT</span>
                            </div>
                        </div>

                        <!-- Regularization & Overtime Thresholds -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">7. Regularization Window (Days)</label>
                                <input type="number" id="inputRegularizationWindowDays" value="7" min="1" max="90" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                                <span style="font-size: 0.68rem; color: #94a3b8;">Max days allowed to file claim</span>
                            </div>
                            <div>
                                <label style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">9. OT Minimum (Minutes)</label>
                                <input type="number" id="inputOtMinimumMinutes" value="60" min="0" max="300" style="width: 100%; padding: 8px 12px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.85rem; margin-top: 4px; box-sizing: border-box;" required>
                                <span style="font-size: 0.68rem; color: #94a3b8;">Minimum minutes to trigger OT</span>
                            </div>
                        </div>

                        <!-- Policy Boolean Toggle Switches (PRD §15) -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 10px;">
                            <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                <span>6. Regularization Allowed</span>
                                <input type="checkbox" id="checkRegularizationAllowed" style="width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer;" checked>
                            </label>
                            <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                <span>8. WFH (Work From Home) Allowed</span>
                                <input type="checkbox" id="checkWfhAllowed" style="width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer;" checked>
                            </label>
                            <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                <span>10. Overtime Approval Required (L1 Manager Queue)</span>
                                <input type="checkbox" id="checkOtApprovalRequired" style="width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer;" checked>
                            </label>
                            <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                <span>11. GeoFence Required (Verify Browser Coordinates)</span>
                                <input type="checkbox" id="checkGeoFenceRequired" style="width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer;">
                            </label>
                            <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                <span>12. IP Restricted (Corporate Network Whitelist)</span>
                                <input type="checkbox" id="checkIpRestricted" style="width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer;">
                            </label>
                            <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                <span>13. Operational Status (Active)</span>
                                <input type="checkbox" id="checkPolicyActive" style="width: 18px; height: 18px; accent-color: #16a34a; cursor: pointer;" checked>
                            </label>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px;">
                            <button type="button" id="btnCancelPolicyModal" style="padding: 10px 18px; border-radius: 12px; border: 1px solid #cbd5e1; background: white; font-weight: 700; cursor: pointer;">Cancel</button>
                            <button type="submit" id="btnSavePolicyModal" style="padding: 10px 22px; border-radius: 12px; border: none; background: #2563eb; color: white; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                                <i data-lucide="check"></i> Save Attendance Policy
                            </button>
                        </div>
                    </form>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('btnClosePolicyModal').onclick = () => modal.style.display = 'none';
            document.getElementById('btnCancelPolicyModal').onclick = () => modal.style.display = 'none';

            document.getElementById('attendancePolicyForm').onsubmit = async (e) => {
                e.preventDefault();
                const codeInput = document.getElementById('inputPolicyCode');
                const nameInput = document.getElementById('inputPolicyName');
                const lateInput = document.getElementById('inputLateAfterMinutes');
                const earlyInput = document.getElementById('inputEarlyLeavingGraceMinute');
                const absentInput = document.getElementById('inputAbsentAfterHours');
                const regWindowInput = document.getElementById('inputRegularizationWindowDays');
                const otMinInput = document.getElementById('inputOtMinimumMinutes');

                const regCheck = document.getElementById('checkRegularizationAllowed');
                const wfhCheck = document.getElementById('checkWfhAllowed');
                const otCheck = document.getElementById('checkOtApprovalRequired');
                const geoCheck = document.getElementById('checkGeoFenceRequired');
                const ipCheck = document.getElementById('checkIpRestricted');
                const activeCheck = document.getElementById('checkPolicyActive');

                const isEdit = codeInput.disabled;
                const payload = {
                    attendancePolicyCode: codeInput.value.trim(),
                    policyName: nameInput.value.trim(),
                    lateAfterMinutes: Number(lateInput.value),
                    earlyLeavingGraceMinute: Number(earlyInput.value),
                    absentAfterHours: Number(absentInput.value),
                    regularizationWindowDays: Number(regWindowInput.value),
                    otMinimumMinutes: Number(otMinInput.value),
                    regularizationAllowed: regCheck.checked,
                    wfhAllowed: wfhCheck.checked,
                    otApprovalRequired: otCheck.checked,
                    geoFenceRequired: geoCheck.checked,
                    ipRestricted: ipCheck.checked,
                    isActive: activeCheck.checked
                };

                try {
                    if (isEdit) {
                        await updatePolicy(payload.attendancePolicyCode, payload);
                    } else {
                        await createPolicy(payload);
                    }
                    modal.style.display = 'none';
                    if (typeof window.showCustomAlert === 'function') {
                        window.showCustomAlert("Success", `Attendance Policy ${payload.attendancePolicyCode} saved successfully.`, "success");
                    }
                    renderAdminConsole();
                } catch (err) {
                    alert("Error saving Attendance Policy: " + err.message);
                }
            };
        }

        const titleEl = document.getElementById('policyModalTitle');
        const codeInput = document.getElementById('inputPolicyCode');
        const nameInput = document.getElementById('inputPolicyName');
        const lateInput = document.getElementById('inputLateAfterMinutes');
        const earlyInput = document.getElementById('inputEarlyLeavingGraceMinute');
        const absentInput = document.getElementById('inputAbsentAfterHours');
        const regWindowInput = document.getElementById('inputRegularizationWindowDays');
        const otMinInput = document.getElementById('inputOtMinimumMinutes');

        const regCheck = document.getElementById('checkRegularizationAllowed');
        const wfhCheck = document.getElementById('checkWfhAllowed');
        const otCheck = document.getElementById('checkOtApprovalRequired');
        const geoCheck = document.getElementById('checkGeoFenceRequired');
        const ipCheck = document.getElementById('checkIpRestricted');
        const activeCheck = document.getElementById('checkPolicyActive');

        if (policyCode) {
            const p = getPolicy(policyCode);
            if (p) {
                titleEl.textContent = `Edit Attendance Policy: ${p.attendancePolicyCode}`;
                codeInput.value = p.attendancePolicyCode;
                codeInput.disabled = true;
                nameInput.value = p.policyName;
                lateInput.value = p.lateAfterMinutes;
                earlyInput.value = p.earlyLeavingGraceMinute;
                absentInput.value = p.absentAfterHours;
                regWindowInput.value = p.regularizationWindowDays;
                otMinInput.value = p.otMinimumMinutes;

                regCheck.checked = p.regularizationAllowed !== false;
                wfhCheck.checked = p.wfhAllowed !== false;
                otCheck.checked = p.otApprovalRequired !== false;
                geoCheck.checked = p.geoFenceRequired === true;
                ipCheck.checked = p.ipRestricted === true;
                activeCheck.checked = p.isActive !== false;
            }
        } else {
            titleEl.textContent = 'New Attendance Policy';
            codeInput.value = '';
            codeInput.disabled = false;
            nameInput.value = '';
            lateInput.value = 15;
            earlyInput.value = 10;
            absentInput.value = 4;
            regWindowInput.value = 7;
            otMinInput.value = 60;

            regCheck.checked = true;
            wfhCheck.checked = true;
            otCheck.checked = true;
            geoCheck.checked = false;
            ipCheck.checked = false;
            activeCheck.checked = true;
        }

        modal.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    }

    function renderAdminConsole(containerId = 'onboardingAttendancePolicyTableContainer') {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;

        const policies = getAllPolicies();
        const activeCount = policies.filter(p => p.isActive !== false).length;
        const totalCount = policies.length;

        container.innerHTML = `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 24px; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 1.25rem; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 40px; height: 40px; border-radius: 12px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center;">
                                <i data-lucide="shield-alert" style="width: 22px; height: 22px;"></i>
                            </div>
                            <div>
                                <h2 style="font-size: 1.3rem; font-weight: 800; color: #0f172a; margin: 0;">Attendance Rules &amp; Policies Console</h2>
                                <p style="font-size: 0.8rem; color: #64748b; margin: 2px 0 0 0;">
                                    PRD Sections 1, 15 &amp; 16: Strict 13-attribute schema with Geofence, IP Restriction, and Regularization Governance
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button type="button" class="btn btn-outline" id="btnAdminAddPolicy" style="font-size: 0.85rem; border: 1.5px solid #e2e8f0; background: white; cursor: pointer; padding: 10px 16px; border-radius: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
                            <i data-lucide="plus-circle" style="color: #2563eb;"></i> Add Attendance Policy
                        </button>
                    </div>
                </div>

                <!-- Attributes Summary Cards -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem;">
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">1. Policy Primary Key</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-top: 2px;">Attendance_Policy_Code</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">2. Grace Limits</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-top: 2px;">Late / Early / Cutoff</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">3. Governance &amp; Security</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #2563eb; margin-top: 2px;">GeoFence &bull; IP &bull; Regularization</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">4. Operational Status</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #166534; margin-top: 2px;">Active (${activeCount}/${totalCount})</p>
                    </div>
                </div>

                <!-- Policies Table -->
                <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 16px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 1.5px solid #e2e8f0;">
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">#</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Policy Code</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Policy Name</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Late / Early Grace</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Absent Cutoff</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Regularization</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Overtime</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569; text-align: center;">Security Flags</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569; text-align: center;">Status</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569; text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${policies.map((p, idx) => {
                                const statusBadge = p.isActive
                                    ? '<span style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 800;">Active</span>'
                                    : '<span style="background: #fee2e2; color: #b91c1c; padding: 4px 10px; border-radius: 100px; font-size: 0.72rem; font-weight: 800;">Inactive</span>';

                                const geoBadge = p.geoFenceRequired
                                    ? '<span style="background: #eff6ff; color: #1d4ed8; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">Geo</span>'
                                    : '';
                                const ipBadge = p.ipRestricted
                                    ? '<span style="background: #faf5ff; color: #7e22ce; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; margin-left: 2px;">IP</span>'
                                    : '';
                                const wfhBadge = p.wfhAllowed
                                    ? '<span style="background: #ecfdf5; color: #047857; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; margin-left: 2px;">WFH</span>'
                                    : '';

                                return `
                                    <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                                        <td style="padding: 12px 16px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
                                        <td style="padding: 12px 16px; font-weight: 800; color: #0f172a; font-family: monospace;">${p.attendancePolicyCode}</td>
                                        <td style="padding: 12px 16px; font-weight: 700; color: #334155;">${p.policyName}</td>
                                        <td style="padding: 12px 16px; font-size: 0.8rem; color: #64748b;">
                                            Late: +${p.lateAfterMinutes}m | Early: -${p.earlyLeavingGraceMinute}m
                                        </td>
                                        <td style="padding: 12px 16px; font-size: 0.8rem; color: #b91c1c; font-weight: 700;">
                                            >${p.absentAfterHours}h from start
                                        </td>
                                        <td style="padding: 12px 16px; font-size: 0.8rem; color: #334155;">
                                            ${p.regularizationAllowed ? `<span style="color: #166534; font-weight: 700;">Allowed</span> (${p.regularizationWindowDays}d)` : '<span style="color: #94a3b8;">Disabled</span>'}
                                        </td>
                                        <td style="padding: 12px 16px; font-size: 0.8rem; color: #334155;">
                                            Min ${p.otMinimumMinutes}m ${p.otApprovalRequired ? '(Requires L1)' : '(Auto)'}
                                        </td>
                                        <td style="padding: 12px 16px; text-align: center;">
                                            ${geoBadge}${ipBadge}${wfhBadge || '<span style="color:#94a3b8; font-size:0.7rem;">None</span>'}
                                        </td>
                                        <td style="padding: 12px 16px; text-align: center;">${statusBadge}</td>
                                        <td style="padding: 12px 16px; text-align: right;">
                                            <div style="display: inline-flex; gap: 6px;">
                                                <button onclick="window.KylrxAttendancePolicyService.openPolicyModal('${p.attendancePolicyCode}')" style="padding: 6px 10px; border: 1px solid #cbd5e1; background: white; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">Edit</button>
                                                <button onclick="window.KylrxAttendancePolicyService.togglePolicyStatus('${p.attendancePolicyCode}').then(() => window.KylrxAttendancePolicyService.renderAdminConsole())" style="padding: 6px 10px; border: 1px solid ${p.isActive ? '#fecaca' : '#bbf7d0'}; background: ${p.isActive ? '#fff1f2' : '#f0fdf4'}; color: ${p.isActive ? '#991b1b' : '#166534'}; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">${p.isActive ? 'Deactivate' : 'Activate'}</button>
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

        document.getElementById('btnAdminAddPolicy')?.addEventListener('click', () => {
            openPolicyModal();
        });

        if (window.lucide) lucide.createIcons();
    }

    return {
        DEFAULT_ATTENDANCE_POLICIES: DEFAULT_POLICIES,
        getFirestorePath,
        calculateDistanceMeters,
        verifyGeoFence,
        verifyIpAllowed,
        validateClockIn,
        evaluatePunchStatus,
        validateRegularization,
        isRegularizationButtonEnabled,
        evaluateOvertime,
        getAllPolicies,
        getActivePolicies,
        getPolicy,
        createPolicy,
        updatePolicy,
        togglePolicyStatus,
        deletePolicy,
        bulkImportPolicies,
        openPolicyModal,
        renderAdminConsole
    };
}));
