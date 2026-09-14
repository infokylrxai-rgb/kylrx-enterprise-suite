import fs from 'fs';

const html = fs.readFileSync('admin-assignment-matrix.html', 'utf8');
const js = fs.readFileSync('admin-assignment-matrix.js', 'utf8');

const checks = [
  ['centerAlertModal exists in HTML', html.includes('id="centerAlertModal"')],
  ['centerAlertTitle exists in HTML', html.includes('id="centerAlertTitle"')],
  ['centerAlertContent exists in HTML', html.includes('id="centerAlertContent"')],
  ['centerAlertOkBtn exists in HTML', html.includes('id="centerAlertOkBtn"')],
  ['center-modal-overlay CSS class present in HTML', html.includes('.center-modal-overlay')],
  ['modalScaleIn keyframes present in HTML', html.includes('@keyframes modalScaleIn')],
  ['showCenterAlertModal defined in JS', js.includes('function showCenterAlertModal')],
  ['applySimulatedTransition uses showCenterAlertModal', js.includes('await showCenterAlertModal(')],
  ['Native alert() removed from applySimulatedTransition', !/applySimulatedTransition[\s\S]*?alert\(`✅/.test(js)],
  ['Native alert() removed from testFirebaseSync', !/testFirebaseSync[\s\S]*?alert\(`🔥/.test(js)],
  ['window.showCenterAlertModal exposed', js.includes('window.showCenterAlertModal = showCenterAlertModal')]
];

let allPassed = true;
checks.forEach(([desc, passed]) => {
  console.log((passed ? '✓ PASS' : '✗ FAIL') + ': ' + desc);
  if (!passed) allPassed = false;
});

if (allPassed) {
  console.log('\nAll matrix centered modal checks PASSED successfully!');
  process.exit(0);
} else {
  console.log('\nSome checks failed.');
  process.exit(1);
}
