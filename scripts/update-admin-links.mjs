import fs from 'fs';
import path from 'path';

const targetFiles = [
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
    'tvc-dashboard.html',
    'admin-payroll-disbursement.html',
    'admin-statutory-compliance.html'
];

let updatedCount = 0;

targetFiles.forEach(file => {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    content = content.replace(/href=["']payroll-disbursement\.html["']/g, 'href="admin-payroll-disbursement.html"');
    content = content.replace(/href=["']statutory-compliance\.html["']/g, 'href="admin-statutory-compliance.html"');
    content = content.replace(/window\.location\.href\s*=\s*['"]payroll-disbursement\.html['"]/g, "window.location.href='admin-payroll-disbursement.html'");
    content = content.replace(/window\.location\.href\s*=\s*['"]statutory-compliance\.html['"]/g, "window.location.href='admin-statutory-compliance.html'");

    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`✓ Updated links in ${file}`);
        updatedCount++;
    }
});

// Update routes/central-dashboard.js
if (fs.existsSync('routes/central-dashboard.js')) {
    let routeContent = fs.readFileSync('routes/central-dashboard.js', 'utf8');
    if (routeContent.includes("'statutory-compliance.html'")) {
        routeContent = routeContent.replace(/'statutory-compliance\.html'/g, "'admin-statutory-compliance.html'");
        fs.writeFileSync('routes/central-dashboard.js', routeContent, 'utf8');
        console.log("✓ Updated routes/central-dashboard.js");
    }
}

console.log(`\nAll done! Updated ${updatedCount} admin files.`);
