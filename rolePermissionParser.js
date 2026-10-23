/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - RBAC & PERMISSION OVERRIDE PARSER & VALIDATOR ENGINE
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and normalizes Role-Based Access Control
 * profiles and Employee-Specific Permission Overrides from the 'Role_Code/Employee Cod'
 * sheet of Templates.xlsx or CSV uploads matching PRD Sections 1, 14, 17, & 18:
 * 
 * Exact 13 Attributes Schema:
 * 1. Role_Code_or_Employee_Code (string, e.g. "ROLE_SUPER_ADMIN", "ROLE_HRMS", "EMP0012")
 * 2. Role_Name (string, display title)
 * 3. Description (string, textual scope explanation)
 * 4. Scope_Level (string: "Global", "Business_Unit", "Department", "Location", "Self")
 * 5. Employee_Module (enum)
 * 6. Attendance_Module (enum)
 * 7. Leave_Module (enum)
 * 8. Payroll_Module (enum)
 * 9. Recruitment_Module (enum)
 * 10. Assets_Module (enum)
 * 11. Reports_Module (enum)
 * 12. Organization_Setup (enum)
 * 13. Active (boolean: true for "Yes", false for "No")
 * 
 * Allowed Module Permission Enums:
 * "Full", "View", "Edit", "Approve", "Disburse_Only", "Allocate", "Export", "Self", "None"
 * 
 * Target Entity Resolution:
 * - "ROLE_..." -> BASE_ROLE
 * - "EMP..." / Employee IDs -> EMPLOYEE_OVERRIDE
 * - ROLE_SUPER_ADMIN -> Immutable "Full" lock
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
        root.KylrxRolePermissionParser = factory();
        root.rolePermissionParser = root.KylrxRolePermissionParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        code: [
            'role_code_or_employee_code', 'role_code/employee_code', 'role_code/employee_cod',
            'role_code_employee_code', 'role_code_employee_cod', 'role_code', 'employee_code',
            'role_or_employee_code', 'role_or_employee_id', 'code', 'id', 'target_code',
            'entity_code', 'profile_code', 'identifier'
        ],
        roleName: [
            'role_name', 'rolename', 'name', 'title', 'display_name', 'profile_name',
            'override_title', 'permission_title'
        ],
        description: [
            'description', 'desc', 'scope_explanation', 'explanation', 'notes', 'details', 'summary'
        ],
        scopeLevel: [
            'scope_level', 'scopelevel', 'scope', 'access_scope', 'boundary', 'boundary_level'
        ],
        employeeModule: [
            'employee_module', 'employeemodule', 'employee', 'employees', 'employee_access',
            'employee_perm', 'emp_module'
        ],
        attendanceModule: [
            'attendance_module', 'attendancemodule', 'attendance', 'attendance_access',
            'attendance_perm', 'att_module'
        ],
        leaveModule: [
            'leave_module', 'leavemodule', 'leave', 'leaves', 'leave_access', 'leave_perm'
        ],
        payrollModule: [
            'payroll_module', 'payrollmodule', 'payroll', 'compensation', 'payroll_access',
            'payroll_perm', 'salaries'
        ],
        recruitmentModule: [
            'recruitment_module', 'recruitmentmodule', 'recruitment', 'hiring', 'recruitment_access',
            'recruitment_perm', 'candidates'
        ],
        assetsModule: [
            'assets_module', 'assetsmodule', 'assets', 'asset_management', 'assets_access',
            'assets_perm', 'inventory'
        ],
        reportsModule: [
            'reports_module', 'reportsmodule', 'reports', 'analytics', 'reports_access',
            'reports_perm', 'reporting'
        ],
        organizationSetup: [
            'organization_setup', 'organizationsetup', 'org_setup', 'organization', 'setup',
            'org_config', 'settings', 'organization_module'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'in_use'
        ]
    };

    // Valid Enum Definitions
    const ALLOWED_SCOPES = [
        "Global",
        "Business_Unit",
        "Department",
        "Location",
        "Self"
    ];

    const ALLOWED_MODULE_PERMISSIONS = [
        "Full",
        "View",
        "Edit",
        "Approve",
        "Disburse_Only",
        "Allocate",
        "Export",
        "Self",
        "None"
    ];

    // Canonical Attribute Definition (13 Attributes matching PRD §§ 1, 14, 17, & 18)
    const ROLE_PERMISSION_ATTRIBUTES = [
        { key: "Role_Code_or_Employee_Code", label: "1. Role Code or Employee Code", required: true, synonyms: HEADER_SYNONYMS.code },
        { key: "Role_Name", label: "2. Role / Override Title", required: true, synonyms: HEADER_SYNONYMS.roleName },
        { key: "Description", label: "3. Scope Explanation", required: false, synonyms: HEADER_SYNONYMS.description },
        { key: "Scope_Level", label: "4. Scope Level", required: true, defaultValue: "Self", synonyms: HEADER_SYNONYMS.scopeLevel },
        { key: "Employee_Module", label: "5. Employee Module", required: true, defaultValue: "None", synonyms: HEADER_SYNONYMS.employeeModule },
        { key: "Attendance_Module", label: "6. Attendance Module", required: true, defaultValue: "None", synonyms: HEADER_SYNONYMS.attendanceModule },
        { key: "Leave_Module", label: "7. Leave Module", required: true, defaultValue: "None", synonyms: HEADER_SYNONYMS.leaveModule },
        { key: "Payroll_Module", label: "8. Payroll Module", required: true, defaultValue: "None", synonyms: HEADER_SYNONYMS.payrollModule },
        { key: "Recruitment_Module", label: "9. Recruitment Module", required: true, defaultValue: "None", synonyms: HEADER_SYNONYMS.recruitmentModule },
        { key: "Assets_Module", label: "10. Assets Module", required: true, defaultValue: "None", synonyms: HEADER_SYNONYMS.assetsModule },
        { key: "Reports_Module", label: "11. Reports Module", required: true, defaultValue: "None", synonyms: HEADER_SYNONYMS.reportsModule },
        { key: "Organization_Setup", label: "12. Organization Setup", required: true, defaultValue: "None", synonyms: HEADER_SYNONYMS.organizationSetup },
        { key: "Active", label: "13. Active (Yes/No)", required: true, defaultValue: true, synonyms: HEADER_SYNONYMS.active }
    ];

    // Known Sheet Names
    const KNOWN_SHEET_NAMES = [
        'Role_Code/Employee Cod',
        'Role_Code/Employee_Code',
        'Role_Code_Employee_Code',
        'Role_Code_Employee Cod',
        'Role_Code_or_Employee_Code',
        'Roles_Permissions',
        'Role_Permissions',
        'Roles & Permissions',
        'Permissions',
        'RBAC',
        'Roles'
    ];

    /**
     * Normalizes header key by stripping punctuation, underscores, and extra whitespace
     */
    function normalizeHeaderKey(key) {
        if (!key) return '';
        return String(key).toLowerCase().replace(/[\/\-_ \(\)\.]/g, '').trim();
    }

    /**
     * Determines target entity resolution:
     * - "ROLE_..." -> BASE_ROLE
     * - "EMP..." or non-role identifiers -> EMPLOYEE_OVERRIDE
     */
    function resolveTargetEntityType(code) {
        const normalized = String(code || '').trim().toUpperCase();
        if (normalized.startsWith('ROLE_') || normalized.startsWith('ROLE-') || normalized.startsWith('R_')) {
            return 'BASE_ROLE';
        }
        if (normalized.startsWith('EMP') || normalized.startsWith('E-') || /^[0-9]+$/.test(normalized)) {
            return 'EMPLOYEE_OVERRIDE';
        }
        // Fallback: check if "ROLE" is in name
        if (normalized.includes('ROLE')) {
            return 'BASE_ROLE';
        }
        return 'EMPLOYEE_OVERRIDE';
    }

    /**
     * Normalizes and validates a scope level
     */
    function sanitizeScopeLevel(value) {
        if (!value) return 'Self';
        const str = String(value).trim();
        for (const allowed of ALLOWED_SCOPES) {
            if (allowed.toLowerCase() === str.toLowerCase() ||
                allowed.replace(/_/g, ' ').toLowerCase() === str.replace(/_/g, ' ').toLowerCase()) {
                return allowed;
            }
        }
        return 'Self';
    }

    /**
     * Normalizes and validates a module permission value
     */
    function sanitizeModulePermission(value) {
        if (value === null || value === undefined) return 'None';
        const str = String(value).trim();
        for (const allowed of ALLOWED_MODULE_PERMISSIONS) {
            if (allowed.toLowerCase() === str.toLowerCase() ||
                allowed.replace(/_/g, ' ').toLowerCase() === str.replace(/_/g, ' ').toLowerCase()) {
                return allowed;
            }
        }
        // Common synonym mappings
        const lower = str.toLowerCase();
        if (lower === 'all' || lower === 'admin' || lower === 'read/write' || lower === 'read-write') return 'Full';
        if (lower === 'read' || lower === 'read-only' || lower === 'readonly') return 'View';
        if (lower === 'write' || lower === 'modify' || lower === 'update') return 'Edit';
        if (lower === 'approver' || lower === 'verify') return 'Approve';
        if (lower === 'disburse' || lower === 'disbursement') return 'Disburse_Only';
        if (lower === 'assign') return 'Allocate';
        if (lower === 'download') return 'Export';
        if (lower === 'own' || lower === 'my') return 'Self';
        if (lower === 'no' || lower === 'false' || lower === '0' || lower === 'deny') return 'None';

        return 'None';
    }

    /**
     * Normalizes a boolean value (Yes/No, True/False, 1/0)
     */
    function parseBoolean(val, fallback = true) {
        if (val === null || val === undefined) return fallback;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        if (s === 'yes' || s === 'true' || s === '1' || s === 'active' || s === 'enabled') return true;
        if (s === 'no' || s === 'false' || s === '0' || s === 'inactive' || s === 'disabled') return false;
        return fallback;
    }

    /**
     * Maps raw input object headers to canonical attribute keys using synonyms
     */
    function mapRowToCanonical(rawRow) {
        const mapped = {};
        const rawKeys = Object.keys(rawRow);

        for (const attr of ROLE_PERMISSION_ATTRIBUTES) {
            let matchedValue = undefined;

            for (const rawKey of rawKeys) {
                const normRaw = normalizeHeaderKey(rawKey);

                // Exact key match
                if (normRaw === normalizeHeaderKey(attr.key)) {
                    matchedValue = rawRow[rawKey];
                    break;
                }

                // Check synonyms
                if (attr.synonyms) {
                    const isSynonym = attr.synonyms.some(syn => normalizeHeaderKey(syn) === normRaw);
                    if (isSynonym) {
                        matchedValue = rawRow[rawKey];
                        break;
                    }
                }
            }

            if (matchedValue !== undefined && matchedValue !== '') {
                mapped[attr.key] = matchedValue;
            } else if (attr.defaultValue !== undefined) {
                mapped[attr.key] = attr.defaultValue;
            } else {
                mapped[attr.key] = '';
            }
        }

        return mapped;
    }

    /**
     * Validates and sanitizes a mapped row according to the 13-attribute schema
     */
    function validateAndSanitizeRecord(canonicalRow, rowIndex = 1, options = {}) {
        const errors = [];
        const rawCode = String(canonicalRow.Role_Code_or_Employee_Code || '').trim();

        if (!rawCode) {
            errors.push(`Row ${rowIndex}: Missing required Role_Code_or_Employee_Code`);
        }

        const targetType = resolveTargetEntityType(rawCode);
        const codeUpper = rawCode.toUpperCase();
        const roleName = String(canonicalRow.Role_Name || '').trim() || (targetType === 'BASE_ROLE' ? codeUpper : `Override for ${codeUpper}`);
        const description = String(canonicalRow.Description || '').trim();
        const scopeLevel = sanitizeScopeLevel(canonicalRow.Scope_Level);
        const isActive = parseBoolean(canonicalRow.Active, true);

        // Sanitize all 8 modules
        const modules = {
            employee: sanitizeModulePermission(canonicalRow.Employee_Module),
            attendance: sanitizeModulePermission(canonicalRow.Attendance_Module),
            leave: sanitizeModulePermission(canonicalRow.Leave_Module),
            payroll: sanitizeModulePermission(canonicalRow.Payroll_Module),
            recruitment: sanitizeModulePermission(canonicalRow.Recruitment_Module),
            assets: sanitizeModulePermission(canonicalRow.Assets_Module),
            reports: sanitizeModulePermission(canonicalRow.Reports_Module),
            organizationSetup: sanitizeModulePermission(canonicalRow.Organization_Setup)
        };

        // SUPER ADMIN IMMUTABLE LOCK:
        // Super admin must ALWAYS possess full access across all 8 modules and global scope.
        const isSuperAdmin = (codeUpper === 'ROLE_SUPER_ADMIN' || codeUpper === 'ROLE_SUPERADMIN' || roleName.toLowerCase() === 'super administrator');

        if (isSuperAdmin) {
            modules.employee = 'Full';
            modules.attendance = 'Full';
            modules.leave = 'Full';
            modules.payroll = 'Full';
            modules.recruitment = 'Full';
            modules.assets = 'Full';
            modules.reports = 'Full';
            modules.organizationSetup = 'Full';
        }

        // Validate foreign key if employee override
        if (targetType === 'EMPLOYEE_OVERRIDE' && options.existingEmployeeIds) {
            const empSet = options.existingEmployeeIds instanceof Set 
                ? options.existingEmployeeIds 
                : new Set(Array.from(options.existingEmployeeIds).map(id => String(id).toUpperCase().trim()));

            if (empSet.size > 0 && !empSet.has(codeUpper)) {
                // If options.strictEmployeeCheck is true, throw error, else add warning
                if (options.strictEmployeeCheck) {
                    errors.push(`Row ${rowIndex}: Employee ID '${codeUpper}' not found in employee master.`);
                }
            }
        }

        // Build standardized Cloud Firestore document representation
        const sanitizedDoc = {
            targetType: isSuperAdmin ? 'BASE_ROLE' : targetType,
            roleCode: codeUpper,
            employeeId: targetType === 'EMPLOYEE_OVERRIDE' && !isSuperAdmin ? codeUpper : null,
            roleName: isSuperAdmin ? 'Super Administrator' : roleName,
            description: description,
            scopeLevel: isSuperAdmin ? 'Global' : scopeLevel,
            modules: modules,
            isActive: isSuperAdmin ? true : isActive,
            isImmutable: isSuperAdmin ? true : false,
            sourceRow: rowIndex
        };

        return {
            isValid: errors.length === 0,
            errors: errors,
            data: sanitizedDoc,
            raw: canonicalRow
        };
    }

    /**
     * Parses the Role Permission sheet from a SheetJS workbook or raw JSON array
     * 
     * @param {Object|Array} workbookOrData - XLSX workbook or Array of row objects
     * @param {Object} [options] - Parsing and validation options
     * @returns {Object} Parse result summary, validated docs, and errors
     */
    function parseRolePermissionSheet(workbookOrData, options = {}) {
        let rawRows = [];
        let detectedSheetName = null;

        if (Array.isArray(workbookOrData)) {
            rawRows = workbookOrData;
            detectedSheetName = 'RawArray';
        } else if (workbookOrData && workbookOrData.SheetNames && workbookOrData.Sheets) {
            // Find matching sheet name
            const sheetNames = workbookOrData.SheetNames;
            for (const candidate of KNOWN_SHEET_NAMES) {
                const found = sheetNames.find(sn => 
                    sn.trim().toLowerCase() === candidate.toLowerCase() ||
                    sn.replace(/[\/\-_ \(\)\.]/g, '').toLowerCase() === candidate.replace(/[\/\-_ \(\)\.]/g, '').toLowerCase()
                );
                if (found) {
                    detectedSheetName = found;
                    break;
                }
            }

            // Fallback: search for sheet containing "role" or "permission" or "rbac"
            if (!detectedSheetName) {
                detectedSheetName = sheetNames.find(sn => {
                    const l = sn.toLowerCase();
                    return l.includes('role') || l.includes('perm') || l.includes('rbac') || l.includes('access');
                });
            }

            if (!detectedSheetName && !options.allowFallbackFirstSheet) {
                return {
                    success: false,
                    sheetFound: false,
                    message: "Could not find a 'Role_Code/Employee Cod' or 'Roles & Permissions' sheet in the uploaded workbook.",
                    docs: [],
                    baseRoles: [],
                    employeeOverrides: [],
                    errors: ["Missing 'Role_Code/Employee Cod' sheet."]
                };
            }

            const activeSheetName = detectedSheetName || sheetNames[0];
            const worksheet = workbookOrData.Sheets[activeSheetName];
            if (!worksheet) {
                return {
                    success: false,
                    sheetFound: false,
                    message: `Sheet '${activeSheetName}' is empty or could not be loaded.`,
                    docs: [],
                    baseRoles: [],
                    employeeOverrides: [],
                    errors: [`Empty worksheet: ${activeSheetName}`]
                };
            }

            if (typeof XLSX !== 'undefined' && XLSX.utils) {
                rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
            } else {
                // If Node.js without global XLSX, try require
                try {
                    const localXlsx = require('xlsx');
                    rawRows = localXlsx.utils.sheet_to_json(worksheet, { defval: "" });
                } catch (e) {
                    throw new Error("XLSX library is not loaded. Please provide an Array or load SheetJS.");
                }
            }
        }

        if (!rawRows || rawRows.length === 0) {
            return {
                success: true,
                sheetFound: true,
                sheetName: detectedSheetName,
                totalRows: 0,
                docs: [],
                baseRoles: [],
                employeeOverrides: [],
                errors: []
            };
        }

        const validDocs = [];
        const baseRoles = [];
        const employeeOverrides = [];
        const allErrors = [];
        const seenCodes = new Map();

        rawRows.forEach((row, index) => {
            const canonical = mapRowToCanonical(row);
            const rowNumber = index + 2; // Accounting for 1-based index and header row
            const validation = validateAndSanitizeRecord(canonical, rowNumber, options);

            if (!validation.isValid) {
                allErrors.push(...validation.errors);
            } else {
                const doc = validation.data;
                const uniqueKey = `${doc.targetType}:${doc.roleCode}`;

                // Deduplicate: Keep latest row or ensure super admin is immutable
                if (seenCodes.has(uniqueKey)) {
                    const existingIndex = seenCodes.get(uniqueKey);
                    // If existing is super admin, ignore downgrade attempts
                    if (validDocs[existingIndex].isImmutable) {
                        return;
                    }
                    validDocs[existingIndex] = doc;
                } else {
                    seenCodes.set(uniqueKey, validDocs.length);
                    validDocs.push(doc);
                }
            }
        });

        // Split into base roles and employee overrides
        validDocs.forEach(d => {
            if (d.targetType === 'BASE_ROLE') {
                baseRoles.push(d);
            } else {
                employeeOverrides.push(d);
            }
        });

        // Ensure default Super Admin exists if none provided
        const hasSuperAdmin = validDocs.some(d => d.roleCode === 'ROLE_SUPER_ADMIN');
        if (!hasSuperAdmin && options.autoSeedSuperAdmin !== false) {
            const defaultSuperAdmin = {
                targetType: 'BASE_ROLE',
                roleCode: 'ROLE_SUPER_ADMIN',
                employeeId: null,
                roleName: 'Super Administrator',
                description: 'Immutable system owner and organization supervisor',
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
                isImmutable: true,
                sourceRow: 0
            };
            validDocs.unshift(defaultSuperAdmin);
            baseRoles.unshift(defaultSuperAdmin);
        }

        return {
            success: allErrors.length === 0,
            sheetFound: true,
            sheetName: detectedSheetName,
            totalRows: rawRows.length,
            validCount: validDocs.length,
            baseRolesCount: baseRoles.length,
            employeeOverridesCount: employeeOverrides.length,
            docs: validDocs,
            baseRoles: baseRoles,
            employeeOverrides: employeeOverrides,
            errors: allErrors
        };
    }

    return {
        ROLE_PERMISSION_ATTRIBUTES,
        ALLOWED_SCOPES,
        ALLOWED_MODULE_PERMISSIONS,
        HEADER_SYNONYMS,
        KNOWN_SHEET_NAMES,
        resolveTargetEntityType,
        sanitizeScopeLevel,
        sanitizeModulePermission,
        parseBoolean,
        mapRowToCanonical,
        validateAndSanitizeRecord,
        parseRolePermissionSheet
    };
}));
