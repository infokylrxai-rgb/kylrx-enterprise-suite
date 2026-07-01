const fs = require('fs');
const path = require('path');

const filePath = path.join('c:', 'Users', 'Admin', 'OneDrive', 'Desktop', 'product_sprint', 'employee-attendance-log.html');
const content = fs.readFileSync(filePath, 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('back-btn') || line.includes('page-header')) {
        console.log(`Line ${idx + 1}: ${JSON.stringify(line)}`);
    }
});
