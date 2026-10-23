/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - NATIONAL PENSION SYSTEM (NPS) STATUTORY SERVICE MODULE
 * ============================================================================
 * 
 * Manages Cloud Firestore persistence, dynamic Section 80CCD deduction engine,
 * YTD monotonic contribution accrual, and NSDL / Protean CRA contribution file generator
 * matching PRD Sections 1, 4, 11, & 13:
 * 
 * Firestore Path:
 * organizations/{orgId}/employee_nps_details/{employeeId}
 * 
 * Standard CRA SCF (Subscriber Contribution File) Row Format:
 * PRAN#Employee_Tier1_Amount#Employer_Tier1_Amount#Employee_Tier2_Amount#Contribution_Period
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
        root.KylrxNpsDetailsService = factory();
        root.npsDetailsService = root.KylrxNpsDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for tests / offline mode / fast caching
    const _localLedger = new Map();

    // Default Seed Profiles matching Templates.xlsx and active enterprise employees
    const DEFAULT_NPS_PROFILES = [
        {
            employeeId: "EMP0001",
            organizationId: "ORG_KYLRX_01",
            isNpsApplicable: true,
            pran: "110023456789",
            npsAccountStatus: "ACTIVE",
            npsModel: "Corporate Model",
            craAgency: "Protean (NSDL)",
            popIntermediary: "HDFC Pension Management Co.",
            tier1Active: true,
            tier2Active: false,
            dateOfNpsJoining: "2026-01-15",
            dateOfNpsExit: null,
            contributions: {
                employeePercentage: 10.0,
                employeeAmount: null,
                employerPercentage: 10.0,
                employerAmount: null,
                totalContributionYtd: 90000.00
            },
            nomineeStatus: "VERIFIED",
            kyc: {
                overallStatus: "VERIFIED",
                panKyc: "VERIFIED",
                aadhaarKyc: "VERIFIED",
                bankKyc: "VERIFIED"
            },
            createdAt: "2026-01-15T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        },
        {
            employeeId: "EMP0002",
            organizationId: "ORG_KYLRX_01",
            isNpsApplicable: true,
            pran: "110098765432",
            npsAccountStatus: "ACTIVE",
            npsModel: "Corporate Model",
            craAgency: "KFintech",
            popIntermediary: "ICICI Prudential Pension Funds",
            tier1Active: true,
            tier2Active: true,
            dateOfNpsJoining: "2026-02-01",
            dateOfNpsExit: null,
            contributions: {
                employeePercentage: 10.0,
                employeeAmount: null,
                employerPercentage: 14.0,
                employerAmount: null,
                totalContributionYtd: 120000.00
            },
            nomineeStatus: "VERIFIED",
            kyc: {
                overallStatus: "VERIFIED",
                panKyc: "VERIFIED",
                aadhaarKyc: "VERIFIED",
                bankKyc: "VERIFIED"
            },
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        },
        {
            employeeId: "EMP0003",
            organizationId: "ORG_KYLRX_01",
            isNpsApplicable: true,
            pran: "110055443322",
            npsAccountStatus: "ACTIVE",
            npsModel: "All Citizen Model",
            craAgency: "CAMS",
            popIntermediary: "SBI Pension Funds Pvt Ltd",
            tier1Active: true,
            tier2Active: false,
            dateOfNpsJoining: "2026-03-01",
            dateOfNpsExit: null,
            contributions: {
                employeePercentage: null,
                employeeAmount: 5000.00,
                employerPercentage: null,
                employerAmount: 5000.00,
                totalContributionYtd: 35000.00
            },
            nomineeStatus: "SUBMITTED",
            kyc: {
                overallStatus: "VERIFIED",
                panKyc: "VERIFIED",
                aadhaarKyc: "VERIFIED",
                bankKyc: "VERIFIED"
            },
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-10-05T10:30:00Z"
        }
    ];

    /**
     * Seeds in-memory ledger with default records.
     */
    function seedDefaultRecords(orgId = 'ORG_KYLRX_01') {
        DEFAULT_NPS_PROFILES.forEach(profile => {
            const key = `${orgId}_${profile.employeeId}`;
            if (!_localLedger.has(key)) {
                _localLedger.set(key, JSON.parse(JSON.stringify(profile)));
            }
        });
    }

    // Auto-seed default ledger
    seedDefaultRecords();

    /**
     * Resolves visual badge properties for NPS Account Status.
     */
    function resolveNpsStatusBadge(accountStatus = "ACTIVE", isNpsApplicable = true) {
        if (!isNpsApplicable) {
            return {
                label: 'Exempt / Not Enrolled',
                status: 'EXEMPT',
                bg: '#f1f5f9',
                color: '#475569',
                border: '#cbd5e1',
                icon: 'shield-off'
            };
        }
        const s = String(accountStatus).toUpperCase();
        if (s === 'ACTIVE') {
            return {
                label: 'Active Subscriber',
                status: 'ACTIVE',
                bg: '#ecfdf5',
                color: '#059669',
                border: '#a7f3d0',
                icon: 'check-circle'
            };
        }
        if (s === 'FROZEN') {
            return {
                label: 'Account Frozen',
                status: 'FROZEN',
                bg: '#eff6ff',
                color: '#1d4ed8',
                border: '#bfdbfe',
                icon: 'snowflake'
            };
        }
        if (s === 'SUSPENDED') {
            return {
                label: 'Suspended',
                status: 'SUSPENDED',
                bg: '#fef2f2',
                color: '#dc2626',
                border: '#fecaca',
                icon: 'alert-octagon'
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
     * Resolves KYC status badge styling.
     */
    function resolveKycBadge(status = "VERIFIED") {
        const s = String(status).toUpperCase();
        if (s === 'VERIFIED') {
            return { label: 'VERIFIED', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
        }
        if (s === 'PENDING') {
            return { label: 'PENDING', bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
        }
        if (s === 'NOT_SEEDED') {
            return { label: 'NOT SEEDED', bg: '#f1f5f9', color: '#64748b', border: '#cbd5e1' };
        }
        return { label: s, bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' };
    }

    /**
     * Resolves CRA badge styling.
     */
    function resolveCraBadge(craAgency = "Protean (NSDL)") {
        const s = String(craAgency);
        if (s.includes('Protean') || s.includes('NSDL')) {
            return { label: 'Protean (NSDL)', bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' };
        }
        if (s.includes('KFintech')) {
            return { label: 'KFintech', bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' };
        }
        if (s.includes('CAMS')) {
            return { label: 'CAMS', bg: '#fdf2f8', color: '#be185d', border: '#fbcfe8' };
        }
        return { label: s, bg: '#f8fafc', color: '#334155', border: '#cbd5e1' };
    }

    /**
     * Retrieves an Employee NPS Statutory Profile.
     * First queries Cloud Firestore; falls back to in-memory ledger.
     */
    async function getEmployeeNpsDetails(orgId = 'ORG_KYLRX_01', employeeId) {
        if (!employeeId) return null;
        const tenant = orgId || 'ORG_KYLRX_01';
        const key = `${tenant}_${employeeId}`;

        // 1. Try Cloud Firestore if runtime db is available
        if (typeof window !== 'undefined' && window.db && typeof window.doc === 'function' && typeof window.getDoc === 'function') {
            try {
                const docRef = window.doc(window.db, "organizations", tenant, "employee_nps_details", employeeId);
                const snap = await window.getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data();
                    _localLedger.set(key, data);
                    return data;
                }
            } catch (err) {
                console.warn(`[KylrxNpsDetailsService] Firestore read failed for ${employeeId}, checking cache.`, err);
            }
        }

        // 2. Fall back to local ledger cache
        if (_localLedger.has(key)) {
            return JSON.parse(JSON.stringify(_localLedger.get(key)));
        }

        // Check default seed profiles
        const found = DEFAULT_NPS_PROFILES.find(p => p.employeeId === employeeId);
        if (found) {
            _localLedger.set(key, JSON.parse(JSON.stringify(found)));
            return JSON.parse(JSON.stringify(found));
        }

        return null;
    }

    /**
     * Persists an Employee NPS Statutory Profile into Cloud Firestore & local cache.
     * Path: organizations/{orgId}/employee_nps_details/{employeeId}
     */
    async function saveEmployeeNpsDetails(orgId = 'ORG_KYLRX_01', employeeId, npsData = {}) {
        if (!employeeId) throw new Error("Employee ID is required to save NPS details.");
        const tenant = orgId || 'ORG_KYLRX_01';
        const key = `${tenant}_${employeeId}`;

        const existing = _localLedger.get(key) || {};

        const contributions = npsData.contributions || {
            employeePercentage: npsData.employeePercentage !== undefined ? npsData.employeePercentage : (npsData['Employee Contribution %'] !== undefined ? Number(npsData['Employee Contribution %']) : (existing.contributions?.employeePercentage ?? 10.0)),
            employeeAmount: npsData.employeeAmount !== undefined ? npsData.employeeAmount : (npsData['Employee Contribution Amount'] !== undefined ? Number(npsData['Employee Contribution Amount']) : (existing.contributions?.employeeAmount ?? null)),
            employerPercentage: npsData.employerPercentage !== undefined ? npsData.employerPercentage : (npsData['Employer Contribution %'] !== undefined ? Number(npsData['Employer Contribution %']) : (existing.contributions?.employerPercentage ?? 10.0)),
            employerAmount: npsData.employerAmount !== undefined ? npsData.employerAmount : (npsData['Employer Contribution Amount'] !== undefined ? Number(npsData['Employer Contribution Amount']) : (existing.contributions?.employerAmount ?? null)),
            totalContributionYtd: npsData.totalContributionYtd !== undefined ? Number(npsData.totalContributionYtd) : (npsData['Total Contribution YTD'] !== undefined ? Number(npsData['Total Contribution YTD']) : (existing.contributions?.totalContributionYtd ?? 0.00))
        };

        const kyc = npsData.kyc || {
            overallStatus: npsData.kycStatus || npsData['KYC Status'] || existing.kyc?.overallStatus || "VERIFIED",
            panKyc: npsData.panKyc || npsData['PAN KYC'] || existing.kyc?.panKyc || "VERIFIED",
            aadhaarKyc: npsData.aadhaarKyc || npsData['Aadhaar KYC'] || existing.kyc?.aadhaarKyc || "VERIFIED",
            bankKyc: npsData.bankKyc || npsData['Bank KYC'] || existing.kyc?.bankKyc || "VERIFIED"
        };

        const payload = {
            employeeId,
            organizationId: tenant,
            isNpsApplicable: npsData.isNpsApplicable !== false && npsData['NPS Applicable'] !== 'No',
            pran: npsData.pran || npsData['PRAN'] || existing.pran || null,
            npsAccountStatus: npsData.npsAccountStatus || npsData['NPS Account Status'] || existing.npsAccountStatus || "ACTIVE",
            npsModel: npsData.npsModel || npsData['NPS Model'] || existing.npsModel || "Corporate Model",
            craAgency: npsData.craAgency || npsData['CRA / Recordkeeping Agency'] || npsData.craRecordkeepingAgency || existing.craAgency || "Protean (NSDL)",
            popIntermediary: npsData.popIntermediary || npsData['POP / Intermediary'] || existing.popIntermediary || "HDFC Pension Management Co.",
            tier1Active: npsData.tier1Active !== undefined ? Boolean(npsData.tier1Active) : (existing.tier1Active ?? true),
            tier2Active: npsData.tier2Active !== undefined ? Boolean(npsData.tier2Active) : (existing.tier2Active ?? false),
            dateOfNpsJoining: npsData.dateOfNpsJoining || npsData['Date of NPS Joining'] || existing.dateOfNpsJoining || "2026-01-15",
            dateOfNpsExit: npsData.dateOfNpsExit || npsData['Date of NPS Exit'] || existing.dateOfNpsExit || null,
            contributions,
            nomineeStatus: npsData.nomineeStatus || npsData['Nominee Details Status'] || existing.nomineeStatus || "SUBMITTED",
            kyc,
            updatedAt: new Date().toISOString()
        };

        if (!_localLedger.has(key)) {
            payload.createdAt = new Date().toISOString();
        } else {
            payload.createdAt = existing.createdAt || new Date().toISOString();
        }

        _localLedger.set(key, payload);

        // Commit to Cloud Firestore if connected
        if (typeof window !== 'undefined' && window.db && typeof window.doc === 'function' && typeof window.setDoc === 'function') {
            try {
                const docRef = window.doc(window.db, "organizations", tenant, "employee_nps_details", employeeId);
                await window.setDoc(docRef, payload, { merge: true });
            } catch (err) {
                console.warn(`[KylrxNpsDetailsService] Firestore write failed for ${employeeId}, keeping local state.`, err);
            }
        }

        return payload;
    }

    /**
     * Lists all NPS profiles for a tenant.
     */
    async function listAllNpsDetails(orgId = 'ORG_KYLRX_01') {
        const tenant = orgId || 'ORG_KYLRX_01';
        const results = [];

        if (typeof window !== 'undefined' && window.db && typeof window.collection === 'function' && typeof window.getDocs === 'function') {
            try {
                const colRef = window.collection(window.db, "organizations", tenant, "employee_nps_details");
                const snap = await window.getDocs(colRef);
                if (!snap.empty) {
                    snap.forEach(d => results.push(d.data()));
                    return results;
                }
            } catch (err) {
                console.warn('[KylrxNpsDetailsService] Firestore listing failed, returning local cache.', err);
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
     * Dynamic Statutory Payroll Deduction Engine (PRD Sections 4 & 11)
     * Computes monthly employee deduction, corporate co-contribution, tax exemptions
     * under Section 80CCD(1), 80CCD(1B), and 80CCD(2), and handles monotonic YTD accrual.
     * 
     * @param {Object} profile Employee NPS statutory profile
     * @param {number|Object} wages Wage base (Basic + DA) or salary structure object
     * @param {Object} options Options: { taxRegime: 'OLD'|'NEW', sector: 'PRIVATE'|'GOVERNMENT', isFinalizePayroll: boolean }
     * @returns {Object} Deduction and tax relief breakdown
     */
    function calculateNpsDeduction(profile = {}, wages = 0, options = {}) {
        let wageBase = 0;
        let basic = 0;
        let da = 0;

        if (typeof wages === 'number') {
            wageBase = wages;
            basic = wages;
        } else if (typeof wages === 'object' && wages !== null) {
            basic = Number(wages.basic || wages.basicSalary || wages.basicPay || 0);
            da = Number(wages.da || wages.dearnessAllowance || wages.daSalary || wages.daPay || 0);
            wageBase = (basic + da) > 0 ? (basic + da) : Number(wages.grossSalary || wages.grossPay || wages.wageBase || 0);
        }

        const isNpsApplicable = profile.isNpsApplicable !== false && profile['NPS Applicable'] !== 'No' && options.isNpsApplicable !== false;
        const pran = profile.pran || profile['PRAN'] || options.pran || '—';
        const tier1Active = profile.tier1Active !== false && profile['Tier I Active'] !== 'No';
        const tier2Active = profile.tier2Active === true || profile['Tier II Active'] === 'Yes';
        const npsModel = profile.npsModel || profile['NPS Model'] || "Corporate Model";
        const isGovernment = npsModel === 'Government' || options.sector === 'GOVERNMENT';
        const taxRegime = (options.taxRegime || 'OLD').toUpperCase();

        if (!isNpsApplicable || !tier1Active) {
            return {
                isNpsApplicable: false,
                pran,
                wageBase,
                employeeTier1Amount: 0,
                employerTier1Amount: 0,
                employeeTier2Amount: 0,
                totalMonthlyContribution: 0,
                deductionFromNetPay: 0,
                employerContributionLiability: 0,
                taxRelief: {
                    section80CCD1: 0,
                    section80CCD1B: 0,
                    section80CCD2: 0,
                    eligibleTaxExemption: 0
                },
                priorYtd: Number(profile.contributions?.totalContributionYtd || profile['Total Contribution YTD'] || 0),
                updatedYtd: Number(profile.contributions?.totalContributionYtd || profile['Total Contribution YTD'] || 0),
                reason: !isNpsApplicable ? "NPS Not Applicable" : "Tier I Not Active"
            };
        }

        const contribs = profile.contributions || {};
        const eePct = contribs.employeePercentage !== undefined ? contribs.employeePercentage : (profile['Employee Contribution %'] !== undefined ? profile['Employee Contribution %'] : options.employeePercentage);
        const eeAmt = contribs.employeeAmount !== undefined ? contribs.employeeAmount : (profile['Employee Contribution Amount'] !== undefined ? profile['Employee Contribution Amount'] : options.employeeAmount);
        const erPct = contribs.employerPercentage !== undefined ? contribs.employerPercentage : (profile['Employer Contribution %'] !== undefined ? profile['Employer Contribution %'] : options.employerPercentage);
        const erAmt = contribs.employerAmount !== undefined ? contribs.employerAmount : (profile['Employer Contribution Amount'] !== undefined ? profile['Employer Contribution Amount'] : options.employerAmount);

        // 1. Employee Contribution Calculation
        let employeeTier1Amount = 0;
        if (eePct !== null && eePct !== undefined && String(eePct).trim() !== '') {
            employeeTier1Amount = Math.round(((Number(eePct) / 100) * wageBase) * 100) / 100;
        } else if (eeAmt !== null && eeAmt !== undefined && String(eeAmt).trim() !== '') {
            employeeTier1Amount = Math.round(Number(eeAmt) * 100) / 100;
        }

        // 2. Employer Contribution Calculation
        let employerTier1Amount = 0;
        if (erPct !== null && erPct !== undefined && String(erPct).trim() !== '') {
            employerTier1Amount = Math.round(((Number(erPct) / 100) * wageBase) * 100) / 100;
        } else if (erAmt !== null && erAmt !== undefined && String(erAmt).trim() !== '') {
            employerTier1Amount = Math.round(Number(erAmt) * 100) / 100;
        }

        // 3. Optional Tier 2 Voluntary Contribution
        let employeeTier2Amount = 0;
        if (tier2Active && (options.tier2Amount || contribs.tier2Amount)) {
            employeeTier2Amount = Number(options.tier2Amount || contribs.tier2Amount || 0);
        }

        const totalMonthlyContribution = Math.round((employeeTier1Amount + employerTier1Amount + employeeTier2Amount) * 100) / 100;

        // 4. Statutory Tax Relief Rules (Section 80CCD)
        // Section 80CCD(1): Employee contribution up to 10% of (Basic + DA), within ₹1.5L (Old Regime only)
        const maxEeStatutoryRate = 0.10;
        const max80CCD1Eligible = Math.min(employeeTier1Amount, Math.round((maxEeStatutoryRate * wageBase) * 100) / 100);
        const section80CCD1 = taxRegime === 'OLD' ? max80CCD1Eligible : 0;

        // Section 80CCD(1B): Exclusive extra ₹50,000 deduction per FY for employee NPS (Old Regime only)
        // Monthly pro-rated allocation up to ₹50,000 / 12 = ~₹4,166.67 or remaining portion
        const section80CCD1B = taxRegime === 'OLD' ? Math.min(employeeTier1Amount, 4166.67) : 0;

        // Section 80CCD(2): Employer contribution tax exemption (Applicable in BOTH Old and New Regimes!)
        // Cap: 10% for Private Sector, 14% for Government Sector, subject to ₹7.5 Lakh aggregate cap per FY
        const maxErStatutoryRate = isGovernment ? 0.14 : 0.10;
        const max80CCD2Eligible = Math.min(employerTier1Amount, Math.round((maxErStatutoryRate * wageBase) * 100) / 100);
        const section80CCD2 = max80CCD2Eligible;

        const totalTaxExemption = (taxRegime === 'OLD')
            ? (section80CCD1 + section80CCD1B + section80CCD2)
            : section80CCD2; // In New Regime, only 80CCD(2) employer deduction is allowable

        // 5. YTD Monotonic Accrual
        const priorYtd = Number(contribs.totalContributionYtd || profile['Total Contribution YTD'] || 0);
        const updatedYtd = Math.round((priorYtd + totalMonthlyContribution) * 100) / 100;

        // Update profile in memory if payroll batch finalization requested
        if (options.isFinalizePayroll && profile.employeeId) {
            profile.contributions = profile.contributions || {};
            profile.contributions.totalContributionYtd = updatedYtd;
            const orgId = profile.organizationId || options.orgId || 'ORG_KYLRX_01';
            const key = `${orgId}_${profile.employeeId}`;
            if (_localLedger.has(key)) {
                _localLedger.get(key).contributions.totalContributionYtd = updatedYtd;
            }
        }

        return {
            isNpsApplicable: true,
            pran,
            wageBase,
            npsModel,
            isGovernment,
            taxRegime,
            employeeTier1Amount,
            employerTier1Amount,
            employeeTier2Amount,
            totalMonthlyContribution,
            deductionFromNetPay: employeeTier1Amount + employeeTier2Amount,
            employerContributionLiability: employerTier1Amount,
            taxRelief: {
                section80CCD1,
                section80CCD1B,
                section80CCD2,
                eligibleTaxExemption: totalTaxExemption
            },
            priorYtd,
            updatedYtd,
            reason: `NPS Tier I executed (EE: ₹${employeeTier1Amount.toFixed(2)}, ER: ₹${employerTier1Amount.toFixed(2)}) under Section 80CCD`
        };
    }

    /**
     * Formats a single subscriber contribution record into standard Protean / NSDL SCF payload format:
     * PRAN#Employee_Tier1_Amount#Employer_Tier1_Amount#Employee_Tier2_Amount#Contribution_Period
     * 
     * @param {Object} record Employee statutory profile or payroll deduction record
     * @param {Object} options Options containing period e.g. "2026-10"
     * @returns {string} Hash-delimited string
     */
    function generateCraReturnRow(record = {}, optionsOrResult = {}, maybePeriod = null) {
        let period = '2026-10';
        let eeTier1 = 0;
        let erTier1 = 0;
        let eeTier2 = 0;

        if (typeof optionsOrResult === 'string') {
            period = optionsOrResult;
        } else if (maybePeriod && typeof maybePeriod === 'string') {
            period = maybePeriod;
        } else if (typeof optionsOrResult === 'object' && optionsOrResult !== null) {
            period = optionsOrResult.period || optionsOrResult.monthYear || record.period || '2026-10';
        }

        const pran = String(
            record.pran || record['PRAN'] || 
            (typeof optionsOrResult === 'object' && (optionsOrResult?.pran || optionsOrResult?.['PRAN'])) || 
            '000000000000'
        ).trim();

        const source = (typeof optionsOrResult === 'object' && optionsOrResult !== null && optionsOrResult.employeeTier1Amount !== undefined)
            ? optionsOrResult
            : record;

        if (source.employeeTier1Amount !== undefined && source.employerTier1Amount !== undefined) {
            eeTier1 = Number(source.employeeTier1Amount);
            erTier1 = Number(source.employerTier1Amount);
            eeTier2 = Number(source.employeeTier2Amount || 0);
        } else {
            const wages = (typeof optionsOrResult === 'object' && (optionsOrResult?.wageBase || optionsOrResult?.basic)) || 50000;
            const calc = calculateNpsDeduction(record, wages, typeof optionsOrResult === 'object' ? optionsOrResult : {});
            eeTier1 = calc.employeeTier1Amount;
            erTier1 = calc.employerTier1Amount;
            eeTier2 = calc.employeeTier2Amount;
        }

        return [
            pran,
            eeTier1.toFixed(2),
            erTier1.toFixed(2),
            eeTier2.toFixed(2),
            period
        ].join('#');
    }

    /**
     * Generates a complete monthly NSDL / Protean Subscriber Contribution File (SCF) payload.
     * 
     * @param {Array<Object>} records Array of employee records or deduction objects
     * @param {Object|string} headerMeta Header options or period string e.g. "2026-10"
     * @returns {Object} Remittance ledger object
     */
    function generateCraReturnFile(records = [], headerMeta = {}) {
        const period = (typeof headerMeta === 'string' ? headerMeta : headerMeta.period || headerMeta.monthYear) || '2026-10';
        const craAgency = (typeof headerMeta === 'object' && headerMeta.craAgency) || 'Protean (NSDL)';

        const rows = [];
        let totalEmployeeTier1 = 0;
        let totalEmployerTier1 = 0;
        let totalEmployeeTier2 = 0;
        let totalContribution = 0;
        const byCra = {};

        records.forEach(item => {
            const rowStr = generateCraReturnRow(item, { ...item, period });
            rows.push(rowStr);

            const parts = rowStr.split('#');
            const ee1 = parseFloat(parts[1]) || 0;
            const er1 = parseFloat(parts[2]) || 0;
            const ee2 = parseFloat(parts[3]) || 0;
            const subTotal = ee1 + er1 + ee2;

            totalEmployeeTier1 += ee1;
            totalEmployerTier1 += er1;
            totalEmployeeTier2 += ee2;
            totalContribution += subTotal;

            const itemCra = item.craAgency || item['CRA / Recordkeeping Agency'] || craAgency;
            if (!byCra[itemCra]) {
                byCra[itemCra] = { count: 0, totalEe1: 0, totalEr1: 0, totalEe2: 0, totalContribution: 0 };
            }
            byCra[itemCra].count += 1;
            byCra[itemCra].totalEe1 += ee1;
            byCra[itemCra].totalEr1 += er1;
            byCra[itemCra].totalEe2 += ee2;
            byCra[itemCra].totalContribution += subTotal;
        });

        const cleanPeriod = period.replace(/[-/]/g, '');
        const filename = `NPS_CRA_SCF_${cleanPeriod}.txt`;
        const csvFilename = `NPS_CRA_SCF_${cleanPeriod}.csv`;
        const xlsxFilename = `NPS_CRA_SCF_${cleanPeriod}.xlsx`;
        const content = rows.join('\r\n');
        const returnHeader = 'PRAN#Employee_Tier1_Amount#Employer_Tier1_Amount#Employee_Tier2_Amount#Contribution_Period';
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
            totalSubscribers: rows.length,
            totalEmployeeTier1: Math.round(totalEmployeeTier1 * 100) / 100,
            totalEmployerTier1: Math.round(totalEmployerTier1 * 100) / 100,
            totalEmployeeTier2: Math.round(totalEmployeeTier2 * 100) / 100,
            totalContribution: Math.round(totalContribution * 100) / 100,
            byCra,
            period,
            craAgency
        };
    }

    /**
     * Exports standard NSDL / Protean Subscriber Contribution File (SCF) payload as CSV format.
     * PRD Section 11 format:
     * PRAN#Employee_Tier1_Amount#Employer_Tier1_Amount#Employee_Tier2_Amount#Contribution_Period
     */
    function exportCraReturnCsv(records = [], headerMeta = {}) {
        const fileObj = generateCraReturnFile(records, headerMeta);
        return {
            ...fileObj,
            filename: fileObj.csvFilename,
            content: fileObj.csvContent,
            mimeType: 'text/csv'
        };
    }

    /**
     * Generates SheetJS workbook structure for CRA contribution return file.
     */
    function exportCraReturnExcel(records = [], headerMeta = {}) {
        const fileObj = generateCraReturnFile(records, headerMeta);
        const dataRows = [
            ['PRAN', 'Employee Tier 1 Amount', 'Employer Tier 1 Amount', 'Employee Tier 2 Amount', 'Contribution Period']
        ];

        fileObj.rows.forEach(r => {
            const parts = r.split('#');
            dataRows.push([
                parts[0] || '',
                parseFloat(parts[1]) || 0,
                parseFloat(parts[2]) || 0,
                parseFloat(parts[3]) || 0,
                parts[4] || ''
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
    async function commitBatchNpsDetails(orgId = 'ORG_KYLRX_01', firestoreDocs = []) {
        let committedCount = 0;
        const errors = [];

        for (const doc of firestoreDocs) {
            try {
                await saveEmployeeNpsDetails(orgId, doc.employeeId, doc);
                committedCount++;
            } catch (err) {
                errors.push({
                    employeeId: doc.employeeId,
                    message: err.message || 'Failed to save NPS detail record.'
                });
            }
        }

        return {
            committedCount,
            errors
        };
    }

    return {
        DEFAULT_NPS_PROFILES,
        seedDefaultRecords,
        resolveNpsStatusBadge,
        resolveKycBadge,
        resolveCraBadge,
        getEmployeeNpsDetails,
        saveEmployeeNpsDetails,
        listAllNpsDetails,
        calculateNpsDeduction,
        generateCraReturnRow,
        generateCraReturnFile,
        exportCraReturnCsv,
        exportCraReturnExcel,
        commitBatchNpsDetails
    };
}));
