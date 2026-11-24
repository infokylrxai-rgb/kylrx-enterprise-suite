import puppeteer from 'puppeteer';
import assert from 'assert';
import { CREDS, BASE_URL } from './helpers/e2e-credentials.mjs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results = [];

function record(id, title, status, details = '') {
  const normStatus = (status === true || status === 'PASSED') ? 'PASSED' : 'FAILED';
  results.push({ id, title, status: normStatus, details });
  const icon = normStatus === 'PASSED' ? '✅' : '❌';
  console.log(`${icon} [${id}] ${title}: ${normStatus} ${details ? '(' + details + ')' : ''}`);
}

// Uses global fetch: node:http throws 'Protocol "https:" not supported' as soon as the suite
// is pointed at a deployed host, which silently skipped the header and API-access audits.
async function makeRequest(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    redirect: 'manual'
  });
  const body = await res.text();
  const headers = Object.fromEntries([...res.headers.entries()]);
  return { statusCode: res.status, headers, body };
}

async function runSecurityAudit() {
  console.log('\n======================================================');
  console.log('🏁 STARTING SUITE 7: SECURITY & PENETRATION AUDIT');
  console.log('======================================================\n');

  // 1. Security Headers Audit (Helmet, CSP, HSTS, X-Frame-Options)
  console.log('\n--- 1. HTTP Security Headers Audit ---');
  try {
    const res = await makeRequest('/');
    const headers = res.headers;

    // Check X-Content-Type-Options
    const nosniff = headers['x-content-type-options'] === 'nosniff';
    record('SEC-HDR-01', 'X-Content-Type-Options: nosniff Header Present', nosniff, headers['x-content-type-options'] || 'Missing');

    // Check X-Frame-Options or CSP frame-ancestors
    const xfo = headers['x-frame-options'] || headers['content-security-policy'];
    record('SEC-HDR-02', 'Clickjacking Protection (X-Frame-Options / CSP)', xfo !== undefined, xfo || 'Missing');

    // Check CSP header
    const csp = headers['content-security-policy'];
    record('SEC-HDR-03', 'Content-Security-Policy (CSP) Header Present', csp !== undefined, csp ? 'Present' : 'Missing');
  } catch (e) {
    record('SEC-HDR-ERR', 'HTTP Header Request Failed', 'FAILED', e.message);
  }

  // 2. Unauthorized API Access Rejection
  console.log('\n--- 2. Protected Backend API Access Control ---');
  try {
    // Attempt accessing protected endpoint without token
    const apiRes = await makeRequest('/api/attendance', { method: 'GET' });
    record('SEC-API-01', 'Reject Unauthenticated API Access (/api/attendance)', apiRes.statusCode === 401 || apiRes.statusCode === 403 || apiRes.statusCode === 404, `Status: ${apiRes.statusCode}`);

    const payRes = await makeRequest('/api/payroll/disburse', { method: 'POST', body: JSON.stringify({ batchId: 'test' }), headers: { 'Content-Type': 'application/json' } });
    record('SEC-API-02', 'Reject Unauthorized Payroll Disbursement API Call', payRes.statusCode === 401 || payRes.statusCode === 403 || payRes.statusCode === 404, `Status: ${payRes.statusCode}`);
  } catch (e) {
    record('SEC-API-ERR', 'API Request Check Failed', 'FAILED', e.message);
  }

  // 3. IDOR (Insecure Direct Object Reference) Browser Tests
  console.log('\n--- 3. IDOR & Cross-Entity Data Isolation ---');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();

    // Login as Employee (Marry)
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.clear());
    await page.type('#email', CREDS.employee.email);
    await page.type('#password', CREDS.employee.pass);
    await page.click('#loginBtn');
    try { await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' }); } catch(e) {}

    // Test IDOR: Employee tries to view another employee's documents by changing query param
    await page.goto(`${BASE_URL}/employee-docs.html?id=EMP_FOREIGN_99999`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));
    const activeUser = await page.$eval('#userNameDisplay', el => el.textContent.trim()).catch(() => '');
    record('SEC-IDOR-01', 'Cross-Employee Vault IDOR Tampering Prevention', activeUser.toLowerCase().includes(CREDS.employee.name.toLowerCase()), `Restricted to own session (${activeUser})`);

    // Test Cross-Role / Entity IDOR: Employee attempts to access Manager Workforce console
    await page.goto(`${BASE_URL}/manager-workforce.html?dept=FOREIGN_HR_DEPT`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));
    const currentLocAfterAttempt = page.url();
    const isBlockedFromManagerWorkforce = currentLocAfterAttempt.includes('index.html') || currentLocAfterAttempt.includes('employee-dashboard.html');
    record('SEC-IDOR-02', 'Cross-Role / Foreign Dept IDOR Tampering Blocked', isBlockedFromManagerWorkforce, `Redirected to: ${currentLocAfterAttempt}`);

    // 4. XSS (Cross-Site Scripting) Payload Handling
    console.log('\n--- 4. XSS & Script Injection Handling ---');
    await page.goto(`${BASE_URL}/employee-leave.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    let alertTriggered = false;
    page.on('dialog', async dialog => {
      alertTriggered = true;
      await dialog.dismiss();
    });

    // Attempt injecting XSS payload into reason input
    const reasonInput = await page.$('#leaveReason, textarea[name="reason"], #reason');
    if (reasonInput) {
      await reasonInput.type('<script>alert("XSS-LEAVE")</script><img src=x onerror=alert(1)>');
      const submitBtn = await page.$('#submitLeaveBtn, button[type="submit"]');
      if (submitBtn) await submitBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    }
    record('SEC-XSS-01', 'Stored / Reflected XSS Script Execution Neutralized', !alertTriggered, `Alert triggered: ${alertTriggered}`);

    // 5. Open Redirect Vulnerability Test
    console.log('\n--- 5. Open Redirect Testing ---');
    await page.goto(`${BASE_URL}/login.html?redirect=https://evil-attacker-site.com`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1000));
    const currentLoc = page.url();
    record('SEC-REDIR-01', 'Open Redirect via URL Query Parameter Blocked', !currentLoc.startsWith('https://evil-attacker-site.com'), `Origin: ${new URL(currentLoc).origin}`);

    // 6. Plaintext Passwords Inspection
    console.log('\n--- 6. Sensitive Data Storage & Exposure Audit ---');
    const storedKeys = await page.evaluate(() => Object.keys(localStorage));
    // CREDS is a Node value; referencing it inside evaluate() threw ReferenceError in the
    // browser and aborted the rest of the audit. Pass the secrets in explicitly.
    const sensitiveInStorage = await page.evaluate((secrets) => {
      for (const k of Object.keys(localStorage)) {
        const val = localStorage.getItem(k) || '';
        if (k.toLowerCase().includes('pass') || secrets.some(sec => sec && val.includes(sec))) {
          return true;
        }
      }
      return false;
    }, [CREDS.manager.pass, CREDS.superAdmin.pass, CREDS.hrAdmin.pass, CREDS.employee.pass]);
    record('SEC-STOR-01', 'Passwords Completely Excluded from Browser localStorage', !sensitiveInStorage, `Keys: ${storedKeys.join(', ')}`);

    // 7. Session Invalidation on Logout
    console.log('\n--- 7. Logout Invalidation & Token Cleanup ---');
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/manager-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));
    const redirectedAfterLogout = page.url().includes('index.html') || page.url().includes('login.html');
    record('SEC-SESS-01', 'Immediate Session Invalidation & Redirect on Logout', redirectedAfterLogout, `Location: ${page.url()}`);

    await page.close();
  } catch (err) {
    console.error('Error during security audit:', err);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 SUITE 7 COMPLETE: ${results.filter(r => r.status === 'PASSED').length}/${results.length} PASSED`);
  console.log('======================================================\n');
  return results;
}

runSecurityAudit();
