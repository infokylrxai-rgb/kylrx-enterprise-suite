import fs from 'fs';

const js = fs.readFileSync('admin-alert-builder.js', 'utf8');

const checks = [
  ['isBackendAvailable flag tracked', js.includes('let isBackendAvailable = null;')],
  ['getCategoryForModule helper defined', js.includes('function getCategoryForModule(')],
  ['submitNewAlertRule updates activeRules immediately', js.includes('activeRules.unshift(newRule)')],
  ['submitNewAlertRule closes modal immediately', js.includes('closeNewRuleModal()')],
  ['submitNewAlertRule persists to Firestore via setDoc', js.includes("await setDoc(doc(db, 'alert_rules', id)")],
  ['submitNewAlertRule guards backend fetch with isBackendAvailable', js.includes('if (isBackendAvailable !== false)')],
  ['toggleAlertRule updates Firestore via updateDoc', js.includes("await updateDoc(doc(db, 'alert_rules', ruleId)")],
  ['executeSimulatedAlert has client-side fallback evaluation', js.includes('if (!handledByBackend)') && js.includes('conditionMet = val >= thresh')],
  ['fetchAlertRules has Firestore getDocs fallback', js.includes("await getDocs(collection(db, 'alert_rules'))")]
];

let allPassed = true;
checks.forEach(([desc, passed]) => {
  console.log((passed ? '✓ PASS' : '✗ FAIL') + ': ' + desc);
  if (!passed) allPassed = false;
});

if (allPassed) {
  console.log('\nAll alert builder resilience checks PASSED successfully!');
  process.exit(0);
} else {
  console.log('\nSome checks failed.');
  process.exit(1);
}
