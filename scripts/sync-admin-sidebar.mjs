import fs from 'fs';
import path from 'path';

const adminFiles = [
  'admin-alert-builder.html',
  'admin-analysis.html',
  'admin-analytics-builder.html',
  'admin-asset-management.html',
  'admin-assignment-matrix.html',
  'admin-attendance-monitor.html',
  'admin-automation-builder.html',
  'admin-bank-approvals.html',
  'admin-bank-transfer.html',
  'admin-central-dashboard.html',
  'admin-conversion-hub.html',
  'admin-dashboard-builder.html',
  'admin-dashboard.html',
  'admin-exit-management.html',
  'admin-hr-console.html',
  'admin-inactivity-monitor.html',
  'admin-leave-management.html',
  'admin-manager-change.html',
  'admin-message.html',
  'admin-notification-center.html',
  'admin-notifications.html',
  'admin-onboarding-ai.html',
  'admin-onboarding-config.html',
  'admin-onboarding-upload.html',
  'admin-payroll-documents.html',
  'admin-payroll-upload.html',
  'admin-policy-center.html',
  'admin-settings.html',
  'admin-workflow-builder.html',
  'operational-dashboard.html',
  'tvc-dashboard.html'
];

function generateSidebar(currentFile) {
  const isAct = (file) => (currentFile === file ? ' active' : '');
  const isSettingsActive = currentFile === 'admin-settings.html' ? ' active' : '';
  const isBuilderActive = currentFile === 'admin-dashboard-builder.html' ? ' active' : '';

  return `        <!-- Sidebar Navigation -->
        <aside class="sidebar">
            <a href="admin-dashboard.html" class="logo">
                <img src="logo.jpg" alt="Logo" style="height: 36px; object-fit: contain; border-radius: 8px;">
                <span class="logo-text">Kylrx <span style="color: var(--primary);">AI</span></span>
            </a>
            
            <nav class="nav-menu">
                <div class="nav-label">MAIN MENU</div>
                <div class="nav-item"><a href="admin-central-dashboard.html" class="nav-link${isAct('admin-central-dashboard.html')}"><i data-lucide="command"></i><span>Command Center</span></a></div>
                <div class="nav-item"><a href="admin-dashboard.html" class="nav-link${isAct('admin-dashboard.html')}"><i data-lucide="shield-check"></i><span>Super Admin Console</span></a></div>
                <div class="nav-item"><a href="admin-notification-center.html" class="nav-link${isAct('admin-notification-center.html')}"><i data-lucide="bell"></i><span>Notification & Actions</span></a></div>
                <div class="nav-item"><a href="admin-automation-builder.html" class="nav-link${isAct('admin-automation-builder.html')}"><i data-lucide="git-merge"></i><span>Automation Builder</span></a></div>
                <div class="nav-item"><a href="admin-workflow-builder.html" class="nav-link${isAct('admin-workflow-builder.html')}"><i data-lucide="workflow"></i><span>Workflow Builder</span></a></div>
                <div class="nav-item"><a href="admin-assignment-matrix.html" class="nav-link${isAct('admin-assignment-matrix.html')}"><i data-lucide="layers"></i><span>Assignment Hub</span></a></div>
                <div class="nav-item"><a href="admin-alert-builder.html" class="nav-link${isAct('admin-alert-builder.html')}"><i data-lucide="bell-ring"></i><span>Alert Builder</span></a></div>
                <div class="nav-item"><a href="admin-analytics-builder.html" class="nav-link${isAct('admin-analytics-builder.html')}"><i data-lucide="bar-chart-2"></i><span>Analytics Builder</span></a></div>
                <div class="nav-item"><a href="admin-dashboard-builder.html" class="nav-link${isBuilderActive}"><i data-lucide="layout-grid"></i><span>Enterprise Builder</span></a></div>
                <div class="nav-item"><a href="admin-policy-center.html" class="nav-link${isAct('admin-policy-center.html')}"><i data-lucide="shield-check"></i><span>Policy Center</span></a></div>
                <div class="nav-item"><a href="admin-asset-management.html" class="nav-link${isAct('admin-asset-management.html')}"><i data-lucide="monitor"></i><span>Asset Mgmt</span></a></div>
                <div class="nav-item"><a href="admin-exit-management.html" class="nav-link${isAct('admin-exit-management.html')}"><i data-lucide="log-out"></i><span>Exit Mgmt</span></a></div>

                <div class="nav-label">OPERATIONS</div>
                <div class="nav-item"><a href="admin-attendance-monitor.html" class="nav-link${isAct('admin-attendance-monitor.html')}"><i data-lucide="clock"></i><span>Attendance Monitor</span></a></div>
                <div class="nav-item"><a href="admin-leave-management.html" class="nav-link${isAct('admin-leave-management.html')}"><i data-lucide="calendar"></i><span>Leave Mgmt</span></a></div>
                <div class="nav-item"><a href="admin-document-templates.html" class="nav-link${isAct('admin-document-templates.html')}"><i data-lucide="file-text"></i><span>Document Templates</span></a></div>
                <div class="nav-item"><a href="admin-payroll-documents.html" class="nav-link${isAct('admin-payroll-documents.html')}"><i data-lucide="file-text"></i><span>Payroll Docs</span></a></div>
                <div class="nav-item"><a href="admin-payroll-upload.html" class="nav-link${isAct('admin-payroll-upload.html')}"><i data-lucide="upload"></i><span>Finance Payroll Upload</span></a></div>
                <div class="nav-item"><a href="admin-payroll-disbursement.html" class="nav-link${isAct('admin-payroll-disbursement.html')}"><i data-lucide="credit-card"></i><span>Payroll Disbursement</span></a></div>
                <div class="nav-item"><a href="admin-statutory-compliance.html" class="nav-link${isAct('admin-statutory-compliance.html')}"><i data-lucide="scale"></i><span>Statutory Compliance</span></a></div>
                <div class="nav-item"><a href="admin-inactivity-monitor.html" class="nav-link${isAct('admin-inactivity-monitor.html')}"><i data-lucide="radar"></i><span>Inactivity Radar</span></a></div>

                <div class="nav-label">INTELLIGENCE</div>
                <div class="nav-item"><a href="admin-onboarding-ai.html" class="nav-link${isAct('admin-onboarding-ai.html')}"><i data-lucide="brain"></i><span>AI Command Center</span></a></div>
                <div class="nav-item"><a href="admin-hr-console.html" class="nav-link${isAct('admin-hr-console.html')}"><i data-lucide="bar-chart-3"></i><span>Strategic HR Console</span></a></div>
                <div class="nav-item"><a href="admin-analysis.html" class="nav-link${isAct('admin-analysis.html')}"><i data-lucide="pie-chart"></i><span>Analytics Center</span></a></div>
                <div class="nav-item"><a href="operational-dashboard.html" class="nav-link${isAct('operational-dashboard.html')}"><i data-lucide="bar-chart-2"></i><span>Operational Reports</span></a></div>
                <div class="nav-item"><a href="tvc-dashboard.html" class="nav-link${isAct('tvc-dashboard.html')}"><i data-lucide="monitor"></i><span>TVC Workforce Monitor</span></a></div>

                <div class="nav-label">GOVERNANCE & APPROVALS</div>
                <div class="nav-item"><a href="admin-manager-change.html" class="nav-link${isAct('admin-manager-change.html')}"><i data-lucide="git-pull-request"></i><span>Manager Governance</span></a></div>
                <div class="nav-item"><a href="admin-bank-approvals.html" class="nav-link${isAct('admin-bank-approvals.html')}"><i data-lucide="check-square"></i><span>Bank Verifications</span></a></div>
                <div class="nav-item"><a href="admin-bank-transfer.html" class="nav-link${isAct('admin-bank-transfer.html')}"><i data-lucide="send"></i><span>Bank Transfer</span></a></div>
                <div class="nav-item"><a href="admin-conversion-hub.html" class="nav-link${isAct('admin-conversion-hub.html')}"><i data-lucide="repeat"></i><span>Lifecycle Conversion</span></a></div>
                <div class="nav-item"><a href="admin-notifications.html" class="nav-link${isAct('admin-notifications.html')}"><i data-lucide="bell"></i><span>Notifications</span></a></div>
                <div class="nav-item"><a href="admin-message.html" class="nav-link${isAct('admin-message.html')}"><i data-lucide="mail"></i><span>Messages</span></a></div>
                <div class="nav-item"><a href="admin-onboarding-config.html" class="nav-link${isAct('admin-onboarding-config.html')}"><i data-lucide="settings"></i><span>Onboarding Config</span></a></div>
                <div class="nav-item"><a href="admin-onboarding-upload.html" class="nav-link${isAct('admin-onboarding-upload.html')}"><i data-lucide="upload-cloud"></i><span>Bulk Onboarding</span></a></div>

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
                    <a href="admin-dashboard-builder.html" class="nav-link" id="btnCustom">
                        <i data-lucide="layout"></i>
                        <span>Customize Layout</span>
                    </a>
                </div>
                <div class="nav-item">
                    <a href="admin-settings.html" class="nav-link${isSettingsActive}">
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
}

const customAppsModalHTML = `
    <!-- Custom App Registry Modal -->
    <div id="customAppsModal" class="modal-overlay">
        <style>
            #customAppsModal.modal-overlay {
                position: fixed;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(15, 23, 42, 0.4);
                backdrop-filter: blur(8px);
                z-index: 9999;
                display: none;
                align-items: center;
                justify-content: center;
            }
            #customAppsModal .modal {
                background: #ffffff !important;
                color: #0f172a !important;
                padding: 2.5rem;
                border-radius: 24px;
                width: 90%;
                max-width: 500px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                border: 1px solid #e2e8f0;
                position: relative;
                text-align: left;
            }
            #customAppsModal .modal h2 {
                font-weight: 800;
                font-size: 1.25rem;
                color: #0f172a !important;
                margin-bottom: 4px;
                margin-top: 0;
            }
            #customAppsModal .modal p {
                font-size: 0.75rem;
                color: #64748b !important;
                margin: 0;
            }
            #customAppsModal .modal .form-group {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 1rem;
            }
            #customAppsModal .modal label {
                font-size: 0.7rem;
                font-weight: 800;
                color: #64748b !important;
                text-transform: uppercase;
                display: block;
                margin-bottom: 4px;
            }
            #customAppsModal .modal input {
                width: 100%;
                padding: 12px 16px;
                border-radius: 12px;
                border: 1px solid #cbd5e1 !important;
                background: #ffffff !important;
                color: #0f172a !important;
                outline: none;
                margin-top: 4px;
                font-family: inherit;
                font-size: 0.85rem;
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            #customAppsModal .modal input:focus {
                border-color: #3b82f6 !important;
                box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12);
            }
            #customAppsModal .modal input::placeholder {
                color: #94a3b8 !important;
                opacity: 0.8;
            }
            #customAppsModal .modal button.map-btn {
                background: #3b82f6;
                color: white !important;
                border: none;
                border-radius: 12px;
                padding: 14px;
                font-weight: 800;
                cursor: pointer;
                transition: 0.2s;
                text-align: center;
                width: 100%;
                font-size: 0.9rem;
                margin-top: 0.5rem;
            }
            #customAppsModal .modal button.map-btn:hover {
                background: #2563eb;
                transform: translateY(-1px);
            }
            #customAppsModal .modal h3 {
                font-size: 0.7rem;
                font-weight: 800;
                color: #64748b !important;
                text-transform: uppercase;
                margin-bottom: 10px;
                margin-top: 0;
            }
            #customAppsModal .close-modal {
                position: absolute;
                top: 24px;
                right: 24px;
                width: 36px;
                height: 36px;
                border-radius: 10px;
                background: #f8fafc;
                color: #64748b !important;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: 0.2s;
                border: none;
            }
            #customAppsModal .close-modal:hover {
                color: #ef4444 !important;
                background: #fee2e2;
            }
        </style>
        <div class="modal">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <div>
                    <h2>Custom App Registry</h2>
                    <p>Custom-map external tools in real time to the sidebar</p>
                </div>
                <button class="close-modal" onclick="document.getElementById('customAppsModal').style.display='none'"><i data-lucide="x"></i></button>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
                <div class="form-group">
                    <label>Tool/App Name</label>
                    <input type="text" id="appNameInput" placeholder="e.g. AWS Console">
                </div>
                <div class="form-group">
                    <label>External Link (URL)</label>
                    <input type="text" id="appUrlInput" placeholder="e.g. console.aws.amazon.com">
                </div>
                <button class="map-btn" onclick="addCustomApp()">Map Tool Link</button>
            </div>

            <div style="border-top: 1px solid #e2e8f0; padding-top: 1.25rem;">
                <h3>Mapped Connections</h3>
                <div id="registryAppsList" style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto;">
                    <!-- Mapped apps inside the registry panel -->
                </div>
            </div>
        </div>
    </div>
