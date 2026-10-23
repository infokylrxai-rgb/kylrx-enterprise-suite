/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PROFESSIONAL TAX (PT) STATUTORY SERVICE MODULE
 * ============================================================================
 * 
 * Manages Cloud Firestore CRUD, dynamic multi-state PT slab resolution,
 * monthly deduction proration, and statutory remittance return ledger exports
 * matching PRD Sections 1, 4, 11, & 13:
 * 
 * Firestore Path:
 * organizations/{orgId}/employee_pt_details/{employeeId}
 * 
 * Standard Monthly Return Ledger Format:
 * Employee_ID#Employee_Name#PTRC_Number#Gross_Wages#PT_Deducted#State#Month_Year
 * 
 * @version 1.0.0
 * @author Principal Fintech & Statutory Compliance Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxPtDetailsService = factory();
        root.ptDetailsService = root.KylrxPtDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for tests / offline mode / fast caching
    const _localLedger = new Map();

    // Default Seed Data matching Templates.xlsx and active system users
    const DEFAULT_PT_PROFILES = [
        {
            employeeId: "EMP0001",
            organizationId: "ORG_KYLRX_01",
            isPtApplicable: true,
            state: "Karnataka",
            ptRegistrationNo: "PTRC1234567K",
            ptSlab: "KA_DEFAULT",
            monthlyDeduction: 200.00,
            effectiveFrom: "2026-01-01",
            effectiveTo: null,
            isActive: true,
            overrides: {
                isManualOverride: false,
                exemptReason: null
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        },
        {
            employeeId: "EMP0002",
            organizationId: "ORG_KYLRX_01",
            isPtApplicable: true,
            state: "Maharashtra",
            ptRegistrationNo: "PTRC9876543M",
            ptSlab: "MH_MALE_TIER_2",
            monthlyDeduction: 200.00,
            effectiveFrom: "2026-01-15",
            effectiveTo: null,
            isActive: true,
            overrides: {
                isManualOverride: false,
                exemptReason: null
            },
            createdAt: "2026-01-15T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        },
        {
            employeeId: "EMP0003",
            organizationId: "ORG_KYLRX_01",
            isPtApplicable: true,
            state: "Telangana",
            ptRegistrationNo: "PTRC5544332T",
            ptSlab: "TS_TIER_2",
            monthlyDeduction: 200.00,
            effectiveFrom: "2026-02-01",
            effectiveTo: null,
            isActive: true,
            overrides: {
                isManualOverride: false,
                exemptReason: null
            },
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        }
    ];

    /**
     * Seeds in-memory ledger with default records.
     */
    function seedDefaultRecords(orgId = 'ORG_KYLRX_01') {
        DEFAULT_PT_PROFILES.forEach(profile => {
            const key = `${orgId}_${profile.employeeId}`;
            if (!_localLedger.has(key)) {
                _localLedger.set(key, JSON.parse(JSON.stringify(profile)));
            }
        });
    }

    // Auto-seed default ledger
    seedDefaultRecords();

    /**
     * Resolves badge visual properties for PT Status.
     */
    function resolvePtStatusBadge(isActive, isPtApplicable = true) {
        if (!isPtApplicable) {
            return {
                label: 'Exempt / NA',
                status: 'EXEMPT',
                bg: '#f1f5f9',
                color: '#475569',
                border: '#cbd5e1',
                icon: 'shield-off'
            };
        }
        if (isActive) {
            return {
                label: 'Active PT',
                status: 'ACTIVE',
                bg: '#ecfdf5',
                color: '#059669',
                border: '#a7f3d0',
                icon: 'check-circle'
            };
        }
        return {
            label: 'Inactive',
            status: 'INACTIVE',
            bg: '#fffbeb',
            color: '#d97706',
            border: '#fde68a',
            icon: 'alert-triangle'
        };
    }

    /**
     * Resolves badge visual properties for State Slab.
     */
    function resolveSlabBadge(state, slabCode) {
        return {
            label: slabCode || `${(state || 'KA').slice(0, 2).toUpperCase()}_DEFAULT`,
            bg: '#eff6ff',
            color: '#2563eb',
            border: '#bfdbfe',
            icon: 'tag'
        };
    }

    /**
     * Retrieves an Employee Professional Tax Profile.
     * First queries Firestore; falls back to in-memory ledger.
     */
    async function getEmployeePtDetails(orgId = 'ORG_KYLRX_01', employeeId) {
        if (!employeeId) return null;

        // 1. Try Cloud Firestore if SDK available
        if (typeof window !== 'undefined' && window.db && typeof window.db.collection === 'function') {
            try {
                const docRef = window.db
                    .collection('organizations')
                    .doc(orgId)
                    .collection('employee_pt_details')
                    .doc(employeeId);
                
                const snap = await docRef.get();
                if (snap.exists) {
                    const data = snap.data();
                    _localLedger.set(`${orgId}_${employeeId}`, data);
                    return data;
                }
            } catch (err) {
                console.warn(`[KylrxPtDetailsService] Firestore read failed for ${employeeId}, checking cache.`, err);
            }
        }

        // 2. Fall back to local ledger
        const key = `${orgId}_${employeeId}`;
        if (_localLedger.has(key)) {
            return JSON.parse(JSON.stringify(_localLedger.get(key)));
        }

        return null;
    }

    /**
     * Persists or updates an Employee Professional Tax Profile in Firestore.
     * Document Path: organizations/{orgId}/employee_pt_details/{employeeId}
     */
    async function saveEmployeePtDetails(orgId = 'ORG_KYLRX_01', employeeId, ptData = {}) {
        if (!employeeId) {
            throw new Error("Employee ID is required to persist PT details.");
        }

        const now = new Date().toISOString();
        const stateName = ptData.state || "Karnataka";
        const payload = {
            employeeId,
            organizationId: orgId,
            isPtApplicable: ptData.isPtApplicable !== false,
            state: stateName,
            ptRegistrationNo: ptData.ptRegistrationNo || `PTRC_${stateName.slice(0, 2).toUpperCase()}_01`,
            ptSlab: ptData.ptSlab || `${stateName.slice(0, 2).toUpperCase()}_DEFAULT`,
            monthlyDeduction: ptData.monthlyDeduction !== undefined ? Number(ptData.monthlyDeduction) : 200.00,
            effectiveFrom: ptData.effectiveFrom || "2026-01-01",
            effectiveTo: ptData.effectiveTo || null,
            isActive: ptData.isActive !== false,
            overrides: {
                isManualOverride: Boolean(ptData.overrides?.isManualOverride || ptData.isManualOverride),
                exemptReason: ptData.overrides?.exemptReason || ptData.exemptReason || null
            },
            updatedAt: now
        };

        if (!payload.createdAt && ptData.createdAt) {
            payload.createdAt = ptData.createdAt;
        } else if (!payload.createdAt) {
            payload.createdAt = now;
        }

        // 1. Try Cloud Firestore write
        if (typeof window !== 'undefined' && window.db && typeof window.db.collection === 'function') {
            try {
                const docRef = window.db
                    .collection('organizations')
                    .doc(orgId)
                    .collection('employee_pt_details')
                    .doc(employeeId);
                
                await docRef.set(payload, { merge: true });
            } catch (err) {
                console.warn(`[KylrxPtDetailsService] Firestore write failed for ${employeeId}, keeping local state.`, err);
            }
        }

        // 2. Cache in local ledger
        _localLedger.set(`${orgId}_${employeeId}`, JSON.parse(JSON.stringify(payload)));

        return {
            success: true,
            docId: employeeId,
            path: `organizations/${orgId}/employee_pt_details/${employeeId}`,
            ...payload,
            data: payload
        };
    }

    /**
     * Lists all PT profiles for an organization.
     */
    async function listAllPtDetails(orgId = 'ORG_KYLRX_01') {
        const results = [];

        // 1. Try Cloud Firestore
        if (typeof window !== 'undefined' && window.db && typeof window.db.collection === 'function') {
            try {
                const snap = await window.db
                    .collection('organizations')
                    .doc(orgId)
                    .collection('employee_pt_details')
                    .get();
                
                if (!snap.empty) {
                    snap.forEach(doc => {
                        const item = doc.data();
                        results.push(item);
                        _localLedger.set(`${orgId}_${item.employeeId}`, item);
                    });
                    return results;
                }
            } catch (err) {
                console.warn('[KylrxPtDetailsService] Firestore listing failed, returning local cache.', err);
            }
        }

        // 2. Fall back to local ledger
        _localLedger.forEach((val, key) => {
            if (key.startsWith(`${orgId}_`)) {
                results.push(JSON.parse(JSON.stringify(val)));
            }
        });

        return results;
    }

    /**
     * Dynamic Multi-State Professional Tax Slab Resolution Engine (PRD Sections 4 & 11)
     * 
     * Computes the statutory PT deduction based on state jurisdiction, gross earnings,
     * gender, month (February rule), and administrative overrides:
     * 
     * - Karnataka:
     *     * Gross >= ₹25,000 -> Deduct ₹200/month
     *     * Gross < ₹25,000  -> Nil
     * - Maharashtra:
     *     * Males:
     *         - Gross <= ₹7,500: Nil
     *         - Gross ₹7,501 - ₹10,000: ₹175/month
     *         - Gross > ₹10,000: ₹200/month (₹300 in February)
     *     * Females:
     *         - Gross <= ₹25,000: Nil (exempt per state statutory rule)
     *         - Gross > ₹25,000: ₹200/month (₹300 in February)
     * - Telangana / Andhra Pradesh:
     *     * Gross <= ₹15,000: Nil
     *     * Gross ₹15,001 - ₹20,000: ₹150/month
     *     * Gross > ₹20,000: ₹200/month
     * - Tamil Nadu:
     *     * Gross <= ₹21,000: Nil
     *     * Gross ₹21,001 - ₹30,000: ₹100/month
     *     * Gross ₹30,001 - ₹45,000: ₹150/month
     *     * Gross > ₹45,000: ₹200/month
     * - West Bengal:
     *     * Gross <= ₹10,000: Nil
     *     * Gross ₹10,001 - ₹15,000: ₹110/month
     *     * Gross ₹15,001 - ₹25,000: ₹130/month
     *     * Gross ₹25,001 - ₹40,000: ₹150/month
     *     * Gross > ₹40,000: ₹200/month
     * - Gujarat:
     *     * Gross <= ₹12,000: Nil
     *     * Gross > ₹12,000: ₹200/month
     */
    function calculatePtDeduction(profile = {}, wages = {}, options = {}) {
        let combinedProfile = profile || {};
        let combinedWages = wages;
        let combinedOptions = options || {};

        // Support single object parameter
        if (profile && (profile.grossEarnings !== undefined || profile.grossWages !== undefined || profile.gross !== undefined) && (wages === undefined || typeof wages !== 'object' || Object.keys(wages).length === 0)) {
            combinedProfile = profile;
            combinedWages = profile.grossEarnings !== undefined ? profile.grossEarnings : (profile.grossWages || profile.gross);
            combinedOptions = { ...profile, ...options };
        }

        const isPtApplicable = combinedProfile.isPtApplicable !== false;

        let rawGross = 0;
        if (typeof combinedWages === 'number') {
            rawGross = combinedWages;
        } else if (combinedWages && typeof combinedWages === 'object') {
            rawGross = Number(combinedWages.grossEarnings || combinedWages.grossWages || combinedWages.gross || combinedWages.ptGrossWages || combinedWages.basic || combinedWages.totalWages || 0);
        }

        const grossWages = Math.max(0, Math.round(rawGross * 100) / 100);
        const state = (combinedProfile.state || combinedOptions.state || "Karnataka").trim();

        // 1. Inapplicable check
        if (!isPtApplicable || grossWages === 0) {
            return {
                deduction: 0,
                monthlyDeduction: 0,
                state,
                slab: "EXEMPT_INAPPLICABLE",
                ptSlab: "EXEMPT_INAPPLICABLE",
                grossWages,
                isExempt: true,
                isManualOverride: false,
                exemptReason: !isPtApplicable ? "PT Not Applicable" : "Zero Gross Wages",
                reason: !isPtApplicable ? "PT Not Applicable" : "Zero Gross Wages"
            };
        }

        // 2. Administrative / Manual Override check
        const isManualOverride = Boolean(
            combinedOptions.isManualOverride ||
            combinedOptions.manualOverrideAmount !== undefined ||
            combinedProfile.manualOverrideAmount !== undefined ||
            combinedProfile.overrides?.isManualOverride ||
            combinedProfile.isManualOverride
        );

        if (isManualOverride) {
            const manualAmount = combinedOptions.manualOverrideAmount !== undefined
                ? Number(combinedOptions.manualOverrideAmount)
                : (combinedProfile.manualOverrideAmount !== undefined
                    ? Number(combinedProfile.manualOverrideAmount)
                    : (combinedOptions.monthlyDeduction !== undefined
                        ? Number(combinedOptions.monthlyDeduction)
                        : Number(combinedProfile.monthlyDeduction || 0)));

            const exemptReason = combinedOptions.exemptReason || combinedProfile.exemptReason || combinedProfile.overrides?.exemptReason || null;

            return {
                deduction: Math.max(0, manualAmount),
                monthlyDeduction: Math.max(0, manualAmount),
                state,
                slab: combinedProfile.ptSlab || "MANUAL_OVERRIDE",
                ptSlab: combinedProfile.ptSlab || "MANUAL_OVERRIDE",
                grossWages,
                isExempt: manualAmount === 0,
                isManualOverride: true,
                exemptReason,
                reason: "Administrative Fixed Override"
            };
        }

        // 3. Statutory Exemptions (Senior citizens >= 65 years, Persons with Disability)
        const isSeniorCitizen = Boolean(
            combinedOptions.isSeniorCitizen ||
            combinedOptions.age >= 65 ||
            combinedProfile.isSeniorCitizen ||
            combinedProfile.exemptReason === 'SENIOR_CITIZEN_EXEMPTION' ||
            combinedOptions.exemptReason === 'SENIOR_CITIZEN_EXEMPTION'
        );
        const isPwd = Boolean(
            combinedOptions.isPwd ||
            combinedOptions.isPersonWithDisability ||
            combinedProfile.isPersonWithDisability ||
            combinedProfile.isPwd ||
            combinedProfile.exemptReason === 'DISABILITY_EXEMPTION' ||
            combinedOptions.exemptReason === 'DISABILITY_EXEMPTION'
        );

        if (isSeniorCitizen) {
            return {
                deduction: 0,
                monthlyDeduction: 0,
                state,
                slab: "EXEMPT_SENIOR_CITIZEN",
                ptSlab: "EXEMPT_SENIOR_CITIZEN",
                grossWages,
                isExempt: true,
                isManualOverride: false,
                exemptReason: "SENIOR_CITIZEN_EXEMPTION",
                reason: "Senior Citizen Statutory Exemption"
            };
        }

        if (isPwd) {
            return {
                deduction: 0,
                monthlyDeduction: 0,
                state,
                slab: "EXEMPT_DISABILITY",
                ptSlab: "EXEMPT_DISABILITY",
                grossWages,
                isExempt: true,
                isManualOverride: false,
                exemptReason: "DISABILITY_EXEMPTION",
                reason: "Person with Disability (PWD) Exemption"
            };
        }

        // 4. Determine Month context (for Maharashtra February ₹300 rule)
        let isFebruary = false;
        if (combinedOptions.month) {
            const mStr = String(combinedOptions.month).toLowerCase();
            isFebruary = mStr.includes('feb') || mStr === '2' || mStr === '02';
        } else if (combinedOptions.monthNumber === 2 || combinedOptions.monthNumber === '02') {
            isFebruary = true;
        }

        const gender = String(combinedOptions.gender || combinedProfile.gender || 'male').toLowerCase().trim();
        const normState = state.toLowerCase().replace(/[\s_-]+/g, '');

        let deduction = 0;
        let slabCode = "TIER_NIL";

        // 5. Dynamic State Jurisdiction Evaluation
        if (normState === 'karnataka') {
            if (grossWages >= 25000) {
                deduction = 200;
                slabCode = "KA_TIER_1";
            } else {
                deduction = 0;
                slabCode = "KA_EXEMPT";
            }
        } else if (normState === 'maharashtra') {
            const isFemale = gender === 'female' || gender === 'f';
            if (isFemale) {
                // Maharashtra Female: Exempt up to ₹25,000
                if (grossWages > 25000) {
                    deduction = isFebruary ? 300 : 200;
                    slabCode = isFebruary ? "MH_FEMALE_FEB_300" : "MH_FEMALE_TIER_2";
                } else {
                    deduction = 0;
                    slabCode = "MH_FEMALE_EXEMPT";
                }
            } else {
                // Maharashtra Male
                if (grossWages > 10000) {
                    deduction = isFebruary ? 300 : 200;
                    slabCode = isFebruary ? "MH_MALE_FEB_300" : "MH_MALE_TIER_2";
                } else if (grossWages > 7500) {
                    deduction = 175;
                    slabCode = "MH_MALE_TIER_1";
                } else {
                    deduction = 0;
                    slabCode = "MH_MALE_EXEMPT";
                }
            }
        } else if (normState === 'telangana' || normState === 'andhrapradesh') {
            const prefix = normState === 'telangana' ? 'TG' : 'AP';
            if (grossWages > 20000) {
                deduction = 200;
                slabCode = `${prefix}_TIER_2`;
            } else if (grossWages > 15000) {
                deduction = 150;
                slabCode = `${prefix}_TIER_1`;
            } else {
                deduction = 0;
                slabCode = `${prefix}_EXEMPT`;
            }
        } else if (normState === 'tamilnadu') {
            if (grossWages > 45000) {
                deduction = 200;
                slabCode = "TN_TIER_4";
            } else if (grossWages > 30000) {
                deduction = 150;
                slabCode = "TN_TIER_3";
            } else if (grossWages > 21000) {
                deduction = 100;
                slabCode = "TN_TIER_2";
            } else {
                deduction = 0;
                slabCode = "TN_EXEMPT";
            }
        } else if (normState === 'westbengal') {
            if (grossWages > 40000) {
                deduction = 200;
                slabCode = "WB_TIER_5";
            } else if (grossWages > 25000) {
                deduction = 150;
                slabCode = "WB_TIER_4";
            } else if (grossWages > 15000) {
                deduction = 130;
                slabCode = "WB_TIER_3";
            } else if (grossWages > 10000) {
                deduction = 110;
                slabCode = "WB_TIER_2";
            } else {
                deduction = 0;
                slabCode = "WB_EXEMPT";
            }
        } else if (normState === 'gujarat') {
            if (grossWages > 12000) {
                deduction = 200;
                slabCode = "GJ_TIER_1";
            } else {
                deduction = 0;
                slabCode = "GJ_EXEMPT";
            }
        } else {
            // Standard / default fallback state slab
            if (grossWages >= 20000) {
                deduction = 200;
                slabCode = "DEFAULT_STATE_TIER_1";
            } else {
                deduction = 0;
                slabCode = "DEFAULT_STATE_EXEMPT";
            }
        }

        return {
            deduction,
            monthlyDeduction: deduction,
            state,
            slab: slabCode,
            ptSlab: slabCode,
            grossWages,
            isExempt: deduction === 0,
            isManualOverride: false,
            exemptReason: null,
            isFebruary,
            reason: deduction === 0 ? "Income Below Minimum Slab Threshold" : "Statutory Slab Deduction"
        };
    }

    /**
     * Monthly PT Remittance Return Row Generator
     * 
     * Formats official PT return hash-delimited text row:
     * Employee_ID#Employee_Name#PTRC_Number#Gross_Wages#PT_Deducted#State#Month_Year
     * 
     * @param {Object} profile Employee PT profile or single row object
     * @param {Object|number} wages Monthly salary / wages
     * @param {Object} options { employeeName, monthYear, gender, month }
     * @returns {string} Hash-delimited PT row
     */
    function generatePtReturnRow(profile = {}, wages = {}, options = {}) {
        // If single flat object passed
        if (profile && (profile.grossWages !== undefined || profile.ptDeducted !== undefined) && (wages === undefined || Object.keys(wages).length === 0)) {
            const empId = String(profile.employeeId || profile.Employee_ID || '').trim();
            const empName = String(profile.employeeName || profile.Employee_Name || profile.name || empId || 'Employee').trim();
            const ptrcNo = String(profile.ptRegistrationNo || profile.PTRC_Number || profile.ptrcNo || 'PTRC_DEFAULT').trim();
            const state = String(profile.state || profile.State || 'Karnataka').trim();
            const monthYear = String(profile.monthYear || profile.Month_Year || profile.period || '2026-10').trim();
            const grossWages = Number(profile.grossWages !== undefined ? profile.grossWages : (profile.Gross_Wages || 0)).toFixed(2);
            const ptDeducted = Number(profile.ptDeducted !== undefined ? profile.ptDeducted : (profile.PT_Deducted !== undefined ? profile.PT_Deducted : (profile.monthlyDeduction || 0))).toFixed(2);

            return [
                empId,
                empName,
                ptrcNo,
                grossWages,
                ptDeducted,
                state,
                monthYear
            ].join('#');
        }

        const empId = String(profile.employeeId || options.employeeId || '').trim();
        const empName = String(options.employeeName || options.name || profile.employeeName || empId || 'Employee').trim();
        const ptrcNo = String(profile.ptRegistrationNo || options.ptrcNo || options.ptRegistrationNo || 'PTRC_DEFAULT').trim();
        const state = String(profile.state || options.state || 'Karnataka').trim();
        const monthYear = String(options.monthYear || options.period || '2026-10').trim();

        const calc = calculatePtDeduction(profile, wages, options);
        const grossWages = calc.grossWages.toFixed(2);
        const ptDeducted = calc.deduction.toFixed(2);

        // Exact 7 Columns per PRD Section 11:
        // 1. Employee_ID
        // 2. Employee_Name
        // 3. PTRC_Number
        // 4. Gross_Wages
        // 5. PT_Deducted
        // 6. State
        // 7. Month_Year
        return [
            empId,
            empName,
            ptrcNo,
            grossWages,
            ptDeducted,
            state,
            monthYear
        ].join('#');
    }

    /**
     * Generates a complete monthly PT statutory remittance register file (.csv/.txt format).
     * 
     * @param {Array<Object>} records Array of { profile, wages, options } or flat objects
     * @param {Object|string} headerMeta { state, ptrcNumber, monthYear } or monthYear string
     * @returns {Object} { content, filename, rowCount, totalEmployees, totalWages, totalPtDeducted, byState, state }
     */
    function generatePtReturnFile(records = [], headerMeta = {}) {
        const state = (typeof headerMeta === 'object' && headerMeta.state) || 'Karnataka';
        const ptrcNo = (typeof headerMeta === 'object' && headerMeta.ptrcNumber) || 'PTRC1234567K';
        const monthYear = (typeof headerMeta === 'string' ? headerMeta : headerMeta.monthYear) || '2026-10';

        const rows = [];
        let totalWages = 0;
        let totalPtDeducted = 0;
        const byState = {};

        records.forEach(item => {
            const rowStr = generatePtReturnRow(item, item.wages, { ...item, monthYear });
            rows.push(rowStr);

            const rowState = item.state || (item.profile && item.profile.state) || state;
            let rowGross = 0;
            let rowPt = 0;

            if (item.grossWages !== undefined || item.ptDeducted !== undefined) {
                rowGross = Number(item.grossWages || item.Gross_Wages || 0);
                rowPt = Number(item.ptDeducted !== undefined ? item.ptDeducted : (item.PT_Deducted !== undefined ? item.PT_Deducted : (item.monthlyDeduction || 0)));
            } else {
                const calc = calculatePtDeduction(item.profile || item, item.wages || item, item.options || item);
                rowGross = calc.grossWages;
                rowPt = calc.deduction;
            }

            totalWages += rowGross;
            totalPtDeducted += rowPt;

            if (!byState[rowState]) {
                byState[rowState] = { count: 0, totalWages: 0, totalPt: 0 };
            }
            byState[rowState].count += 1;
            byState[rowState].totalWages += rowGross;
            byState[rowState].totalPt += rowPt;
        });

        const stateClean = state.replace(/\s+/g, '_');
        const filename = `PT_Return_${stateClean}_${monthYear.replace(/[-/]/g, '')}.txt`;
        const content = rows.join('\r\n');

        return {
            filename,
            content,
            fileContent: content,
            rowCount: rows.length,
            totalEmployees: rows.length,
            totalWages: Math.round(totalWages * 100) / 100,
            totalPtDeducted: Math.round(totalPtDeducted * 100) / 100,
            byState,
            state,
            ptrcNumber: ptrcNo,
            monthYear
        };
    }

    /**
     * Converts a list of parsed sheet rows to Firestore batch documents and executes commit.
     */
    async function commitBatchPtDetails(orgId = 'ORG_KYLRX_01', firestoreDocs = []) {
        let committedCount = 0;
        const errors = [];

        for (const doc of firestoreDocs) {
            try {
                await saveEmployeePtDetails(orgId, doc.employeeId, doc);
                committedCount++;
            } catch (err) {
                errors.push({
                    employeeId: doc.employeeId,
                    message: err.message || 'Failed to save PT detail record.'
                });
            }
        }

        return {
            committedCount,
            errors
        };
    }

    return {
        DEFAULT_PT_PROFILES,
        seedDefaultRecords,
        resolvePtStatusBadge,
        resolveSlabBadge,
        getEmployeePtDetails,
        saveEmployeePtDetails,
        listAllPtDetails,
        calculatePtDeduction,
        generatePtReturnRow,
        generatePtReturnFile,
        commitBatchPtDetails
    };
}));
