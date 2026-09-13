import fs from 'fs';
import assert from 'assert';

console.log('=== VERIFYING ADMIN AND HRMS TWO-WAY INTERLINKING & PAYROLL ADMIN ISOLATION ===');

// 1. Check admin-sidebar-sync.js
assert.ok(fs.existsSync('admin-sidebar-sync.js'), 'admin-sidebar-sync.js must exist');
const adminSync = fs.readFileSync('admin-sidebar-sync.js', 'utf8');
assert.ok(adminSync.includes('hrms-dashboard.html'), 'admin-sidebar-sync.js must interlink to hrms-dashboard.html');
assert.ok(adminSync.includes('HRMS Strategic Hub'), 'admin-sidebar-sync.js must mention HRMS Strategic Hub');
assert.ok(adminSync.includes('admin-payroll'), 'admin-sidebar-sync.js must protect admin-payroll pages from HRMS injection');
console.log('✓ admin-sidebar-sync.js: Interlink logic and payroll protection verified.');

// 2. Check hrms-sidebar-sync.js
assert.ok(fs.existsSync('hrms-sidebar-sync.js'), 'hrms-sidebar-sync.js must exist');
const hrmsSync = fs.readFileSync('hrms-sidebar-sync.js', 'utf8');
assert.ok(hrmsSync.includes('admin-dashboard.html'), 'hrms-sidebar-sync.js must interlink to admin-dashboard.html');
assert.ok(hrmsSync.includes('ensureEnterpriseInterlink'), 'hrms-sidebar-sync.js must define ensureEnterpriseInterlink');
console.log('✓ hrms-sidebar-sync.js: Enterprise Admin interlink logic verified.');

// 3. Check Core Admin HTML files contain interlinks to HRMS
const coreAdminFiles = [
    'admin-dashboard.html',
    'admin-central-dashboard.html',
    'admin-alert-builder.html',
    'admin-analytics-builder.html',
    'admin-dashboard-builder.html',
    'admin-policy-center.html',
    'admin-asset-management.html',
    'admin-exit-management.html',
    'admin-leave-management.html',
    'admin-assignment-matrix.html'
];

coreAdminFiles.forEach(file => {
    assert.ok(fs.existsSync(file), `${file} must exist`);
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('hrms-dashboard.html'), `${file} must link to hrms-dashboard.html`);
    console.log(`✓ ${file}: HRMS interlink verified.`);
});

// 4. Verify admin-payroll-documents.html has ZERO navigation to HRMS pages and contains full tabs
const pDocs = fs.readFileSync('admin-payroll-documents.html', 'utf8');
assert.ok(!pDocs.includes('href="hrms-dashboard.html"'), 'admin-payroll-documents.html must not link to hrms-dashboard.html');
assert.ok(!pDocs.includes('href="hrms-settings.html"'), 'admin-payroll-documents.html must not link to hrms-settings.html');
assert.ok(!pDocs.includes('href="payroll-disbursement.html"'), 'admin-payroll-documents.html must not link to HRMS payroll-disbursement.html');
assert.ok(!pDocs.includes('href="statutory-compliance.html"'), 'admin-payroll-documents.html must not link to HRMS statutory-compliance.html');

// Verify all 3 tabs are present in admin page
assert.ok(pDocs.includes('id="tabContentDocs"'), 'admin-payroll-documents.html must contain tabContentDocs');
assert.ok(pDocs.includes('id="tabContentDisbursement"'), 'admin-payroll-documents.html must contain tabContentDisbursement');
assert.ok(pDocs.includes('id="tabContentCompliance"'), 'admin-payroll-documents.html must contain tabContentCompliance');
assert.ok(pDocs.includes('switchPayrollTab'), 'admin-payroll-documents.html must define switchPayrollTab');
console.log('✓ admin-payroll-documents.html: All 3 tabs embedded; zero navigation to HRMS pages verified.');

// 5. Verify admin-payroll-disbursement.html and admin-statutory-compliance.html route to admin-payroll-documents.html
const pDisb = fs.readFileSync('admin-payroll-disbursement.html', 'utf8');
assert.ok(pDisb.includes('admin-payroll-documents.html#disbursement'), 'admin-payroll-disbursement.html must open admin page with #disbursement');
assert.ok(!pDisb.includes('hrms-'), 'admin-payroll-disbursement.html must contain 0 hrms links');

const pComp = fs.readFileSync('admin-statutory-compliance.html', 'utf8');
assert.ok(pComp.includes('admin-payroll-documents.html#compliance'), 'admin-statutory-compliance.html must open admin page with #compliance');
assert.ok(!pComp.includes('hrms-'), 'admin-statutory-compliance.html must contain 0 hrms links');
console.log('✓ admin-payroll-disbursement.html & admin-statutory-compliance.html: Route directly to admin page without HRMS navigation.');

console.log('\n🎉 ALL ADMIN-HRMS CHECKS AND ADMIN PAYROLL ISOLATION VERIFIED SUCCESSFULLY!');
