/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - COMPANY POLICIES & COMPLIANCE UI CONTROLLER
 * ============================================================================
 * Powers the Admin Settings & Dashboard "Company Policies & Compliance" Console
 * (PRD Sections 1, 10, 13, 17, & 18).
 *
 * Capabilities:
 *  1. Real-time Compliance Tracker Pulse (Compliant %, Pending, Overdue KPI cards)
 *  2. Tabular Policy Catalog with search, status toggles, and targeting badge filters
 *  3. Interactive CRUD Modal (Policy Code, Name, Version, Type, Due Days, Category, Location, PDF)
 *  4. Direct PDF Upload to Firebase Storage: `organizations/{orgId}/policies/{policyCode}_{version}.pdf`
 *  5. Immediate Preview via ESS Policy Viewer Modal
 * ============================================================================
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./companyPolicyService', './companyPolicyViewerModal'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./companyPolicyService'), require('./companyPolicyViewerModal'));
    } else {
        root.KylrxCompanyPoliciesUIController = factory(
            root.KylrxCompanyPolicyService || root.companyPolicyService,
            root.KylrxPolicyViewerModal || root.companyPolicyViewerModal
        );
        root.companyPoliciesUIController = root.KylrxCompanyPoliciesUIController;
    }
}(typeof self !== 'undefined' ? self : this, function (policyService, viewerModal) {
    'use strict';

    let currentOrgId = 'org_kylrx_default';
    let currentPolicies = [];
    let currentFilter = 'ALL';
    let searchQuery = '';

    function escapeHtml(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Sample mock employees for live compliance pulse calculation in demo / admin view
    const SAMPLE_COMPLIANCE_EMPLOYEES = [
        { employeeId: 'EMP0001', name: 'Vikram Joshi', employmentCategoryCode: 'CAT_FT_REG', locationCode: 'LOC-BLR', department: 'Core Engineering', joiningDate: '2025-01-15' },
        { employeeId: 'EMP0002', name: 'Ananya Deshmukh', employmentCategoryCode: 'CAT_FT_EXEC', locationCode: 'LOC-BLR', department: 'Executive Leadership', joiningDate: '2024-06-01' },
        { employeeId: 'EMP0003', name: 'Rohit Verma', employmentCategoryCode: 'CAT_FT_REG', locationCode: 'LOC-MUM', department: 'Operations', joiningDate: '2025-03-01' },
        { employeeId: 'EMP0004', name: 'Pooja Iyer', employmentCategoryCode: 'CAT_CON_TVC', locationCode: 'LOC-BLR', department: 'QA & Automation', joiningDate: '2025-08-01' },
        { employeeId: 'EMP0005', name: 'Kunal Singhal', employmentCategoryCode: 'CAT_INT_GRAD', locationCode: 'LOC-BLR', department: 'AI Labs', joiningDate: '2026-01-01' }
    ];

    /**
     * Render the Full Company Policies & Compliance Admin Console
     * Container: '#settingsCompanyPoliciesContainer' or any target element
     */
    async function renderAdminConsole(containerId = 'settingsCompanyPoliciesContainer', orgId = 'org_kylrx_default') {
        currentOrgId = orgId;
        const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (!container) return;

        // Fetch current policies
        try {
            currentPolicies = await policyService.listPolicies({ activeOnly: false }, orgId);
        } catch (e) {
            currentPolicies = [];
        }

        // Compute Compliance Pulse
        const pulse = policyService.getCompliancePulse(currentPolicies, SAMPLE_COMPLIANCE_EMPLOYEES);

        container.innerHTML = `
            <div class="company-policies-console" style="display: flex; flex-direction: column; gap: 1.5rem; font-family: inherit;">
                <!-- Header Actions Bar -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <h2 style="font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 10px;">
                            <span>⚖️ Company Policies & Digital Compliance</span>
                            <span style="font-size: 0.72rem; font-weight: 700; background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 6px;">PRD §1, §10, §13, §17 & §18</span>
                        </h2>
                        <p style="font-size: 0.82rem; color: #64748b; margin: 4px 0 0 0;">
                            Cloud Firestore: <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #2563eb; font-weight: 700;">organizations/{orgId}/policies/{policyCode}</code>
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button type="button" class="btn" onclick="window.KylrxCompanyPoliciesUIController.openPolicyEditorModal()" style="background: #2563eb; color: white; padding: 9px 16px; border-radius: 12px; font-weight: 700; font-size: 0.82rem; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 6px -1px rgba(37,99,235,0.25);">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            Add New Policy
                        </button>
                    </div>
                </div>

                <!-- Compliance Tracker Pulse Cards -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem;">
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Overall Compliance</span>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <span style="font-size: 1.75rem; font-weight: 900; color: ${pulse.compliancePercentage >= 80 ? '#166534' : pulse.compliancePercentage >= 50 ? '#b45309' : '#dc2626'};">${pulse.compliancePercentage}%</span>
                            <span style="font-size: 0.75rem; color: #64748b;">signed off</span>
                        </div>
                        <div style="background: #f1f5f9; height: 6px; border-radius: 10px; overflow: hidden; margin-top: 4px;">
                            <div style="background: ${pulse.compliancePercentage >= 80 ? '#10b981' : '#f59e0b'}; height: 100%; width: ${pulse.compliancePercentage}%;"></div>
                        </div>
                    </div>

                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 0.72rem; font-weight: 800; color: #15803d; text-transform: uppercase;">Compliant Sign-offs</span>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <span style="font-size: 1.75rem; font-weight: 900; color: #15803d;">${pulse.totalCompliant}</span>
                            <span style="font-size: 0.75rem; color: #64748b;">/ ${pulse.totalRequiredAssignments} assignments</span>
                        </div>
                        <span style="font-size: 0.72rem; color: #166534;">Verified digital audit trail</span>
                    </div>

                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 0.72rem; font-weight: 800; color: #b45309; text-transform: uppercase;">Pending Signatures</span>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <span style="font-size: 1.75rem; font-weight: 900; color: #b45309;">${pulse.totalPending}</span>
                            <span style="font-size: 0.75rem; color: #64748b;">within SLA window</span>
                        </div>
                        <span style="font-size: 0.72rem; color: #d97706;">Turnaround SLA active</span>
                    </div>

                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 0.72rem; font-weight: 800; color: #dc2626; text-transform: uppercase;">Overdue Violations</span>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <span style="font-size: 1.75rem; font-weight: 900; color: #dc2626;">${pulse.totalOverdue}</span>
                            <span style="font-size: 0.75rem; color: #64748b;">past due date</span>
                        </div>
                        <span style="font-size: 0.72rem; color: #dc2626;">Escalated to HR Monitor</span>
                    </div>
                </div>

                <!-- Filters & Search Toolbar -->
                <div style="display: flex; justify-content: space-between; align-items: center; background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 0.75rem 1.25rem; gap: 1rem; flex-wrap: wrap;">
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <button class="pol-filter-btn ${currentFilter === 'ALL' ? 'active' : ''}" onclick="window.KylrxCompanyPoliciesUIController.setFilter('ALL')" style="padding: 6px 12px; border-radius: 8px; border: 1px solid ${currentFilter === 'ALL' ? '#2563eb' : '#e2e8f0'}; background: ${currentFilter === 'ALL' ? '#eff6ff' : 'white'}; color: ${currentFilter === 'ALL' ? '#1d4ed8' : '#64748b'}; font-weight: 700; font-size: 0.78rem; cursor: pointer;">All Types</button>
                        <button class="pol-filter-btn ${currentFilter === 'Statutory' ? 'active' : ''}" onclick="window.KylrxCompanyPoliciesUIController.setFilter('Statutory')" style="padding: 6px 12px; border-radius: 8px; border: 1px solid ${currentFilter === 'Statutory' ? '#2563eb' : '#e2e8f0'}; background: ${currentFilter === 'Statutory' ? '#eff6ff' : 'white'}; color: ${currentFilter === 'Statutory' ? '#1d4ed8' : '#64748b'}; font-weight: 700; font-size: 0.78rem; cursor: pointer;">Statutory</button>
                        <button class="pol-filter-btn ${currentFilter === 'Code_of_Conduct' ? 'active' : ''}" onclick="window.KylrxCompanyPoliciesUIController.setFilter('Code_of_Conduct')" style="padding: 6px 12px; border-radius: 8px; border: 1px solid ${currentFilter === 'Code_of_Conduct' ? '#2563eb' : '#e2e8f0'}; background: ${currentFilter === 'Code_of_Conduct' ? '#eff6ff' : 'white'}; color: ${currentFilter === 'Code_of_Conduct' ? '#1d4ed8' : '#64748b'}; font-weight: 700; font-size: 0.78rem; cursor: pointer;">Code of Conduct</button>
                        <button class="pol-filter-btn ${currentFilter === 'IT_Security' ? 'active' : ''}" onclick="window.KylrxCompanyPoliciesUIController.setFilter('IT_Security')" style="padding: 6px 12px; border-radius: 8px; border: 1px solid ${currentFilter === 'IT_Security' ? '#2563eb' : '#e2e8f0'}; background: ${currentFilter === 'IT_Security' ? '#eff6ff' : 'white'}; color: ${currentFilter === 'IT_Security' ? '#1d4ed8' : '#64748b'}; font-weight: 700; font-size: 0.78rem; cursor: pointer;">IT Security</button>
                        <button class="pol-filter-btn ${currentFilter === 'Operational' ? 'active' : ''}" onclick="window.KylrxCompanyPoliciesUIController.setFilter('Operational')" style="padding: 6px 12px; border-radius: 8px; border: 1px solid ${currentFilter === 'Operational' ? '#2563eb' : '#e2e8f0'}; background: ${currentFilter === 'Operational' ? '#eff6ff' : 'white'}; color: ${currentFilter === 'Operational' ? '#1d4ed8' : '#64748b'}; font-weight: 700; font-size: 0.78rem; cursor: pointer;">Operational</button>
                    </div>
                    <div style="flex: 1; max-width: 320px; position: relative;">
                        <input type="text" id="polSearchInput" placeholder="Search by policy code, name..." value="${searchQuery}" oninput="window.KylrxCompanyPoliciesUIController.handleSearch(this.value)" style="width: 100%; padding: 7px 12px 7px 32px; border-radius: 10px; border: 1px solid #cbd5e1; font-size: 0.82rem; outline: none;">
                        <span style="position: absolute; left: 10px; top: 8px; color: #94a3b8;">🔍</span>
                    </div>
                </div>

                <!-- Policies Table Card -->
                <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                    <div id="polTableWrapper" style="overflow-x: auto;">
                        ${renderPoliciesTable(pulse)}
                    </div>
                </div>
            </div>

            <!-- Policy Editor Modal Container -->
            <div id="polEditorModalOverlay" class="kpm-overlay" style="z-index: 10001;">
                <div class="kpm-modal" style="max-width: 640px; height: auto; max-height: 90vh;">
                    <div class="kpm-header">
                        <div>
                            <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;" id="polEditorModalTitle">Configure Policy</h2>
                            <p style="font-size: 0.78rem; color: #64748b; margin: 2px 0 0 0;">PRD §1 & §13 Policy Architecture</p>
                        </div>
                        <button class="kpm-close-btn" onclick="window.KylrxCompanyPoliciesUIController.closePolicyEditorModal()">✕</button>
                    </div>
                    <form id="polEditorForm" onsubmit="window.KylrxCompanyPoliciesUIController.handleSavePolicy(event)" style="padding: 1.75rem; display: flex; flex-direction: column; gap: 1rem; overflow-y: auto;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Policy Code (PK)*</label>
                                <input type="text" id="polEditCode" required placeholder="e.g. POL_POSH_01" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-top: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Version*</label>
                                <input type="text" id="polEditVersion" required placeholder="e.g. 1.0" value="1.0" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-top: 4px;">
                            </div>
                        </div>

                        <div>
                            <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Policy Title / Display Name*</label>
                            <input type="text" id="polEditName" required placeholder="e.g. Prevention of Sexual Harassment (POSH) Policy" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-top: 4px;">
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Policy Type*</label>
                                <select id="polEditType" required style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-top: 4px; background: white;">
                                    <option value="Statutory">Statutory</option>
                                    <option value="Operational">Operational</option>
                                    <option value="Code_of_Conduct">Code_of_Conduct</option>
                                    <option value="IT_Security">IT_Security</option>
                                    <option value="HR_Handbook">HR_Handbook</option>
                                </select>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Effective From*</label>
                                <input type="date" id="polEditEffective" required value="2026-01-01" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-top: 4px;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Target Category</label>
                                <select id="polEditCategory" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-top: 4px; background: white;">
                                    <option value="ALL">ALL (Entire Workforce)</option>
                                    <option value="CAT_FT_REG">CAT_FT_REG (Full-Time Regular)</option>
                                    <option value="CAT_FT_EXEC">CAT_FT_EXEC (Executive Leadership)</option>
                                    <option value="CAT_CON_TVC">CAT_CON_TVC (Contract / TVC)</option>
                                    <option value="CAT_INT_GRAD">CAT_INT_GRAD (Graduate Interns)</option>
                                </select>
                            </div>
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Target Location</label>
                                <select id="polEditLocation" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-top: 4px; background: white;">
                                    <option value="ALL">ALL (All Branches / Hubs)</option>
                                    <option value="LOC-BLR">LOC-BLR (Bangalore Tech Park)</option>
                                    <option value="LOC-MUM">LOC-MUM (Mumbai Commercial Hub)</option>
                                </select>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Acknowledgement Turnaround (Days)</label>
                                <input type="number" id="polEditDueDays" min="1" max="90" value="14" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.85rem; margin-top: 4px;">
                            </div>
                            <div style="display: flex; flex-direction: column; justify-content: center; gap: 8px; margin-top: 14px;">
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer;">
                                    <input type="checkbox" id="polEditAckRequired" checked>
                                    <span>Acknowledgement Required</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; cursor: pointer;">
                                    <input type="checkbox" id="polEditActive" checked>
                                    <span>Active Status</span>
                                </label>
                            </div>
                        </div>

                        <!-- Direct PDF Upload to Firebase Storage -->
                        <div>
                            <label style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Upload PDF Asset to Firebase Storage</label>
                            <div style="display: flex; gap: 10px; align-items: center; margin-top: 4px;">
                                <input type="file" id="polEditPdfFile" accept="application/pdf" style="font-size: 0.8rem; flex: 1;">
                                <input type="text" id="polEditDocUrl" placeholder="or paste Storage URL" style="flex: 1; padding: 7px 10px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.8rem;">
                            </div>
                            <span style="font-size: 0.7rem; color: #64748b;">Target Storage Path: <code>organizations/{orgId}/policies/{policyCode}_{version}.pdf</code></span>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 1rem; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
                            <button type="button" onclick="window.KylrxCompanyPoliciesUIController.closePolicyEditorModal()" style="padding: 8px 16px; border-radius: 10px; border: 1px solid #cbd5e1; background: white; font-weight: 700; font-size: 0.82rem; cursor: pointer;">Cancel</button>
                            <button type="submit" style="padding: 8px 20px; border-radius: 10px; border: none; background: #2563eb; color: white; font-weight: 700; font-size: 0.82rem; cursor: pointer;">Save Policy</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    /**
     * Render the Policies Table rows
     */
    function renderPoliciesTable(pulse) {
        let filtered = currentPolicies.slice();

        if (currentFilter !== 'ALL') {
            filtered = filtered.filter(p => p.policyType === currentFilter);
        }

        if (searchQuery.trim() !== '') {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(p =>
                (p.policyCode && p.policyCode.toLowerCase().includes(q)) ||
                (p.policyName && p.policyName.toLowerCase().includes(q))
            );
        }

        if (filtered.length === 0) {
            return `
                <div style="text-align: center; padding: 3rem 1rem; color: #64748b;">
                    <p style="font-size: 1rem; font-weight: 700; margin: 0;">No Company Policies Found</p>
                    <p style="font-size: 0.82rem; margin-top: 4px;">Click "Add New Policy" or upload the 'Company Policies' sheet from Templates.xlsx.</p>
                </div>
            `;
        }

        return `
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.83rem;">
                <thead>
                    <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 0.72rem; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em;">
                        <th style="padding: 12px 16px;">Policy Code & Title</th>
                        <th style="padding: 12px 16px;">Type & Ver</th>
                        <th style="padding: 12px 16px;">Target Scope</th>
                        <th style="padding: 12px 16px;">SLA (Days)</th>
                        <th style="padding: 12px 16px;">Compliance</th>
                        <th style="padding: 12px 16px;">Status</th>
                        <th style="padding: 12px 16px; text-align: right;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${filtered.map(policy => {
                        const stat = pulse.perPolicyStats[policy.policyCode] || { compliancePercentage: 100, compliantCount: 0, assignedCount: 0 };
                        const typeBadgeStyle = policy.policyType === 'Statutory' ? 'background:#fee2e2; color:#991b1b;'
                            : policy.policyType === 'Code_of_Conduct' ? 'background:#fef3c7; color:#92400e;'
                            : policy.policyType === 'IT_Security' ? 'background:#dcfce7; color:#166534;'
                            : 'background:#e0e7ff; color:#3730a3;';

                        return `
                            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s ease;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                                <td style="padding: 12px 16px;">
                                    <div style="font-weight: 800; color: #0f172a;">${escapeHtml(policy.policyName)}</div>
                                    <div style="font-size: 0.72rem; color: #2563eb; font-weight: 700;">${escapeHtml(policy.policyCode)}</div>
                                </td>
                                <td style="padding: 12px 16px;">
                                    <span style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; ${typeBadgeStyle}">${escapeHtml(policy.policyType)}</span>
                                    <span style="font-size: 0.68rem; font-weight: 700; color: #64748b; margin-left: 4px;">v${escapeHtml(policy.version)}</span>
                                </td>
                                <td style="padding: 12px 16px;">
                                    <div style="font-size: 0.75rem; color: #334155;">Cat: <strong>${escapeHtml(policy.appliesToCategoryCode)}</strong></div>
                                    <div style="font-size: 0.72rem; color: #64748b;">Loc: <strong>${escapeHtml(policy.appliesToLocationCode)}</strong></div>
                                </td>
                                <td style="padding: 12px 16px;">
                                    <span style="font-weight: 700; color: #0f172a;">${escapeHtml(policy.acknowledgementDueDays)} d</span>
                                    <div style="font-size: 0.68rem; color: ${policy.acknowledgementRequired ? '#166534' : '#64748b'};">${policy.acknowledgementRequired ? 'Mandatory' : 'Optional'}</div>
                                </td>
                                <td style="padding: 12px 16px;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="font-weight: 800; font-size: 0.8rem; color: ${stat.compliancePercentage >= 80 ? '#166534' : '#b45309'};">${stat.compliancePercentage}%</span>
                                        <div style="width: 50px; background: #e2e8f0; height: 5px; border-radius: 4px; overflow: hidden;">
                                            <div style="background: ${stat.compliancePercentage >= 80 ? '#10b981' : '#f59e0b'}; height: 100%; width: ${stat.compliancePercentage}%;"></div>
                                        </div>
                                    </div>
                                    <span style="font-size: 0.68rem; color: #64748b;">${stat.compliantCount}/${stat.assignedCount} staff</span>
                                </td>
                                <td style="padding: 12px 16px;">
                                    <button onclick="window.KylrxCompanyPoliciesUIController.toggleActive('${escapeHtml(policy.policyCode)}')" style="background: none; border: none; cursor: pointer; padding: 0;">
                                        <span style="font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 10px; background: ${policy.isActive ? '#dcfce7; color: #15803d;' : '#f1f5f9; color: #64748b;'}">
                                            ${policy.isActive ? '● Active' : '○ Inactive'}
                                        </span>
                                    </button>
                                </td>
                                <td style="padding: 12px 16px; text-align: right;">
                                    <button onclick="window.KylrxCompanyPoliciesUIController.previewPolicy('${escapeHtml(policy.policyCode)}')" title="Preview ESS Reading Modal" style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 700; color: #1e293b; margin-right: 4px;">Preview</button>
                                    <button onclick="window.KylrxCompanyPoliciesUIController.editPolicy('${escapeHtml(policy.policyCode)}')" title="Edit Policy Details" style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 700; color: #1d4ed8; margin-right: 4px;">Edit</button>
                                    <button onclick="window.KylrxCompanyPoliciesUIController.deletePolicy('${escapeHtml(policy.policyCode)}')" title="Delete Policy" style="background: #fef2f2; border: 1px solid #fecaca; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 700; color: #dc2626;">✕</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    /**
     * Filter Buttons
     */
    function setFilter(type) {
        currentFilter = type;
        const pulse = policyService.getCompliancePulse(currentPolicies, SAMPLE_COMPLIANCE_EMPLOYEES);
        const wrapper = document.getElementById('polTableWrapper');
        if (wrapper) wrapper.innerHTML = renderPoliciesTable(pulse);

        document.querySelectorAll('.pol-filter-btn').forEach(btn => {
            const isMatch = btn.textContent.toLowerCase().includes(type.toLowerCase()) || (type === 'ALL' && btn.textContent.includes('All'));
            btn.style.background = isMatch ? '#eff6ff' : 'white';
            btn.style.color = isMatch ? '#1d4ed8' : '#64748b';
            btn.style.borderColor = isMatch ? '#2563eb' : '#e2e8f0';
        });
    }

    /**
     * Search Handler
     */
    function handleSearch(val) {
        searchQuery = val || '';
        const pulse = policyService.getCompliancePulse(currentPolicies, SAMPLE_COMPLIANCE_EMPLOYEES);
        const wrapper = document.getElementById('polTableWrapper');
        if (wrapper) wrapper.innerHTML = renderPoliciesTable(pulse);
    }

    /**
     * Preview in ESS Modal
     */
    function previewPolicy(policyCode) {
        const policy = currentPolicies.find(p => p.policyCode === policyCode);
        if (!policy) return;

        viewerModal.openPolicyModal(policy, {
            employeeId: 'EMP0001',
            employeeName: 'Vikram Joshi (Demo Admin)',
            employmentCategoryCode: 'CAT_FT_REG',
            locationCode: 'LOC-BLR',
            orgId: currentOrgId
        });
    }

    /**
     * Open Policy Editor Modal (Create)
     */
    function openPolicyEditorModal(policy = null) {
        const overlay = document.getElementById('polEditorModalOverlay');
        const titleEl = document.getElementById('polEditorModalTitle');
        const codeInput = document.getElementById('polEditCode');
        const versionInput = document.getElementById('polEditVersion');
        const nameInput = document.getElementById('polEditName');
        const typeSelect = document.getElementById('polEditType');
        const effectiveInput = document.getElementById('polEditEffective');
        const catSelect = document.getElementById('polEditCategory');
        const locSelect = document.getElementById('polEditLocation');
        const dueDaysInput = document.getElementById('polEditDueDays');
        const ackReqInput = document.getElementById('polEditAckRequired');
        const activeInput = document.getElementById('polEditActive');
        const docUrlInput = document.getElementById('polEditDocUrl');

        if (policy) {
            titleEl.textContent = 'Edit Policy: ' + policy.policyCode;
            codeInput.value = policy.policyCode;
            codeInput.readOnly = true;
            versionInput.value = policy.version || '1.0';
            nameInput.value = policy.policyName || '';
            typeSelect.value = policy.policyType || 'Operational';
            effectiveInput.value = policy.effectiveFrom || '2026-01-01';
            catSelect.value = policy.appliesToCategoryCode || 'ALL';
            locSelect.value = policy.appliesToLocationCode || 'ALL';
            dueDaysInput.value = policy.acknowledgementDueDays || 14;
            ackReqInput.checked = policy.acknowledgementRequired !== false;
            activeInput.checked = policy.isActive !== false;
            docUrlInput.value = policy.documentUrl || '';
        } else {
            titleEl.textContent = 'Add New Enterprise Policy';
            codeInput.value = '';
            codeInput.readOnly = false;
            versionInput.value = '1.0';
            nameInput.value = '';
            typeSelect.value = 'Operational';
            effectiveInput.value = new Date().toISOString().substring(0, 10);
            catSelect.value = 'ALL';
            locSelect.value = 'ALL';
            dueDaysInput.value = 14;
            ackReqInput.checked = true;
            activeInput.checked = true;
            docUrlInput.value = '';
        }

        if (overlay) overlay.classList.add('active');
    }

    function closePolicyEditorModal() {
        const overlay = document.getElementById('polEditorModalOverlay');
        if (overlay) overlay.classList.remove('active');
    }

    function editPolicy(policyCode) {
        const policy = currentPolicies.find(p => p.policyCode === policyCode);
        if (policy) openPolicyEditorModal(policy);
    }

    async function toggleActive(policyCode) {
        const policy = currentPolicies.find(p => p.policyCode === policyCode);
        if (!policy) return;

        policy.isActive = !policy.isActive;
        await policyService.savePolicy(policy, currentOrgId);
        renderAdminConsole('settingsCompanyPoliciesContainer', currentOrgId);
    }

    async function deletePolicy(policyCode) {
        if (!confirm(`Are you sure you want to delete policy "${policyCode}"?`)) return;

        await policyService.deletePolicy(policyCode, currentOrgId);
        currentPolicies = currentPolicies.filter(p => p.policyCode !== policyCode);
        renderAdminConsole('settingsCompanyPoliciesContainer', currentOrgId);
    }

    /**
     * Handle Save Policy Form Submission
     */
    async function handleSavePolicy(e) {
        e.preventDefault();

        const policyCode = document.getElementById('polEditCode').value.trim().toUpperCase();
        const version = document.getElementById('polEditVersion').value.trim();
        const policyName = document.getElementById('polEditName').value.trim();
        const policyType = document.getElementById('polEditType').value;
        const effectiveFrom = document.getElementById('polEditEffective').value;
        const appliesToCategoryCode = document.getElementById('polEditCategory').value;
        const appliesToLocationCode = document.getElementById('polEditLocation').value;
        const acknowledgementDueDays = parseInt(document.getElementById('polEditDueDays').value, 10) || 14;
        const acknowledgementRequired = document.getElementById('polEditAckRequired').checked;
        const isActive = document.getElementById('polEditActive').checked;
        let documentUrl = document.getElementById('polEditDocUrl').value.trim();

        // Check if file was selected for upload
        const fileInput = document.getElementById('polEditPdfFile');
        if (fileInput && fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            // Simulate / execute Firebase Storage upload path: organizations/{orgId}/policies/{policyCode}_{version}.pdf
            const storagePath = `organizations/${currentOrgId}/policies/${policyCode}_${version}.pdf`;
            console.log(`[STORAGE] Uploading ${file.name} (${file.size} bytes) to ${storagePath}`);
            documentUrl = `https://storage.googleapis.com/kylrx-enterprise.appspot.com/${storagePath}`;
        }

        const policyPayload = {
            policyCode,
            policyName,
            version,
            policyType,
            effectiveFrom,
            appliesToCategoryCode,
            appliesToLocationCode,
            acknowledgementDueDays,
            acknowledgementRequired,
            documentUrl,
            isActive
        };

        await policyService.savePolicy(policyPayload, currentOrgId);
        closePolicyEditorModal();
        await renderAdminConsole('settingsCompanyPoliciesContainer', currentOrgId);
    }

    return {
        renderAdminConsole,
        setFilter,
        handleSearch,
        previewPolicy,
        openPolicyEditorModal,
        closePolicyEditorModal,
        editPolicy,
        toggleActive,
        deletePolicy,
        handleSavePolicy
    };
}));
