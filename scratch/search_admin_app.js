const fs = require('fs');
const content = fs.readFileSync('c:/Users/Admin/OneDrive/Desktop/product_sprint/admin-app.js', 'utf8');

const matches = [];
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('empId') || line.includes('employeeId') || line.includes('reg') || line.includes('users') || line.includes('Table') || line.includes('render')) {
        matches.push(`${idx + 1}: ${line.trim()}`);
    }
});

console.log(matches.slice(0, 100).join('\n'));
