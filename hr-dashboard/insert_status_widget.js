const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(file => file.endsWith('.html') && file !== 'tvc-dashboard.html' && file !== 'login.html' && file !== 'index.html');

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Check if the file has a closing body tag and doesn't already have the widget
    if (content.includes('</body>') && !content.includes('status-widget.js')) {
        content = content.replace('</body>', '  <script src="status-widget.js"></script>\n</body>');
        fs.writeFileSync(file, content);
        console.log(`Injected status-widget.js into ${file}`);
    }
});

