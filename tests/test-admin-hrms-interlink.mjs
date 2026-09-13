import fs from 'fs';
import assert from 'assert';

console.log('=== VERIFYING ADMIN AND HRMS TWO-WAY INTERLINKING ===');

// 1. Check admin-sidebar-sync.js
assert.ok(fs.existsSync('admin-sidebar-sync.js'), 'admin-sidebar-sync.js must exist');
const adminSync = fs.readFileSync('admin-sidebar-sync.js', 'utf8');
assert.ok(adminSync.includes('hrms-dashboard.html'), 'admin-sidebar-sync.js must interlink to hrms-dashboard.html');
assert.ok(adminSync.includes('HRMS Strategic Hub'), 'admin-sidebar-sync.js must mention HRMS Strategic Hub');
console.log('✓ admin-sidebar-sync.js: Interlink logic verified.');

// 2. Check hrms-sidebar-sync.js
assert.ok(fs.existsSync('hrms-sidebar-sync.js'), 'hrms-sidebar-sync.js must exist');
const hrmsSync = fs.readFileSync('hrms-sidebar-sync.js', 'utf8');
assert.ok(hrmsSync.includes('admin-dashboard.html'), 'hrms-sidebar-sync.js must interlink to admin-dashboard.html');
assert.ok(hrmsSync.includes('ensureEnterpriseInterlink'), 'hrms-sidebar-sync.js must define ensureEnterpriseInterlink');
console.log('✓ hrms-sidebar-sync.js: Enterprise Admin interlink logic verified.');

// 3. Check Admin HTML files contain interlinks to HRMS and Admin Sidebar Sync
const adminFiles = [
    'admin-dashboard.html',
    'admin-central-dashboard.html',
    'admin-alert-builder.html',
    'admin-analytics-builder.html',
    'admin-dashboard-builder.html',
    'admin-policy-center.html',
    'admin-asset-management.html',
    'admin-exit-management.html',
    'admin-leave-management.html',
    'admin-payroll-documents.html',
    'admin-assignment-matrix.html',
    'admin-payroll-disbursement.html',
    'admin-statutory-compliance.html'
];

adminFiles.forEach(file => {
    assert.ok(fs.existsSync(file), `${file} must exist`);
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('hrms-dashboard.html'), `${file} must link to hrms-dashboard.html`);
    assert.ok(content.includes('admin-sidebar-sync.js'), `${file} must include admin-sidebar-sync.js`);
    console.log(`✓ ${file}: HRMS interlink verified.`);
});

// 4. Verify admin-payroll-documents.html links to admin-payroll-disbursement and admin-statutory-compliance
const pDocs = fs.readFileSync('admin-payroll-documents.html', 'utf8');
assert.ok(pDocs.includes('admin-payroll-disbursement.html'), 'admin-payroll-documents.html must link to admin-payroll-disbursement.html');
assert.ok(pDocs.includes('admin-statutory-compliance.html'), 'admin-payroll-documents.html must link to admin-statutory-compliance.html');
assert.ok(!pDocs.includes('href="payroll-disbursement.html"'), 'admin-payroll-documents.html must not directly link to HRMS payroll disbursement');
assert.ok(!pDocs.includes('href="statutory-compliance.html"'), 'admin-payroll-documents.html must not directly link to HRMS statutory compliance');
console.log('✓ admin-payroll-documents.html: Dedicated admin payroll & statutory links verified.');

console.log('\n🎉 ALL ADMIN AND HRMS INTERLINK CHECKS PASSED SUCCESSFULLY!');
