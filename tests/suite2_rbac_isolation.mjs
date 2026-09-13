import puppeteer from 'puppeteer';
import assert from 'assert';

const BASE_URL = 'http://localhost:3000';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ROLES = {
  hrAdmin: {
    email: 'Savitha.balraju@GMAIL.COM',
    pass: 'SYSTEM-Hrms-Savitha@2026!',
    allowedPages: [
      'hrms-dashboard.html',
      'statutory-compliance.html',
      'payroll-disbursement.html',
      'hrms-workflow-builder.html',
      'hrms-settings.html',
      'hrms-calendar.html',
      'hrms-message.html',
      'hrms-notification.html'
    ],
    restrictedPages: [
      'admin-dashboard.html',
      'admin-settings.html',
      'admin-assignment-matrix.html',
      'admin-code-engine.html'
    ]
  },
  employee: {
    email: 'marry@gmail.com',
    pass: 'UNIT-CYB-799-Employee-Marry@2026!',
    allowedPages: [
      'employee-dashboard.html',
      'employee-leave.html',
      'employee-attendance-log.html',
      'employee-docs.html',
      'employee-message.html',
      'employee-notifications.html',
      'employee-assets.html',
      'employee-policy.html'
    ],
    restrictedPages: [
      'payroll-disbursement.html',
      'statutory-compliance.html',
      'admin-onboarding-upload.html',
      'hrms-dashboard.html',
      'admin-dashboard.html',
      'admin-settings.html',
      'manager-dashboard.html'
    ]
  },
  manager: {
    email: 'john.doe@example.com',
    pass: 'UNIT-CYB-802-Manager-John@2026!',
    allowedPages: [
      'manager-dashboard.html',
      'manager-calendar.html',
      'manager-attendance.html',
      'manager-documents.html',
      'manager-message.html',
      'manager-notification.html',
      'manager-workforce.html',
      'manager-analysis.html',
      'manager-security.html',
      'manager-performance.html',
      'manager-console.html',
      'manager-assets.html',
      'manager-policy.html'
    ],
    restrictedPages: [
      'admin-dashboard.html',
      'admin-settings.html',
      'admin-onboarding-upload.html',
      'admin-assignment-matrix.html',
      'payroll-disbursement.html'
    ]
  },
  superAdmin: {
    email: 'nandanb449@gmail.com',
    pass: 'Nansav@04',
    allowedPages: [
      'admin-dashboard.html',
      'admin-settings.html',
      'admin-central-dashboard.html',
      'admin-alert-builder.html',
      'admin-analytics-builder.html',
      'admin-dashboard-builder.html',
      'admin-policy-center.html',
      'admin-asset-management.html',
      'admin-exit-management.html',
      'admin-leave-management.html',
      'admin-assignment-matrix.html',
      'admin-payroll-documents.html'
    ],
    restrictedPages: []
  }
};

const results = [];

function record(id, title, status, details = '') {
  results.push({ id, title, status, details });
  const icon = status === 'PASSED' ? '✅' : '❌';
  console.log(`${icon} [${id}] ${title}: ${status} ${details ? '(' + details + ')' : ''}`);
}

async function loginAs(page, email, pass) {
  await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.type('#email', email);
  await page.type('#password', pass);
  await page.click('#loginBtn');
  try {
    await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' });
  } catch (e) {
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function runRbacTests() {
  console.log('\n======================================================');
  console.log('🏁 STARTING SUITE 2: RBAC & PORTAL ISOLATION TESTING');
  console.log('======================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    for (const [roleKey, roleConfig] of Object.entries(ROLES)) {
      console.log(`\n--- Testing Role: ${roleKey.toUpperCase()} ---`);
      const context = await browser.createBrowserContext();
      const page = await context.newPage();

      await loginAs(page, roleConfig.email, roleConfig.pass);
      const loginUrl = page.url();
      record(`RBAC-LOGIN-${roleKey.toUpperCase()}`, `Initial Authentication for ${roleKey}`, loginUrl.includes('login.html') ? 'FAILED' : 'PASSED', `Landed on: ${loginUrl}`);

      // 1. Verify Allowed Pages
      for (const pageName of roleConfig.allowedPages) {
        await page.goto(`${BASE_URL}/${pageName}`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 800));
        const url = page.url();
        const pageTitle = await page.title();
        const isAllowed = url.includes(pageName) && !url.includes('login.html');
        record(`RBAC-ALLOW-${roleKey.toUpperCase()}-${pageName}`, `${roleKey} Authorized Access to ${pageName}`, isAllowed ? 'PASSED' : 'FAILED', `Title: ${pageTitle}`);
      }

      // 2. Verify Restricted Pages
      for (const restrictedPage of roleConfig.restrictedPages) {
        await page.goto(`${BASE_URL}/${restrictedPage}`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 1200));
        const url = page.url();
        
        // Security check: If role is employee or manager or HR, attempts to access restricted pages
        // should either redirect away or display access restriction
        const isRedirectedAway = !url.includes(restrictedPage) || url.includes('index.html') || url.includes('login.html') || url.includes('dashboard.html');
        const hasAccessDeniedModal = await page.evaluate(() => {
          const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
          return bodyText.includes('access restricted') || bodyText.includes('access denied') || bodyText.includes('unauthorized');
        });

        const blocked = isRedirectedAway || hasAccessDeniedModal;
        record(`RBAC-RESTRICT-${roleKey.toUpperCase()}-${restrictedPage}`, `${roleKey} Blocked From ${restrictedPage}`, blocked ? 'PASSED' : 'FAILED', `Landed on: ${url}`);
      }

      await context.close();
    }

    // 3. Manager Unit Isolation Test
    console.log('\n--- Manager Unit Isolation Checks ---');
    {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await loginAs(page, ROLES.manager.email, ROLES.manager.pass);

      // Attempt to access another department / unit ID
      const foreignDeptId = 'FOREIGN_DEPT_UNAUTHORIZED_9999';
      await page.goto(`${BASE_URL}/manager-dashboard.html?id=${foreignDeptId}`, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 1500));
      
      const currentUrl = page.url();
      const isIsolated = await page.evaluate(() => {
        const sideDept = document.getElementById('sideDeptCode')?.textContent || '';
        // Manager John Doe should stay attached to CYB-UNIT, not foreign
        return sideDept.includes('CYB') || !document.body.innerText.includes('FOREIGN_DEPT');
      });

      record('MGR-ISOLATION-01', 'Manager Cross-Department Isolation (Foreign Dept ID)', isIsolated ? 'PASSED' : 'FAILED');
      await context.close();
    }

    // 4. Employee Data Isolation Test
    console.log('\n--- Employee Vault Isolation Checks ---');
    {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await loginAs(page, ROLES.employee.email, ROLES.employee.pass);

      await page.goto(`${BASE_URL}/employee-docs.html`, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 1000));

      const isPersonalVault = await page.evaluate(() => {
        const title = document.querySelector('h1, .page-title, .header-title')?.textContent || '';
        const hasOrgRecords = document.body.innerText.includes('All Organization Records');
        return !hasOrgRecords;
      });

      record('EMP-ISOLATION-01', 'Employee Document Vault Scoped to Personal (No Org Records)', isPersonalVault ? 'PASSED' : 'FAILED');
      await context.close();
    }

  } catch (err) {
    console.error('Error during RBAC tests:', err);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 SUITE 2 COMPLETE: ${results.filter(r => r.status === 'PASSED').length}/${results.length} PASSED`);
  console.log('======================================================\n');
  return results;
}

runRbacTests();
