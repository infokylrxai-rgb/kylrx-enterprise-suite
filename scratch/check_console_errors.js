const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  
  const pages = [
    'manager-dashboard.html',
    'manager-attendance.html',
    'manager-console.html',
    'manager-security.html'
  ];

  for (const pageName of pages) {
    const page = await browser.newPage();
    
    // Set local storage so we pass auth guards
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('hr_logged_in', 'true');
      localStorage.setItem('userRole', 'manager');
      localStorage.setItem('userName', 'Test Manager');
      localStorage.setItem('userDept', 'Cybersecurity');
      localStorage.setItem('hr_user_id', 'google_demo_123456');
    });

    const logs = [];
    page.on('console', msg => {
      logs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    page.on('pageerror', err => {
      logs.push(`[EXCEPTION] ${err.toString()}`);
    });

    try {
      console.log(`Checking ${pageName}...`);
      await page.goto(`http://localhost:3000/${pageName}`, { waitUntil: 'load' });
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log(`--- ${pageName} LOGS ---`);
      console.log(logs.join('\n'));
      console.log("-------------------------\n");
    } catch (e) {
      console.error(`Failed checking ${pageName}:`, e);
    } finally {
      await page.close();
    }
  }

  await browser.close();
})();
