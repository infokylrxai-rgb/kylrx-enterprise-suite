/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - BUSINESS UNIT CRUD CONTROLLER & RULES ENGINE
 * ============================================================================
 * 
 * Cloud Firestore Data Architecture:
 * Path: organizations/{orgId}/business_units/{businessUnitCode}
 * 
 * Document Schema:
 * {
 *   "businessUnitCode": "BU_CORP_01",
 *   "businessUnitName": "Corporate Operations",
 *   "headEmployeeId": "EMP0003",
 *   "headEmployeeName": "Ananya Roy",
 *   "isActive": true,
 *   "allowedEmployeeTypes": ["FULL_TIME", "CONTRACT"],
 *   "createdAt": "serverTimestamp()",
 *   "updatedAt": "serverTimestamp()"
 * }
 * 
 * Features:
 * 1. Full CRUD for Business Units (create, update, toggle active status, delete).
 * 2. Real-time Cloud Firestore synchronization + local cache resilience.
 * 3. Dynamic Head Employee Selection from active employees master directory.
 * 4. PRD Section 10 Employee-Type Rule Integration & Form Gating.
 * 5. Dual-collection synchronization (organizations/{orgId}/business_units & bu_employee_type_rules).
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
        root.KylrxBusinessUnitController = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Employee Types aligned with PRD §10 & Templates.xlsx
    const CANONICAL_EMPLOYEE_TYPES = [
        {
            code: 'FULL_TIME',
            name: 'Full-Time Regular',
            categoryCode: 'CAT_FT',
            employmentType: 'Full-Time',
            workerType: 'Permanent',
            badgeClass: 'badge-fulltime'
        },
        {
            code: 'CONTRACT',
            name: 'Contractor / TVC',
            categoryCode: 'CAT_CON',
            employmentType: 'Contract',
            workerType: 'Contingent',
            badgeClass: 'badge-contractor'
        },
        {
            code: 'CONTRACTOR',
            name: 'Contractor / TVC (Alias)',
            categoryCode: 'CAT_CON',
            employmentType: 'Contract',
            workerType: 'Contingent',
            badgeClass: 'badge-contractor'
        },
        {
            code: 'INTERN',
            name: 'Intern / Apprentice',
            categoryCode: 'CAT_INT',
            employmentType: 'Internship',
            workerType: 'Trainee',
            badgeClass: 'badge-intern'
        },
        {
            code: 'CONSULTANT',
            name: 'Consultant / Specialist',
            categoryCode: 'CAT_CNS',
            employmentType: 'Consulting',
            workerType: 'Professional',
            badgeClass: 'badge-consultant'
        },
        {
            code: 'EXECUTIVE',
            name: 'Executive Leadership',
            categoryCode: 'CAT_EXE',
            employmentType: 'Full-Time',
            workerType: 'Officer',
            badgeClass: 'badge-executive'
        }
    ];

    // Default Seed Business Units matching Templates.xlsx 'Business Unit' sheet & PRD §10
    const DEFAULT_BUSINESS_UNITS = [
        {
            businessUnitCode: 'BU-TECH',
            businessUnitName: 'Technology & Product Engineering',
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Ananya Roy',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONTRACTOR', 'INTERN']
        },
        {
            businessUnitCode: 'BU-OPS',
            businessUnitName: 'Global Operations & Customer Success',
            headEmployeeId: 'EMP0002',
            headEmployeeName: 'Rajesh Sharma',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONTRACTOR']
        },
        {
            businessUnitCode: 'BU-CORP',
            businessUnitName: 'Corporate Finance & Human Resources',
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONSULTANT']
        },
        {
            businessUnitCode: 'BU_CORP_01',
            businessUnitName: 'Corporate Operations',
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT']
        },
        {
            businessUnitCode: 'BU_ENG',
            businessUnitName: 'Core Engineering & Technology',
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Ananya Roy',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONTRACTOR', 'INTERN']
        },
        {
            businessUnitCode: 'BU-EXEC',
            businessUnitName: 'Executive Leadership & Strategy',
            headEmployeeId: 'EMP0004',
            headEmployeeName: 'Vikram Malhotra',
            isActive: true,
            allowedEmployeeTypes: ['EXECUTIVE', 'FULL_TIME']
        },
        {
            businessUnitCode: 'BU-SALES',
            businessUnitName: 'Enterprise Sales & Partnerships',
            headEmployeeId: 'EMP0005',
            headEmployeeName: 'Priya Nair',
            isActive: true,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONTRACTOR', 'CONSULTANT']
        }
    ];

    // Canonical active employees fallback directory
    const CANONICAL_ACTIVE_EMPLOYEES = [
        { employeeId: 'EMP0001', fullName: 'Ananya Roy', email: 'ananya.roy@kylrx.ai', role: 'Engineering Director', department: 'Core Engineering' },
        { employeeId: 'EMP0002', fullName: 'Rajesh Sharma', email: 'rajesh.sharma@kylrx.ai', role: 'Operations Head', department: 'Global Operations' },
        { employeeId: 'EMP0003', fullName: 'Ananya Roy', email: 'ananya.roy.corp@kylrx.ai', role: 'Head of Corporate Operations', department: 'Corporate Operations' },
        { employeeId: 'EMP0004', fullName: 'Vikram Malhotra', email: 'vikram.m@kylrx.ai', role: 'Chief Executive Officer', department: 'Executive' },
        { employeeId: 'EMP0005', fullName: 'Priya Nair', email: 'priya.nair@kylrx.ai', role: 'VP Enterprise Sales', department: 'Enterprise Sales' },
        { employeeId: 'EMP0006', fullName: 'John Doe', email: 'john.doe@example.com', role: 'Engineering Manager', department: 'Engineering' },
        { employeeId: 'EMP0007', fullName: 'Marry Doe', email: 'marry@gmail.com', role: 'Software Engineer', department: 'Engineering' }
    ];

    // In-memory cache
    const businessUnitsMap = new Map();
    let activeEmployeesCache = [...CANONICAL_ACTIVE_EMPLOYEES];
    let isInitialized = false;

    function getDefaultOrgId() {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('orgId') || 'org_kylrx';
        }
        return 'org_kylrx';
    }

    /**
     * Initializes default in-memory records
     */
    function initDefaults() {
        if (businessUnitsMap.size === 0) {
            DEFAULT_BUSINESS_UNITS.forEach(bu => {
                businessUnitsMap.set(bu.businessUnitCode.toUpperCase(), {
                    ...bu,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            });
        }
    }
    initDefaults();

    /**
     * Resolves head employee full name from employee ID
     */
    function getEmployeeNameById(empId) {
        if (!empId) return '';
        const cleanId = String(empId).trim().toUpperCase();
        const found = activeEmployeesCache.find(e => (e.employeeId || e.id || '').toUpperCase() === cleanId);
        return found ? (found.fullName || found.name || cleanId) : cleanId;
    }

    /**
     * Fetches all active employees from Firestore users/employees collections
     * for dynamic Head Selection search dropdown.
     */
    async function fetchActiveEmployees(orgId = getDefaultOrgId()) {
        try {
            const fb = await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.collection && fb.getDocs) {
                const employeesList = [];

                // 1. Try 'users' collection
                try {
                    const snap = await fb.getDocs(fb.collection(fb.db, 'users'));
                    if (!snap.empty) {
                        snap.forEach(docSnap => {
                            const d = docSnap.data();
                            const empId = d.employeeId || d.id || docSnap.id;
                            const isTerminated = d.status === 'Terminated' || d.status === 'Trash';
                            if (empId && !isTerminated) {
                                employeesList.push({
                                    employeeId: empId,
                                    fullName: d.fullName || d.name || d.displayName || empId,
                                    email: d.email || d.officialEmail || '',
                                    department: d.department || d.departmentName || '',
                                    role: d.role || d.designation || 'Staff'
                                });
                            }
                        });
                    }
                } catch (_) {}

                // 2. Try organizations/{orgId}/employees or 'employees' collection if needed
                if (employeesList.length === 0) {
                    try {
                        const empSnap = await fb.getDocs(fb.collection(fb.db, 'employees'));
                        if (!empSnap.empty) {
                            empSnap.forEach(docSnap => {
                                const d = docSnap.data();
                                const empId = d.employeeId || docSnap.id;
                                if (empId && d.status !== 'Terminated') {
                                    employeesList.push({
                                        employeeId: empId,
                                        fullName: d.fullName || d.name || empId,
                                        email: d.email || '',
                                        department: d.department || '',
                                        role: d.role || d.designation || 'Staff'
                                    });
                                }
                            });
                        }
                    } catch (_) {}
                }

                if (employeesList.length > 0) {
                    // Deduplicate
                    const map = new Map();
                    employeesList.forEach(e => map.set(e.employeeId.toUpperCase(), e));
                    // Keep canonical fallbacks for missing
                    CANONICAL_ACTIVE_EMPLOYEES.forEach(e => {
                        if (!map.has(e.employeeId.toUpperCase())) map.set(e.employeeId.toUpperCase(), e);
                    });
                    activeEmployeesCache = Array.from(map.values());
                }
            }
        } catch (err) {
            console.warn('[BusinessUnitController] Employee list load warning:', err.message);
        }

        return [...activeEmployeesCache];
    }

    /**
     * Loads Business Units from Cloud Firestore:
     * 1. organizations/{orgId}/business_units
     * 2. bu_employee_type_rules (fallback/dual-read)
     */
    async function loadBusinessUnitsFromFirestore(orgId = getDefaultOrgId()) {
        try {
            const fb = await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.collection && fb.getDocs) {
                // 1. Primary path: organizations/{orgId}/business_units
                const buCollRef = fb.collection(fb.db, 'organizations', orgId, 'business_units');
                const buSnap = await fb.getDocs(buCollRef).catch(() => ({ empty: true }));

                if (!buSnap.empty) {
                    businessUnitsMap.clear();
                    buSnap.forEach(docSnap => {
                        const data = docSnap.data();
                        const buCode = (data.businessUnitCode || docSnap.id).toUpperCase();
                        businessUnitsMap.set(buCode, {
                            businessUnitCode: buCode,
                            businessUnitName: data.businessUnitName || buCode,
                            headEmployeeId: data.headEmployeeId || '',
                            headEmployeeName: data.headEmployeeName || getEmployeeNameById(data.headEmployeeId),
                            isActive: data.isActive !== false,
                            allowedEmployeeTypes: Array.isArray(data.allowedEmployeeTypes) ? data.allowedEmployeeTypes : ['FULL_TIME', 'CONTRACT'],
                            createdAt: data.createdAt || new Date().toISOString(),
                            updatedAt: data.updatedAt || new Date().toISOString()
                        });
                    });
                    console.log(`[BusinessUnitController] Loaded ${businessUnitsMap.size} BUs from organizations/${orgId}/business_units`);
                } else {
                    // Fallback path: bu_employee_type_rules
                    const rulesSnap = await fb.getDocs(fb.collection(fb.db, 'bu_employee_type_rules')).catch(() => ({ empty: true }));
                    if (!rulesSnap.empty) {
                        rulesSnap.forEach(docSnap => {
                            const data = docSnap.data();
                            const buCode = (data.businessUnitCode || docSnap.id).toUpperCase();
                            if (!businessUnitsMap.has(buCode)) {
                                businessUnitsMap.set(buCode, {
                                    businessUnitCode: buCode,
                                    businessUnitName: data.businessUnitName || buCode,
                                    headEmployeeId: data.headEmployeeId || '',
                                    headEmployeeName: data.headEmployeeName || getEmployeeNameById(data.headEmployeeId),
                                    isActive: data.isActive !== false,
                                    allowedEmployeeTypes: Array.isArray(data.allowedEmployeeTypes) ? data.allowedEmployeeTypes : ['FULL_TIME', 'CONTRACT'],
                                    createdAt: data.createdAt || new Date().toISOString(),
                                    updatedAt: data.updatedAt || new Date().toISOString()
                                });
                            }
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('[BusinessUnitController] Firestore read notice (using memory defaults):', err.message);
        }

        isInitialized = true;
        dispatchUpdateEvents();
        return Array.from(businessUnitsMap.values());
    }

    function dispatchUpdateEvents() {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            const list = Array.from(businessUnitsMap.values());
            window.dispatchEvent(new CustomEvent('businessUnitsUpdated', {
                detail: { businessUnits: list }
            }));
            window.dispatchEvent(new CustomEvent('buRulesUpdated', {
                detail: { rules: list.map(b => ({
                    ruleId: `rule_${b.businessUnitCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                    businessUnitCode: b.businessUnitCode,
                    businessUnitName: b.businessUnitName,
                    headEmployeeId: b.headEmployeeId,
                    allowedEmployeeTypes: b.allowedEmployeeTypes,
                    isActive: b.isActive
                })) }
            }));
        }
    }

    /**
     * Get all Business Units
     */
    function getAllBusinessUnits(includeInactive = true) {
        const all = Array.from(businessUnitsMap.values());
        if (includeInactive) return all;
        return all.filter(bu => bu.isActive !== false);
    }

    /**
     * Get single Business Unit by Code
     */
    function getBusinessUnit(businessUnitCode) {
        if (!businessUnitCode) return null;
        return businessUnitsMap.get(String(businessUnitCode).trim().toUpperCase()) || null;
    }

    /**
     * Get canonical employee types
     */
    function getEmployeeTypes() {
        return [...CANONICAL_EMPLOYEE_TYPES];
    }

    /**
     * Returns list of business units allowed for a selected employee type
     * Strict filtering: ONLY units where isActive === true and allowedEmployeeTypes contains employeeType.
     */
    function getAllowedBusinessUnits(employeeType) {
        const activeUnits = getAllBusinessUnits(false); // active only
        if (!employeeType) return activeUnits;

        const normalizedType = String(employeeType).trim().toUpperCase();
        // Handle alias: CONTRACT <-> CONTRACTOR
        const checkTypes = [normalizedType];
        if (normalizedType === 'CONTRACT') checkTypes.push('CONTRACTOR');
        if (normalizedType === 'CONTRACTOR') checkTypes.push('CONTRACT');

        return activeUnits.filter(bu => {
            const allowed = (bu.allowedEmployeeTypes || []).map(t => String(t).toUpperCase());
            return checkTypes.some(t => allowed.includes(t));
        });
    }

    /**
     * Validates if a combination of BU and Employee Type is valid
     */
    function isCombinationValid(buCode, employeeType) {
        if (!buCode || !employeeType) {
            return { valid: false, error: 'Both Business Unit and Employee Type are required.' };
        }
        const normalizedBU = String(buCode).trim().toUpperCase();
        const normalizedType = String(employeeType).trim().toUpperCase();

        const bu = businessUnitsMap.get(normalizedBU);
        if (!bu) {
            return {
                valid: false,
                error: `Business Unit '${buCode}' is not recognized or mapped in organizational rules.`
            };
        }

        if (bu.isActive === false) {
            return {
                valid: false,
                error: `Business Unit '${bu.businessUnitName}' (${buCode}) is deactivated.`
            };
        }

        const allowed = (bu.allowedEmployeeTypes || []).map(t => String(t).toUpperCase());
        const checkTypes = [normalizedType];
        if (normalizedType === 'CONTRACT') checkTypes.push('CONTRACTOR');
        if (normalizedType === 'CONTRACTOR') checkTypes.push('CONTRACT');

        const isAllowed = checkTypes.some(t => allowed.includes(t));
        if (!isAllowed) {
            const allowedLabels = allowed.map(t => {
                const found = CANONICAL_EMPLOYEE_TYPES.find(c => c.code === t);
                return found ? found.name : t;
            }).join(', ');

            return {
                valid: false,
                error: `Business Unit '${bu.businessUnitName}' (${buCode}) does not permit '${employeeType}'. Allowed employee types: ${allowedLabels || 'None'}.`
            };
        }

        return { valid: true };
    }

    /**
     * CREATE or UPSERT a Business Unit in Cloud Firestore
     * Target: organizations/{orgId}/business_units/{businessUnitCode}
     */
    async function createBusinessUnit(data, orgId = getDefaultOrgId()) {
        const rawCode = data.businessUnitCode || data.Business_Unit_Code || data.code;
        const rawName = data.businessUnitName || data.Business_Unit_Name || data.name;
        const rawHeadId = data.headEmployeeId || data.Head_Employee_ID || data.headId || '';
        const rawHeadName = data.headEmployeeName || getEmployeeNameById(rawHeadId);
        const rawActive = data.isActive !== undefined ? data.isActive : (data.Active !== undefined ? data.Active : true);

        if (!rawCode || String(rawCode).trim() === '') {
            throw new Error('Business Unit Code (Business_Unit_Code) is required.');
        }
        if (!rawName || String(rawName).trim() === '') {
            throw new Error('Business Unit Name (Business_Unit_Name) is required.');
        }

        const buCode = String(rawCode).trim().toUpperCase().replace(/\s+/g, '_');
        const buName = String(rawName).trim();
        const headId = String(rawHeadId || '').trim().toUpperCase();
        const headName = rawHeadName || getEmployeeNameById(headId);
        const isActive = typeof rawActive === 'boolean' ? rawActive : (String(rawActive).toLowerCase() === 'yes' || String(rawActive).toLowerCase() === 'true');

        let allowedTypes = Array.isArray(data.allowedEmployeeTypes) && data.allowedEmployeeTypes.length > 0
            ? data.allowedEmployeeTypes.map(t => String(t).trim().toUpperCase())
            : ['FULL_TIME', 'CONTRACT'];

        // Normalize CONTRACT / CONTRACTOR
        if (allowedTypes.includes('CONTRACT') && !allowedTypes.includes('CONTRACTOR')) {
            allowedTypes.push('CONTRACTOR');
        }

        const record = {
            businessUnitCode: buCode,
            businessUnitName: buName,
            headEmployeeId: headId,
            headEmployeeName: headName,
            isActive: isActive,
            allowedEmployeeTypes: allowedTypes,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Immediately update in-memory cache for synchronous availability
        businessUnitsMap.set(buCode, record);

        // 1. Write to Cloud Firestore: organizations/{orgId}/business_units/{buCode}
        try {
            const fb = await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'business_units', buCode);
                await fb.setDoc(docRef, {
                    ...record,
                    createdAt: fb.serverTimestamp ? fb.serverTimestamp() : record.createdAt,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : record.updatedAt
                }, { merge: true });

                // Also dual-sync to bu_employee_type_rules collection
                const ruleId = `rule_${buCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
                const ruleDocRef = fb.doc(fb.db, 'bu_employee_type_rules', ruleId);
                await fb.setDoc(ruleDocRef, {
                    ruleId,
                    businessUnitCode: buCode,
                    businessUnitName: buName,
                    headEmployeeId: headId,
                    headEmployeeName: headName,
                    isActive: isActive,
                    allowedEmployeeTypes: allowedTypes,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : record.updatedAt
                }, { merge: true }).catch(() => {});

                console.log(`[BusinessUnitController] Saved to Firestore organizations/${orgId}/business_units/${buCode}`);
            }
        } catch (err) {
            console.warn('[BusinessUnitController] Firestore save notice:', err.message);
        }

        // 2. Also save to local backend API
        try {
            const token = (typeof localStorage !== 'undefined' && (
                localStorage.getItem('authToken') || 
                localStorage.getItem('hr_access_token') || 
                localStorage.getItem('access_token') || 
                localStorage.getItem('token')
            )) || 'demo-static-token';
            const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : (typeof window !== 'undefined' && window.location ? window.location.origin : ''));
            await fetch(`${apiBase}/api/admin/bu-rules`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(record)
            }).catch(() => {});
        } catch (_) {}

        // 3. Update memory map
        businessUnitsMap.set(buCode, record);
        dispatchUpdateEvents();
        return record;
    }

    /**
     * UPDATE an existing Business Unit
     */
    async function updateBusinessUnit(businessUnitCode, updateData, orgId = getDefaultOrgId()) {
        const buCode = String(businessUnitCode).trim().toUpperCase();
        const existing = businessUnitsMap.get(buCode) || {};

        const merged = {
            ...existing,
            ...updateData,
            businessUnitCode: buCode,
            updatedAt: new Date().toISOString()
        };

        if (updateData.headEmployeeId && !updateData.headEmployeeName) {
            merged.headEmployeeName = getEmployeeNameById(updateData.headEmployeeId);
        }

        return await createBusinessUnit(merged, orgId);
    }

    /**
     * TOGGLE Active status of a Business Unit
     */
    async function toggleBusinessUnitStatus(businessUnitCode, isActive, orgId = getDefaultOrgId()) {
        const buCode = String(businessUnitCode).trim().toUpperCase();
        const existing = businessUnitsMap.get(buCode);
        if (!existing) {
            throw new Error(`Business Unit '${businessUnitCode}' not found.`);
        }

        const newStatus = typeof isActive === 'boolean' ? isActive : !existing.isActive;
        return await updateBusinessUnit(buCode, { isActive: newStatus }, orgId);
    }

    /**
     * DELETE a Business Unit (Soft delete or Firestore delete)
     */
    async function deleteBusinessUnit(businessUnitCode, orgId = getDefaultOrgId()) {
        const buCode = String(businessUnitCode).trim().toUpperCase();
        
        try {
            const fb = await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.deleteDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'business_units', buCode);
                await fb.deleteDoc(docRef);

                const ruleId = `rule_${buCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
                await fb.deleteDoc(fb.doc(fb.db, 'bu_employee_type_rules', ruleId)).catch(() => {});
            }
        } catch (err) {
            console.warn('[BusinessUnitController] Firestore delete notice:', err.message);
        }

        businessUnitsMap.delete(buCode);
        dispatchUpdateEvents();
        return { success: true, businessUnitCode: buCode };
    }

    /**
     * BULK IMPORT Business Units from parsed spreadsheet or CSV
     */
    async function bulkImportBusinessUnits(businessUnitsList, orgId = getDefaultOrgId()) {
        if (!Array.isArray(businessUnitsList) || businessUnitsList.length === 0) {
            throw new Error('No business unit records provided for ingestion.');
        }

        const results = [];
        const errors = [];

        for (const item of businessUnitsList) {
            try {
                const saved = await createBusinessUnit(item, orgId);
                results.push(saved);
            } catch (err) {
                errors.push({ code: item.businessUnitCode || item.Business_Unit_Code, error: err.message });
            }
        }

        console.log(`[BusinessUnitController] Bulk ingested ${results.length} business units (${errors.length} failed).`);
        return {
            total: businessUnitsList.length,
            successCount: results.length,
            errorCount: errors.length,
            imported: results,
            errors
        };
    }

    /**
     * Dynamic select/dropdown population script filtering active units by employee type.
     * Enforces real-time filtering, hides inactive and unauthorized options,
     * and shows inline alert if a previously chosen option is disqualified.
     */
    function bindEmployeeTypeAndBuGating(empTypeSelect, buSelect, options = {}) {
        if (!empTypeSelect || !buSelect) return null;

        const noticeContainerId = options.noticeContainerId || 'buMismatchNotice';
        let noticeEl = document.getElementById(noticeContainerId);

        // Create notice banner if not yet in DOM
        if (!noticeEl) {
            noticeEl = document.createElement('div');
            noticeEl.id = noticeContainerId;
            noticeEl.style.display = 'none';
            noticeEl.style.marginTop = '6px';
            noticeEl.style.padding = '8px 12px';
            noticeEl.style.borderRadius = '8px';
            noticeEl.style.backgroundColor = '#fef2f2';
            noticeEl.style.color = '#991b1b';
            noticeEl.style.border = '1px solid #fecaca';
            noticeEl.style.fontSize = '0.78rem';
            noticeEl.style.lineHeight = '1.35';
            noticeEl.style.transition = 'opacity 0.3s ease';

            if (buSelect.parentNode) {
                buSelect.parentNode.appendChild(noticeEl);
            }
        }

        function showNotice(msg) {
            if (!noticeEl) return;
            noticeEl.innerHTML = `<i class="fas fa-info-circle" style="margin-right: 4px;"></i> ${msg}`;
            noticeEl.style.display = 'block';
            noticeEl.style.opacity = '1';

            setTimeout(() => {
                if (noticeEl) {
                    noticeEl.style.opacity = '0';
                    setTimeout(() => { if (noticeEl) noticeEl.style.display = 'none'; }, 300);
                }
            }, 6000);
        }

        function filterDropdown() {
            const selectedType = (empTypeSelect.value || '').trim().toUpperCase();
            const currentBU = (buSelect.value || '').trim().toUpperCase();

            // Strictly filter active units allowed for this type
            const allowedBUs = getAllowedBusinessUnits(selectedType);
            const allowedCodes = allowedBUs.map(b => b.businessUnitCode.toUpperCase());

            let isCurrentSelectionAllowed = false;

            // Preserve placeholder
            const placeholder = buSelect.options[0] && buSelect.options[0].value === ''
                ? buSelect.options[0].outerHTML
                : '<option value="">-- Select Eligible Business Unit --</option>';

            buSelect.innerHTML = placeholder;

            allowedBUs.forEach(bu => {
                const opt = document.createElement('option');
                opt.value = bu.businessUnitCode;
                opt.textContent = `${bu.businessUnitCode} - ${bu.businessUnitName}`;
                if (bu.businessUnitCode.toUpperCase() === currentBU) {
                    opt.selected = true;
                    isCurrentSelectionAllowed = true;
                }
                buSelect.appendChild(opt);
            });

            // If user previously selected a unit that is now disqualified, clear selection
            if (currentBU && !isCurrentSelectionAllowed) {
                buSelect.value = '';
                const typeObj = CANONICAL_EMPLOYEE_TYPES.find(t => t.code === selectedType);
                const typeLabel = typeObj ? typeObj.name : selectedType;
                showNotice(`Previous Business Unit <strong>(${currentBU})</strong> was cleared because it is not eligible for <strong>${typeLabel}</strong>.`);
            }

            // Disable dropdown if no eligible units
            if (allowedBUs.length === 0) {
                buSelect.disabled = true;
                showNotice(`No Business Units are configured or active for Employee Type: <strong>${selectedType}</strong>.`);
            } else {
                buSelect.disabled = false;
            }
        }

        empTypeSelect.addEventListener('change', filterDropdown);
        window.addEventListener('businessUnitsUpdated', filterDropdown);
        window.addEventListener('buRulesUpdated', filterDropdown);

        // Initial run
        filterDropdown();

        return {
            refresh: filterDropdown,
            validate: () => isCombinationValid(buSelect.value, empTypeSelect.value)
        };
    }

    /**
     * UI Renderer for Super Admin Configuration Console
     * Renders a modern high-density Business Unit management table with
     * active/inactive status switch, employee-type pills, and an Add/Edit modal.
     */
    function renderAdminConsole(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const businessUnits = getAllBusinessUnits(true);
        const types = CANONICAL_EMPLOYEE_TYPES.filter(t => t.code !== 'CONTRACTOR'); // unique canonicals

        let html = `
            <div class="bu-admin-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.85rem; font-weight: 700; color: #475569;">
                        Total Configured Units: <strong>${businessUnits.length}</strong>
                    </span>
                    <span style="font-size: 0.75rem; background: #dcfce7; color: #166534; font-weight: 700; padding: 2px 8px; border-radius: 9999px;">
                        ${businessUnits.filter(b => b.isActive).length} Active
                    </span>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn btn-outline" onclick="window.KylrxBusinessUnitController.openBuModal()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-size: 0.82rem; border-radius: 10px; font-weight: 700; border: 1.5px solid #cbd5e1; background: white; cursor: pointer;">
                        <i class="fas fa-plus-circle" style="color: #2563eb;"></i> Add Business Unit
                    </button>
                    <button type="button" class="btn btn-primary" onclick="window.KylrxBusinessUnitController.saveAllRules()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 0.82rem; border-radius: 10px; font-weight: 700; background: #2563eb; color: white; border: none; cursor: pointer;">
                        <i class="fas fa-save"></i> Save All
                    </button>
                </div>
            </div>

            <div class="bu-rules-table-wrapper" style="overflow-x: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                    <thead>
                        <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569;">
                            <th style="padding: 14px 16px; font-weight: 800; width: 130px;">BU Code</th>
                            <th style="padding: 14px 16px; font-weight: 800; min-width: 180px;">Business Unit Title</th>
                            <th style="padding: 14px 16px; font-weight: 800; min-width: 160px;">BU Head</th>
                            <th style="padding: 14px 16px; font-weight: 800;">Permitted Types (PRD §10)</th>
                            <th style="padding: 14px 16px; font-weight: 800; width: 110px; text-align: center;">Active Status</th>
                            <th style="padding: 14px 16px; font-weight: 800; width: 120px; text-align: center;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        businessUnits.forEach(bu => {
            const allowed = (bu.allowedEmployeeTypes || []).map(t => String(t).toUpperCase());
            const headName = bu.headEmployeeName || getEmployeeNameById(bu.headEmployeeId);

            const pillsHtml = types.map(t => {
                const isChecked = allowed.includes(t.code) || (t.code === 'CONTRACT' && allowed.includes('CONTRACTOR'));
                return `
                    <label class="bu-type-pill ${isChecked ? 'active' : ''}" style="
                        display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; cursor: pointer; user-select: none; transition: all 0.15s ease;
                        background: ${isChecked ? '#dbeafe' : '#f1f5f9'};
                        color: ${isChecked ? '#1d4ed8' : '#64748b'};
                        border: 1px solid ${isChecked ? '#93c5fd' : '#cbd5e1'};
                    ">
                        <input type="checkbox" style="display:none;" 
                            data-bu="${bu.businessUnitCode}" 
                            data-type="${t.code}" 
                            ${isChecked ? 'checked' : ''} 
                            onchange="window.KylrxBusinessUnitController.handleTypeToggle('${bu.businessUnitCode}', '${t.code}', this.checked)"
                        />
                        <span>${t.name}</span>
                        <i class="fas ${isChecked ? 'fa-check-circle' : 'fa-circle'}" style="font-size: 9px;"></i>
                    </label>
                `;
            }).join(' ');

            html += `
                <tr id="row_bu_${bu.businessUnitCode}" style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s; opacity: ${bu.isActive ? '1' : '0.65'};">
                    <td style="padding: 12px 16px; font-family: monospace; font-weight: 800; color: #2563eb;">
                        ${bu.businessUnitCode}
                    </td>
                    <td style="padding: 12px 16px; font-weight: 600; color: #0f172a;">
                        ${bu.businessUnitName}
                    </td>
                    <td style="padding: 12px 16px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-family: monospace; font-weight: 700; font-size: 0.78rem; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px;">
                                ${bu.headEmployeeId || 'N/A'}
                            </span>
                            <span style="font-size: 0.8rem; font-weight: 600; color: #334155;">
                                ${headName || 'Unassigned'}
                            </span>
                        </div>
                    </td>
                    <td style="padding: 12px 16px;">
                        <div style="display: flex; flex-wrap: wrap; gap: 5px;">
                            ${pillsHtml}
                        </div>
                    </td>
                    <td style="padding: 12px 16px; text-align: center;">
                        <button type="button" 
                            onclick="window.KylrxBusinessUnitController.toggleActiveStatus('${bu.businessUnitCode}')"
                            style="cursor: pointer; border: none; background: none; padding: 0;"
                            title="Click to toggle Active status"
                        >
                            <span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 9999px; font-size: 0.72rem; font-weight: 800; background: ${bu.isActive ? '#dcfce7' : '#fee2e2'}; color: ${bu.isActive ? '#166534' : '#991b1b'}; border: 1px solid ${bu.isActive ? '#bbf7d0' : '#fecaca'};">
                                <i class="fas ${bu.isActive ? 'fa-check' : 'fa-times'}"></i>
                                ${bu.isActive ? 'Active (Yes)' : 'Inactive (No)'}
                            </span>
                        </button>
                    </td>
                    <td style="padding: 12px 16px; text-align: center;">
                        <div style="display: flex; gap: 6px; justify-content: center;">
                            <button type="button" class="btn btn-outline" style="padding: 5px 10px; font-size: 0.75rem; border-radius: 6px; border: 1px solid #cbd5e1; background: white; cursor: pointer;" onclick="window.KylrxBusinessUnitController.openBuModal('${bu.businessUnitCode}')" title="Edit BU">
                                <i class="fas fa-edit" style="color: #475569;"></i>
                            </button>
                            <button type="button" class="btn btn-primary" style="padding: 5px 10px; font-size: 0.75rem; border-radius: 6px; background: #2563eb; color: white; border: none; cursor: pointer;" onclick="window.KylrxBusinessUnitController.saveSingleRule('${bu.businessUnitCode}')" title="Save to Firestore">
                                <i class="fas fa-save"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
        ensureBuModalInDom();
    }

    /**
     * Injects the clean manual Add/Edit Business Unit modal into the DOM
     */
    function ensureBuModalInDom() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('buEditModal')) return;

        const modalDiv = document.createElement('div');
        modalDiv.id = 'buEditModal';
        modalDiv.className = 'modal-overlay';
        modalDiv.style.cssText = `
            position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(8px);
            z-index: 10000; display: none; align-items: center; justify-content: center;
        `;

        modalDiv.innerHTML = `
            <div class="modal" style="background: white; border-radius: 24px; padding: 2rem; max-width: 580px; width: 92%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 1.25rem;">
                    <div>
                        <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;" id="buModalTitle">Add Business Unit</h2>
                        <p style="font-size: 0.8rem; color: #64748b; margin: 3px 0 0;">Ingest and store business unit matching PRD Sections 1 & 10</p>
                    </div>
                    <button type="button" onclick="window.KylrxBusinessUnitController.closeBuModal()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #64748b;">
                        &times;
                    </button>
                </div>

                <form id="buModalForm" onsubmit="event.preventDefault(); window.KylrxBusinessUnitController.handleModalSubmit();">
                    <input type="hidden" id="buModalIsEdit" value="false">

                    <!-- Field 1: Business_Unit_Code -->
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 4px;">
                            1. Business Unit Code (Business_Unit_Code) *
                        </label>
                        <input type="text" id="buModalCode" required placeholder="e.g. BU_CORP_01 or BU-TECH" 
                            style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-family: monospace; font-size: 0.9rem; font-weight: 700; text-transform: uppercase; outline: none; box-sizing: border-box;"
                        />
                        <span style="font-size: 0.7rem; color: #94a3b8; margin-top: 2px; display: block;">Primary document key under organizations/{orgId}/business_units</span>
                    </div>

                    <!-- Field 2: Business_Unit_Name -->
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 4px;">
                            2. Business Unit Name (Business_Unit_Name) *
                        </label>
                        <input type="text" id="buModalName" required placeholder="e.g. Corporate Operations" 
                            style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-size: 0.9rem; outline: none; box-sizing: border-box;"
                        />
                    </div>

                    <!-- Field 3: Head_Employee_ID with Dynamic Head Selection -->
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 4px;">
                            3. BU Head (Head_Employee_ID)
                        </label>
                        <select id="buModalHeadSelect" 
                            style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-size: 0.88rem; outline: none; background: white; box-sizing: border-box;"
                        >
                            <option value="">-- Select Active Employee as BU Head --</option>
                        </select>
                        <span style="font-size: 0.7rem; color: #94a3b8; margin-top: 2px; display: block;">Dynamic search dropdown showing Employee ID and Full Name</span>
                    </div>

                    <!-- Field 4: Active Status -->
                    <div style="margin-bottom: 1.25rem;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 4px;">
                            4. Active Status (Active: Yes / No) *
                        </label>
                        <select id="buModalActive" 
                            style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid #cbd5e1; font-size: 0.88rem; outline: none; background: white; box-sizing: border-box;"
                        >
                            <option value="true" selected>Yes - Active (Unit eligible in onboarding)</option>
                            <option value="false">No - Inactive (Blocked from new onboarding)</option>
                        </select>
                    </div>

                    <!-- PRD §10: Permitted Employee Types -->
                    <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 12px 16px; border-radius: 14px; border: 1px solid #e2e8f0;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 8px;">
                            Permitted Employee Types (PRD Section 10)
                        </label>
                        <div id="buModalTypesContainer" style="display: flex; flex-wrap: wrap; gap: 8px;">
                            <!-- Checkbox pills populated dynamically -->
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button type="button" onclick="window.KylrxBusinessUnitController.closeBuModal()" class="btn btn-outline" style="padding: 10px 18px; border-radius: 10px; font-weight: 600; border: 1px solid #cbd5e1; background: #f8fafc; cursor: pointer;">
                            Cancel
                        </button>
                        <button type="submit" id="btnBuModalSave" class="btn btn-primary" style="padding: 10px 22px; border-radius: 10px; font-weight: 700; background: #2563eb; color: white; border: none; cursor: pointer;">
                            Save Business Unit
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modalDiv);
    }

    /**
     * Opens the Add/Edit Business Unit Modal
     */
    async function openBuModal(buCode = null) {
        ensureBuModalInDom();
        const modal = document.getElementById('buEditModal');
        if (!modal) return;

        // Ensure active employees loaded for dynamic head dropdown
        await fetchActiveEmployees();

        const titleEl = document.getElementById('buModalTitle');
        const codeInput = document.getElementById('buModalCode');
        const nameInput = document.getElementById('buModalName');
        const headSelect = document.getElementById('buModalHeadSelect');
        const activeSelect = document.getElementById('buModalActive');
        const typesContainer = document.getElementById('buModalTypesContainer');
        const isEditInput = document.getElementById('buModalIsEdit');

        // Populate dynamic head dropdown
        headSelect.innerHTML = '<option value="">-- None / Unassigned --</option>';
        activeEmployeesCache.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.employeeId;
            opt.textContent = `${emp.employeeId} - ${emp.fullName} (${emp.role || emp.department || 'Staff'})`;
            headSelect.appendChild(opt);
        });

        const isEdit = Boolean(buCode);
        isEditInput.value = isEdit ? 'true' : 'false';

        let targetBu = null;
        if (isEdit) {
            targetBu = getBusinessUnit(buCode);
            titleEl.textContent = `Edit Business Unit: ${buCode}`;
            codeInput.value = targetBu?.businessUnitCode || buCode;
            codeInput.disabled = true; // primary key immutable on edit
            nameInput.value = targetBu?.businessUnitName || '';
            headSelect.value = targetBu?.headEmployeeId || '';
            activeSelect.value = targetBu?.isActive ? 'true' : 'false';
        } else {
            titleEl.textContent = 'Add New Business Unit';
            codeInput.value = '';
            codeInput.disabled = false;
            nameInput.value = '';
            headSelect.value = '';
            activeSelect.value = 'true';
        }

        // Render employee type checkbox pills
        const allowedTypes = (targetBu?.allowedEmployeeTypes || ['FULL_TIME', 'CONTRACT']).map(t => t.toUpperCase());
        const canonicalTypes = CANONICAL_EMPLOYEE_TYPES.filter(t => t.code !== 'CONTRACTOR');

        typesContainer.innerHTML = canonicalTypes.map(t => {
            const isChecked = allowedTypes.includes(t.code) || (t.code === 'CONTRACT' && allowedTypes.includes('CONTRACTOR'));
            return `
                <label style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer; background: ${isChecked ? '#dbeafe' : 'white'}; color: ${isChecked ? '#1d4ed8' : '#64748b'}; border: 1.5px solid ${isChecked ? '#93c5fd' : '#cbd5e1'};">
                    <input type="checkbox" name="buModalTypeCheckbox" value="${t.code}" ${isChecked ? 'checked' : ''} 
                        onchange="this.parentElement.style.background = this.checked ? '#dbeafe' : 'white'; this.parentElement.style.color = this.checked ? '#1d4ed8' : '#64748b'; this.parentElement.style.borderColor = this.checked ? '#93c5fd' : '#cbd5e1';"
                    />
                    <span>${t.name}</span>
                </label>
            `;
        }).join('');

        modal.style.display = 'flex';
    }

    function closeBuModal() {
        const modal = document.getElementById('buEditModal');
        if (modal) modal.style.display = 'none';
    }

    /**
     * Handles modal form submission
     */
    async function handleModalSubmit() {
        const codeInput = document.getElementById('buModalCode');
        const nameInput = document.getElementById('buModalName');
        const headSelect = document.getElementById('buModalHeadSelect');
        const activeSelect = document.getElementById('buModalActive');
        const checkedTypes = Array.from(document.querySelectorAll('input[name="buModalTypeCheckbox"]:checked')).map(cb => cb.value);

        const buCode = codeInput.value.trim().toUpperCase().replace(/\s+/g, '_');
        const buName = nameInput.value.trim();
        const headId = headSelect.value.trim().toUpperCase();
        const isActive = activeSelect.value === 'true';

        if (!buCode || !buName) {
            alert('Business Unit Code and Name are required.');
            return;
        }

        const headName = getEmployeeNameById(headId);

        try {
            await createBusinessUnit({
                businessUnitCode: buCode,
                businessUnitName: buName,
                headEmployeeId: headId,
                headEmployeeName: headName,
                isActive: isActive,
                allowedEmployeeTypes: checkedTypes.length > 0 ? checkedTypes : ['FULL_TIME', 'CONTRACT']
            });

            closeBuModal();

            // Refresh UI tables
            if (document.getElementById('settingsBuRulesContainer')) {
                renderAdminConsole('settingsBuRulesContainer');
            }
            if (document.getElementById('buRulesTableContainer')) {
                renderAdminConsole('buRulesTableContainer');
            }

            if (typeof window.showToast === 'function') {
                window.showToast(`Business Unit ${buCode} saved successfully!`, 'success');
            } else {
                alert(`Business Unit ${buCode} saved successfully!`);
            }
        } catch (err) {
            alert(`Error saving Business Unit: ${err.message}`);
        }
    }

    function handleTypeToggle(buCode, empTypeCode, isChecked) {
        const bu = businessUnitsMap.get(buCode.toUpperCase());
        if (!bu) return;

        let allowed = (bu.allowedEmployeeTypes || []).map(t => t.toUpperCase());
        if (isChecked) {
            if (!allowed.includes(empTypeCode)) allowed.push(empTypeCode);
            if (empTypeCode === 'CONTRACT' && !allowed.includes('CONTRACTOR')) allowed.push('CONTRACTOR');
        } else {
            allowed = allowed.filter(t => t !== empTypeCode);
            if (empTypeCode === 'CONTRACT') allowed = allowed.filter(t => t !== 'CONTRACTOR');
        }
        bu.allowedEmployeeTypes = allowed;

        // Visual pill toggle
        const pill = document.querySelector(`input[data-bu="${buCode}"][data-type="${empTypeCode}"]`)?.closest('.bu-type-pill');
        if (pill) {
            if (isChecked) {
                pill.classList.add('active');
                pill.style.background = '#dbeafe';
                pill.style.color = '#1d4ed8';
                pill.style.borderColor = '#93c5fd';
                const icon = pill.querySelector('i');
                if (icon) icon.className = 'fas fa-check-circle';
            } else {
                pill.classList.remove('active');
                pill.style.background = '#f1f5f9';
                pill.style.color = '#64748b';
                pill.style.borderColor = '#cbd5e1';
                const icon = pill.querySelector('i');
                if (icon) icon.className = 'fas fa-circle';
            }
        }
    }

    async function toggleActiveStatus(buCode) {
        const bu = businessUnitsMap.get(buCode.toUpperCase());
        if (!bu) return;

        try {
            await toggleBusinessUnitStatus(buCode, !bu.isActive);
            if (document.getElementById('settingsBuRulesContainer')) {
                renderAdminConsole('settingsBuRulesContainer');
            }
            if (document.getElementById('buRulesTableContainer')) {
                renderAdminConsole('buRulesTableContainer');
            }
        } catch (err) {
            alert(`Failed to toggle status: ${err.message}`);
        }
    }

    async function saveSingleRule(buCode) {
        const bu = businessUnitsMap.get(buCode.toUpperCase());
        if (!bu) return;

        try {
            await createBusinessUnit(bu);
            if (typeof window.showToast === 'function') {
                window.showToast(`Saved ${bu.businessUnitName} (${buCode})`, 'success');
            } else {
                alert(`Saved ${bu.businessUnitName}`);
            }
        } catch (err) {
            alert(`Failed to save: ${err.message}`);
        }
    }

    async function saveAllRules() {
        const units = Array.from(businessUnitsMap.values());
        let count = 0;
        for (const u of units) {
            await createBusinessUnit(u);
            count++;
        }
        if (typeof window.showToast === 'function') {
            window.showToast(`All ${count} Business Units saved to Cloud Firestore!`, 'success');
        } else {
            alert(`All ${count} Business Units saved to Cloud Firestore!`);
        }
    }

    // Auto-load on complete
    if (typeof window !== 'undefined') {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            loadBusinessUnitsFromFirestore();
            fetchActiveEmployees();
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                loadBusinessUnitsFromFirestore();
                fetchActiveEmployees();
            });
        }
    }

    function getFirestorePath(businessUnitCode, orgId = getDefaultOrgId()) {
        const buCode = String(businessUnitCode || '').trim().toUpperCase();
        return `organizations/${orgId}/business_units/${buCode}`;
    }

    return {
        CANONICAL_EMPLOYEE_TYPES,
        DEFAULT_BUSINESS_UNITS,
        getFirestorePath,
        loadBusinessUnitsFromFirestore,
        getAllBusinessUnits,
        getBusinessUnit,
        getEmployeeTypes,
        getAllowedBusinessUnits,
        isCombinationValid,
        createBusinessUnit,
        updateBusinessUnit,
        toggleBusinessUnitStatus,
        deleteBusinessUnit,
        bulkImportBusinessUnits,
        fetchActiveEmployees,
        bindEmployeeTypeAndBuGating,
        renderAdminConsole,
        renderAdminRulesTable: renderAdminConsole, // Alias for backward compatibility
        openBuModal,
        closeBuModal,
        handleModalSubmit,
        handleTypeToggle,
        toggleActiveStatus,
        saveSingleRule,
        saveAllRules
    };
}));
