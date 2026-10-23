/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - LABOUR WELFARE FUND (LWF) UI CONTROLLER
 * ============================================================================
 * 
 * Renders the "Labour Welfare Fund (LWF)" status card inside the Employee Profile drawer
 * (admin-dashboard.html Statutory tab) matching PRD Sections 4, 11, & 13:
 * 
 * 1. State Jurisdiction, Frequency, Registration Number, and upcoming scheduled deduction month.
 * 2. Inline toggle for LWF Applicable with dynamic auto-fill of standard state rates.
 * 3. Interactive simulation & deduction evaluation for pay runs.
 * 4. Direct Cloud Firestore persistence.
 * 
 * @version 1.0.0
 * @author Principal Fintech & Statutory Payroll Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxLwfProfileUIController = factory();
        root.lwfProfileUIController = root.KylrxLwfProfileUIController;
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
     * Standard state rates lookup for dynamic auto-population in the UI
     */
    const STATE_LWF_RATES = {
        "Karnataka": { frequency: "Annual", ee: 20.00, er: 40.00, months: [12], prefix: "LWF/KA" },
        "Maharashtra": { frequency: "Half-Yearly", ee: 12.00, er: 36.00, months: [6, 12], prefix: "LWF/MH" },
        "Delhi": { frequency: "Half-Yearly", ee: 0.75, er: 2.25, months: [6, 12], prefix: "LWF/DL" },
        "Tamil Nadu": { frequency: "Annual", ee: 20.00, er: 40.00, months: [12], prefix: "LWF/TN" },
        "Gujarat": { frequency: "Half-Yearly", ee: 6.00, er: 12.00, months: [6, 12], prefix: "LWF/GJ" },
        "Haryana": { frequency: "Monthly", ee: 25.00, er: 50.00, months: [1,2,3,4,5,6,7,8,9,10,11,12], prefix: "LWF/HR" },
        "Telangana": { frequency: "Annual", ee: 20.00, er: 40.00, months: [12], prefix: "LWF/TS" },
        "Andhra Pradesh": { frequency: "Annual", ee: 20.00, er: 40.00, months: [12], prefix: "LWF/AP" },
        "Kerala": { frequency: "Half-Yearly", ee: 20.00, er: 20.00, months: [6, 12], prefix: "LWF/KL" },
        "Madhya Pradesh": { frequency: "Half-Yearly", ee: 10.00, er: 30.00, months: [6, 12], prefix: "LWF/MP" }
    };

    /**
     * Renders the complete Labour Welfare Fund (LWF) Statutory Profile Card HTML.
     */
    function renderCardHtml(lwfDetails = {}, employeeInfo = {}) {
        let service = null;
        if (typeof window !== 'undefined' && window.KylrxLwfDetailsService) {
            service = window.KylrxLwfDetailsService;
        } else if (typeof require === 'function') {
            try {
                service = require('./lwfDetailsService.js');
            } catch (e) {}
        }

        const isLwfApplicable = lwfDetails.isLwfApplicable !== false && lwfDetails['LWF Applicable'] !== 'No';
        const stateName = lwfDetails.state || employeeInfo.state || "Karnataka";
        const stateRates = STATE_LWF_RATES[stateName] || STATE_LWF_RATES["Karnataka"];
        const frequency = lwfDetails.frequency || stateRates.frequency || "Annual";
        const regNo = lwfDetails.employerRegistrationNo || lwfDetails['Employer Registration No'] || `${stateRates.prefix}/BNG/2026/0912`;
        const eeContrib = lwfDetails.employeeContribution !== undefined ? Number(lwfDetails.employeeContribution) : stateRates.ee;
        const erContrib = lwfDetails.employerContribution !== undefined ? Number(lwfDetails.employerContribution) : stateRates.er;
        const totalContrib = eeContrib + erContrib;
        const effectiveFrom = lwfDetails.effectiveFrom || "2026-01-01";
        const effectiveTo = lwfDetails.effectiveTo || "Active / Ongoing";

        let schedule = lwfDetails.deductionSchedule;
        if (!schedule && service && typeof service.computeDeductionSchedule === 'function') {
            schedule = service.computeDeductionSchedule(frequency, stateName);
        }
        const nextDeduction = schedule?.nextDeduction || "2026-12";
        const deductionMonths = schedule?.deductionMonths || stateRates.months || [12];

        const hasServiceStatus = Boolean(service && typeof service.resolveLwfStatusBadge === 'function');
        const statusBadge = hasServiceStatus
            ? service.resolveLwfStatusBadge(isLwfApplicable, frequency, nextDeduction)
            : { label: isLwfApplicable ? `Active (${frequency})` : 'Exempt', bg: isLwfApplicable ? '#eff6ff' : '#f1f5f9', color: isLwfApplicable ? '#1d4ed8' : '#475569', border: isLwfApplicable ? '#bfdbfe' : '#cbd5e1' };

        return `
        <div id="lwfStatutoryMasterCard" class="modal-section-card" style="margin-bottom: 1.25rem; border: 1.5px solid #2563eb; border-radius: 16px; background: #ffffff; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08); overflow: hidden;">
            <!-- Header Section -->
            <div style="background: linear-gradient(135deg, #1e40af 0%, #2563eb 100%); padding: 1.1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; color: white;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                        <i data-lucide="shield-check" style="width: 22px; height: 22px; color: #ffffff;"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; letter-spacing: -0.01em; color: #ffffff;">Labour Welfare Fund (LWF) Statutory Profile</h4>
                        <p style="margin: 2px 0 0 0; font-size: 0.72rem; color: rgba(255, 255, 255, 0.85);">PRD §§ 1, 4, 11 &amp; 13 • 10-Attribute State Frequency Deduction &amp; Remittance Engine</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="lwfStatusHeaderBadge" style="padding: 4px 10px; border-radius: 9999px; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; background: ${statusBadge.bg}; color: ${statusBadge.color}; border: 1px solid ${statusBadge.border}; display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="${statusBadge.icon || 'shield-check'}" style="width: 12px; height: 12px;"></i>
                        <span id="lwfStatusHeaderText">${statusBadge.label}</span>
                    </span>
                    <button type="button" id="btnEvaluateLwf" class="btn" style="background: #ffffff; color: #1e40af; font-size: 0.76rem; font-weight: 800; padding: 6px 14px; border-radius: 8px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;">
                        <i data-lucide="calculator" id="lwfCalcIcon" style="width: 13px; height: 13px;"></i>
                        <span id="lwfCalcBtnText">Evaluate Deduction</span>
                    </button>
                </div>
            </div>

            <!-- Card Body Content -->
            <div style="padding: 1.25rem;">
                <!-- Live Status & Jurisdiction Matrix (4 Summary Pills) -->
                <div style="margin-bottom: 1.25rem;">
                    <div style="font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <i data-lucide="landmark" style="width: 14px; height: 14px; color: #2563eb;"></i>
                        State Jurisdiction &amp; Scheduled Remittance Matrix
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">
                        <!-- State Jurisdiction Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">State</span>
                            <span id="pillLwfState" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.74rem; font-weight: 800; color: #0f172a; background: #ffffff; border: 1px solid #cbd5e1; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="map-pin" style="width: 11px; height: 11px; color: #2563eb;"></i>
                                <span id="textLwfState">${escapeHtml(stateName)}</span>
                            </span>
                        </div>

                        <!-- Frequency Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Frequency</span>
                            <span id="pillLwfFrequency" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.74rem; font-weight: 800; color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="calendar" style="width: 11px; height: 11px;"></i>
                                <span id="textLwfFrequency">${escapeHtml(frequency)}</span>
                            </span>
                        </div>

                        <!-- Registration No Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Establishment Reg No</span>
                            <span id="pillLwfRegNo" style="font-family: monospace; font-size: 0.72rem; font-weight: 700; color: #1e3a8a; background: #dbeafe; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                ${escapeHtml(regNo)}
                            </span>
                        </div>

                        <!-- Upcoming Deduction Month Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Next Deduction</span>
                            <span id="pillLwfNextDeduction" style="font-size: 0.78rem; font-weight: 800; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="clock" style="width: 11px; height: 11px; display: inline-block; vertical-align: middle; margin-right: 2px;"></i>
                                <span id="textLwfNextDeduction">${escapeHtml(nextDeduction)}</span>
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Interactive Statutory Edit & Auto-Fill Form -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.1rem; margin-bottom: 1.25rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                        <span style="font-size: 0.76rem; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="edit-3" style="width: 14px; height: 14px; color: #2563eb;"></i>
                            Statutory Master Parameters (All 10 Attributes)
                        </span>
                        <!-- Inline Toggle for LWF Applicable -->
                        <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.76rem; font-weight: 800; color: #1e293b;">
                            <span>LWF Applicable:</span>
                            <input type="checkbox" id="inputLwfApplicable" ${isLwfApplicable ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #2563eb; cursor: pointer;">
                            <span id="textLwfApplicableBadge" style="font-size: 0.7rem; padding: 1px 8px; border-radius: 9999px; ${isLwfApplicable ? 'background: #dcfce7; color: #166534;' : 'background: #fee2e2; color: #991b1b;'}">
                                ${isLwfApplicable ? 'YES' : 'NO'}
                            </span>
                        </label>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px;">
                        <!-- State Jurisdiction with Dynamic Auto-Fill Trigger -->
                        <div>
                            <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">
                                State Jurisdiction (Triggers Rate Auto-Fill)
                            </label>
                            <select id="selectLwfState" class="form-control" style="width: 100%; font-size: 0.78rem; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                                <option value="Karnataka" ${stateName === 'Karnataka' ? 'selected' : ''}>Karnataka (Annual - Dec: EE ₹20 / ER ₹40)</option>
                                <option value="Maharashtra" ${stateName === 'Maharashtra' ? 'selected' : ''}>Maharashtra (Half-Yearly - Jun/Dec: EE ₹12 / ER ₹36)</option>
                                <option value="Delhi" ${stateName === 'Delhi' ? 'selected' : ''}>Delhi (Half-Yearly - Jun/Dec: EE ₹0.75 / ER ₹2.25)</option>
                                <option value="Tamil Nadu" ${stateName === 'Tamil Nadu' ? 'selected' : ''}>Tamil Nadu (Annual - Dec: EE ₹20 / ER ₹40)</option>
                                <option value="Gujarat" ${stateName === 'Gujarat' ? 'selected' : ''}>Gujarat (Half-Yearly - Jun/Dec: EE ₹6 / ER ₹12)</option>
                                <option value="Haryana" ${stateName === 'Haryana' ? 'selected' : ''}>Haryana (Monthly - All: EE ₹25 / ER ₹50)</option>
                                <option value="Telangana" ${stateName === 'Telangana' ? 'selected' : ''}>Telangana (Annual - Dec: EE ₹20 / ER ₹40)</option>
                                <option value="Andhra Pradesh" ${stateName === 'Andhra Pradesh' ? 'selected' : ''}>Andhra Pradesh (Annual - Dec: EE ₹20 / ER ₹40)</option>
                                <option value="Kerala" ${stateName === 'Kerala' ? 'selected' : ''}>Kerala (Half-Yearly - Jun/Dec: EE ₹20 / ER ₹20)</option>
                                <option value="Madhya Pradesh" ${stateName === 'Madhya Pradesh' ? 'selected' : ''}>Madhya Pradesh (Half-Yearly - Jun/Dec: EE ₹10 / ER ₹30)</option>
                            </select>
                        </div>

                        <!-- Frequency Dropdown -->
                        <div>
                            <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Deduction Frequency</label>
                            <select id="selectLwfFrequency" class="form-control" style="width: 100%; font-size: 0.78rem; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                                <option value="Annual" ${frequency === 'Annual' ? 'selected' : ''}>Annual (e.g., December)</option>
                                <option value="Half-Yearly" ${frequency === 'Half-Yearly' ? 'selected' : ''}>Half-Yearly (June &amp; December)</option>
                                <option value="Quarterly" ${frequency === 'Quarterly' ? 'selected' : ''}>Quarterly (Mar, Jun, Sep, Dec)</option>
                                <option value="Monthly" ${frequency === 'Monthly' ? 'selected' : ''}>Monthly (Every Pay Cycle)</option>
                            </select>
                        </div>

                        <!-- Employer Registration No -->
                        <div>
                            <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Employer LWF Registration No</label>
                            <input type="text" id="inputLwfRegNo" value="${escapeHtml(regNo)}" placeholder="e.g. LWF/KA/BNG/2026/0912" style="width: 100%; font-family: monospace; font-size: 0.78rem; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                        </div>

                        <!-- Employee Contribution -->
                        <div>
                            <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Employee Contribution (₹ Net Pay Deduction)</label>
                            <input type="number" step="0.25" min="0" id="inputLwfEeContrib" value="${eeContrib.toFixed(2)}" style="width: 100%; font-size: 0.78rem; font-weight: 700; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #047857;">
                        </div>

                        <!-- Employer Contribution -->
                        <div>
                            <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Employer Contribution (₹ Company Liability)</label>
                            <input type="number" step="0.25" min="0" id="inputLwfErContrib" value="${erContrib.toFixed(2)}" style="width: 100%; font-size: 0.78rem; font-weight: 700; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #1e40af;">
                        </div>

                        <!-- Effective Window -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                                <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Effective From</label>
                                <input type="date" id="inputLwfEffectiveFrom" value="${escapeHtml(effectiveFrom)}" style="width: 100%; font-size: 0.74rem; padding: 5px 8px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Effective To</label>
                                <input type="date" id="inputLwfEffectiveTo" value="${lwfDetails.effectiveTo ? escapeHtml(lwfDetails.effectiveTo) : ''}" placeholder="Open" style="width: 100%; font-size: 0.74rem; padding: 5px 8px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                            </div>
                        </div>
                    </div>

                    <!-- Action Bar -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #cbd5e1;">
                        <span style="font-size: 0.74rem; color: #64748b;">
                            Total Remittance: <strong id="displayTotalRemittance" style="color: #0f172a;">₹${totalContrib.toFixed(2)}</strong> (EE: ₹<span id="displayEe">${eeContrib.toFixed(2)}</span> + ER: ₹<span id="displayEr">${erContrib.toFixed(2)}</span>)
                        </span>
                        <button type="button" id="btnSaveLwfDetails" class="btn btn-primary" style="background: #2563eb; color: #ffffff; font-size: 0.76rem; font-weight: 800; padding: 6px 16px; border-radius: 8px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                            <i data-lucide="save" id="lwfSaveIcon" style="width: 14px; height: 14px;"></i>
                            <span id="lwfSaveBtnText">Save LWF Profile</span>
                        </button>
                    </div>
                </div>

                <!-- Statutory Reference Schedule Callout (PRD §§ 4 & 11) -->
                <div style="background: #eff6ff; border: 1px dashed #93c5fd; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.74rem; font-weight: 800; color: #1e40af; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="info" style="width: 14px; height: 14px; color: #2563eb;"></i>
                            PRD §4 &amp; §11 State-Specific LWF Deduction Rules
                        </span>
                        <span id="calloutActiveRuleBadge" style="font-size: 0.7rem; font-weight: 700; color: #1d4ed8; background: #dbeafe; padding: 2px 8px; border-radius: 6px;">
                            Scheduled Months: ${deductionMonths.map(m => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]).join(', ')}
                        </span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; font-size: 0.72rem; color: #1e3a8a; margin-top: 4px;">
                        <div>
                            <strong>Karnataka (Annual):</strong><br>
                            Dec pay run • EE: ₹20, ER: ₹40
                        </div>
                        <div>
                            <strong>Maharashtra (Half-Yr):</strong><br>
                            Jun &amp; Dec • EE: ₹12, ER: ₹36
                        </div>
                        <div>
                            <strong>Delhi (Half-Yr):</strong><br>
                            Jun &amp; Dec • EE: ₹0.75, ER: ₹2.25
                        </div>
                        <div>
                            <strong>Haryana (Monthly):</strong><br>
                            Every Month • EE: ₹25, ER: ₹50
                        </div>
                    </div>
                </div>

                <!-- Footer Meta -->
                <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; color: #94a3b8;">
                    <span>Act: <strong id="lwfDisplayActName" style="color: #64748b;">${stateName} Labour Welfare Fund Act</strong></span>
                    <span>Remittance Schedule: <strong id="lwfDisplayScheduleDesc" style="color: #64748b;">${frequency} Filing &amp; Remittance</strong></span>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Binds events, auto-fill triggers, and evaluation alerts.
     */
    function bindEvents(container, employeeId, options = {}) {
        if (!container) return;

        const orgId = options.orgId || (typeof localStorage !== 'undefined' ? localStorage.getItem('orgId') : null) || 'ORG_KYLRX_01';

        // Auto-fill rates when State Jurisdiction changes
        const selectState = container.querySelector('#selectLwfState');
        const selectFrequency = container.querySelector('#selectLwfFrequency');
        const inputEe = container.querySelector('#inputLwfEeContrib');
        const inputEr = container.querySelector('#inputLwfErContrib');
        const inputRegNo = container.querySelector('#inputLwfRegNo');
        const pillState = container.querySelector('#textLwfState');
        const pillFrequency = container.querySelector('#textLwfFrequency');
        const pillRegNo = container.querySelector('#pillLwfRegNo');
        const pillNext = container.querySelector('#textLwfNextDeduction');
        const displayTotal = container.querySelector('#displayTotalRemittance');
        const displayEe = container.querySelector('#displayEe');
        const displayEr = container.querySelector('#displayEr');
        const calloutBadge = container.querySelector('#calloutActiveRuleBadge');

        function updateTotals() {
            const ee = parseFloat(inputEe?.value || '0') || 0;
            const er = parseFloat(inputEr?.value || '0') || 0;
            const total = ee + er;
            if (displayTotal) displayTotal.textContent = `₹${total.toFixed(2)}`;
            if (displayEe) displayEe.textContent = ee.toFixed(2);
            if (displayEr) displayEr.textContent = er.toFixed(2);
        }

        if (inputEe) inputEe.oninput = updateTotals;
        if (inputEr) inputEr.oninput = updateTotals;

        if (selectState) {
            selectState.onchange = function () {
                const selectedState = selectState.value;
                const rates = STATE_LWF_RATES[selectedState] || STATE_LWF_RATES["Karnataka"];

                if (selectFrequency) selectFrequency.value = rates.frequency;
                if (inputEe) inputEe.value = rates.ee.toFixed(2);
                if (inputEr) inputEr.value = rates.er.toFixed(2);
                if (inputRegNo && (!inputRegNo.value || inputRegNo.value.startsWith('LWF/'))) {
                    inputRegNo.value = `${rates.prefix}/BNG/2026/0912`;
                }

                if (pillState) pillState.textContent = selectedState;
                if (pillFrequency) pillFrequency.textContent = rates.frequency;
                if (pillRegNo && inputRegNo) pillRegNo.textContent = inputRegNo.value;

                const monthsStr = rates.months.map(m => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]).join(', ');
                if (calloutBadge) calloutBadge.textContent = `Scheduled Months: ${monthsStr}`;

                let service = window.KylrxLwfDetailsService;
                if (service && typeof service.computeDeductionSchedule === 'function') {
                    const sched = service.computeDeductionSchedule(rates.frequency, selectedState);
                    if (pillNext) pillNext.textContent = sched.nextDeduction;
                }

                updateTotals();
            };
        }

        // Toggle checkbox change
        const inputApplicable = container.querySelector('#inputLwfApplicable');
        const textAppBadge = container.querySelector('#textLwfApplicableBadge');
        if (inputApplicable) {
            inputApplicable.onchange = function () {
                const checked = inputApplicable.checked;
                if (textAppBadge) {
                    textAppBadge.textContent = checked ? 'YES' : 'NO';
                    textAppBadge.style.background = checked ? '#dcfce7' : '#fee2e2';
                    textAppBadge.style.color = checked ? '#166534' : '#991b1b';
                }
            };
        }

        // Evaluate Deduction Button
        const evalBtn = container.querySelector('#btnEvaluateLwf');
        if (evalBtn) {
            evalBtn.onclick = function (e) {
                e.preventDefault();
                let service = window.KylrxLwfDetailsService;
                if (!service && typeof require === 'function') {
                    try { service = require('./lwfDetailsService.js'); } catch (_) {}
                }

                if (!service || typeof service.calculateLwfDeduction !== 'function') {
                    alert("KylrxLwfDetailsService is unavailable.");
                    return;
                }

                const currentMonth = new Date().getMonth() + 1;
                const state = selectState ? selectState.value : "Karnataka";
                const freq = selectFrequency ? selectFrequency.value : "Annual";
                const isApplicable = inputApplicable ? inputApplicable.checked : true;
                const ee = parseFloat(inputEe?.value || '20');
                const er = parseFloat(inputEr?.value || '40');

                const calc = service.calculateLwfDeduction({
                    isLwfApplicable: isApplicable,
                    state,
                    frequency: freq,
                    employeeContribution: ee,
                    employerContribution: er,
                    employerRegistrationNo: inputRegNo ? inputRegNo.value : ''
                }, 45000, { cycleMonth: currentMonth });

                const monthName = ["January","February","March","April","May","June","July","August","September","October","November","December"][currentMonth - 1];

                const message = calc.isDeductionMonth
                    ? `Month: ${monthName} (${currentMonth}) is a SCHEDULED DEDUCTION month for ${state} (${freq})!\n\n` +
                      `• Net Pay Employee Deduction: ₹${calc.employeeContribution.toFixed(2)}\n` +
                      `• Employer Statutory Liability: ₹${calc.employerContribution.toFixed(2)}\n` +
                      `• Total Remittance to Board: ₹${calc.totalRemittance.toFixed(2)}\n\n` +
                      `Scheduled Months: ${calc.deductionMonths.join(', ')}`
                    : `Month: ${monthName} (${currentMonth}) is NOT a deduction month for ${state} (${freq}).\n\n` +
                      `• Deduction Amount: ₹0.00\n` +
                      `• Next Scheduled Deduction: ${calc.nextDeduction}\n` +
                      `• Scheduled Months: ${calc.deductionMonths.join(', ')}`;

                if (window.showCustomAlert) {
                    window.showCustomAlert(
                        calc.isDeductionMonth ? "LWF Deduction Scheduled" : "LWF Non-Deduction Month",
                        message,
                        calc.isDeductionMonth ? "success" : "info"
                    );
                } else {
                    alert(message);
                }
            };
        }

        // Save Profile Button
        const saveBtn = container.querySelector('#btnSaveLwfDetails');
        if (saveBtn) {
            saveBtn.onclick = async function (e) {
                e.preventDefault();
                const btnText = container.querySelector('#lwfSaveBtnText');
                const btnIcon = container.querySelector('#lwfSaveIcon');

                try {
                    saveBtn.disabled = true;
                    if (btnText) btnText.textContent = 'Saving Profile...';
                    if (btnIcon) btnIcon.classList.add('animate-spin');

                    let service = window.KylrxLwfDetailsService;
                    if (!service && typeof require === 'function') {
                        try { service = require('./lwfDetailsService.js'); } catch (_) {}
                    }

                    if (!service || typeof service.saveEmployeeLwfDetails !== 'function') {
                        throw new Error("KylrxLwfDetailsService is unavailable or not loaded.");
                    }

                    const profilePayload = {
                        employeeId,
                        organizationId: orgId,
                        isLwfApplicable: inputApplicable ? inputApplicable.checked : true,
                        state: selectState ? selectState.value : "Karnataka",
                        frequency: selectFrequency ? selectFrequency.value : "Annual",
                        employerRegistrationNo: inputRegNo ? inputRegNo.value : "LWF/KA/BNG/2026/0912",
                        employeeContribution: parseFloat(inputEe?.value || '20') || 0,
                        employerContribution: parseFloat(inputEr?.value || '40') || 0,
                        effectiveFrom: container.querySelector('#inputLwfEffectiveFrom')?.value || "2026-01-01",
                        effectiveTo: container.querySelector('#inputLwfEffectiveTo')?.value || null
                    };

                    await service.saveEmployeeLwfDetails(orgId, employeeId, profilePayload);

                    if (window.showCustomAlert) {
                        window.showCustomAlert(
                            "LWF Profile Saved",
                            `Labour Welfare Fund statutory master updated for ${employeeId} (${profilePayload.state} - ${profilePayload.frequency}).`,
                            "success"
                        );
                    } else {
                        alert(`LWF profile saved successfully for ${employeeId}.`);
                    }
                } catch (err) {
                    console.error("LWF Save Failed:", err);
                    if (window.showCustomAlert) {
                        window.showCustomAlert("Save Error", err.message || "Failed to persist LWF details.", "error");
                    } else {
                        alert("Save error: " + err.message);
                    }
                } finally {
                    if (btnText) btnText.textContent = 'Save LWF Profile';
                    if (btnIcon) btnIcon.classList.remove('animate-spin');
                    saveBtn.disabled = false;
                    if (window.lucide) lucide.createIcons();
                }
            };
        }
    }

    /**
     * Mounts the LWF card inside target container element.
     */
    async function mountLwfCard(targetContainerId, employeeId, options = {}) {
        let container = typeof targetContainerId === 'string'
            ? document.getElementById(targetContainerId)
            : targetContainerId;

        if (!container) return;

        const orgId = options.orgId || (typeof localStorage !== 'undefined' ? localStorage.getItem('orgId') : null) || 'ORG_KYLRX_01';
        let lwfDetails = null;

        let service = (typeof window !== 'undefined' && window.KylrxLwfDetailsService) ? window.KylrxLwfDetailsService : null;
        if (!service && typeof require === 'function') {
            try {
                service = require('./lwfDetailsService.js');
            } catch (e) {}
        }

        if (service && typeof service.getEmployeeLwfDetails === 'function') {
            try {
                lwfDetails = await service.getEmployeeLwfDetails(orgId, employeeId);
            } catch (e) {}
        }

        if (!lwfDetails && service && Array.isArray(service.DEFAULT_LWF_PROFILES)) {
            lwfDetails = service.DEFAULT_LWF_PROFILES.find(p => p.employeeId === employeeId);
        }

        const stateName = options.state || (lwfDetails && lwfDetails.state) || "Karnataka";
        const defaultRates = STATE_LWF_RATES[stateName] || STATE_LWF_RATES["Karnataka"];

        if (!lwfDetails) {
            lwfDetails = {
                employeeId,
                organizationId: orgId,
                isLwfApplicable: options.isLwfApplicable !== false,
                state: stateName,
                employerRegistrationNo: options.employerRegistrationNo || `${defaultRates.prefix}/BNG/2026/0912`,
                employeeContribution: options.employeeContribution !== undefined ? options.employeeContribution : defaultRates.ee,
                employerContribution: options.employerContribution !== undefined ? options.employerContribution : defaultRates.er,
                frequency: options.frequency || defaultRates.frequency,
                effectiveFrom: options.effectiveFrom || options.joiningDate || "2026-01-01",
                effectiveTo: options.effectiveTo || null,
                deductionSchedule: {
                    deductionMonths: defaultRates.months,
                    nextDeduction: `${new Date().getFullYear()}-12`
                }
            };
        } else if (options && Object.keys(options).length > 0) {
            if (options.state) lwfDetails.state = options.state;
            if (options.frequency) lwfDetails.frequency = options.frequency;
            if (options.employerRegistrationNo) lwfDetails.employerRegistrationNo = options.employerRegistrationNo;
            if (options.employeeContribution !== undefined) lwfDetails.employeeContribution = options.employeeContribution;
            if (options.employerContribution !== undefined) lwfDetails.employerContribution = options.employerContribution;
        }

        container.innerHTML = renderCardHtml(lwfDetails, options);
        bindEvents(container, employeeId, options);

        if (typeof window !== 'undefined' && window.lucide) {
            window.lucide.createIcons();
        }
    }

    return {
        STATE_LWF_RATES,
        renderCardHtml,
        bindEvents,
        mountLwfCard
    };
}));
