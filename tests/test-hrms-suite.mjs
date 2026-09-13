import fs from 'fs';
import assert from 'assert';

console.log('=== VERIFYING FULL HRMS SUITE SIDEBAR NAVIGATION & PROFILE ===');

const suiteFiles = [
    'hrms-dashboard.html',
    'hrms-workflow-builder.html',
    'hrms-settings.html',
    'hrms-calendar.html',
    'hrms-message.html',
    'hrms-notification.html',
    'payroll-disbursement.html',
    'statutory-compliance.html'
];

const requiredNavLinks = [
    'hrms-dashboard.html',
    'bulk-onboarding',
    'compliance',
    'hrms-workflow-builder.html',
    'hrms-calendar.html',
    'payroll',
    'payroll-disbursement.html',
    'statutory-compliance.html',
    'pms',
    'recruitment',
    'analytics',
    'expenses',
    'hrms-message.html',
    'hrms-notification.html',
    'lifecycle',
    'assets',
    'org-structure',
    'hrms-settings.html'
];

suiteFiles.forEach(file => {
    assert.ok(fs.existsSync(file), `File ${file} must exist`);
    const content = fs.readFileSync(file, 'utf8');

    // 1. Zero admin navigation links
    const adminLinkRegex = /(?:href|window\.location\.href)\s*[=:]\s*['"](admin-[a-z0-9_-]+\.html)['"]/gi;
    let match;
    const adminLinks = [];
    while ((match = adminLinkRegex.exec(content)) !== null) {
        adminLinks.push(match[1]);
    }
    assert.strictEqual(adminLinks.length, 0, `No admin links allowed in ${file}. Found: ${JSON.stringify(adminLinks)}`);

    // 2. Profile identity
    assert.ok(content.includes('class="profile-mini"'), `${file} must contain .profile-mini`);
    assert.ok(content.includes('Savitha Balraju'), `${file} must contain 'Savitha Balraju'`);
    assert.ok(content.includes('Strategic Operations'), `${file} must contain 'Strategic Operations'`);
    assert.ok(content.includes('>SB<'), `${file} must contain initials 'SB'`);

    // 3. Complete navigation links in sidebar
    requiredNavLinks.forEach(target => {
        assert.ok(content.includes(target), `${file} sidebar must contain link to ${target}`);
    });

    // 4. hrms-sidebar-sync.js inclusion
    assert.ok(content.includes('hrms-sidebar-sync.js'), `${file} must include hrms-sidebar-sync.js`);

    console.log(`✓ ${file}: All 18 nav items, 0 admin links, SB / Savitha Balraju / Strategic Operations profile verified.`);
});

console.log('\n🎉 ALL HRMS SUITE FILES VERIFIED SUCCESSFULLY!');
