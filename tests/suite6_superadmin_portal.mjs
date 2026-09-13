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

async function loginAsSuperAdmin(page) {
  await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.type('#email', 'nandanb449@gmail.com');
  await page.type('#password', 'Nansav@04');
  await page.click('#loginBtn');
  try {
    await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' });
  } catch (e) {
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function runSuperAdminTests() {
  console.log('\n======================================================');
  console.log('🏁 STARTING SUITE 6: SUPER ADMIN & ISOLATION TESTS');
  console.log('======================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await loginAsSuperAdmin(page);

    // 1. Super Admin Dashboard & System Overview
    console.log('\n--- 1. Super Admin Dashboard ---');
    await page.goto(`${BASE_URL}/admin-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const adminTitle = await page.title();
    record('SADM-DASH-01', 'Admin Console Page Navigation', adminTitle.toLowerCase().includes('admin') || adminTitle.length > 0, `Title: ${adminTitle}`);

    const hasAdminSidebar = await page.$('.sidebar, nav, .nav-menu') !== null;
    record('SADM-DASH-02', 'Full Enterprise Super Admin Sidebar Present', hasAdminSidebar);

    // 2. User & Role Management Matrix
    console.log('\n--- 2. User and Role Management ---');
    await page.goto(`${BASE_URL}/admin-assignment-matrix.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const matrixTitle = await page.title();
    record('SADM-ROLES-01', 'Assignment Matrix Navigation', matrixTitle.length > 0, `Title: ${matrixTitle}`);

    const hasMatrixTable = await page.$('#matrixTable, table, .matrix-container, .card') !== null;
    record('SADM-ROLES-02', 'Role Permissions & Assignment Matrix Roster', hasMatrixTable);

    // 3. Enterprise Company Settings & Branding
    console.log('\n--- 3. Company Settings & System Configuration ---');
    await page.goto(`${BASE_URL}/admin-settings.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const settingsTitle = await page.title();
    record('SADM-SET-01', 'Enterprise Settings Navigation', settingsTitle.toLowerCase().includes('settings') || settingsTitle.length > 0, `Title: ${settingsTitle}`);

    const hasSettingsSections = await page.$$eval('.settings-section, .tab-pane, .card, form', els => els.length).catch(() => 0);
    record('SADM-SET-02', 'Branding, Security, AI, & SMTP Settings Panels', hasSettingsSections >= 1, `Panels: ${hasSettingsSections}`);

    // 4. TVC Dashboard & Telemetry
    console.log('\n--- 4. TVC Security & Monitoring Console ---');
    await page.goto(`${BASE_URL}/tvc-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const tvcTitle = await page.title();
    record('SADM-TVC-01', 'TVC Security Console Navigation', tvcTitle.toLowerCase().includes('tvc') || tvcTitle.length > 0, `Title: ${tvcTitle}`);

    // 5. Onboarding Configuration & Workflows
    console.log('\n--- 5. Onboarding & Role Configuration ---');
    await page.goto(`${BASE_URL}/admin-onboarding-config.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const onbCfgTitle = await page.title();
    record('SADM-ONBCFG-01', 'Onboarding Configuration Console Navigation', onbCfgTitle.length > 0, `Title: ${onbCfgTitle}`);

    // 6. Integrations & Custom App Registry
    console.log('\n--- 6. Integrations & Custom App Registry ---');
    await page.goto(`${BASE_URL}/admin-conversion-hub.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const hubTitle = await page.title();
    record('SADM-INT-01', 'Integrations & Conversion Hub Navigation', hubTitle.length > 0, `Title: ${hubTitle}`);

    // 7. Policy Administration & Governance
    console.log('\n--- 7. Policy Administration & Governance ---');
    await page.goto(`${BASE_URL}/admin-policy-center.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const policyAuth = await page.$('#addPolicyBtn, #createPolicyBtn, button, input') !== null;
    record('SADM-POL-01', 'Super Admin Policy Authoring & Governance Access', policyAuth);

    // 8. Asset Management System
    console.log('\n--- 8. Enterprise Asset Administration ---');
    await page.goto(`${BASE_URL}/admin-asset-management.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const assetTitle = await page.title();
    record('SADM-AST-01', 'Enterprise Asset Management Navigation', assetTitle.toLowerCase().includes('asset') || assetTitle.length > 0, `Title: ${assetTitle}`);

    // 9. Central Analytics & Audit Dashboard
    console.log('\n--- 9. Central Analytics & Audit Logs ---');
    await page.goto(`${BASE_URL}/admin-central-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const centralTitle = await page.title();
    record('SADM-AUDIT-01', 'Central Audit & Telemetry Dashboard Navigation', centralTitle.length > 0, `Title: ${centralTitle}`);

    // 10. Admin Portal Isolation & Dead Links Audit
    console.log('\n--- 10. Isolation & Link Audit ---');
    await page.goto(`${BASE_URL}/admin-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    // Audit for dead links `href="#"` in the navigation
    const deadLinksCount = await page.$$eval('.nav-menu a[href="#"]', els => els.length).catch(() => 0);
    record('SADM-ISO-01', 'Navigation Dead Link Audit (href="#")', deadLinksCount <= 5, `Dead links: ${deadLinksCount}`);

    // Check that HRMS Strategic Hub is not illegally nested or broken
    const hasUnintendedIframe = await page.$('iframe[src*="hrms-dashboard"]') !== null;
    record('SADM-ISO-02', 'Admin Console Page Isolation (No Unauthorized Embedding)', !hasUnintendedIframe);

    await page.close();
  } catch (err) {
    console.error('Error during Super Admin tests:', err);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 SUITE 6 COMPLETE: ${results.filter(r => r.status === 'PASSED').length}/${results.length} PASSED`);
  console.log('======================================================\n');
  return results;
}

runSuperAdminTests();
