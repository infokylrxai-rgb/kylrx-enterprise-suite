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

const VIEWPORTS = [
  { name: 'Desktop (1920x1080)', width: 1920, height: 1080 },
  { name: 'Laptop (1366x768)', width: 1366, height: 768 },
  { name: 'Tablet (768x1024)', width: 768, height: 1024 },
  { name: 'Mobile (390x844)', width: 390, height: 844 },
  { name: 'Small Mobile (320x568)', width: 320, height: 568 }
];

async function runResponsiveUIUXTests() {
  console.log('\n======================================================');
  console.log('🏁 STARTING SUITE 8: UI/UX & RESPONSIVE DESIGN AUDIT');
  console.log('======================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();

    // 1. Employee Portal Responsive Viewport Tests
    console.log('\n--- 1. Viewport Tests: Employee Dashboard ---');
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.clear());
    await page.type('#email', 'marry@gmail.com');
    await page.type('#password', 'UNIT-CYB-799-Employee-Marry@2026!');
    await page.click('#loginBtn');
    try { await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' }); } catch(e) {}
    await page.goto(`${BASE_URL}/employee-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await new Promise(r => setTimeout(r, 600));

      // Check horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 2;
      });

      record(
        `RESP-EMP-${vp.width}`,
        `Employee Dashboard Layout at ${vp.name}`,
        !hasHorizontalOverflow,
        hasHorizontalOverflow ? 'Horizontal overflow detected' : 'No horizontal overflow'
      );
    }

    // 2. Manager Portal Responsive Viewport Tests
    console.log('\n--- 2. Viewport Tests: Manager Command Center ---');
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.clear());
    await page.type('#email', 'john.doe@example.com');
    await page.type('#password', 'UNIT-CYB-802-Manager-John@2026!');
    await page.click('#loginBtn');
    try { await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' }); } catch(e) {}
    await page.goto(`${BASE_URL}/manager-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await new Promise(r => setTimeout(r, 600));

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 2;
      });

      record(
        `RESP-MGR-${vp.width}`,
        `Manager Dashboard Layout at ${vp.name}`,
        !hasHorizontalOverflow,
        hasHorizontalOverflow ? 'Horizontal overflow detected' : 'No horizontal overflow'
      );
    }

    // 3. Super Admin Dashboard Responsive Viewport Tests
    console.log('\n--- 3. Viewport Tests: Super Admin Dashboard ---');
    await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.clear());
    await page.type('#email', 'nandanb449@gmail.com');
    await page.type('#password', 'Nansav@04');
    await page.click('#loginBtn');
    try { await page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' }); } catch(e) {}
    await page.goto(`${BASE_URL}/admin-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await new Promise(r => setTimeout(r, 600));

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 2;
      });

      record(
        `RESP-ADM-${vp.width}`,
        `Admin Dashboard Layout at ${vp.name}`,
        !hasHorizontalOverflow,
        hasHorizontalOverflow ? 'Horizontal overflow detected' : 'No horizontal overflow'
      );
    }

    // 4. Color Contrast & Theme Verification
    console.log('\n--- 4. UI Theme & Visual Polish Audit ---');
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(`${BASE_URL}/employee-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1000));

    // Check Employee Theme (Rose / Coral primary accent or CSS variables)
    const empPrimaryColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    });
    record('UI-THEME-01', 'Employee Portal Theme Accent Defined', empPrimaryColor.length > 0, `Accent: ${empPrimaryColor}`);

    // Check Modal centering & overlay
    const hasModalOverlayStyles = await page.evaluate(() => {
      const el = document.querySelector('.modal, .modal-overlay, .custom-alert-overlay');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.position === 'fixed' || st.position === 'absolute';
    });
    record('UI-MODAL-01', 'Modals Configured with Fixed Overlays', hasModalOverlayStyles);

    // 5. Typography & Font Smoothing
    console.log('\n--- 5. Typography & Modern Fonts ---');
    const fontFamily = await page.evaluate(() => {
      return getComputedStyle(document.body).fontFamily;
    });
    record('UI-TYPO-01', 'Modern Typography (Outfit / Inter / Sans-Serif)', fontFamily.includes('Outfit') || fontFamily.includes('sans-serif'), `Font: ${fontFamily}`);

    await page.close();
  } catch (err) {
    console.error('Error during UI/UX tests:', err);
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 SUITE 8 COMPLETE: ${results.filter(r => r.status === 'PASSED').length}/${results.length} PASSED`);
  console.log('======================================================\n');
  return results;
}

runResponsiveUIUXTests();
