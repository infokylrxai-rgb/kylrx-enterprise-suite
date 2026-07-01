import fs from 'fs';
import { JSDOM } from 'jsdom';

try {
    const html = fs.readFileSync('hrms-notification.html', 'utf8');
    const dom = new JSDOM(html, { runScripts: "outside-only" });
    const scripts = dom.window.document.querySelectorAll('script');
    console.log(`Found ${scripts.length} script tags.`);
    for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        if (script.type === 'module' || !script.type) {
            console.log(`Checking script ${i}...`);
            // We can check if it parses as JS
            try {
                new Function(script.textContent);
                console.log(`Script ${i} parsed successfully.`);
            } catch (err) {
                console.error(`JS Error in script ${i}:`, err);
            }
        }
    }
    console.log("HTML JSDOM parsing completed successfully.");
} catch (err) {
    console.error("HTML Parsing Error:", err);
}
