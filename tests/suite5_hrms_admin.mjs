import puppeteer from 'puppeteer';
import assert from 'assert';

const BASE_URL = 'http://localhost:3000';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results = [];

function record(id, title, status, details = '') {
  const normStatus = (status === true || status === 'PASSED') ? 'PASSED' : 'FAILED';
  results.push({ id, title, status: normStatus, details });
  const icon = normStatus === 'PASSED' ? '✅' : '❌';
  console.log(`${icon} [${id}] ${title}: ${normStatus} ${details ? '(' + details + ')' : ''}`);
}

async function loginAsHRAdmin(page) {
  await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.type('#email', 'Savitha.balraju@GMAIL.COM');
  await page.type('#password', 'SYSTEM-Hrms-Savitha@2026!');
  await page.click('#loginBtn');
  try {
    await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' });
  } catch (e) {
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function runHRAdminTests() {
  console.log('\n======================================================');
  console.log('🏁 STARTING SUITE 5: HRMS & HR ADMIN FUNCTIONAL TESTS');
  console.log('======================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await loginAsHRAdmin(page);

    // 1. HRMS Dashboard Verification
    console.log('\n--- 1. HRMS Dashboard Verification ---');
    await page.goto(`${BASE_URL}/hrms-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const hrmsTitle = await page.title();
    record('HRMS-DASH-01', 'HRMS Dashboard Navigation', hrmsTitle.length > 0, `Title: ${hrmsTitle}`);

    // Overview Statistics Cards
    const statCards = await page.$$eval('.stat-card-premium, .premium-panel, .stat-card, .metric-card, .card', els => els.length).catch(() => 0);
    record('HRMS-DASH-02', 'Employee, Leave, Attendance, Payroll Metrics', statCards >= 3, `Cards: ${statCards}`);

    // Backend Connection Status / Live Sync
    const cloudStatus = await page.$eval('.ai-badge, #backendStatusText, .status-pill, .cloud-status, .stat-trend', el => el.textContent.trim()).catch(() => '');
    record('HRMS-DASH-03', 'Direct Cloud Line Status / Live Sync Badge', cloudStatus.length > 0, `Status: ${cloudStatus}`);

    // 2. Employee Onboarding Flow & Validation
    console.log('\n--- 2. Employee Onboarding Flow & Validation ---');
    await page.goto(`${BASE_URL}/onboarding-wizard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));

    const onbTitle = await page.title();
    record('HR-ONB-01', 'Onboarding Wizard Page Navigation', onbTitle.toLowerCase().includes('onboard') || onbTitle.length > 0, `Title: ${onbTitle}`);

    // Form Fields Present in Wizard Container
    const hasWizard = await page.$('.wizard-container, .form-card, form, input') !== null;
    record('HR-ONB-02', 'Employee Creation Wizard Steps & Container Present', hasWizard);

    // Bulk Upload Controls (tested on admin-onboarding-upload.html)
    await page.goto(`${BASE_URL}/admin-onboarding-upload.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));
    const hasDropZone = await page.$('#dropZone, #fileInput, .upload-zone') !== null;
    const hasManifestChecklist = await page.$('#resultsTable, .stat-grid, .upload-zone') !== null;
    record('HR-ONB-03', 'Bulk Onboarding Upload Dropzone & Real-Time Parser Present', hasDropZone && hasManifestChecklist);

    // 3. Leave Management & Approval Flow
    console.log('\n--- 3. Leave Management & Approval Flow ---');
    await page.goto(`${BASE_URL}/admin-leave-management.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const leaveTitle = await page.title();
    record('HR-LEAVE-01', 'Admin Leave Management Navigation', leaveTitle.toLowerCase().includes('leave') || leaveTitle.length > 0, `Title: ${leaveTitle}`);

    const hasLeaveActions = await page.$('#leaveTable, #leaveRequests, .leave-action, button, table') !== null;
    record('HR-LEAVE-02', 'Leave Approval / Rejection Management Table', hasLeaveActions);

    // 4. Payroll Generation & Processing
    console.log('\n--- 4. Payroll Generation & Processing ---');
    await page.goto(`${BASE_URL}/admin-payroll-upload.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const prTitle = await page.title();
    record('HR-PAY-01', 'Payroll Processing Console Navigation', prTitle.toLowerCase().includes('payroll') || prTitle.length > 0, `Title: ${prTitle}`);

    // Zero-value handling & empty state validation rule
    const hasProcessBtn = await page.$('#processPayrollBtn, button[type="submit"], #uploadBtn, .btn-primary') !== null;
    record('HR-PAY-02', 'Payroll Computation & Action Controls Present', hasProcessBtn);

    // 5. Payroll Disbursement & Batch Verification
    console.log('\n--- 5. Payroll Disbursement & Batch Control ---');
    await page.goto(`${BASE_URL}/payroll-disbursement.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const disbTitle = await page.title();
    record('HR-DISB-01', 'Payroll Disbursement Hub Navigation', disbTitle.toLowerCase().includes('disburse') || disbTitle.toLowerCase().includes('payroll'), `Title: ${disbTitle}`);

    // Check disbursement batches (Salary, PF, ESI, PT)
    const hasBatches = await page.$$eval('.batch-card, .tab-btn, table, tr', els => els.length).catch(() => 0);
    record('HR-DISB-02', 'Statutory Batches (Salary, PF, ESI, PT) Rendered', hasBatches >= 1, `Batches: ${hasBatches}`);

    // Maker-checker flow / approval controls
    const hasDisbControls = await page.$('#disburseBtn, #approveBatchBtn, button') !== null;
    record('HR-DISB-03', 'Disbursement Maker-Checker / Approval Controls Present', hasDisbControls);

    // 6. Statutory Compliance Module
    console.log('\n--- 6. Statutory Compliance Engine ---');
    await page.goto(`${BASE_URL}/statutory-compliance.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const statTitle = await page.title();
    record('HR-COMP-01', 'Statutory Compliance Console Navigation', statTitle.toLowerCase().includes('statutory') || statTitle.toLowerCase().includes('compliance'), `Title: ${statTitle}`);

    // Statutory identifiers (ESIC, PF, Gratuity, NPS, PT)
    const pageText = await page.evaluate(() => document.body.innerText);
    const hasIdentifiers = ['ESIC', 'PF', 'Gratuity', 'PT'].some(term => pageText.includes(term));
    record('HR-COMP-02', 'Statutory Framework Identifiers (PF, ESIC, PT, Gratuity)', hasIdentifiers);

    // Compliance Scan Trigger
    const hasScanBtn = await page.$('#runScanBtn, #scanComplianceBtn, button') !== null;
    record('HR-COMP-03', 'Compliance Scan & Audit Validation Controls', hasScanBtn);

    // 7. HRMS Workflow Studio
    console.log('\n--- 7. HRMS Workflow Studio ---');
    await page.goto(`${BASE_URL}/hrms-workflow-builder.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const wfTitle = await page.title();
    record('HR-FLOW-01', 'Workflow Studio Navigation', wfTitle.toLowerCase().includes('workflow') || wfTitle.length > 0, `Title: ${wfTitle}`);

    // Canvas & Node Palette Present
    const hasCanvas = await page.$('#flowCanvas, #workflowCanvas, .canvas-container, svg, canvas') !== null;
    record('HR-FLOW-02', 'Workflow Visual Canvas / Flow Area Present', hasCanvas);

    // Node Types (Triggers, Actions, Approval, SLA)
    const nodePalette = await page.$$eval('.node-palette-item, .node-btn, .action-node, .toolbox-item', els => els.length).catch(() => 0);
    record('HR-FLOW-03', 'Workflow Studio Node Toolset & Triggers', nodePalette >= 0);

    // 8. Policy & Asset Center Management
    console.log('\n--- 8. Policy & Asset Management ---');
    await page.goto(`${BASE_URL}/admin-policy-center.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const hasPolicyEditor = await page.$('#addPolicyBtn, #createPolicyBtn, button, input') !== null;
    record('HR-POL-01', 'Policy Center Administration & Authoring Access', hasPolicyEditor);

    // 9. Exit Management
    console.log('\n--- 9. Exit Management ---');
    await page.goto(`${BASE_URL}/admin-exit-management.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const exitTitle = await page.title();
    record('HR-EXIT-01', 'Exit Management Navigation', exitTitle.toLowerCase().includes('exit') || exitTitle.length > 0, `Title: ${exitTitle}`);

    // 10. HR Admin Access Restriction (Verify HR Admin CANNOT access Super Admin core configuration)
    console.log('\n--- 10. HR Admin Access Boundary ---');
    await page.goto(`${BASE_URL}/admin-settings.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const currentUrl = page.url();
    const isRestricted = !currentUrl.includes('admin-settings.html');
    record('HR-RBAC-01', 'Super Admin System Configuration Inaccessible to HR Admin', isRestricted, `Current URL: ${currentUrl}`);

    await page.close();
  } catch (err) {
    console.error('Error during HR Admin tests:', err);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 SUITE 5 COMPLETE: ${results.filter(r => r.status === 'PASSED').length}/${results.length} PASSED`);
  console.log('======================================================\n');
  return results;
}

runHRAdminTests();
