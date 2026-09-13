import fs from 'fs';
import path from 'path';

const canonicalAdminSidebar = (activePage) => `        <!-- Sidebar Navigation -->
        <aside class="sidebar">
            <a href="admin-dashboard.html" class="logo">
                <img src="logo.jpg" alt="Logo" style="height: 36px; object-fit: contain; border-radius: 8px;">
                <span class="logo-text">Kylrx <span style="color: var(--primary);">AI</span></span>
            </a>
            
            <nav class="nav-menu">
                <div class="nav-label">MAIN MENU</div>
                <div class="nav-item"><a href="admin-central-dashboard.html" class="nav-link"><i data-lucide="command"></i><span>Command Center</span></a></div>
                <div class="nav-item"><a href="admin-dashboard.html" class="nav-link"><i data-lucide="shield-check"></i><span>Super Admin Console</span></a></div>
                <div class="nav-item"><a href="hrms-dashboard.html" class="nav-link" style="color: #2563eb; font-weight: 700;" title="HRMS Strategic Operations Hub"><i data-lucide="layout-dashboard"></i><span>HRMS Strategic Hub</span></a></div>
                <div class="nav-item"><a href="admin-notification-center.html" class="nav-link"><i data-lucide="bell"></i><span>Notification & Actions</span></a></div>
                <div class="nav-item"><a href="admin-automation-builder.html" class="nav-link"><i data-lucide="git-merge"></i><span>Automation Builder</span></a></div>
                <div class="nav-item"><a href="admin-workflow-builder.html" class="nav-link"><i data-lucide="workflow"></i><span>Workflow Builder</span></a></div>
                <div class="nav-item"><a href="admin-assignment-matrix.html" class="nav-link"><i data-lucide="layers"></i><span>Assignment Hub</span></a></div>
                <div class="nav-item"><a href="admin-alert-builder.html" class="nav-link"><i data-lucide="bell-ring"></i><span>Alert Builder</span></a></div>
                <div class="nav-item"><a href="admin-analytics-builder.html" class="nav-link"><i data-lucide="bar-chart-2"></i><span>Analytics Builder</span></a></div>
                <div class="nav-item"><a href="admin-dashboard-builder.html" class="nav-link"><i data-lucide="layout-grid"></i><span>Enterprise Builder</span></a></div>
                <div class="nav-item"><a href="admin-policy-center.html" class="nav-link"><i data-lucide="shield-check"></i><span>Policy Center</span></a></div>
                <div class="nav-item"><a href="admin-asset-management.html" class="nav-link"><i data-lucide="monitor"></i><span>Asset Mgmt</span></a></div>
                <div class="nav-item"><a href="admin-exit-management.html" class="nav-link"><i data-lucide="log-out"></i><span>Exit Mgmt</span></a></div>

                <div class="nav-label">OPERATIONS</div>
                <div class="nav-item"><a href="admin-attendance-monitor.html" class="nav-link"><i data-lucide="clock"></i><span>Attendance Monitor</span></a></div>
                <div class="nav-item"><a href="admin-leave-management.html" class="nav-link"><i data-lucide="calendar"></i><span>Leave Mgmt</span></a></div>
                <div class="nav-item"><a href="admin-document-templates.html" class="nav-link"><i data-lucide="file-text"></i><span>Document Templates</span></a></div>
                <div class="nav-item"><a href="admin-payroll-documents.html" class="nav-link"><i data-lucide="file-text"></i><span>Payroll Docs</span></a></div>
                <div class="nav-item"><a href="admin-payroll-upload.html" class="nav-link"><i data-lucide="upload"></i><span>Finance Payroll Upload</span></a></div>
                <div class="nav-item"><a href="admin-payroll-disbursement.html" class="nav-link ${activePage === 'payroll' ? 'active' : ''}"><i data-lucide="credit-card"></i><span>Payroll Disbursement</span></a></div>
                <div class="nav-item"><a href="admin-statutory-compliance.html" class="nav-link ${activePage === 'compliance' ? 'active' : ''}"><i data-lucide="scale"></i><span>Statutory Compliance</span></a></div>
                <div class="nav-item"><a href="admin-inactivity-monitor.html" class="nav-link"><i data-lucide="radar"></i><span>Inactivity Radar</span></a></div>

                <div class="nav-label">INTELLIGENCE</div>
                <div class="nav-item"><a href="admin-onboarding-ai.html" class="nav-link"><i data-lucide="brain"></i><span>AI Command Center</span></a></div>
                <div class="nav-item"><a href="admin-hr-console.html" class="nav-link"><i data-lucide="bar-chart-3"></i><span>Strategic HR Console</span></a></div>
                <div class="nav-item"><a href="admin-analysis.html" class="nav-link"><i data-lucide="pie-chart"></i><span>Analytics Center</span></a></div>
                <div class="nav-item"><a href="operational-dashboard.html" class="nav-link"><i data-lucide="bar-chart-2"></i><span>Operational Reports</span></a></div>
                <div class="nav-item"><a href="tvc-dashboard.html" class="nav-link"><i data-lucide="monitor"></i><span>TVC Workforce Monitor</span></a></div>

                <div class="nav-label">GOVERNANCE & APPROVALS</div>
                <div class="nav-item"><a href="admin-manager-change.html" class="nav-link"><i data-lucide="git-pull-request"></i><span>Manager Governance</span></a></div>
                <div class="nav-item"><a href="admin-bank-approvals.html" class="nav-link"><i data-lucide="check-square"></i><span>Bank Verifications</span></a></div>
                <div class="nav-item"><a href="admin-bank-transfer.html" class="nav-link"><i data-lucide="send"></i><span>Bank Transfer</span></a></div>
                <div class="nav-item"><a href="admin-conversion-hub.html" class="nav-link"><i data-lucide="repeat"></i><span>Lifecycle Conversion</span></a></div>
                <div class="nav-item"><a href="admin-notifications.html" class="nav-link"><i data-lucide="bell"></i><span>Notifications</span></a></div>
                <div class="nav-item"><a href="admin-message.html" class="nav-link"><i data-lucide="mail"></i><span>Messages</span></a></div>
                <div class="nav-item"><a href="admin-onboarding-config.html" class="nav-link"><i data-lucide="settings"></i><span>Onboarding Config</span></a></div>
                <div class="nav-item"><a href="admin-onboarding-upload.html" class="nav-link"><i data-lucide="upload-cloud"></i><span>Bulk Onboarding</span></a></div>

                <div class="nav-label">ACTIVE UNITS</div>
                <div id="sidebar-active-commands" style="display: flex; flex-direction: column; gap: 4px;"></div>
                <div class="nav-label" style="margin-top: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                    <span>CUSTOM APPS</span>
                    <button onclick="openAppRegistryModal()" style="background: none; border: none; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 2px;" title="App Registry Control Panel">
                        <i data-lucide="settings" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
                <div id="customAppsList" style="display: flex; flex-direction: column; gap: 4px;"></div>
            </nav>

            <div class="sidebar-bottom">
                <div class="nav-item">
                    <a href="#" class="nav-link" id="btnCustom">
                        <i data-lucide="layout"></i>
                        <span>Customize Layout</span>
                    </a>
                </div>
                <div class="nav-item">
                    <a href="admin-settings.html" class="nav-link">
                        <i data-lucide="settings"></i>
                        <span>Settings</span>
                    </a>
                </div>
                <div class="nav-item">
                    <a href="#" class="nav-link" id="logoutBtn" style="color: var(--danger);">
                        <i data-lucide="log-out"></i>
                        <span>Logout</span>
                    </a>
                </div>
            </div>
        </aside>`;

