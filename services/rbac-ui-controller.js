/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - RBAC & PERMISSION OVERRIDES UI CONTROLLER
 * ============================================================================
 * 
 * Renders the two-tabbed Admin Permissions Console:
 * - Tab 1: "System Roles" (Standard base roles and scope settings).
 * - Tab 2: "User Overrides" (Direct grant of elevated module privileges to specific
 *          employees without changing their formal job title).
 * 
 * Features:
 * - Interactive Matrix Grid with color-coded capability badges
 * - Employee search autocomplete for employee-specific overrides
 * - Real-time add/edit modal for Base Roles and User Overrides
 * - Super Admin immutable lock visual indicator
 * - Dual persistence to Cloud Firestore & in-memory rbacService
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
        root.KylrxRbacUIController = factory();
        root.rbacUIController = root.KylrxRbacUIController;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Mock/Fallback Employee Master for search autocomplete if Firestore is offline
    const MOCK_EMPLOYEES = [
        { employeeId: "EMP0001", name: "Ananya Sharma", department: "Engineering", designation: "VP of Engineering" },
        { employeeId: "EMP0002", name: "Vikram Malhotra", department: "Operations", designation: "Chief Operating Officer" },
        { employeeId: "EMP0003", name: "Priya Nair", department: "Human Resources", designation: "Head of People & Culture" },
        { employeeId: "EMP0004", name: "Rohan Verma", department: "Finance", designation: "Head of Financial Comptroller" },
        { employeeId: "EMP0005", name: "Sneha Patel", department: "Operations", designation: "Director of Global Operations" },
        { employeeId: "EMP0006", name: "Kavita Rao", department: "Engineering", designation: "Frontend Platform Architect" },
        { employeeId: "EMP0007", name: "Amitabh Sen", department: "Engineering", designation: "Cloud & API Tech Lead" },
        { employeeId: "EMP0012", name: "Karan Johar", department: "Finance", designation: "Internal Asset Auditor" }
    ];

    const MODULE_COLUMNS = [
        { key: 'employee', label: 'Employee' },
        { key: 'attendance', label: 'Attendance' },
        { key: 'leave', label: 'Leave' },
        { key: 'payroll', label: 'Payroll' },
        { key: 'recruitment', label: 'Recruitment' },
        { key: 'assets', label: 'Assets' },
        { key: 'reports', label: 'Reports' },
        { key: 'organizationSetup', label: 'Org Setup' }
    ];

    /**
     * Returns color styles for module permission badges
     */
    function getBadgeStyle(permission) {
        const val = String(permission || 'None').toUpperCase();
        switch (val) {
            case 'FULL':
                return 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-weight: 800;';
            case 'EDIT':
                return 'background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-weight: 700;';
            case 'APPROVE':
                return 'background: #f3e8ff; color: #6b21a8; border: 1px solid #e9d5ff; font-weight: 700;';
            case 'VIEW':
                return 'background: #eff6ff; color: #1e40af; border: 1px solid #dbeafe; font-weight: 600;';
            case 'EXPORT':
                return 'background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-weight: 700;';
            case 'ALLOCATE':
                return 'background: #fef9c3; color: #854d0e; border: 1px solid #fef08a; font-weight: 700;';
            case 'DISBURSE_ONLY':
                return 'background: #ccfbf1; color: #115e59; border: 1px solid #99f6e4; font-weight: 700;';
            case 'SELF':
                return 'background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; font-weight: 600;';
            case 'NONE':
            default:
                return 'background: #f8fafc; color: #94a3b8; border: 1px solid #e2e8f0; font-weight: 500;';
        }
    }

    /**
     * Renders the complete RBAC Console inside the specified container
     */
    function renderAdminConsole(containerId = 'settingsRbacContainer', orgId = 'org_kylrx') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const rbac = window.KylrxRBACService || (typeof require !== 'undefined' ? require('../rbacService.js') : null);
        const roles = rbac ? rbac.getAllRoles() : [];
        const overrides = rbac ? rbac.getAllOverrides() : [];

        container.innerHTML = `
            <div style="background: white; border: 1.5px solid #3b82f6; border-radius: 24px; padding: 2rem; box-shadow: var(--shadow); margin-bottom: 2rem;">
                <!-- Header with Title and Global Stats -->
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 1.25rem; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 48px; height: 48px; border-radius: 14px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-size: 1.4rem;">
                            <i data-lucide="shield-check" style="width: 26px; height: 26px;"></i>
                        </div>
                        <div>
                            <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;">RBAC &amp; Permission Overrides Console</h2>
                            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 3px 0 0 0;">
                                Hybrid Role-Based Access Control and Employee Privilege Overrides (PRD §§ 1, 14, 17, &amp; 18)
                            </p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn btn-outline" id="btnExportRbacMatrix" style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.82rem; padding: 8px 14px;">
                            <i data-lucide="download" style="width: 14px; height: 14px;"></i> Export RBAC
                        </button>
                    </div>
                </div>

                <!-- Summary Cards -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="background: #eff6ff; border: 1px solid #dbeafe; border-radius: 14px; padding: 1rem;">
                        <span style="font-size: 0.7rem; font-weight: 800; color: #1e40af; text-transform: uppercase;">Standard Roles</span>
                        <p style="font-size: 1.4rem; font-weight: 800; color: #2563eb; margin: 4px 0 0 0;" id="statTotalRoles">${roles.length}</p>
                    </div>
                    <div style="background: #fdf2f8; border: 1px solid #fce7f3; border-radius: 14px; padding: 1rem;">
                        <span style="font-size: 0.7rem; font-weight: 800; color: #9d174d; text-transform: uppercase;">Active Overrides</span>
                        <p style="font-size: 1.4rem; font-weight: 800; color: #be185d; margin: 4px 0 0 0;" id="statTotalOverrides">${overrides.length}</p>
                    </div>
                    <div style="background: #f0fdf4; border: 1px solid #dcfce7; border-radius: 14px; padding: 1rem;">
                        <span style="font-size: 0.7rem; font-weight: 800; color: #166534; text-transform: uppercase;">Super Admin Lock</span>
                        <p style="font-size: 1.4rem; font-weight: 800; color: #15803d; margin: 4px 0 0 0;">Active (Immutable)</p>
                    </div>
                    <div style="background: #faf5ff; border: 1px solid #f3e8ff; border-radius: 14px; padding: 1rem;">
                        <span style="font-size: 0.7rem; font-weight: 800; color: #7e22ce; text-transform: uppercase;">Governed Modules</span>
                        <p style="font-size: 1.4rem; font-weight: 800; color: #9333ea; margin: 4px 0 0 0;">8 Modules</p>
                    </div>
                </div>

                <!-- 2-Tab Navigation Switcher -->
                <div style="display: flex; gap: 8px; border-bottom: 2px solid var(--border); margin-bottom: 1.5rem; padding-bottom: 0.25rem;">
                    <button type="button" class="tab-btn active" id="tabBtnSystemRoles" style="padding: 10px 20px; font-weight: 700; border: none; background: none; border-bottom: 3px solid #3b82f6; color: #2563eb; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="shield" style="width: 16px; height: 16px;"></i> Tab 1: System Roles
                    </button>
                    <button type="button" class="tab-btn" id="tabBtnUserOverrides" style="padding: 10px 20px; font-weight: 700; border: none; background: none; border-bottom: 3px solid transparent; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="user-check" style="width: 16px; height: 16px;"></i> Tab 2: User Overrides
                    </button>
                </div>

                <!-- Tab 1 View: System Roles -->
                <div id="viewSystemRoles" style="display: block;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <h3 style="font-size: 1rem; font-weight: 800; margin: 0; color: #0f172a;">Standard System Roles</h3>
                            <p style="font-size: 0.75rem; color: var(--text-muted); margin: 2px 0 0 0;">Default base profiles defining organizational scope and core module entitlements.</p>
                        </div>
                        <button type="button" class="btn btn-primary" id="btnAddNewRole" style="padding: 8px 16px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">
                            <i data-lucide="plus-circle" style="width: 16px; height: 16px;"></i> Add System Role
                        </button>
                    </div>

                    <div style="overflow-x: auto; border: 1px solid var(--border); border-radius: 16px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: left;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1px solid var(--border);">
                                    <th style="padding: 12px 14px; font-weight: 800;">Role Code</th>
                                    <th style="padding: 12px 14px; font-weight: 800;">Role Title</th>
                                    <th style="padding: 12px 14px; font-weight: 800;">Scope</th>
                                    ${MODULE_COLUMNS.map(col => `<th style="padding: 12px 10px; font-weight: 800; text-align: center;">${col.label}</th>`).join('')}
                                    <th style="padding: 12px 14px; font-weight: 800; text-align: center;">Status</th>
                                    <th style="padding: 12px 14px; font-weight: 800; text-align: right;">Action</th>
                                </tr>
                            </thead>
                            <tbody id="tbodySystemRoles">
                                ${renderRoleRows(roles)}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Tab 2 View: User Overrides -->
                <div id="viewUserOverrides" style="display: none;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <h3 style="font-size: 1rem; font-weight: 800; margin: 0; color: #0f172a;">Employee-Specific Permission Overrides</h3>
                            <p style="font-size: 0.75rem; color: var(--text-muted); margin: 2px 0 0 0;">
                                Direct grant of elevated privileges to specific employees without changing their formal job title.
                            </p>
                        </div>
                        <button type="button" class="btn btn-primary" id="btnAddNewOverride" style="padding: 8px 16px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; background: #ec4899; border-color: #db2777;">
                            <i data-lucide="user-plus" style="width: 16px; height: 16px;"></i> Grant Employee Override
                        </button>
                    </div>

                    <!-- Search Autocomplete & Filter Bar -->
                    <div style="margin-bottom: 1rem; position: relative;">
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <div style="position: relative; flex: 1;">
                                <i data-lucide="search" style="position: absolute; left: 14px; top: 12px; width: 16px; height: 16px; color: var(--text-muted);"></i>
                                <input type="text" id="overrideSearchInput" placeholder="Search by Employee ID or Name (e.g. EMP0001, EMP0012, Ananya...)" 
                                    style="width: 100%; padding: 10px 14px 10px 38px; border: 1px solid var(--border); border-radius: 12px; font-size: 0.85rem; outline: none;">
                            </div>
                        </div>
                        <!-- Autocomplete Suggestions Dropdown -->
                        <div id="employeeAutocompleteDropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-lg); z-index: 50; max-height: 220px; overflow-y: auto; margin-top: 4px;">
                        </div>
                    </div>

                    <div style="overflow-x: auto; border: 1px solid var(--border); border-radius: 16px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: left;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1px solid var(--border);">
                                    <th style="padding: 12px 14px; font-weight: 800;">Employee ID</th>
                                    <th style="padding: 12px 14px; font-weight: 800;">Target Name / Title</th>
                                    <th style="padding: 12px 14px; font-weight: 800;">Scope</th>
                                    ${MODULE_COLUMNS.map(col => `<th style="padding: 12px 10px; font-weight: 800; text-align: center;">${col.label}</th>`).join('')}
                                    <th style="padding: 12px 14px; font-weight: 800; text-align: center;">Status</th>
                                    <th style="padding: 12px 14px; font-weight: 800; text-align: right;">Action</th>
                                </tr>
                            </thead>
                            <tbody id="tbodyUserOverrides">
                                ${renderOverrideRows(overrides)}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Modal for Add/Edit Role or Override -->
            <div id="rbacModal" style="display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(4px); z-index: 1000; align-items: center; justify-content: center; padding: 1.5rem;">
                <div style="background: white; border-radius: 20px; width: 100%; max-width: 680px; max-height: 90vh; overflow-y: auto; padding: 2rem; box-shadow: var(--shadow-lg); position: relative;">
                    <button type="button" id="btnRbacModalClose" style="position: absolute; right: 20px; top: 20px; background: none; border: none; font-size: 1.25rem; color: var(--text-muted); cursor: pointer;">
                        <i data-lucide="x"></i>
                    </button>
                    <h3 id="rbacModalTitle" style="font-size: 1.2rem; font-weight: 800; margin-bottom: 0.5rem; color: #0f172a;">Configure Permission Profile</h3>
                    <p id="rbacModalSubtitle" style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.5rem;">Set modular authorizations and access boundary.</p>

                    <form id="rbacModalForm">
                        <input type="hidden" id="modalTargetType" value="BASE_ROLE">

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                            <div>
                                <label style="font-size: 0.78rem; font-weight: 700; color: #334155; display: block; margin-bottom: 4px;" id="modalCodeLabel">Role Code *</label>
                                <input type="text" id="modalCodeInput" required style="width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem; font-family: monospace; text-transform: uppercase;">
                            </div>
                            <div>
                                <label style="font-size: 0.78rem; font-weight: 700; color: #334155; display: block; margin-bottom: 4px;">Display Title *</label>
                                <input type="text" id="modalTitleInput" required style="width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                            <div>
                                <label style="font-size: 0.78rem; font-weight: 700; color: #334155; display: block; margin-bottom: 4px;">Scope Level *</label>
                                <select id="modalScopeSelect" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem;">
                                    <option value="Global">Global (All Tenancy)</option>
                                    <option value="Business_Unit">Business Unit</option>
                                    <option value="Department">Department</option>
                                    <option value="Location">Location</option>
                                    <option value="Self">Self (Individual Only)</option>
                                </select>
                            </div>
                            <div>
                                <label style="font-size: 0.78rem; font-weight: 700; color: #334155; display: block; margin-bottom: 4px;">Active Status</label>
                                <select id="modalActiveSelect" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem;">
                                    <option value="true">Active (Enabled)</option>
                                    <option value="false">Inactive (Disabled)</option>
                                </select>
                            </div>
                        </div>

                        <div style="margin-bottom: 1.5rem;">
                            <label style="font-size: 0.78rem; font-weight: 700; color: #334155; display: block; margin-bottom: 4px;">Description / Scope Notes</label>
                            <textarea id="modalDescInput" rows="2" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem;" placeholder="Scope and authorization notes..."></textarea>
                        </div>

                        <h4 style="font-size: 0.85rem; font-weight: 800; color: #0f172a; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">
                            Module Capabilities Matrix
                        </h4>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1.5rem;">
                            ${MODULE_COLUMNS.map(col => `
                                <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border);">
                                    <span style="font-size: 0.8rem; font-weight: 700; color: #334155;">${col.label}</span>
                                    <select class="modal-module-select" data-module="${col.key}" style="padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); font-size: 0.78rem; background: white;">
                                        <option value="Full">Full</option>
                                        <option value="Edit">Edit</option>
                                        <option value="Approve">Approve</option>
                                        <option value="View">View</option>
                                        <option value="Disburse_Only">Disburse Only</option>
                                        <option value="Allocate">Allocate</option>
                                        <option value="Export">Export</option>
                                        <option value="Self">Self</option>
                                        <option value="None">None</option>
                                    </select>
                                </div>
                            `).join('')}
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border); padding-top: 1.25rem;">
                            <button type="button" class="btn btn-outline" id="btnModalCancel" style="padding: 8px 16px;">Cancel</button>
                            <button type="submit" class="btn btn-primary" id="btnModalSave" style="padding: 8px 20px;">Save Profile</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        if (window.lucide) lucide.createIcons();
        wireConsoleEvents(container, orgId);
    }

    /**
     * Renders table rows for Base Roles
     */
    function renderRoleRows(roles) {
        if (!roles || roles.length === 0) {
            return `<tr><td colspan="12" style="text-align: center; padding: 2rem; color: var(--text-muted);">No system roles configured.</td></tr>`;
        }

        return roles.map(role => {
            const isSuper = role.roleCode === 'ROLE_SUPER_ADMIN' || role.isImmutable;
            return `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 10px 14px; font-weight: 800; font-family: monospace;">
                        ${role.roleCode}
                        ${isSuper ? '<span style="font-size: 0.65rem; background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 6px; margin-left: 6px; font-weight: 800;">LOCKED</span>' : ''}
                    </td>
                    <td style="padding: 10px 14px; font-weight: 600;">${role.roleName}</td>
                    <td style="padding: 10px 14px;">
                        <span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 8px; background: #f1f5f9; color: #475569; font-weight: 700;">
                            ${role.scopeLevel}
                        </span>
                    </td>
                    ${MODULE_COLUMNS.map(col => {
                        const perm = role.modules ? (role.modules[col.key] || 'None') : 'None';
                        return `<td style="padding: 8px 6px; text-align: center;">
                            <span style="font-size: 0.68rem; padding: 2px 6px; border-radius: 6px; display: inline-block; ${getBadgeStyle(perm)}">
                                ${perm}
                            </span>
                        </td>`;
                    }).join('')}
                    <td style="padding: 10px 14px; text-align: center;">
                        <span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 8px; font-weight: 700; ${role.isActive ? 'background: #dcfce7; color: #15803d;' : 'background: #fee2e2; color: #b91c1c;'}">
                            ${role.isActive ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td style="padding: 10px 14px; text-align: right;">
                        ${isSuper 
                            ? '<span style="font-size: 0.72rem; color: var(--text-muted); font-style: italic;">Immutable</span>' 
                            : `<button type="button" class="btn-edit-role" data-code="${role.roleCode}" style="background: none; border: none; color: #2563eb; cursor: pointer; font-weight: 700; font-size: 0.78rem;">Edit</button>`
                        }
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Renders table rows for Employee Overrides
     */
    function renderOverrideRows(overrides) {
        if (!overrides || overrides.length === 0) {
            return `<tr><td colspan="12" style="text-align: center; padding: 2rem; color: var(--text-muted);">No employee overrides configured.</td></tr>`;
        }

        return overrides.map(ov => {
            const empId = ov.employeeId || ov.roleCode;
            const empName = ov.roleName || `Override for ${empId}`;
            return `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 10px 14px; font-weight: 800; font-family: monospace; color: #be185d;">${empId}</td>
                    <td style="padding: 10px 14px; font-weight: 600;">${empName}</td>
                    <td style="padding: 10px 14px;">
                        <span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 8px; background: #fdf2f8; color: #9d174d; font-weight: 700;">
                            ${ov.scopeLevel || 'Global'}
                        </span>
                    </td>
                    ${MODULE_COLUMNS.map(col => {
                        const perm = ov.modules ? (ov.modules[col.key] || 'None') : 'None';
                        return `<td style="padding: 8px 6px; text-align: center;">
                            <span style="font-size: 0.68rem; padding: 2px 6px; border-radius: 6px; display: inline-block; ${getBadgeStyle(perm)}">
                                ${perm}
                            </span>
                        </td>`;
                    }).join('')}
                    <td style="padding: 10px 14px; text-align: center;">
                        <span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 8px; font-weight: 700; ${ov.isActive !== false ? 'background: #dcfce7; color: #15803d;' : 'background: #fee2e2; color: #b91c1c;'}">
                            ${ov.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td style="padding: 10px 14px; text-align: right; white-space: nowrap;">
                        <button type="button" class="btn-edit-override" data-empid="${empId}" style="background: none; border: none; color: #2563eb; cursor: pointer; font-weight: 700; font-size: 0.78rem; margin-right: 8px;">Edit</button>
                        <button type="button" class="btn-delete-override" data-empid="${empId}" style="background: none; border: none; color: #ef4444; cursor: pointer; font-weight: 700; font-size: 0.78rem;">Revoke</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Wires interactive event listeners for tabs, modals, and autocomplete
     */
    function wireConsoleEvents(container, orgId) {
        const tabBtnRoles = container.querySelector('#tabBtnSystemRoles');
        const tabBtnOverrides = container.querySelector('#tabBtnUserOverrides');
        const viewRoles = container.querySelector('#viewSystemRoles');
        const viewOverrides = container.querySelector('#viewUserOverrides');

        const modal = container.querySelector('#rbacModal');
        const modalForm = container.querySelector('#rbacModalForm');
        const modalTitle = container.querySelector('#rbacModalTitle');
        const modalCodeLabel = container.querySelector('#modalCodeLabel');
        const modalCodeInput = container.querySelector('#modalCodeInput');
        const modalTitleInput = container.querySelector('#modalTitleInput');
        const modalScopeSelect = container.querySelector('#modalScopeSelect');
        const modalActiveSelect = container.querySelector('#modalActiveSelect');
        const modalDescInput = container.querySelector('#modalDescInput');
        const modalTargetType = container.querySelector('#modalTargetType');

        const searchInput = container.querySelector('#overrideSearchInput');
        const dropdown = container.querySelector('#employeeAutocompleteDropdown');

        // Tab Switching
        tabBtnRoles?.addEventListener('click', () => {
            tabBtnRoles.style.borderBottomColor = '#3b82f6';
            tabBtnRoles.style.color = '#2563eb';
            tabBtnOverrides.style.borderBottomColor = 'transparent';
            tabBtnOverrides.style.color = 'var(--text-muted)';
            viewRoles.style.display = 'block';
            viewOverrides.style.display = 'none';
        });

        tabBtnOverrides?.addEventListener('click', () => {
            tabBtnOverrides.style.borderBottomColor = '#ec4899';
            tabBtnOverrides.style.color = '#db2777';
            tabBtnRoles.style.borderBottomColor = 'transparent';
            tabBtnRoles.style.color = 'var(--text-muted)';
            viewRoles.style.display = 'none';
            viewOverrides.style.display = 'block';
        });

        // Search Autocomplete for Employee Overrides
        searchInput?.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            if (!query) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
                return;
            }

            const matches = MOCK_EMPLOYEES.filter(emp => 
                emp.employeeId.toLowerCase().includes(query) ||
                emp.name.toLowerCase().includes(query) ||
                emp.department.toLowerCase().includes(query)
            );

            if (matches.length === 0) {
                dropdown.innerHTML = `<div style="padding: 10px 14px; font-size: 0.8rem; color: var(--text-muted);">No employees found matching '${query}'</div>`;
                dropdown.style.display = 'block';
            } else {
                dropdown.innerHTML = matches.map(emp => `
                    <div class="emp-autocomplete-item" data-empid="${emp.employeeId}" data-name="${emp.name}" data-dept="${emp.department}"
                        style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong style="color: #0f172a; font-size: 0.82rem;">${emp.name}</strong>
                            <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 6px;">(${emp.employeeId})</span>
                            <div style="font-size: 0.72rem; color: #64748b;">${emp.department} • ${emp.designation}</div>
                        </div>
                        <button type="button" style="padding: 4px 10px; font-size: 0.72rem; border-radius: 6px; background: #fdf2f8; color: #be185d; border: 1px solid #fbcfe8; font-weight: 700;">Select</button>
                    </div>
                `).join('');
                dropdown.style.display = 'block';

                dropdown.querySelectorAll('.emp-autocomplete-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const empId = item.getAttribute('data-empid');
                        const name = item.getAttribute('data-name');
                        searchInput.value = `${empId} - ${name}`;
                        dropdown.style.display = 'none';
                        openOverrideModalForEmployee(empId, name);
                    });
                });
            }
        });

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (dropdown && !dropdown.contains(e.target) && e.target !== searchInput) {
                dropdown.style.display = 'none';
            }
        });

        function openOverrideModalForEmployee(empId, name) {
            const rbac = window.KylrxRBACService;
            const existing = rbac ? rbac.getOverride(empId) : null;

            modalTitle.textContent = `Grant Override: ${empId}`;
            modalCodeLabel.textContent = "Employee ID (Target)";
            modalTargetType.value = "EMPLOYEE_OVERRIDE";
            modalCodeInput.value = empId;
            modalCodeInput.readOnly = true;
            modalTitleInput.value = existing ? existing.roleName : `Elevated Override: ${name}`;
            modalScopeSelect.value = existing ? existing.scopeLevel : "Global";
            modalActiveSelect.value = existing ? String(existing.isActive !== false) : "true";
            modalDescInput.value = existing ? (existing.description || '') : `Special permissions granted to ${name} (${empId})`;

            // Set module dropdowns
            modal.querySelectorAll('.modal-module-select').forEach(sel => {
                const modKey = sel.getAttribute('data-module');
                sel.value = existing && existing.modules ? (existing.modules[modKey] || 'None') : 'None';
            });

            modal.style.display = 'flex';
        }

        // Add New Role Button
        container.querySelector('#btnAddNewRole')?.addEventListener('click', () => {
            modalTitle.textContent = "Create New System Role";
            modalCodeLabel.textContent = "Role Code (e.g. ROLE_OPERATIONS)";
            modalTargetType.value = "BASE_ROLE";
            modalCodeInput.value = "ROLE_";
            modalCodeInput.readOnly = false;
            modalTitleInput.value = "";
            modalScopeSelect.value = "Department";
            modalActiveSelect.value = "true";
            modalDescInput.value = "";

            modal.querySelectorAll('.modal-module-select').forEach(sel => {
                sel.value = "None";
            });

            modal.style.display = 'flex';
        });

        // Add New Override Button
        container.querySelector('#btnAddNewOverride')?.addEventListener('click', () => {
            modalTitle.textContent = "Grant Employee Override";
            modalCodeLabel.textContent = "Employee ID (e.g. EMP0012)";
            modalTargetType.value = "EMPLOYEE_OVERRIDE";
            modalCodeInput.value = "EMP";
            modalCodeInput.readOnly = false;
            modalTitleInput.value = "Custom Employee Override";
            modalScopeSelect.value = "Global";
            modalActiveSelect.value = "true";
            modalDescInput.value = "";

            modal.querySelectorAll('.modal-module-select').forEach(sel => {
                sel.value = "None";
            });

            modal.style.display = 'flex';
        });

        // Modal Close
        container.querySelector('#btnRbacModalClose')?.addEventListener('click', () => {
            modal.style.display = 'none';
        });
        container.querySelector('#btnModalCancel')?.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        // Modal Form Submit
        modalForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            const rbac = window.KylrxRBACService;
            if (!rbac) return;

            const targetType = modalTargetType.value;
            const code = modalCodeInput.value.trim().toUpperCase();
            const title = modalTitleInput.value.trim();
            const scope = modalScopeSelect.value;
            const isActive = modalActiveSelect.value === 'true';
            const desc = modalDescInput.value.trim();

            const modules = {};
            modal.querySelectorAll('.modal-module-select').forEach(sel => {
                const modKey = sel.getAttribute('data-module');
                modules[modKey] = sel.value;
            });

            if (targetType === 'BASE_ROLE') {
                rbac.saveRole({
                    targetType: 'BASE_ROLE',
                    roleCode: code,
                    roleName: title,
                    scopeLevel: scope,
                    modules: modules,
                    description: desc,
                    isActive: isActive
                });
            } else {
                rbac.saveOverride({
                    targetType: 'EMPLOYEE_OVERRIDE',
                    employeeId: code,
                    roleCode: code,
                    roleName: title,
                    scopeLevel: scope,
                    modules: modules,
                    description: desc,
                    isActive: isActive
                });
            }

            modal.style.display = 'none';
            renderAdminConsole(container.id, orgId);
            if (window.showCustomAlert) {
                window.showCustomAlert("Permission Profile Saved", `Successfully updated permissions for ${code}!`, "success");
            }
        });

        // Edit Base Role Click
        container.querySelectorAll('.btn-edit-role').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.getAttribute('data-code');
                const rbac = window.KylrxRBACService;
                const role = rbac ? rbac.getRole(code) : null;
                if (!role) return;

                modalTitle.textContent = `Edit System Role: ${role.roleCode}`;
                modalCodeLabel.textContent = "Role Code";
                modalTargetType.value = "BASE_ROLE";
                modalCodeInput.value = role.roleCode;
                modalCodeInput.readOnly = true;
                modalTitleInput.value = role.roleName;
                modalScopeSelect.value = role.scopeLevel;
                modalActiveSelect.value = String(role.isActive !== false);
                modalDescInput.value = role.description || '';

                modal.querySelectorAll('.modal-module-select').forEach(sel => {
                    const modKey = sel.getAttribute('data-module');
                    sel.value = role.modules ? (role.modules[modKey] || 'None') : 'None';
                });

                modal.style.display = 'flex';
            });
        });

        // Edit Override Click
        container.querySelectorAll('.btn-edit-override').forEach(btn => {
            btn.addEventListener('click', () => {
                const empId = btn.getAttribute('data-empid');
                const rbac = window.KylrxRBACService;
                const ov = rbac ? rbac.getOverride(empId) : null;
                if (!ov) return;

                modalTitle.textContent = `Edit Override: ${empId}`;
                modalCodeLabel.textContent = "Employee ID";
                modalTargetType.value = "EMPLOYEE_OVERRIDE";
                modalCodeInput.value = empId;
                modalCodeInput.readOnly = true;
                modalTitleInput.value = ov.roleName;
                modalScopeSelect.value = ov.scopeLevel || 'Global';
                modalActiveSelect.value = String(ov.isActive !== false);
                modalDescInput.value = ov.description || '';

                modal.querySelectorAll('.modal-module-select').forEach(sel => {
                    const modKey = sel.getAttribute('data-module');
                    sel.value = ov.modules ? (ov.modules[modKey] || 'None') : 'None';
                });

                modal.style.display = 'flex';
            });
        });

        // Delete Override Click
        container.querySelectorAll('.btn-delete-override').forEach(btn => {
            btn.addEventListener('click', () => {
                const empId = btn.getAttribute('data-empid');
                if (confirm(`Revoke permission override for employee ${empId}? Their access will immediately revert to their base role.`)) {
                    const rbac = window.KylrxRBACService;
                    if (rbac) {
                        rbac.deleteOverride(empId);
                        renderAdminConsole(container.id, orgId);
                    }
                }
            });
        });
    }

    return {
        MODULE_COLUMNS,
        renderAdminConsole,
        getBadgeStyle,
        renderRoleRows,
        renderOverrideRows
    };
}));
