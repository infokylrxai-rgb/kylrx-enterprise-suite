const puppeteer = require('puppeteer');

async function testInsights() {
    console.log('=== Headless E2E Verification: Intelligence Insights ===');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    page.on('console', msg => {
        console.log(`[PAGE LOG] ${msg.text()}`);
    });

    page.on('pageerror', err => {
        console.error(`[PAGE ERROR] ${err.toString()}`);
    });

    try {
        console.log('Navigating to http://localhost:3000/admin-onboarding-ai.html...');
        await page.goto('http://localhost:3000/admin-onboarding-ai.html', { waitUntil: 'networkidle2' });

        // Wait for insights container to populate with real data (more than 1 item, and no loading text)
        console.log('Waiting for insights list to populate from Firestore...');
        await page.waitForFunction(() => {
            const items = document.querySelectorAll('.insight-item');
            if (items.length === 0) return false;
            if (items.length === 1 && items[0].innerText.includes('Synchronizing')) return false;
            return true;
        }, { timeout: 10000 });

        const insights = await page.evaluate(() => {
            const items = document.querySelectorAll('.insight-item');
            return Array.from(items).map(item => ({
                title: item.querySelector('h4').innerText,
                desc: item.querySelector('p').innerText
            }));
        });

        console.log(`Found ${insights.length} insights loaded:`);
        insights.forEach((ins, idx) => {
            console.log(`  ${idx + 1}. ${ins.title}: "${ins.desc}"`);
        });

        // Verify the three insights are present
        const titles = insights.map(i => i.title);
        const hasBottleneck = titles.includes('Finance Verification Bottleneck');
        const hasAlert = titles.includes('Onboarding Sequence Alert');
        const hasSpeedup = titles.includes('Workspace Provisioning Speedup');

        if (!hasBottleneck || !hasAlert || !hasSpeedup) {
            throw new Error('Missing expected insights in the UI');
        }
        console.log('✅ All three expected insights are rendered.');

        // Test 1: Finance Verification Bottleneck click and action
        console.log('Testing "Finance Verification Bottleneck" modal click...');
        await page.evaluate(() => {
            const items = document.querySelectorAll('.insight-item');
            const bottleneckCard = Array.from(items).find(i => i.innerText.includes('Finance Verification Bottleneck'));
            bottleneckCard.click();
        });

        await page.waitForSelector('#insightDetailModal.active');
        console.log('✅ Bottleneck detail modal opened successfully.');

        // Wait for dynamic loading to complete
        console.log('Waiting for dynamic candidate list to load...');
        await page.waitForFunction(() => {
            const content = document.getElementById('insightModalContent');
            return content && !content.innerText.includes('Loading affected recruits');
        }, { timeout: 10000 });

        // Escalate Bottleneck
        console.log('Clicking "Escalate Bottleneck" action...');
        await page.click('#insightModalActionBtn');

        // Wait for Toast
        await page.waitForSelector('#successToast.active');
        const toastText1 = await page.$eval('#successToast span', el => el.innerText);
        console.log(`✅ Toast shown: "${toastText1}"`);
        if (!toastText1.includes('Escalation emails dispatched')) {
            throw new Error('Unexpected toast text for bottleneck escalation');
        }

        // Wait for Toast to hide
        console.log('Waiting for toast to fade out...');
        await page.waitForSelector('#successToast:not(.active)', { timeout: 5000 });

        // Close modal
        await page.click('#insightModalCloseBtn');
        await page.waitForSelector('#insightDetailModal:not(.active)');
        console.log('✅ Modal closed.');

        // Test 2: Onboarding Sequence Alert click and action
        console.log('Testing "Onboarding Sequence Alert" modal click...');
        await page.evaluate(() => {
            const items = document.querySelectorAll('.insight-item');
            const alertCard = Array.from(items).find(i => i.innerText.includes('Onboarding Sequence Alert'));
            alertCard.click();
        });

        await page.waitForSelector('#insightDetailModal.active');
        console.log('✅ Alert detail modal opened successfully.');

        // Send Test Greeting
        console.log('Clicking "Send Test Greeting" action...');
        await page.click('#insightModalActionBtn');

        // Wait for Toast
        await page.waitForSelector('#successToast.active');
        const toastText2 = await page.$eval('#successToast span', el => el.innerText);
        console.log(`✅ Toast shown: "${toastText2}"`);
        if (!toastText2.includes('Test greeting email sent successfully')) {
            throw new Error('Unexpected toast text for test greeting');
        }

        // Wait for Toast to hide
        console.log('Waiting for toast to fade out...');
        await page.waitForSelector('#successToast:not(.active)', { timeout: 5000 });

        // Close modal
        await page.click('#insightModalCloseBtn');
        await page.waitForSelector('#insightDetailModal:not(.active)');
        console.log('✅ Modal closed.');

        // Test 3: Workspace Provisioning Speedup click and action
        console.log('Testing "Workspace Provisioning Speedup" modal click...');
        await page.evaluate(() => {
            const items = document.querySelectorAll('.insight-item');
            const speedupCard = Array.from(items).find(i => i.innerText.includes('Workspace Provisioning Speedup'));
            speedupCard.click();
        });

        await page.waitForSelector('#insightDetailModal.active');
        console.log('✅ Speedup detail modal opened successfully.');

        // Run Provisioning Audit
        console.log('Clicking "Run Provisioning Audit" action...');
        await page.click('#insightModalActionBtn');

        // Wait for Toast
        await page.waitForSelector('#successToast.active');
        const toastText3 = await page.$eval('#successToast span', el => el.innerText);
        console.log(`✅ Toast shown: "${toastText3}"`);
        if (!toastText3.includes('Provisioning audit run complete')) {
            throw new Error('Unexpected toast text for provisioning audit');
        }

        // Close modal
        await page.click('#insightModalCloseBtn');
        console.log('✅ E2E Verification Successful!');

    } catch (err) {
        console.error('❌ E2E Verification Failed:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
        process.exit(0);
    }
}

testInsights();
