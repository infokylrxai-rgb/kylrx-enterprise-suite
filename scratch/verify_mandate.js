const puppeteer = require('puppeteer');
const { db } = require('../config/firebase');

(async () => {
  console.log("Starting mandate verification...");

  // Launch Puppeteer browser
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log('BROWSER LOG:', msg.text());
  });

  page.on('pageerror', err => {
    console.error('BROWSER ERROR:', err.message);
  });

  let userId;
  try {
    // 1. Log In
    console.log("Navigating to login page...");
    await page.goto('http://localhost:3000/manager-login.html', { waitUntil: 'load' });

    console.log("Entering login credentials...");
    await page.waitForSelector('#email', { visible: true });
    await page.type('#email', 'cyber@gmail.com');
    await page.type('#password', 'demo123');
    
    console.log("Clicking Authenticate...");
    await page.click('#loginBtn');

    // Wait for redirect to dashboard
    console.log("Waiting for initial dashboard redirect...");
    await page.waitForFunction(() => window.location.href.includes('manager-dashboard.html'), { timeout: 10000 });
    console.log("Redirected to dashboard. URL:", page.url());

    // 2. Retrieve dynamic user ID
    userId = await page.evaluate(() => localStorage.getItem('hr_user_id'));
    console.log("Retrieved dynamic userId from localStorage:", userId);

    // 3. Seed database with yesterday's short-hours log for this dynamic user ID
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    await db.collection('attendance').doc(`${userId}_${yesterdayStr}`).set({
      userId: userId,
      date: yesterdayStr,
      durationHours: 3, // <4 hours workday yesterday
      status: 'Short Hours',
      name: 'CYBER TEST',
      role: 'manager',
      department: 'Cybersecurity'
    });
    console.log(`Successfully seeded yesterday's short-hours workday (${yesterdayStr}) for userId: ${userId}`);

    // 4. Reload page to trigger mandate checks
    console.log("Reloading dashboard to apply mandate checks...");
    await page.reload({ waitUntil: 'load' });

    // Wait for stability and window bindings
    console.log("Waiting for global managerPunchIn to be bound to window...");
    await page.waitForFunction(() => typeof window.managerPunchIn === 'function', { timeout: 10000 });
    console.log("Dashboard fully loaded and stable.");

    // 5. Verify Mandate Alert Banner is visible
    console.log("Waiting for Strict 8-Hour Mandate Alert Banner to be visible...");
    await page.waitForSelector('#mandateAlert', { visible: true, timeout: 10000 });
    console.log("Strict 8-Hour Mandate Alert Banner is VISIBLE (Passed!)");

    // 6. Test Punch In
    console.log("Clicking Punch In...");
    await page.click('#btnPunchIn');
    await page.waitForFunction(() => {
      const text = document.getElementById('tvcStatusText')?.textContent;
      return text && text.includes('ACTIVE');
    }, { timeout: 5000 });
    console.log("Punch-in successful, status ACTIVE");

    // 7. Test Punch Out (triggers Mandated Shift Violation warning)
    console.log("Clicking Punch Out...");
    await page.click('#btnPunchOut');

    console.log("Waiting for compliance warning modal...");
    await page.waitForSelector('#statusModalOverlay', { visible: true, timeout: 5000 });
    
    const title = await page.$eval('#statusModalTitle', el => el.textContent);
    const desc = await page.$eval('#statusModalDesc', el => el.textContent);
    console.log(`MODAL SHOWN: "${title}" - "${desc}"`);

    if (!title.toLowerCase().includes('mandated shift violation') && !title.toLowerCase().includes('violation')) {
      throw new Error(`Expected Mandated Shift Violation modal title, but got: "${title}"`);
    }
    console.log("Mandated Shift Violation modal verification PASSED successfully!");

    // Close modal
    console.log("Dismissing modal...");
    await page.click('#closeStatusModalBtn');
    
    // Verify modal closes
    await page.waitForFunction(() => {
      const el = document.getElementById('statusModalOverlay');
      return !el || el.style.display === 'none';
    }, { timeout: 5000 });
    console.log("Modal dismissed successfully.");

    // 8. Cleanup mock attendance document from Firestore
    console.log("Cleaning up Firestore mock document...");
    await db.collection('attendance').doc(`${userId}_${yesterdayStr}`).delete();
    console.log("Firestore cleanup completed.");

  } catch (err) {
    console.error("Mandate verification failed with error:", err);
    // Try to cleanup even on failure
    if (userId) {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        await db.collection('attendance').doc(`${userId}_${yesterdayStr}`).delete();
      } catch(e) {}
    }
    process.exit(1);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
})();
