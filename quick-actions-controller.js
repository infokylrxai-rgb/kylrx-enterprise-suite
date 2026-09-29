/**
 * Kylrx AI - Unified Employee Quick Actions Controller (PRD Section 15)
 * Vanilla ES6 controller managing Quick Action hubs, slide-over document drawer,
 * click delegation, and modal routing across ESS, Manager, and Admin dashboards.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.QuickActionsController = exports.QuickActionsController;
        root.QuickActionsControllerClass = exports.QuickActionsControllerClass;
        root.DEFAULT_DOCUMENTS = exports.DEFAULT_DOCUMENTS;
    }
}(typeof self !== 'undefined' ? self : this, function () {

// Sample Document Repository Data conforming to PRD Section 15
const DEFAULT_DOCUMENTS = [
    {
        id: "DOC-POL-001",
        category: "policies",
        title: "Kylrx AI Employee Code of Conduct (v2.4)",
        type: "PDF Policy",
        size: "1.4 MB",
        date: "2026-01-15",
        status: "Active & Verified",
        issuer: "People Operations & Compliance",
        summary: "Comprehensive guidelines covering ethical conduct, confidentiality, non-solicitation, and workplace harassment policies."
    },
    {
        id: "DOC-POL-002",
        category: "policies",
        title: "Information Security & Hybrid Work Protocol",
        type: "PDF Policy",
        size: "820 KB",
        date: "2026-02-01",
        status: "Active & Verified",
        issuer: "Information Security Group",
        summary: "Mandatory protocols for enterprise VPN access, biometric punch verification, clean desk policies, and device security."
    },
    {
        id: "DOC-LTR-001",
        category: "letters",
        title: "Executive Employment Agreement & Offer Letter",
        type: "Signed Contract",
        size: "2.1 MB",
        date: "2025-08-10",
        status: "Digitally Signed",
        issuer: "Executive HR & Talent Acquisition",
        summary: "Official appointment contract detailing designation, compensation structure, notice period, and statutory terms."
    },
    {
        id: "DOC-LTR-002",
        category: "letters",
        title: "Mutual Non-Disclosure Agreement (NDA)",
        type: "Signed Agreement",
        size: "950 KB",
        date: "2025-08-10",
        status: "Digitally Signed",
        issuer: "Legal & Corporate Governance",
        summary: "Proprietary information protection and intellectual property assignment covenants."
    },
    {
        id: "DOC-TAX-001",
        category: "tax",
        title: "Form 16 Part-A & Part-B (AY 2026-27)",
        type: "Statutory Tax Certificate",
        size: "1.8 MB",
        date: "2026-06-30",
        status: "Digitally Certified",
        issuer: "Finance & Payroll Department",
        summary: "Annual TDS deduction statement and tax computation certificate verified under Section 203 of the Income-tax Act."
    },
    {
        id: "DOC-TAX-002",
        category: "tax",
        title: "Monthly Salary Disbursement Voucher (Sep 2026)",
        type: "Payslip Voucher",
        size: "420 KB",
        date: "2026-09-30",
        status: "Processed & Reconciled",
        issuer: "Kylrx Automated Payroll Engine",
        summary: "Detailed breakdown of Basic, HRA, Special Allowance, PF, ESIC, Professional Tax, and net bank disbursement."
    },
    {
        id: "DOC-STC-001",
        category: "statutory",
        title: "EPFO UAN Membership Card (Universal Account)",
        type: "Statutory Identity",
        size: "650 KB",
        date: "2025-08-15",
        status: "Verified with EPFO",
        issuer: "Ministry of Labour & Employment",
        summary: "Universal Account Number linkage certificate with KYC verification details."
    },
    {
        id: "DOC-STC-002",
        category: "statutory",
        title: "ESIC Insurance Card (IP Verification)",
        type: "Social Security",
        size: "520 KB",
        date: "2025-08-15",
        status: "Verified with ESIC",
        issuer: "Employees' State Insurance Corporation",
        summary: "Insured Person (IP) identification certificate, registered dispensary details, and family benefits entitlement."
    },
    {
        id: "DOC-STC-003",
        category: "statutory",
        title: "PAN & Aadhaar e-KYC Verification Certificate",
        type: "Government Identity",
        size: "1.1 MB",
        date: "2025-08-12",
        status: "UIDAI / NSDL Linked",
        issuer: "Income Tax & UIDAI Gateway",
        summary: "Verified statutory identity records linking Aadhaar, PAN, and employee bank account."
    }
];

class QuickActionsControllerClass {
    constructor() {
        this.documents = [...DEFAULT_DOCUMENTS];
        this.activeCategory = "all";
        this.searchQuery = "";
        this.currentEmployeeId = null;
        this.currentRole = "employee";
        this.isInitialized = false;
    }

    /**
     * Initializes click delegation and binds UI triggers across dashboards
     */
    init(options = {}) {
        if (options.role) this.currentRole = options.role;
        if (options.employeeId) this.currentEmployeeId = options.employeeId;

        if (this.isInitialized) return;
        this.isInitialized = true;

        // Ensure slide-over drawer DOM exists
        this.ensureDrawerDOM();

        // Global click delegation for Quick Action buttons
        document.addEventListener("click", (e) => {
            const item = e.target.closest("[data-quick-action]");
            if (item) {
                e.preventDefault();
                const action = item.getAttribute("data-quick-action");
                const targetEmp = item.getAttribute("data-emp-id") || this.currentEmployeeId;
                this.handleAction(action, targetEmp, item);
            }
        });

        // Close drawer when clicking backdrop
        const backdrop = document.getElementById("qaDrawerBackdrop");
        if (backdrop) {
            backdrop.addEventListener("click", () => this.closeDrawer());
        }

        // Search listener inside drawer
        const searchInput = document.getElementById("qaDocSearchInput");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.searchQuery = e.target.value.toLowerCase().trim();
                this.renderDrawerDocuments();
            });
        }
    }

    /**
     * Renders standard Unified Quick Actions Grid HTML
     * @param {string} role - 'employee' | 'manager' | 'admin'
     * @param {string} employeeId - Optional employee ID for targeted actions
     */
    generateGridHTML(role = "employee", employeeId = "") {
        const empAttr = employeeId ? `data-emp-id="${employeeId}"` : "";
        
        return `
        <div class="quick-actions-container">
            <div class="quick-actions-header">
                <div class="quick-actions-title-wrap">
                    <h3 class="quick-actions-title">
                        <i data-lucide="zap" style="color: var(--qa-primary); width: 18px; height: 18px;"></i>
                        Quick Actions
                    </h3>
                    <span class="quick-actions-badge">PRD §15</span>
                </div>
                <span class="quick-actions-role-pill">
                    ${role === "admin" ? "Super Admin Access" : role === "manager" ? "Manager Oversight" : "Self-Service"}
                </span>
            </div>

            <div class="quick-actions-grid">
                <!-- Action 1: Documents (PRD §15 Mandatory) -->
                <div class="quick-action-item" data-quick-action="documents" ${empAttr} role="button" tabindex="0" title="Open Employee Document Repository">
                    <div class="action-icon-wrap">
                        <i data-lucide="file-text"></i>
                    </div>
                    <div class="action-text-group">
                        <div class="action-title">
                            <span>Documents</span>
                            <i data-lucide="chevron-right" class="action-arrow-hint" style="width: 14px; height: 14px;"></i>
                        </div>
                        <p class="action-desc">Official files, policies & slips</p>
                    </div>
                </div>

                <!-- Action 2: Attendance -->
                <div class="quick-action-item" data-quick-action="attendance" ${empAttr} role="button" tabindex="0" title="Clock-in & Punch History">
                    <div class="action-icon-wrap">
                        <i data-lucide="calendar-check"></i>
                    </div>
                    <div class="action-text-group">
                        <div class="action-title">
                            <span>Attendance</span>
                            <i data-lucide="chevron-right" class="action-arrow-hint" style="width: 14px; height: 14px;"></i>
                        </div>
                        <p class="action-desc">Clock-in & punch records</p>
                    </div>
                </div>

                <!-- Action 3: Job Details (PRD §13/§14) -->
                <div class="quick-action-item" data-quick-action="job-details" ${empAttr} role="button" tabindex="0" title="View Profile, L1/L2 Managers & Statutory Details">
                    <div class="action-icon-wrap">
                        <i data-lucide="briefcase"></i>
                    </div>
                    <div class="action-text-group">
                        <div class="action-title">
                            <span>Job Details</span>
                            <i data-lucide="chevron-right" class="action-arrow-hint" style="width: 14px; height: 14px;"></i>
                        </div>
                        <p class="action-desc">Profile, L1/L2 & statutory</p>
                    </div>
                </div>

                <!-- Action 4: Payslips -->
                <div class="quick-action-item" data-quick-action="payslips" ${empAttr} role="button" tabindex="0" title="Download Monthly Pay Vouchers">
                    <div class="action-icon-wrap">
                        <i data-lucide="credit-card"></i>
                    </div>
                    <div class="action-text-group">
                        <div class="action-title">
                            <span>Payslips</span>
                            <i data-lucide="chevron-right" class="action-arrow-hint" style="width: 14px; height: 14px;"></i>
                        </div>
                        <p class="action-desc">Download monthly vouchers</p>
                    </div>
                </div>

                <!-- Action 5: Leave Request -->
                <div class="quick-action-item" data-quick-action="leave" ${empAttr} role="button" tabindex="0" title="Apply for Leave & Approvals">
                    <div class="action-icon-wrap">
                        <i data-lucide="clock"></i>
                    </div>
                    <div class="action-text-group">
                        <div class="action-title">
                            <span>Apply Leave</span>
                            <i data-lucide="chevron-right" class="action-arrow-hint" style="width: 14px; height: 14px;"></i>
                        </div>
                        <p class="action-desc">Time-off & approvals</p>
                    </div>
                </div>

                <!-- Action 6: Task Update / Operations -->
                <div class="quick-action-item" data-quick-action="tasks" ${empAttr} role="button" tabindex="0" title="Daily Tasks & Messages">
                    <div class="action-icon-wrap">
                        <i data-lucide="check-square"></i>
                    </div>
                    <div class="action-text-group">
                        <div class="action-title">
                            <span>Task Update</span>
                            <i data-lucide="chevron-right" class="action-arrow-hint" style="width: 14px; height: 14px;"></i>
                        </div>
                        <p class="action-desc">Submit daily status report</p>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    /**
     * Routes clicks from quick action cards without full page reload
     */
    handleAction(action, employeeId, targetEl) {
        switch (action) {
            case "documents":
                this.openDocumentDrawer(employeeId);
                break;
            case "attendance":
                this.openAttendance(employeeId);
                break;
            case "job-details":
                this.openJobDetails(employeeId);
                break;
            case "payslips":
                this.openPayslips(employeeId);
                break;
            case "leave":
                this.openLeave(employeeId);
                break;
            case "tasks":
                this.openTasks(employeeId);
                break;
            default:
                console.warn(`[QuickActionsController] Unhandled action: ${action}`);
        }
    }

    /**
     * PRD §15 Requirement: Direct Documents Shortcut opening the employee repository
     * to preview and download company policies, signed letters, tax slips, and uploaded statutory certificates.
     */
    openDocumentDrawer(employeeId = null) {
        this.ensureDrawerDOM();
        const drawer = document.getElementById("quickActionsDocDrawer");
        const backdrop = document.getElementById("qaDrawerBackdrop");

        if (drawer && backdrop) {
            drawer.classList.add("active");
            backdrop.classList.add("active");
            this.renderDrawerDocuments();
            if (window.lucide && typeof window.lucide.createIcons === "function") {
                window.lucide.createIcons();
            }
        }
    }

    closeDrawer() {
        const drawer = document.getElementById("quickActionsDocDrawer");
        const backdrop = document.getElementById("qaDrawerBackdrop");
        if (drawer) drawer.classList.remove("active");
        if (backdrop) backdrop.classList.remove("active");
    }

    /**
     * Category tab switcher in Drawer
     */
    setCategory(cat) {
        this.activeCategory = cat;
        if (typeof document !== "undefined") {
            const tabs = document.querySelectorAll(".qa-tab-btn");
            tabs.forEach(btn => {
                if (btn.getAttribute("data-cat") === cat) {
                    btn.classList.add("active");
                } else {
                    btn.classList.remove("active");
                }
            });
            this.renderDrawerDocuments();
        }
    }

    /**
     * Renders filtered list of documents inside slide-over drawer
     */
    renderDrawerDocuments() {
        const container = document.getElementById("qaDocListContainer");
        if (!container) return;

        let filtered = this.documents;
        if (this.activeCategory !== "all") {
            filtered = filtered.filter(d => d.category === this.activeCategory);
        }
        if (this.searchQuery) {
            filtered = filtered.filter(d => 
                d.title.toLowerCase().includes(this.searchQuery) ||
                d.summary.toLowerCase().includes(this.searchQuery) ||
                d.type.toLowerCase().includes(this.searchQuery)
            );
        }

        if (filtered.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem 1rem; color: var(--qa-text-muted);">
                    <i data-lucide="file-question" style="width: 40px; height: 40px; margin: 0 auto 10px; opacity: 0.5;"></i>
                    <p style="font-size: 0.9rem; font-weight: 700; margin: 0;">No documents match your filter</p>
                    <span style="font-size: 0.75rem;">Try selecting another category or clearing search.</span>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        container.innerHTML = filtered.map(doc => {
            const iconType = doc.category === "policies" ? "shield" 
                : doc.category === "letters" ? "file-signature" 
                : doc.category === "tax" ? "file-text" : "award";

            return `
                <div class="qa-doc-card">
                    <div class="qa-doc-icon ${doc.category}">
                        <i data-lucide="${iconType}"></i>
                    </div>
                    <div class="qa-doc-details">
                        <h4 class="qa-doc-title" title="${doc.title}">${doc.title}</h4>
                        <div class="qa-doc-meta">
                            <span>${doc.type}</span>
                            <span>•</span>
                            <span>${doc.size}</span>
                            <span>•</span>
                            <span style="color: var(--qa-success); font-weight: 700;">${doc.status}</span>
                        </div>
                    </div>
                    <div class="qa-doc-actions">
                        <button class="qa-btn-action" onclick="window.QuickActionsController.previewDocument('${doc.id}')" title="Preview Document">
                            <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
                            <span>Preview</span>
                        </button>
                        <button class="qa-btn-action primary" onclick="window.QuickActionsController.downloadDocument('${doc.id}')" title="Download Document">
                            <i data-lucide="download" style="width: 14px; height: 14px;"></i>
                            <span>Download</span>
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        if (window.lucide) window.lucide.createIcons();
    }

    /**
     * Preview Document Modal
     */
    previewDocument(docId) {
        const doc = this.documents.find(d => d.id === docId);
        if (!doc) return;

        const previewOverlay = document.getElementById("qaPreviewOverlay");
        const titleEl = document.getElementById("qaPreviewTitle");
        const contentEl = document.getElementById("qaPreviewBody");
        const downloadBtn = document.getElementById("qaPreviewDownloadBtn");

        if (titleEl) titleEl.textContent = doc.title;
        if (downloadBtn) downloadBtn.onclick = () => this.downloadDocument(docId);

        if (contentEl) {
            contentEl.innerHTML = `
                <div class="qa-preview-sheet">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 1.5rem; margin-bottom: 1.5rem;">
                        <div>
                            <span style="font-size: 0.7rem; font-weight: 800; color: #2563eb; text-transform: uppercase; letter-spacing: 1px;">Kylrx.ai Enterprise Vault</span>
                            <h2 style="font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 4px 0;">${doc.title}</h2>
                            <p style="font-size: 0.8rem; color: #64748b; margin: 0;">Identifier: ${doc.id} • Category: ${doc.category.toUpperCase()}</p>
                        </div>
                        <div style="text-align: right;">
                            <span style="background: #ecfdf5; color: #059669; font-size: 0.72rem; font-weight: 800; padding: 4px 10px; border-radius: 20px; border: 1px solid #a7f3d0;">
                                ${doc.status}
                            </span>
                            <div style="font-size: 0.72rem; color: #64748b; margin-top: 6px;">Effective: ${doc.date}</div>
                        </div>
                    </div>

                    <div style="margin-bottom: 1.5rem;">
                        <h4 style="font-size: 0.85rem; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Executive Summary & Scope</h4>
                        <p style="font-size: 0.9rem; line-height: 1.6; color: #475569; margin: 0;">${doc.summary}</p>
                    </div>

                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1.25rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                        <div>
                            <div style="font-size: 0.7rem; font-weight: 700; color: #64748b; text-transform: uppercase;">Issuing Authority</div>
                            <div style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">${doc.issuer}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.7rem; font-weight: 700; color: #64748b; text-transform: uppercase;">Cryptographic Hash</div>
                            <div style="font-size: 0.8rem; font-family: monospace; color: #2563eb;">SHA256: 7f83b165...94c3</div>
                        </div>
                    </div>

                    <div style="font-size: 0.75rem; color: #94a3b8; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 1rem;">
                        Official document certified by Kylrx Enterprise Suite. This electronic document is legally binding under Section 15 compliance regulations.
                    </div>
                </div>
            `;
        }

        if (previewOverlay) previewOverlay.classList.add("active");
        if (window.lucide) window.lucide.createIcons();
    }

    closePreview() {
        const previewOverlay = document.getElementById("qaPreviewOverlay");
        if (previewOverlay) previewOverlay.classList.remove("active");
    }

    /**
     * Download Document trigger with simulated PDF/voucher delivery
     */
    downloadDocument(docId) {
        const doc = this.documents.find(d => d.id === docId);
        const docTitle = doc ? doc.title : "Document";

        // Show toast or alert
        if (typeof window.showToast === "function") {
            window.showToast(`Downloading: ${docTitle}...`, "success");
        } else if (typeof window.showStatusModal === "function") {
            window.showStatusModal("Document Download", `Starting encrypted download for: "${docTitle}" (${doc ? doc.size : ''}).`, "success");
        } else {
            const toast = document.createElement("div");
            toast.style.cssText = "position:fixed;bottom:24px;right:24px;background:#0f172a;color:#ffffff;padding:12px 20px;border-radius:12px;font-size:0.85rem;font-weight:700;z-index:9999;box-shadow:0 10px 25px rgba(0,0,0,0.2);display:flex;align-items:center;gap:10px;";
            toast.innerHTML = `<span style="color:#10b981;">✔</span> Downloading "${docTitle}"`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3500);
        }
    }

    /**
     * Quick Action: Attendance Route
     */
    openAttendance(employeeId = null) {
        if (typeof window.managerPunchIn === "function" || document.getElementById("btnPunchIn")) {
            const punchBtn = document.getElementById("btnPunchIn");
            if (punchBtn) {
                punchBtn.scrollIntoView({ behavior: "smooth", block: "center" });
                punchBtn.style.animation = "pulse 1s 2";
            }
        } else if (typeof window.openPunchModal === "function") {
            window.openPunchModal();
        } else if (typeof window.navigateTo === "function") {
            window.navigateTo("employee-attendance-log.html");
        } else {
            window.location.href = "employee-attendance-log.html";
        }
    }

    /**
     * Quick Action: Job Details Route (PRD §13/§14 Profile & Statutory)
     */
    openJobDetails(employeeId = null) {
        const empId = employeeId || this.currentEmployeeId || "EMP0001";
        
        // Super Admin / Admin Dashboard modal
        if (window.EmployeeProfileController && typeof window.EmployeeProfileController.openModal === "function") {
            window.EmployeeProfileController.openModal(empId);
        } else if (typeof window.openEmpModal === "function") {
            window.openEmpModal(empId);
        } else if (typeof window.showStatusModal === "function") {
            window.showStatusModal(
                "Job & Statutory Details (PRD §13/§14)",
                `Viewing official job details for ${empId}: Designation, Department, Reporting Managers (L1/L2), PF (UAN: 100904829104) and ESIC (1102948291).`,
                "info"
            );
        } else {
            alert(`Opening Job Details Profile for ${empId}`);
        }
    }

    /**
     * Quick Action: Payslips Route
     */
    openPayslips(employeeId = null) {
        this.openDocumentDrawer(employeeId);
        this.setCategory("tax");
    }

    /**
     * Quick Action: Apply Leave Route
     */
    openLeave(employeeId = null) {
        if (typeof window.navigateTo === "function") {
            window.navigateTo("employee-leave.html");
        } else {
            window.location.href = "employee-leave.html";
        }
    }

    /**
     * Quick Action: Task Update Route
     */
    openTasks(employeeId = null) {
        const msgModal = document.getElementById("hrMessageModal");
        if (msgModal) {
            msgModal.style.display = "flex";
        } else if (typeof window.navigateTo === "function") {
            window.navigateTo("employee-message.html");
        } else {
            window.location.href = "employee-message.html";
        }
    }

    /**
     * Injects the Slide-Over Document Repository Drawer & Preview Modal DOM if not present
     */
    ensureDrawerDOM() {
        if (document.getElementById("quickActionsDocDrawer")) return;

        const drawerHTML = `
        <!-- Quick Actions Slide-Over Drawer (PRD §15) -->
        <div id="qaDrawerBackdrop" class="qa-drawer-backdrop"></div>
        <div id="quickActionsDocDrawer" class="qa-drawer">
            <div class="qa-drawer-header">
                <div class="qa-drawer-title-group">
                    <h2>Official Documents & Policies</h2>
                    <p>Employee repository: preview, download & audit certificates</p>
                </div>
                <button class="qa-drawer-close" onclick="window.QuickActionsController.closeDrawer()" title="Close Drawer">
                    <i data-lucide="x" style="width: 18px; height: 18px;"></i>
                </button>
            </div>

            <div style="padding: 1rem 1.75rem 0.5rem 1.75rem; background: #fafbff;">
                <div style="position: relative;">
                    <input type="text" id="qaDocSearchInput" placeholder="Search policies, letters, tax slips, or certificates..." 
                        style="width: 100%; padding: 9px 12px 9px 34px; border-radius: 10px; border: 1px solid var(--qa-border); font-size: 0.8rem; outline: none; background: white;">
                    <i data-lucide="search" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--qa-text-muted);"></i>
                </div>
            </div>

            <!-- Segmented Category Filter Tabs -->
            <div class="qa-drawer-tabs">
                <button class="qa-tab-btn active" data-cat="all" onclick="window.QuickActionsController.setCategory('all')">All Records</button>
                <button class="qa-tab-btn" data-cat="policies" onclick="window.QuickActionsController.setCategory('policies')">Company Policies</button>
                <button class="qa-tab-btn" data-cat="letters" onclick="window.QuickActionsController.setCategory('letters')">Signed Letters</button>
                <button class="qa-tab-btn" data-cat="tax" onclick="window.QuickActionsController.setCategory('tax')">Tax & Payslips</button>
                <button class="qa-tab-btn" data-cat="statutory" onclick="window.QuickActionsController.setCategory('statutory')">Statutory (PF/ESI)</button>
            </div>

            <!-- Document List Scroll Body -->
            <div id="qaDocListContainer" class="qa-drawer-body">
                <!-- Injected via renderDrawerDocuments -->
            </div>

            <!-- Drawer Footer -->
            <div style="padding: 1rem 1.75rem; border-top: 1px solid var(--qa-border); background: #ffffff; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.72rem; color: var(--qa-text-muted); font-weight: 600;">PRD §15 Verified Vault</span>
                <button onclick="if(window.navigateTo){window.navigateTo('employee-docs.html');}else{window.location.href='employee-docs.html';}" 
                    style="background: none; border: none; color: var(--qa-primary); font-size: 0.78rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                    <span>Open Full Vault</span>
                    <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        </div>

        <!-- Document Preview Modal (PRD §15) -->
        <div id="qaPreviewOverlay" class="qa-preview-overlay">
            <div class="qa-preview-card">
                <div class="qa-preview-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="file-check" style="color: var(--qa-primary); width: 20px; height: 20px;"></i>
                        <h3 id="qaPreviewTitle" style="font-size: 1.1rem; font-weight: 800; margin: 0; color: var(--qa-text-main);">Document Preview</h3>
                    </div>
                    <button class="qa-drawer-close" onclick="window.QuickActionsController.closePreview()" title="Close Preview">
                        <i data-lucide="x" style="width: 18px; height: 18px;"></i>
                    </button>
                </div>
                <div id="qaPreviewBody" class="qa-preview-content">
                    <!-- Preview Sheet Injected Here -->
                </div>
                <div class="qa-preview-footer">
                    <button class="qa-btn-action" onclick="window.QuickActionsController.closePreview()">Close</button>
                    <button id="qaPreviewDownloadBtn" class="qa-btn-action primary">
                        <i data-lucide="download" style="width: 14px; height: 14px;"></i>
                        <span>Download Certified Copy</span>
                    </button>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML("beforeend", drawerHTML);
    }
}

    // Global Singleton Instance
    const QuickActionsController = new QuickActionsControllerClass();

    if (typeof window !== "undefined") {
        window.QuickActionsController = QuickActionsController;
        if (typeof document !== "undefined") {
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => QuickActionsController.init());
            } else {
                QuickActionsController.init();
            }
        }
    }

    return {
        QuickActionsControllerClass,
        QuickActionsController,
        DEFAULT_DOCUMENTS
    };
}));
