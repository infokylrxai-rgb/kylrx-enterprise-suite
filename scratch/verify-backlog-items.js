const fs = require('fs');
const path = require('path');

let failed = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`  ✗ ${message}`);
        failed++;
    } else {
        console.log(`  ✓ Passed: ${message}`);
    }
}

console.log('=== Verifying Backlog Adjustments ===\n');

// 1. Verify onboarding-wizard.html
const wizardContent = fs.readFileSync(path.join(__dirname, '../onboarding-wizard.html'), 'utf8');
assert(wizardContent.includes('window.skipUnknownStep = () => {'), 'onboarding-wizard.html has skipUnknownStep function');
assert(wizardContent.includes('onclick="window.skipUnknownStep()"'), 'onboarding-wizard.html has skipUnknownStep onclick trigger');
assert(wizardContent.includes('Unknown Step: "${type}"'), 'onboarding-wizard.html has custom warning fallback layout');

// 2. Verify hrms-dashboard.html
const dashboardContent = fs.readFileSync(path.join(__dirname, '../hrms-dashboard.html'), 'utf8');
assert(dashboardContent.includes('id="uploadErrorPanel"'), 'hrms-dashboard.html has uploadErrorPanel element');
assert(dashboardContent.includes('id="errorDetailsList"'), 'hrms-dashboard.html has errorDetailsList element');
assert(dashboardContent.includes('rowErrors.push("Official Email ID is required.")'), 'hrms-dashboard.html has email validation logic');
assert(dashboardContent.includes('rowErrors.push("Department is required.")'), 'hrms-dashboard.html has department validation logic');
assert(dashboardContent.includes('rowErrors.push("Designation is required.")'), 'hrms-dashboard.html has designation validation logic');

// 3. Verify hrms-message.html
const messageContent = fs.readFileSync(path.join(__dirname, '../hrms-message.html'), 'utf8');
assert(messageContent.includes('name="robots" content="noindex, nofollow"'), 'hrms-message.html has noindex robots tag');
assert(messageContent.includes('name="description"'), 'hrms-message.html has SEO description tag');
assert(messageContent.includes('href="admin-payroll-documents.html"'), 'hrms-message.html links directly to payroll page');
assert(messageContent.includes('href="manager-performance.html"'), 'hrms-message.html links directly to PMS performance page');
assert(messageContent.includes('href="admin-analysis.html"'), 'hrms-message.html links directly to analysis page');
assert(!messageContent.includes('href="hrms-dashboard.html#payroll"'), 'hrms-message.html contains no legacy payroll hash navigation link');

// 4. Verify hrms-notification.html
const notificationContent = fs.readFileSync(path.join(__dirname, '../hrms-notification.html'), 'utf8');
assert(notificationContent.includes('<title>Admin Notifications | Kylrx AI</title>'), 'hrms-notification.html title has been updated to Kylrx AI');
assert(notificationContent.includes('name="robots" content="noindex, nofollow"'), 'hrms-notification.html has noindex robots tag');
assert(notificationContent.includes('name="description"'), 'hrms-notification.html has SEO description tag');
assert(notificationContent.includes('href="admin-payroll-documents.html"'), 'hrms-notification.html links directly to payroll page');
assert(notificationContent.includes('The Kylrx AI enterprise core has been updated'), 'hrms-notification.html brand name updated in core update description');
assert(!notificationContent.includes('href="hrms-dashboard.html#pms"'), 'hrms-notification.html contains no legacy pms hash navigation link');

console.log(`\n=== Verification Results: ${failed === 0 ? "ALL PASSED" : `${failed} FAILED`} ===`);
process.exit(failed > 0 ? 1 : 0);
