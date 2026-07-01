const fs = require('fs');

const files = [
    'Finance-Manager-Dashboard.html',
    'HR-Manager-Dashboard.html',
    'Marketing-Manager-Dashboard.html'
];

files.forEach(file => {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        // Let's find the Communication label to inject before it
        if (content.includes('<div class="nav-label">Communication</div>') && !content.includes('tvc-dashboard.html')) {
            content = content.replace(
                '<div class="nav-label">Communication</div>',
                '<a href="tvc-dashboard.html" class="nav-item"><i data-lucide="monitor-play" size="20" stroke-width="2.5"></i><span>TVC Monitor</span></a>\n      <div class="nav-label">Communication</div>'
            );
            fs.writeFileSync(file, content);
            console.log(`Updated TVC link in ${file}`);
        }
    }
});

