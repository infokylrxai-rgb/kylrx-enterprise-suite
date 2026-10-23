/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - LABOUR WELFARE FUND (LWF) STATUTORY SERVICE MODULE
 * ============================================================================
 * 
 * Manages Cloud Firestore persistence, dynamic state-specific frequency deduction engine,
 * and statutory remittance return ledger exports matching PRD Sections 1, 4, 11, & 13:
 * 
 * Firestore Path:
 * organizations/{orgId}/employee_lwf_details/{employeeId}
 * 
 * Standard Return Ledger Format:
 * Employee_ID#Employee_Name#State#LWF_Registration_No#Gross_Pay#EE_Contribution#ER_Contribution#Total_Remittance
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
        root.KylrxLwfDetailsService = factory();
        root.lwfDetailsService = root.KylrxLwfDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for tests / offline mode / fast caching
    const _localLedger = new Map();

    // Canonical State Rules Registry matching PRD Sections 4 & 11
    const STATE_LWF_RULES = {
        "Karnataka": {
            state: "Karnataka",
            frequency: "Annual",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            totalContribution: 60.00,
            deductionMonths: [12],
            registrationPrefix: "LWF/KA",
            actName: "Karnataka Labour Welfare Fund Act, 1965",
            description: "Deducted annually in December salary run (EE: ₹20, ER: ₹40)"
        },
        "Maharashtra": {
            state: "Maharashtra",
            frequency: "Half-Yearly",
            employeeContribution: 12.00,
            employerContribution: 36.00,
            totalContribution: 48.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/MH",
            actName: "Maharashtra Labour Welfare Fund Act, 1953",
            description: "Deducted semi-annually in June and December pay runs (EE: ₹12, ER: ₹36)"
        },
        "Delhi": {
            state: "Delhi",
            frequency: "Half-Yearly",
            employeeContribution: 0.75,
            employerContribution: 2.25,
            totalContribution: 3.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/DL",
            actName: "Delhi Labour Welfare Fund Rules, 1997",
            description: "Deducted semi-annually in June and December pay runs (EE: ₹0.75, ER: ₹2.25)"
        },
        "Tamil Nadu": {
            state: "Tamil Nadu",
            frequency: "Annual",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            totalContribution: 60.00,
            deductionMonths: [12],
            registrationPrefix: "LWF/TN",
            actName: "Tamil Nadu Labour Welfare Fund Act, 1972",
            description: "Deducted annually in December pay run (EE: ₹20, ER: ₹40)"
        },
        "Gujarat": {
            state: "Gujarat",
            frequency: "Half-Yearly",
            employeeContribution: 6.00,
            employerContribution: 12.00,
            totalContribution: 18.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/GJ",
            actName: "Gujarat Labour Welfare Fund Act, 1953",
            description: "Deducted semi-annually in June and December pay runs (EE: ₹6, ER: ₹12)"
        },
        "Haryana": {
            state: "Haryana",
            frequency: "Monthly",
            employeeContribution: 25.00,
            employerContribution: 50.00,
            totalContribution: 75.00,
            deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            registrationPrefix: "LWF/HR",
            actName: "Punjab Labour Welfare Fund (Haryana Amendment) Act",
            description: "Deducted every monthly pay cycle (EE: ₹25, ER: ₹50)"
        },
        "Telangana": {
            state: "Telangana",
            frequency: "Annual",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            totalContribution: 60.00,
            deductionMonths: [12],
            registrationPrefix: "LWF/TS",
            actName: "Telangana Labour Welfare Fund Act, 1987",
            description: "Deducted annually in December pay run (EE: ₹20, ER: ₹40)"
        },
        "Andhra Pradesh": {
            state: "Andhra Pradesh",
            frequency: "Annual",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            totalContribution: 60.00,
            deductionMonths: [12],
            registrationPrefix: "LWF/AP",
            actName: "Andhra Pradesh Labour Welfare Fund Act, 1987",
            description: "Deducted annually in December pay run (EE: ₹20, ER: ₹40)"
        },
        "Kerala": {
            state: "Kerala",
            frequency: "Half-Yearly",
            employeeContribution: 20.00,
            employerContribution: 20.00,
            totalContribution: 40.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/KL",
            actName: "Kerala Labour Welfare Fund Act, 1975",
            description: "Deducted semi-annually in June and December (EE: ₹20, ER: ₹20)"
        },
        "Madhya Pradesh": {
            state: "Madhya Pradesh",
            frequency: "Half-Yearly",
            employeeContribution: 10.00,
            employerContribution: 30.00,
            totalContribution: 40.00,
            deductionMonths: [6, 12],
            registrationPrefix: "LWF/MP",
            actName: "Madhya Pradesh Labour Welfare Fund Act, 1982",
            description: "Deducted semi-annually in June and December (EE: ₹10, ER: ₹30)"
        }
    };

    // Default Seed Profiles matching Templates.xlsx and active enterprise employees
    const DEFAULT_LWF_PROFILES = [
        {
            employeeId: "EMP0001",
            organizationId: "ORG_KYLRX_01",
            isLwfApplicable: true,
            state: "Karnataka",
            employerRegistrationNo: "LWF/KA/BNG/2026/0912",
            employeeContribution: 20.00,
            employerContribution: 40.00,
            frequency: "Annual",
            effectiveFrom: "2026-01-01",
            effectiveTo: null,
            deductionSchedule: {
                deductionMonths: [12],
                nextDeduction: "2026-12"
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        },
        {
            employeeId: "EMP0002",
            organizationId: "ORG_KYLRX_01",
            isLwfApplicable: true,
            state: "Maharashtra",
            employerRegistrationNo: "LWF/MH/MUM/2026/0881",
            employeeContribution: 12.00,
            employerContribution: 36.00,
            frequency: "Half-Yearly",
            effectiveFrom: "2026-01-15",
            effectiveTo: null,
            deductionSchedule: {
                deductionMonths: [6, 12],
                nextDeduction: "2026-12"
            },
            createdAt: "2026-01-15T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        },
        {
            employeeId: "EMP0003",
            organizationId: "ORG_KYLRX_01",
            isLwfApplicable: true,
            state: "Delhi",
            employerRegistrationNo: "LWF/DL/NZ/2026/0312",
            employeeContribution: 0.75,
            employerContribution: 2.25,
            frequency: "Half-Yearly",
            effectiveFrom: "2026-02-01",
            effectiveTo: null,
            deductionSchedule: {
                deductionMonths: [6, 12],
                nextDeduction: "2026-12"
            },
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        },
        {
            employeeId: "EMP0004",
            organizationId: "ORG_KYLRX_01",
            isLwfApplicable: true,
            state: "Haryana",
            employerRegistrationNo: "LWF/HR/GGN/2026/0445",
            employeeContribution: 25.00,
            employerContribution: 50.00,
            frequency: "Monthly",
            effectiveFrom: "2026-01-01",
            effectiveTo: null,
            deductionSchedule: {
                deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                nextDeduction: "2026-10"
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        }
    ];

    /**
     * Seeds in-memory ledger with default records.
     */
    function seedDefaultRecords(orgId = 'ORG_KYLRX_01') {
        DEFAULT_LWF_PROFILES.forEach(profile => {
            const key = `${orgId}_${profile.employeeId}`;
            if (!_localLedger.has(key)) {
                _localLedger.set(key, JSON.parse(JSON.stringify(profile)));
            }
        });
    }

    // Auto-seed default ledger
    seedDefaultRecords();

    /**
     * Normalizes Frequency string.
     */
    function normalizeFrequency(freqStr, fallbackState = null) {
        if (!freqStr || String(freqStr).trim() === '') {
            if (fallbackState && STATE_LWF_RULES[fallbackState]) {
                return STATE_LWF_RULES[fallbackState].frequency;
            }
            return 'Annual';
        }
        const s = String(freqStr).trim().toLowerCase().replace(/[\s_-]+/g, '');
        if (s === 'monthly' || s === 'month') return 'Monthly';
        if (s === 'quarterly' || s === 'quarter' || s === 'qtr') return 'Quarterly';
        if (s === 'halfyearly' || s === 'halfyear' || s === 'semiannual' || s === 'semiannually' || s === 'biannual' || s === 'biannually') return 'Half-Yearly';
        if (s === 'annual' || s === 'annually' || s === 'yearly' || s === 'year') return 'Annual';

        return String(freqStr).trim();
    }

    /**
     * Computes the statutory deduction schedule given frequency, state, and reference date.
     */
    function computeDeductionSchedule(frequency = "Annual", state = "Karnataka", referenceDate = new Date()) {
        const normFreq = normalizeFrequency(frequency, state);
        let deductionMonths = [12];

        if (normFreq === 'Monthly') {
            deductionMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        } else if (normFreq === 'Quarterly') {
            deductionMonths = [3, 6, 9, 12];
        } else if (normFreq === 'Half-Yearly') {
            deductionMonths = [6, 12];
        } else if (normFreq === 'Annual') {
            if (state && STATE_LWF_RULES[state]?.deductionMonths) {
                deductionMonths = [...STATE_LWF_RULES[state].deductionMonths];
            } else {
                deductionMonths = [12];
            }
        }

        const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
        const currYear = isNaN(ref.getTime()) ? new Date().getFullYear() : ref.getFullYear();
        const currMonth = isNaN(ref.getTime()) ? (new Date().getMonth() + 1) : (ref.getMonth() + 1);

        let nextMonth = null;
        let nextYear = currYear;

        const futureMonthInCurrYear = deductionMonths.find(m => m >= currMonth);
        if (futureMonthInCurrYear !== undefined) {
            nextMonth = futureMonthInCurrYear;
        } else {
            nextMonth = deductionMonths[0];
            nextYear = currYear + 1;
        }

        const nextDeduction = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

        return {
            deductionMonths,
            nextDeduction
        };
    }

    /**
     * Resolves badge visual properties for LWF Status.
     */
    function resolveLwfStatusBadge(isLwfApplicable = true, frequency = 'Annual', nextDeduction = null) {
        if (!isLwfApplicable) {
            return {
                label: 'Exempt / NA',
                status: 'EXEMPT',
                bg: '#f1f5f9',
                color: '#475569',
                border: '#cbd5e1',
                icon: 'shield-off'
            };
        }
        return {
            label: nextDeduction ? `Active (${frequency}) • Next: ${nextDeduction}` : `Active (${frequency})`,
            status: 'ACTIVE',
            bg: '#eff6ff',
            color: '#1d4ed8',
            border: '#bfdbfe',
            icon: 'check-circle'
        };
    }

    /**
     * Resolves badge visual properties for Frequency.
     */
    function resolveFrequencyBadge(frequency) {
        const norm = normalizeFrequency(frequency);
        const badges = {
            'Monthly': { label: 'Monthly', bg: '#fef3c7', color: '#b45309', border: '#fde68a' },
            'Quarterly': { label: 'Quarterly', bg: '#e0e7ff', color: '#4338ca', border: '#c7d2fe' },
            'Half-Yearly': { label: 'Half-Yearly', bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff' },
            'Annual': { label: 'Annual', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' }
        };
        return badges[norm] || { label: norm, bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
    }

    /**
     * Retrieves an Employee Labour Welfare Fund Profile.
     * First queries Cloud Firestore; falls back to in-memory ledger.
     */
    async function getEmployeeLwfDetails(orgId = 'ORG_KYLRX_01', employeeId) {
        if (!employeeId) return null;
        const tenant = orgId || 'ORG_KYLRX_01';
        const key = `${tenant}_${employeeId}`;

        // 1. Try Cloud Firestore if runtime db is available
        if (typeof window !== 'undefined' && window.db && typeof window.doc === 'function' && typeof window.getDoc === 'function') {
            try {
                const docRef = window.doc(window.db, "organizations", tenant, "employee_lwf_details", employeeId);
                const snap = await window.getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data();
                    _localLedger.set(key, data);
                    return data;
                }
            } catch (err) {
                console.warn(`[KylrxLwfDetailsService] Firestore read failed for ${employeeId}, checking cache.`, err);
            }
        }

        // 2. Fall back to local ledger cache
        if (_localLedger.has(key)) {
            return JSON.parse(JSON.stringify(_localLedger.get(key)));
        }

        // Check if employeeId exists in DEFAULT_LWF_PROFILES
        const found = DEFAULT_LWF_PROFILES.find(p => p.employeeId === employeeId);
        if (found) {
            _localLedger.set(key, JSON.parse(JSON.stringify(found)));
            return JSON.parse(JSON.stringify(found));
        }

        return null;
    }

    /**
     * Persists an Employee Labour Welfare Fund Profile into Cloud Firestore & local cache.
     * Path: organizations/{orgId}/employee_lwf_details/{employeeId}
     */
    async function saveEmployeeLwfDetails(orgId = 'ORG_KYLRX_01', employeeId, lwfData = {}) {
        if (!employeeId) throw new Error("Employee ID is required to save LWF details.");
        const tenant = orgId || 'ORG_KYLRX_01';
        const key = `${tenant}_${employeeId}`;

        const stateName = lwfData.state || "Karnataka";
        const normFreq = normalizeFrequency(lwfData.frequency, stateName);
        const schedule = computeDeductionSchedule(normFreq, stateName, lwfData.effectiveFrom || new Date());

        const payload = {
            employeeId,
            organizationId: tenant,
            isLwfApplicable: lwfData.isLwfApplicable !== false,
            state: stateName,
            employerRegistrationNo: lwfData.employerRegistrationNo || (STATE_LWF_RULES[stateName]?.registrationPrefix ? `${STATE_LWF_RULES[stateName].registrationPrefix}/EST/2026/01` : 'LWF/KA/BNG/2026/0912'),
            employeeContribution: Number(lwfData.employeeContribution !== undefined ? lwfData.employeeContribution : (STATE_LWF_RULES[stateName]?.employeeContribution || 20.00)),
            employerContribution: Number(lwfData.employerContribution !== undefined ? lwfData.employerContribution : (STATE_LWF_RULES[stateName]?.employerContribution || 40.00)),
            frequency: normFreq,
            effectiveFrom: lwfData.effectiveFrom || "2026-01-01",
            effectiveTo: lwfData.effectiveTo || null,
            deductionSchedule: {
                deductionMonths: schedule.deductionMonths,
                nextDeduction: schedule.nextDeduction
            },
            updatedAt: new Date().toISOString()
        };

        if (!_localLedger.has(key)) {
            payload.createdAt = new Date().toISOString();
        } else {
            payload.createdAt = _localLedger.get(key).createdAt || new Date().toISOString();
        }

        _localLedger.set(key, payload);

        // Commit to Cloud Firestore if connected
        if (typeof window !== 'undefined' && window.db && typeof window.doc === 'function' && typeof window.setDoc === 'function') {
            try {
                const docRef = window.doc(window.db, "organizations", tenant, "employee_lwf_details", employeeId);
                await window.setDoc(docRef, payload, { merge: true });
            } catch (err) {
                console.warn(`[KylrxLwfDetailsService] Firestore write failed for ${employeeId}, keeping local state.`, err);
            }
        }

        return payload;
    }

    /**
     * Lists all LWF profiles for a tenant.
     */
    async function listAllLwfDetails(orgId = 'ORG_KYLRX_01') {
        const tenant = orgId || 'ORG_KYLRX_01';
        const results = [];

        if (typeof window !== 'undefined' && window.db && typeof window.collection === 'function' && typeof window.getDocs === 'function') {
            try {
                const colRef = window.collection(window.db, "organizations", tenant, "employee_lwf_details");
                const snap = await window.getDocs(colRef);
                if (!snap.empty) {
                    snap.forEach(d => results.push(d.data()));
                    return results;
                }
            } catch (err) {
                console.warn('[KylrxLwfDetailsService] Firestore listing failed, returning local cache.', err);
            }
        }

        for (const [key, val] of _localLedger.entries()) {
            if (key.startsWith(`${tenant}_`)) {
                results.push(JSON.parse(JSON.stringify(val)));
            }
        }

        return results;
    }

    /**
     * Evaluates monthly payroll deduction for an employee LWF profile.
     * Evaluates whether the current pay cycle month aligns with the configured Frequency and State schedule:
     * - Karnataka (Annual): Deducted in December pay run (e.g., EE: INR 20, ER: INR 40).
     * - Maharashtra (Half-Yearly): Deducted in June and December pay runs (e.g., EE: INR 12, ER: INR 36).
     * - Delhi (Half-Yearly): Deducted in June and December pay runs (e.g., EE: INR 0.75, ER: INR 2.25).
     * - Monthly Jurisdictions: Deducted every monthly pay cycle.
     * 
     * @param {Object} profile Employee LWF statutory profile
     * @param {number|Object} grossSalary Gross salary amount or options object
     * @param {Object} options Calculation options: { cycleMonth, cycleYear, payCycleDate, grossSalary }
     * @returns {Object} Deduction evaluation result
     */
    function calculateLwfDeduction(profile = {}, grossSalary = 0, options = {}) {
        let combinedProfile = typeof profile === 'object' && profile !== null ? profile : {};
        let combinedOptions = {};

        if (typeof grossSalary === 'object' && grossSalary !== null) {
            combinedOptions = { ...grossSalary, ...options };
        } else {
            combinedOptions = { ...options, grossSalary: Number(grossSalary || 0) };
        }

        const isLwfApplicable = combinedProfile.isLwfApplicable !== false && combinedProfile['LWF Applicable'] !== 'No' && combinedOptions.isLwfApplicable !== false;
        const state = combinedProfile.state || combinedProfile.State || combinedOptions.state || "Karnataka";
        const frequency = normalizeFrequency(combinedProfile.frequency || combinedProfile.Frequency || combinedOptions.frequency, state);
        const regNo = combinedProfile.employerRegistrationNo || combinedProfile['Employer Registration No'] || combinedOptions.employerRegistrationNo || '—';
        const grossWages = Number(combinedOptions.grossSalary || combinedOptions.grossPay || combinedOptions.grossEarnings || combinedProfile.grossSalary || 0);

        // 1. Inapplicable check
        if (!isLwfApplicable) {
            return {
                isDeductionMonth: false,
                isLwfApplicable: false,
                employeeContribution: 0,
                employerContribution: 0,
                totalRemittance: 0,
                deduction: 0,
                state,
                frequency,
                employerRegistrationNo: regNo,
                grossWages,
                isExempt: true,
                reason: "LWF Not Applicable"
            };
        }

        // 2. Parse pay cycle month and year
        let cycleMonth = 12; // default
        let cycleYear = new Date().getFullYear();

        if (combinedOptions.cycleMonth !== undefined) {
            if (typeof combinedOptions.cycleMonth === 'number') {
                cycleMonth = combinedOptions.cycleMonth;
            } else if (typeof combinedOptions.cycleMonth === 'string') {
                const parsedMonth = parseInt(combinedOptions.cycleMonth, 10);
                if (!isNaN(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) {
                    cycleMonth = parsedMonth;
                } else {
                    const mName = combinedOptions.cycleMonth.toLowerCase();
                    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
                    const mIdx = months.findIndex(m => mName.startsWith(m));
                    if (mIdx !== -1) cycleMonth = mIdx + 1;
                }
            }
        } else if (combinedOptions.month !== undefined) {
            if (typeof combinedOptions.month === 'number') {
                cycleMonth = combinedOptions.month;
            } else if (typeof combinedOptions.month === 'string') {
                const parsedMonth = parseInt(combinedOptions.month, 10);
                if (!isNaN(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) {
                    cycleMonth = parsedMonth;
                } else {
                    const mName = combinedOptions.month.toLowerCase();
                    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
                    const mIdx = months.findIndex(m => mName.startsWith(m));
                    if (mIdx !== -1) cycleMonth = mIdx + 1;
                }
            }
        } else if (combinedOptions.payCycleDate) {
            const d = new Date(combinedOptions.payCycleDate);
            if (!isNaN(d.getTime())) {
                cycleMonth = d.getMonth() + 1;
                cycleYear = d.getFullYear();
            }
        }

        if (combinedOptions.cycleYear) {
            cycleYear = Number(combinedOptions.cycleYear);
        }

        // 3. Effective Date Window check
        const effFrom = combinedProfile.effectiveFrom || combinedProfile['Effective From'];
        const effTo = combinedProfile.effectiveTo || combinedProfile['Effective To'];
        const cycleDateStr = `${cycleYear}-${String(cycleMonth).padStart(2, '0')}-01`;

        if (effFrom) {
            const fromDateStr = effFrom.slice(0, 7) + '-01';
            if (cycleDateStr < fromDateStr) {
                return {
                    isDeductionMonth: false,
                    isLwfApplicable: true,
                    employeeContribution: 0,
                    employerContribution: 0,
                    totalRemittance: 0,
                    deduction: 0,
                    state,
                    frequency,
                    employerRegistrationNo: regNo,
                    grossWages,
                    isExempt: false,
                    reason: `Pay cycle (${cycleYear}-${String(cycleMonth).padStart(2, '0')}) precedes Effective From date (${effFrom})`
                };
            }
        }

        if (effTo) {
            const toDateStr = effTo.slice(0, 7) + '-28';
            if (cycleDateStr > toDateStr) {
                return {
                    isDeductionMonth: false,
                    isLwfApplicable: true,
                    employeeContribution: 0,
                    employerContribution: 0,
                    totalRemittance: 0,
                    deduction: 0,
                    state,
                    frequency,
                    employerRegistrationNo: regNo,
                    grossWages,
                    isExempt: false,
                    reason: `Pay cycle (${cycleYear}-${String(cycleMonth).padStart(2, '0')}) exceeds Effective To date (${effTo})`
                };
            }
        }

        // 4. Resolve deduction months
        const schedule = computeDeductionSchedule(frequency, state, new Date(cycleYear, cycleMonth - 1, 1));
        const isDeductionMonth = schedule.deductionMonths.includes(cycleMonth);

        // 5. Compute contribution amounts
        let eeContribution = 0;
        let erContribution = 0;

        if (isDeductionMonth) {
            if (combinedProfile.employeeContribution !== undefined && combinedProfile.employeeContribution !== null) {
                eeContribution = Number(combinedProfile.employeeContribution);
            } else if (STATE_LWF_RULES[state]) {
                eeContribution = STATE_LWF_RULES[state].employeeContribution;
            } else {
                eeContribution = 20.00;
            }

            if (combinedProfile.employerContribution !== undefined && combinedProfile.employerContribution !== null) {
                erContribution = Number(combinedProfile.employerContribution);
            } else if (STATE_LWF_RULES[state]) {
                erContribution = STATE_LWF_RULES[state].employerContribution;
            } else {
                erContribution = 40.00;
            }
        }

        const totalRemittance = Math.round((eeContribution + erContribution) * 100) / 100;

        return {
            isDeductionMonth,
            isLwfApplicable: true,
            employeeContribution: eeContribution,
            employerContribution: erContribution,
            totalRemittance,
            deduction: eeContribution, // for payroll net pay subtraction
            employerLiability: erContribution, // company statutory liability
            companyLiability: erContribution, // logged to company statutory liabilities
            state,
            frequency,
            employerRegistrationNo: regNo,
            grossWages,
            cycleMonth,
            cycleYear,
            deductionMonths: schedule.deductionMonths,
            nextDeduction: schedule.nextDeduction,
            isExempt: false,
            reason: isDeductionMonth
                ? `Scheduled ${frequency} LWF deduction for ${state} (Month ${cycleMonth})`
                : `Non-deduction month for ${frequency} frequency in ${state} (Deduction months: ${schedule.deductionMonths.join(', ')})`
        };
    }

    /**
     * Formats a single employee LWF record into statutory remittance return row format.
     * PRD Section 11 & User Prompt Exact 8 Columns Delimited by '#':
     * Employee_ID#Employee_Name#State#LWF_Registration_No#Gross_Pay#EE_Contribution#ER_Contribution#Total_Remittance
     * 
     * @param {Object} record Employee statutory profile or payroll deduction record
     * @param {Object} options Options containing employeeName, grossPay, etc.
     * @returns {string} Hash-delimited string
     */
    function generateLwfReturnRow(record = {}, options = {}) {
        const empId = String(record.employeeId || record.empId || record['Employee ID'] || options.employeeId || '').trim();
        const empName = String(options.employeeName || options.name || record.employeeName || record.name || empId || 'Employee').trim();
        const state = String(record.state || record['State'] || options.state || 'Karnataka').trim();
        const regNo = String(record.employerRegistrationNo || record['Employer Registration No'] || options.employerRegistrationNo || options.lwfRegistrationNo || 'LWF_REG_DEFAULT').trim();

        let grossPay = 0;
        let eeContrib = 0;
        let erContrib = 0;

        if (record.grossWages !== undefined || record.grossPay !== undefined || record['Gross Pay'] !== undefined) {
            grossPay = Number(record.grossWages || record.grossPay || record['Gross Pay'] || 0);
        } else if (options.grossSalary !== undefined || options.grossPay !== undefined) {
            grossPay = Number(options.grossSalary || options.grossPay || 0);
        }

        if (record.employeeContribution !== undefined && record.employerContribution !== undefined) {
            eeContrib = Number(record.employeeContribution);
            erContrib = Number(record.employerContribution);
        } else if (record.EE_Contribution !== undefined && record.ER_Contribution !== undefined) {
            eeContrib = Number(record.EE_Contribution);
            erContrib = Number(record.ER_Contribution);
        } else {
            const calc = calculateLwfDeduction(record, grossPay, options);
            eeContrib = calc.employeeContribution;
            erContrib = calc.employerContribution;
        }

        const totalRemittance = Math.round((eeContrib + erContrib) * 100) / 100;

        return [
            empId,
            empName,
            state,
            regNo,
            grossPay.toFixed(2),
            eeContrib.toFixed(2),
            erContrib.toFixed(2),
            totalRemittance.toFixed(2)
        ].join('#');
    }

    /**
     * Generates a complete statutory LWF remittance statement (.txt/.csv format) and state aggregates.
     * 
     * @param {Array<Object>} records Array of employee records or deduction objects
     * @param {Object|string} headerMeta Header options or period string e.g. "2026-12"
     * @returns {Object} Remittance ledger object
     */
    function generateLwfReturnFile(records = [], headerMeta = {}) {
        const period = (typeof headerMeta === 'string' ? headerMeta : headerMeta.period || headerMeta.monthYear) || '2026-12';
        const stateFilter = (typeof headerMeta === 'object' && headerMeta.state) || null;

        const rows = [];
        let totalGrossPay = 0;
        let totalEeContribution = 0;
        let totalErContribution = 0;
        let totalRemittance = 0;
        const byState = {};

        records.forEach(item => {
            const itemState = item.state || item['State'] || (item.profile && item.profile.state) || 'Karnataka';
            if (stateFilter && itemState.toLowerCase() !== stateFilter.toLowerCase()) {
                return;
            }

            const rowStr = generateLwfReturnRow(item, { ...item, period });
            rows.push(rowStr);

            const parts = rowStr.split('#');
            const gross = parseFloat(parts[4]) || 0;
            const ee = parseFloat(parts[5]) || 0;
            const er = parseFloat(parts[6]) || 0;
            const total = parseFloat(parts[7]) || 0;

            totalGrossPay += gross;
            totalEeContribution += ee;
            totalErContribution += er;
            totalRemittance += total;

            if (!byState[itemState]) {
                byState[itemState] = { count: 0, totalGross: 0, totalEe: 0, totalEr: 0, totalRemittance: 0 };
            }
            byState[itemState].count += 1;
            byState[itemState].totalGross += gross;
            byState[itemState].totalEe += ee;
            byState[itemState].totalEr += er;
            byState[itemState].totalRemittance += total;
        });

        const stateNamePart = stateFilter ? stateFilter.replace(/\s+/g, '_') : 'ALL_STATES';
        const cleanPeriod = period.replace(/[-/]/g, '');
        const filename = `LWF_Return_${stateNamePart}_${cleanPeriod}.txt`;
        const csvFilename = `LWF_Return_${stateNamePart}_${cleanPeriod}.csv`;
        const xlsxFilename = `LWF_Return_${stateNamePart}_${cleanPeriod}.xlsx`;
        const content = rows.join('\r\n');
        const returnHeader = 'Employee_ID#Employee_Name#State#LWF_Registration_No#Gross_Pay#EE_Contribution#ER_Contribution#Total_Remittance';
        const csvContent = [returnHeader, ...rows].join('\r\n');

        return {
            filename,
            csvFilename,
            xlsxFilename,
            content,
            fileContent: content,
            csvContent,
            header: returnHeader,
            rows,
            rowCount: rows.length,
            totalEmployees: rows.length,
            totalGrossPay: Math.round(totalGrossPay * 100) / 100,
            totalEeContribution: Math.round(totalEeContribution * 100) / 100,
            totalErContribution: Math.round(totalErContribution * 100) / 100,
            totalRemittance: Math.round(totalRemittance * 100) / 100,
            byState,
            period,
            state: stateFilter || 'All'
        };
    }

    /**
     * Exports statutory LWF return statements as CSV or Excel worksheet.
     * PRD Section 11 return columns:
     * Employee_ID#Employee_Name#State#LWF_Registration_No#Gross_Pay#EE_Contribution#ER_Contribution#Total_Remittance
     */
    function exportLwfReturnCsv(records = [], headerMeta = {}) {
        const fileObj = generateLwfReturnFile(records, headerMeta);
        return {
            ...fileObj,
            filename: fileObj.csvFilename,
            content: fileObj.csvContent,
            mimeType: 'text/csv'
        };
    }

    /**
     * Generates SheetJS workbook structure for LWF return statement.
     */
    function exportLwfReturnExcel(records = [], headerMeta = {}) {
        const fileObj = generateLwfReturnFile(records, headerMeta);
        const dataRows = [
            ['Employee ID', 'Employee Name', 'State', 'LWF Registration No', 'Gross Pay', 'EE Contribution', 'ER Contribution', 'Total Remittance']
        ];

        fileObj.rows.forEach(r => {
            const parts = r.split('#');
            dataRows.push([
                parts[0] || '',
                parts[1] || '',
                parts[2] || '',
                parts[3] || '',
                parseFloat(parts[4]) || 0,
                parseFloat(parts[5]) || 0,
                parseFloat(parts[6]) || 0,
                parseFloat(parts[7]) || 0
            ]);
        });

        return {
            ...fileObj,
            filename: fileObj.xlsxFilename,
            dataRows
        };
    }

    /**
     * Converts a list of parsed sheet rows to Firestore batch documents and executes commit.
     */
    async function commitBatchLwfDetails(orgId = 'ORG_KYLRX_01', firestoreDocs = []) {
        let committedCount = 0;
        const errors = [];

        for (const doc of firestoreDocs) {
            try {
                await saveEmployeeLwfDetails(orgId, doc.employeeId, doc);
                committedCount++;
            } catch (err) {
                errors.push({
                    employeeId: doc.employeeId,
                    message: err.message || 'Failed to save LWF detail record.'
                });
            }
        }

        return {
            committedCount,
            errors
        };
    }

    return {
        STATE_LWF_RULES,
        DEFAULT_LWF_PROFILES,
        seedDefaultRecords,
        normalizeFrequency,
        computeDeductionSchedule,
        resolveLwfStatusBadge,
        resolveFrequencyBadge,
        getEmployeeLwfDetails,
        saveEmployeeLwfDetails,
        listAllLwfDetails,
        calculateLwfDeduction,
        generateLwfReturnRow,
        generateLwfReturnFile,
        exportLwfReturnCsv,
        exportLwfReturnExcel,
        commitBatchLwfDetails
    };
}));
