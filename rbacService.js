/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - HYBRID RBAC & PERMISSION OVERRIDE ENGINE
 * ============================================================================
 * 
 * Manages Role-Based Access Control (RBAC), Cascading Precedence Resolution,
 * Employee-Specific Permission Overrides, Client-Side DOM Guarding,
 * and Boundary Scope Enforcement matching PRD Sections 1, 14, 17, & 18:
 * 
 * 1. Dual-Target Resolution Architecture:
 *    - Base Role: Loaded from organizations/{orgId}/roles/{roleCode}
 *    - Individual Override: Loaded from organizations/{orgId}/user_permission_overrides/{employeeId}
 *    - Super Admin Lock: Immutable Full access across all 8 modules & Global scope.
 * 
 * 2. Scope Levels:
 *    - Global, Business_Unit, Department, Location, Self
 * 
 * 3. Module Permissions:
 *    - employee, attendance, leave, payroll, recruitment, assets, reports, organizationSetup
 *    - Allowed values: "Full", "View", "Edit", "Approve", "Disburse_Only", "Allocate", "Export", "Self", "None"
 * 
 * 4. DOM Guarding:
 *    - Auto-evaluates elements with [data-permission] and [data-min-level]
 *    - Hides, disables, or renders read-only based on resolved capabilities
 * 
 * 5. Data Scope Boundary Checking:
 *    - Validates record access against user's resolved scope level.
 * 
 * @version 1.0.0
 * @author Principal Security Architect & Firebase Engineer
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxRBACService = factory();
        root.rbacService = root.KylrxRBACService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // In-memory ledger for caching, test runner, and offline evaluation
    const _roleLedger = new Map();
    const _overrideLedger = new Map();
    const _userCache = new Map();

    // Permission Level Hierarchy Matrix
    const PERMISSION_LEVELS = {
        'NONE': 0,
        'SELF': 1,
        'VIEW': 2,
        'EXPORT': 3,
        'ALLOCATE': 4,
        'DISBURSE_ONLY': 5,
        'APPROVE': 6,
        'EDIT': 7,
        'FULL': 10
    };

    // Canonical Module Key Mapping
    const MODULE_KEY_MAP = {
        'employee': 'employee',
        'employee_module': 'employee',
        'attendance': 'attendance',
        'attendance_module': 'attendance',
        'leave': 'leave',
        'leave_module': 'leave',
        'payroll': 'payroll',
        'payroll_module': 'payroll',
        'recruitment': 'recruitment',
        'recruitment_module': 'recruitment',
        'assets': 'assets',
        'assets_module': 'assets',
        'reports': 'reports',
        'reports_module': 'reports',
        'organizationsetup': 'organizationSetup',
        'organization_setup': 'organizationSetup',
        'organization': 'organizationSetup'
    };

    // Predefined Enterprise Seed Roles
    const DEFAULT_ROLES = [
        {
            roleCode: 'ROLE_SUPER_ADMIN',
            roleName: 'Super Administrator',
            description: 'Unrestricted organization governance, security, and enterprise configuration',
            scopeLevel: 'Global',
            modules: {
                employee: 'Full',
                attendance: 'Full',
                leave: 'Full',
                payroll: 'Full',
                recruitment: 'Full',
                assets: 'Full',
                reports: 'Full',
                organizationSetup: 'Full'
            },
            isActive: true,
            isImmutable: true
        },
        {
            roleCode: 'ROLE_ADMIN',
            roleName: 'Company Administrator',
            description: 'Enterprise-wide operational control and resource management',
            scopeLevel: 'Global',
            modules: {
                employee: 'Full',
                attendance: 'Full',
                leave: 'Full',
                payroll: 'Full',
                recruitment: 'Full',
                assets: 'Full',
                reports: 'Full',
                organizationSetup: 'Edit'
            },
            isActive: true,
            isImmutable: false
        },
        {
            roleCode: 'ROLE_HRMS',
            roleName: 'Human Resources Manager',
            description: 'People operations, employee records, onboarding, and leave approvals',
            scopeLevel: 'Global',
            modules: {
                employee: 'Full',
                attendance: 'Approve',
                leave: 'Approve',
                payroll: 'View',
                recruitment: 'Full',
                assets: 'View',
                reports: 'Export',
                organizationSetup: 'View'
            },
            isActive: true,
            isImmutable: false
        },
        {
            roleCode: 'ROLE_DEPT_MGR',
            roleName: 'Department Manager',
            description: 'Departmental oversight, timesheet validation, and leave approvals',
            scopeLevel: 'Department',
            modules: {
                employee: 'View',
                attendance: 'Approve',
                leave: 'Approve',
                payroll: 'None',
                recruitment: 'View',
                assets: 'Approve',
                reports: 'View',
                organizationSetup: 'None'
            },
            isActive: true,
            isImmutable: false
        },
        {
            roleCode: 'ROLE_EMPLOYEE',
            roleName: 'Standard Employee',
            description: 'Employee self-service, personal attendance marking, and leave applications',
            scopeLevel: 'Self',
            modules: {
                employee: 'Self',
                attendance: 'Self',
                leave: 'Self',
                payroll: 'Self',
                recruitment: 'None',
                assets: 'Self',
                reports: 'None',
                organizationSetup: 'None'
            },
            isActive: true,
            isImmutable: false
        },
        {
            roleCode: 'ROLE_FINANCE',
            roleName: 'Financial Comptroller',
            description: 'Payroll processing, salary disbursement, and statutory remittance exports',
            scopeLevel: 'Global',
            modules: {
                employee: 'View',
                attendance: 'View',
                leave: 'View',
                payroll: 'Full',
                recruitment: 'None',
                assets: 'View',
                reports: 'Export',
                organizationSetup: 'None'
            },
            isActive: true,
            isImmutable: false
        },
        {
            roleCode: 'ROLE_RECRUITER',
            roleName: 'Talent Acquisition Lead',
            description: 'Candidate pipeline, job openings, and interview lifecycle',
            scopeLevel: 'Global',
            modules: {
                employee: 'View',
                attendance: 'None',
                leave: 'None',
                payroll: 'None',
                recruitment: 'Full',
                assets: 'None',
                reports: 'View',
                organizationSetup: 'None'
            },
            isActive: true,
            isImmutable: false
        }
    ];

    // Initialize in-memory seed roles
    DEFAULT_ROLES.forEach(r => {
        _roleLedger.set(r.roleCode, { ...r });
    });

    /**
     * Resolves the canonical module name
     */
    function normalizeModuleKey(moduleName) {
        if (!moduleName) return '';
        let clean = String(moduleName).toLowerCase().replace(/[\/\-_ \(\)\.]/g, '').trim();
        if (clean.endsWith('module') && clean.length > 6) {
            clean = clean.replace(/module$/, '');
        }
        return MODULE_KEY_MAP[clean] || clean;
    }

    /**
     * Converts a permission string to numeric rank
     */
    function getPermissionRank(permString) {
        if (!permString) return 0;
        const upper = String(permString).toUpperCase().trim();
        return PERMISSION_LEVELS[upper] !== undefined ? PERMISSION_LEVELS[upper] : 0;
    }

    /**
     * Checks if a granted permission level satisfies a required level or action
     */
    function isPermissionSatisfied(grantedLevel, requiredLevelOrAction) {
        if (!requiredLevelOrAction) return true;
        const grantedUpper = String(grantedLevel || 'None').toUpperCase().trim();
        const requiredUpper = String(requiredLevelOrAction).toUpperCase().trim();

        // Super permission
        if (grantedUpper === 'FULL') return true;
        if (grantedUpper === requiredUpper) return true;

        // Specific actions
        if (requiredUpper === 'VIEW') {
            return ['FULL', 'EDIT', 'APPROVE', 'DISBURSE_ONLY', 'ALLOCATE', 'EXPORT', 'VIEW'].includes(grantedUpper);
        }
        if (requiredUpper === 'EDIT') {
            return ['FULL', 'EDIT'].includes(grantedUpper);
        }
        if (requiredUpper === 'APPROVE') {
            return ['FULL', 'APPROVE'].includes(grantedUpper);
        }
        if (requiredUpper === 'DISBURSE_ONLY' || requiredUpper === 'DISBURSE') {
            return ['FULL', 'DISBURSE_ONLY'].includes(grantedUpper);
        }
        if (requiredUpper === 'ALLOCATE') {
            return ['FULL', 'ALLOCATE'].includes(grantedUpper);
        }
        if (requiredUpper === 'EXPORT') {
            return ['FULL', 'EXPORT'].includes(grantedUpper);
        }
        if (requiredUpper === 'SELF') {
            return grantedUpper !== 'NONE';
        }

        // Numeric comparison fallback
        const grantedRank = getPermissionRank(grantedUpper);
        const requiredRank = getPermissionRank(requiredUpper);
        return grantedRank >= requiredRank;
    }

    /**
     * Cascading Permission Precedence Resolution Engine
     * 
     * Pipeline:
     * 1. Base Role: Load permissions linked to user's base role (e.g. ROLE_EMPLOYEE or ROLE_DEPT_MGR).
     * 2. Individual Override: If an entry exists where Role_Code_or_Employee_Code matches user's Employee_ID,
     *    overlay those specific module privileges on top of base role permissions.
     * 3. Super Admin Lock: Ensure ROLE_SUPER_ADMIN maintains immutable "Full" access across all modules
     *    and cannot be overridden or deactivated.
     * 
     * @param {Object} userContext
     * @param {string} userContext.uid
     * @param {string} [userContext.employeeId]
     * @param {string} [userContext.baseRole]
     * @param {string} [userContext.departmentId]
     * @param {string} [userContext.businessUnitId]
     * @param {string} [userContext.locationId]
     * @param {boolean} [userContext.isSuperAdmin]
     * @param {Object} [options]
     * @returns {Object} Resolved permissions profile
     */
    function resolveUserPermissions(userContext = {}, options = {}) {
        const uid = userContext.uid || 'anonymous';
        const employeeId = (userContext.employeeId || '').toUpperCase().trim();
        const baseRoleCode = (userContext.baseRole || 'ROLE_EMPLOYEE').toUpperCase().trim();

        // Check if user is Super Admin
        const isSuperAdminExplicit = userContext.isSuperAdmin === true ||
            baseRoleCode === 'ROLE_SUPER_ADMIN' ||
            baseRoleCode === 'ROLE_SUPERADMIN' ||
            baseRoleCode === 'SUPER_ADMIN' ||
            baseRoleCode === 'SUPERADMIN';

        // 3. SUPER ADMIN LOCK: Immutable Full access across all 8 modules & Global scope
        if (isSuperAdminExplicit) {
            const superAdminProfile = {
                uid: uid,
                employeeId: employeeId,
                baseRole: 'ROLE_SUPER_ADMIN',
                resolvedRoleTitle: 'Super Administrator',
                scopeLevel: 'Global',
                isSuperAdmin: true,
                hasActiveOverride: false,
                overrideTitle: null,
                modules: {
                    employee: 'Full',
                    attendance: 'Full',
                    leave: 'Full',
                    payroll: 'Full',
                    recruitment: 'Full',
                    assets: 'Full',
                    reports: 'Full',
                    organizationSetup: 'Full'
                },
                resolvedAt: new Date().toISOString()
            };
            _userCache.set(uid, superAdminProfile);
            return superAdminProfile;
        }

        // 1. BASE ROLE RESOLUTION
        let baseRoleDoc = null;
        if (options.rolesLedger && options.rolesLedger.has(baseRoleCode)) {
            baseRoleDoc = options.rolesLedger.get(baseRoleCode);
        } else if (_roleLedger.has(baseRoleCode)) {
            baseRoleDoc = _roleLedger.get(baseRoleCode);
        } else {
            // Default fallback to standard employee
            baseRoleDoc = _roleLedger.get('ROLE_EMPLOYEE') || DEFAULT_ROLES[4];
        }

        // Clone base role module permissions
        const resolvedModules = {
            employee: baseRoleDoc.modules?.employee || 'Self',
            attendance: baseRoleDoc.modules?.attendance || 'Self',
            leave: baseRoleDoc.modules?.leave || 'Self',
            payroll: baseRoleDoc.modules?.payroll || 'None',
            recruitment: baseRoleDoc.modules?.recruitment || 'None',
            assets: baseRoleDoc.modules?.assets || 'Self',
            reports: baseRoleDoc.modules?.reports || 'None',
            organizationSetup: baseRoleDoc.modules?.organizationSetup || 'None'
        };

        let resolvedScopeLevel = baseRoleDoc.scopeLevel || 'Self';
        let resolvedTitle = baseRoleDoc.roleName || baseRoleCode;
        let hasActiveOverride = false;
        let overrideTitle = null;

        // 2. INDIVIDUAL OVERRIDE RESOLUTION
        if (employeeId) {
            let overrideDoc = null;
            if (options.overridesLedger && options.overridesLedger.has(employeeId)) {
                overrideDoc = options.overridesLedger.get(employeeId);
            } else if (_overrideLedger.has(employeeId)) {
                overrideDoc = _overrideLedger.get(employeeId);
            }

            if (overrideDoc && overrideDoc.isActive !== false) {
                hasActiveOverride = true;
                overrideTitle = overrideDoc.roleName || `Override for ${employeeId}`;

                // Overlay specific module privileges on top of base role
                if (overrideDoc.modules) {
                    for (const modKey of Object.keys(resolvedModules)) {
                        const overrideVal = overrideDoc.modules[modKey];
                        if (overrideVal && overrideVal !== 'None') {
                            resolvedModules[modKey] = overrideVal;
                        }
                    }
                }

                // Overlay Scope Level if specified
                if (overrideDoc.scopeLevel) {
                    resolvedScopeLevel = overrideDoc.scopeLevel;
                }
            }
        }

        const resolvedProfile = {
            uid: uid,
            employeeId: employeeId,
            baseRole: baseRoleCode,
            resolvedRoleTitle: resolvedTitle,
            scopeLevel: resolvedScopeLevel,
            isSuperAdmin: false,
            hasActiveOverride: hasActiveOverride,
            overrideTitle: overrideTitle,
            modules: resolvedModules,
            resolvedAt: new Date().toISOString()
        };

        _userCache.set(uid, resolvedProfile);
        return resolvedProfile;
    }

    /**
     * Checks if resolved permissions grant access to a module action
     */
    function hasPermission(resolvedPermissions, moduleName, requiredActionOrLevel) {
        if (!resolvedPermissions) return false;
        if (resolvedPermissions.isSuperAdmin) return true;

        const canonicalModule = normalizeModuleKey(moduleName);
        const granted = resolvedPermissions.modules ? resolvedPermissions.modules[canonicalModule] : 'None';
        return isPermissionSatisfied(granted, requiredActionOrLevel);
    }

    /**
     * Data Scope Boundary Checking (PRD §§ 14 & 18)
     * 
     * Ensures users scoped to "Department", "Business_Unit", "Location", or "Self"
     * are blocked from fetching organizational records outside their scope.
     * 
     * @param {Object} userContext - Context containing resolved scope and user identifiers
     * @param {Object} record - The resource record being accessed
     * @returns {boolean} True if access is permitted within scope
     */
    function checkDataScope(userContext, record) {
        if (!userContext || !record) return false;

        // Super Admin or Global scope has full access across organization
        if (userContext.isSuperAdmin || userContext.scopeLevel === 'Global') {
            return true;
        }

        const scope = userContext.scopeLevel || 'Self';

        if (scope === 'Business_Unit') {
            const userBu = userContext.businessUnitId || userContext.buCode;
            const recordBu = record.businessUnitId || record.buCode || record.business_unit_code;
            return Boolean(userBu && recordBu && userBu.toUpperCase() === recordBu.toUpperCase());
        }

        if (scope === 'Department') {
            const userDept = userContext.departmentId || userContext.deptCode;
            const recordDept = record.departmentId || record.deptCode || record.department_code;
            return Boolean(userDept && recordDept && userDept.toUpperCase() === recordDept.toUpperCase());
        }

        if (scope === 'Location') {
            const userLoc = userContext.locationId || userContext.locationCode;
            const recordLoc = record.locationId || record.locationCode || record.location_code;
            return Boolean(userLoc && recordLoc && userLoc.toUpperCase() === recordLoc.toUpperCase());
        }

        if (scope === 'Self') {
            const userEmpId = (userContext.employeeId || '').toUpperCase();
            const recordEmpId = (record.employeeId || record.employee_id || record.id || '').toUpperCase();
            const userUid = userContext.uid;
            const recordUid = record.userId || record.uid;

            return Boolean(
                (userEmpId && recordEmpId && userEmpId === recordEmpId) ||
                (userUid && recordUid && userUid === recordUid)
            );
        }

        return false;
    }

    /**
     * Filters an array of records against user's boundary scope
     */
    function filterRecordsByScope(userContext, records = []) {
        if (!Array.isArray(records)) return [];
        return records.filter(r => checkDataScope(userContext, r));
    }

    /**
     * Real-Time Client-Side DOM Element Guarding
     * 
     * Scans the document or specified container for elements tagged with:
     * - data-permission (e.g. "Payroll_Module", "Attendance_Module", "payroll")
     * - data-min-level (e.g. "Full", "Edit", "Approve", "View", "Export")
     * - data-guard-mode ("hide" [default], "disable", "readonly")
     * 
     * Automatically adjusts element visibility/interactivity based on resolved capabilities.
     * 
     * @param {HTMLElement|Document} [container=document]
     * @param {Object} [resolvedPermissions]
     */
    function guardDOM(container, resolvedPermissions) {
        const rootElem = container || (typeof document !== 'undefined' ? document : null);
        if (!rootElem || !rootElem.querySelectorAll) return;

        // If no permissions passed, try to fetch from local storage or cached session
        let perms = resolvedPermissions;
        if (!perms && typeof window !== 'undefined') {
            perms = window.KylrxCurrentUserPermissions || _userCache.get('current');
            if (!perms) {
                const storedRole = localStorage.getItem('userRole') || localStorage.getItem('user_role') || 'ROLE_EMPLOYEE';
                const storedEmpId = localStorage.getItem('employeeId') || localStorage.getItem('empId') || '';
                perms = resolveUserPermissions({
                    uid: 'current',
                    employeeId: storedEmpId,
                    baseRole: storedRole,
                    isSuperAdmin: ['super_admin', 'superadmin', 'admin'].includes(storedRole.toLowerCase())
                });
            }
        }

        if (!perms) return;

        // Query all guarded elements
        const elements = rootElem.querySelectorAll('[data-permission]');
        elements.forEach(el => {
            const moduleName = el.getAttribute('data-permission');
            const minLevel = el.getAttribute('data-min-level') || 'View';
            const guardMode = (el.getAttribute('data-guard-mode') || 'hide').toLowerCase();

            const isAllowed = hasPermission(perms, moduleName, minLevel);

            if (!isAllowed) {
                if (guardMode === 'disable') {
                    el.disabled = true;
                    el.setAttribute('disabled', 'true');
                    if (el.classList && typeof el.classList.add === 'function') el.classList.add('rbac-disabled');
                    el.title = `Access Restricted: Requires '${minLevel}' in ${moduleName}`;
                } else if (guardMode === 'readonly') {
                    el.readOnly = true;
                    el.setAttribute('readonly', 'true');
                    if (el.classList && typeof el.classList.add === 'function') el.classList.add('rbac-readonly');
                } else {
                    // Default is hide
                    if (el.dataset.rbacOriginalDisplay === undefined) {
                        el.dataset.rbacOriginalDisplay = el.style.display || '';
                    }
                    el.style.display = 'none';
                }
            } else {
                // Restore element if previously restricted
                if (guardMode === 'disable') {
                    el.disabled = false;
                    el.removeAttribute('disabled');
                    if (el.classList && typeof el.classList.remove === 'function') el.classList.remove('rbac-disabled');
                    el.title = '';
                } else if (guardMode === 'readonly') {
                    el.readOnly = false;
                    el.removeAttribute('readonly');
                    if (el.classList && typeof el.classList.remove === 'function') el.classList.remove('rbac-readonly');
                } else {
                    if (el.dataset.rbacOriginalDisplay !== undefined) {
                        el.style.display = el.dataset.rbacOriginalDisplay;
                        delete el.dataset.rbacOriginalDisplay;
                    } else if (el.style.display === 'none') {
                        el.style.display = '';
                    }
                }
            }
        });
    }

    /**
     * Synchronizes resolved permissions into a protected cache document
     */
    async function syncUserClaimsAndCache(orgId, userId, employeeId, resolvedPermissions, dbInstance) {
        if (!userId || !orgId) return false;

        const payload = {
            userId: userId,
            employeeId: employeeId || resolvedPermissions.employeeId,
            orgId: orgId,
            baseRole: resolvedPermissions.baseRole,
            resolvedRoleTitle: resolvedPermissions.resolvedRoleTitle,
            scopeLevel: resolvedPermissions.scopeLevel,
            isSuperAdmin: resolvedPermissions.isSuperAdmin,
            hasActiveOverride: resolvedPermissions.hasActiveOverride,
            modules: resolvedPermissions.modules,
            syncedAt: new Date().toISOString()
        };

        _userCache.set(userId, { ...resolvedPermissions });

        if (dbInstance && typeof dbInstance.doc === 'function') {
            try {
                const userPermRef = dbInstance.doc(dbInstance, `organizations/${orgId}/user_permissions`, userId);
                await dbInstance.setDoc(userPermRef, payload, { merge: true });
                return true;
            } catch (err) {
                console.warn("Failed to persist user_permissions cache to Firestore:", err);
            }
        }
        return true;
    }

    /**
     * Ingests parsed permission profiles into Cloud Firestore
     * 
     * Paths:
     * - Base Roles: organizations/{orgId}/roles/{roleCode}
     * - User Overrides: organizations/{orgId}/user_permission_overrides/{employeeId}
     * 
     * @param {Array} records - Array of validated permission documents
     * @param {string} orgId - Organization tenant ID
     * @param {Object} [dbInstance] - Firestore instance
     * @returns {Object} Ingestion statistics
     */
    async function ingestPermissionRecords(records = [], orgId = 'org_kylrx', dbInstance = null) {
        let rolesIngested = 0;
        let overridesIngested = 0;
        const errors = [];

        for (const docObj of records) {
            try {
                if (docObj.targetType === 'BASE_ROLE') {
                    // Save to in-memory ledger
                    _roleLedger.set(docObj.roleCode, { ...docObj });

                    if (dbInstance && typeof dbInstance.doc === 'function') {
                        const roleRef = dbInstance.doc(dbInstance, `organizations/${orgId}/roles`, docObj.roleCode);
                        await dbInstance.setDoc(roleRef, {
                            ...docObj,
                            updatedAt: new Date().toISOString()
                        }, { merge: true });
                    }
                    rolesIngested++;
                } else if (docObj.targetType === 'EMPLOYEE_OVERRIDE') {
                    const empKey = docObj.employeeId || docObj.roleCode;
                    _overrideLedger.set(empKey, { ...docObj });

                    if (dbInstance && typeof dbInstance.doc === 'function') {
                        const overrideRef = dbInstance.doc(dbInstance, `organizations/${orgId}/user_permission_overrides`, empKey);
                        await dbInstance.setDoc(overrideRef, {
                            ...docObj,
                            updatedAt: new Date().toISOString()
                        }, { merge: true });
                    }
                    overridesIngested++;
                }
            } catch (err) {
                errors.push(`${docObj.roleCode}: ${err.message}`);
            }
        }

        return {
            success: errors.length === 0,
            rolesIngested,
            overridesIngested,
            totalIngested: rolesIngested + overridesIngested,
            errors
        };
    }

    /**
     * In-memory ledger accessors
     */
    function getAllRoles() {
        return Array.from(_roleLedger.values());
    }

    function getAllOverrides() {
        return Array.from(_overrideLedger.values());
    }

    function getRole(roleCode) {
        return _roleLedger.get(String(roleCode).toUpperCase()) || null;
    }

    function getOverride(employeeId) {
        return _overrideLedger.get(String(employeeId).toUpperCase()) || null;
    }

    function saveRole(roleDoc) {
        if (!roleDoc || !roleDoc.roleCode) return false;
        const code = roleDoc.roleCode.toUpperCase();
        if (code === 'ROLE_SUPER_ADMIN') {
            // Keep super admin immutable
            _roleLedger.set(code, {
                ...roleDoc,
                roleCode: 'ROLE_SUPER_ADMIN',
                scopeLevel: 'Global',
                modules: {
                    employee: 'Full',
                    attendance: 'Full',
                    leave: 'Full',
                    payroll: 'Full',
                    recruitment: 'Full',
                    assets: 'Full',
                    reports: 'Full',
                    organizationSetup: 'Full'
                },
                isActive: true,
                isImmutable: true
            });
            return true;
        }
        _roleLedger.set(code, { ...roleDoc });
        return true;
    }

    function saveOverride(overrideDoc) {
        if (!overrideDoc) return false;
        const empId = (overrideDoc.employeeId || overrideDoc.roleCode || '').toUpperCase();
        if (!empId) return false;
        _overrideLedger.set(empId, { ...overrideDoc, employeeId: empId, targetType: 'EMPLOYEE_OVERRIDE' });
        return true;
    }

    function deleteOverride(employeeId) {
        return _overrideLedger.delete(String(employeeId).toUpperCase());
    }

    function clearAll() {
        _roleLedger.clear();
        _overrideLedger.clear();
        _userCache.clear();
        DEFAULT_ROLES.forEach(r => _roleLedger.set(r.roleCode, { ...r }));
    }

    return {
        PERMISSION_LEVELS,
        DEFAULT_ROLES,
        MODULE_KEY_MAP,
        normalizeModuleKey,
        getPermissionRank,
        isPermissionSatisfied,
        resolveUserPermissions,
        hasPermission,
        checkDataScope,
        filterRecordsByScope,
        guardDOM,
        syncUserClaimsAndCache,
        ingestPermissionRecords,
        getAllRoles,
        getAllOverrides,
        getRole,
        getOverride,
        saveRole,
        saveOverride,
        deleteOverride,
        clearAll
    };
}));
