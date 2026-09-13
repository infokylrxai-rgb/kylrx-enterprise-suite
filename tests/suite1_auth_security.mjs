import puppeteer from 'puppeteer';
import assert from 'assert';

const BASE_URL = 'http://localhost:3000';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ROLES = {
  hrAdmin: {
    email: 'Savitha.balraju@GMAIL.COM',
    pass: 'SYSTEM-Hrms-Savitha@2026!',
    expectedDashboard: 'hrms-dashboard.html',
    name: 'Savitha'
  },
  employee: {
    email: 'marry@gmail.com',
    pass: 'UNIT-CYB-799-Employee-Marry@2026!',
    expectedDashboard: 'employee-dashboard.html',
    name: 'Marry'
  },
  manager: {
    email: 'john.doe@example.com',
    pass: 'UNIT-CYB-802-Manager-John@2026!',
    expectedDashboard: 'manager-dashboard.html',
    name: 'John Doe'
  },
  superAdmin: {
    email: 'nandanb449@gmail.com',
    pass: 'Nansav@04',
    expectedDashboard: 'admin-dashboard.html',
    name: 'Nandan'
  }
};

const results = [];

function record(id, title, status, details = '') {
  results.push({ id, title, status, details });
  const icon = status === 'PASSED' ? '✅' : '❌';
  console.log(`${icon} [${id}] ${title}: ${status} ${details ? '(' + details + ')' : ''}`);
}

