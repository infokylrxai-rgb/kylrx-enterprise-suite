const fs = require('fs');
const files = [
    'admin-dashboard.html',
    'Engineering-Manager-Dashboard.html',
    'Finance-Manager-Dashboard.html',
    'HR-Manager-Dashboard.html',
    'Marketing-Manager-Dashboard.html',
    'hr-employee.html',
    'marketing-employee.html',
    'engineering-employee.html',
    'finance-employee.html'
];

files.forEach(file => {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        if (!content.includes('activity-tracker.js')) {
            content = content.replace('</body>', '    <script type="module" src="activity-tracker.js"></script>\n</body>');
            fs.writeFileSync(file, content);
            console.log(`Updated ${file}`);
        }
    }
});

