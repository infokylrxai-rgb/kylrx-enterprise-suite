/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PROFESSIONAL TAX (PT) UI CONTROLLER
 * ============================================================================
 * 
 * Renders the "Professional Tax Profile" status card inside the Employee Profile drawer
 * (admin-dashboard.html Statutory tab) matching PRD Section 13:
 * 
 * 1. State Jurisdiction, PTRC Number, Assigned Slab Code, Monthly Deduction, and Active status badge.
 * 2. Inline "Recalculate PT" action evaluating salary against regional state matrices.
 * 3. State PT exemption indicators (Senior Citizen, Disability PWD exemptions).
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
        root.KylrxPtProfileUIController = factory();
        root.ptProfileUIController = root.KylrxPtProfileUIController;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function escapeHtml(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Renders the complete Professional Tax Statutory Profile Card HTML.
     */
    function renderCardHtml(ptDetails = {}, employeeInfo = {}) {
        let service = null;
        if (typeof window !== 'undefined' && window.KylrxPtDetailsService) {
            service = window.KylrxPtDetailsService;
        } else if (typeof require === 'function') {
            try {
                service = require('./ptDetailsService.js');
            } catch (e) {}
        }

        const isPtApplicable = ptDetails.isPtApplicable !== false;
        const isActive = ptDetails.isActive !== false;
        const stateName = ptDetails.state || employeeInfo.state || "Karnataka";
        const ptrcNo = ptDetails.ptRegistrationNo || `PTRC_${stateName.slice(0, 2).toUpperCase()}_01`;
        const slabCode = ptDetails.ptSlab || `${stateName.slice(0, 2).toUpperCase()}_DEFAULT`;
        const monthlyDeduction = ptDetails.monthlyDeduction !== undefined ? Number(ptDetails.monthlyDeduction) : 200.00;
        const effectiveFrom = ptDetails.effectiveFrom || "2026-01-01";
        const effectiveTo = ptDetails.effectiveTo || "Active / Ongoing";

        const hasServiceStatus = Boolean(service && typeof service.resolvePtStatusBadge === 'function');
        const statusBadge = hasServiceStatus
            ? service.resolvePtStatusBadge(isActive, isPtApplicable)
            : { label: isActive ? 'Active PT' : 'Inactive', bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' };

        const overrides = ptDetails.overrides || {};
        const isOverride = Boolean(overrides.isManualOverride);
        const exemptReason = overrides.exemptReason || (isPtApplicable ? null : "Explicitly Exempt");

        return `
        <div id="ptStatutoryMasterCard" class="modal-section-card" style="margin-bottom: 1.25rem; border: 1.5px solid #059669; border-radius: 16px; background: #ffffff; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.08); overflow: hidden;">
            <!-- Header Section -->
            <div style="background: linear-gradient(135deg, #047857 0%, #059669 100%); padding: 1.1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; color: white;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                        <i data-lucide="scale" style="width: 22px; height: 22px; color: #ffffff;"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; letter-spacing: -0.01em; color: #ffffff;">Professional Tax (PT) Statutory Profile</h4>
                        <p style="margin: 2px 0 0 0; font-size: 0.72rem; color: rgba(255, 255, 255, 0.85);">PRD §§ 1, 4, 11 &amp; 13 • 10-Column Multi-State Matrix &amp; PTRC Return Engine</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="ptStatusHeaderBadge" style="padding: 4px 10px; border-radius: 9999px; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; background: ${statusBadge.bg}; color: ${statusBadge.color}; border: 1px solid ${statusBadge.border}; display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="${statusBadge.icon || 'check-circle'}" style="width: 12px; height: 12px;"></i>
                        <span id="ptStatusHeaderText">${statusBadge.label}</span>
                    </span>
                    <button type="button" id="btnRecalculatePt" class="btn" style="background: #ffffff; color: #047857; font-size: 0.76rem; font-weight: 800; padding: 6px 14px; border-radius: 8px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;">
                        <i data-lucide="refresh-cw" id="ptRecalcIcon" style="width: 13px; height: 13px;"></i>
                        <span id="ptRecalcBtnText">Recalculate PT</span>
                    </button>
                </div>
            </div>

            <!-- Card Body Content -->
            <div style="padding: 1.25rem;">
                <!-- Live Status & Jurisdiction Matrix -->
                <div style="margin-bottom: 1.25rem;">
                    <div style="font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <i data-lucide="map-pin" style="width: 14px; height: 14px; color: #059669;"></i>
                        State Jurisdiction &amp; Active Statutory Slabs
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 10px;">
                        <!-- State Jurisdiction Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">State</span>
                            <span id="pillPtState" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.74rem; font-weight: 800; color: #0f172a; background: #ffffff; border: 1px solid #cbd5e1; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="map-pin" style="width: 11px; height: 11px; color: #059669;"></i>
                                <span id="textPtState">${escapeHtml(stateName)}</span>
                            </span>
                        </div>

                        <!-- PTRC Number Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">PTRC Reg No</span>
                            <span id="pillPtrcNo" style="font-family: monospace; font-size: 0.72rem; font-weight: 700; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                ${escapeHtml(ptrcNo)}
                            </span>
                        </div>

                        <!-- Assigned Slab Code Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Assigned Slab</span>
                            <span id="pillPtSlab" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 800; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="tag" style="width: 11px; height: 11px;"></i>
                                <span id="textPtSlab">${escapeHtml(slabCode)}</span>
                            </span>
                        </div>

                        <!-- Monthly Deduction Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Monthly Deduction</span>
                            <span id="pillPtAmount" style="font-size: 0.88rem; font-weight: 800; color: #047857; width: fit-content;">
                                ₹<span id="textPtAmount">${monthlyDeduction.toFixed(2)}</span>
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Detailed Attributes Grid (All 10 Attributes Visualized) -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; background: #f8fafc; padding: 14px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 1.25rem;">
                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">PT Applicable</div>
                        <div id="ptDisplayApplicable" style="font-size: 0.86rem; font-weight: 700; color: ${isPtApplicable ? '#059669' : '#dc2626'}; margin-top: 2px;">
                            ${isPtApplicable ? 'Yes (Mandatory Statutory Deduction)' : 'No (Statutorily Exempt)'}
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Effective Window</div>
                        <div style="font-size: 0.84rem; font-weight: 600; color: #334155; margin-top: 2px;">
                            ${escapeHtml(effectiveFrom)} &nbsp;→&nbsp; <span style="color: ${effectiveTo === 'Active / Ongoing' ? '#059669' : '#dc2626'}">${escapeHtml(effectiveTo)}</span>
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Exemption Status</div>
                        <div id="ptDisplayExemption" style="font-size: 0.84rem; font-weight: 600; color: ${exemptReason ? '#d97706' : '#64748b'}; margin-top: 2px;">
                            ${escapeHtml(exemptReason || 'Standard State Taxable Profile')}
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Calculation Mode</div>
                        <div id="ptDisplayCalcMode" style="font-size: 0.84rem; font-weight: 700; color: #1e293b; margin-top: 2px;">
                            ${isOverride ? '<span style="color: #b45309;">Administrative Manual Override</span>' : '<span style="color: #047857;">Dynamic Multi-State Matrix</span>'}
                        </div>
                    </div>
                </div>

                <!-- Multi-State Slab Rules Callout (PRD §§ 4 & 11) -->
                <div style="background: #f0fdf4; border: 1px dashed #86efac; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.74rem; font-weight: 800; color: #166534; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="info" style="width: 14px; height: 14px; color: #16a34a;"></i>
                            Statutory Multi-State Slab Rules (PRD Section 4)
                        </span>
                        <span style="font-size: 0.7rem; font-weight: 700; color: #15803d; background: #dcfce7; padding: 2px 8px; border-radius: 6px;">
                            Active Jurisdiction: ${escapeHtml(stateName)}
                        </span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; font-size: 0.72rem; color: #14532d; margin-top: 4px;">
                        <div>
                            <strong>Karnataka:</strong><br>
                            Gross &ge; ₹25,000 &rarr; ₹200/mo (Below: Nil)
                        </div>
                        <div>
                            <strong>Maharashtra:</strong><br>
                            M: &gt; ₹10k &rarr; ₹200 (₹300 Feb)<br>
                            F: &gt; ₹25k &rarr; ₹200 (₹300 Feb)
                        </div>
                        <div>
                            <strong>Telangana / AP:</strong><br>
                            &gt; ₹15k &rarr; ₹150; &gt; ₹20k &rarr; ₹200
                        </div>
                        <div>
                            <strong>Remittance Cycle:</strong><br>
                            PTRC Monthly Return Schedule
                        </div>
                    </div>
                </div>

                <!-- Last Evaluated Footer -->
                <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; color: #94a3b8;">
                    <span>Employer PTRC: <strong id="ptDisplayFooterPtrc" style="color: #64748b; font-family: monospace;">${escapeHtml(ptrcNo)}</strong></span>
                    <span>State Jurisdiction: <strong id="ptDisplayFooterState" style="color: #64748b;">${escapeHtml(stateName)}</strong></span>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Binds events, recalculation triggers, and notification alerts.
     */
    function bindEvents(container, employeeId, options = {}) {
        if (!container) return;

        const recalcBtn = container.querySelector('#btnRecalculatePt');
        if (recalcBtn) {
            recalcBtn.onclick = async function (e) {
                e.preventDefault();
                const orgId = options.orgId || (typeof localStorage !== 'undefined' ? localStorage.getItem('orgId') : null) || 'ORG_KYLRX_01';
                const btnText = container.querySelector('#ptRecalcBtnText');
                const btnIcon = container.querySelector('#ptRecalcIcon');

                try {
                    recalcBtn.disabled = true;
                    if (btnText) btnText.textContent = 'Evaluating Slabs...';
                    if (btnIcon) btnIcon.classList.add('animate-spin');

                    let service = window.KylrxPtDetailsService;
                    if (!service && typeof require === 'function') {
                        try {
                            service = require('./ptDetailsService.js');
                        } catch (err) {}
                    }

                    if (!service || typeof service.calculatePtDeduction !== 'function') {
                        throw new Error("KylrxPtDetailsService is unavailable or not loaded.");
                    }

                    const profile = await service.getEmployeePtDetails(orgId, employeeId) || {
                        employeeId,
                        state: options.state || "Karnataka",
                        isPtApplicable: true
                    };

                    const grossSalary = options.grossSalary || options.grossWages || options.basic || 30000;
                    const calc = service.calculatePtDeduction(profile, grossSalary, {
                        gender: options.gender || 'male',
                        month: options.month || new Date().toLocaleString('en-US', { month: 'short' }),
                        isSeniorCitizen: Boolean(options.isSeniorCitizen)
                    });

                    // Update UI in-place
                    const textAmount = container.querySelector('#textPtAmount');
                    if (textAmount) textAmount.textContent = calc.deduction.toFixed(2);

                    const textSlab = container.querySelector('#textPtSlab');
                    if (textSlab) textSlab.textContent = calc.slab;

                    // Persist recalculated deduction
                    profile.monthlyDeduction = calc.deduction;
                    profile.ptSlab = calc.slab;
                    await service.saveEmployeePtDetails(orgId, employeeId, profile);

                    if (window.showCustomAlert) {
                        window.showCustomAlert(
                            "PT Recalculated",
                            `Evaluated against ${calc.state} rules. Computed Deduction: ₹${calc.deduction.toFixed(2)} (${calc.reason})`,
                            "success"
                        );
                    } else {
                        alert(`PT Recalculated for ${employeeId}: ₹${calc.deduction.toFixed(2)} (${calc.reason})`);
                    }
                } catch (err) {
                    console.error("PT Recalculation Failed:", err);
                    if (window.showCustomAlert) {
                        window.showCustomAlert("Recalculate Error", err.message || "Failed to evaluate PT slabs.", "error");
                    } else {
                        alert("Recalculate error: " + err.message);
                    }
                } finally {
                    if (btnText) btnText.textContent = 'Recalculate PT';
                    if (btnIcon) btnIcon.classList.remove('animate-spin');
                    recalcBtn.disabled = false;
                    if (window.lucide) lucide.createIcons();
                }
            };
        }
    }

    /**
     * Mounts the PT card inside target container element.
     */
    async function mountPtCard(targetContainerId, employeeId, options = {}) {
        let container = typeof targetContainerId === 'string'
            ? document.getElementById(targetContainerId)
            : targetContainerId;

        if (!container) return;

        const orgId = options.orgId || (typeof localStorage !== 'undefined' ? localStorage.getItem('orgId') : null) || 'ORG_KYLRX_01';
        let ptDetails = null;

        let service = (typeof window !== 'undefined' && window.KylrxPtDetailsService) ? window.KylrxPtDetailsService : null;
        if (!service && typeof require === 'function') {
            try {
                service = require('./ptDetailsService.js');
            } catch (e) {}
        }

        if (service && typeof service.getEmployeePtDetails === 'function') {
            try {
                ptDetails = await service.getEmployeePtDetails(orgId, employeeId);
            } catch (e) {}
        }

        if (!ptDetails && service && Array.isArray(service.DEFAULT_PT_PROFILES)) {
            ptDetails = service.DEFAULT_PT_PROFILES.find(p => p.employeeId === employeeId);
        }

        if (!ptDetails) {
            ptDetails = {
                employeeId,
                organizationId: orgId,
                isPtApplicable: options.isPtApplicable !== false,
                state: options.state || "Karnataka",
                ptRegistrationNo: options.ptRegistrationNo || "PTRC1234567K",
                ptSlab: options.ptSlab || "KA_DEFAULT",
                monthlyDeduction: options.monthlyDeduction !== undefined ? options.monthlyDeduction : 200.00,
                effectiveFrom: options.effectiveFrom || options.joiningDate || "2026-01-01",
                effectiveTo: options.effectiveTo || null,
                isActive: options.isActive !== false,
                overrides: { isManualOverride: false, exemptReason: null }
            };
        } else if (options && Object.keys(options).length > 0) {
            if (options.state) ptDetails.state = options.state;
            if (options.ptRegistrationNo) ptDetails.ptRegistrationNo = options.ptRegistrationNo;
            if (options.ptSlab) ptDetails.ptSlab = options.ptSlab;
            if (options.monthlyDeduction !== undefined) ptDetails.monthlyDeduction = options.monthlyDeduction;
            if (options.isActive !== undefined) ptDetails.isActive = options.isActive;
        }

        container.innerHTML = renderCardHtml(ptDetails, options);
        bindEvents(container, employeeId, options);

        if (typeof window !== 'undefined' && window.lucide) {
            window.lucide.createIcons();
        }
    }

    return {
        renderCardHtml,
        bindEvents,
        mountPtCard
    };
}));
