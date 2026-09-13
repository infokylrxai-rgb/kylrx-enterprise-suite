import fs from 'fs';
import assert from 'assert';

console.log('--- RUNNING HRMS NAVIGATION & SUITE ISOLATION TESTS ---');

// 1. Verify hrms-dashboard.html
const dashContent = fs.readFileSync('hrms-dashboard.html', 'utf8');
assert.ok(dashContent.includes('href="hrms-workflow-builder.html"'), 'hrms-dashboard.html must link to hrms-workflow-builder.html');
assert.ok(dashContent.includes('href="hrms-settings.html"'), 'hrms-dashboard.html must link to hrms-settings.html');
assert.ok(!dashContent.includes('admin-workflow-builder.html'), 'hrms-dashboard.html must not link to admin-workflow-builder.html');
assert.ok(!dashContent.includes('admin-settings.html'), 'hrms-dashboard.html must not link to admin-settings.html');
console.log('✓ hrms-dashboard.html verified: Banner & sidebar point strictly to HRMS pages.');

// 2. Verify hrms-workflow-builder.html
const wfContent = fs.readFileSync('hrms-workflow-builder.html', 'utf8');
assert.ok(wfContent.includes('hrms-dashboard.html'), 'hrms-workflow-builder.html must link to hrms-dashboard.html');
assert.ok(wfContent.includes('hrms-workflow-builder.js'), 'hrms-workflow-builder.html must load hrms-workflow-builder.js');
assert.ok(!wfContent.includes('admin-dashboard.html'), 'hrms-workflow-builder.html must not link to admin-dashboard.html');
assert.ok(!wfContent.includes('admin-central-dashboard.html'), 'hrms-workflow-builder.html must not link to admin-central-dashboard.html');
assert.ok(!wfContent.includes('admin-settings.html'), 'hrms-workflow-builder.html must not link to admin-settings.html');
console.log('✓ hrms-workflow-builder.html verified: Fully isolated with HRMS navigation.');

// 3. Verify hrms-settings.html
const settingsContent = fs.readFileSync('hrms-settings.html', 'utf8');
assert.ok(settingsContent.includes('hrms-dashboard.html'), 'hrms-settings.html must link to hrms-dashboard.html');
assert.ok(settingsContent.includes('hrms-workflow-builder.html'), 'hrms-settings.html must link to hrms-workflow-builder.html');
assert.ok(settingsContent.includes('Configure Once'), 'hrms-settings.html must include Configure Once');
assert.ok(settingsContent.includes('Automate Everything'), 'hrms-settings.html must include Automate Everything');
assert.ok(settingsContent.includes('Track Everything'), 'hrms-settings.html must include Track Everything');
assert.ok(settingsContent.includes('Preserve History'), 'hrms-settings.html must include Preserve History');
assert.ok(!settingsContent.includes('admin-dashboard.html'), 'hrms-settings.html must not link to admin-dashboard.html');
assert.ok(!settingsContent.includes('admin-settings.html'), 'hrms-settings.html must not link to admin-settings.html');
console.log('✓ hrms-settings.html verified: 4 Pillars active, tenant role isolation confirmed.');

// 4. Suite-wide check across all hrms-*.html files
const hrmsFiles = fs.readdirSync('.').filter(f => f.startsWith('hrms-') && f.endsWith('.html'));
hrmsFiles.forEach(f => {
    const c = fs.readFileSync(f, 'utf8');
    const adminLinks = [...c.matchAll(/admin-[a-z0-9_-]+\.html/gi)].map(m => m[0]);
    assert.strictEqual(adminLinks.length, 0, `File ${f} must not contain admin links. Found: ${adminLinks.join(', ')}`);
});
console.log(`✓ Suite-wide check verified: 0 admin links found across ${hrmsFiles.length} HRMS files.`);
console.log('🎉 ALL HRMS SUITE INTEGRATION & ISOLATION TESTS PASSED!');
