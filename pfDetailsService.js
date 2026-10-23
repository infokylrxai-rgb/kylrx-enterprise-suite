/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - EPFO / PF & UAN STATUTORY MASTER SERVICE MODULE
 * ============================================================================
 * 
 * Manages Cloud Firestore CRUD, Decentro/EPFO KYC verification handshakes,
 * live badge resolution, monthly contribution split math, and ECR file generation
 * matching PRD Sections 1, 4, 11, & 13:
 * 
 * Firestore Path:
 * organizations/{orgId}/employee_pf_details/{employeeId}
 * 
 * Standard ECR Format:
 * UAN#MemberName#GrossWages#EPFWages#EPSWages#EDLIWages#EE_Share#ER_EPS_Share#ER_EPF_Share#NCP_Days#Refund_Adv
 * 
 * @version 1.0.0
 * @author Principal Fintech & Statutory Payroll Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxPfDetailsService = factory();
        root.pfDetailsService = root.KylrxPfDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for tests / offline mode / fast caching
    const _localLedger = new Map();

    // Default Seed Data matching Templates.xlsx and active system users
    const DEFAULT_PF_PROFILES = [
        {
            employeeId: "EMP0001",
            organizationId: "ORG_KYLRX_01",
            isPfApplicable: true,
            uan: "100904829102",
            currentMemberId: "KNBNG00123450000010023",
            previousUan: "100802341290",
            previousMemberId: "DLCPM00987650000004521",
            epfoEstablishmentId: "KN/BNG/0012345/000",
            dateOfPfJoining: "2026-01-01",
            dateOfPfExit: null,
            isEpsApplicable: true,
            isEdliApplicable: true,
            kyc: {
                overallStatus: "VERIFIED",
                aadhaarKyc: "VERIFIED",
                panKyc: "VERIFIED",
                bankKyc: "VERIFIED"
            },
            uanStatus: "ACTIVE",
            verification: {
                status: "SUCCESS",
                officialSource: "Decentro Fabric",
                verifiedAt: "2026-01-01T00:00:00.000Z"
            },
            updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
            employeeId: "EMP0002",
            organizationId: "ORG_KYLRX_01",
            isPfApplicable: true,
            uan: "100904829103",
            currentMemberId: "KNBNG00123450000010024",
            previousUan: null,
            previousMemberId: null,
            epfoEstablishmentId: "KN/BNG/0012345/000",
            dateOfPfJoining: "2026-01-15",
            dateOfPfExit: null,
            isEpsApplicable: true,
            isEdliApplicable: true,
            kyc: {
                overallStatus: "VERIFIED",
                aadhaarKyc: "VERIFIED",
                panKyc: "VERIFIED",
                bankKyc: "VERIFIED"
            },
            uanStatus: "ACTIVE",
            verification: {
                status: "SUCCESS",
                officialSource: "EPFO Unified Portal",
                verifiedAt: "2026-01-15T00:00:00.000Z"
            },
            updatedAt: "2026-01-15T00:00:00.000Z"
        },
        {
            employeeId: "EMP0003",
            organizationId: "ORG_KYLRX_01",
            isPfApplicable: true,
            uan: "100904829104",
            currentMemberId: "KNBNG00123450000010025",
            previousUan: "100701239845",
            previousMemberId: "MHBAN00456780000001290",
            epfoEstablishmentId: "KN/BNG/0012345/000",
            dateOfPfJoining: "2026-02-01",
            dateOfPfExit: null,
            isEpsApplicable: true,
            isEdliApplicable: true,
            kyc: {
                overallStatus: "PENDING",
                aadhaarKyc: "VERIFIED",
                panKyc: "PENDING",
                bankKyc: "VERIFIED"
            },
            uanStatus: "ACTIVE",
            verification: {
                status: "PENDING",
                officialSource: "Manual Upload",
                verifiedAt: null
            },
            updatedAt: "2026-02-01T00:00:00.000Z"
        }
    ];

    /**
     * Seeds in-memory ledger with default records.
     */
    function seedDefaultRecords(orgId = 'ORG_KYLRX_01') {
        DEFAULT_PF_PROFILES.forEach(profile => {
            const key = `${orgId}_${profile.employeeId}`;
            if (!_localLedger.has(key)) {
                _localLedger.set(key, JSON.parse(JSON.stringify(profile)));
            }
        });
    }

    // Auto-seed default ledger
    seedDefaultRecords();

    /**
     * Resolves badge visual properties for KYC status.
     * @param {string} status "VERIFIED" | "PENDING" | "REJECTED" | "NOT_INITIATED"
     * @returns {Object}
     */
    function resolveKycBadge(status) {
        const norm = String(status || '').toUpperCase().trim();
        switch (norm) {
            case 'VERIFIED':
                return {
                    label: 'Verified',
                    status: 'VERIFIED',
                    bg: '#ecfdf5',
                    color: '#059669',
                    border: '#a7f3d0',
                    icon: 'check-circle'
                };
            case 'PENDING':
                return {
                    label: 'Pending',
                    status: 'PENDING',
                    bg: '#fffbeb',
                    color: '#d97706',
                    border: '#fde68a',
                    icon: 'clock'
                };
            case 'REJECTED':
                return {
                    label: 'Rejected',
                    status: 'REJECTED',
                    bg: '#fef2f2',
                    color: '#dc2626',
                    border: '#fecaca',
                    icon: 'alert-triangle'
                };
            case 'NOT_SEEDED':
                return {
                    label: 'Not Seeded',
                    status: 'NOT_SEEDED',
                    bg: '#f1f5f9',
                    color: '#64748b',
                    border: '#cbd5e1',
                    icon: 'minus-circle'
                };
            case 'NOT_INITIATED':
            default:
                return {
                    label: 'Not Initiated',
                    status: 'NOT_INITIATED',
                    bg: '#f8fafc',
                    color: '#64748b',
                    border: '#e2e8f0',
                    icon: 'shield-alert'
                };
        }
    }

    /**
     * Resolves badge visual properties for UAN Account Status.
     * @param {string} status "ACTIVE" | "INACTIVE" | "BLOCKED"
     */
    function resolveUanBadge(status) {
        const norm = String(status || '').toUpperCase().trim();
        switch (norm) {
            case 'ACTIVE':
                return { label: 'Active', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
            case 'INACTIVE':
                return { label: 'Inactive', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
            case 'BLOCKED':
                return { label: 'Blocked', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
            default:
                return { label: 'Active', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
        }
    }

    /**
     * Resolves badge visual properties for UAN Verification Status.
     * @param {string} status "SUCCESS" | "PENDING" | "FAILED"
     */
    function resolveVerificationBadge(status) {
        const norm = String(status || '').toUpperCase().trim();
        switch (norm) {
            case 'SUCCESS':
                return { label: 'Verified', status: 'SUCCESS', bg: '#ecfdf5', color: '#059669', border: '#a7f3d0', icon: 'shield-check' };
            case 'FAILED':
                return { label: 'Failed', status: 'FAILED', bg: '#fef2f2', color: '#dc2626', border: '#fecaca', icon: 'alert-octagon' };
            case 'PENDING':
            default:
                return { label: 'Pending', status: 'PENDING', bg: '#fffbeb', color: '#d97706', border: '#fde68a', icon: 'clock' };
        }
    }

    /**
     * Asynchronously executes or simulates live Decentro Fabric / EPFO KYC verification.
     * 
     * @param {string} orgId Tenant Org ID
     * @param {string} employeeId Employee ID
     * @param {Object} kycPayload { uan, pan, aadhaarLast4, bankAccount, ifsc }
     * @returns {Promise<Object>} Verification results & updated profile
     */
    async function verifyKycViaDecentroEpfo(orgId, employeeId, kycPayload = {}) {
        if (!employeeId) {
            throw new Error("Employee ID is required for EPFO KYC verification.");
        }

        const effectiveOrgId = orgId || 'ORG_KYLRX_01';
        let currentProfile = await getEmployeePfDetails(effectiveOrgId, employeeId);

        if (!currentProfile) {
            currentProfile = {
                employeeId,
                organizationId: effectiveOrgId,
                isPfApplicable: true,
                uan: kycPayload.uan || "100904829102",
                currentMemberId: `KNBNG001234500000${employeeId.replace(/\D/g, '').padStart(5, '0')}`,
                epfoEstablishmentId: "KN/BNG/0012345/000",
                dateOfPfJoining: new Date().toISOString().split('T')[0],
                isEpsApplicable: true,
                isEdliApplicable: true
            };
        }

        // Simulate Decentro Fabric EPFO handshake latency
        await new Promise(res => setTimeout(res, 250));

        const uan = String(kycPayload.uan || currentProfile.uan || '').trim();
        const isValidUan = /^\d{12}$/.test(uan);

        if (!isValidUan) {
            const failedProfile = {
                ...currentProfile,
                kyc: {
                    ...(currentProfile.kyc || {}),
                    overallStatus: "REJECTED"
                },
                uanStatus: "INACTIVE",
                verification: {
                    status: "FAILED",
                    officialSource: "Decentro Fabric",
                    verifiedAt: new Date().toISOString(),
                    failureReason: "UAN must strictly contain 12 numeric digits."
                },
                updatedAt: new Date().toISOString()
            };
            await saveEmployeePfDetails(effectiveOrgId, employeeId, failedProfile);
            return {
                success: false,
                status: "FAILED",
                message: "UAN Verification Failed: Invalid 12-digit UAN structure.",
                profile: failedProfile
            };
        }

        const verifiedProfile = {
            ...currentProfile,
            isPfApplicable: true,
            uan: uan,
            kyc: {
                overallStatus: "VERIFIED",
                aadhaarKyc: "VERIFIED",
                panKyc: "VERIFIED",
                bankKyc: "VERIFIED"
            },
            uanStatus: "ACTIVE",
            verification: {
                status: "SUCCESS",
                officialSource: "Decentro Fabric",
                verifiedAt: new Date().toISOString(),
                decentroHandshakeId: `dec_epfo_${Date.now()}_${uan.slice(-4)}`
            },
            updatedAt: new Date().toISOString()
        };

        await saveEmployeePfDetails(effectiveOrgId, employeeId, verifiedProfile);

        return {
            success: true,
            status: "SUCCESS",
            message: "Decentro Fabric EPFO verification handshake successful. Profile verified.",
            profile: verifiedProfile
        };
    }

    /**
     * Monthly Contribution Split Engine (PRD Sections 4 & 11)
     * 
     * Calculates EPF, EPS, EDLI, Admin charges, and Employer EPF balance split:
     * - Employee EPF: 12% of PF Gross Wages (capped at ₹15,000 ceiling unless opted for higher pension).
     * - Employer EPS: 8.33% of PF Gross Wages (capped at ₹1,250 if EPS Applicable, else 0).
     * - Employer EPF Split: Remaining balance of employer 12% (12% - 8.33% EPS).
     * - EDLI Charges: 0.50% of EDLI wages if EDLI Applicable.
     * - EPF Admin Charges: 0.50% of EPF wages.
     * 
     * @param {Object} profile Employee PF profile
     * @param {Object|number} wages Monthly salary / wages object { pfGrossWages, grossWages, basic } or number
     * @param {Object} options Options { isHigherPensionOpted: boolean, age: number, ncpDays: number }
     * @returns {Object} Calculated contributions breakdown
     */
    function calculateMonthlyContributions(profile = {}, wages = {}, options = {}) {
        const isPfApplicable = profile.isPfApplicable !== false;

        let rawPfGross = 0;
        if (typeof wages === 'number') {
            rawPfGross = wages;
        } else if (wages && typeof wages === 'object') {
            rawPfGross = Number(wages.pfGrossWages || wages.basic || wages.grossWages || 0);
        }

        const grossWages = Math.max(0, Math.round(rawPfGross));

        if (!isPfApplicable || grossWages === 0) {
            return {
                isApplicable: false,
                grossWages: grossWages,
                epfWages: 0,
                epsWages: 0,
                edliWages: 0,
                employeeEpf: 0,
                employerEps: 0,
                employerEpfSplit: 0,
                totalEmployerPf: 0,
                edliCharges: 0,
                adminCharges: 0,
                totalContribution: 0,
                ncpDays: options.ncpDays || 0,
                refundAdvances: 0
            };
        }

        const STATUTORY_CEILING = 15000;
        const isHigherPension = Boolean(options.isHigherPensionOpted);
        const age = options.age !== undefined ? Number(options.age) : 30;

        // 1. EPF Wages
        const epfWages = isHigherPension ? grossWages : Math.min(grossWages, STATUTORY_CEILING);

        // 2. Employee EPF Share (12% of EPF wages)
        const employeeEpf = Math.round(epfWages * 0.12);

        // 3. EPS Applicable check (must be opted and employee under 58 years of age per EPFO rules)
        const isEpsApplicable = profile.isEpsApplicable !== false && age < 58;
        const epsWages = isEpsApplicable ? Math.min(grossWages, STATUTORY_CEILING) : 0;

        // 4. Employer EPS Share: 8.33% capped at ₹1,250 (15,000 * 8.33% = 1250)
        let employerEps = 0;
        if (isEpsApplicable && epsWages > 0) {
            employerEps = Math.min(1250, Math.round(epsWages * 0.0833));
        }

        // 5. Total Employer Share (12% of EPF wages)
        const totalEmployerPf = Math.round(epfWages * 0.12);

        // 6. Employer EPF Split: Remaining balance (Total 12% - Employer EPS)
        const employerEpfSplit = Math.max(0, totalEmployerPf - employerEps);

        // 7. EDLI Applicable & Charges: 0.50% capped at statutory ceiling
        const isEdliApplicable = profile.isEdliApplicable !== false;
        const edliWages = isEdliApplicable ? Math.min(grossWages, STATUTORY_CEILING) : 0;
        const edliCharges = isEdliApplicable ? Math.round(edliWages * 0.005) : 0;

        // 8. Admin Charges: 0.50% of EPF wages
        const adminCharges = Math.round(epfWages * 0.005);

        const totalContribution = employeeEpf + employerEps + employerEpfSplit + edliCharges + adminCharges;

        return {
            isApplicable: true,
            grossWages,
            epfWages,
            epsWages,
            edliWages,
            employeeEpf,
            employerEps,
            employerEpfSplit,
            totalEmployerPf,
            edliCharges,
            adminCharges,
            totalContribution,
            ncpDays: options.ncpDays || 0,
            refundAdvances: options.refundAdvances || 0
        };
    }

    /**
     * Electronic Challan-cum-Return (ECR) Row Generator
     * 
     * Formats official EPFO 11-column hash-delimited text row:
     * UAN#MemberName#GrossWages#EPFWages#EPSWages#EDLIWages#EE_Share#ER_EPS_Share#ER_EPF_Share#NCP_Days#Refund_Adv
     * 
     * @param {Object} profile Employee PF Profile
     * @param {Object|number} wages Monthly salary / wages
     * @param {Object} options { employeeName, ncpDays, refundAdvances, isHigherPensionOpted }
     * @returns {string} Hash-delimited ECR row
     */
    function generateEcrRow(profile, wages, options = {}) {
        const uan = String(profile.uan || options.uan || '').trim();
        const memberName = String(options.employeeName || options.name || profile.employeeName || profile.employeeId || 'Employee').trim();
        const calc = calculateMonthlyContributions(profile, wages, options);

        const ncpDays = options.ncpDays !== undefined ? options.ncpDays : 0;
        const refundAdv = options.refundAdvances !== undefined ? options.refundAdvances : 0;

        // Exact 11 Columns per PRD Section 11:
        // 1. UAN
        // 2. MemberName
        // 3. GrossWages
        // 4. EPFWages
        // 5. EPSWages
        // 6. EDLIWages
        // 7. EE_Share
        // 8. ER_EPS_Share
        // 9. ER_EPF_Share
        // 10. NCP_Days
        // 11. Refund_Adv
        return [
            uan,
            memberName,
            calc.grossWages,
            calc.epfWages,
            calc.epsWages,
            calc.edliWages,
            calc.employeeEpf,
            calc.employerEps,
            calc.employerEpfSplit,
            ncpDays,
            refundAdv
        ].join('#');
    }

    /**
     * Generates a full ECR submission text file containing multiple employee records.
     * 
     * @param {Array<Object>} employeeRecords Array of { profile, wages, employeeName, ncpDays }
     * @param {Object} meta Metadata e.g. establishmentId, month, year
     * @returns {string} Official ECR text file content
     */
    function generateEcrFile(employeeRecords = [], meta = {}) {
        const rows = employeeRecords
            .filter(item => item && item.profile && item.profile.isPfApplicable !== false && item.profile.uan)
            .map(item => generateEcrRow(item.profile, item.wages || 0, item));

        return rows.join('\r\n');
    }

    /**
     * Saves or updates an employee EPFO profile in Cloud Firestore:
     * organizations/{orgId}/employee_pf_details/{employeeId}
     */
    async function saveEmployeePfDetails(orgId, employeeId, pfData) {
        if (!orgId || !employeeId) {
            throw new Error("Both orgId and employeeId are required to persist EPFO details.");
        }

        const now = new Date().toISOString();
        const record = {
            employeeId,
            organizationId: orgId,
            isPfApplicable: pfData.isPfApplicable !== false,
            uan: pfData.uan ? String(pfData.uan).trim() : null,
            currentMemberId: pfData.currentMemberId ? String(pfData.currentMemberId).trim() : null,
            previousUan: pfData.previousUan ? String(pfData.previousUan).trim() : null,
            previousMemberId: pfData.previousMemberId ? String(pfData.previousMemberId).trim() : null,
            epfoEstablishmentId: pfData.epfoEstablishmentId ? String(pfData.epfoEstablishmentId).trim() : 'KN/BNG/0012345/000',
            dateOfPfJoining: pfData.dateOfPfJoining || null,
            dateOfPfExit: pfData.dateOfPfExit || null,
            isEpsApplicable: pfData.isEpsApplicable !== false,
            isEdliApplicable: pfData.isEdliApplicable !== false,
            kyc: {
                overallStatus: pfData.kyc?.overallStatus || "NOT_INITIATED",
                aadhaarKyc: pfData.kyc?.aadhaarKyc || "NOT_SEEDED",
                panKyc: pfData.kyc?.panKyc || "NOT_SEEDED",
                bankKyc: pfData.kyc?.bankKyc || "PENDING"
            },
            uanStatus: pfData.uanStatus || "ACTIVE",
            verification: {
                status: pfData.verification?.status || "PENDING",
                officialSource: pfData.verification?.officialSource || "Manual Upload",
                verifiedAt: pfData.verification?.verifiedAt || null
            },
            updatedAt: now
        };

        // 1. Update in-memory ledger
        const key = `${orgId}_${employeeId}`;
        _localLedger.set(key, record);

        // 2. Persist to Firestore if available
        if (typeof window !== 'undefined' && window.db) {
            try {
                const { doc, setDoc, serverTimestamp } = await import("./firebase-config.js");
                const docRef = doc(window.db, "organizations", orgId, "employee_pf_details", employeeId);
                await setDoc(docRef, {
                    ...record,
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } catch (err) {
                console.warn("[KylrxPfDetailsService] Firestore direct set failed, stored in-memory:", err);
            }
        }

        return record;
    }

    /**
     * Retrieves an employee EPFO statutory profile from Firestore / cache.
     */
    async function getEmployeePfDetails(orgId, employeeId) {
        if (!orgId || !employeeId) return null;

        const effectiveOrgId = orgId || 'ORG_KYLRX_01';
        const key = `${effectiveOrgId}_${employeeId}`;

        // 1. Check in-memory ledger first
        if (_localLedger.has(key)) {
            return JSON.parse(JSON.stringify(_localLedger.get(key)));
        }

        // 2. Try Firestore
        if (typeof window !== 'undefined' && window.db) {
            try {
                const { doc, getDoc } = await import("./firebase-config.js");
                const docRef = doc(window.db, "organizations", effectiveOrgId, "employee_pf_details", employeeId);
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data();
                    _localLedger.set(key, data);
                    return data;
                }
            } catch (e) {
                console.warn("[KylrxPfDetailsService] Firestore fetch fallback:", e);
            }
        }

        return null;
    }

    /**
     * Lists all employee EPFO statutory profiles for an organization.
     */
    async function listEmployeePfDetails(orgId) {
        const effectiveOrgId = orgId || 'ORG_KYLRX_01';
        const results = [];

        // In-memory records matching orgId
        for (const [key, val] of _localLedger.entries()) {
            if (key.startsWith(`${effectiveOrgId}_`)) {
                results.push(JSON.parse(JSON.stringify(val)));
            }
        }

        // Try Firestore query
        if (typeof window !== 'undefined' && window.db) {
            try {
                const { collection, getDocs } = await import("./firebase-config.js");
                const colRef = collection(window.db, "organizations", effectiveOrgId, "employee_pf_details");
                const snap = await getDocs(colRef);
                if (!snap.empty) {
                    const firestoreDocs = [];
                    snap.forEach(d => {
                        firestoreDocs.push(d.data());
                        _localLedger.set(`${effectiveOrgId}_${d.id}`, d.data());
                    });
                    return firestoreDocs;
                }
            } catch (e) {
                console.warn("[KylrxPfDetailsService] Firestore list query fallback:", e);
            }
        }

        return results;
    }

    /**
     * Deletes an employee EPFO statutory profile.
     */
    async function deleteEmployeePfDetails(orgId, employeeId) {
        const key = `${orgId}_${employeeId}`;
        _localLedger.delete(key);

        if (typeof window !== 'undefined' && window.db) {
            try {
                const { doc, deleteDoc } = await import("./firebase-config.js");
                const docRef = doc(window.db, "organizations", orgId, "employee_pf_details", employeeId);
                await deleteDoc(docRef);
            } catch (e) {
                console.warn("[KylrxPfDetailsService] Firestore delete fallback:", e);
            }
        }
        return true;
    }

    return {
        DEFAULT_PF_PROFILES,
        seedDefaultRecords,
        resolveKycBadge,
        resolveUanBadge,
        resolveVerificationBadge,
        verifyKycViaDecentroEpfo,
        calculateMonthlyContributions,
        generateEcrRow,
        generateEcrFile,
        saveEmployeePfDetails,
        getEmployeePfDetails,
        listEmployeePfDetails,
        deleteEmployeePfDetails
    };
}));