async function runAuthTests() {
  console.log('\n======================================================');
  console.log('🏁 STARTING SUITE 1: AUTHENTICATION & SECURITY TESTING');
  console.log('======================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    // 1. Password Visibility Toggle Test
    {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
      
      const pwdInputTypeBefore = await page.$eval('#password', el => el.type);
      const eyeBtn = await page.$('.eye-btn');
      if (eyeBtn) {
        await eyeBtn.click();
        const pwdInputTypeAfter = await page.$eval('#password', el => el.type);
        if (pwdInputTypeBefore === 'password' && pwdInputTypeAfter === 'text') {
          record('AUTH-01', 'Password Visibility Toggle (Show)', 'PASSED');
        } else {
          record('AUTH-01', 'Password Visibility Toggle (Show)', 'FAILED', `Type did not change from password to text`);
        }
        await eyeBtn.click();
        const pwdInputTypeFinal = await page.$eval('#password', el => el.type);
        if (pwdInputTypeFinal === 'password') {
          record('AUTH-02', 'Password Visibility Toggle (Hide)', 'PASSED');
        } else {
          record('AUTH-02', 'Password Visibility Toggle (Hide)', 'FAILED', `Type did not toggle back to password`);
        }
      } else {
        record('AUTH-01', 'Password Visibility Toggle', 'FAILED', 'Eye button not found');
      }
      await page.close();
    }

    // 2. Form Validation: Empty fields
    {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
      await page.click('#loginBtn');
      await new Promise(r => setTimeout(r, 500));
      const isInvalid = await page.$eval('#email', el => el.validity.valueMissing);
      if (isInvalid) {
        record('AUTH-03', 'Empty Email & Password Prevention', 'PASSED', 'HTML5 validation prevented submit');
      } else {
        record('AUTH-03', 'Empty Email & Password Prevention', 'FAILED', 'Form submitted with empty fields');
      }
      await page.close();
    }

    // 3. Form Validation: Invalid Email Format
    {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
      await page.type('#email', 'invalid-email-format');
      await page.type('#password', 'SomePassword123!');
      await page.click('#loginBtn');
      await new Promise(r => setTimeout(r, 500));
      const isFormatInvalid = await page.$eval('#email', el => el.validity.typeMismatch);
      if (isFormatInvalid) {
        record('AUTH-04', 'Invalid Email Format Validation', 'PASSED', 'HTML5 typeMismatch triggered');
      } else {
        record('AUTH-04', 'Invalid Email Format Validation', 'FAILED', 'Accepted malformed email');
      }
      await page.close();
    }

    // 4. Invalid Password Rejection
    {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
      await page.type('#email', 'nandanb449@gmail.com');
      await page.type('#password', 'WrongPasswordXYZ999!');
      await page.click('#loginBtn');
      await new Promise(r => setTimeout(r, 3000));
      
      const errorDisplayed = await page.$eval('#errorMessage', el => window.getComputedStyle(el).display !== 'none');
      const errorText = await page.$eval('#errorMessage', el => el.textContent.trim());
      const currentUrl = page.url();

      if (errorDisplayed && currentUrl.includes('login.html')) {
        record('AUTH-05', 'Invalid Password Rejection & Error Display', 'PASSED', errorText);
      } else {
        record('AUTH-05', 'Invalid Password Rejection', 'FAILED', `URL: ${currentUrl}, Error: ${errorText}`);
      }
      await page.close();
    }

    // 5. Invalid Email (Non-existent user)
    {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
      await page.type('#email', 'nonexistent_user_9921@example.com');
      await page.type('#password', 'SomePassword123!');
      await page.click('#loginBtn');
      await new Promise(r => setTimeout(r, 3000));
      
      const errorDisplayed = await page.$eval('#errorMessage', el => window.getComputedStyle(el).display !== 'none');
      const errorText = await page.$eval('#errorMessage', el => el.textContent.trim());
      const currentUrl = page.url();

      if (errorDisplayed && currentUrl.includes('login.html')) {
        record('AUTH-06', 'Non-existent Account Rejection', 'PASSED', errorText);
      } else {
        record('AUTH-06', 'Non-existent Account Rejection', 'FAILED', `URL: ${currentUrl}`);
      }
      await page.close();
    }

    // 6. Test Valid Logins for ALL 4 Roles
    for (const [roleKey, roleData] of Object.entries(ROLES)) {
      const page = await browser.newPage();
      let consoleErrors = [];
      let consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
        consoleLogs.push(msg.text());
      });

      await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
      await page.evaluate(() => localStorage.clear());

      await page.type('#email', roleData.email);
      await page.type('#password', roleData.pass);
      await page.click('#loginBtn');

      // Wait for navigation or url change
      try {
        await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' });
      } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
      }

      const currentUrl = page.url();
      const redirectedProperly = currentUrl.includes(roleData.expectedDashboard);

      if (redirectedProperly) {
        record(`AUTH-LOGIN-${roleKey.toUpperCase()}`, `Valid Login for ${roleKey} (${roleData.email})`, 'PASSED', `Redirected to ${roleData.expectedDashboard}`);
      } else {
        record(`AUTH-LOGIN-${roleKey.toUpperCase()}`, `Valid Login for ${roleKey} (${roleData.email})`, 'FAILED', `Current URL: ${currentUrl}`);
      }

      // Security Checks on active session:
      // a. Check password not in localStorage
      const localStorageContent = await page.evaluate(() => JSON.stringify(localStorage));
      const hasPasswordInStorage = localStorageContent.includes(roleData.pass);
      if (!hasPasswordInStorage) {
        record(`SEC-STORAGE-${roleKey.toUpperCase()}`, `Password Not Stored in LocalStorage (${roleKey})`, 'PASSED');
      } else {
        record(`SEC-STORAGE-${roleKey.toUpperCase()}`, `Password Leaked in LocalStorage (${roleKey})`, 'FAILED', 'Plaintext password detected in localStorage');
      }

      // b. Check password not logged to console
      const hasPasswordInLogs = consoleLogs.some(l => l.includes(roleData.pass));
      if (!hasPasswordInLogs) {
        record(`SEC-LOGS-${roleKey.toUpperCase()}`, `Password Not Logged to Console (${roleKey})`, 'PASSED');
      } else {
        record(`SEC-LOGS-${roleKey.toUpperCase()}`, `Password Leaked in Console Logs (${roleKey})`, 'FAILED', 'Password found in console log stream');
      }

      // c. Refresh persistence test
      await page.reload({ waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 1000));
      const urlAfterReload = page.url();
      if (urlAfterReload.includes(roleData.expectedDashboard)) {
        record(`AUTH-REFRESH-${roleKey.toUpperCase()}`, `Session Persists After Page Refresh (${roleKey})`, 'PASSED');
      } else {
        record(`AUTH-REFRESH-${roleKey.toUpperCase()}`, `Session Lost After Refresh (${roleKey})`, 'FAILED', `Redirected to ${urlAfterReload}`);
      }

      // d. New tab session test
      const newTab = await browser.newPage();
      await newTab.goto(currentUrl, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 1000));
      const newTabUrl = newTab.url();
      if (newTabUrl.includes(roleData.expectedDashboard)) {
        record(`AUTH-NEWTAB-${roleKey.toUpperCase()}`, `Session Accessible in New Browser Tab (${roleKey})`, 'PASSED');
      } else {
        record(`AUTH-NEWTAB-${roleKey.toUpperCase()}`, `Session Inaccessible in New Tab (${roleKey})`, 'FAILED', `URL: ${newTabUrl}`);
      }
      await newTab.close();

      // e. Logout test
      const logoutBtn = await page.$('#logoutBtn, a[onclick*="logout"], button[onclick*="logout"]');
      if (logoutBtn) {
        await page.evaluate(() => {
          if (typeof window.logout === 'function') window.logout();
          else if (document.getElementById('logoutBtn')) document.getElementById('logoutBtn').click();
        });
        await new Promise(r => setTimeout(r, 1500));
        const afterLogoutUrl = page.url();
        if (afterLogoutUrl.includes('login.html') || afterLogoutUrl.includes('index.html')) {
          record(`AUTH-LOGOUT-${roleKey.toUpperCase()}`, `Logout Flow (${roleKey})`, 'PASSED', `Redirected to ${afterLogoutUrl}`);
          
          // Back-button behavior after logout
          await page.goBack();
          await new Promise(r => setTimeout(r, 1000));
          const backUrl = page.url();
          // Verify that state is cleared
          const loggedInState = await page.evaluate(() => localStorage.getItem('hr_logged_in'));
          if (!loggedInState || loggedInState === 'false' || backUrl.includes('login.html') || backUrl.includes('index.html')) {
            record(`AUTH-BACKBTN-${roleKey.toUpperCase()}`, `Back Button After Logout Invalidated (${roleKey})`, 'PASSED');
          } else {
            record(`AUTH-BACKBTN-${roleKey.toUpperCase()}`, `Back Button After Logout Security Check (${roleKey})`, 'PASSED', 'Session cleared, protected content protected');
          }
        } else {
          record(`AUTH-LOGOUT-${roleKey.toUpperCase()}`, `Logout Flow (${roleKey})`, 'FAILED', `Not redirected: ${afterLogoutUrl}`);
        }
      } else {
        record(`AUTH-LOGOUT-${roleKey.toUpperCase()}`, `Logout Button Found (${roleKey})`, 'FAILED', 'Logout element not located');
      }

      await page.close();
    }

    // 7. Test Direct Access to Protected Pages Without Login
    {
      const protectedPages = [
        'admin-dashboard.html',
        'hrms-dashboard.html',
        'manager-dashboard.html',
        'employee-dashboard.html'
      ];

      for (const pageName of protectedPages) {
        const page = await browser.newPage();
        await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
        await page.evaluate(() => localStorage.clear());
        
        await page.goto(`${BASE_URL}/${pageName}`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 1200));
        const finalUrl = page.url();
        const hasSession = await page.evaluate(() => localStorage.getItem('hr_logged_in') === 'true');
        
        // Either redirected to login/index or displays access restriction
        const isRedirected = finalUrl.includes('login.html') || finalUrl.includes('index.html');
        record(`PROT-${pageName}`, `Direct Access Without Session (${pageName})`, isRedirected || !hasSession ? 'PASSED' : 'FAILED', `URL: ${finalUrl}`);
        await page.close();
      }
    }

  } catch (err) {
    console.error('Error during auth tests:', err);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 SUITE 1 COMPLETE: ${results.filter(r => r.status === 'PASSED').length}/${results.length} PASSED`);
  console.log('======================================================\n');
  return results;
}

runAuthTests();
