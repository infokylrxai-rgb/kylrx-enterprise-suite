import puppeteer from 'puppeteer';

(async () => {
  console.log("Starting browser verification...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Listen for page console logs
  page.on('console', msg => {
    console.log('BROWSER LOG:', msg.text());
  });

  page.on('pageerror', err => {
    console.error('BROWSER ERROR:', err.message);
  });

  try {
    // 1. Load login page
    console.log("Navigating to login page...");
    await page.goto('http://localhost:3000/manager-login.html', { waitUntil: 'load' });

    // 2. Perform Login
    console.log("Entering login credentials...");
    await page.waitForSelector('#email', { visible: true });
    await page.type('#email', 'cyber@gmail.com');
    await page.type('#password', 'demo123');
    
    console.log("Clicking Authenticate...");
    await page.click('#loginBtn');

    // Wait for redirection and dashboard loading
    console.log("Waiting for initial dashboard redirect...");
    await page.waitForFunction(() => window.location.href.includes('manager-dashboard.html'), { timeout: 10000 });
    console.log("Redirected to dashboard. Current URL:", page.url());

    // Wait for the page to stabilize and global punch functions to be defined
    console.log("Waiting for global managerPunchIn to be bound to window...");
    await page.waitForFunction(() => typeof window.managerPunchIn === 'function', { timeout: 10000 });
    console.log("Dashboard fully loaded and stable. Current URL:", page.url());

    // 3. Test Punch In
    console.log("Checking for punch-in button...");
    await page.waitForSelector('#btnPunchIn', { visible: true, timeout: 10000 });
    
    console.log("Clicking Punch In...");
    await page.click('#btnPunchIn');

    // Wait for Active status
    console.log("Waiting for active status indicator...");
    await page.waitForFunction(() => {
      const text = document.getElementById('tvcStatusText')?.textContent;
      return text && text.includes('ACTIVE');
    }, { timeout: 5000 });
    console.log("Punch-in successful, status is ACTIVE");

    // 4. Test Break
    console.log("Clicking Break...");
    await page.click('#btnBreak');
    await page.waitForFunction(() => {
      const text = document.getElementById('tvcStatusText')?.textContent;
      return text && text.includes('PAUSED');
    }, { timeout: 5000 });
    console.log("Break successful, status is PAUSED");

    // 5. Test Resume
    console.log("Clicking Resume...");
    await page.click('#btnBreak'); // Button has play icon now, ID is same
    await page.waitForFunction(() => {
      const text = document.getElementById('tvcStatusText')?.textContent;
      return text && text.includes('ACTIVE');
    }, { timeout: 5000 });
    console.log("Resume successful, status is ACTIVE");

    // 6. Test Punch Out (under 8 hours)
    console.log("Clicking Punch Out...");
    await page.click('#btnPunchOut');

    // Wait for the modal warning overlay to show
    console.log("Waiting for compliance warning modal...");
    await page.waitForSelector('#statusModalOverlay', { visible: true, timeout: 5000 });
    
    const title = await page.$eval('#statusModalTitle', el => el.textContent);
    const desc = await page.$eval('#statusModalDesc', el => el.textContent);
    console.log(`MODAL SHOWN: "${title}" - "${desc}"`);

    if (!title.toLowerCase().includes('compliance') && !title.toLowerCase().includes('violation') && !title.toLowerCase().includes('warning')) {
      throw new Error(`Unexpected modal title: ${title}`);
    }
    console.log("Compliance warning verification PASSED successfully!");

    // Close modal
    console.log("Dismissing modal...");
    await page.click('#closeStatusModalBtn');
    
    // Verify modal closes
    await page.waitForFunction(() => {
      const el = document.getElementById('statusModalOverlay');
      return !el || el.style.display === 'none';
    }, { timeout: 5000 });
    console.log("Modal dismissed successfully.");

  } catch (err) {
    console.error("Verification failed with error:", err);
    process.exit(1);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
})();
