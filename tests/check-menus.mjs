import fs from 'fs';

const files = [
    'hrms-dashboard.html',
    'hrms-workflow-builder.html',
    'hrms-settings.html',
    'hrms-calendar.html',
    'hrms-message.html',
    'hrms-notification.html',
    'payroll-disbursement.html',
    'statutory-compliance.html'
];

files.forEach(f => {
    if (!fs.existsSync(f)) return;
    const c = fs.readFileSync(f, 'utf8');
    const regex = /href=["'](admin-[^"']+)["']/g;
    let match;
    const list = [];
    while ((match = regex.exec(c)) !== null) {
        list.push(match[1]);
    }
    console.log(`${f}: ${list.length} admin links found:`, [...new Set(list)]);
});