// 1. Generate admin-payroll-disbursement.html
console.log('Generating admin-payroll-disbursement.html...');
let prContent = fs.readFileSync('payroll-disbursement.html', 'utf8');

// Replace title
prContent = prContent.replace('<title>Payroll Disbursement | Kylrx AI HRMS</title>', '<title>Payroll Disbursement | Kylrx AI Super Admin</title>');

// Replace sidebar
const sidebarRegex = /<!-- ── UNIFIED HRMS STRATEGIC SIDEBAR ── -->[\s\S]*?<\/aside>/;
if (!sidebarRegex.test(prContent)) {
    throw new Error('Sidebar marker not found in payroll-disbursement.html');
}
prContent = prContent.replace(sidebarRegex, canonicalAdminSidebar('payroll'));

// Replace breadcrumbs in header
prContent = prContent.replace(
    /<div style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; font-weight: 600; color: var\(--text-muted\); flex: 1;">[\s\S]*?<\/div>/,
    `<div style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); flex: 1;">
                    <a href="admin-dashboard.html" style="color: inherit; text-decoration: none;">Admin Console</a>
                    <span>/</span>
                    <a href="admin-payroll-documents.html" style="color: inherit; text-decoration: none;">Operations</a>
                    <span>/</span>
                    <span style="color: var(--primary); font-weight: 700;">Payroll Disbursement</span>
                </div>`
);

// Replace header links
prContent = prContent.replace("window.location.href='hrms-message.html'", "window.location.href='admin-message.html'");
prContent = prContent.replace("window.location.href='hrms-notification.html'", "window.location.href='admin-notifications.html'");

// Replace script sync
prContent = prContent.replace('<script type="module" src="./hrms-sidebar-sync.js"></script>', '<script type="module" src="./admin-sidebar-sync.js"></script>');

fs.writeFileSync('admin-payroll-disbursement.html', prContent, 'utf8');
console.log('✓ Created admin-payroll-disbursement.html successfully.');

// 2. Generate admin-statutory-compliance.html
console.log('Generating admin-statutory-compliance.html...');
let scContent = fs.readFileSync('statutory-compliance.html', 'utf8');

scContent = scContent.replace('<title>Statutory Compliance Command Hub | Kylrx AI HRMS</title>', '<title>Statutory Compliance Command Hub | Kylrx AI Super Admin</title>');

// Replace sidebar
const scSidebarRegex = /<!-- ── UNIFIED HRMS STRATEGIC SIDEBAR ── -->[\s\S]*?<\/aside>/;
if (!scSidebarRegex.test(scContent)) {
    throw new Error('Sidebar marker not found in statutory-compliance.html');
}
scContent = scContent.replace(scSidebarRegex, canonicalAdminSidebar('compliance'));

// Replace breadcrumbs
scContent = scContent.replace(
    /<div class="flex items-center space-x-2 text-sm font-semibold text-slate-500">[\s\S]*?<\/div>/,
    `<div class="flex items-center space-x-2 text-sm font-semibold text-slate-500">
        <a href="admin-dashboard.html" class="hover:text-blue-600 transition">Admin Console</a>
        <span>/</span>
        <a href="admin-payroll-documents.html" class="hover:text-blue-600 transition">Operations</a>
        <span>/</span>
        <span class="text-slate-900 font-bold bg-slate-100 px-2.5 py-1 rounded-md">Statutory Compliance Hub</span>
      </div>`
);

// In header quick button
scContent = scContent.replace('href="payroll-disbursement.html"', 'href="admin-payroll-disbursement.html"');

// Replace script sync
scContent = scContent.replace('<script type="module" src="./hrms-sidebar-sync.js"></script>', '<script type="module" src="./admin-sidebar-sync.js"></script>');

fs.writeFileSync('admin-statutory-compliance.html', scContent, 'utf8');
console.log('✓ Created admin-statutory-compliance.html successfully.');
