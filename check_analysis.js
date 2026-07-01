const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('PAGE ERROR:', msg.text());
    }
  });

  page.on('pageerror', err => {
    console.log('PAGE EXCEPTION:', err.toString());
  });

  try {
    console.log('Navigating to manager-analysis.html...');
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('hr_logged_in', 'true');
        localStorage.setItem('userRole', 'manager');
        localStorage.setItem('userName', 'Manager');
    });
    await page.goto('http://localhost:3000/manager-analysis.html', { waitUntil: 'networkidle2' });
  } catch(e) {
    console.error(e);
  } finally {
    await browser.close();
  }
})();