`;

let updatedCount = 0;

for (const file of adminFiles) {
  let content = fs.readFileSync(file, 'utf8');

  // 1. Replace <aside class="sidebar..."> ... </aside>
  const startIdx = content.search(/<aside\s+class=["']sidebar/i);
  const endIdx = content.indexOf('</aside>', startIdx);
  if (startIdx === -1 || endIdx === -1) {
    console.error(`Skipping ${file}: Could not find aside boundaries`);
    continue;
  }

  const newSidebar = generateSidebar(file);
  content = content.slice(0, startIdx) + newSidebar + content.slice(endIdx + 8);

  // 2. Ensure customAppsModal is present
  if (!content.includes('id="customAppsModal"')) {
    const bodyEnd = content.lastIndexOf('</body>');
    if (bodyEnd !== -1) {
      content = content.slice(0, bodyEnd) + customAppsModalHTML + '\n' + content.slice(bodyEnd);
    }
  }

  // 3. Ensure admin-sidebar-sync.js is included
  if (!content.includes('admin-sidebar-sync.js')) {
    const bodyEnd = content.lastIndexOf('</body>');
    if (bodyEnd !== -1) {
      content = content.slice(0, bodyEnd) + '<script type="module" src="./admin-sidebar-sync.js"></script>\n' + content.slice(bodyEnd);
    }
  }

  fs.writeFileSync(file, content, 'utf8');
  updatedCount++;
  console.log(`Synchronized: ${file}`);
}

console.log(`\nSuccessfully synchronized all ${updatedCount} admin files!`);
