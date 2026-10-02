const fs = require('fs');
const path = require('path');

const hrmsFiles = [
    'hrms-dashboard.html',
    'hrms-calendar.html',
    'hrms-message.html',
    'hrms-notification.html',
    'hrms-settings.html',
    'hrms-workflow-builder.html'
];

const scriptTag = '    <script src="sidebar-scrollbar.js"></script>';
const results = [];

hrmsFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
        results.push({ file, status: 'SKIPPED (not found)' });
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Skip if already injected
    if (content.includes('sidebar-scrollbar.js')) {
        results.push({ file, status: 'ALREADY INJECTED' });
        return;
    }

    // Inject before </body>
    const bodyClose = content.lastIndexOf('</body>');
    if (bodyClose === -1) {
        results.push({ file, status: 'ERROR: </body> not found' });
        return;
    }

    content = content.slice(0, bodyClose) + scriptTag + '\n' + content.slice(bodyClose);
    fs.writeFileSync(filePath, content, 'utf8');
    results.push({ file, status: 'INJECTED' });
});

console.log('\n=== HRMS Sidebar Scrollbar Injection Results ===');
results.forEach(r => console.log(`  ${r.status.padEnd(20)} ${r.file}`));
console.log('\nDone.');
