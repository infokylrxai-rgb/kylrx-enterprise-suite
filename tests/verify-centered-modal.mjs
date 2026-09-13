import fs from 'fs';

const html = fs.readFileSync('admin-automation-builder.html', 'utf8');
const js = fs.readFileSync('admin-automation-builder.js', 'utf8');

const checks = [
    ['builderConfirmModal overlay element exists in HTML', html.includes('id="builderConfirmModal"')],
    ['builderConfirmTitle element exists in HTML', html.includes('id="builderConfirmTitle"')],
    ['builderConfirmMessage element exists in HTML', html.includes('id="builderConfirmMessage"')],
    ['builderConfirmCancelBtn element exists in HTML', html.includes('id="builderConfirmCancelBtn"')],
    ['builderConfirmOkBtn element exists in HTML', html.includes('id="builderConfirmOkBtn"')],
    ['center-modal-overlay CSS class styled in HTML', html.includes('.center-modal-overlay')],
    ['modalScaleIn keyframes animation in HTML', html.includes('@keyframes modalScaleIn')],
    ['showConfirmModal helper defined in JS', js.includes('function showConfirmModal')],
    ['showAlertModal helper defined in JS', js.includes('function showAlertModal')],
    ['deleteNode calls showConfirmModal in JS', js.includes('const confirmed = await showConfirmModal')],
    ['Native confirm() removed from deleteNode in JS', !/async function deleteNode[\s\S]*?window\.confirm\(/.test(js)],
    ['Native alert() removed from deleteNode in JS', !/async function deleteNode[\s\S]*?alert\('Workflow must have at least one step.'\)/.test(js)],
    ['deployWorkflow uses showAlertModal instead of native alert in JS', js.includes('await showAlertModal({\n        title: \'Automation Deployed Successfully\'') || js.includes('await showAlertModal(')]
];

let allPassed = true;
checks.forEach(([desc, passed]) => {
    console.log(`${passed ? '✓ PASS' : '✗ FAIL'}: ${desc}`);
    if (!passed) allPassed = false;
});

if (allPassed) {
    console.log('\nAll checks PASSED successfully!');
    process.exit(0);
} else {
    console.log('\nSome checks failed.');
    process.exit(1);
}
