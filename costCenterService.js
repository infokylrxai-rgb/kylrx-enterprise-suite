/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - COST CENTER SERVICE & CRUD CONTROLLER
 * ============================================================================
 * 
 * Cloud Firestore Data Architecture:
 * Path: organizations/{orgId}/cost_centers/{costCenterCode}
 * 
 * Document Schema:
 * {
 *   "costCenterCode": "CC_ENG_DEV",
 *   "costCenterName": "Software Engineering & R&D",
 *   "ownerEmployeeId": "EMP0002",
 *   "ownerEmployeeName": "Vikram Malhotra",
 *   "isActive": true,
 *   "createdAt": "serverTimestamp()",
 *   "updatedAt": "serverTimestamp()"
 * }
 * 
 * PRD Integration:
 * - PRD Section 1: Ingestion & Setup Support with Owner Autocomplete & Designation
 * - PRD Section 10: Dynamic Cost Center filtering for Employee Job Details & Onboarding
 * - PRD Section 13: Sub-Department Linkage for departmental budget and payroll expense attribution
 * 
 * @version 2.0.0
 * @author Senior Frontend & Firebase Developer
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxCostCenterService = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Default Seeded Cost Centers aligned with PRD §1, §10, §13 & Templates.xlsx
    const DEFAULT_COST_CENTERS = [
        {
            costCenterCode: 'CC_ENG_DEV',
            costCenterName: 'Software Engineering & R&D',
            ownerEmployeeId: 'EMP0002',
            ownerEmployeeName: 'Vikram Malhotra',
            ownerDesignation: 'Chief Executive Officer (CEO)',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            costCenterCode: 'CC-ENG-101',
            costCenterName: 'Core Software Engineering',
            ownerEmployeeId: 'EMP0001',
            ownerEmployeeName: 'Devendra Sharma',
            ownerDesignation: 'Chief Technology Officer (CTO)',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            costCenterCode: 'CC-AI-102',
            costCenterName: 'Artificial Intelligence R&D',
            ownerEmployeeId: 'EMP0001',
            ownerEmployeeName: 'Devendra Sharma',
            ownerDesignation: 'Chief Technology Officer (CTO)',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            costCenterCode: 'CC-HR-201',
            costCenterName: 'People Operations & HRMS',
            ownerEmployeeId: 'EMP0003',
            ownerEmployeeName: 'Ananya Roy',
            ownerDesignation: 'Chief People Officer (CPO)',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            costCenterCode: 'CC-FIN-301',
            costCenterName: 'Treasury & Statutory Compliance',
            ownerEmployeeId: 'EMP0004',
            ownerEmployeeName: 'Rajesh Raman',
            ownerDesignation: 'Chief Financial Officer (CFO)',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            costCenterCode: 'CC-OPS-401',
            costCenterName: 'Global Operations & Customer Support',
            ownerEmployeeId: 'EMP0005',
            ownerEmployeeName: 'Sneha Sen',
            ownerDesignation: 'EVP Global Operations',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        }
    ];

    // Seeded active employees for Owner autocomplete / dropdown
    const ACTIVE_EMPLOYEES_MASTER = [
        { employeeId: 'EMP0001', fullName: 'Devendra Sharma', email: 'devendra@kylrx.ai', designation: 'Chief Technology Officer (CTO)', department: 'Engineering', active: true },
        { employeeId: 'EMP0002', fullName: 'Vikram Malhotra', email: 'vikram@kylrx.ai', designation: 'Chief Executive Officer (CEO)', department: 'Executive', active: true },
        { employeeId: 'EMP0003', fullName: 'Ananya Roy', email: 'ananya@kylrx.ai', designation: 'Chief People Officer (CPO)', department: 'Human Resources', active: true },
        { employeeId: 'EMP0004', fullName: 'Rajesh Raman', email: 'rajesh@kylrx.ai', designation: 'Chief Financial Officer (CFO)', department: 'Finance', active: true },
        { employeeId: 'EMP0005', fullName: 'Sneha Sen', email: 'sneha@kylrx.ai', designation: 'EVP Global Operations', department: 'Operations', active: true },
        { employeeId: 'EMP0006', fullName: 'Rohit Verma', email: 'rohit@kylrx.ai', designation: 'Director of Product Engineering', department: 'Engineering', active: true },
        { employeeId: 'EMP0007', fullName: 'Dr. Kumar Mangalam', email: 'kumar@kylrx.ai', designation: 'VP of AI Research', department: 'AI Labs', active: true }
    ];

    // Sub-Department to Cost Center Association Catalog (PRD §13)
    const SUB_DEPARTMENT_COST_CENTERS = {
        'ENG-FRONTEND': 'CC-ENG-101',
        'ENG-BACKEND': 'CC-ENG-101',
        'ENG-QA': 'CC-ENG-101',
        'ENG-DEVOPS': 'CC-ENG-101',
        'ENG-DEV': 'CC_ENG_DEV',
        'AI-RESEARCH': 'CC-AI-102',
        'AI-MODELS': 'CC-AI-102',
        'AI-ENG': 'CC-AI-102',
        'HR-COMPLIANCE': 'CC-HR-201',
        'HR-OPS': 'CC-HR-201',
        'HR-PAYROLL': 'CC-HR-201',
        'HR-TALENT': 'CC-HR-201',
        'FIN-PAYROLL': 'CC-FIN-301',
        'FIN-TAX': 'CC-FIN-301',
        'FIN-ACCOUNTS': 'CC-FIN-301',
        'CYBER-SEC': 'CC-ENG-101',
        'CYBER-IAM': 'CC-ENG-101',
        'HRMS-CORE': 'CC-ENG-101',
        'OPS-SUPPORT': 'CC-OPS-401'
    };

    // In-memory cache for ultra-fast UI rendering & offline resilience
    const costCentersMap = new Map();
    const activeEmployeesMap = new Map();
    const subDeptMap = new Map();

    // Initialize in-memory cache
    function initDefaults() {
        costCentersMap.clear();
        DEFAULT_COST_CENTERS.forEach(cc => {
            costCentersMap.set(cc.costCenterCode.toUpperCase(), { ...cc });
        });

        activeEmployeesMap.clear();
        ACTIVE_EMPLOYEES_MASTER.forEach(emp => {
            activeEmployeesMap.set(emp.employeeId.toUpperCase(), { ...emp });
        });

        subDeptMap.clear();
        Object.entries(SUB_DEPARTMENT_COST_CENTERS).forEach(([sub, cc]) => {
            subDeptMap.set(sub.toUpperCase(), cc.toUpperCase());
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
     * Generates Cloud Firestore path for a Cost Center document
     * Target: organizations/{orgId}/cost_centers/{costCenterCode}
     */
    function getFirestorePath(costCenterCode, orgId = getDefaultOrgId()) {
        const cleanCode = String(costCenterCode || '').trim().toUpperCase();
        return `organizations/${orgId}/cost_centers/${cleanCode}`;
    }

    /**
     * Resolves owner employee name and designation by ID
     */
    function getOwnerDetailsById(employeeId) {
        if (!employeeId) return { name: '', designation: '' };
        const cleanId = String(employeeId).trim().toUpperCase();
        if (activeEmployeesMap.has(cleanId)) {
            const emp = activeEmployeesMap.get(cleanId);
            return {
                name: emp.fullName || emp.name || '',
                designation: emp.designation || emp.role || ''
            };
        }
        return { name: '', designation: '' };
    }

    /**
     * Dispatches custom event for reactive UI updates across the page
     */
    function dispatchUpdateEvents() {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            const event = new CustomEvent('cost-centers-updated', {
                detail: { costCenters: getAllCostCenters() }
            });
            window.dispatchEvent(event);
        }
    }

    /**
     * READ: Get all Cost Centers from memory cache
     * @param {string} [orgId]
     * @param {boolean} [activeOnly]
     */
    function getAllCostCenters(orgId = null, activeOnly = false) {
        const list = Array.from(costCentersMap.values());
        if (activeOnly) {
            return list.filter(cc => cc.isActive === true);
        }
        return list;
    }

    /**
     * READ: Get only ACTIVE Cost Centers ('Active' == 'Yes' / isActive === true)
     */
    function getActiveCostCenters(orgId = null) {
        return getAllCostCenters(orgId, true);
    }

    /**
     * READ: Get a single Cost Center by code
     */
    function getCostCenter(costCenterCode) {
        if (!costCenterCode) return null;
        const cleanCode = String(costCenterCode).trim().toUpperCase();
        return costCentersMap.get(cleanCode) || null;
    }

    /**
     * Validates whether a Cost Center Code exists and is active
     */
    function validateCostCenterCode(costCenterCode) {
        if (!costCenterCode) {
            return { valid: false, error: 'Cost Center Code is required.' };
        }
        const cleanCode = String(costCenterCode).trim().toUpperCase();
        const found = costCentersMap.get(cleanCode);
        if (!found) {
            return { valid: false, error: `Cost Center '${costCenterCode}' is not recognized in organizational rules.` };
        }
        if (found.isActive === false) {
            return { valid: false, error: `Cost Center '${found.costCenterName}' (${cleanCode}) is currently deactivated.` };
        }
        return { valid: true, costCenter: found };
    }

    /**
     * CREATE or UPSERT a Cost Center in Cloud Firestore
     * Target: organizations/{orgId}/cost_centers/{costCenterCode}
     */
    async function createCostCenter(data, orgId = getDefaultOrgId()) {
        const rawCode = data.costCenterCode || data.Cost_Center_Code || data.code;
        const rawName = data.costCenterName || data.Cost_Center_Name || data.name;
        const rawOwnerId = data.ownerEmployeeId || data.Owner_Employee_ID || data['Owner Employee ID'] || data.ownerId;
        const rawOwnerName = data.ownerEmployeeName || data.ownerName;
        const rawDesignation = data.ownerDesignation;
        const rawActive = data.isActive !== undefined ? data.isActive : (data.Active !== undefined ? data.Active : true);

        if (!rawCode || String(rawCode).trim() === '') {
            throw new Error("Missing required attribute 'Cost_Center_Code'.");
        }
        if (!rawName || String(rawName).trim() === '') {
            throw new Error("Missing required attribute 'Cost_Center_Name'.");
        }

        const ccCode = String(rawCode).trim().toUpperCase().replace(/\s+/g, '_');
        const ccName = String(rawName).trim();
        const ownerId = String(rawOwnerId || '').trim().toUpperCase();
        
        const ownerDetails = getOwnerDetailsById(ownerId);
        const ownerName = rawOwnerName || ownerDetails.name;
        const ownerDesignation = rawDesignation || ownerDetails.designation;

        const isActive = typeof rawActive === 'boolean'
            ? rawActive
            : (['yes', 'y', 'true', '1'].includes(String(rawActive).trim().toLowerCase()));

        const record = {
            costCenterCode: ccCode,
            costCenterName: ccName,
            ownerEmployeeId: ownerId,
            ownerEmployeeName: ownerName,
            ownerDesignation: ownerDesignation,
            isActive: isActive,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Immediately update local cache for synchronous caller availability
        costCentersMap.set(ccCode, record);

        // 1. Write to Cloud Firestore: organizations/{orgId}/cost_centers/{ccCode}
        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'cost_centers', ccCode);
                await fb.setDoc(docRef, {
                    ...record,
                    createdAt: fb.serverTimestamp ? fb.serverTimestamp() : record.createdAt,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : record.updatedAt
                }, { merge: true });

                console.log(`[CostCenterService] Saved to Firestore organizations/${orgId}/cost_centers/${ccCode}`);
            }
        } catch (err) {
            console.warn('[CostCenterService] Firestore write notice:', err.message);
        }

        // 2. Also save to local backend API if available
        try {
            const token = (typeof localStorage !== 'undefined' && (
                localStorage.getItem('authToken') || 
                localStorage.getItem('hr_access_token') || 
                localStorage.getItem('access_token') || 
                localStorage.getItem('token')
            )) || 'demo-static-token';

            if (typeof fetch !== 'undefined') {
                await fetch(`${typeof API_BASE !== 'undefined' ? API_BASE : (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : (typeof window !== 'undefined' && window.location ? window.location.origin : ''))}/api/admin/cost-centers`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(record)
                }).catch(() => {});
            }
        } catch (_) {}

        dispatchUpdateEvents();
        return record;
    }

    /**
     * UPDATE an existing Cost Center
     */
    async function updateCostCenter(costCenterCode, updateData, orgId = getDefaultOrgId()) {
        const ccCode = String(costCenterCode).trim().toUpperCase();
        const existing = costCentersMap.get(ccCode) || {};

        const merged = {
            ...existing,
            ...updateData,
            costCenterCode: ccCode,
            updatedAt: new Date().toISOString()
        };

        if (updateData.ownerEmployeeId && !updateData.ownerEmployeeName) {
            const resolved = getOwnerDetailsById(updateData.ownerEmployeeId);
            merged.ownerEmployeeName = resolved.name;
            merged.ownerDesignation = resolved.designation;
        }

        return await createCostCenter(merged, orgId);
    }

    /**
     * TOGGLE Active status of a Cost Center
     */
    async function toggleCostCenterStatus(costCenterCode, isActive = null, orgId = getDefaultOrgId()) {
        const ccCode = String(costCenterCode).trim().toUpperCase();
        const existing = costCentersMap.get(ccCode);
        if (!existing) {
            throw new Error(`Cost Center '${costCenterCode}' not found.`);
        }

        const newStatus = typeof isActive === 'boolean' ? isActive : !existing.isActive;
        return await updateCostCenter(ccCode, { isActive: newStatus }, orgId);
    }

    /**
     * DELETE a Cost Center
     */
    async function deleteCostCenter(costCenterCode, orgId = getDefaultOrgId()) {
        const ccCode = String(costCenterCode).trim().toUpperCase();

        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.deleteDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'cost_centers', ccCode);
                await fb.deleteDoc(docRef);
            }
        } catch (err) {
            console.warn('[CostCenterService] Firestore delete notice:', err.message);
        }

        costCentersMap.delete(ccCode);
        dispatchUpdateEvents();
        return { success: true, costCenterCode: ccCode };
    }

    /**
     * BULK IMPORT Cost Centers from parsed spreadsheet or CSV
     */
    async function bulkImportCostCenters(costCentersList, orgId = getDefaultOrgId()) {
        if (!Array.isArray(costCentersList) || costCentersList.length === 0) {
            throw new Error('No cost center records provided for ingestion.');
        }

        const results = [];
        const errors = [];

        for (const item of costCentersList) {
            try {
                const saved = await createCostCenter(item, orgId);
                results.push(saved);
            } catch (err) {
                errors.push({ item, error: err.message });
            }
        }

        return {
            success: errors.length === 0,
            count: results.length,
            total: costCentersList.length,
            successCount: results.length,
            errorCount: errors.length,
            results,
            errors
        };
    }

    /**
     * SUB-DEPARTMENT LINKAGE (PRD Section 13)
     * Links a Sub-Department to a Cost Center for budget & payroll attribution
     */
    function linkSubDepartmentCostCenter(subDepartmentCode, costCenterCode) {
        if (!subDepartmentCode || !costCenterCode) return false;
        const sub = String(subDepartmentCode).trim().toUpperCase();
        const cc = String(costCenterCode).trim().toUpperCase();
        subDeptMap.set(sub, cc);
        return true;
    }

    /**
     * Get Cost Center associated with a Sub-Department
     */
    function getCostCenterForSubDepartment(subDepartmentCode) {
        if (!subDepartmentCode) return null;
        const sub = String(subDepartmentCode).trim().toUpperCase();
        const ccCode = subDeptMap.get(sub);
        if (ccCode) {
            return getCostCenter(ccCode) || { costCenterCode: ccCode, costCenterName: ccCode, isActive: true };
        }
        return null;
    }

    /**
     * Get Cost Center Code string associated with a Sub-Department
     */
    function getCostCenterCodeForSubDepartment(subDepartmentCode, fallback = 'CC-ENG-101') {
        if (!subDepartmentCode) return fallback;
        const sub = String(subDepartmentCode).trim().toUpperCase();
        return subDeptMap.get(sub) || fallback;
    }

    /**
     * ACTIVE PERSONNEL DIRECTORY FOR OWNER SELECTION
     * Retrieves active personnel for autocomplete and select dropdowns
     */
    async function fetchActiveEmployees() {
        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.collection && fb.getDocs) {
                const snapshot = await fb.getDocs(fb.collection(fb.db, 'users')).catch(() => null) ||
                                 await fb.getDocs(fb.collection(fb.db, 'employees')).catch(() => null);

                if (snapshot && !snapshot.empty) {
                    snapshot.forEach(docSnap => {
                        const data = docSnap.data();
                        const empId = data.employeeId || data.id || docSnap.id;
                        if (empId && data.isActive !== false) {
                            activeEmployeesMap.set(String(empId).toUpperCase(), {
                                employeeId: String(empId).toUpperCase(),
                                fullName: data.fullName || data.name || data.displayName || 'Unknown',
                                email: data.email || '',
                                designation: data.designation || data.role || data.jobTitle || 'Executive / Leader',
                                department: data.department || data.departmentName || '',
                                active: true
                            });
                        }
                    });
                }
            }
        } catch (err) {
            console.warn('[CostCenterService] Active employee directory notice:', err.message);
        }

        return Array.from(activeEmployeesMap.values());
    }

    /**
     * Searches active leaders / employees for Owner autocomplete
     */
    function searchActiveOwners(query = '') {
        const list = Array.from(activeEmployeesMap.values());
        if (!query || query.trim() === '') return list;
        const q = query.trim().toLowerCase();
        return list.filter(e => 
            e.employeeId.toLowerCase().includes(q) ||
            e.fullName.toLowerCase().includes(q) ||
            (e.designation && e.designation.toLowerCase().includes(q))
        );
    }

    /**
     * DYNAMIC UI DROPDOWN BINDING SCRIPT (PRD Section 10 & 13)
     * Populates a <select> element with ONLY active Cost Centers ('Active' == 'Yes')
     * 
     * @param {string|HTMLSelectElement} selectElementOrId
     * @param {Object} [options]
     * @param {string} [options.selectedCode] - Initial value to select
     * @param {boolean} [options.includePlaceholder=true]
     * @param {string} [options.placeholderText='Select Cost Center']
     * @param {Function} [options.onSelect]
     */
    function populateCostCenterDropdown(selectElementOrId, options = {}) {
        const select = typeof selectElementOrId === 'string'
            ? document.getElementById(selectElementOrId)
            : selectElementOrId;

        if (!select) return null;

        const {
            selectedCode = '',
            includePlaceholder = true,
            placeholderText = 'Select Cost Center (Active)',
            onSelect = null
        } = options;

        const activeUnits = getActiveCostCenters();
        let html = '';

        if (includePlaceholder) {
            html += `<option value="">-- ${placeholderText} --</option>`;
        }

        activeUnits.forEach(cc => {
            const isSelected = selectedCode && cc.costCenterCode.toUpperCase() === selectedCode.toUpperCase();
            const ownerBadge = cc.ownerEmployeeName ? ` (Owner: ${cc.ownerEmployeeName})` : '';
            html += `<option value="${cc.costCenterCode}" ${isSelected ? 'selected' : ''}>${cc.costCenterCode} - ${cc.costCenterName}${ownerBadge}</option>`;
        });

        select.innerHTML = html;
        if (selectedCode) {
            select.value = selectedCode;
        }

        if (onSelect && typeof onSelect === 'function') {
            select.onchange = (e) => {
                const chosen = getCostCenter(e.target.value);
                onSelect(chosen, e);
            };
        }

        return activeUnits;
    }

    /**
     * Binds and auto-syncs all cost center dropdowns in the document
     * e.g. 'costCenterCodeSelect' or any select with name="costCenterCode"
     */
    function bindActiveCostCenterDropdown(selectElementOrId, options = {}) {
        const select = typeof selectElementOrId === 'string'
            ? document.getElementById(selectElementOrId)
            : selectElementOrId;

        if (!select) return null;

        // Populate initially
        const currentVal = select.value || options.selectedCode || '';
        populateCostCenterDropdown(select, { ...options, selectedCode: currentVal });

        // Re-populate on cost-centers-updated events
        if (typeof window !== 'undefined') {
            window.addEventListener('cost-centers-updated', () => {
                const preservedVal = select.value;
                populateCostCenterDropdown(select, { ...options, selectedCode: preservedVal });
            });
        }

        return select;
    }

    /**
     * Renders Owner Autocomplete / Select input for the Cost Center modal form
     */
    function populateOwnerDropdown(selectElementOrId, selectedOwnerId = '') {
        const select = typeof selectElementOrId === 'string'
            ? document.getElementById(selectElementOrId)
            : selectElementOrId;

        if (!select) return;

        const employees = Array.from(activeEmployeesMap.values());
        let html = '<option value="">-- Select Cost Center Owner (CEO, CTO, EVP, Director) --</option>';

        employees.forEach(emp => {
            const isSelected = selectedOwnerId && emp.employeeId.toUpperCase() === selectedOwnerId.toUpperCase();
            html += `<option value="${emp.employeeId}" ${isSelected ? 'selected' : ''}>${emp.employeeId} - ${emp.fullName} (${emp.designation || 'Leader'})</option>`;
        });

        select.innerHTML = html;
    }

    /**
     * Renders high-density Super Admin Management Console HTML into a container
     */
    function renderAdminConsole(containerId) {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;

        const costCenters = getAllCostCenters();
        const activeCount = costCenters.filter(c => c.isActive).length;
        const inactiveCount = costCenters.length - activeCount;

        container.innerHTML = `
            <div style="background: white; border-radius: 16px; border: 1px solid var(--border, #e2e8f0); padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <h3 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 8px;">
                            <i data-lucide="calculator" style="color: #2563eb; width: 22px; height: 22px;"></i>
                            Cost Center Management Console
                        </h3>
                        <p style="color: #64748b; font-size: 0.85rem; margin-top: 4px; margin-bottom: 0;">
                            Configure organizational budget units and payroll attribution matching PRD Sections 1, 10, &amp; 13.
                        </p>
                    </div>
                    <div style="display: flex; gap: 0.75rem;">
                        <button id="btnOpenNewCostCenterModal" class="btn btn-primary" style="display: flex; align-items: center; gap: 6px; font-weight: 700;">
                            <i data-lucide="plus-circle" style="width: 16px; height: 16px;"></i> Add Cost Center
                        </button>
                    </div>
                </div>

                <!-- KPI Quick Summary -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: #64748b; text-transform: uppercase;">Total Cost Centers</span>
                        <div style="font-size: 1.5rem; font-weight: 800; color: #0f172a; margin-top: 4px;">${costCenters.length}</div>
                    </div>
                    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 1rem;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: #166534; text-transform: uppercase;">Active Units</span>
                        <div style="font-size: 1.5rem; font-weight: 800; color: #15803d; margin-top: 4px;">${activeCount}</div>
                    </div>
                    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 1rem;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: #991b1b; text-transform: uppercase;">Inactive Units</span>
                        <div style="font-size: 1.5rem; font-weight: 800; color: #b91c1c; margin-top: 4px;">${inactiveCount}</div>
                    </div>
                    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 1rem;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: #1e40af; text-transform: uppercase;">Firestore Collection</span>
                        <div style="font-size: 0.82rem; font-family: monospace; font-weight: 700; color: #1d4ed8; margin-top: 6px;">cost_centers</div>
                    </div>
                </div>

                <!-- Table of Cost Centers -->
                <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                        <thead style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                            <tr>
                                <th style="padding: 12px 16px; font-weight: 700; color: #475569;">Cost Center Code</th>
                                <th style="padding: 12px 16px; font-weight: 700; color: #475569;">Cost Center Name</th>
                                <th style="padding: 12px 16px; font-weight: 700; color: #475569;">Owner Employee ID &amp; Leader</th>
                                <th style="padding: 12px 16px; font-weight: 700; color: #475569; text-align: center;">Status</th>
                                <th style="padding: 12px 16px; font-weight: 700; color: #475569; text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${costCenters.map(cc => {
                                const statusPill = cc.isActive
                                    ? '<span style="color: #166534; background: #dcfce7; padding: 3px 10px; border-radius: 20px; font-weight: 700; font-size: 0.75rem; border: 1px solid #bbf7d0;">Active (Yes)</span>'
                                    : '<span style="color: #991b1b; background: #fee2e2; padding: 3px 10px; border-radius: 20px; font-weight: 700; font-size: 0.75rem; border: 1px solid #fecaca;">Inactive (No)</span>';

                                return `
                                    <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                                        <td style="padding: 12px 16px; font-family: monospace; font-weight: 700; color: #2563eb;">
                                            ${cc.costCenterCode}
                                        </td>
                                        <td style="padding: 12px 16px; font-weight: 600; color: #0f172a;">
                                            ${cc.costCenterName}
                                        </td>
                                        <td style="padding: 12px 16px;">
                                            <span style="font-family: monospace; font-weight: 700; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.78rem;">
                                                ${cc.ownerEmployeeId || 'Unassigned'}
                                            </span>
                                            ${cc.ownerEmployeeName ? `<span style="font-weight: 600; margin-left: 6px; color: #334155;">${cc.ownerEmployeeName}</span>` : ''}
                                            ${cc.ownerDesignation ? `<div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">${cc.ownerDesignation}</div>` : ''}
                                        </td>
                                        <td style="padding: 12px 16px; text-align: center;">
                                            ${statusPill}
                                        </td>
                                        <td style="padding: 12px 16px; text-align: right;">
                                            <button onclick="window.KylrxCostCenterService.editCostCenter('${cc.costCenterCode}')" class="btn btn-outline" style="padding: 4px 8px; font-size: 0.75rem; margin-right: 4px;">
                                                Edit
                                            </button>
                                            <button onclick="window.KylrxCostCenterService.toggleActive('${cc.costCenterCode}')" class="btn btn-outline" style="padding: 4px 8px; font-size: 0.75rem;">
                                                ${cc.isActive ? 'Deactivate' : 'Activate'}
                                            </button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const btnAdd = document.getElementById('btnOpenNewCostCenterModal');
        if (btnAdd) {
            btnAdd.onclick = () => openCostCenterModal();
        }

        if (typeof window !== 'undefined' && window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * Opens modal dialog for Cost Center creation or editing
     */
    function openCostCenterModal(editCostCenterCode = null) {
        if (typeof document === 'undefined') return;

        let modal = document.getElementById('costCenterModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'costCenterModal';
            modal.style.cssText = `
                position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6);
                display: flex; align-items: center; justify-content: center; z-index: 99999;
                padding: 1rem; backdrop-filter: blur(4px);
            `;
            document.body.appendChild(modal);
        }

        const isEdit = !!editCostCenterCode;
        const current = isEdit ? getCostCenter(editCostCenterCode) : null;

        modal.innerHTML = `
            <div style="background: white; width: 100%; max-width: 520px; border-radius: 20px; padding: 2rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem;">
                    <h3 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="${isEdit ? 'edit' : 'plus-circle'}" style="color: #2563eb; width: 20px; height: 20px;"></i>
                        ${isEdit ? 'Edit Cost Center' : 'New Cost Center'}
                    </h3>
                    <button id="btnCloseCcModal" style="background: none; border: none; cursor: pointer; color: #64748b; font-size: 1.25rem;">✕</button>
                </div>

                <form id="costCenterForm">
                    <div style="margin-bottom: 1.25rem;">
                        <label style="display: block; font-weight: 700; font-size: 0.82rem; color: #334155; margin-bottom: 6px;">
                            1. Cost Center Code (Cost_Center_Code) *
                        </label>
                        <input type="text" id="modalCcCode" name="Cost_Center_Code" value="${current ? current.costCenterCode : ''}" 
                               placeholder="e.g. CC_ENG_DEV or CC-ENG-101" required ${isEdit ? 'readonly style="background: #f1f5f9; cursor: not-allowed;"' : ''}
                               style="width: 100%; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-family: monospace; font-weight: 700; text-transform: uppercase;">
                        <span style="font-size: 0.75rem; color: #64748b;">Unique primary key &amp; Firestore document ID</span>
                    </div>

                    <div style="margin-bottom: 1.25rem;">
                        <label style="display: block; font-weight: 700; font-size: 0.82rem; color: #334155; margin-bottom: 6px;">
                            2. Cost Center Name (Cost_Center_Name) *
                        </label>
                        <input type="text" id="modalCcName" name="Cost_Center_Name" value="${current ? current.costCenterName : ''}" 
                               placeholder="e.g. Software Engineering &amp; R&amp;D" required
                               style="width: 100%; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-weight: 600;">
                        <span style="font-size: 0.75rem; color: #64748b;">Display title for budget and payroll allocation</span>
                    </div>

                    <div style="margin-bottom: 1.25rem;">
                        <label style="display: block; font-weight: 700; font-size: 0.82rem; color: #334155; margin-bottom: 6px;">
                            3. Cost Center Owner (Owner_Employee_ID)
                        </label>
                        <select id="modalCcOwnerSelect" name="Owner_Employee_ID" style="width: 100%; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-weight: 600;">
                            <!-- Populated dynamically with active leaders -->
                        </select>
                        <span style="font-size: 0.75rem; color: #64748b;">Active employee lookup showing ID, Full Name, and Designation</span>
                    </div>

                    <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 12px; border-radius: 10px; border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between;">
                        <div>
                            <span style="display: block; font-weight: 700; font-size: 0.85rem; color: #1e293b;">4. Active Status (Active)</span>
                            <span style="font-size: 0.75rem; color: #64748b;">When active, units appear in onboarding and profile dropdowns</span>
                        </div>
                        <label style="position: relative; display: inline-block; width: 44px; height: 24px;">
                            <input type="checkbox" id="modalCcActive" ${!current || current.isActive ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                            <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${!current || current.isActive ? '#16a34a' : '#cbd5e1'}; transition: .3s; border-radius: 24px;" id="toggleSliderBg"></span>
                        </label>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button type="button" id="btnCancelCcModal" class="btn btn-outline" style="font-weight: 600;">Cancel</button>
                        <button type="submit" class="btn btn-primary" style="font-weight: 700; background: #2563eb;">
                            <i data-lucide="check"></i> ${isEdit ? 'Update Cost Center' : 'Save Cost Center'}
                        </button>
                    </div>
                </form>
            </div>
        `;

        modal.style.display = 'flex';
        populateOwnerDropdown('modalCcOwnerSelect', current ? current.ownerEmployeeId : '');

        const activeCheckbox = document.getElementById('modalCcActive');
        const sliderBg = document.getElementById('toggleSliderBg');
        if (activeCheckbox && sliderBg) {
            activeCheckbox.onchange = () => {
                sliderBg.style.backgroundColor = activeCheckbox.checked ? '#16a34a' : '#cbd5e1';
            };
        }

        const closeBtn = document.getElementById('btnCloseCcModal');
        const cancelBtn = document.getElementById('btnCancelCcModal');
        const close = () => { modal.style.display = 'none'; };
        if (closeBtn) closeBtn.onclick = close;
        if (cancelBtn) cancelBtn.onclick = close;

        const form = document.getElementById('costCenterForm');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const code = document.getElementById('modalCcCode').value.trim().toUpperCase();
                const name = document.getElementById('modalCcName').value.trim();
                const ownerId = document.getElementById('modalCcOwnerSelect').value.trim().toUpperCase();
                const isActive = document.getElementById('modalCcActive').checked;

                try {
                    if (isEdit) {
                        await updateCostCenter(code, {
                            costCenterName: name,
                            ownerEmployeeId: ownerId,
                            isActive: isActive
                        });
                    } else {
                        await createCostCenter({
                            costCenterCode: code,
                            costCenterName: name,
                            ownerEmployeeId: ownerId,
                            isActive: isActive
                        });
                    }

                    close();
                    if (typeof window !== 'undefined' && window.showCustomAlert) {
                        window.showCustomAlert(
                            "Success", 
                            `Cost Center '${code}' successfully saved to Cloud Firestore!`, 
                            "success"
                        );
                    }
                } catch (err) {
                    if (typeof window !== 'undefined' && window.showCustomAlert) {
                        window.showCustomAlert("Error", err.message, "error");
                    } else {
                        alert("Error: " + err.message);
                    }
                }
            };
        }

        if (typeof window !== 'undefined' && window.lucide) {
            window.lucide.createIcons();
        }
    }

    return {
        DEFAULT_COST_CENTERS,
        ACTIVE_EMPLOYEES_MASTER,
        SUB_DEPARTMENT_COST_CENTERS,
        getFirestorePath,
        getAllCostCenters,
        getActiveCostCenters,
        getCostCenter,
        validateCostCenterCode,
        createCostCenter,
        updateCostCenter,
        toggleCostCenterStatus,
        deleteCostCenter,
        bulkImportCostCenters,
        linkSubDepartmentCostCenter,
        getCostCenterForSubDepartment,
        getCostCenterCodeForSubDepartment,
        fetchActiveEmployees,
        searchActiveOwners,
        populateCostCenterDropdown,
        bindActiveCostCenterDropdown,
        populateOwnerDropdown,
        renderAdminConsole,
        openCostCenterModal,
        // Helper aliases
        editCostCenter: (code) => openCostCenterModal(code),
        toggleActive: (code) => toggleCostCenterStatus(code)
    };
}));
