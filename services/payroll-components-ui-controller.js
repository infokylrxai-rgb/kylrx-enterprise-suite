/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PAYROLL COMPONENTS UI CONTROLLER
 * ============================================================================
 * 
 * Interactive Admin Console Controller for:
 * - Full CRUD management of Payroll Components (PRD Sections 1 & 4)
 * - Grouped Earnings vs Deductions views with filter/search
 * - Interactive statutory & LOP flag toggles with instant Firestore sync
 * - Live formula evaluation and proration preview simulator
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
        root.KylrxPayrollComponentsUIController = factory();
        root.payrollComponentsUIController = root.KylrxPayrollComponentsUIController;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    let _activeOrgId = 'org_default';
    let _activeTab = 'ALL'; // 'ALL', 'EARNINGS', 'DEDUCTIONS', 'OTHERS'
    let _searchQuery = '';

    function getService() {
        return window.KylrxPayrollComponentService || window.payrollComponentService || (typeof require !== 'undefined' ? require('../payrollComponentService.js') : null);
    }

    function getCalculationEngine() {
        return window.KylrxPayrollCalculationEngine || window.payrollCalculationEngine || (typeof require !== 'undefined' ? require('../payrollCalculationEngine.js') : null);
    }

    /**
     * Renders the complete Payroll Components Catalog console into target container
     */
    function renderAdminConsole(containerId = 'payrollComponentsConsoleContainer', orgId = 'org_default') {
        _activeOrgId = orgId || localStorage.getItem('orgId') || 'org_default';
        const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (!container) return;

        const svc = getService();
        if (!svc) {
            container.innerHTML = `<div style="padding: 2rem; color: #ef4444; font-weight: 600;">Payroll Component Service not loaded.</div>`;
            return;
        }

        const allComponents = svc.listPayrollComponents(_activeOrgId);

        // Filter by tab
        let filtered = allComponents;
        if (_activeTab === 'EARNINGS') {
            filtered = filtered.filter(c => c.componentType === 'Earning');
        } else if (_activeTab === 'DEDUCTIONS') {
            filtered = filtered.filter(c => c.componentType === 'Deduction');
        } else if (_activeTab === 'OTHERS') {
            filtered = filtered.filter(c => c.componentType === 'Reimbursement' || c.componentType === 'Employer_Contribution');
        }

        // Filter by search
        if (_searchQuery) {
            const q = _searchQuery.toLowerCase().trim();
            filtered = filtered.filter(c => 
                (c.componentCode && c.componentCode.toLowerCase().includes(q)) ||
                (c.componentName && c.componentName.toLowerCase().includes(q)) ||
                (c.percentageBasis && c.percentageBasis.toLowerCase().includes(q))
            );
        }

        // Metrics
        const totalCount = allComponents.length;
        const earningsCount = allComponents.filter(c => c.componentType === 'Earning').length;
        const deductionsCount = allComponents.filter(c => c.componentType === 'Deduction').length;
        const statutoryCount = allComponents.filter(c => c.isPfApplicable || c.isEsiApplicable || c.isPtApplicable || c.isTdsApplicable).length;

        container.innerHTML = `
            <div class="payroll-components-console" style="display: flex; flex-direction: column; gap: 1.5rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                
                <!-- Action Bar & Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <h2 style="font-size: 1.5rem; font-weight: 800; color: #0f172a; margin: 0 0 6px 0; display: flex; align-items: center; gap: 10px;">
                            <span style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: #eff6ff; color: #2563eb; border-radius: 8px;">
                                <i data-lucide="layers" style="width: 20px; height: 20px;"></i>
                            </span>
                            Payroll Components Catalog
                        </h2>
                        <p style="color: #64748b; font-size: 0.9rem; margin: 0;">
                            Configure earnings, statutory deductions, LOP proration flags, and wage bases (PRD Sections 1 &amp; 4).
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button type="button" class="btn" onclick="window.KylrxPayrollComponentsUIController.openSimulatorModal()" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 10px; font-weight: 700; cursor: pointer; border: 1.5px solid #cbd5e1; background: white; color: #334155; transition: all 0.2s;">
                            <i data-lucide="calculator" style="width: 16px; height: 16px; color: #2563eb;"></i> Live Formula Simulator
                        </button>
                        <button type="button" class="btn" onclick="window.KylrxPayrollComponentsUIController.openAddComponentModal()" style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 10px; font-weight: 700; cursor: pointer; border: none; background: #2563eb; color: white; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.25); transition: all 0.2s;">
                            <i data-lucide="plus" style="width: 16px; height: 16px;"></i> Add Component
                        </button>
                    </div>
                </div>

                <!-- KPI Metric Cards -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.72rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Total Components</span>
                            <span style="background: #f1f5f9; color: #475569; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem;"><i data-lucide="list"></i></span>
                        </div>
                        <h3 style="font-size: 1.75rem; font-weight: 800; color: #0f172a; margin: 8px 0 0 0;">${totalCount}</h3>
                        <p style="font-size: 0.75rem; color: #94a3b8; margin: 4px 0 0 0;">Configured for Organization</p>
                    </div>

                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.72rem; font-weight: 800; color: #16a34a; text-transform: uppercase;">Earnings</span>
                            <span style="background: #f0fdf4; color: #16a34a; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem;"><i data-lucide="arrow-down-left"></i></span>
                        </div>
                        <h3 style="font-size: 1.75rem; font-weight: 800; color: #16a34a; margin: 8px 0 0 0;">${earningsCount}</h3>
                        <p style="font-size: 0.75rem; color: #94a3b8; margin: 4px 0 0 0;">Salary Allowances &amp; Basic</p>
                    </div>

                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.72rem; font-weight: 800; color: #d97706; text-transform: uppercase;">Deductions</span>
                            <span style="background: #fffbeb; color: #d97706; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem;"><i data-lucide="arrow-up-right"></i></span>
                        </div>
                        <h3 style="font-size: 1.75rem; font-weight: 800; color: #d97706; margin: 8px 0 0 0;">${deductionsCount}</h3>
                        <p style="font-size: 0.75rem; color: #94a3b8; margin: 4px 0 0 0;">PF, ESI, PT &amp; TDS</p>
                    </div>

                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.72rem; font-weight: 800; color: #7c3aed; text-transform: uppercase;">Statutory Linked</span>
                            <span style="background: #faf5ff; color: #7c3aed; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem;"><i data-lucide="shield-check"></i></span>
                        </div>
                        <h3 style="font-size: 1.75rem; font-weight: 800; color: #7c3aed; margin: 8px 0 0 0;">${statutoryCount}</h3>
                        <p style="font-size: 0.75rem; color: #94a3b8; margin: 4px 0 0 0;">Affects PF/ESI/PT/TDS Bases</p>
                    </div>
                </div>

                <!-- Navigation Tabs & Search Filter -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 0.75rem;">
                    <div style="display: flex; gap: 8px;">
                        <button type="button" onclick="window.KylrxPayrollComponentsUIController.setTab('ALL')" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; border: none; background: ${_activeTab === 'ALL' ? '#2563eb' : '#f1f5f9'}; color: ${_activeTab === 'ALL' ? 'white' : '#475569'}; transition: all 0.2s;">
                            All Components (${totalCount})
                        </button>
                        <button type="button" onclick="window.KylrxPayrollComponentsUIController.setTab('EARNINGS')" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; border: none; background: ${_activeTab === 'EARNINGS' ? '#16a34a' : '#f1f5f9'}; color: ${_activeTab === 'EARNINGS' ? 'white' : '#475569'}; transition: all 0.2s;">
                            Earnings (${earningsCount})
                        </button>
                        <button type="button" onclick="window.KylrxPayrollComponentsUIController.setTab('DEDUCTIONS')" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; border: none; background: ${_activeTab === 'DEDUCTIONS' ? '#d97706' : '#f1f5f9'}; color: ${_activeTab === 'DEDUCTIONS' ? 'white' : '#475569'}; transition: all 0.2s;">
                            Deductions (${deductionsCount})
                        </button>
                        <button type="button" onclick="window.KylrxPayrollComponentsUIController.setTab('OTHERS')" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; border: none; background: ${_activeTab === 'OTHERS' ? '#7c3aed' : '#f1f5f9'}; color: ${_activeTab === 'OTHERS' ? 'white' : '#475569'}; transition: all 0.2s;">
                            Employer &amp; Reimb. (${totalCount - (earningsCount + deductionsCount)})
                        </button>
                    </div>

                    <div style="position: relative; width: 280px;">
                        <input type="text" placeholder="Search by code or title..." value="${_searchQuery}" oninput="window.KylrxPayrollComponentsUIController.onSearchChange(this.value)" style="width: 100%; box-sizing: border-box; padding: 8px 12px 8px 34px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; outline: none;">
                        <span style="position: absolute; left: 10px; top: 9px; color: #94a3b8;"><i data-lucide="search" style="width: 16px; height: 16px;"></i></span>
                    </div>
                </div>

                <!-- Grouped Components Table -->
                <div style="background: white; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1.5px solid #e2e8f0; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.05em;">
                                    <th style="padding: 12px 16px;">Component</th>
                                    <th style="padding: 12px 12px;">Type</th>
                                    <th style="padding: 12px 12px;">Calculation</th>
                                    <th style="padding: 12px 12px;">Basis / Value</th>
                                    <th style="padding: 12px 10px; text-align: center;">Taxable</th>
                                    <th style="padding: 12px 10px; text-align: center;">PF</th>
                                    <th style="padding: 12px 10px; text-align: center;">ESI</th>
                                    <th style="padding: 12px 10px; text-align: center;">PT</th>
                                    <th style="padding: 12px 10px; text-align: center;">TDS</th>
                                    <th style="padding: 12px 10px; text-align: center;">LOP Prorate</th>
                                    <th style="padding: 12px 10px; text-align: center;">Status</th>
                                    <th style="padding: 12px 16px; text-align: right;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filtered.length === 0 ? `
                                    <tr>
                                        <td colspan="12" style="text-align: center; padding: 2.5rem; color: #94a3b8;">
                                            No payroll components match your filter criteria.
                                        </td>
                                    </tr>
                                ` : filtered.map(c => renderComponentRow(c)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        `;

        // Re-initialize Lucide icons if available in browser
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    /**
     * Renders a single component table row with interactive toggles
     */
    function renderComponentRow(c) {
        const typeBadge = {
            'Earning': 'background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0;',
            'Deduction': 'background: #fffbeb; color: #d97706; border: 1px solid #fde68a;',
            'Reimbursement': 'background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;',
            'Employer_Contribution': 'background: #faf5ff; color: #7c3aed; border: 1px solid #e9d5ff;'
        }[c.componentType] || 'background: #f1f5f9; color: #475569;';

        const basisDisplay = c.calculationMethod === 'Percentage'
            ? `<span style="font-weight: 700; color: #0f172a;">${c.defaultValueOrPercentage}%</span> <span style="font-size: 0.72rem; color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">of ${c.percentageBasis || 'BASIC'}</span>`
            : (c.defaultValueOrPercentage ? `₹${Number(c.defaultValueOrPercentage).toLocaleString('en-IN')}` : '-');

        return `
            <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                <td style="padding: 12px 16px;">
                    <div style="font-weight: 700; color: #0f172a;">${c.componentName}</div>
                    <div style="font-size: 0.72rem; color: #64748b; font-family: monospace;">${c.componentCode}</div>
                </td>
                <td style="padding: 12px 12px;">
                    <span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; ${typeBadge}">
                        ${c.componentType}
                    </span>
                </td>
                <td style="padding: 12px 12px; color: #334155; font-size: 0.8rem;">
                    ${c.calculationMethod}
                </td>
                <td style="padding: 12px 12px;">
                    ${basisDisplay}
                </td>

                <!-- Interactive Flag Toggles -->
                <td style="padding: 12px 10px; text-align: center;">
                    ${renderFlagToggle(c.componentCode, 'isTaxable', c.isTaxable)}
                </td>
                <td style="padding: 12px 10px; text-align: center;">
                    ${renderFlagToggle(c.componentCode, 'isPfApplicable', c.isPfApplicable)}
                </td>
                <td style="padding: 12px 10px; text-align: center;">
                    ${renderFlagToggle(c.componentCode, 'isEsiApplicable', c.isEsiApplicable)}
                </td>
                <td style="padding: 12px 10px; text-align: center;">
                    ${renderFlagToggle(c.componentCode, 'isPtApplicable', c.isPtApplicable)}
                </td>
                <td style="padding: 12px 10px; text-align: center;">
                    ${renderFlagToggle(c.componentCode, 'isTdsApplicable', c.isTdsApplicable)}
                </td>
                <td style="padding: 12px 10px; text-align: center;">
                    ${renderFlagToggle(c.componentCode, 'prorateOnLop', c.prorateOnLop, '#2563eb')}
                </td>
                <td style="padding: 12px 10px; text-align: center;">
                    ${renderFlagToggle(c.componentCode, 'isActive', c.isActive, '#16a34a')}
                </td>

                <td style="padding: 12px 16px; text-align: right; white-space: nowrap;">
                    <button type="button" onclick="window.KylrxPayrollComponentsUIController.openSimulatorModal('${c.componentCode}')" title="Test Live Formula" style="background: none; border: none; cursor: pointer; color: #2563eb; padding: 4px 6px; border-radius: 6px;">
                        <i data-lucide="play-circle" style="width: 16px; height: 16px;"></i>
                    </button>
                    <button type="button" onclick="window.KylrxPayrollComponentsUIController.openEditComponentModal('${c.componentCode}')" title="Edit Component" style="background: none; border: none; cursor: pointer; color: #475569; padding: 4px 6px; border-radius: 6px;">
                        <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
                    </button>
                    <button type="button" onclick="window.KylrxPayrollComponentsUIController.deleteComponentPrompt('${c.componentCode}')" title="Delete Component" style="background: none; border: none; cursor: pointer; color: #dc2626; padding: 4px 6px; border-radius: 6px;">
                        <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    /**
     * Renders a clickable micro-toggle pill
     */
    function renderFlagToggle(code, field, isTrue, activeColor = '#059669') {
        const bg = isTrue ? activeColor : '#e2e8f0';
        const textColor = isTrue ? 'white' : '#64748b';
        const label = isTrue ? 'Yes' : 'No';

        return `
            <button type="button" 
                onclick="window.KylrxPayrollComponentsUIController.toggleFlag('${code}', '${field}')" 
                style="padding: 3px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 700; cursor: pointer; border: none; background: ${bg}; color: ${textColor}; transition: all 0.2s;"
                title="Toggle ${field}">
                ${label}
            </button>
        `;
    }

    /**
     * Toggles a boolean flag and saves immediately
     */
    async function toggleFlag(componentCode, field) {
        const svc = getService();
        if (!svc) return;

        const comp = svc.getPayrollComponent(componentCode, _activeOrgId);
        if (!comp) return;

        comp[field] = !comp[field];
        comp.updatedAt = new Date().toISOString();

        await svc.savePayrollComponent(comp, _activeOrgId);
        renderAdminConsole('payrollComponentsConsoleContainer', _activeOrgId);
        showToast(`Updated ${comp.componentName} (${field} = ${comp[field] ? 'Yes' : 'No'})`);
    }

    function setTab(tab) {
        _activeTab = tab;
        renderAdminConsole('payrollComponentsConsoleContainer', _activeOrgId);
    }

    function onSearchChange(val) {
        _searchQuery = val;
        renderAdminConsole('payrollComponentsConsoleContainer', _activeOrgId);
    }

    /**
     * Live Formula & LOP Simulator Modal
     */
    function openSimulatorModal(targetCode = 'HRA') {
        const svc = getService();
        const allComps = svc ? svc.listPayrollComponents(_activeOrgId) : [];
        let modal = document.getElementById('payrollSimulatorModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'payrollSimulatorModal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem; backdrop-filter: blur(4px);">
                <div style="background: white; border-radius: 18px; max-width: 600px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); overflow: hidden; display: flex; flex-direction: column;">
                    
                    <div style="padding: 1.25rem 1.5rem; border-bottom: 1.5px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.2rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                            <i data-lucide="calculator" style="color: #2563eb;"></i> Live Formula &amp; LOP Simulator
                        </h3>
                        <button type="button" onclick="document.getElementById('payrollSimulatorModal').innerHTML=''" style="background: none; border: none; font-size: 1.25rem; cursor: pointer; color: #94a3b8;">&times;</button>
                    </div>

                    <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Target Component</label>
                                <select id="simTargetComp" onchange="window.KylrxPayrollComponentsUIController.evaluateSimulator()" style="width: 100%; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
                                    ${allComps.map(c => `<option value="${c.componentCode}" ${c.componentCode === targetCode ? 'selected' : ''}>${c.componentName} (${c.componentCode})</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Base Amount (BASIC)</label>
                                <input type="number" id="simBaseAmt" value="50000" oninput="window.KylrxPayrollComponentsUIController.evaluateSimulator()" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Calendar Days</label>
                                <input type="number" id="simCalendarDays" value="30" oninput="window.KylrxPayrollComponentsUIController.evaluateSimulator()" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Loss of Pay (LOP) Days</label>
                                <input type="number" id="simLopDays" value="3" oninput="window.KylrxPayrollComponentsUIController.evaluateSimulator()" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
                            </div>
                        </div>

                        <!-- Live Evaluation Card -->
                        <div id="simResultsCard" style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 1.25rem;">
                            <!-- Populated dynamically by evaluateSimulator() -->
                        </div>
                    </div>

                    <div style="padding: 1rem 1.5rem; background: #f8fafc; border-top: 1.5px solid #e2e8f0; display: flex; justify-content: flex-end;">
                        <button type="button" onclick="document.getElementById('payrollSimulatorModal').innerHTML=''" style="padding: 8px 18px; border-radius: 8px; border: 1.5px solid #cbd5e1; background: white; color: #475569; font-weight: 700; cursor: pointer;">Close</button>
                    </div>

                </div>
            </div>
        `;

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }

        evaluateSimulator();
    }

    /**
     * Performs dynamic live calculation inside the simulator modal
     */
    function evaluateSimulator() {
        const targetCode = (document.getElementById('simTargetComp')?.value || 'HRA').toUpperCase();
        const baseAmt = Number(document.getElementById('simBaseAmt')?.value) || 0;
        const calendarDays = Number(document.getElementById('simCalendarDays')?.value) || 30;
        const lopDays = Number(document.getElementById('simLopDays')?.value) || 0;

        const svc = getService();
        const comp = svc ? svc.getPayrollComponent(targetCode, _activeOrgId) : null;
        const resultsEl = document.getElementById('simResultsCard');
        if (!comp || !resultsEl) return;

        // Calculate scheduled amount
        let scheduledAmount = 0;
        if (comp.calculationMethod === 'Percentage') {
            scheduledAmount = Math.round(((Number(comp.defaultValueOrPercentage || 0) / 100) * baseAmt) * 100) / 100;
        } else {
            scheduledAmount = Number(comp.defaultValueOrPercentage || baseAmt);
        }

        // LOP factor
        const paidDays = Math.max(0, calendarDays - lopDays);
        const prorationFactor = calendarDays > 0 ? (paidDays / calendarDays) : 1.0;
        const earnedAmount = comp.prorateOnLop 
            ? Math.round(scheduledAmount * prorationFactor * 100) / 100
            : scheduledAmount;

        resultsEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <span style="font-size: 0.85rem; font-weight: 800; color: #0f172a;">${comp.componentName} (${comp.componentCode})</span>
                <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: ${comp.prorateOnLop ? '#eff6ff' : '#f1f5f9'}; color: ${comp.prorateOnLop ? '#2563eb' : '#64748b'}; font-weight: 700;">
                    ${comp.prorateOnLop ? 'LOP Prorated' : 'Fixed Component'}
                </span>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; text-align: center; margin-bottom: 0.75rem;">
                <div style="background: white; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 0.7rem; color: #64748b; font-weight: 700;">Scheduled Full Value</div>
                    <div style="font-size: 1.1rem; font-weight: 800; color: #0f172a;">₹${scheduledAmount.toLocaleString('en-IN')}</div>
                </div>
                <div style="background: white; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 0.7rem; color: #64748b; font-weight: 700;">Proration Factor</div>
                    <div style="font-size: 1.1rem; font-weight: 800; color: #2563eb;">${Math.round(prorationFactor * 10000) / 10000}</div>
                    <div style="font-size: 0.65rem; color: #94a3b8;">${paidDays}/${calendarDays} Days</div>
                </div>
                <div style="background: white; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 0.7rem; color: #16a34a; font-weight: 700;">Earned Pay Amount</div>
                    <div style="font-size: 1.1rem; font-weight: 800; color: #16a34a;">₹${earnedAmount.toLocaleString('en-IN')}</div>
                </div>
            </div>

            <div style="font-size: 0.72rem; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between;">
                <span>Statutory Impact:</span>
                <span>
                    PF: <b>${comp.isPfApplicable ? 'Included' : 'Excluded'}</b> |
                    ESI: <b>${comp.isEsiApplicable ? 'Included' : 'Excluded'}</b> |
                    PT: <b>${comp.isPtApplicable ? 'Included' : 'Excluded'}</b> |
                    Taxable: <b>${comp.isTaxable ? 'Yes' : 'No'}</b>
                </span>
            </div>
        `;
    }

    /**
     * Add Component Modal
     */
    function openAddComponentModal() {
        openEditComponentModal(null);
    }

    /**
     * Edit Component Modal
     */
    function openEditComponentModal(componentCode = null) {
        const svc = getService();
        const existing = componentCode && svc ? svc.getPayrollComponent(componentCode, _activeOrgId) : null;

        let modal = document.getElementById('payrollEditModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'payrollEditModal';
            document.body.appendChild(modal);
        }

        const isEdit = Boolean(existing);
        const data = existing || {
            componentCode: '',
            componentName: '',
            componentType: 'Earning',
            calculationMethod: 'Flat_Amount',
            defaultValueOrPercentage: 0,
            percentageBasis: 'BASIC',
            isTaxable: true,
            isPfApplicable: false,
            isEsiApplicable: true,
            isPtApplicable: true,
            isTdsApplicable: true,
            prorateOnLop: true,
            isActive: true
        };

        modal.innerHTML = `
            <div style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem; backdrop-filter: blur(4px);">
                <div style="background: white; border-radius: 18px; max-width: 650px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); overflow: hidden; display: flex; flex-direction: column; max-height: 90vh;">
                    
                    <div style="padding: 1.25rem 1.5rem; border-bottom: 1.5px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.2rem; font-weight: 800; color: #0f172a;">
                            ${isEdit ? `Edit Component: ${data.componentName}` : 'Add New Payroll Component'}
                        </h3>
                        <button type="button" onclick="document.getElementById('payrollEditModal').innerHTML=''" style="background: none; border: none; font-size: 1.25rem; cursor: pointer; color: #94a3b8;">&times;</button>
                    </div>

                    <form id="payrollComponentForm" onsubmit="window.KylrxPayrollComponentsUIController.saveComponentFromForm(event, ${isEdit})" style="padding: 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Component Code *</label>
                                <input type="text" id="formCompCode" value="${data.componentCode}" ${isEdit ? 'readonly style="background: #f1f5f9;"' : ''} required placeholder="e.g. HRA, BASIC, MED_ALLOW" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; text-transform: uppercase;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Component Title *</label>
                                <input type="text" id="formCompName" value="${data.componentName}" required placeholder="e.g. House Rent Allowance" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Component Type *</label>
                                <select id="formCompType" style="width: 100%; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
                                    <option value="Earning" ${data.componentType === 'Earning' ? 'selected' : ''}>Earning</option>
                                    <option value="Deduction" ${data.componentType === 'Deduction' ? 'selected' : ''}>Deduction</option>
                                    <option value="Reimbursement" ${data.componentType === 'Reimbursement' ? 'selected' : ''}>Reimbursement</option>
                                    <option value="Employer_Contribution" ${data.componentType === 'Employer_Contribution' ? 'selected' : ''}>Employer Contribution</option>
                                </select>
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Calculation Method *</label>
                                <select id="formCalcMethod" style="width: 100%; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
                                    <option value="Flat_Amount" ${data.calculationMethod === 'Flat_Amount' ? 'selected' : ''}>Flat Amount</option>
                                    <option value="Percentage" ${data.calculationMethod === 'Percentage' ? 'selected' : ''}>Percentage</option>
                                    <option value="Formula" ${data.calculationMethod === 'Formula' ? 'selected' : ''}>Formula</option>
                                    <option value="Slab" ${data.calculationMethod === 'Slab' ? 'selected' : ''}>Slab</option>
                                </select>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Value or Percentage</label>
                                <input type="number" step="0.01" id="formValPct" value="${data.defaultValueOrPercentage || 0}" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Percentage Basis (if percentage)</label>
                                <input type="text" id="formPctBasis" value="${data.percentageBasis || ''}" placeholder="e.g. BASIC, GROSS, CTC" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; text-transform: uppercase;">
                            </div>
                        </div>

                        <!-- Statutory Flags & Toggles Grid -->
                        <div style="background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
                            <span style="font-size: 0.75rem; font-weight: 800; color: #475569; text-transform: uppercase;">Statutory &amp; Calculation Flags</span>
                            
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem;">
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; cursor: pointer;">
                                    <input type="checkbox" id="formTaxable" ${data.isTaxable ? 'checked' : ''}> Taxable
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; cursor: pointer;">
                                    <input type="checkbox" id="formPf" ${data.isPfApplicable ? 'checked' : ''}> PF Applicable
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; cursor: pointer;">
                                    <input type="checkbox" id="formEsi" ${data.isEsiApplicable ? 'checked' : ''}> ESI Applicable
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; cursor: pointer;">
                                    <input type="checkbox" id="formPt" ${data.isPtApplicable ? 'checked' : ''}> PT Applicable
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; cursor: pointer;">
                                    <input type="checkbox" id="formTds" ${data.isTdsApplicable ? 'checked' : ''}> TDS Applicable
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; cursor: pointer; color: #2563eb; font-weight: 700;">
                                    <input type="checkbox" id="formLop" ${data.prorateOnLop ? 'checked' : ''}> Prorate On LOP
                                </label>
                            </div>

                            <div style="border-top: 1px solid #e2e8f0; padding-top: 8px;">
                                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; cursor: pointer; color: #16a34a; font-weight: 700;">
                                    <input type="checkbox" id="formActive" ${data.isActive ? 'checked' : ''}> Active Status
                                </label>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 0.5rem;">
                            <button type="button" onclick="document.getElementById('payrollEditModal').innerHTML=''" style="padding: 10px 18px; border-radius: 8px; border: 1.5px solid #cbd5e1; background: white; color: #475569; font-weight: 700; cursor: pointer;">Cancel</button>
                            <button type="submit" style="padding: 10px 22px; border-radius: 8px; border: none; background: #2563eb; color: white; font-weight: 700; cursor: pointer;">Save Component</button>
                        </div>
                    </form>

                </div>
            </div>
        `;
    }

    /**
     * Handles saving from the modal form
     */
    async function saveComponentFromForm(e, isEdit) {
        e.preventDefault();
        const svc = getService();
        if (!svc) return;

        const compCode = (document.getElementById('formCompCode')?.value || '').trim().toUpperCase();
        const compName = (document.getElementById('formCompName')?.value || '').trim();
        const compType = document.getElementById('formCompType')?.value || 'Earning';
        const calcMethod = document.getElementById('formCalcMethod')?.value || 'Flat_Amount';
        const valPct = Number(document.getElementById('formValPct')?.value) || 0;
        const pctBasis = (document.getElementById('formPctBasis')?.value || '').trim().toUpperCase() || null;

        const isTaxable = document.getElementById('formTaxable')?.checked || false;
        const isPf = document.getElementById('formPf')?.checked || false;
        const isEsi = document.getElementById('formEsi')?.checked || false;
        const isPt = document.getElementById('formPt')?.checked || false;
        const isTds = document.getElementById('formTds')?.checked || false;
        const prorateOnLop = document.getElementById('formLop')?.checked || false;
        const isActive = document.getElementById('formActive')?.checked || false;

        if (calcMethod === 'Percentage' && !pctBasis) {
            alert('Please specify a Percentage Basis (e.g. BASIC, GROSS, CTC) when Calculation Method is Percentage.');
            return;
        }

        const componentRecord = {
            componentCode: compCode,
            componentName: compName,
            componentType: compType,
            calculationMethod: calcMethod,
            defaultValueOrPercentage: valPct,
            percentageBasis: pctBasis,
            isTaxable,
            isPfApplicable: isPf,
            isEsiApplicable: isEsi,
            isPtApplicable: isPt,
            isTdsApplicable: isTds,
            prorateOnLop,
            isActive,
            updatedAt: new Date().toISOString()
        };

        await svc.savePayrollComponent(componentRecord, _activeOrgId);
        document.getElementById('payrollEditModal').innerHTML = '';
        renderAdminConsole('payrollComponentsConsoleContainer', _activeOrgId);
        showToast(`Saved component ${compName} (${compCode})`);
    }

    /**
     * Delete confirmation prompt
     */
    async function deleteComponentPrompt(componentCode) {
        if (!confirm(`Are you sure you want to delete component "${componentCode}"? This action cannot be undone.`)) {
            return;
        }

        const svc = getService();
        if (!svc) return;

        await svc.deletePayrollComponent(componentCode, _activeOrgId);
        renderAdminConsole('payrollComponentsConsoleContainer', _activeOrgId);
        showToast(`Deleted component ${componentCode}`);
    }

    /**
     * Minimal toast notification
     */
    function showToast(message) {
        let toast = document.getElementById('payrollUiToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'payrollUiToast';
            toast.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: #0f172a; color: white; padding: 12px 20px; border-radius: 10px; font-size: 0.85rem; font-weight: 600; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); z-index: 10000; transition: opacity 0.3s; opacity: 0; pointer-events: none;';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = '1';
        setTimeout(() => {
            toast.style.opacity = '0';
        }, 3000);
    }

    return {
        renderAdminConsole,
        renderComponentRow,
        renderFlagToggle,
        toggleFlag,
        setTab,
        onSearchChange,
        openSimulatorModal,
        evaluateSimulator,
        openAddComponentModal,
        openEditComponentModal,
        saveComponentFromForm,
        deleteComponentPrompt,
        showToast
    };
}));
