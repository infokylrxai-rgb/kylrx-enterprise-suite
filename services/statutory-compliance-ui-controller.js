/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - STATUTORY COMPLIANCE UI CONTROLLER
 * ============================================================================
 * 
 * Interactive Admin Settings & Onboarding Console Controller for:
 * - Scheme CRUD operations (PF, ESI, PT, LWF, Gratuity)
 * - State filter & regional slab configuration drawers
 * - Due date deadline alert reminders & countdown badges
 * - Direct in-app downloads of statutory export returns (ECR, ESIC, PT)
 * 
 * @version 1.0.0
 * @author Principal Fintech & Statutory Compliance Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxStatutoryComplianceUIController = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    let _currentFilterState = 'ALL';
    let _searchQuery = '';
    let _activeOrgId = null;

    function getService() {
        return window.KylrxStatutoryComplianceService || (typeof require !== 'undefined' ? require('../statutoryComplianceService.js') : null);
    }

    function getParser() {
        return window.KylrxStatutoryComplianceParser || (typeof require !== 'undefined' ? require('../statutoryComplianceParser.js') : null);
    }

    /**
     * Renders the complete Statutory & Compliance console into the specified target element
     */
    function renderAdminConsole(containerId = 'settingsStatutoryRulesContainer', orgId) {
        _activeOrgId = orgId || (typeof window !== 'undefined' && window.getActiveOrgId ? window.getActiveOrgId() : null);
        const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (!container) return;
        if (!_activeOrgId) {
            container.innerHTML = `<div style="padding: 2rem; color: var(--k-danger-text);">No organization found for the signed-in user. Sign in again.</div>`;
            return;
        }

        const svc = getService();
        if (!svc) {
            container.innerHTML = `<div style="padding: 2rem; color: var(--k-danger-text);">Statutory Compliance Service not loaded.</div>`;
            return;
        }

        const allRules = svc.getAllComplianceRules(_activeOrgId);
        const deadlineCheck = svc.evaluateComplianceDeadlines(new Date(), _activeOrgId);

        // Filter rules
        let filteredRules = allRules;
        if (_currentFilterState !== 'ALL') {
            filteredRules = filteredRules.filter(r => r.state.toLowerCase() === _currentFilterState.toLowerCase());
        }
        if (_searchQuery) {
            const q = _searchQuery.toLowerCase();
            filteredRules = filteredRules.filter(r => 
                r.complianceCode.toLowerCase().includes(q) ||
                r.complianceName.toLowerCase().includes(q) ||
                (r.registrationNumber && r.registrationNumber.toLowerCase().includes(q))
            );
        }

        const states = Array.from(new Set(allRules.map(r => r.state)));
        const applicableCount = allRules.filter(r => r.isApplicable).length;
        const activeCount = allRules.filter(r => r.isActive).length;
        const alertsCount = deadlineCheck.activeAlertCount;

        container.innerHTML = `
            <div class="statutory-console-wrapper" style="display: flex; flex-direction: column; gap: 1.75rem;">
                
                <!-- Header & Action Bar -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--k-text); margin: 0 0 6px 0; display: flex; align-items: center; gap: 10px;">
                            <i data-lucide="scale" style="color: var(--k-accent-text); width: 28px; height: 28px;"></i>
                            Statutory &amp; Compliance Rules Console
                        </h2>
                        <p style="color: var(--k-muted); font-size: 0.9rem; margin: 0;">
                            Configure Provident Fund, ESIC, regional Professional Tax slabs, and Labour Welfare Fund policies (PRD §§ 1, 4, 11, &amp; 13).
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button type="button" class="btn" onclick="window.KylrxStatutoryComplianceUIController.openStateSlabsModal()" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 12px; font-weight: 700; cursor: pointer; border: 1.5px solid var(--k-border); background: var(--k-surface); color: var(--k-text-2);">
                            <i data-lucide="layers" style="width: 16px; height: 16px;"></i> State Slabs Matrix
                        </button>
                        <button type="button" class="btn" onclick="window.KylrxStatutoryComplianceUIController.openAddRuleModal()" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 12px; font-weight: 700; cursor: pointer; border: none; background: var(--k-accent); color: var(--k-on-accent); box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);">
                            <i data-lucide="plus"></i> Add Compliance Rule
                        </button>
                    </div>
                </div>

                <!-- Statutory Deadline & Remittance Alert Banner (PRD Section 11) -->
                ${renderDeadlinesBanner(deadlineCheck)}

                <!-- KPI Metric Cards -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem;">
                    <div style="background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 18px; padding: 1.25rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <span style="font-size: 0.72rem; font-weight: 800; color: var(--k-muted); text-transform: uppercase;">Total Schemes</span>
                            <span style="background: var(--k-accent-soft); color: var(--k-accent-text); width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center;"><i data-lucide="file-text" style="width: 16px;"></i></span>
                        </div>
                        <h3 style="font-size: 1.8rem; font-weight: 800; color: var(--k-text); margin: 8px 0 0 0;">${allRules.length}</h3>
                        <p style="font-size: 0.75rem; color: var(--k-muted); margin: 4px 0 0 0;">All India &amp; State Schemes</p>
                    </div>

                    <div style="background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 18px; padding: 1.25rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <span style="font-size: 0.72rem; font-weight: 800; color: var(--k-muted); text-transform: uppercase;">Mandated / Applicable</span>
                            <span style="background: var(--k-success-soft); color: var(--k-success-text); width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center;"><i data-lucide="check-circle-2" style="width: 16px;"></i></span>
                        </div>
                        <h3 style="font-size: 1.8rem; font-weight: 800; color: var(--k-success-text); margin: 8px 0 0 0;">${applicableCount}</h3>
                        <p style="font-size: 0.75rem; color: var(--k-muted); margin: 4px 0 0 0;">Active for Payroll Ledger</p>
                    </div>

                    <div style="background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 18px; padding: 1.25rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <span style="font-size: 0.72rem; font-weight: 800; color: var(--k-muted); text-transform: uppercase;">Jurisdictions</span>
                            <span style="background: var(--k-subtle); color: #9333ea; width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center;"><i data-lucide="map-pin" style="width: 16px;"></i></span>
                        </div>
                        <h3 style="font-size: 1.8rem; font-weight: 800; color: #9333ea; margin: 8px 0 0 0;">${states.length}</h3>
                        <p style="font-size: 0.75rem; color: var(--k-muted); margin: 4px 0 0 0;">States &amp; Central Coverage</p>
                    </div>

                    <div style="background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 18px; padding: 1.25rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <span style="font-size: 0.72rem; font-weight: 800; color: var(--k-muted); text-transform: uppercase;">Compliance Alerts</span>
                            <span style="background: #fff1f2; color: #e11d48; width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center;"><i data-lucide="bell" style="width: 16px;"></i></span>
                        </div>
                        <h3 style="font-size: 1.8rem; font-weight: 800; color: ${alertsCount > 0 ? '#e11d48' : 'var(--k-muted)'}; margin: 8px 0 0 0;">${alertsCount}</h3>
                        <p style="font-size: 0.75rem; color: var(--k-muted); margin: 4px 0 0 0;">Pending Remittances</p>
                    </div>
                </div>

                <!-- Filters & Quick Actions Bar -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; background: var(--k-surface); padding: 1rem 1.25rem; border: 1px solid var(--k-border); border-radius: 16px;">
                    <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                        <div style="position: relative; width: 260px;">
                            <input type="text" id="statutorySearchInput" placeholder="Search by scheme or code..." value="${_searchQuery}" oninput="window.KylrxStatutoryComplianceUIController.onSearchChange(this.value)" style="width: 100%; padding: 8px 12px 8px 36px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                            <i data-lucide="search" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--k-muted);"></i>
                        </div>
                        <select id="statutoryStateFilter" onchange="window.KylrxStatutoryComplianceUIController.onStateFilterChange(this.value)" style="padding: 8px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none; background: var(--k-surface); font-weight: 600; color: var(--k-text-2);">
                            <option value="ALL" ${_currentFilterState === 'ALL' ? 'selected' : ''}>All Jurisdictions (${allRules.length})</option>
                            ${states.map(s => `<option value="${s}" ${_currentFilterState === s ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                    </div>

                    <!-- Direct Return Export Buttons (PRD Section 11) -->
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button type="button" class="btn" onclick="window.KylrxStatutoryComplianceUIController.downloadEcrSample()" title="Direct EPFO ECR Export Format (#~# separated)" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; font-size: 0.8rem; font-weight: 700; background: var(--k-success-soft); border: 1.5px solid var(--k-success-border); color: var(--k-success-text); cursor: pointer;">
                            <i data-lucide="download" style="width: 14px; height: 14px;"></i> EPFO ECR
                        </button>
                        <button type="button" class="btn" onclick="window.KylrxStatutoryComplianceUIController.downloadEsicSample()" title="Direct ESIC Monthly Return CSV" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; font-size: 0.8rem; font-weight: 700; background: var(--k-accent-soft); border: 1.5px solid var(--k-accent-border); color: var(--k-accent-text); cursor: pointer;">
                            <i data-lucide="download" style="width: 14px; height: 14px;"></i> ESIC Return
                        </button>
                    </div>
                </div>

                <!-- Main Statutory Schemes Table -->
                <div style="background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 18px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);">
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                            <thead>
                                <tr style="background: var(--k-subtle); border-bottom: 1.5px solid var(--k-border);">
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase;">Scheme</th>
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase;">State</th>
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase; text-align: center;">Applicable</th>
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase;">Reg Number</th>
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase;">Wage Ceiling / Rule</th>
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase;">EE Share</th>
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase;">ER Share</th>
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase; text-align: center;">Due Day</th>
                                    <th style="padding: 14px 18px; font-weight: 800; color: var(--k-text-2); font-size: 0.72rem; text-transform: uppercase; text-align: right;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filteredRules.length === 0 ? `
                                    <tr>
                                        <td colspan="9" style="text-align: center; padding: 3rem; color: var(--k-muted);">
                                            <i data-lucide="inbox" style="width: 32px; height: 32px; margin-bottom: 8px; opacity: 0.5;"></i>
                                            <p style="margin: 0; font-size: 0.95rem; font-weight: 600;">No statutory policies match the filter criteria.</p>
                                        </td>
                                    </tr>
                                ` : filteredRules.map(r => renderSchemeRow(r, deadlineCheck)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Modals Containers -->
                <div id="statutoryModalsContainer"></div>
            </div>
        `;

        if (window.lucide) lucide.createIcons();
    }

    /**
     * Renders a single table row for a statutory compliance rule
     */
    function renderSchemeRow(rule, deadlineCheck) {
        const alertInfo = deadlineCheck.alerts.find(a => a.complianceCode === rule.complianceCode);
        const daysRemaining = alertInfo ? alertInfo.daysRemaining : (rule.dueDateDay - new Date().getDate());

        let dueBadge = `<span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; background: var(--k-subtle); color: var(--k-text-2);">Day ${rule.dueDateDay}</span>`;
        if (rule.isApplicable && rule.isActive) {
            if (daysRemaining <= 2 && daysRemaining >= 0) {
                dueBadge = `<span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; background: var(--k-danger-soft); color: var(--k-danger-text); border: 1px solid var(--k-danger-border);">Day ${rule.dueDateDay} (in ${daysRemaining}d)</span>`;
            } else if (daysRemaining <= 5 && daysRemaining > 2) {
                dueBadge = `<span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; background: var(--k-warning-soft); color: var(--k-warning-text); border: 1px solid var(--k-warning-border);">Day ${rule.dueDateDay} (in ${daysRemaining}d)</span>`;
            } else if (daysRemaining < 0) {
                dueBadge = `<span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; background: #ffe4e6; color: #e11d48;">Day ${rule.dueDateDay} (Overdue)</span>`;
            }
        }

        const eeDisplay = typeof rule.employeeContributionRate === 'number' && rule.employeeContributionRate <= 100
            ? `${rule.employeeContributionRate}%`
            : `${rule.employeeContributionRate}`;
        const erDisplay = typeof rule.employerContributionRate === 'number' && rule.employerContributionRate <= 100
            ? `${rule.employerContributionRate}%`
            : `${rule.employerContributionRate}`;

        return `
            <tr style="border-bottom: 1px solid var(--k-border); transition: background 0.15s ease;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                <td style="padding: 14px 18px;">
                    <div style="font-weight: 800; color: var(--k-text); font-size: 0.88rem;">${rule.complianceName}</div>
                    <div style="font-family: monospace; font-size: 0.72rem; color: var(--k-muted); margin-top: 2px;">${rule.complianceCode}</div>
                </td>
                <td style="padding: 14px 18px;">
                    <span style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; background: ${rule.state === 'All India' ? '#e0f2fe' : '#ede9fe'}; color: ${rule.state === 'All India' ? '#0369a1' : '#6d28d9'};">
                        ${rule.state}
                    </span>
                </td>
                <td style="padding: 14px 18px; text-align: center;">
                    <label class="switch" style="position: relative; display: inline-block; width: 38px; height: 20px;">
                        <input type="checkbox" ${rule.isApplicable ? 'checked' : ''} onchange="window.KylrxStatutoryComplianceUIController.toggleApplicable('${rule.complianceCode}', this.checked)" style="opacity: 0; width: 0; height: 0;">
                        <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${rule.isApplicable ? 'var(--k-accent)' : '#cbd5e1'}; transition: .3s; border-radius: 20px;"></span>
                    </label>
                </td>
                <td style="padding: 14px 18px;">
                    <div style="font-family: monospace; font-size: 0.8rem; font-weight: 600; color: var(--k-text-2);">
                        ${rule.registrationNumber || '<span style="color: var(--k-muted); font-style: italic;">Not Registered</span>'}
                    </div>
                    <div style="font-size: 0.7rem; color: var(--k-muted);">Eff: ${rule.effectiveFrom || '2026-01-01'}</div>
                </td>
                <td style="padding: 14px 18px;">
                    <span style="font-weight: 700; color: var(--k-text);">
                        ${typeof rule.wageCeiling === 'number' ? `₹${rule.wageCeiling.toLocaleString('en-IN')}` : rule.wageCeiling}
                    </span>
                </td>
                <td style="padding: 14px 18px; font-weight: 700; color: var(--k-accent-text);">
                    ${eeDisplay}
                </td>
                <td style="padding: 14px 18px; font-weight: 700; color: var(--k-success-text);">
                    ${erDisplay}
                </td>
                <td style="padding: 14px 18px; text-align: center;">
                    ${dueBadge}
                </td>
                <td style="padding: 14px 18px; text-align: right;">
                    <div style="display: inline-flex; gap: 6px; align-items: center;">
                        <button type="button" onclick="window.KylrxStatutoryComplianceUIController.openEditRuleModal('${rule.complianceCode}')" class="icon-btn" title="Edit Scheme" style="width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--k-border); background: var(--k-surface); color: var(--k-text-2); cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <i data-lucide="edit-2" style="width: 14px; height: 14px;"></i>
                        </button>
                        <button type="button" onclick="window.KylrxStatutoryComplianceUIController.deleteRule('${rule.complianceCode}')" class="icon-btn" title="Delete Scheme" style="width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--k-border); background: #fff1f2; color: #e11d48; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Renders alert reminder banner for deadlines <= 5 days
     */
    function renderDeadlinesBanner(deadlineCheck) {
        const activeAlerts = deadlineCheck.alerts.filter(a => a.shouldAlert);
        if (activeAlerts.length === 0) return '';

        return `
            <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border: 1.5px solid var(--k-warning-border); border-radius: 18px; padding: 1.25rem 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: #fef08a; color: #854d0e; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i data-lucide="alert-triangle" style="width: 24px; height: 24px;"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; font-weight: 800; color: var(--k-warning-text);">
                            Compliance Reminders Active (${activeAlerts.length} Remittance Deadlines Approaching)
                        </h4>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            ${activeAlerts.map(a => `
                                <span style="font-size: 0.75rem; background: var(--k-surface); padding: 2px 8px; border-radius: 6px; border: 1px solid var(--k-warning-border); font-weight: 700; color: var(--k-warning-text);">
                                    ${a.complianceCode}: Due ${a.dueDay}th (${a.daysRemaining >= 0 ? `${a.daysRemaining}d left` : 'OVERDUE'})
                                </span>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div>
                    <button type="button" onclick="window.KylrxStatutoryComplianceUIController.downloadEcrSample()" class="btn" style="background: var(--k-warning); color: var(--k-on-warning); border: none; padding: 8px 16px; border-radius: 10px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                        Reconcile &amp; Export Returns
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Handlers for filtering
     */
    function onStateFilterChange(val) {
        _currentFilterState = val;
        renderAdminConsole('settingsStatutoryRulesContainer', _activeOrgId);
    }

    function onSearchChange(val) {
        _searchQuery = val.trim();
        renderAdminConsole('settingsStatutoryRulesContainer', _activeOrgId);
    }

    /**
     * Toggle applicable status
     */
    function toggleApplicable(complianceCode, isApplicable) {
        const svc = getService();
        if (svc) {
            svc.toggleComplianceApplicable(complianceCode, isApplicable, _activeOrgId);
            renderAdminConsole('settingsStatutoryRulesContainer', _activeOrgId);
        }
    }

    /**
     * Delete rule
     */
    function deleteRule(complianceCode) {
        if (!confirm(`Are you sure you want to delete compliance rule '${complianceCode}'?`)) return;
        const svc = getService();
        if (svc) {
            svc.deleteComplianceRule(complianceCode, _activeOrgId);
            renderAdminConsole('settingsStatutoryRulesContainer', _activeOrgId);
        }
    }

    /**
     * Opens Modal to Add or Edit Rule
     */
    function openAddRuleModal() {
        _renderRuleModal(null);
    }

    function openEditRuleModal(complianceCode) {
        const svc = getService();
        const rule = svc ? svc.getComplianceRuleByCode(complianceCode, _activeOrgId) : null;
        _renderRuleModal(rule);
    }

    function _renderRuleModal(rule = null) {
        const isEdit = !!rule;
        const modalContainer = document.getElementById('statutoryModalsContainer');
        if (!modalContainer) return;

        modalContainer.innerHTML = `
            <div class="modal-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15,23,42,0.4); backdrop-filter: blur(8px); z-index: 9999; align-items: center; justify-content: center;">
                <div style="background: var(--k-surface); width: 560px; max-width: 94%; border-radius: 24px; padding: 2rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); border: 1px solid var(--k-border); position: relative;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--k-border); padding-bottom: 1rem;">
                        <div>
                            <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--k-text);">
                                ${isEdit ? `Edit Policy (${rule.complianceCode})` : 'New Statutory Compliance Policy'}
                            </h3>
                            <p style="margin: 2px 0 0 0; font-size: 0.8rem; color: var(--k-muted);">
                                Configure statutory ceilings, employer matches, and challan remittance due dates.
                            </p>
                        </div>
                        <button onclick="document.getElementById('statutoryModalsContainer').innerHTML=''" style="background: none; border: none; color: var(--k-muted); cursor: pointer; padding: 4px;">
                            <i data-lucide="x" style="width: 20px; height: 20px;"></i>
                        </button>
                    </div>

                    <form id="statutoryRuleForm" onsubmit="window.KylrxStatutoryComplianceUIController.handleFormSubmit(event, ${isEdit ? `'${rule.complianceCode}'` : 'null'})">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">Compliance Code *</label>
                                <input type="text" id="modalComplianceCode" value="${rule ? rule.complianceCode : ''}" ${isEdit ? 'disabled' : ''} placeholder="e.g. COMP_PF" required style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; font-family: monospace; outline: none;">
                            </div>
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">State / Jurisdiction *</label>
                                <input type="text" id="modalState" value="${rule ? rule.state : 'All India'}" placeholder="e.g. Karnataka or All India" required style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                            </div>
                        </div>

                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">Compliance Name / Title *</label>
                            <input type="text" id="modalComplianceName" value="${rule ? rule.complianceName : ''}" placeholder="e.g. Employees Provident Fund" required style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">Applicable</label>
                                <select id="modalApplicable" style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none; background: var(--k-surface);">
                                    <option value="true" ${!rule || rule.isApplicable ? 'selected' : ''}>Yes (Mandatory)</option>
                                    <option value="false" ${rule && !rule.isApplicable ? 'selected' : ''}>No (Exempt)</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">Registration Number</label>
                                <input type="text" id="modalRegistrationNumber" value="${rule ? rule.registrationNumber : ''}" placeholder="e.g. KN/BNG/0012345/000" style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">Effective From</label>
                                <input type="date" id="modalEffectiveFrom" value="${rule ? (rule.effectiveFrom || '2026-01-01') : '2026-01-01'}" style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                            </div>
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">Wage Ceiling or Rule</label>
                                <input type="text" id="modalWageCeiling" value="${rule ? rule.wageCeiling : 15000}" placeholder="e.g. 15000 or Slab Formula" style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">EE Rate (%)</label>
                                <input type="number" step="0.01" id="modalEeRate" value="${rule ? rule.employeeContributionRate : 12}" required style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                            </div>
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">ER Rate (%)</label>
                                <input type="number" step="0.01" id="modalErRate" value="${rule ? rule.employerContributionRate : 12}" required style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                            </div>
                            <div class="form-group">
                                <label style="font-size: 0.75rem; font-weight: 800; color: var(--k-text-2); text-transform: uppercase;">Due Day (1-31)</label>
                                <input type="number" min="1" max="31" id="modalDueDay" value="${rule ? rule.dueDateDay : 15}" required style="width: 100%; padding: 10px 14px; border: 1.5px solid var(--k-border); border-radius: 10px; font-size: 0.85rem; outline: none;">
                            </div>
                        </div>

                        <div id="modalFormError" style="display: none; padding: 10px 14px; background: var(--k-danger-soft); border: 1px solid var(--k-danger-border); border-radius: 10px; color: var(--k-danger-text); font-size: 0.8rem; margin-bottom: 1rem;"></div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px;">
                            <button type="button" onclick="document.getElementById('statutoryModalsContainer').innerHTML=''" class="btn" style="padding: 10px 20px; border-radius: 10px; border: 1.5px solid var(--k-border); background: var(--k-surface); color: var(--k-text-2); cursor: pointer; font-weight: 700;">Cancel</button>
                            <button type="submit" class="btn btn-primary" style="padding: 10px 24px; border-radius: 10px; border: none; background: var(--k-accent); color: var(--k-on-accent); cursor: pointer; font-weight: 700;">Save Policy</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    }

    /**
     * Handles modal form submission with live validation
     */
    function handleFormSubmit(e, existingCode) {
        e.preventDefault();
        const errDiv = document.getElementById('modalFormError');
        errDiv.style.display = 'none';

        const code = existingCode || document.getElementById('modalComplianceCode').value.trim().toUpperCase();
        const name = document.getElementById('modalComplianceName').value.trim();
        const state = document.getElementById('modalState').value.trim();
        const isApplicable = document.getElementById('modalApplicable').value === 'true';
        const regNo = document.getElementById('modalRegistrationNumber').value.trim();
        const effFrom = document.getElementById('modalEffectiveFrom').value;
        const wageCeilingRaw = document.getElementById('modalWageCeiling').value.trim();
        const wageCeiling = !isNaN(Number(wageCeilingRaw)) ? Number(wageCeilingRaw) : wageCeilingRaw;
        const eeRate = parseFloat(document.getElementById('modalEeRate').value);
        const erRate = parseFloat(document.getElementById('modalErRate').value);
        const dueDay = parseInt(document.getElementById('modalDueDay').value, 10);

        // Validation: if Applicable is true, Registration_Number and Effective_From are mandatory
        if (isApplicable) {
            if (!regNo) {
                errDiv.textContent = "Consistency Requirement: When 'Applicable' is Yes, 'Registration Number' is mandatory.";
                errDiv.style.display = 'block';
                return;
            }
            if (!effFrom) {
                errDiv.textContent = "Consistency Requirement: When 'Applicable' is Yes, 'Effective From' date is mandatory.";
                errDiv.style.display = 'block';
                return;
            }
        }

        if (dueDay < 1 || dueDay > 31) {
            errDiv.textContent = "Due Day must be between 1 and 31.";
            errDiv.style.display = 'block';
            return;
        }

        const payload = {
            complianceCode: code,
            complianceName: name,
            isApplicable: isApplicable,
            registrationNumber: regNo,
            state: state,
            effectiveFrom: effFrom,
            wageCeiling: wageCeiling,
            employeeContributionRate: eeRate,
            employerContributionRate: erRate,
            dueDateDay: dueDay,
            isActive: true
        };

        const svc = getService();
        if (svc) {
            try {
                if (existingCode) {
                    svc.updateComplianceRule(existingCode, payload, _activeOrgId);
                } else {
                    svc.createComplianceRule(payload, _activeOrgId);
                }
                document.getElementById('statutoryModalsContainer').innerHTML = '';
                renderAdminConsole('settingsStatutoryRulesContainer', _activeOrgId);
            } catch (err) {
                errDiv.textContent = err.message;
                errDiv.style.display = 'block';
            }
        }
    }

    /**
     * Opens Interactive State Slabs Matrix Modal / Drawer
     */
    function openStateSlabsModal() {
        const modalContainer = document.getElementById('statutoryModalsContainer');
        if (!modalContainer) return;

        modalContainer.innerHTML = `
            <div class="modal-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15,23,42,0.4); backdrop-filter: blur(8px); z-index: 9999; align-items: center; justify-content: center;">
                <div style="background: var(--k-surface); width: 680px; max-width: 94%; max-height: 85vh; overflow-y: auto; border-radius: 24px; padding: 2rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); border: 1px solid var(--k-border); position: relative;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--k-border); padding-bottom: 1rem;">
                        <div>
                            <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--k-text);">
                                Regional Professional Tax &amp; LWF Slabs Matrix
                            </h3>
                            <p style="margin: 2px 0 0 0; font-size: 0.8rem; color: var(--k-muted);">
                                Pre-configured state statutory formulas dynamically evaluated in monthly payroll runs.
                            </p>
                        </div>
                        <button onclick="document.getElementById('statutoryModalsContainer').innerHTML=''" style="background: none; border: none; color: var(--k-muted); cursor: pointer; padding: 4px;">
                            <i data-lucide="x" style="width: 20px; height: 20px;"></i>
                        </button>
                    </div>

                    <!-- Karnataka PT Slabs Card -->
                    <div style="background: var(--k-subtle); border: 1.5px solid var(--k-border); border-radius: 16px; padding: 1.25rem; margin-bottom: 1.25rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: var(--k-text); display: flex; align-items: center; gap: 8px;">
                                <span style="background: #ede9fe; color: #6d28d9; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem;">Karnataka</span>
                                Professional Tax (PT)
                            </h4>
                            <span style="font-size: 0.72rem; color: var(--k-success-text); font-weight: 700;">Standard Formula Active</span>
                        </div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 8px;">
                            <tr style="border-bottom: 1px solid var(--k-border); font-weight: 700; color: var(--k-text-2);">
                                <td style="padding: 6px 0;">Gross Wage Range</td>
                                <td style="padding: 6px 0; text-align: right;">Monthly PT Deduction</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--k-border);">
                                <td style="padding: 6px 0; color: var(--k-text-2);">Gross &lt; ₹25,000</td>
                                <td style="padding: 6px 0; text-align: right; font-weight: 700; color: var(--k-success-text);">₹0 (Exempt)</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: var(--k-text-2);">Gross &gt;= ₹25,000</td>
                                <td style="padding: 6px 0; text-align: right; font-weight: 700; color: var(--k-accent-text);">₹200 / month</td>
                            </tr>
                        </table>
                    </div>

                    <!-- Maharashtra PT Slabs Card -->
                    <div style="background: var(--k-subtle); border: 1.5px solid var(--k-border); border-radius: 16px; padding: 1.25rem; margin-bottom: 1.25rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: var(--k-text); display: flex; align-items: center; gap: 8px;">
                                <span style="background: #e0f2fe; color: #0284c7; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem;">Maharashtra</span>
                                Professional Tax (PT)
                            </h4>
                            <span style="font-size: 0.72rem; color: var(--k-success-text); font-weight: 700;">Standard Formula Active</span>
                        </div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 8px;">
                            <tr style="border-bottom: 1px solid var(--k-border); font-weight: 700; color: var(--k-text-2);">
                                <td style="padding: 6px 0;">Monthly Gross Wage</td>
                                <td style="padding: 6px 0; text-align: right;">Monthly PT Deduction</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--k-border);">
                                <td style="padding: 6px 0; color: var(--k-text-2);">Gross &lt;= ₹7,500</td>
                                <td style="padding: 6px 0; text-align: right; font-weight: 700; color: var(--k-success-text);">₹0</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--k-border);">
                                <td style="padding: 6px 0; color: var(--k-text-2);">₹7,501 to ₹10,000</td>
                                <td style="padding: 6px 0; text-align: right; font-weight: 700; color: var(--k-accent-text);">₹175 / month</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: var(--k-text-2);">Gross &gt; ₹10,000</td>
                                <td style="padding: 6px 0; text-align: right; font-weight: 700; color: var(--k-accent-text);">₹200 (Feb: ₹300)</td>
                            </tr>
                        </table>
                    </div>

                    <!-- Labour Welfare Fund (LWF) Matrix Card -->
                    <div style="background: var(--k-subtle); border: 1.5px solid var(--k-border); border-radius: 16px; padding: 1.25rem; margin-bottom: 1.5rem;">
                        <h4 style="margin: 0 0 8px 0; font-size: 0.95rem; font-weight: 800; color: var(--k-text);">
                            Labour Welfare Fund (LWF) Provisions
                        </h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.8rem;">
                            <div style="background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 10px; padding: 10px;">
                                <div style="font-weight: 700; color: #6d28d9; margin-bottom: 4px;">Karnataka</div>
                                <div style="color: var(--k-muted);">Annual Deduction (December)</div>
                                <div style="font-weight: 700; color: var(--k-text); margin-top: 4px;">EE: ₹20 | ER: ₹40 (Total ₹60)</div>
                            </div>
                            <div style="background: var(--k-surface); border: 1px solid var(--k-border); border-radius: 10px; padding: 10px;">
                                <div style="font-weight: 700; color: #0284c7; margin-bottom: 4px;">Maharashtra</div>
                                <div style="color: var(--k-muted);">Bi-Annual (June &amp; December)</div>
                                <div style="font-weight: 700; color: var(--k-text); margin-top: 4px;">EE: ₹12 | ER: ₹36 (Total ₹48)</div>
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end;">
                        <button type="button" onclick="document.getElementById('statutoryModalsContainer').innerHTML=''" class="btn btn-primary" style="padding: 10px 24px; border-radius: 10px; border: none; background: var(--k-accent); color: var(--k-on-accent); cursor: pointer; font-weight: 700;">
                            Done
                        </button>
                    </div>
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    }

    /**
     * Direct sample download generators (EPFO ECR & ESIC)
     */
    function downloadEcrSample() {
        const svc = getService();
        const sampleRecords = [
            { uan: "100904829102", name: "Super Admin", grossSalary: 100000, epfWages: 15000, epsWages: 15000, employeePf: 1800, employerEps: 1250, employerPf: 550, ncpDays: 0 },
            { uan: "100904829103", name: "John Doe", grossSalary: 75000, epfWages: 15000, epsWages: 15000, employeePf: 1800, employerEps: 1250, employerPf: 550, ncpDays: 0 },
            { uan: "100904829104", name: "Marry Doe", grossSalary: 60000, epfWages: 15000, epsWages: 15000, employeePf: 1800, employerEps: 1250, employerPf: 550, ncpDays: 0 }
        ];

        const text = svc ? svc.generateEcrText(sampleRecords) : "100904829102#~#Super Admin#~#100000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0";
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `EPFO_ECR_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function downloadEsicSample() {
        const headers = ["IP Number", "IP Name", "No of Days for which wages paid", "Total Monthly Wages", "Reason Code for Zero workings days", "Last Working Day"];
        const rows = [
            ["3100482910", "Super Admin", 30, 21000, 0, ""],
            ["3100482911", "Marry Doe", 30, 20000, 0, ""]
        ];
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ESIC_Monthly_Return_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Attach to service for unified console calls
    const svc = getService();
    if (svc) {
        svc.renderAdminConsole = renderAdminConsole;
    }

    return {
        renderAdminConsole: renderAdminConsole,
        onStateFilterChange: onStateFilterChange,
        onSearchChange: onSearchChange,
        toggleApplicable: toggleApplicable,
        deleteRule: deleteRule,
        openAddRuleModal: openAddRuleModal,
        openEditRuleModal: openEditRuleModal,
        openStateSlabsModal: openStateSlabsModal,
        handleFormSubmit: handleFormSubmit,
        downloadEcrSample: downloadEcrSample,
        downloadEsicSample: downloadEsicSample
    };
}));
