/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - NATIONAL PENSION SYSTEM (NPS) UI CONTROLLER
 * ============================================================================
 * 
 * Renders the "NPS & Voluntary Pension" status card inside the Employee Profile drawer
 * (admin-dashboard.html Statutory tab) matching PRD Section 13:
 * 
 * 1. Displays PRAN, CRA Agency, NPS Model, POP Intermediary, and Tier I/II active badges.
 * 2. Live verification status pills for overall KYC, PAN KYC, Aadhaar KYC, and Bank KYC.
 * 3. Live contribution calculator & tax savings projection under Old vs. New Tax regimes (Section 80CCD).
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
        root.KylrxNpsProfileUIController = factory();
        root.npsProfileUIController = root.KylrxNpsProfileUIController;
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
     * Renders the complete National Pension System (NPS) Statutory Profile Card HTML.
     */
    function renderCardHtml(npsDetails = {}, employeeInfo = {}) {
        let service = null;
        if (typeof window !== 'undefined' && window.KylrxNpsDetailsService) {
            service = window.KylrxNpsDetailsService;
        } else if (typeof require === 'function') {
            try {
                service = require('./npsDetailsService.js');
            } catch (e) {}
        }

        const isNpsApplicable = npsDetails.isNpsApplicable !== false && npsDetails['NPS Applicable'] !== 'No';
        const pran = npsDetails.pran || npsDetails['PRAN'] || "110023456789";
        const accountStatus = npsDetails.npsAccountStatus || npsDetails['NPS Account Status'] || "ACTIVE";
        const npsModel = npsDetails.npsModel || npsDetails['NPS Model'] || "Corporate Model";
        const craAgency = npsDetails.craAgency || npsDetails['CRA / Recordkeeping Agency'] || "Protean (NSDL)";
        const popIntermediary = npsDetails.popIntermediary || npsDetails['POP / Intermediary'] || "HDFC Pension Management Co.";
        const tier1Active = npsDetails.tier1Active !== false && npsDetails['Tier I Active'] !== 'No';
        const tier2Active = npsDetails.tier2Active === true || npsDetails['Tier II Active'] === 'Yes';
        const joiningDate = npsDetails.dateOfNpsJoining || npsDetails['Date of NPS Joining'] || "2026-01-15";
        const exitDate = npsDetails.dateOfNpsExit || npsDetails['Date of NPS Exit'] || "Active / Ongoing";

        const contribs = npsDetails.contributions || {};
        const eePct = contribs.employeePercentage !== undefined ? contribs.employeePercentage : (npsDetails['Employee Contribution %'] !== undefined ? npsDetails['Employee Contribution %'] : 10.0);
        const eeAmt = contribs.employeeAmount !== undefined ? contribs.employeeAmount : (npsDetails['Employee Contribution Amount'] !== undefined ? npsDetails['Employee Contribution Amount'] : null);
        const erPct = contribs.employerPercentage !== undefined ? contribs.employerPercentage : (npsDetails['Employer Contribution %'] !== undefined ? npsDetails['Employer Contribution %'] : 10.0);
        const erAmt = contribs.employerAmount !== undefined ? contribs.employerAmount : (npsDetails['Employer Contribution Amount'] !== undefined ? npsDetails['Employer Contribution Amount'] : null);
        const ytd = Number(contribs.totalContributionYtd || npsDetails['Total Contribution YTD'] || 0);

        const kyc = npsDetails.kyc || {};
        const overallKyc = kyc.overallStatus || npsDetails['KYC Status'] || "VERIFIED";
        const panKyc = kyc.panKyc || npsDetails['PAN KYC'] || "VERIFIED";
        const aadhaarKyc = kyc.aadhaarKyc || npsDetails['Aadhaar KYC'] || "VERIFIED";
        const bankKyc = kyc.bankKyc || npsDetails['Bank KYC'] || "VERIFIED";
        const nomineeStatus = npsDetails.nomineeStatus || npsDetails['Nominee Details Status'] || "SUBMITTED";

        const statusBadge = (service && typeof service.resolveNpsStatusBadge === 'function')
            ? service.resolveNpsStatusBadge(accountStatus, isNpsApplicable)
            : { label: isNpsApplicable ? 'Active Subscriber' : 'Exempt', bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' };

        const craBadge = (service && typeof service.resolveCraBadge === 'function')
            ? service.resolveCraBadge(craAgency)
            : { label: craAgency, bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' };

        return `
        <div id="npsStatutoryMasterCard" class="modal-section-card" style="margin-bottom: 1.25rem; border: 1.5px solid #0284c7; border-radius: 16px; background: #ffffff; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.08); overflow: hidden;">
            <!-- Header Section -->
            <div style="background: linear-gradient(135deg, #0369a1 0%, #0284c7 100%); padding: 1.1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; color: white;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                        <i data-lucide="award" style="width: 22px; height: 22px; color: #ffffff;"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; letter-spacing: -0.01em; color: #ffffff;">National Pension System (NPS) Statutory Profile</h4>
                        <p style="margin: 2px 0 0 0; font-size: 0.72rem; color: rgba(255, 255, 255, 0.85);">PRD §§ 1, 4, 11 &amp; 13 • Section 80CCD Tax Relief &amp; CRA Subscriber Reporting Engine</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="npsStatusHeaderBadge" style="padding: 4px 10px; border-radius: 9999px; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; background: ${statusBadge.bg}; color: ${statusBadge.color}; border: 1px solid ${statusBadge.border}; display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="${statusBadge.icon || 'check-circle'}" style="width: 12px; height: 12px;"></i>
                        <span id="npsStatusHeaderText">${statusBadge.label}</span>
                    </span>
                    <button type="button" id="btnCalculateNps" class="btn" style="background: #ffffff; color: #0369a1; font-size: 0.76rem; font-weight: 800; padding: 6px 14px; border-radius: 8px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;">
                        <i data-lucide="calculator" id="npsCalcIcon" style="width: 13px; height: 13px;"></i>
                        <span id="npsCalcBtnText">Calculate 80CCD</span>
                    </button>
                </div>
            </div>

            <!-- Card Body Content -->
            <div style="padding: 1.25rem;">
                <!-- Live Status & PRAN Matrix (4 Summary Pills) -->
                <div style="margin-bottom: 1.25rem;">
                    <div style="font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <i data-lucide="shield" style="width: 14px; height: 14px; color: #0284c7;"></i>
                        Permanent Retirement Account Number (PRAN) &amp; CRA Details
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">
                        <!-- PRAN Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">12-Digit PRAN</span>
                            <span id="pillNpsPran" style="font-family: monospace; font-size: 0.76rem; font-weight: 800; color: #0369a1; background: #e0f2fe; border: 1px solid #bae6fd; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                ${escapeHtml(pran)}
                            </span>
                        </div>

                        <!-- CRA Recordkeeping Agency Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">CRA Agency</span>
                            <span id="pillNpsCra" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.74rem; font-weight: 800; color: ${craBadge.color}; background: ${craBadge.bg}; border: 1px solid ${craBadge.border}; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="building" style="width: 11px; height: 11px;"></i>
                                <span id="textNpsCra">${escapeHtml(craAgency)}</span>
                            </span>
                        </div>

                        <!-- Tier Accounts Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Tier Accounts</span>
                            <div style="display: flex; gap: 4px; align-items: center;">
                                <span id="pillTier1Badge" style="font-size: 0.7rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; ${tier1Active ? 'background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;' : 'background: #f1f5f9; color: #64748b;'}">
                                    Tier I: ${tier1Active ? 'ACTIVE' : 'OFF'}
                                </span>
                                <span id="pillTier2Badge" style="font-size: 0.7rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; ${tier2Active ? 'background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe;' : 'background: #f1f5f9; color: #64748b;'}">
                                    Tier II: ${tier2Active ? 'ACTIVE' : 'OFF'}
                                </span>
                            </div>
                        </div>

                        <!-- Total YTD Contribution Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Total YTD Contribution</span>
                            <span id="pillNpsYtd" style="font-family: monospace; font-size: 0.82rem; font-weight: 800; color: #047857; width: fit-content;">
                                ₹<span id="textNpsYtd">${ytd.toFixed(2)}</span>
                            </span>
                        </div>
                    </div>
                </div>

                <!-- KYC Verification Status Strip -->
                <div style="margin-bottom: 1.25rem; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; padding: 10px 14px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 800; color: #0369a1; text-transform: uppercase;">
                        <i data-lucide="check-check" style="width: 14px; height: 14px; color: #0284c7;"></i>
                        KYC Seeding &amp; CRA Verification:
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                        <span style="font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: #ffffff; border: 1px solid #cbd5e1; color: #334155;">
                            Overall KYC: <strong style="color: ${overallKyc === 'VERIFIED' ? '#047857' : '#b45309'};">${escapeHtml(overallKyc)}</strong>
                        </span>
                        <span style="font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: #ffffff; border: 1px solid #cbd5e1; color: #334155;">
                            PAN KYC: <strong style="color: ${panKyc === 'VERIFIED' ? '#047857' : '#b45309'};">${escapeHtml(panKyc)}</strong>
                        </span>
                        <span style="font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: #ffffff; border: 1px solid #cbd5e1; color: #334155;">
                            Aadhaar KYC: <strong style="color: ${aadhaarKyc === 'VERIFIED' ? '#047857' : '#b45309'};">${escapeHtml(aadhaarKyc)}</strong>
                        </span>
                        <span style="font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: #ffffff; border: 1px solid #cbd5e1; color: #334155;">
                            Bank KYC: <strong style="color: ${bankKyc === 'VERIFIED' ? '#047857' : '#b45309'};">${escapeHtml(bankKyc)}</strong>
                        </span>
                        <span style="font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: #ffffff; border: 1px solid #cbd5e1; color: #334155;">
                            Nominee: <strong style="color: #1e40af;">${escapeHtml(nomineeStatus)}</strong>
                        </span>
                    </div>
                </div>

                <!-- Interactive Statutory Edit & Contribution Settings Form -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.1rem; margin-bottom: 1.25rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                        <span style="font-size: 0.76rem; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="edit-3" style="width: 14px; height: 14px; color: #0284c7;"></i>
                            Statutory Master Parameters (22 Attributes)
                        </span>
                        <!-- Inline Toggle for NPS Applicable -->
                        <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.76rem; font-weight: 800; color: #1e293b;">
                            <span>NPS Applicable:</span>
                            <input type="checkbox" id="inputNpsApplicable" ${isNpsApplicable ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #0284c7; cursor: pointer;">
                            <span id="textNpsApplicableBadge" style="font-size: 0.7rem; padding: 1px 8px; border-radius: 9999px; ${isNpsApplicable ? 'background: #dcfce7; color: #166534;' : 'background: #fee2e2; color: #991b1b;'}">
                                ${isNpsApplicable ? 'YES' : 'NO'}
                            </span>
                        </label>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px;">
                        <!-- PRAN Input -->
                        <div>
                            <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Permanent Retirement Account Number (PRAN)</label>
                            <input type="text" id="inputNpsPran" value="${escapeHtml(pran)}" maxlength="12" placeholder="12-digit PRAN e.g. 110023456789" style="width: 100%; font-family: monospace; font-size: 0.78rem; font-weight: 700; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                        </div>

                        <!-- CRA Recordkeeping Agency -->
                        <div>
                            <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">CRA / Recordkeeping Agency</label>
                            <select id="selectNpsCra" class="form-control" style="width: 100%; font-size: 0.78rem; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                                <option value="Protean (NSDL)" ${craAgency === 'Protean (NSDL)' ? 'selected' : ''}>Protean (NSDL)</option>
                                <option value="KFintech" ${craAgency === 'KFintech' ? 'selected' : ''}>KFintech</option>
                                <option value="CAMS" ${craAgency === 'CAMS' ? 'selected' : ''}>CAMS</option>
                                <option value="Other" ${craAgency === 'Other' ? 'selected' : ''}>Other</option>
                            </select>
                        </div>

                        <!-- POP Intermediary -->
                        <div>
                            <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Point of Presence (POP) Intermediary</label>
                            <input type="text" id="inputNpsPop" value="${escapeHtml(popIntermediary)}" placeholder="e.g. HDFC Pension Management Co." style="width: 100%; font-size: 0.78rem; padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                        </div>

                        <!-- NPS Model & Account Status -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                                <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">NPS Model</label>
                                <select id="selectNpsModel" style="width: 100%; font-size: 0.74rem; padding: 6px 6px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                                    <option value="Corporate Model" ${npsModel === 'Corporate Model' ? 'selected' : ''}>Corporate</option>
                                    <option value="All Citizen Model" ${npsModel === 'All Citizen Model' ? 'selected' : ''}>All Citizen</option>
                                    <option value="Government" ${npsModel === 'Government' ? 'selected' : ''}>Government</option>
                                </select>
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #475569; margin-bottom: 4px;">Account Status</label>
                                <select id="selectNpsAccountStatus" style="width: 100%; font-size: 0.74rem; padding: 6px 6px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                                    <option value="ACTIVE" ${accountStatus === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
                                    <option value="INACTIVE" ${accountStatus === 'INACTIVE' ? 'selected' : ''}>INACTIVE</option>
                                    <option value="FROZEN" ${accountStatus === 'FROZEN' ? 'selected' : ''}>FROZEN</option>
                                    <option value="SUSPENDED" ${accountStatus === 'SUSPENDED' ? 'selected' : ''}>SUSPENDED</option>
                                </select>
                            </div>
                        </div>

                        <!-- Employee Contribution: % and Fixed Amount -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                                <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #047857; margin-bottom: 4px;">Employee % (80CCD1)</label>
                                <input type="number" step="0.5" min="0" max="100" id="inputNpsEePct" value="${eePct !== null && eePct !== undefined ? eePct : ''}" placeholder="e.g. 10.0" style="width: 100%; font-size: 0.78rem; font-weight: 700; padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #047857;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #047857; margin-bottom: 4px;">Employee Fixed (₹)</label>
                                <input type="number" step="100" min="0" id="inputNpsEeAmt" value="${eeAmt !== null && eeAmt !== undefined ? eeAmt : ''}" placeholder="Optional" style="width: 100%; font-size: 0.78rem; padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                            </div>
                        </div>

                        <!-- Employer Contribution: % and Fixed Amount -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                                <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #0369a1; margin-bottom: 4px;">Employer % (80CCD2)</label>
                                <input type="number" step="0.5" min="0" max="100" id="inputNpsErPct" value="${erPct !== null && erPct !== undefined ? erPct : ''}" placeholder="e.g. 10.0" style="width: 100%; font-size: 0.78rem; font-weight: 700; padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #0369a1;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.7rem; font-weight: 700; color: #0369a1; margin-bottom: 4px;">Employer Fixed (₹)</label>
                                <input type="number" step="100" min="0" id="inputNpsErAmt" value="${erAmt !== null && erAmt !== undefined ? erAmt : ''}" placeholder="Optional" style="width: 100%; font-size: 0.78rem; padding: 6px 8px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff;">
                            </div>
                        </div>

                        <!-- Tier Toggles & Date Windows -->
                        <div style="display: flex; flex-direction: column; justify-content: center; gap: 6px;">
                            <div style="display: flex; gap: 14px; align-items: center;">
                                <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.74rem; font-weight: 700; color: #334155; cursor: pointer;">
                                    <input type="checkbox" id="checkTier1Active" ${tier1Active ? 'checked' : ''} style="width: 15px; height: 15px; accent-color: #0284c7;">
                                    Tier I Active
                                </label>
                                <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.74rem; font-weight: 700; color: #334155; cursor: pointer;">
                                    <input type="checkbox" id="checkTier2Active" ${tier2Active ? 'checked' : ''} style="width: 15px; height: 15px; accent-color: #0284c7;">
                                    Tier II Active
                                </label>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <input type="date" id="inputNpsDoj" value="${escapeHtml(joiningDate)}" title="Date of NPS Joining" style="font-size: 0.72rem; padding: 4px 6px; border-radius: 6px; border: 1px solid #cbd5e1;">
                                <input type="date" id="inputNpsDoe" value="${npsDetails.dateOfNpsExit ? escapeHtml(npsDetails.dateOfNpsExit) : ''}" placeholder="Open" title="Date of NPS Exit" style="font-size: 0.72rem; padding: 4px 6px; border-radius: 6px; border: 1px solid #cbd5e1;">
                            </div>
                        </div>
                    </div>

                    <!-- Action Bar -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #cbd5e1;">
                        <span style="font-size: 0.74rem; color: #64748b;">
                            Rates: Employee <strong id="lblDisplayEeRate" style="color: #047857;">${eePct !== null ? `${eePct}%` : `₹${eeAmt}`}</strong> • Employer <strong id="lblDisplayErRate" style="color: #0369a1;">${erPct !== null ? `${erPct}%` : `₹${erAmt}`}</strong>
                        </span>
                        <button type="button" id="btnSaveNpsDetails" class="btn btn-primary" style="background: #0284c7; color: #ffffff; font-size: 0.76rem; font-weight: 800; padding: 6px 16px; border-radius: 8px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                            <i data-lucide="save" id="npsSaveIcon" style="width: 14px; height: 14px;"></i>
                            <span id="npsSaveBtnText">Save NPS Profile</span>
                        </button>
                    </div>
                </div>

                <!-- Section 80CCD Tax Relief Callout (PRD §4 & §11) -->
                <div style="background: #f0fdf4; border: 1px dashed #86efac; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.74rem; font-weight: 800; color: #166534; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="info" style="width: 14px; height: 14px; color: #16a34a;"></i>
                            Statutory Section 80CCD Tax Exemption Matrix • Old vs New Regime Projection
                        </span>
                        <span style="font-size: 0.7rem; font-weight: 700; color: #15803d; background: #dcfce7; padding: 2px 8px; border-radius: 6px;">
                            Dual Regime Compliant
                        </span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; font-size: 0.72rem; color: #14532d; margin-top: 4px;">
                        <div>
                            <strong>Section 80CCD(1):</strong><br>
                            Employee up to 10% of (Basic+DA) within ₹1.5L (Old)
                        </div>
                        <div>
                            <strong>Section 80CCD(1B):</strong><br>
                            Additional exclusive ₹50,000 deduction (Old)
                        </div>
                        <div>
                            <strong>Section 80CCD(2):</strong><br>
                            Employer up to 10% (14% Govt) • <strong>Tax-free in Both Regimes!</strong>
                        </div>
                        <div>
                            <strong>FY Aggregate Cap:</strong><br>
                            ₹7.5 Lakh combined (PF + NPS + Superannuation)
                        </div>
                    </div>
                </div>

                <!-- Footer Meta -->
                <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; color: #94a3b8;">
                    <span>CRA Agency: <strong style="color: #64748b;">${escapeHtml(craAgency)}</strong></span>
                    <span>Point of Presence: <strong style="color: #64748b;">${escapeHtml(popIntermediary)}</strong></span>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Binds events, calculator triggers, and save operations.
     */
    function bindEvents(container, employeeId, options = {}) {
        if (!container) return;

        const orgId = options.orgId || (typeof localStorage !== 'undefined' ? localStorage.getItem('orgId') : null) || 'ORG_KYLRX_01';

        // Toggle checkbox change
        const inputApplicable = container.querySelector('#inputNpsApplicable');
        const textAppBadge = container.querySelector('#textNpsApplicableBadge');
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

        // Live Calculate Button
        const calcBtn = container.querySelector('#btnCalculateNps');
        if (calcBtn) {
            calcBtn.onclick = function (e) {
                e.preventDefault();
                let service = window.KylrxNpsDetailsService;
                if (!service && typeof require === 'function') {
                    try { service = require('./npsDetailsService.js'); } catch (_) {}
                }

                if (!service || typeof service.calculateNpsDeduction !== 'function') {
                    alert("KylrxNpsDetailsService is unavailable.");
                    return;
                }

                const basic = options.basic || options.basicSalary || 50000;
                const da = options.da || 0;
                const wageBase = basic + da;

                const eePct = container.querySelector('#inputNpsEePct')?.value;
                const eeAmt = container.querySelector('#inputNpsEeAmt')?.value;
                const erPct = container.querySelector('#inputNpsErPct')?.value;
                const erAmt = container.querySelector('#inputNpsErAmt')?.value;
                const pranVal = container.querySelector('#inputNpsPran')?.value || '110023456789';
                const isApplicable = inputApplicable ? inputApplicable.checked : true;

                const profileMock = {
                    employeeId,
                    pran: pranVal,
                    isNpsApplicable: isApplicable,
                    tier1Active: container.querySelector('#checkTier1Active')?.checked !== false,
                    tier2Active: container.querySelector('#checkTier2Active')?.checked === true,
                    contributions: {
                        employeePercentage: eePct ? Number(eePct) : null,
                        employeeAmount: eeAmt ? Number(eeAmt) : null,
                        employerPercentage: erPct ? Number(erPct) : null,
                        employerAmount: erAmt ? Number(erAmt) : null
                    }
                };

                const oldRegimeCalc = service.calculateNpsDeduction(profileMock, wageBase, { taxRegime: 'OLD' });
                const newRegimeCalc = service.calculateNpsDeduction(profileMock, wageBase, { taxRegime: 'NEW' });

                const message = 
                    `=== NPS Section 80CCD Payroll & Tax Computation ===\n\n` +
                    `Wage Base (Basic + DA): ₹${wageBase.toFixed(2)}\n` +
                    `• Employee Deduction (Net Pay): ₹${oldRegimeCalc.deductionFromNetPay.toFixed(2)}\n` +
                    `• Employer Co-Contribution: ₹${oldRegimeCalc.employerContributionLiability.toFixed(2)}\n` +
                    `• Total Monthly NPS Remittance: ₹${oldRegimeCalc.totalMonthlyContribution.toFixed(2)}\n\n` +
                    `--- Tax Relief Projections ---\n` +
                    `[Old Tax Regime]:\n` +
                    `  • Sec 80CCD(1) Employee Share: ₹${oldRegimeCalc.taxRelief.section80CCD1.toFixed(2)}\n` +
                    `  • Sec 80CCD(1B) Extra Relief: ₹${oldRegimeCalc.taxRelief.section80CCD1B.toFixed(2)}\n` +
                    `  • Sec 80CCD(2) Employer Share: ₹${oldRegimeCalc.taxRelief.section80CCD2.toFixed(2)}\n` +
                    `  • Total Deductible Income: ₹${oldRegimeCalc.taxRelief.eligibleTaxExemption.toFixed(2)}\n\n` +
                    `[New Tax Regime]:\n` +
                    `  • Sec 80CCD(2) Employer Share (Tax-Free): ₹${newRegimeCalc.taxRelief.section80CCD2.toFixed(2)}`;

                if (window.showCustomAlert) {
                    window.showCustomAlert("NPS Section 80CCD Calculation", message, "info");
                } else {
                    alert(message);
                }
            };
        }

        // Save Profile Button
        const saveBtn = container.querySelector('#btnSaveNpsDetails');
        if (saveBtn) {
            saveBtn.onclick = async function (e) {
                e.preventDefault();
                const btnText = container.querySelector('#npsSaveBtnText');
                const btnIcon = container.querySelector('#npsSaveIcon');

                try {
                    saveBtn.disabled = true;
                    if (btnText) btnText.textContent = 'Saving Profile...';
                    if (btnIcon) btnIcon.classList.add('animate-spin');

                    let service = window.KylrxNpsDetailsService;
                    if (!service && typeof require === 'function') {
                        try { service = require('./npsDetailsService.js'); } catch (_) {}
                    }

                    if (!service || typeof service.saveEmployeeNpsDetails !== 'function') {
                        throw new Error("KylrxNpsDetailsService is unavailable or not loaded.");
                    }

                    const eePct = container.querySelector('#inputNpsEePct')?.value;
                    const eeAmt = container.querySelector('#inputNpsEeAmt')?.value;
                    const erPct = container.querySelector('#inputNpsErPct')?.value;
                    const erAmt = container.querySelector('#inputNpsErAmt')?.value;

                    const profilePayload = {
                        employeeId,
                        organizationId: orgId,
                        isNpsApplicable: inputApplicable ? inputApplicable.checked : true,
                        pran: container.querySelector('#inputNpsPran')?.value || null,
                        npsAccountStatus: container.querySelector('#selectNpsAccountStatus')?.value || "ACTIVE",
                        npsModel: container.querySelector('#selectNpsModel')?.value || "Corporate Model",
                        craAgency: container.querySelector('#selectNpsCra')?.value || "Protean (NSDL)",
                        popIntermediary: container.querySelector('#inputNpsPop')?.value || "HDFC Pension Management Co.",
                        tier1Active: container.querySelector('#checkTier1Active')?.checked !== false,
                        tier2Active: container.querySelector('#checkTier2Active')?.checked === true,
                        dateOfNpsJoining: container.querySelector('#inputNpsDoj')?.value || "2026-01-15",
                        dateOfNpsExit: container.querySelector('#inputNpsDoe')?.value || null,
                        contributions: {
                            employeePercentage: eePct ? Number(eePct) : null,
                            employeeAmount: eeAmt ? Number(eeAmt) : null,
                            employerPercentage: erPct ? Number(erPct) : null,
                            employerAmount: erAmt ? Number(erAmt) : null,
                            totalContributionYtd: Number(container.querySelector('#textNpsYtd')?.textContent || '0')
                        }
                    };

                    await service.saveEmployeeNpsDetails(orgId, employeeId, profilePayload);

                    if (window.showCustomAlert) {
                        window.showCustomAlert(
                            "NPS Profile Saved",
                            `National Pension System statutory master updated for ${employeeId} (PRAN: ${profilePayload.pran || 'N/A'}).`,
                            "success"
                        );
                    } else {
                        alert(`NPS profile saved successfully for ${employeeId}.`);
                    }
                } catch (err) {
                    console.error("NPS Save Failed:", err);
                    if (window.showCustomAlert) {
                        window.showCustomAlert("Save Error", err.message || "Failed to persist NPS details.", "error");
                    } else {
                        alert("Save error: " + err.message);
                    }
                } finally {
                    if (btnText) btnText.textContent = 'Save NPS Profile';
                    if (btnIcon) btnIcon.classList.remove('animate-spin');
                    saveBtn.disabled = false;
                    if (window.lucide) lucide.createIcons();
                }
            };
        }
    }

    /**
     * Mounts the NPS card inside target container element.
     */
    async function mountNpsCard(targetContainerId, employeeId, options = {}) {
        let container = typeof targetContainerId === 'string'
            ? document.getElementById(targetContainerId)
            : targetContainerId;

        if (!container) return;

        const orgId = options.orgId || (typeof localStorage !== 'undefined' ? localStorage.getItem('orgId') : null) || 'ORG_KYLRX_01';
        let npsDetails = null;

        let service = (typeof window !== 'undefined' && window.KylrxNpsDetailsService) ? window.KylrxNpsDetailsService : null;
        if (!service && typeof require === 'function') {
            try {
                service = require('./npsDetailsService.js');
            } catch (e) {}
        }

        if (service && typeof service.getEmployeeNpsDetails === 'function') {
            try {
                npsDetails = await service.getEmployeeNpsDetails(orgId, employeeId);
            } catch (e) {}
        }

        if (!npsDetails && service && Array.isArray(service.DEFAULT_NPS_PROFILES)) {
            npsDetails = service.DEFAULT_NPS_PROFILES.find(p => p.employeeId === employeeId);
        }

        if (!npsDetails) {
            npsDetails = {
                employeeId,
                organizationId: orgId,
                isNpsApplicable: options.isNpsApplicable !== false,
                pran: options.pran || "110023456789",
                npsAccountStatus: "ACTIVE",
                npsModel: "Corporate Model",
                craAgency: options.craAgency || "Protean (NSDL)",
                popIntermediary: options.popIntermediary || "HDFC Pension Management Co.",
                tier1Active: true,
                tier2Active: false,
                dateOfNpsJoining: options.dateOfNpsJoining || options.joiningDate || "2026-01-15",
                dateOfNpsExit: null,
                contributions: {
                    employeePercentage: options.employeePercentage !== undefined ? options.employeePercentage : 10.0,
                    employeeAmount: null,
                    employerPercentage: options.employerPercentage !== undefined ? options.employerPercentage : 10.0,
                    employerAmount: null,
                    totalContributionYtd: 0.00
                },
                nomineeStatus: "SUBMITTED",
                kyc: {
                    overallStatus: "VERIFIED",
                    panKyc: "VERIFIED",
                    aadhaarKyc: "VERIFIED",
                    bankKyc: "VERIFIED"
                }
            };
        }

        container.innerHTML = renderCardHtml(npsDetails, options);
        bindEvents(container, employeeId, options);

        if (typeof window !== 'undefined' && window.lucide) {
            window.lucide.createIcons();
        }
    }

    return {
        renderCardHtml,
        bindEvents,
        mountNpsCard
    };
}));
