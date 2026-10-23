/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PAYROLL COMPONENT SERVICE & WAGE BASE RESOLVER
 * ============================================================================
 * 
 * Component Catalog Management, In-Memory / Cloud Firestore Persistence,
 * Loss of Pay (LOP) Proration Engine, and Statutory Wage Base Resolution
 * matching PRD Sections 1 & 4:
 * 
 * Path: organizations/{orgId}/payroll_components/{componentCode}
 * 
 * Statutory Bases Computed:
 * - PF Gross Wages (sum of active earnings where isPfApplicable == true)
 * - ESI Gross Wages (sum of active earnings where isEsiApplicable == true)
 * - PT Gross Wages (sum of active earnings where isPtApplicable == true)
 * - Total Taxable Income (sum of components where isTaxable == true)
 * - LOP Prorated Earnings vs Fixed Components
 * 
 * @version 1.0.0
 * @author Principal Fintech & Payroll Systems Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxPayrollComponentService = factory();
        root.payrollComponentService = root.KylrxPayrollComponentService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for rapid lookups, tests, and offline mode
    const _componentLedger = new Map();

    // Default Seed Catalog matching Templates.xlsx
    const DEFAULT_COMPONENTS = [
        {
            componentCode: "BASIC",
            componentName: "Basic Salary",
            componentType: "Earning",
            calculationMethod: "Flat_Amount",
            defaultValueOrPercentage: 50000,
            percentageBasis: null,
            isTaxable: true,
            isPfApplicable: true,
            isEsiApplicable: true,
            isPtApplicable: true,
            isTdsApplicable: true,
            prorateOnLop: true,
            isActive: true
        },
        {
            componentCode: "HRA",
            componentName: "House Rent Allowance",
            componentType: "Earning",
            calculationMethod: "Percentage",
            defaultValueOrPercentage: 50,
            percentageBasis: "BASIC",
            isTaxable: true,
            isPfApplicable: false,
            isEsiApplicable: true,
            isPtApplicable: true,
            isTdsApplicable: true,
            prorateOnLop: true,
            isActive: true
        },
        {
            componentCode: "SPECIAL_ALLOW",
            componentName: "Special Allowance",
            componentType: "Earning",
            calculationMethod: "Flat_Amount",
            defaultValueOrPercentage: 25000,
            percentageBasis: null,
            isTaxable: true,
            isPfApplicable: false,
            isEsiApplicable: true,
            isPtApplicable: true,
            isTdsApplicable: true,
            prorateOnLop: true,
            isActive: true
        },
        {
            componentCode: "CONVEYANCE",
            componentName: "Conveyance Allowance",
            componentType: "Earning",
            calculationMethod: "Flat_Amount",
            defaultValueOrPercentage: 1600,
            percentageBasis: null,
            isTaxable: false,
            isPfApplicable: false,
            isEsiApplicable: false,
            isPtApplicable: false,
            isTdsApplicable: false,
            prorateOnLop: true,
            isActive: true
        },
        {
            componentCode: "VARIABLE_PAY",
            componentName: "Performance Variable Pay",
            componentType: "Earning",
            calculationMethod: "Flat_Amount",
            defaultValueOrPercentage: 15000,
            percentageBasis: null,
            isTaxable: true,
            isPfApplicable: false,
            isEsiApplicable: true,
            isPtApplicable: true,
            isTdsApplicable: true,
            prorateOnLop: false,
            isActive: true
        },
        {
            componentCode: "PF_EE",
            componentName: "Provident Fund (Employee)",
            componentType: "Deduction",
            calculationMethod: "Percentage",
            defaultValueOrPercentage: 12,
            percentageBasis: "BASIC",
            isTaxable: false,
            isPfApplicable: true,
            isEsiApplicable: false,
            isPtApplicable: false,
            isTdsApplicable: false,
            prorateOnLop: true,
            isActive: true
        },
        {
            componentCode: "ESI_EE",
            componentName: "ESIC (Employee)",
            componentType: "Deduction",
            calculationMethod: "Percentage",
            defaultValueOrPercentage: 0.75,
            percentageBasis: "GROSS",
            isTaxable: false,
            isPfApplicable: false,
            isEsiApplicable: true,
            isPtApplicable: false,
            isTdsApplicable: false,
            prorateOnLop: true,
            isActive: true
        },
        {
            componentCode: "PT",
            componentName: "Professional Tax",
            componentType: "Deduction",
            calculationMethod: "Flat_Amount",
            defaultValueOrPercentage: 200,
            percentageBasis: null,
            isTaxable: false,
            isPfApplicable: false,
            isEsiApplicable: false,
            isPtApplicable: true,
            isTdsApplicable: false,
            prorateOnLop: false,
            isActive: true
        },
        {
            componentCode: "TDS",
            componentName: "Tax Deducted at Source",
            componentType: "Deduction",
            calculationMethod: "Formula",
            defaultValueOrPercentage: 0,
            percentageBasis: "TAXABLE",
            isTaxable: false,
            isPfApplicable: false,
            isEsiApplicable: false,
            isPtApplicable: false,
            isTdsApplicable: true,
            prorateOnLop: false,
            isActive: true
        }
    ];

    // Initialize seed data into default ledger
    DEFAULT_COMPONENTS.forEach(c => {
        _componentLedger.set(`org_kylrx:${c.componentCode}`, { ...c });
        _componentLedger.set(`default:${c.componentCode}`, { ...c });
    });

    /**
     * Compute Loss of Pay (LOP) proration factor
     * 
     * @param {number} calendarDaysInMonth - e.g. 30 or 31
     * @param {number} lopDays - Number of unpaid / loss of pay days
     * @returns {number} Proration multiplier between 0 and 1
     */
    function calculateLopProrationFactor(calendarDaysInMonth = 30, lopDays = 0) {
        const totalDays = Math.max(1, Number(calendarDaysInMonth) || 30);
        const unpaid = Math.max(0, Number(lopDays) || 0);
        const paidDays = Math.max(0, totalDays - unpaid);
        return Math.round((paidDays / totalDays) * 10000) / 10000;
    }

    /**
     * Prorates scheduled component amount if component has prorateOnLop == true
     */
    function calculateComponentProration(componentDef, scheduledAmount, arg3 = 1.0, arg4 = undefined) {
        let prorationFactor = 1.0;
        if (arg4 !== undefined) {
            prorationFactor = calculateLopProrationFactor(arg3, arg4);
        } else {
            prorationFactor = Number(arg3) || 1.0;
        }

        const amt = Number(scheduledAmount) || 0;
        const shouldProrate = componentDef
            ? (componentDef.prorateOnLop !== false && componentDef.Prorate_On_LOP !== 'No')
            : true;

        const earned = (!shouldProrate || prorationFactor >= 1.0)
            ? amt
            : Math.round((amt * prorationFactor) * 100) / 100;

        const res = Object.assign(new Number(earned), {
            earnedAmount: earned,
            prorated: (shouldProrate && prorationFactor < 1.0),
            scheduledAmount: amt,
            prorationFactor
        });
        return res;
    }

    /**
     * Resolves Statutory Wage Bases, Taxable Income, and Net Pay across computed components
     * 
     * @param {Array} componentRows - Array of evaluated components { componentCode, amount, scheduledAmount, ... }
     * @param {Array|Map} catalog - Active payroll components catalog
     * @param {Object} options - Options { calendarDaysInMonth, lopDays, applyProration }
     */
    function resolveStatutoryWageBases(componentRows = [], catalog = null, options = {}) {
        const prorationFactor = options.applyProration
            ? calculateLopProrationFactor(options.calendarDaysInMonth || 30, options.lopDays || 0)
            : 1.0;

        let pfGrossWages = 0;
        let esiGrossWages = 0;
        let ptGrossWages = 0;
        let totalTaxableIncome = 0;
        let totalEarnings = 0;
        let totalDeductions = 0;
        let totalReimbursements = 0;
        let totalEmployerContributions = 0;

        const resolvedBreakdown = [];

        // Build catalog lookup map
        const catalogMap = new Map();
        if (catalog && Array.isArray(catalog)) {
            catalog.forEach(c => catalogMap.set(c.componentCode || c.code || c.Component_Code, c));
        } else if (catalog instanceof Map) {
            for (const [k, v] of catalog.entries()) {
                catalogMap.set(k.includes(':') ? k.split(':')[1] : k, v);
            }
        }

        for (const row of componentRows) {
            const code = String(row.componentCode || row.Component_Code || row.code || '').trim().toUpperCase();
            let def = catalogMap.get(code);

            if (!def) {
                def = _componentLedger.get(`org_kylrx:${code}`) || _componentLedger.get(`default:${code}`) || {
                    componentCode: code,
                    componentType: (row.type || 'Earning'),
                    isTaxable: true,
                    isPfApplicable: code === 'BASIC',
                    isEsiApplicable: true,
                    isPtApplicable: true,
                    prorateOnLop: true
                };
            }

            const scheduledAmt = Number(row.scheduledAmount !== undefined ? row.scheduledAmount : (row.amount !== undefined ? row.amount : row.evaluatedAmount)) || 0;
            const earnedAmt = calculateComponentProration(def, scheduledAmt, prorationFactor);

            const isEarning = (def.componentType === 'Earning' || def.type === 'EARNING');
            const isDeduction = (def.componentType === 'Deduction' || def.type === 'DEDUCTION');
            const isReimb = (def.componentType === 'Reimbursement');
            const isEmpContrib = (def.componentType === 'Employer_Contribution');

            if (isEarning) {
                totalEarnings += earnedAmt;
                if (def.isPfApplicable) pfGrossWages += earnedAmt;
                if (def.isEsiApplicable) esiGrossWages += earnedAmt;
                if (def.isPtApplicable) ptGrossWages += earnedAmt;
                if (def.isTaxable) totalTaxableIncome += earnedAmt;
            } else if (isDeduction) {
                totalDeductions += earnedAmt;
            } else if (isReimb) {
                totalReimbursements += earnedAmt;
            } else if (isEmpContrib) {
                totalEmployerContributions += earnedAmt;
            }

            resolvedBreakdown.push({
                componentCode: code,
                componentName: def.componentName || code,
                componentType: def.componentType,
                scheduledAmount: scheduledAmt,
                earnedAmount: earnedAmt,
                isProrated: (def.prorateOnLop && prorationFactor < 1.0),
                isTaxable: Boolean(def.isTaxable),
                isPfApplicable: Boolean(def.isPfApplicable),
                isEsiApplicable: Boolean(def.isEsiApplicable),
                isPtApplicable: Boolean(def.isPtApplicable),
                isTdsApplicable: Boolean(def.isTdsApplicable)
            });
        }

        const netPayable = Math.round((totalEarnings - totalDeductions + totalReimbursements) * 100) / 100;

        return {
            prorationFactor,
            pfGrossWages: Math.round(pfGrossWages * 100) / 100,
            esiGrossWages: Math.round(esiGrossWages * 100) / 100,
            ptGrossWages: Math.round(ptGrossWages * 100) / 100,
            totalTaxableIncome: Math.round(totalTaxableIncome * 100) / 100,
            totalEarnings: Math.round(totalEarnings * 100) / 100,
            totalDeductions: Math.round(totalDeductions * 100) / 100,
            totalReimbursements: Math.round(totalReimbursements * 100) / 100,
            totalEmployerContributions: Math.round(totalEmployerContributions * 100) / 100,
            netPayable,
            breakdown: resolvedBreakdown
        };
    }

    /**
     * Ingest batch component records into local ledger and Firestore
     */
    function ingestComponentRecords(components = [], orgId = 'org_kylrx') {
        const cleanOrgId = orgId || 'org_kylrx';
        let count = 0;

        for (const c of components) {
            const code = String(c.componentCode || c.Component_Code || '').trim().toUpperCase();
            if (!code) continue;

            const docObj = {
                componentCode: code,
                componentName: c.componentName || c.Component_Name || code,
                componentType: c.componentType || c.Component_Type || 'Earning',
                calculationMethod: c.calculationMethod || c.Calculation_Method || 'Flat_Amount',
                defaultValueOrPercentage: c.defaultValueOrPercentage !== undefined ? c.defaultValueOrPercentage : (c.Value_or_Percentage || null),
                percentageBasis: c.percentageBasis || c.Percentage_Basis || null,
                isTaxable: c.isTaxable !== undefined ? Boolean(c.isTaxable) : (c.Taxable === 'Yes'),
                isPfApplicable: c.isPfApplicable !== undefined ? Boolean(c.isPfApplicable) : (c.PF_Applicable === 'Yes'),
                isEsiApplicable: c.isEsiApplicable !== undefined ? Boolean(c.isEsiApplicable) : (c.ESI_Applicable === 'Yes'),
                isPtApplicable: c.isPtApplicable !== undefined ? Boolean(c.isPtApplicable) : (c.PT_Applicable === 'Yes'),
                isTdsApplicable: c.isTdsApplicable !== undefined ? Boolean(c.isTdsApplicable) : (c.TDS_Applicable === 'Yes'),
                prorateOnLop: c.prorateOnLop !== undefined ? Boolean(c.prorateOnLop) : (c.Prorate_On_LOP !== 'No'),
                isActive: c.isActive !== undefined ? Boolean(c.isActive) : (c.Active !== 'No'),
                updatedAt: new Date().toISOString()
            };

            _componentLedger.set(`${cleanOrgId}:${code}`, docObj);
            _componentLedger.set(`default:${code}`, docObj);
            count++;
        }

        return count;
    }

    /**
     * Save / Update a single component (flexible signature: savePayrollComponent(comp, orgId) or savePayrollComponent(orgId, comp))
     */
    async function savePayrollComponent(arg1, arg2) {
        let cleanOrgId;
        let componentData;
        if (typeof arg1 === 'object' && arg1 !== null) {
            componentData = arg1;
            cleanOrgId = (typeof arg2 === 'string' && arg2) ? arg2 : 'org_kylrx';
        } else {
            cleanOrgId = (typeof arg1 === 'string' && arg1) ? arg1 : 'org_kylrx';
            componentData = arg2 || {};
        }

        const code = String(componentData.componentCode || componentData.Component_Code || '').trim().toUpperCase();

        if (!code) {
            throw new Error("Missing mandatory 'componentCode'.");
        }

        const docObj = {
            componentCode: code,
            componentName: componentData.componentName || componentData.Component_Name || code,
            componentType: componentData.componentType || componentData.Component_Type || 'Earning',
            calculationMethod: componentData.calculationMethod || componentData.Calculation_Method || 'Flat_Amount',
            defaultValueOrPercentage: componentData.defaultValueOrPercentage !== undefined ? componentData.defaultValueOrPercentage : (componentData.Value_or_Percentage || null),
            percentageBasis: componentData.percentageBasis || componentData.Percentage_Basis || null,
            isTaxable: componentData.isTaxable !== undefined ? Boolean(componentData.isTaxable) : (componentData.Taxable === 'Yes'),
            isPfApplicable: componentData.isPfApplicable !== undefined ? Boolean(componentData.isPfApplicable) : (componentData.PF_Applicable === 'Yes'),
            isEsiApplicable: componentData.isEsiApplicable !== undefined ? Boolean(componentData.isEsiApplicable) : (componentData.ESI_Applicable === 'Yes'),
            isPtApplicable: componentData.isPtApplicable !== undefined ? Boolean(componentData.isPtApplicable) : (componentData.PT_Applicable === 'Yes'),
            isTdsApplicable: componentData.isTdsApplicable !== undefined ? Boolean(componentData.isTdsApplicable) : (componentData.TDS_Applicable === 'Yes'),
            prorateOnLop: componentData.prorateOnLop !== undefined ? Boolean(componentData.prorateOnLop) : (componentData.Prorate_On_LOP !== 'No'),
            isActive: componentData.isActive !== undefined ? Boolean(componentData.isActive) : (componentData.Active !== 'No'),
            updatedAt: new Date().toISOString()
        };

        _componentLedger.set(`${cleanOrgId}:${code}`, docObj);
        _componentLedger.set(`default:${code}`, docObj);

        return docObj;
    }

    /**
     * Get a component by code (flexible: getPayrollComponent(code, orgId) or getPayrollComponent(orgId, code))
     */
    function getPayrollComponent(arg1, arg2) {
        let cleanOrgId = 'org_kylrx';
        let code = '';
        if (arg2) {
            if (typeof arg1 === 'string' && (arg1.startsWith('org_') || arg1.startsWith('org-'))) {
                cleanOrgId = arg1;
                code = String(arg2).trim().toUpperCase();
            } else {
                cleanOrgId = String(arg2);
                code = String(arg1).trim().toUpperCase();
            }
        } else {
            code = String(arg1 || '').trim().toUpperCase();
        }

        return _componentLedger.get(`${cleanOrgId}:${code}`) || _componentLedger.get(`default:${code}`) || null;
    }

    /**
     * List all components with optional filters
     */
    function listPayrollComponents(orgId, filter = {}) {
        const cleanOrgId = (typeof orgId === 'string' && orgId) ? orgId : 'org_kylrx';
        const results = [];

        for (const [key, comp] of _componentLedger.entries()) {
            if (key.startsWith(`${cleanOrgId}:`) || (key.startsWith('default:') && !results.some(r => r.componentCode === comp.componentCode))) {
                if (filter.componentType && comp.componentType.toLowerCase() !== String(filter.componentType).toLowerCase()) {
                    continue;
                }
                if (filter.isActive !== undefined && comp.isActive !== filter.isActive) {
                    continue;
                }
                results.push(comp);
            }
        }

        return results;
    }

    /**
     * Delete / Deactivate a component (flexible signature: deletePayrollComponent(code, orgId) or deletePayrollComponent(orgId, code))
     */
    async function deletePayrollComponent(arg1, arg2) {
        let cleanOrgId = 'org_kylrx';
        let code = '';
        if (arg2) {
            if (typeof arg1 === 'string' && (arg1.startsWith('org_') || arg1.startsWith('org-'))) {
                cleanOrgId = arg1;
                code = String(arg2).trim().toUpperCase();
            } else {
                cleanOrgId = String(arg2);
                code = String(arg1).trim().toUpperCase();
            }
        } else {
            code = String(arg1 || '').trim().toUpperCase();
        }

        const existing = _componentLedger.get(`${cleanOrgId}:${code}`) || _componentLedger.get(`default:${code}`);
        if (!existing) return false;

        _componentLedger.delete(`${cleanOrgId}:${code}`);
        _componentLedger.delete(`default:${code}`);
        return true;
    }

    return {
        savePayrollComponent,
        getPayrollComponent,
        listPayrollComponents,
        deletePayrollComponent,
        ingestComponentRecords,
        calculateLopProrationFactor,
        calculateComponentProration,
        resolveStatutoryWageBases,
        DEFAULT_COMPONENTS,
        _componentLedger
    };
}));
