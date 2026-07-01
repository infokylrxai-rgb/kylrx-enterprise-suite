const fs = require('fs');
const path = require('path');

const dirPath = 'c:/Users/Admin/OneDrive/Desktop/product_sprint';

const files = [
    'admin-analysis.html',
    'admin-asset-management.html',
    'admin-attendance-monitor.html',
    'admin-bank-approvals.html',
    'admin-bank-transfer.html',
    'admin-conversion-hub.html',
    'admin-dashboard-builder.html',
    'admin-dashboard.html',
    'admin-exit-management.html',
    'admin-hr-console.html',
    'admin-inactivity-monitor.html',
    'admin-leave-management.html',
    'admin-manager-change.html',
    'admin-message.html',
    'admin-notifications.html',
    'admin-onboarding-ai.html',
    'admin-onboarding-config.html',
    'admin-onboarding-upload.html',
    'admin-payroll-documents.html',
    'admin-payroll-upload.html',
    'admin-policy-center.html',
    'admin-settings.html',
    'tvc-dashboard.html'
];

function buildMenu(activeFilename) {
    const items = [
        { href: 'admin-dashboard.html', icon: 'layout', label: 'Admin Console', section: 'MAIN MENU' },
        { href: 'admin-dashboard-builder.html', icon: 'layout-grid', label: 'Enterprise Builder', section: 'MAIN MENU' },
        { href: 'admin-policy-center.html', icon: 'shield-check', label: 'Policy Center', section: 'MAIN MENU' },
        { href: 'admin-asset-management.html', icon: 'monitor', label: 'Asset Mgmt', section: 'MAIN MENU' },
        { href: 'admin-exit-management.html', icon: 'log-out', label: 'Exit Mgmt', section: 'MAIN MENU' },
        
        { href: 'admin-leave-management.html', icon: 'calendar', label: 'Leave Mgmt', section: 'OPERATIONS' },
        { href: 'admin-payroll-documents.html', icon: 'file-text', label: 'Payroll Docs', section: 'OPERATIONS' },
        { href: 'admin-inactivity-monitor.html', icon: 'radar', label: 'Inactivity Radar', section: 'OPERATIONS' },
        
        { href: 'admin-onboarding-ai.html', icon: 'brain', label: 'AI Command Center', section: 'INTELLIGENCE' },
        { href: 'admin-hr-console.html', icon: 'bar-chart-3', label: 'Strategic HR Console', section: 'INTELLIGENCE' },
        { href: 'admin-analysis.html', icon: 'pie-chart', label: 'Analytics Center', section: 'INTELLIGENCE' },
        
        { href: 'admin-manager-change.html', icon: 'git-pull-request', label: 'Manager Change', section: 'APPROVALS & SETTINGS' },
        { href: 'admin-bank-approvals.html', icon: 'check-square', label: 'Bank Verifications', section: 'APPROVALS & SETTINGS' },
        { href: 'admin-bank-transfer.html', icon: 'banknote', label: 'Bank Transfer', section: 'APPROVALS & SETTINGS' },
        { href: 'admin-notifications.html', icon: 'bell', label: 'Notifications', section: 'APPROVALS & SETTINGS' },
        { href: 'admin-message.html', icon: 'mail', label: 'Messages', section: 'APPROVALS & SETTINGS' },
        { href: 'admin-onboarding-config.html', icon: 'settings', label: 'Onboarding Config', section: 'APPROVALS & SETTINGS' },
        { href: 'admin-onboarding-upload.html', icon: 'upload-cloud', label: 'Bulk Onboarding', section: 'APPROVALS & SETTINGS' },
        { href: 'tvc-dashboard.html', icon: 'monitor', label: 'TVC Monitor', section: 'APPROVALS & SETTINGS' }
    ];

    let html = '            <nav class="nav-menu">\n';
    let currentSection = '';

    for (const item of items) {
        if (item.section !== currentSection) {
            currentSection = item.section;
            html += `                <div class="nav-label">${currentSection}</div>\n`;
        }
        const isActive = item.href === activeFilename;
        const activeClass = isActive ? ' active' : '';
        html += `                <div class="nav-item"><a href="${item.href}" class="nav-link${activeClass}"><i data-lucide="${item.icon}"></i><span>${item.label}</span></a></div>\n`;
    }

    html += '\n                <div class="nav-label">ACTIVE UNITS</div>\n';
    html += '                <div id="sidebar-active-commands" style="display: flex; flex-direction: column; gap: 4px;"></div>\n';
    html += '                            <div class="nav-label" style="margin-top: 2rem; display: flex; justify-content: space-between; align-items: center;">\n';
    html += '                    <span>CUSTOM APPS</span>\n';
    html += '                    <button onclick="openAppRegistryModal()" style="background: none; border: none; color: var(--primary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 2px;" title="App Registry Control Panel">\n';
    html += '                        <i data-lucide="settings" style="width: 14px; height: 14px;"></i>\n';
    html += '                    </button>\n';
    html += '                </div>\n';
    html += '                <div id="customAppsList" style="display: flex; flex-direction: column; gap: 4px;"></div>\n';
    html += '            </nav>';

    return html;
}

for (const file of files) {
    const filePath = path.join(dirPath, file);
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping non-existent file: ${file}`);
        continue;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    const navMenuRegex = /<nav class="nav-menu">[\s\S]*?<\/nav>/;
    
    if (navMenuRegex.test(content)) {
        const newMenuHtml = buildMenu(file);
        content = content.replace(navMenuRegex, newMenuHtml);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated sidebar in ${file}`);
    } else {
        console.log(`Could not find <nav class="nav-menu"> in ${file}`);
    }
}
