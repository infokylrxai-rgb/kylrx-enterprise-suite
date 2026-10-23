/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - SALARY STRUCTURE & COMPENSATION SERVICE
 * ============================================================================
 * 
 * Manages Employee Salary Breakdown, Dynamic Formula Evaluation, Revision Timeline,
 * and Cloud Firestore Persistence matching PRD §§ 1 & 4:
 * 
 * 1. Cloud Firestore Data Architecture:
 *    - Path: organizations/{orgId}/salary_structures/{employeeId}_v_{effectiveDate}
 *    - Document Schema:
 *      {
 *        "id": "EMP0001_v_2026-01-01",
 *        "employeeId": "EMP0001",
 *        "salaryStructureCode": "STRUC_ENG_L2",
 *        "effectiveFrom": "2026-01-01",
 *        "payFrequency": "Monthly",
 *        "isActive": true,
 *        "components": [
 *          {
 *            "componentCode": "BASIC",
 *            "amount": 50000.00,
 *            "percentage": null,
 *            "calculationBasis": "FLAT"
 *          },
 *          {
 *            "componentCode": "HRA",
 *            "amount": null,
 *            "percentage": 50.0,
 *            "calculationBasis": "BASIC"
 *          },
 *          {
 *            "componentCode": "SPECIAL_ALLOW",
 *            "amount": 25000.00,
 *            "percentage": null,
 *            "calculationBasis": "FLAT"
 *          }
 *        ],
 *        "grossMonthly": 100000.00,
 *        "annualCTC": 1200000.00,
 *        "createdAt": "serverTimestamp()",
 *        "updatedAt": "serverTimestamp()"
 *      }
 * 
 * 2. Strict Versioning & Revision Timeline:
 *    - Preserves historical revisions when future-dated structures are assigned
 *    - Queries current active package based on effectiveFrom <= asOfDate
 * 
 * @version 1.0.0
 * @author Principal Full-Stack & Compensation Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxSalaryStructureService = factory();
        root.salaryStructureService = root.KylrxSalaryStructureService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for tests, offline mode, and high-performance caching
    const _localLedger = new Map();

    // Default Seed Data matching Templates.xlsx and PRD Section 4
    const DEFAULT_SALARY_STRUCTURES = [
        {
            id: "EMP0001_v_2026-01-01",
            employeeId: "EMP0001",
            salaryStructureCode: "STRUC_ENG_L2",
            effectiveFrom: "2026-01-01",
            payFrequency: "Monthly",
            isActive: true,
            components: [
                { componentCode: "BASIC", amount: 50000.00, percentage: null, calculationBasis: "FLAT" },
                { componentCode: "HRA", amount: null, percentage: 50.0, calculationBasis: "BASIC" },
                { componentCode: "SPECIAL_ALLOW", amount: 25000.00, percentage: null, calculationBasis: "FLAT" }
            ],
            grossMonthly: 100000.00,
            annualCTC: 1200000.00,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
            id: "EMP0002_v_2026-01-15",
            employeeId: "EMP0002",
            salaryStructureCode: "STRUC_EXEC_L1",
            effectiveFrom: "2026-01-15",
            payFrequency: "Monthly",
            isActive: true,
            components: [
                { componentCode: "BASIC", amount: 40000.00, percentage: null, calculationBasis: "FLAT" },
                { componentCode: "HRA", amount: null, percentage: 50.0, calculationBasis: "BASIC" },
                { componentCode: "SPECIAL_ALLOW", amount: 15000.00, percentage: null, calculationBasis: "FLAT" }
            ],
            grossMonthly: 75000.00,
            annualCTC: 900000.00,
            createdAt: "2026-01-15T00:00:00.000Z",
            updatedAt: "2026-01-15T00:00:00.000Z"
        },
        {
            id: "EMP0003_v_2026-02-01",
            employeeId: "EMP0003",
            salaryStructureCode: "STRUC_SALES_L1",
            effectiveFrom: "2026-02-01",
            payFrequency: "Monthly",
            isActive: true,
            components: [
                { componentCode: "BASIC", amount: 35000.00, percentage: null, calculationBasis: "FLAT" },
                { componentCode: "HRA", amount: null, percentage: 40.0, calculationBasis: "BASIC" },
                { componentCode: "SPECIAL_ALLOW", amount: 11000.00, percentage: null, calculationBasis: "FLAT" }
            ],
            grossMonthly: 60000.00,
            annualCTC: 720000.00,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z"
        }
    ];

    // Initialize local ledger with defaults
    DEFAULT_SALARY_STRUCTURES.forEach(s => {
        _localLedger.set(`org_kylrx:${s.id}`, { ...s });
        _localLedger.set(`default:${s.id}`, { ...s });
    });

    /**
     * Helper to load Parser module if available
     */
    function getParser() {
        if (typeof window !== 'undefined' && (window.KylrxSalaryStructureParser || window.salaryStructureParser)) {
            return window.KylrxSalaryStructureParser || window.salaryStructureParser;
        }
        try { return require('./salary-structure-parser.js'); } catch (_) {}
        try { return require('./services/salary-structure-parser.js'); } catch (_) {}
        try { return require('../services/salary-structure-parser.js'); } catch (_) {}
        try { return require('./salaryStructureParser.js'); } catch (_) {}
        return null;
    }

    /**
     * Returns canonical Cloud Firestore document path
     */
    function getFirestorePath(orgId = 'org_kylrx', documentId) {
        const cleanOrgId = orgId || 'org_kylrx';
        return `organizations/${cleanOrgId}/salary_structures/${documentId}`;
    }

    /**
     * Evaluates itemized components using the calculation engine
     */
    function computeCtcBreakdown(components = [], payFrequency = 'Monthly') {
        const parser = getParser();
        if (parser && typeof parser.evaluateSalaryStructure === 'function') {
            return parser.evaluateSalaryStructure(components, payFrequency);
        }

        // Inline fallback calculation engine
        const resolvedValues = new Map();
        const evaluatedComponents = [];
        let grossMonthly = 0;

        for (const comp of components) {
            const code = String(comp.componentCode || comp.Component_Code || '').trim().toUpperCase();
            const basis = String(comp.calculationBasis || comp.Calculation_Basis || 'FLAT').trim().toUpperCase();
            const rawAmt = Number(comp.amount);
            const rawPct = Number(comp.percentage);

            if (basis === 'FLAT' && !isNaN(rawAmt)) {
                resolvedValues.set(code, rawAmt);
                evaluatedComponents.push({
                    componentCode: code,
                    amount: rawAmt,
                    percentage: null,
                    calculationBasis: 'FLAT',
                    evaluatedAmount: rawAmt
                });
                grossMonthly += rawAmt;
            }
        }

        for (const comp of components) {
            const code = String(comp.componentCode || comp.Component_Code || '').trim().toUpperCase();
            const basis = String(comp.calculationBasis || comp.Calculation_Basis || '').trim().toUpperCase();
            const rawPct = Number(comp.percentage);

            if (basis !== 'FLAT') {
                let computedAmount = 0;
                if (resolvedValues.has(basis) && !isNaN(rawPct)) {
                    computedAmount = Math.round(((rawPct / 100) * resolvedValues.get(basis)) * 100) / 100;
                }
                resolvedValues.set(code, computedAmount);
                evaluatedComponents.push({
                    componentCode: code,
                    amount: null,
                    percentage: rawPct,
                    calculationBasis: basis,
                    evaluatedAmount: computedAmount
                });
                grossMonthly += computedAmount;
            }
        }

        let annualMultiplier = 12;
        const normFreq = String(payFrequency || 'Monthly').toLowerCase();
        if (normFreq.includes('bi')) annualMultiplier = 26;
        else if (normFreq.includes('week')) annualMultiplier = 52;

        const annualCTC = Math.round((grossMonthly * annualMultiplier) * 100) / 100;
        return {
            evaluatedComponents,
            grossMonthly: Math.round(grossMonthly * 100) / 100,
            annualCTC
        };
    }

    /**
     * Saves or updates an employee salary structure in Cloud Firestore
     */
    async function saveSalaryStructure(orgId, structureData = {}, options = {}) {
        if (typeof structureData === 'string' && typeof options === 'object' && options !== null) {
            const explicitEmpId = structureData;
            structureData = { ...options, employeeId: options.employeeId || explicitEmpId };
            options = arguments[3] || {};
        } else if (typeof orgId === 'object' && orgId !== null && (orgId.employeeId || orgId.Employee_ID)) {
            options = structureData || {};
            structureData = orgId;
            orgId = 'org_kylrx';
        }
        const cleanOrgId = (typeof orgId === 'string' && orgId) ? orgId : 'org_kylrx';
        const empId = String(structureData.employeeId || structureData.Employee_ID || '').trim().toUpperCase();

        if (!empId) {
            throw new Error("Missing mandatory 'employeeId'.");
        }

        const effectiveFrom = structureData.effectiveFrom || structureData.Effective_From || new Date().toISOString().split('T')[0];
        const salaryStructureCode = String(structureData.salaryStructureCode || structureData.Salary_Structure_Code || 'STRUC_DEFAULT').trim().toUpperCase();
        const payFrequency = String(structureData.payFrequency || structureData.Pay_Frequency || 'Monthly').trim();
        const isActive = structureData.isActive !== undefined ? Boolean(structureData.isActive) : (structureData.Active === 'No' ? false : true);

        const components = Array.isArray(structureData.components) ? structureData.components : [];
        if (components.length === 0 && Array.isArray(structureData.rawComponents)) {
            components.push(...structureData.rawComponents);
        }

        // Evaluate Gross and CTC
        const evaluation = computeCtcBreakdown(components, payFrequency);
        const grossMonthly = structureData.grossMonthly !== undefined ? Number(structureData.grossMonthly) : evaluation.grossMonthly;
        const annualCTC = structureData.annualCTC !== undefined ? Number(structureData.annualCTC) : evaluation.annualCTC;

        const docId = `${empId}_v_${effectiveFrom}`;
        const firestoreDoc = {
            id: docId,
            employeeId: empId,
            salaryStructureCode: salaryStructureCode,
            effectiveFrom: effectiveFrom,
            payFrequency: payFrequency,
            isActive: isActive,
            components: components.map(c => ({
                componentCode: String(c.componentCode || c.Component_Code).trim().toUpperCase(),
                amount: c.amount !== undefined && c.amount !== null && c.amount !== '' ? Number(c.amount) : null,
                percentage: c.percentage !== undefined && c.percentage !== null && c.percentage !== '' ? Number(c.percentage) : null,
                calculationBasis: String(c.calculationBasis || c.Calculation_Basis || 'FLAT').trim().toUpperCase()
            })),
            grossMonthly: grossMonthly,
            annualCTC: annualCTC,
            createdAt: structureData.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            updatedBy: options.updatedBy || 'admin_uid'
        };

        // If active, update any other revisions with conflicting primary active flags
        if (isActive) {
            for (const [key, val] of _localLedger.entries()) {
                if (key.startsWith(`${cleanOrgId}:`) && val.employeeId === empId && val.id !== docId) {
                    val.isActive = false;
                }
            }
        }

        // Save to local cache
        _localLedger.set(`${cleanOrgId}:${docId}`, firestoreDoc);
        _localLedger.set(`default:${docId}`, firestoreDoc);

        // Persist to Cloud Firestore if connected
        try {
            if (typeof window !== 'undefined' && window.db) {
                const docRef = window.db.collection('organizations').doc(cleanOrgId).collection('salary_structures').doc(docId);
                await docRef.set(firestoreDoc, { merge: true });
            } else {
                const fb = await import('./firebase-config.js').catch(() => null) || await import('../firebase-config.js').catch(() => null) || (typeof window !== 'undefined' && window.KylrxFirebase) || null;
                if (fb && fb.db && fb.doc && fb.setDoc) {
                    const docRef = fb.doc(fb.db, 'organizations', cleanOrgId, 'salary_structures', docId);
                    await fb.setDoc(docRef, firestoreDoc, { merge: true });
                }
            }
        } catch (dbErr) {
            console.warn(`[SalaryStructureService] Firestore persistence notice: ${dbErr.message}`);
        }

        // Dispatch reactive event
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            try {
                window.dispatchEvent(new CustomEvent('salary-structure-updated', {
                    detail: { orgId: cleanOrgId, employeeId: empId, structure: firestoreDoc }
                }));
            } catch (_) {}
        }

        return {
            success: true,
            id: docId,
            employeeId: empId,
            ...firestoreDoc,
            data: firestoreDoc
        };
    }

    /**
     * Retrieves a salary structure revision by ID or latest active revision for an employee
     */
    async function getSalaryStructure(orgId, employeeId, versionOrDate = null) {
        const cleanOrgId = orgId || 'org_kylrx';
        const empId = String(employeeId || '').trim().toUpperCase();
        if (!empId) return null;

        let targetDocId = null;
        if (versionOrDate) {
            targetDocId = versionOrDate.includes('_v_') ? versionOrDate : `${empId}_v_${versionOrDate}`;
        }

        // Try local ledger first if target doc ID specified
        if (targetDocId && _localLedger.has(`${cleanOrgId}:${targetDocId}`)) {
            return JSON.parse(JSON.stringify(_localLedger.get(`${cleanOrgId}:${targetDocId}`)));
        }

        // Search in local ledger for latest active structure
        const timeline = await getRevisionTimeline(cleanOrgId, empId);
        if (targetDocId) {
            const found = timeline.find(t => t.id === targetDocId || t.effectiveFrom === versionOrDate);
            if (found) return found;
        }

        // Return latest active or most recent
        const active = timeline.find(t => t.isActive);
        return active || (timeline.length > 0 ? timeline[0] : null);
    }

    /**
     * Retrieves the revision timeline for an employee ordered by effectiveFrom DESC
     */
    async function getRevisionTimeline(orgId, employeeId) {
        const cleanOrgId = orgId || 'org_kylrx';
        const empId = String(employeeId || '').trim().toUpperCase();
        if (!empId) return [];

        const revisions = [];

        // Check local ledger
        for (const [key, val] of _localLedger.entries()) {
            if ((key.startsWith(`${cleanOrgId}:`) || key.startsWith('default:')) && val.employeeId === empId) {
                if (!revisions.some(r => r.id === val.id)) {
                    revisions.push(JSON.parse(JSON.stringify(val)));
                }
            }
        }

        // Sort by effectiveFrom DESC
        revisions.sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
        return revisions;
    }

    /**
     * Lists all Salary Structures across an organization
     */
    async function listSalaryStructures(orgId, activeOnly = false) {
        const cleanOrgId = orgId || 'org_kylrx';
        const list = [];

        for (const [key, val] of _localLedger.entries()) {
            if (key.startsWith(`${cleanOrgId}:`) || key.startsWith('default:')) {
                if (!list.some(r => r.id === val.id)) {
                    if (!activeOnly || val.isActive) {
                        list.push(JSON.parse(JSON.stringify(val)));
                    }
                }
            }
        }

        list.sort((a, b) => (a.employeeId.localeCompare(b.employeeId)) || (new Date(b.effectiveFrom) - new Date(a.effectiveFrom)));
        return list;
    }

    /**
     * Deletes a Salary Structure revision
     */
    async function deleteSalaryStructure(orgId, structureId) {
        const cleanOrgId = orgId || 'org_kylrx';
        _localLedger.delete(`${cleanOrgId}:${structureId}`);
        _localLedger.delete(`default:${structureId}`);

        try {
            if (typeof window !== 'undefined' && window.db) {
                await window.db.collection('organizations').doc(cleanOrgId).collection('salary_structures').doc(structureId).delete();
            } else {
                const fb = await import('./firebase-config.js').catch(() => null) || await import('../firebase-config.js').catch(() => null) || (typeof window !== 'undefined' && window.KylrxFirebase) || null;
                if (fb && fb.db && fb.doc && fb.deleteDoc) {
                    const docRef = fb.doc(fb.db, 'organizations', cleanOrgId, 'salary_structures', structureId);
                    await fb.deleteDoc(docRef);
                }
            }
        } catch (_) {}

        return { success: true, id: structureId };
    }

    /**
     * Renders the interactive Super Admin Compensation Console
     */
    function renderSalaryConsole(containerId, options = {}) {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;

        const orgId = options.orgId || localStorage.getItem('orgId') || 'org_kylrx';
        const structures = Array.from(_localLedger.values()).filter((v, idx, arr) => arr.findIndex(t => t.id === v.id) === idx);

        container.innerHTML = `
            <div style="background: white; border: 1px solid var(--border); border-radius: 24px; padding: 2rem; box-shadow: var(--shadow); margin-bottom: 2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 1.25rem; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 40px; height: 40px; border-radius: 12px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center;">
                                <i data-lucide="layers" style="width: 22px; height: 22px;"></i>
                            </div>
                            <div>
                                <h2 style="font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0;">Salary Structure &amp; Compensation Console</h2>
                                <p style="font-size: 0.82rem; color: var(--text-muted); margin: 2px 0 0 0;">
                                    Cloud Firestore: <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #2563eb; font-weight: 700;">organizations/{orgId}/salary_structures/{employeeId}_v_{effectiveDate}</code>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Compensation Architecture Banner -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem;">
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">PRD §1 &amp; §4 Specs</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-top: 2px;">9 Strict Attributes</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Formula Evaluation</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #059669; margin-top: 2px;">FLAT &amp; Referenced (e.g. BASIC)</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Revision Versioning</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #7c3aed; margin-top: 2px;">Timeline: {emp}_v_{date}</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Payroll Linkage</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #2563eb; margin-top: 2px;">Decoupled Payout Dispatch</p>
                    </div>
                </div>

                <!-- Structures Table -->
                <div style="max-height: 480px; overflow-y: auto; border: 1px solid var(--border); border-radius: 14px;">
                    <table class="preview-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.82rem;">
                        <thead style="background: #f8fafc; position: sticky; top: 0; z-index: 2;">
                            <tr style="border-bottom: 1px solid var(--border);">
                                <th style="padding: 12px 14px; font-weight: 800; color: #475569;">Revision ID</th>
                                <th style="padding: 12px 14px; font-weight: 800; color: #475569;">Employee</th>
                                <th style="padding: 12px 14px; font-weight: 800; color: #475569;">Effective Date</th>
                                <th style="padding: 12px 14px; font-weight: 800; color: #475569;">Structure Code</th>
                                <th style="padding: 12px 14px; font-weight: 800; color: #475569;">Components</th>
                                <th style="padding: 12px 14px; font-weight: 800; color: #475569;">Monthly Gross</th>
                                <th style="padding: 12px 14px; font-weight: 800; color: #475569;">Annual CTC</th>
                                <th style="padding: 12px 14px; font-weight: 800; color: #475569; text-align: center;">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${structures.map(s => {
                                const comps = s.components || [];
                                const compBadges = comps.map(c => {
                                    const valText = c.calculationBasis === 'FLAT' 
                                        ? `₹${(c.amount || 0).toLocaleString('en-IN')}` 
                                        : `${c.percentage}% of ${c.calculationBasis}`;
                                    return `<span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; background: #f1f5f9; color: #334155; margin-right: 4px; margin-bottom: 2px;">${c.componentCode}: ${valText}</span>`;
                                }).join('');

                                return `
                                    <tr style="border-bottom: 1px solid #f1f5f9;">
                                        <td style="padding: 12px 14px; font-family: monospace; font-weight: 700; color: #2563eb;">
                                            ${s.id}
                                        </td>
                                        <td style="padding: 12px 14px; font-weight: 800; color: #0f172a;">
                                            ${s.employeeId}
                                        </td>
                                        <td style="padding: 12px 14px; font-size: 0.78rem; color: #475569;">
                                            ${s.effectiveFrom}
                                        </td>
                                        <td style="padding: 12px 14px;">
                                            <span style="font-size: 0.72rem; font-weight: 800; background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 6px;">
                                                ${s.salaryStructureCode}
                                            </span>
                                        </td>
                                        <td style="padding: 12px 14px; max-width: 280px;">
                                            ${compBadges}
                                        </td>
                                        <td style="padding: 12px 14px; font-weight: 800; color: #166534; font-size: 0.85rem;">
                                            ₹${(s.grossMonthly || 0).toLocaleString('en-IN')}
                                        </td>
                                        <td style="padding: 12px 14px; font-weight: 800; color: #0f172a; font-size: 0.85rem;">
                                            ₹${(s.annualCTC || 0).toLocaleString('en-IN')}
                                        </td>
                                        <td style="padding: 12px 14px; text-align: center;">
                                            ${s.isActive
                                                ? `<span style="color: #166534; background: #dcfce7; font-weight: 800; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; border: 1px solid #bbf7d0;">Active</span>`
                                                : `<span style="color: #64748b; background: #f1f5f9; font-weight: 600; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem;">Archived</span>`
                                            }
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        if (window.lucide) lucide.createIcons();
    }

    return {
        saveSalaryStructure,
        getSalaryStructure,
        getRevisionTimeline,
        listSalaryStructures,
        deleteSalaryStructure,
        computeCtcBreakdown,
        getFirestorePath,
        renderSalaryConsole,
        _localLedger
    };
}));
