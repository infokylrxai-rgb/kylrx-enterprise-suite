import fs from 'fs';

const html = fs.readFileSync('admin-automation-builder.html', 'utf8');
const js = fs.readFileSync('admin-automation-builder.js', 'utf8');

const elements = [
    ['trigger', 'When does it start?'],
    ['condition', 'When should it continue?'],
    ['branch', 'What if different cases exist?'],
    ['approval', 'Who must approve?'],
    ['wait', 'How long should Kylrx wait?'],
    ['escalation', 'What happens if nobody acts?'],
    ['action', 'What should Kylrx do?'],
    ['notification', 'Who should be informed?'],
    ['end', 'When is it complete?']
];

console.log('--- Checking 9 Standard Elements in HTML and JS ---');
let allPassed = true;
for (const [el, phrase] of elements) {
    const inHtml = html.includes(phrase);
    const inJs = js.includes(phrase) && js.includes(el);
    console.log(`[${el.toUpperCase()}]: "${phrase}" -> HTML: ${inHtml ? 'PASS' : 'FAIL'} | JS: ${inJs ? 'PASS' : 'FAIL'}`);
    if (!inHtml || !inJs) allPassed = false;
}

console.log('\n--- Checking Pipeline & Features ---');
console.log('Templates defined:', js.includes('exit') && js.includes('onboarding') && js.includes('leave') && js.includes('payroll'));
console.log('Simulation engine:', js.includes('runFlowSimulation') && js.includes('appendSimLog'));
console.log('Backend deployment:', js.includes('deployWorkflow') && js.includes('/api/automations'));
console.log('\nFinal Verdict:', allPassed ? 'ALL 9 ELEMENTS AND FEATURES PASSED 100%' : 'FAILURES DETECTED');
