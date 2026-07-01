const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('PAGE ERROR:', msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('PAGE EXCEPTION:', error.message);
  });

  try {
    await page.goto('http://127.0.0.1:5501/manager-security.html', { waitUntil: 'networkidle0' });
    console.log("Page loaded");
  } catch (err) {
    console.log("Navigation error:", err);
  }

  await browser.close();
})();
