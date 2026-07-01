const puppeteer = require('puppeteer');

(async () => {
  console.log("Launching browser for manager-login.html...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log('BROWSER CONSOLE:', msg.text());
  });

  page.on('pageerror', err => {
    console.error('BROWSER PAGEERROR:', err.toString());
  });

  try {
    // Navigate to local server
    console.log("Navigating to http://localhost:3000/manager-login.html...");
    await page.goto('http://localhost:3000/manager-login.html', { waitUntil: 'networkidle2' });

    // Wait for the form
    await page.waitForSelector('#email');
    await page.type('#email', 'john@gmail.com');
    await page.type('#password', 'somepassword');
    
    console.log("Clicking Authenticate...");
    await page.click('#loginBtn');

    // Wait for 3 seconds to let async login process complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check overlay active status
    const overlayState = await page.evaluate(() => {
      const overlay = document.getElementById('modalOverlay');
      if (!overlay) return 'null';
      return {
        classList: Array.from(overlay.classList),
        display: window.getComputedStyle(overlay).display,
        visibility: window.getComputedStyle(overlay).visibility,
        title: document.getElementById('modalTitle')?.textContent,
        desc: document.getElementById('modalDesc')?.textContent
      };
    });

    console.log("Overlay State after click:", overlayState);

  } catch (e) {
    console.error("Test failed with exception:", e);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
})();
