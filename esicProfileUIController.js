/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ESIC & MEDICAL INSURANCE UI CONTROLLER
 * ============================================================================
 * 
 * Renders the "ESIC & Medical Insurance" status card inside the Employee Profile drawer
 * (admin-dashboard.html Statutory tab) matching PRD Section 13:
 * 
 * 1. Status Pills: Insured Person Status, Aadhaar Seeding, Family/Dependent Details.
 * 2. Medical Dispensary allocations and Contribution State.
 * 3. "Verify via Decentro/ESIC" action button with live asynchronous handshake.
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
        root.KylrxEsicProfileUIController = factory();
        root.esicProfileUIController = root.KylrxEsicProfileUIController;
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
     * Renders the complete ESIC & Medical Insurance Card HTML.
     */
    function renderCardHtml(esicDetails = {}, employeeInfo = {}) {
        let service = null;
        if (typeof window !== 'undefined' && window.KylrxEsicDetailsService) {
            service = window.KylrxEsicDetailsService;
        } else if (typeof require === 'function') {
            try {
                service = require('./esicDetailsService.js');
            } catch (e) {}
        }

        const verification = esicDetails.verification || {};

        const hasServiceIp = Boolean(service && typeof service.resolveIpStatusBadge === 'function');
        const hasServiceAadhaar = Boolean(service && typeof service.resolveAadhaarBadge === 'function');
        const hasServiceFamily = Boolean(service && typeof service.resolveFamilyBadge === 'function');
        const hasServiceVerify = Boolean(service && typeof service.resolveVerificationBadge === 'function');

        const ipBadge = hasServiceIp ? service.resolveIpStatusBadge(esicDetails.insuredPersonStatus || 'ACTIVE') : { label: 'Active IP', bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' };
        const aadhaarBadge = hasServiceAadhaar ? service.resolveAadhaarBadge(esicDetails.aadhaarSeeding || 'NOT_SEEDED') : { label: 'Not Seeded', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' };
        const familyBadge = hasServiceFamily ? service.resolveFamilyBadge(esicDetails.familyDependentDetails || 'PENDING') : { label: 'Family Pending', bg: '#fffbeb', color: '#d97706', border: '#fde68a' };
        const verifyBadge = hasServiceVerify ? service.resolveVerificationBadge(esicDetails.isInsuranceNumberVerified) : { label: 'Unverified', bg: '#fffbeb', color: '#d97706', border: '#fde68a' };

        const ipNumber = esicDetails.ipNumber || employeeInfo.esiNumber || '—';
        const employerCode = esicDetails.esicEmployerCode || '53000123450000001';
        const dispensary = esicDetails.dispensaryBranch || 'ESIC Dispensary Indiranagar, BLR';
        const state = esicDetails.contributionState || 'Karnataka';
        const esicDoj = esicDetails.dateOfEsicJoining || esicDetails.dateOfESICJoining || employeeInfo.joiningDate || '—';
        const esicDoe = esicDetails.dateOfEsicExit || esicDetails.dateOfESICExit || 'Active / Covered';
        const source = verification.officialSource || 'Decentro Fabric';
        const refNo = verification.verificationReference || (esicDetails.isInsuranceNumberVerified ? `DEC_ESIC_VERIF_${(ipNumber || '0000').slice(-6)}` : 'Pending Verification');
        const lastVerifiedTime = verification.lastVerified ? new Date(verification.lastVerified).toLocaleString() : 'Not Yet Verified';

        return `
        <div id="esicStatutoryMasterCard" class="modal-section-card" style="margin-bottom: 1.25rem; border: 1.5px solid #0284c7; border-radius: 16px; background: #ffffff; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.08); overflow: hidden;">
            <!-- Header Section -->
            <div style="background: linear-gradient(135deg, #0369a1 0%, #0284c7 100%); padding: 1.1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; color: white;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                        <i data-lucide="cross" style="width: 22px; height: 22px; color: #ffffff;"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; letter-spacing: -0.01em; color: #ffffff;">ESIC &amp; Medical Insurance Statutory Profile</h4>
                        <p style="margin: 2px 0 0 0; font-size: 0.72rem; color: rgba(255, 255, 255, 0.85);">PRD §§ 1, 4, 11 &amp; 13 • 18-Column Schema &amp; Decentro IP Verification Gate</p>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="esicIpStatusHeaderBadge" style="padding: 4px 10px; border-radius: 9999px; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; background: ${ipBadge.bg}; color: ${ipBadge.color}; border: 1px solid ${ipBadge.border}; display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="${ipBadge.icon || 'check-circle'}" style="width: 12px; height: 12px;"></i>
                        <span id="esicIpStatusHeaderText">Status: ${ipBadge.label}</span>
                    </span>
                    <button type="button" id="btnVerifyDecentroEsic" class="btn" style="background: #ffffff; color: #0369a1; font-size: 0.76rem; font-weight: 800; padding: 6px 14px; border-radius: 8px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;">
                        <i data-lucide="refresh-cw" id="esicVerifyIcon" style="width: 13px; height: 13px;"></i>
                        <span id="esicVerifyBtnText">Verify via Decentro/ESIC</span>
                    </button>
                </div>
            </div>

            <!-- Card Body Content -->
            <div style="padding: 1.25rem;">
                <!-- Live Status Pills Matrix (PRD Section 13) -->
                <div style="margin-bottom: 1.25rem;">
                    <div style="font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <i data-lucide="activity" style="width: 14px; height: 14px; color: #0284c7;"></i>
                        Live Statutory Status &amp; Dependent Pills
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 10px;">
                        <!-- Insured Person Status Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">IP Status</span>
                            <span id="pillIpStatus" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 800; color: ${ipBadge.color}; background: ${ipBadge.bg}; border: 1px solid ${ipBadge.border}; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="${ipBadge.icon || 'check-circle'}" style="width: 11px; height: 11px;"></i>
                                <span id="textIpStatus">${ipBadge.label}</span>
                            </span>
                        </div>

                        <!-- Aadhaar Seeding Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Aadhaar Seeding</span>
                            <span id="pillAadhaarSeeding" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 800; color: ${aadhaarBadge.color}; background: ${aadhaarBadge.bg}; border: 1px solid ${aadhaarBadge.border}; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="${aadhaarBadge.icon || 'shield-check'}" style="width: 11px; height: 11px;"></i>
                                <span id="textAadhaarSeeding">${aadhaarBadge.label}</span>
                            </span>
                        </div>

                        <!-- Family/Dependent Details Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Family/Dependents</span>
                            <span id="pillFamilyDetails" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 800; color: ${familyBadge.color}; background: ${familyBadge.bg}; border: 1px solid ${familyBadge.border}; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="${familyBadge.icon || 'users'}" style="width: 11px; height: 11px;"></i>
                                <span id="textFamilyDetails">${familyBadge.label}</span>
                            </span>
                        </div>

                        <!-- Verification Status Pill -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;">
                            <span style="font-size: 0.68rem; color: #64748b; font-weight: 700;">Decentro IP Auth</span>
                            <span id="pillIpVerification" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 800; color: ${verifyBadge.color}; background: ${verifyBadge.bg}; border: 1px solid ${verifyBadge.border}; padding: 2px 8px; border-radius: 6px; width: fit-content;">
                                <i data-lucide="${verifyBadge.icon || 'check-circle'}" style="width: 11px; height: 11px;"></i>
                                <span id="textIpVerification">${verifyBadge.label}</span>
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Detailed Attributes Grid (All 18 Attributes Visualized) -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; background: #f8fafc; padding: 14px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 1.25rem;">
                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Insured Person (IP) Number</div>
                        <div id="esicDisplayIpNumber" style="font-size: 0.95rem; font-weight: 800; color: #0369a1; font-family: monospace; margin-top: 2px;">
                            ${escapeHtml(ipNumber)}
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">ESIC Employer Code (17 Digits)</div>
                        <div style="font-size: 0.88rem; font-weight: 700; color: #1e293b; font-family: monospace; margin-top: 2px;">
                            ${escapeHtml(employerCode)}
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Medical Dispensary / Clinic</div>
                        <div id="esicDisplayDispensary" style="font-size: 0.86rem; font-weight: 700; color: #0f172a; margin-top: 2px;">
                            ${escapeHtml(dispensary)}
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Contribution State Jurisdiction</div>
                        <div id="esicDisplayState" style="font-size: 0.86rem; font-weight: 700; color: #0f172a; margin-top: 2px;">
                            ${escapeHtml(state)}
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Date of ESIC Joining / Exit</div>
                        <div style="font-size: 0.84rem; font-weight: 600; color: #334155; margin-top: 2px;">
                            ${escapeHtml(esicDoj)} &nbsp;→&nbsp; <span style="color: ${esicDoe === 'Active / Covered' ? '#059669' : '#dc2626'}">${escapeHtml(esicDoe)}</span>
                        </div>
                    </div>

                    <div>
                        <div style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Official Source &amp; Reference</div>
                        <div style="font-size: 0.84rem; font-weight: 600; color: #334155; margin-top: 2px;">
                            <span id="esicDisplaySource">${escapeHtml(source)}</span> &bull; <span id="esicDisplayRef" style="font-family: monospace; font-size: 0.76rem;">${escapeHtml(refNo)}</span>
                        </div>
                    </div>
                </div>

                <!-- Statutory Wage Ceiling & Contribution Math Box (PRD §§ 4 & 11) -->
                <div style="background: #f0fdf4; border: 1px dashed #86efac; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.74rem; font-weight: 800; color: #166534; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="calculator" style="width: 14px; height: 14px; color: #16a34a;"></i>
                            Statutory Ceiling &amp; Prorated Contribution Ledger (PRD Section 4)
                        </span>
                        <span style="font-size: 0.7rem; font-weight: 700; color: #15803d; background: #dcfce7; padding: 2px 8px; border-radius: 6px;">
                            Ceiling: ₹21,000 / mo (₹25k PWD)
                        </span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; font-size: 0.74rem; color: #14532d; margin-top: 4px;">
                        <div>
                            <strong>Employee Share (0.75%):</strong><br>
                            <span style="color: #166534; font-size: 0.72rem;">Deducted from gross earnings</span>
                        </div>
                        <div>
                            <strong>Employer Share (3.25%):</strong><br>
                            <span style="color: #166534; font-size: 0.72rem;">Company statutory credit</span>
                        </div>
                        <div>
                            <strong>Total ESIC Remittance (4.00%):</strong><br>
                            <span style="color: #166534; font-size: 0.72rem;">Challan bank clearance</span>
                        </div>
                        <div>
                            <strong>Contribution Cycle:</strong><br>
                            <span style="color: #166534; font-size: 0.72rem;">Apr–Sep &amp; Oct–Mar Rule</span>
                        </div>
                    </div>
                </div>

                <!-- Last Verified Footer Timestamp -->
                <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; color: #94a3b8;">
                    <span>Verification Handshake ID: <span id="esicDisplayHandshakeId" style="font-family: monospace;">${escapeHtml(refNo)}</span></span>
                    <span>Last Verified: <strong id="esicDisplayLastVerified" style="color: #64748b;">${escapeHtml(lastVerifiedTime)}</strong></span>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Binds click events, verification handshake triggers, and toast notices.
     */
    function bindEvents(container, employeeId, options = {}) {
        if (!container) return;

        const verifyBtn = container.querySelector('#btnVerifyDecentroEsic');
        if (verifyBtn) {
            verifyBtn.onclick = async function (e) {
                e.preventDefault();
                const orgId = options.orgId || localStorage.getItem('orgId') || 'ORG_KYLRX_01';
                const btnText = container.querySelector('#esicVerifyBtnText');
                const btnIcon = container.querySelector('#esicVerifyIcon');

                try {
                    verifyBtn.disabled = true;
                    if (btnText) btnText.textContent = 'Contacting Decentro...';
                    if (btnIcon) btnIcon.classList.add('animate-spin');

                    let service = window.KylrxEsicDetailsService;
                    if (!service && typeof require === 'function') {
                        try {
                            service = require('./esicDetailsService.js');
                        } catch (err) {}
                    }

                    if (!service || typeof service.verifyIpNumberViaDecentro !== 'function') {
                        throw new Error("KylrxEsicDetailsService is unavailable or not loaded.");
                    }

                    const res = await service.verifyIpNumberViaDecentro(orgId, employeeId, {
                        officialSource: "Decentro Fabric",
                        verificationReference: `DEC_ESIC_VERIF_${Date.now().toString().slice(-6)}`
                    });

                    if (res && res.success) {
                        updatePillsUi(container, res.profile);
                        if (window.showCustomAlert) {
                            window.showCustomAlert(
                                "ESIC Verified",
                                `Decentro Fabric handshake confirmed IP active for ${employeeId}. Reference: ${res.verificationReference}`,
                                "success"
                            );
                        } else {
                            alert(`Decentro Fabric handshake confirmed IP active for ${employeeId}.`);
                        }
                    } else {
                        throw new Error(res.message || "ESIC verification returned failed status.");
                    }
                } catch (err) {
                    console.error("ESIC Verification Failed:", err);
                    if (window.showCustomAlert) {
                        window.showCustomAlert("Verification Error", err.message || "Could not verify IP Number with Decentro.", "error");
                    } else {
                        alert("Verification error: " + err.message);
                    }
                } finally {
                    if (btnText) btnText.textContent = 'Verify via Decentro/ESIC';
                    if (btnIcon) btnIcon.classList.remove('animate-spin');
                    verifyBtn.disabled = false;
                    if (window.lucide) lucide.createIcons();
                }
            };
        }
    }

    /**
     * Updates pill UI elements in-place following verification.
     */
    function updatePillsUi(container, profile) {
        if (!container || !profile) return;

        const verification = profile.verification || {};
        const service = window.KylrxEsicDetailsService;

        if (service) {
            const ipBadge = service.resolveIpStatusBadge(profile.insuredPersonStatus || 'ACTIVE');
            const esicIpStatusHeaderBadge = container.querySelector('#esicIpStatusHeaderBadge');
            const esicIpStatusHeaderText = container.querySelector('#esicIpStatusHeaderText');
            if (esicIpStatusHeaderBadge) {
                esicIpStatusHeaderBadge.style.background = ipBadge.bg;
                esicIpStatusHeaderBadge.style.color = ipBadge.color;
                esicIpStatusHeaderBadge.style.borderColor = ipBadge.border;
            }
            if (esicIpStatusHeaderText) {
                esicIpStatusHeaderText.textContent = `Status: ${ipBadge.label}`;
            }

            const pillIp = container.querySelector('#pillIpStatus');
            const textIp = container.querySelector('#textIpStatus');
            if (pillIp) {
                pillIp.style.background = ipBadge.bg;
                pillIp.style.color = ipBadge.color;
                pillIp.style.borderColor = ipBadge.border;
            }
            if (textIp) textIp.textContent = ipBadge.label;

            const aadhaarBadge = service.resolveAadhaarBadge(profile.aadhaarSeeding || 'VERIFIED');
            const pillAadhaar = container.querySelector('#pillAadhaarSeeding');
            const textAadhaar = container.querySelector('#textAadhaarSeeding');
            if (pillAadhaar) {
                pillAadhaar.style.background = aadhaarBadge.bg;
                pillAadhaar.style.color = aadhaarBadge.color;
                pillAadhaar.style.borderColor = aadhaarBadge.border;
            }
            if (textAadhaar) textAadhaar.textContent = aadhaarBadge.label;

            const familyBadge = service.resolveFamilyBadge(profile.familyDependentDetails || 'SUBMITTED');
            const pillFamily = container.querySelector('#pillFamilyDetails');
            const textFamily = container.querySelector('#textFamilyDetails');
            if (pillFamily) {
                pillFamily.style.background = familyBadge.bg;
                pillFamily.style.color = familyBadge.color;
                pillFamily.style.borderColor = familyBadge.border;
            }
            if (textFamily) textFamily.textContent = familyBadge.label;

            const verifyBadge = service.resolveVerificationBadge(true);
            const pillVerify = container.querySelector('#pillIpVerification');
            const textVerify = container.querySelector('#textIpVerification');
            if (pillVerify) {
                pillVerify.style.background = verifyBadge.bg;
                pillVerify.style.color = verifyBadge.color;
                pillVerify.style.borderColor = verifyBadge.border;
            }
            if (textVerify) textVerify.textContent = verifyBadge.label;
        }

        const esicDisplaySource = container.querySelector('#esicDisplaySource');
        if (esicDisplaySource) esicDisplaySource.textContent = verification.officialSource || 'Decentro Fabric';

        const esicDisplayRef = container.querySelector('#esicDisplayRef');
        if (esicDisplayRef && verification.verificationReference) esicDisplayRef.textContent = verification.verificationReference;

        const esicDisplayHandshakeId = container.querySelector('#esicDisplayHandshakeId');
        if (esicDisplayHandshakeId && verification.verificationReference) esicDisplayHandshakeId.textContent = verification.verificationReference;

        const esicDisplayLastVerified = container.querySelector('#esicDisplayLastVerified');
        if (esicDisplayLastVerified && verification.lastVerified) {
            esicDisplayLastVerified.textContent = new Date(verification.lastVerified).toLocaleString();
        }

        const esicDisplayIpNumber = container.querySelector('#esicDisplayIpNumber');
        if (esicDisplayIpNumber && profile.ipNumber) esicDisplayIpNumber.textContent = profile.ipNumber;
    }

    /**
     * Mounts the ESIC card inside target container element.
     */
    async function mountEsicCard(targetContainerId, employeeId, options = {}) {
        let container = typeof targetContainerId === 'string'
            ? document.getElementById(targetContainerId)
            : targetContainerId;

        if (!container) return;

        const orgId = options.orgId || localStorage.getItem('orgId') || 'ORG_KYLRX_01';
        let esicDetails = null;

        if (window.KylrxEsicDetailsService && typeof window.KylrxEsicDetailsService.getEmployeeEsicDetails === 'function') {
            esicDetails = await window.KylrxEsicDetailsService.getEmployeeEsicDetails(orgId, employeeId);
        }

        if (!esicDetails && window.KylrxEsicDetailsService) {
            esicDetails = window.KylrxEsicDetailsService.DEFAULT_ESIC_PROFILES.find(p => p.employeeId === employeeId) || {
                employeeId,
                organizationId: orgId,
                isEsicApplicable: true,
                ipNumber: options.esiNumber || "3100482910",
                esicEmployerCode: "53000123450000001",
                dateOfEsicJoining: options.joiningDate || "2026-01-15",
                dateOfEsicExit: null,
                insuredPersonStatus: "ACTIVE",
                aadhaarSeeding: "VERIFIED",
                familyDependentDetails: "SUBMITTED",
                dispensaryBranch: "ESIC Dispensary Indiranagar, BLR",
                contributionState: "Karnataka",
                isInsuranceNumberVerified: true,
                verification: {
                    officialSource: "Decentro Fabric",
                    verificationMethod: "API",
                    verificationReference: "DEC_ESIC_VERIF_8829102",
                    lastVerified: "2026-10-05T10:30:00Z",
                    lastSynced: "2026-10-05T10:30:00Z"
                }
            };
        }

        container.innerHTML = renderCardHtml(esicDetails, options);
        bindEvents(container, employeeId, options);

        if (window.lucide) {
            lucide.createIcons();
        }
    }

    return {
        renderCardHtml,
        bindEvents,
        mountEsicCard,
        updatePillsUi
    };
}));
