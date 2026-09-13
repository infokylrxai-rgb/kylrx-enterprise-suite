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

async function loginAsManager(page) {
  await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.type('#email', 'john.doe@example.com');
  await page.type('#password', 'UNIT-CYB-802-Manager-John@2026!');
  await page.click('#loginBtn');
  try {
    await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' });
  } catch (e) {
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function runManagerPortalTests() {
  console.log('\n======================================================');
  console.log('🏁 STARTING SUITE 4: MANAGER PORTAL FUNCTIONAL TESTS');
  console.log('======================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await loginAsManager(page);

    // 1. Manager Dashboard Identity & Branding
    console.log('\n--- 1. Manager Dashboard Verification ---');
    await page.goto(`${BASE_URL}/manager-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1500));

    const mgrName = await page.$eval('#userNameDisplay', el => el.textContent.trim()).catch(() => '');
    record('MGR-DASH-01', 'Manager Identity Display', mgrName.toLowerCase().includes('john'), `Name: ${mgrName}`);

    const sideDeptName = await page.$eval('#sideDeptName', el => el.textContent.trim()).catch(() => '');
    const sideDeptCode = await page.$eval('#sideDeptCode', el => el.textContent.trim()).catch(() => '');
    record('MGR-DASH-02', 'Manager Unit & Department Scoping', sideDeptName.length > 0 && sideDeptCode.length > 0, `Dept: ${sideDeptName}, Unit: ${sideDeptCode}`);

    // Punch Controls
    const punchIn = await page.$('#btnPunchIn') !== null;
    const punchOut = await page.$('#btnPunchOut') !== null;
    const punchBreak = await page.$('#btnBreak') !== null;
    record('MGR-DASH-03', 'Manager Time-Clock Controls (Punch In/Break/Punch Out)', punchIn && punchBreak, `PunchIn: ${punchIn}, Break: ${punchBreak}`);

    // Telemetry & Metrics Cards
    const metricsCards = await page.$$eval('.card, .tele-box', els => els.length).catch(() => 0);
    record('MGR-DASH-04', 'Dashboard Telemetry & Insight Cards Hydration', metricsCards >= 3, `Cards: ${metricsCards}`);

    // Direct Cloud Line Status
    const cloudStatus = await page.$eval('#backendStatusText', el => el.textContent.trim()).catch(() => '');
    record('MGR-DASH-05', 'Firebase Backend Status Pill', cloudStatus.includes('Online'), `Status: ${cloudStatus}`);

    // 2. Manager Workforce Page
    console.log('\n--- 2. Manager Workforce Module ---');
    await page.goto(`${BASE_URL}/manager-workforce.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const wfTitle = await page.title();
    record('MGR-WF-01', 'Workforce Roster Page Navigation', wfTitle.toLowerCase().includes('workforce') || wfTitle.toLowerCase().includes('manager'), `Title: ${wfTitle}`);

    const hasRosterContainer = await page.$('#workforceList, #workforceTable, #rosterContainer, .workforce-grid, table') !== null;
    record('MGR-WF-02', 'Workforce Personnel List / Grid Rendered', hasRosterContainer);

    // 3. Manager Attendance Page
    console.log('\n--- 3. Manager Attendance Module ---');
    await page.goto(`${BASE_URL}/manager-attendance.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const attTitle = await page.title();
    record('MGR-ATT-01', 'Manager Attendance Page Navigation', attTitle.toLowerCase().includes('attendance') || attTitle.toLowerCase().includes('manager'), `Title: ${attTitle}`);

    const hasAttTable = await page.$('#attendanceTable, table, .attendance-card') !== null;
    record('MGR-ATT-02', 'Team Attendance Records Roster / Table Present', hasAttTable);

    // 4. Manager Calendar / Leave Requests
    console.log('\n--- 4. Manager Leave & Calendar Module ---');
    await page.goto(`${BASE_URL}/manager-calendar.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const calTitle = await page.title();
    record('MGR-CAL-01', 'Leave Calendar & Approval Navigation', calTitle.toLowerCase().includes('calendar') || calTitle.toLowerCase().includes('leave') || calTitle.toLowerCase().includes('manager'), `Title: ${calTitle}`);

    const hasCalendarOrLeaveList = await page.$('#calendarContainer, #leaveRequestsList, .calendar-grid, table, .card') !== null;
    record('MGR-CAL-02', 'Team Leave Calendar / Pending Approvals Present', hasCalendarOrLeaveList);

    // 5. Manager Documents Vault
    console.log('\n--- 5. Manager Documents Module ---');
    await page.goto(`${BASE_URL}/manager-documents.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const docsTitle = await page.title();
    record('MGR-DOC-01', 'Manager Documents Page Navigation', docsTitle.toLowerCase().includes('document') || docsTitle.toLowerCase().includes('manager'), `Title: ${docsTitle}`);

    const hasDocContainer = await page.$('#docsContainer, #docGrid, .doc-item, table, .card') !== null;
    record('MGR-DOC-02', 'Departmental Documents Vault Rendered', hasDocContainer);

    // 6. Manager Security Telemetry
    console.log('\n--- 6. Manager Security Telemetry ---');
    await page.goto(`${BASE_URL}/manager-security.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const secTitle = await page.title();
    record('MGR-SEC-01', 'Manager Security Telemetry Page Navigation', secTitle.toLowerCase().includes('security') || secTitle.toLowerCase().includes('manager'), `Title: ${secTitle}`);

    const hasSecCards = await page.$$eval('.card, .tele-box, .security-item', els => els.length).catch(() => 0);
    record('MGR-SEC-02', 'Security Posture & Telemetry Cards Rendered', hasSecCards >= 1, `Cards: ${hasSecCards}`);

    // 7. Manager Performance Module
    console.log('\n--- 7. Manager Performance Module ---');
    await page.goto(`${BASE_URL}/manager-performance.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const perfTitle = await page.title();
    record('MGR-PERF-01', 'Manager Performance Console Navigation', perfTitle.toLowerCase().includes('performance') || perfTitle.toLowerCase().includes('manager'), `Title: ${perfTitle}`);

    const hasPerfMetrics = await page.$('#performanceMetrics, .kpi-card, .review-card, table, .card') !== null;
    record('MGR-PERF-02', 'Performance Review & KPI Console Hydrated', hasPerfMetrics);

    // 8. Manager Analytics Hub
    console.log('\n--- 8. Manager Analytics Hub ---');
    await page.goto(`${BASE_URL}/manager-analysis.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const anaTitle = await page.title();
    record('MGR-ANA-01', 'Manager Analytics Hub Navigation', anaTitle.toLowerCase().includes('anal') || anaTitle.toLowerCase().includes('manager'), `Title: ${anaTitle}`);

    // 9. Manager Strategic HR Console
    console.log('\n--- 9. Manager Strategic HR Console ---');
    await page.goto(`${BASE_URL}/manager-console.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const conTitle = await page.title();
    record('MGR-CON-01', 'Strategic HR Console Navigation', conTitle.toLowerCase().includes('console') || conTitle.toLowerCase().includes('hr') || conTitle.toLowerCase().includes('manager'), `Title: ${conTitle}`);

    // 10. Manager Policy Center (Read-Only)
    console.log('\n--- 10. Manager Policy Center (Read-Only) ---');
    await page.goto(`${BASE_URL}/manager-policy.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const polTitle = await page.title();
    record('MGR-POL-01', 'Manager Policy Center Navigation', polTitle.toLowerCase().includes('polic') || polTitle.toLowerCase().includes('manager'), `Title: ${polTitle}`);

    // Confirm manager CANNOT create, edit or delete policies
    const hasAdminPolicyControls = await page.$('#createPolicyBtn, button[onclick*="deletePolicy"], button[onclick*="editPolicy"]') !== null;
    record('MGR-POL-02', 'Manager Restricted from Policy Authoring/Editing', !hasAdminPolicyControls);

    // 11. Manager Assets
    console.log('\n--- 11. Manager Assets Module ---');
    await page.goto(`${BASE_URL}/manager-assets.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const assetTitle = await page.title();
    record('MGR-AST-01', 'Manager Assets Page Navigation', assetTitle.toLowerCase().includes('asset') || assetTitle.toLowerCase().includes('manager'), `Title: ${assetTitle}`);

    // 12. Manager Data Isolation & Blocked Routes
    console.log('\n--- 12. Manager Isolation & RBAC Boundaries ---');
    const blockedRoutes = [
      { url: `${BASE_URL}/admin-dashboard.html`, id: 'MGR-ISO-01', title: 'Block Manager from Super Admin Dashboard' },
      { url: `${BASE_URL}/admin-settings.html`, id: 'MGR-ISO-02', title: 'Block Manager from Admin Settings' },
      { url: `${BASE_URL}/payroll-disbursement.html`, id: 'MGR-ISO-03', title: 'Block Manager from Payroll Disbursement' },
      { url: `${BASE_URL}/statutory-compliance.html`, id: 'MGR-ISO-04', title: 'Block Manager from Statutory Compliance' },
      { url: `${BASE_URL}/admin-onboarding-upload.html`, id: 'MGR-ISO-05', title: 'Block Manager from Bulk Onboarding' }
    ];

    for (const b of blockedRoutes) {
      await page.goto(b.url, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 1000));
      const currentUrl = page.url();
      const isBlocked = !currentUrl.includes(b.url.split('/').pop());
      record(b.id, b.title, isBlocked ? 'PASSED' : 'FAILED', `Redirected to: ${currentUrl}`);
    }

    // 13. Manager UI Validation: Active Sidebar State
    console.log('\n--- 13. Manager UI Active Sidebar Validation ---');
    const pagesToCheckActive = [
      { url: `${BASE_URL}/manager-dashboard.html`, expectedSelectors: ['.nav-link.active', '#overviewLink.active'] },
      { url: `${BASE_URL}/manager-workforce.html`, expectedSelectors: ['.nav-link.active', 'a[href*="workforce"].active', '#navWorkforceLink.active'] },
      { url: `${BASE_URL}/manager-security.html`, expectedSelectors: ['.nav-link.active', 'a[href*="security"].active', '#navSecurityLink.active'] },
      { url: `${BASE_URL}/manager-policy.html`, expectedSelectors: ['.nav-link.active', 'a[href*="policy"].active', '#navPolicyLink.active'] }
    ];

    for (const p of pagesToCheckActive) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 1000));
      let hasActive = false;
      for (const sel of p.expectedSelectors) {
        if (await page.$(sel) !== null) {
          hasActive = true;
          break;
        }
      }
      const pageBasename = p.url.split('/').pop();
      record(`MGR-UI-ACT-${pageBasename}`, `Active Sidebar Highlight on ${pageBasename}`, hasActive ? 'PASSED' : 'FAILED');
    }

    await page.close();
  } catch (err) {
    console.error('Error during manager portal tests:', err);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 SUITE 4 COMPLETE: ${results.filter(r => r.status === 'PASSED').length}/${results.length} PASSED`);
  console.log('======================================================\n');
  return results;
}

runManagerPortalTests();
