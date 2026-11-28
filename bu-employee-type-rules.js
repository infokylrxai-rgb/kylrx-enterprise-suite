/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - BUSINESS UNIT SCHEMA & RULES ENGINE (PRD §1 & §10)
 * ============================================================================
 * 
 * Exact Schema & Field Mapping (Strict 4 Attributes):
 * - Business_Unit_Code (string, unique PK / document ID)
 * - Business_Unit_Name (string, display title)
 * - Head_Employee_ID (string, reference to employee ID of BU head)
 * - Active (boolean: true for "Yes", false for "No")
 * 
 * Cloud Firestore Data Architecture:
 * - Primary Path: organizations/{orgId}/business_units/{businessUnitCode}
 * - The old bu_employee_type_rules collection is no longer read or written.
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
 * @version 2.1.0
 * @author Senior Frontend & Firebase Developer
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const inst = factory();
        root.KylrxBuRules = inst;
        root.KylrxBusinessUnitController = inst;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Strict 4 Attributes Definition matching PRD & 'Business Unit' Sheet
    const BUSINESS_UNIT_ATTRIBUTES = [
        { key: "Business_Unit_Code", targetKey: "businessUnitCode", label: "Business Unit Code", required: true, isPrimaryKey: true },
        { key: "Business_Unit_Name", targetKey: "businessUnitName", label: "Business Unit Name", required: true },
        { key: "Head_Employee_ID", targetKey: "headEmployeeId", label: "Head Employee ID", required: false },
        { key: "Active", targetKey: "isActive", label: "Active Status", required: false, defaultValue: true }
    ];

    // Canonical Employee Types aligned with PRD Section 10 & Templates.xlsx
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
        },
        {
            code: 'CAT_FT_REG',
            name: 'Full-Time Regular',
            categoryCode: 'CAT_FT_REG',
            employmentType: 'Permanent',
            workerType: 'White Collar',
            badgeClass: 'badge-fulltime'
        },
        {
            code: 'CAT_FT_EXEC',
            name: 'Executive Leadership',
            categoryCode: 'CAT_FT_EXEC',
            employmentType: 'Permanent',
            workerType: 'White Collar',
            badgeClass: 'badge-executive'
        },
        {
            code: 'CAT_CON_TVC',
            name: 'Contractor / TVC',
            categoryCode: 'CAT_CON_TVC',
            employmentType: 'Contract',
            workerType: 'Off-Roll',
            badgeClass: 'badge-contractor'
        },
        {
            code: 'CAT_INT_GRAD',
            name: 'Graduate Intern / Apprentice',
            categoryCode: 'CAT_INT_GRAD',
            employmentType: 'Intern',
            workerType: 'On-Roll',
            badgeClass: 'badge-intern'
        },
        {
            code: 'CAT_TEMP_OPS',
            name: 'Temporary & Seasonal Staff',
            categoryCode: 'CAT_TEMP_OPS',
            employmentType: 'Temporary',
            workerType: 'Blue Collar',
            badgeClass: 'badge-contractor'
        },
        {
            code: 'CAT_PLANT_WKR',
            name: 'Plant & Manufacturing Operative',
            categoryCode: 'CAT_PLANT_WKR',
            employmentType: 'Permanent',
            workerType: 'Blue Collar',
            badgeClass: 'badge-fulltime'
        }
    ];

    // Default Business Units matching Templates.xlsx 'Business Unit' Sheet & PRD §10
    const DEFAULT_BU_RULES = [
        {
            businessUnitCode: 'BU_ENG',
            businessUnitName: 'Core Engineering & Technology',
            allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACT', 'CONTRACTOR'],
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Ananya Roy',
            isActive: true
        },
        {
            businessUnitCode: 'BU-TECH',
            businessUnitName: 'Technology & Product Engineering',
            allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACT', 'CONTRACTOR'],
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Ananya Roy',
            isActive: true
        },
        {
            businessUnitCode: 'BU-OPS',
            businessUnitName: 'Global Operations & Customer Success',
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONTRACTOR'],
            headEmployeeId: 'EMP0002',
            headEmployeeName: 'Rajesh Sharma',
            isActive: true
        },
        {
            businessUnitCode: 'BU-CORP',
            businessUnitName: 'Corporate Finance & HR',
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONSULTANT'],
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            isActive: true
        },
        {
            businessUnitCode: 'BU_CORP_01',
            businessUnitName: 'Corporate Operations',
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT'],
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            isActive: true
        },
        {
            businessUnitCode: 'BU-EXEC',
            businessUnitName: 'Executive Leadership & Strategy',
            allowedEmployeeTypes: ['EXECUTIVE', 'FULL_TIME'],
            headEmployeeId: 'EMP0004',
            headEmployeeName: 'Vikram Malhotra',
            isActive: true
        },
        {
            businessUnitCode: 'BU-SALES',
            businessUnitName: 'Enterprise Sales & Partnerships',
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONTRACTOR', 'CONSULTANT'],
            headEmployeeId: 'EMP0005',
            headEmployeeName: 'Priya Nair',
            isActive: true
        }
    ];

    // Canonical active employee directory for dynamic Head Selection
    const CANONICAL_ACTIVE_EMPLOYEES = [
        { employeeId: 'EMP0001', fullName: 'Ananya Roy', email: 'ananya.roy@kylrx.ai', role: 'Engineering Director', department: 'Core Engineering' },
        { employeeId: 'EMP0002', fullName: 'Rajesh Sharma', email: 'rajesh.sharma@kylrx.ai', role: 'Operations Head', department: 'Global Operations' },
        { employeeId: 'EMP0003', fullName: 'Ananya Roy', email: 'ananya.roy.corp@kylrx.ai', role: 'Head of Corporate Operations', department: 'Corporate Operations' },
        { employeeId: 'EMP0004', fullName: 'Vikram Malhotra', email: 'vikram.m@kylrx.ai', role: 'Chief Executive Officer', department: 'Executive' },
        { employeeId: 'EMP0005', fullName: 'Priya Nair', email: 'priya.nair@kylrx.ai', role: 'VP Enterprise Sales', department: 'Enterprise Sales' },
        { employeeId: 'EMP0006', fullName: 'John Doe', email: 'john.doe@example.com', role: 'Engineering Manager', department: 'Engineering' },
        { employeeId: 'EMP0007', fullName: 'Marry Doe', email: 'marry@gmail.com', role: 'Software Engineer', department: 'Engineering' }
    ];

    // In-memory cache of rules/business units
    const currentRules = new Map();
    // Starts empty. It used to start as CANONICAL_ACTIVE_EMPLOYEES and keep that list
    // whenever an organisation had nobody yet, so a new customer's Business Unit Head
    // picker offered seven invented people - and choosing one made a person who does not
    // exist the head of a real business unit.
    let activeEmployeesCache = [];
    let isInitialized = false;

    const NO_ORG_MESSAGE = 'Your account has no organization';
    let loadError = null;

    async function getFirebase() {
        return await import('./firebase-config.js').catch(() => null) ||
               (typeof window !== 'undefined' && window.KylrxFirebase) || null;
    }

    /** { fb, orgId } from the verified token claims (firebase-config.js tenantReady); throws NO_ORG_MESSAGE without one */
    async function resolveOrg() {
        const fb = await getFirebase();
        if (!fb || !fb.tenantReady || !fb.getActiveOrgId) throw new Error(NO_ORG_MESSAGE);
        await fb.tenantReady;
        const orgId = fb.getActiveOrgId();
        if (!orgId) throw new Error(NO_ORG_MESSAGE);
        return { fb, orgId };
    }

    /** Authorization header for the backend API, from the signed-in Firebase user only */
    async function apiHeaders() {
        const user = typeof window !== 'undefined' && window.auth && window.auth.currentUser;
        if (!user) throw new Error('You are signed out. Please sign in again.');
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user.getIdToken()}` };
    }

    function initDefaultRules() {
        if (currentRules.size === 0) {
            DEFAULT_BU_RULES.forEach(r => {
                const code = r.businessUnitCode.toUpperCase();
                currentRules.set(code, {
                    ruleId: `rule_${code.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                    businessUnitCode: code,
                    businessUnitName: r.businessUnitName,
                    headEmployeeId: r.headEmployeeId || '',
                    headEmployeeName: r.headEmployeeName || resolveEmployeeName(r.headEmployeeId),
                    allowedEmployeeTypes: [...r.allowedEmployeeTypes],
                    isActive: r.isActive !== false,
                    isSeed: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            });
        }
    }
    // initDefaultRules() is no longer run on load. It filled the list with five sample
    // business units that stayed on screen for any organisation without its own, as if
    // they were that organisation's. The samples stay exported as DEFAULT_BU_RULES.

    function resolveEmployeeName(empId) {
        if (!empId) return '';
        const clean = String(empId).trim().toUpperCase();
        const found = activeEmployeesCache.find(e => (e.employeeId || e.id || '').toUpperCase() === clean);
        return found ? (found.fullName || found.name || clean) : clean;
    }

    function getBuRulesApiUrl() {
        if (typeof window === 'undefined' || !window.location) {
            return `${typeof API_BASE !== 'undefined' ? API_BASE : (typeof window !== 'undefined' && window.API_BASE ? window.API_BASE : (typeof window !== 'undefined' && window.location ? window.location.origin : ''))}/api/admin/bu-rules`;
        }
        const port = window.location.port;
        // On port 3000 (direct Express) or port 5500/5501 (reverse proxy), use relative path
        if (port === '3000' || port === '5500' || port === '5501') {
            return '/api/admin/bu-rules';
        }
        const host = window.location.hostname || 'localhost';
        return `http://${host}:3000/api/admin/bu-rules`;
    }

    /**
     * Fetches active employees from Firestore users/employees collections
     * for dynamic Head Selection search dropdown.
     */
    async function fetchActiveEmployees() {
        try {
            const { fb, orgId } = await resolveOrg();

            if (fb.db && fb.collection && fb.getDocs && fb.query && fb.where) {
                const loaded = [];

                try {
                    const snap = await fb.getDocs(fb.query(fb.collection(fb.db, 'users'), fb.where('orgId', '==', orgId)));
                    if (!snap.empty) {
                        snap.forEach(docSnap => {
                            const d = docSnap.data();
                            const empId = d.employeeId || d.id || docSnap.id;
                            const isTerminated = d.status === 'Terminated' || d.status === 'Trash';
                            if (empId && !isTerminated) {
                                loaded.push({
                                    employeeId: empId,
                                    fullName: d.fullName || d.name || d.displayName || empId,
                                    email: d.email || d.officialEmail || '',
                                    department: d.department || d.departmentName || '',
                                    role: d.role || d.designation || 'Staff'
                                });
                            }
                        });
                    }
                } catch (err) {
                    console.warn('[BURules] Could not read the employees of this organization:', err.message);
                }

                // only this organization's people, even when that is nobody yet
                activeEmployeesCache = loaded;
            }
        } catch (err) {
            console.warn('[BURules] Employee list fetch notice:', err.message);
        }

        return [...activeEmployeesCache];
    }

    /**
     * Fetch the organization's business units from Cloud Firestore: organizations/{orgId}/business_units.
     * Rejects when the organization is unknown or the read fails (the cause is also kept in getLoadError()).
     */
    async function loadRulesFromFirestore() {
        try {
            const { fb, orgId } = await resolveOrg();
            const buSnap = await fb.getDocs(fb.collection(fb.db, 'organizations', orgId, 'business_units'));
            // Cleared even when the organisation has none, so nothing left over is shown as theirs.
            currentRules.clear();
            if (!buSnap.empty) {
                buSnap.forEach(docSnap => {
                    const data = docSnap.data();
                    const buCode = (data.businessUnitCode || docSnap.id).toUpperCase();
                    currentRules.set(buCode, {
                        ruleId: `rule_${buCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                        businessUnitCode: buCode,
                        businessUnitName: data.businessUnitName || buCode,
                        headEmployeeId: data.headEmployeeId || '',
                        headEmployeeName: data.headEmployeeName || resolveEmployeeName(data.headEmployeeId),
                        allowedEmployeeTypes: Array.isArray(data.allowedEmployeeTypes) ? data.allowedEmployeeTypes : ['FULL_TIME', 'CONTRACT'],
                        isActive: data.isActive !== false,
                        createdAt: data.createdAt || null,
                        updatedAt: data.updatedAt || null
                    });
                });
                console.log(`[BURules] Loaded ${currentRules.size} business units from organizations/${orgId}/business_units`);
            }
            loadError = null;
        } catch (err) {
            loadError = err;
            throw err;
        } finally {
            isInitialized = true;
            dispatchRulesUpdatedEvent();
        }
        return Array.from(currentRules.values());
    }

    function getLoadError() {
        return loadError;
    }

    function dispatchRulesUpdatedEvent() {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            const list = Array.from(currentRules.values());
            window.dispatchEvent(new CustomEvent('buRulesUpdated', {
                detail: { rules: list }
            }));
            window.dispatchEvent(new CustomEvent('businessUnitsUpdated', {
                detail: { businessUnits: list }
            }));
        }
    }

    /**
     * Get all currently configured rules / business units
     */
    function getAllRules(includeInactive = true) {
        const list = Array.from(currentRules.values());
        if (includeInactive) return list;
        return list.filter(r => r.isActive !== false);
    }

    const getAllBusinessUnits = getAllRules;

    /**
     * Get rule / business unit by code
     */
    function getRuleByCode(buCode) {
        if (!buCode) return null;
        return currentRules.get(String(buCode).trim().toUpperCase()) || null;
    }

    const getBusinessUnit = getRuleByCode;

    /**
     * Get all supported canonical employee types
     */
    function getEmployeeTypes() {
        return [...CANONICAL_EMPLOYEE_TYPES];
    }

    /**
     * Returns list of business units allowed for a selected employee type
     * Strict check: ONLY units with isActive === true and allowedEmployeeTypes containing type.
     */
    /**
     * Resolves synonym and category code mappings for Employee Types
     */
    function resolveEmployeeTypeSynonyms(type) {
        if (!type) return [];
        const norm = String(type).trim().toUpperCase().replace(/\s+/g, '_');
        const set = new Set([norm]);
        if (norm === 'CONTRACT' || norm === 'CONTRACTOR' || norm === 'CAT_CON_TVC' || norm === 'CAT_CON') {
            set.add('CONTRACT');
            set.add('CONTRACTOR');
            set.add('CAT_CON_TVC');
            set.add('CAT_CON');
        }
        if (norm === 'FULL_TIME' || norm === 'PERMANENT' || norm === 'CAT_FT_REG' || norm === 'CAT_FT') {
            set.add('FULL_TIME');
            set.add('PERMANENT');
            set.add('CAT_FT_REG');
            set.add('CAT_FT');
        }
        if (norm === 'EXECUTIVE' || norm === 'CAT_FT_EXEC' || norm === 'CAT_EXE') {
            set.add('EXECUTIVE');
            set.add('CAT_FT_EXEC');
            set.add('CAT_EXE');
        }
        if (norm === 'INTERN' || norm === 'APPRENTICE' || norm === 'CAT_INT_GRAD' || norm === 'CAT_INT') {
            set.add('INTERN');
            set.add('APPRENTICE');
            set.add('CAT_INT_GRAD');
            set.add('CAT_INT');
        }
        if (norm === 'TEMPORARY' || norm === 'CASUAL' || norm === 'CAT_TEMP_OPS' || norm === 'CAT_TEMP') {
            set.add('TEMPORARY');
            set.add('CAT_TEMP_OPS');
            set.add('CAT_TEMP');
            set.add('CONTRACT');
        }
        if (norm === 'BLUE_COLLAR' || norm === 'PLANT' || norm === 'CAT_PLANT_WKR') {
            set.add('BLUE_COLLAR');
            set.add('PLANT');
            set.add('CAT_PLANT_WKR');
            set.add('FULL_TIME');
        }
        return Array.from(set);
    }

    function getAllowedBusinessUnits(employeeType) {
        const activeUnits = getAllRules(false); // active only
        if (!employeeType) return activeUnits;

        const checkTypes = resolveEmployeeTypeSynonyms(employeeType);

        return activeUnits.filter(r => {
            const allowed = (r.allowedEmployeeTypes || []).map(t => String(t).toUpperCase());
            if (allowed.includes('ALL') || allowed.includes('*')) return true;
            return checkTypes.some(t => allowed.includes(t));
        });
    }

    /**
     * Check if a combination of BU and Employee Type is valid
     */
    function isCombinationValid(buCode, employeeType) {
        if (!buCode || !employeeType) {
            return { valid: false, error: 'Both Business Unit and Employee Type are required.' };
        }
        const normalizedBU = String(buCode).trim().toUpperCase();

        const rule = currentRules.get(normalizedBU);
        if (!rule) {
            return {
                valid: false,
                error: `Business Unit '${buCode}' is not mapped in organizational rules.`
            };
        }

        if (rule.isActive === false) {
            return {
                valid: false,
                error: `Business Unit '${rule.businessUnitName}' (${buCode}) is deactivated.`
            };
        }

        const allowed = (rule.allowedEmployeeTypes || []).map(t => String(t).toUpperCase());
        const checkTypes = resolveEmployeeTypeSynonyms(employeeType);

        const isAllowed = allowed.includes('ALL') || allowed.includes('*') || checkTypes.some(t => allowed.includes(t));
        if (!isAllowed) {
            const allowedLabels = allowed.map(t => {
                const found = CANONICAL_EMPLOYEE_TYPES.find(c => c.code === t);
                return found ? found.name : t;
            }).join(', ');

            return {
                valid: false,
                error: `Business Unit '${rule.businessUnitName}' (${buCode}) does not permit '${employeeType}'. Allowed employee types: ${allowedLabels || 'None'}.`
            };
        }

        return { valid: true };
    }

    /**
     * Save/Create a Business Unit Rule to Cloud Firestore (both primary and legacy path)
     */
    async function saveRule(ruleData, actor = 'Super Admin') {
        const rawCode = ruleData.businessUnitCode || ruleData.Business_Unit_Code || ruleData.code;
        const rawName = ruleData.businessUnitName || ruleData.Business_Unit_Name || ruleData.name;
        const rawHead = ruleData.headEmployeeId || ruleData.Head_Employee_ID || ruleData.headId || '';
        const rawActive = ruleData.isActive !== undefined ? ruleData.isActive : (ruleData.Active !== undefined ? ruleData.Active : true);

        if (!rawCode || String(rawCode).trim() === '') {
            throw new Error('Business Unit Code (Business_Unit_Code) is required.');
        }
        if (!rawName || String(rawName).trim() === '') {
            throw new Error('Business Unit Name (Business_Unit_Name) is required.');
        }

        const buCode = String(rawCode).trim().toUpperCase().replace(/\s+/g, '_');
        const buName = String(rawName).trim();
        const headId = String(rawHead || '').trim().toUpperCase();
        const headName = ruleData.headEmployeeName || resolveEmployeeName(headId);
        const isActive = typeof rawActive === 'boolean' 
            ? rawActive 
            : (String(rawActive).toLowerCase() === 'yes' || String(rawActive).toLowerCase() === 'true');

        const ruleId = ruleData.ruleId || `rule_${buCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        let allowedTypes = Array.isArray(ruleData.allowedEmployeeTypes) && ruleData.allowedEmployeeTypes.length > 0
            ? ruleData.allowedEmployeeTypes.map(t => String(t).trim().toUpperCase())
            : ['FULL_TIME', 'CONTRACT'];

        if (allowedTypes.includes('CONTRACT') && !allowedTypes.includes('CONTRACTOR')) {
            allowedTypes.push('CONTRACTOR');
        }

        const existing = currentRules.get(buCode) || {};
        const record = {
            ruleId,
            businessUnitCode: buCode,
            businessUnitName: buName || existing.businessUnitName || buCode,
            headEmployeeId: headId || existing.headEmployeeId || '',
            headEmployeeName: headName || existing.headEmployeeName || '',
            allowedEmployeeTypes: allowedTypes,
            isActive: isActive,
            createdAt: existing.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            updatedBy: actor
        };

        const { fb, orgId } = await resolveOrg();
        if (!fb.db || !fb.doc || !fb.setDoc) throw new Error('The database is not available. Reload the page and try again.');
        record.orgId = orgId;

        // 1. Firestore: organizations/{orgId}/business_units/{buCode}
        const docRef = fb.doc(fb.db, 'organizations', orgId, 'business_units', buCode);
        await fb.setDoc(docRef, {
            ...record,
            updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : record.updatedAt
        }, { merge: true });

        // 2. Backend API (validation rules used when onboarding); if it fails the Firestore write is undone
        try {
            const res = await fetch(getBuRulesApiUrl(), { method: 'POST', headers: await apiHeaders(), body: JSON.stringify(record) });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || body.message || `The server rejected the save (HTTP ${res.status}).`);
            }
        } catch (err) {
            let undone = '';
            try {
                if (existing.createdAt && !existing.isSeed) await fb.setDoc(docRef, { ...existing, orgId }, { merge: true });
                else await fb.deleteDoc(docRef);
            } catch (_) {
                undone = ' The earlier database write could not be undone: reload and check the Business Unit.';
            }
            throw new Error(`${err.message}${undone}`);
        }

        // 3. Everything succeeded: update the memory cache
        currentRules.set(buCode, record);
        dispatchRulesUpdatedEvent();
        return record;
    }

    const createBusinessUnit = saveRule;

    /**
     * UPDATE an existing Business Unit
     */
    async function updateBusinessUnit(businessUnitCode, updateData, actor = 'Super Admin') {
        const buCode = String(businessUnitCode).trim().toUpperCase();
        const existing = currentRules.get(buCode) || {};
        const merged = { ...existing, ...updateData, businessUnitCode: buCode };
        return await saveRule(merged, actor);
    }

    /**
     * TOGGLE Active status of a Business Unit
     */
    async function toggleBusinessUnitStatus(businessUnitCode, isActive) {
        const buCode = String(businessUnitCode).trim().toUpperCase();
        const existing = currentRules.get(buCode);
        if (!existing) throw new Error(`Business Unit '${businessUnitCode}' not found.`);

        const targetStatus = typeof isActive === 'boolean' ? isActive : !existing.isActive;
        return await updateBusinessUnit(buCode, { isActive: targetStatus });
    }

    /**
     * DELETE a Business Unit
     */
    async function deleteBusinessUnit(businessUnitCode) {
        const buCode = String(businessUnitCode).trim().toUpperCase();
        const { fb, orgId } = await resolveOrg();
        await fb.deleteDoc(fb.doc(fb.db, 'organizations', orgId, 'business_units', buCode));

        currentRules.delete(buCode);
        dispatchRulesUpdatedEvent();
        return { success: true, businessUnitCode: buCode };
    }

    /**
     * BULK IMPORT Business Units from parsed sheet/CSV
     */
    async function bulkImportBusinessUnits(list) {
        if (!Array.isArray(list) || list.length === 0) {
            throw new Error('No business unit records provided for ingestion.');
        }

        const results = [];
        const errors = [];

        for (const item of list) {
            try {
                const saved = await saveRule(item);
                results.push(saved);
            } catch (err) {
                errors.push({ code: item.businessUnitCode || item.Business_Unit_Code, error: err.message });
            }
        }

        return {
            total: list.length,
            successCount: results.length,
            errorCount: errors.length,
            imported: results,
            errors
        };
    }

    /**
     * Real-time Client-side Form Binding Script (PRD Section 10)
     * Connects an Employee Type `<select>` with a Business Unit `<select>`.
     * Dynamically filters Business Unit choices so that ONLY active ('Active' == 'Yes')
     * and eligible units are displayed for the selected employee type.
     * Blocks or disables invalid selections automatically.
     */
    function bindEmployeeTypeAndBuGating(empTypeSelect, buSelect, options = {}) {
        if (!empTypeSelect || !buSelect) return;

        const noticeContainerId = options.noticeContainerId || 'buMismatchNotice';
        let noticeEl = document.getElementById(noticeContainerId);

        // Ensure inline notice element exists
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

        function showGentleNotice(message) {
            if (!noticeEl) return;
            noticeEl.innerHTML = `<i class="fas fa-info-circle" style="margin-right: 4px;"></i> ${message}`;
            noticeEl.style.display = 'block';
            noticeEl.style.opacity = '1';

            setTimeout(() => {
                if (noticeEl) {
                    noticeEl.style.opacity = '0';
                    setTimeout(() => { if (noticeEl) noticeEl.style.display = 'none'; }, 300);
                }
            }, 5000);
        }

        function filterBuDropdown() {
            const selectedType = (empTypeSelect.value || '').trim().toUpperCase();
            const currentSelectedBU = (buSelect.value || '').trim().toUpperCase();

            // Strict filter: active units only
            const allowedBUs = getAllowedBusinessUnits(selectedType);
            const allowedCodes = allowedBUs.map(b => b.businessUnitCode.toUpperCase());

            let previousValueStillAllowed = false;

            const placeholderOption = buSelect.options[0] && buSelect.options[0].value === '' 
                ? buSelect.options[0].outerHTML 
                : '<option value="">-- Select Eligible Business Unit --</option>';

            buSelect.innerHTML = placeholderOption;

            allowedBUs.forEach(bu => {
                const opt = document.createElement('option');
                opt.value = bu.businessUnitCode;
                opt.textContent = `${bu.businessUnitCode} - ${bu.businessUnitName}`;
                if (bu.businessUnitCode.toUpperCase() === currentSelectedBU) {
                    opt.selected = true;
                    previousValueStillAllowed = true;
                }
                buSelect.appendChild(opt);
            });

            // Auto-clear invalid selection
            if (currentSelectedBU && !previousValueStillAllowed) {
                buSelect.value = '';
                const typeObj = CANONICAL_EMPLOYEE_TYPES.find(t => t.code === selectedType);
                const typeLabel = typeObj ? typeObj.name : selectedType;
                showGentleNotice(`Previous Business Unit <strong>(${currentSelectedBU})</strong> was cleared as it is not eligible for <strong>${typeLabel}</strong>.`);
            }

            // Enable or disable based on allowed list
            if (allowedBUs.length === 0) {
                buSelect.disabled = true;
                showGentleNotice(`No active Business Units are configured for the selected Employee Type.`);
            } else {
                buSelect.disabled = false;
            }
        }

        empTypeSelect.addEventListener('change', filterBuDropdown);
        window.addEventListener('buRulesUpdated', filterBuDropdown);
        window.addEventListener('businessUnitsUpdated', filterBuDropdown);

        filterBuDropdown();

        return {
            refresh: filterBuDropdown,
            validate: () => isCombinationValid(buSelect.value, empTypeSelect.value)
        };
    }

    /**
     * UI Rendering for Super Admin Configuration Console
     * Includes "Add Business Unit" modal button, dynamic head employee view,
     * status toggle switch, and employee-type pill selectors.
     */
    function renderAdminRulesTable(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const rules = getAllRules(true);
        const types = CANONICAL_EMPLOYEE_TYPES.filter(t => t.code !== 'CONTRACTOR');

        let tableHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.85rem; font-weight: 700; color: var(--k-text-2);">
                        Configured Units: <strong>${rules.length}</strong>
                    </span>
                    <span style="font-size: 0.72rem; background: var(--k-success-soft); color: var(--k-success-text); font-weight: 800; padding: 2px 8px; border-radius: 9999px;">
                        ${rules.filter(r => r.isActive).length} Active
                    </span>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn btn-outline" onclick="window.KylrxBuRules.openBuModal()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-size: 0.82rem; border-radius: 10px; font-weight: 700; border: 1.5px solid var(--k-border); background: var(--k-surface); cursor: pointer;">
                        <i class="fas fa-plus-circle" style="color: var(--k-accent-text);"></i> Add Business Unit
                    </button>
                    <button type="button" class="btn btn-primary" onclick="window.KylrxBuRules.saveAllRules()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 0.82rem; border-radius: 10px; font-weight: 700; background: var(--k-accent); color: white; border: none; cursor: pointer;">
                        <i class="fas fa-save"></i> Save All
                    </button>
                </div>
            </div>

            <div class="bu-rules-list" style="display: flex; flex-direction: column; gap: 12px;">
        `;

        // Two naming schemes exist for the same concepts (FULL_TIME and CAT_FT_REG are both
        // "Full-Time Regular"), so rendering every code showed the same label two or three
        // times. Collapse them by label: one chip, which is on when ANY of its codes is
        // allowed, and which writes the first code when toggled.
        const byLabel = new Map();
        types.forEach(t => {
            const key = String(t.name).trim().toLowerCase();
            if (byLabel.has(key)) byLabel.get(key).aliases.push(t.code);
            else byLabel.set(key, { code: t.code, name: t.name, aliases: [t.code] });
        });
        const uniqueTypes = [...byLabel.values()];

        rules.forEach(rule => {
            const allowed = (rule.allowedEmployeeTypes || []).map(t => String(t).toUpperCase());
            const headName = rule.headEmployeeName || resolveEmployeeName(rule.headEmployeeId);

            const pillsHtml = uniqueTypes.map(t => {
                const isChecked = t.aliases.some(code => allowed.includes(code))
                    || (t.aliases.includes("CONTRACT") && allowed.includes("CONTRACTOR"));
                return `
                    <label class="bu-type-pill ${isChecked ? 'active' : ''}" style="
                        display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border-radius: 9999px;
                        font-size: 0.78rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all .15s;
                        background: ${isChecked ? 'var(--k-accent)' : 'var(--k-surface)'};
                        color: ${isChecked ? 'var(--k-on-accent)' : 'var(--k-text-2)'};
                        border: 1px solid ${isChecked ? 'var(--k-accent)' : 'var(--k-border)'};
                    ">
                        <input type="checkbox" style="display:none;"
                            data-bu="${rule.businessUnitCode}"
                            data-type="${t.code}"
                            ${isChecked ? 'checked' : ''}
                            onchange="window.KylrxBuRules.handleTypeToggle('${rule.businessUnitCode}', '${t.code}', this.checked)"
                        />
                        <span>${isChecked ? '&#10003;' : '&#43;'}</span>
                        <span>${t.name}</span>
                    </label>
                `;
            }).join('');

            // One card per business unit. The old six-column table squeezed ten chips into a
            // narrow cell, so each wrapped onto its own line and the row became a column of
            // stacked pills. A card gives the chips the full width.
            tableHtml += `
                <div id="row_bu_${rule.businessUnitCode}" style="
                    border: 1px solid var(--k-border); border-radius: 14px; background: var(--k-surface); padding: 16px 18px;
                    opacity: ${rule.isActive ? '1' : '0.55'};
                ">
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
                        <div style="min-width: 220px;">
                            <div style="font-size: 1rem; font-weight: 700; color: var(--k-text);">
                                ${rule.businessUnitName}
                            </div>
                            <div style="font-size: 0.78rem; color: var(--k-muted); margin-top: 3px;">
                                <span style="font-family: monospace; font-weight: 700; color: var(--k-accent-text);">${rule.businessUnitCode}</span>
                                &nbsp;&middot;&nbsp; Head: ${headName || 'Unassigned'}
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button type="button"
                                onclick="window.KylrxBuRules.toggleActiveStatus('${rule.businessUnitCode}')"
                                title="Click to turn this business unit on or off"
                                style="cursor: pointer; border: 1px solid ${rule.isActive ? 'var(--k-success-border)' : 'var(--k-border)'};
                                       background: ${rule.isActive ? 'var(--k-success-soft)' : 'var(--k-subtle)'};
                                       color: ${rule.isActive ? 'var(--k-success-text)' : 'var(--k-muted)'};
                                       border-radius: 9999px; padding: 5px 12px; font-size: 0.76rem; font-weight: 700;">
                                ${rule.isActive ? 'Active' : 'Inactive'}
                            </button>
                            <button type="button" class="btn btn-outline" title="Edit this business unit"
                                onclick="window.KylrxBuRules.openBuModal('${rule.businessUnitCode}')"
                                style="padding: 5px 11px; font-size: 0.76rem; border-radius: 8px; border: 1px solid var(--k-border); background:var(--k-surface); color:var(--k-text-2); cursor:pointer;">
                                Edit
                            </button>
                        </div>
                    </div>

                    <div style="margin-top: 14px;">
                        <div style="font-size: 0.74rem; font-weight: 700; color: var(--k-muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px;">
                            Employee types this unit may hire
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                            ${pillsHtml}
                        </div>
                    </div>
                </div>
            `;
        });

        tableHtml += `
            </div>
        `;
        container.innerHTML = tableHtml;
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
            <div class="modal" style="background: var(--k-surface); border-radius: 24px; padding: 2rem; max-width: 580px; width: 92%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); border: 1px solid var(--k-border); position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--k-border); padding-bottom: 1rem; margin-bottom: 1.25rem;">
                    <div>
                        <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--k-text); margin: 0;" id="buModalTitle">Add Business Unit</h2>
                        <p style="font-size: 0.8rem; color: var(--k-muted); margin: 3px 0 0;">Ingest and store business unit matching PRD Sections 1 & 10</p>
                    </div>
                    <button type="button" onclick="window.KylrxBuRules.closeBuModal()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--k-muted);">
                        &times;
                    </button>
                </div>

                <div id="buModalOrgNotice" role="alert" style="display: none; margin-bottom: 1rem; padding: 10px 14px; border-radius: 10px; background: var(--k-danger-soft); color: var(--k-danger-text); border: 1px solid var(--k-danger-border); font-size: 0.85rem; font-weight: 700;"></div>
                <div id="buModalError" role="alert" style="display: none; margin-bottom: 1rem; padding: 10px 14px; border-radius: 10px; background: var(--k-danger-soft); color: var(--k-danger-text); border: 1px solid var(--k-danger-border); font-size: 0.85rem;"></div>

                <form id="buModalForm" onsubmit="event.preventDefault(); window.KylrxBuRules.handleModalSubmit();">
                    <input type="hidden" id="buModalIsEdit" value="false">

                    <!-- Field 1: Business_Unit_Code -->
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase; margin-bottom: 4px;">
                            1. Business Unit Code (Business_Unit_Code) *
                        </label>
                        <input type="text" id="buModalCode" required placeholder="e.g. BU_CORP_01 or BU-TECH" 
                            style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid var(--k-border); font-family: monospace; font-size: 0.9rem; font-weight: 700; text-transform: uppercase; outline: none; box-sizing: border-box;"
                        />
                        <span style="font-size: 0.7rem; color: var(--k-muted); margin-top: 2px; display: block;">Primary document key under organizations/{orgId}/business_units</span>
                    </div>

                    <!-- Field 2: Business_Unit_Name -->
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase; margin-bottom: 4px;">
                            2. Business Unit Name (Business_Unit_Name) *
                        </label>
                        <input type="text" id="buModalName" required placeholder="e.g. Corporate Operations" 
                            style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid var(--k-border); font-size: 0.9rem; outline: none; box-sizing: border-box;"
                        />
                    </div>

                    <!-- Field 3: Head_Employee_ID with Dynamic Head Selection -->
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase; margin-bottom: 4px;">
                            3. BU Head (Head_Employee_ID)
                        </label>
                        <select id="buModalHeadSelect" 
                            style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid var(--k-border); font-size: 0.88rem; outline: none; background: var(--k-surface); box-sizing: border-box;"
                        >
                            <option value="">-- Select Active Employee as BU Head --</option>
                        </select>
                        <span style="font-size: 0.7rem; color: var(--k-muted); margin-top: 2px; display: block;">Dynamic search dropdown displaying Employee ID and Full Name</span>
                    </div>

                    <!-- Field 4: Active Status -->
                    <div style="margin-bottom: 1.25rem;">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase; margin-bottom: 4px;">
                            4. Active Status (Active: Yes / No) *
                        </label>
                        <select id="buModalActive" 
                            style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid var(--k-border); font-size: 0.88rem; outline: none; background: var(--k-surface); box-sizing: border-box;"
                        >
                            <option value="true" selected>Yes - Active (Unit eligible in onboarding)</option>
                            <option value="false">No - Inactive (Blocked from new onboarding)</option>
                        </select>
                    </div>

                    <!-- PRD §10: Permitted Employee Types -->
                    <div style="margin-bottom: 1.5rem; background: var(--k-subtle); padding: 12px 16px; border-radius: 14px; border: 1px solid var(--k-border);">
                        <label style="display: block; font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase; margin-bottom: 8px;">
                            Permitted Employee Types (PRD Section 10)
                        </label>
                        <div id="buModalTypesContainer" style="display: flex; flex-wrap: wrap; gap: 8px;"></div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button type="button" onclick="window.KylrxBuRules.closeBuModal()" class="btn btn-outline" style="padding: 10px 18px; border-radius: 10px; font-weight: 600; border: 1px solid var(--k-border); background: var(--k-subtle); cursor: pointer;">
                            Cancel
                        </button>
                        <button type="submit" id="btnBuModalSave" class="btn btn-primary" style="padding: 10px 22px; border-radius: 10px; font-weight: 700; background: var(--k-accent); color: white; border: none; cursor: pointer;">
                            Save Business Unit
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modalDiv);
    }

    async function openBuModal(buCode = null) {
        ensureBuModalInDom();
        const modal = document.getElementById('buEditModal');
        if (!modal) return;

        showModalError('');
        const saveBtn = document.getElementById('btnBuModalSave');
        const orgNotice = document.getElementById('buModalOrgNotice');
        try {
            await resolveOrg();
            orgNotice.style.display = 'none';
            saveBtn.disabled = false;
        } catch (err) {
            orgNotice.textContent = err.message === NO_ORG_MESSAGE ? NO_ORG_MESSAGE : `Could not check your organization: ${err.message}`;
            orgNotice.style.display = 'block';
            saveBtn.disabled = true;
        }

        await fetchActiveEmployees();

        const titleEl = document.getElementById('buModalTitle');
        const codeInput = document.getElementById('buModalCode');
        const nameInput = document.getElementById('buModalName');
        const headSelect = document.getElementById('buModalHeadSelect');
        const activeSelect = document.getElementById('buModalActive');
        const typesContainer = document.getElementById('buModalTypesContainer');
        const isEditInput = document.getElementById('buModalIsEdit');

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
            targetBu = getRuleByCode(buCode);
            titleEl.textContent = `Edit Business Unit: ${buCode}`;
            codeInput.value = targetBu?.businessUnitCode || buCode;
            codeInput.disabled = true;
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

        const allowedTypes = (targetBu?.allowedEmployeeTypes || ['FULL_TIME', 'CONTRACT']).map(t => t.toUpperCase());
        const canonicalTypes = CANONICAL_EMPLOYEE_TYPES.filter(t => t.code !== 'CONTRACTOR');

        typesContainer.innerHTML = canonicalTypes.map(t => {
            const isChecked = allowedTypes.includes(t.code) || (t.code === 'CONTRACT' && allowedTypes.includes('CONTRACTOR'));
            return `
                <label style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer; background: ${isChecked ? 'var(--k-accent-soft)' : 'var(--k-surface)'}; color: ${isChecked ? 'var(--k-accent-text)' : 'var(--k-muted)'}; border: 1.5px solid ${isChecked ? 'var(--k-accent-border)' : 'var(--k-border)'};">
                    <input type="checkbox" name="buModalTypeCheckbox" value="${t.code}" ${isChecked ? 'checked' : ''} 
                        onchange="this.parentElement.style.background = this.checked ? '#dbeafe' : 'white'; this.parentElement.style.color = this.checked ? '#1d4ed8' : '#64748b'; this.parentElement.style.borderColor = this.checked ? '#93c5fd' : '#cbd5e1';"
                    />
                    <span>${t.name}</span>
                </label>
            `;
        }).join('');

        modal.style.display = 'flex';
    }

    function showModalError(message) {
        const el = document.getElementById('buModalError');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'block' : 'none';
    }

    function closeBuModal() {
        const modal = document.getElementById('buEditModal');
        if (modal) modal.style.display = 'none';
    }

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
            showModalError('Business Unit Code and Name are required.');
            return;
        }

        const headName = resolveEmployeeName(headId);
        const saveBtn = document.getElementById('btnBuModalSave');
        showModalError('');
        if (saveBtn) saveBtn.disabled = true;

        try {
            await saveRule({
                businessUnitCode: buCode,
                businessUnitName: buName,
                headEmployeeId: headId,
                headEmployeeName: headName,
                isActive: isActive,
                allowedEmployeeTypes: checkedTypes.length > 0 ? checkedTypes : ['FULL_TIME', 'CONTRACT']
            });

            closeBuModal();

            if (document.getElementById('settingsBuRulesContainer')) {
                renderAdminRulesTable('settingsBuRulesContainer');
            }
            if (document.getElementById('buRulesTableContainer')) {
                renderAdminRulesTable('buRulesTableContainer');
            }

            if (typeof window.showToast === 'function') {
                window.showToast(`Business Unit ${buCode} saved successfully!`, 'success');
            } else {
                alert(`Business Unit ${buCode} saved successfully!`);
            }
        } catch (err) {
            // the modal stays open with the real reason
            showModalError(`Could not save Business Unit: ${err.message}`);
            if (saveBtn && err.message !== NO_ORG_MESSAGE) saveBtn.disabled = false;
        }
    }

    function handleTypeToggle(buCode, empTypeCode, isChecked) {
        const rule = currentRules.get(buCode.toUpperCase());
        if (!rule) return;

        let allowed = (rule.allowedEmployeeTypes || []).map(t => t.toUpperCase());
        if (isChecked) {
            if (!allowed.includes(empTypeCode)) allowed.push(empTypeCode);
            if (empTypeCode === 'CONTRACT' && !allowed.includes('CONTRACTOR')) allowed.push('CONTRACTOR');
        } else {
            allowed = allowed.filter(t => t !== empTypeCode);
            if (empTypeCode === 'CONTRACT') allowed = allowed.filter(t => t !== 'CONTRACTOR');
        }
        rule.allowedEmployeeTypes = allowed;

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
        const rule = currentRules.get(buCode.toUpperCase());
        if (!rule) return;

        try {
            await toggleBusinessUnitStatus(buCode, !rule.isActive);
            if (document.getElementById('settingsBuRulesContainer')) {
                renderAdminRulesTable('settingsBuRulesContainer');
            }
            if (document.getElementById('buRulesTableContainer')) {
                renderAdminRulesTable('buRulesTableContainer');
            }
        } catch (err) {
            alert(`Failed to toggle status: ${err.message}`);
        }
    }

    async function saveSingleRule(buCode) {
        const rule = currentRules.get(buCode.toUpperCase());
        if (!rule) return;

        try {
            await saveRule(rule);
            if (typeof window.showToast === 'function') {
                window.showToast(`Rules saved for ${rule.businessUnitName} (${buCode})`, 'success');
            } else {
                alert(`Saved rules for ${rule.businessUnitName}`);
            }
        } catch (err) {
            alert(`Failed to save: ${err.message}`);
        }
    }

    async function saveAllRules() {
        const rules = getAllRules();
        let count = 0;
        try {
            for (const r of rules) {
                await saveRule(r);
                count++;
            }
        } catch (err) {
            alert(`Saved ${count} of ${rules.length} Business Units. Failed: ${err.message}`);
            return;
        }
        if (typeof window.showToast === 'function') {
            window.showToast(`All ${count} Business Unit rules saved to Cloud Firestore!`, 'success');
        } else {
            alert(`All ${count} Business Unit rules saved!`);
        }
    }

    // Auto-load rules on initialization; a failure is logged and kept in getLoadError(), shown by the table
    function autoLoad() {
        loadRulesFromFirestore().catch(err => console.error('[BURules] Could not load business units:', err.message));
        fetchActiveEmployees();
    }

    if (typeof window !== 'undefined') {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            autoLoad();
        } else {
            document.addEventListener('DOMContentLoaded', autoLoad);
        }
    }

    return {
        BUSINESS_UNIT_ATTRIBUTES,
        CANONICAL_EMPLOYEE_TYPES,
        DEFAULT_BU_RULES,
        // Tests only: load the samples as fixtures. The page never calls this.
        loadSampleRulesForTesting: initDefaultRules,
        loadRulesFromFirestore,
        getLoadError,
        getAllRules,
        getAllBusinessUnits,
        getRuleByCode,
        getBusinessUnit,
        getEmployeeTypes,
        getAllowedBusinessUnits,
        isCombinationValid,
        saveRule,
        createBusinessUnit,
        updateBusinessUnit,
        toggleBusinessUnitStatus,
        deleteBusinessUnit,
        bulkImportBusinessUnits,
        fetchActiveEmployees,
        bindEmployeeTypeAndBuGating,
        renderAdminRulesTable,
        openBuModal,
        closeBuModal,
        handleModalSubmit,
        handleTypeToggle,
        toggleActiveStatus,
        saveSingleRule,
        saveAllRules
    };
}));
