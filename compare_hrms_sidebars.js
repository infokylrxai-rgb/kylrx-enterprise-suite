const fs = require('fs');
const path = require('path');
const dir = __dirname;
const pages = [
  'hrms-dashboard.html',
  'hrms-calendar.html',
  'hrms-message.html',
  'hrms-notification.html',
  'hrms-settings.html',
  'hrms-workflow-builder.html'
];

pages.forEach(p => {
  const file = path.join(dir, p);
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  const navMatch = content.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  if (navMatch) {
    const links = [...navMatch[1].matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => {
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      return m[1] + ' (' + text + ')';
    });
    console.log('=== ' + p + ' === (' + links.length + ' links)');
    console.log(links.join('\n'));
  } else {
    console.log('=== ' + p + ' === NO NAV FOUND');
  }
});
