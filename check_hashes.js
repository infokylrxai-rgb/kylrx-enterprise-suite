const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(path.join(__dirname, 'hrms-dashboard.html'), 'utf8');
const hashes = ['upcoming-birthdays', 'bulk-onboarding', 'compliance', 'payroll', 'pms', 'recruitment', 'analytics', 'expenses', 'lifecycle', 'assets', 'org-structure'];
hashes.forEach(h => {
  const hasId = content.includes(`id="${h}"`) || content.includes(`id='${h}'`) || content.includes(`name="${h}"`);
  console.log('#' + h + ': ' + (hasId ? 'FOUND' : 'MISSING!'));
});
