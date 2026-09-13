import fs from 'fs';
import assert from 'assert';

console.log('--- TESTING HRMS USER LOGIN & PROFILE DISPLAY ---');

const hrmsPages = [
    'hrms-dashboard.html',
    'hrms-workflow-builder.html',
    'hrms-settings.html',
    'hrms-calendar.html',
    'hrms-message.html',
    'hrms-notification.html'
];

hrmsPages.forEach(file => {
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(html.includes('class="profile-mini"'), `${file} must contain .profile-mini`);
    assert.ok(html.includes('id="userInitial"'), `${file} must contain #userInitial`);
    assert.ok(html.includes('id="userNameDisplay"'), `${file} must contain #userNameDisplay`);
    assert.ok(html.includes('id="userRoleDisplay"'), `${file} must contain #userRoleDisplay`);
    
    // Assert authoritative name is Savitha Balraju, initials SB, and role Strategic Operations
    assert.ok(html.includes('Savitha Balraju'), `${file} must display 'Savitha Balraju'`);
    assert.ok(html.includes('>SB<'), `${file} must display 'SB' initials`);
    assert.ok(html.includes('Strategic Operations'), `${file} must display 'Strategic Operations'`);
    console.log(`✓ ${file}: .profile-mini, SB initials, Savitha Balraju, and Strategic Operations verified.`);
});

// Verify hrms-dashboard.html specific top profile and welcome elements
const dashHtml = fs.readFileSync('hrms-dashboard.html', 'utf8');
assert.ok(dashHtml.includes('id="topUserAvatar"'), 'hrms-dashboard.html must contain #topUserAvatar');
assert.ok(dashHtml.includes('id="topUserName"'), 'hrms-dashboard.html must contain #topUserName');
assert.ok(dashHtml.includes('id="topUserRole"'), 'hrms-dashboard.html must contain #topUserRole');
assert.ok(dashHtml.includes('id="welcomeUserName"'), 'hrms-dashboard.html must contain #welcomeUserName');
assert.ok(dashHtml.includes('updateHrmsUserProfile'), 'hrms-dashboard.html must define updateHrmsUserProfile');
assert.ok(dashHtml.includes('>SB</div>'), 'hrms-dashboard.html must display SB avatar in header');
assert.ok(dashHtml.includes('Savitha Balraju</span> 👋'), 'hrms-dashboard.html welcome banner must greet Savitha Balraju');
console.log('✓ hrms-dashboard.html: Top profile avatar, username, role, and welcome banner verified.');

// Verify hrms-sidebar-sync.js logic connects and defaults to Savitha Balraju & Strategic Operations
const syncJs = fs.readFileSync('hrms-sidebar-sync.js', 'utf8');
assert.ok(syncJs.includes("'Savitha Balraju'"), "hrms-sidebar-sync.js must default to 'Savitha Balraju'");
assert.ok(syncJs.includes("'Strategic Operations'"), "hrms-sidebar-sync.js must default to 'Strategic Operations'");
assert.ok(syncJs.includes("'SB'"), "hrms-sidebar-sync.js must default initials to 'SB'");
console.log('✓ hrms-sidebar-sync.js: Logic, default initials, and role verified.');

// Verify zero admin links
const allHrmsFiles = fs.readdirSync('.').filter(f => f.startsWith('hrms-') && f.endsWith('.html'));
allHrmsFiles.forEach(f => {
    const c = fs.readFileSync(f, 'utf8');
    const adminMatches = [...c.matchAll(/admin-[a-z0-9_-]+\.html/gi)].map(m => m[0]);
    assert.strictEqual(adminMatches.length, 0, `No admin links allowed in ${f}. Found: ${adminMatches}`);
});
console.log(`✓ All ${allHrmsFiles.length} HRMS pages checked: 0 admin navigation links.`);

console.log('🎉 ALL HRMS PROFILE & NAVIGATION TESTS PASSED!');
