const fs = require('fs');
const files = [
    // Admin portal
    'admin-dashboard.html',
    'admin-dashboard-builder.html',
    // Manager portal
    'manager-dashboard.html',
    'manager-console.html',
    'manager-workforce.html',
    'manager-performance.html',
    'manager-security.html',
    // Employee portal
    'employee-dashboard.html',
    'employee-docs.html',
    'employee-leave.html',
    'employee-message.html',
    'employee-calendar.html',
    // HRMS portal
    'hrms-dashboard.html',
    'hrms-calendar.html'
];

files.forEach(file => {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        if (!content.includes('activity-tracker.js')) {
            content = content.replace('</body>', '    <script type="module" src="activity-tracker.js"></script>\n</body>');
            fs.writeFileSync(file, content);
            console.log(`Updated ${file}`);
        } else {
            console.log(`Skipped ${file} (already patched)`);
        }
    } else {
        console.warn(`File not found: ${file}`);
    }
});

