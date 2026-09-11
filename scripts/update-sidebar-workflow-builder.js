const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const pages = [
  'admin-central-dashboard.html',
  'admin-notification-center.html',
  'admin-alert-builder.html',
  'admin-automation-builder.html',
  'admin-assignment-matrix.html',
  'admin-analytics-builder.html',
  'admin-dashboard.html',
  'admin-document-templates.html'
];

for (const page of pages) {
  const filePath = path.join(rootDir, page);
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('admin-workflow-builder.html')) {
    const linkStr = '                    <a href="admin-workflow-builder.html" class="nav-item"><i class="fas fa-project-diagram"></i> Workflow Builder</a>\r\n';
    if (content.includes('admin-automation-builder.html')) {
      content = content.replace(/(<a [^>]*admin-automation-builder\.html[^>]*>[\s\S]*?<\/a>)/, '$1\r\n' + linkStr);
    } else if (content.includes('admin-document-templates.html')) {
      content = content.replace(/(<a [^>]*admin-document-templates\.html)/, linkStr + '$1');
    }
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated', page);
  } else {
    console.log('Already contains link:', page);
  }
}
