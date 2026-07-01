const fs = require('fs');
const path = require('path');

const filePath = path.join('c:', 'Users', 'Admin', 'OneDrive', 'Desktop', 'product_sprint', 'employee-leave.html');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

lines.forEach((line, idx) => {
    if (line.includes('header') || line.includes('h1')) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});
