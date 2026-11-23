import fs from 'fs';

const js = fs.readFileSync('admin-alert-builder.js', 'utf8');
// Since 2c57a36 rule changes are saved by the backend routes (Firestore, per organization), not by direct client writes
const routes = fs.readFileSync('routes/alerts.js', 'utf8');

const checks = [
  ['isBackendAvailable flag tracked', js.includes('let isBackendAvailable = null;')],
  ['getCategoryForModule helper defined', js.includes('function getCategoryForModule(')],
  ['submitNewAlertRule updates activeRules immediately', js.includes('activeRules.unshift(newRule)')],
  ['submitNewAlertRule closes modal immediately', js.includes('closeNewRuleModal()')],
  ['submitNewAlertRule persists through the backend POST /rules', js.includes('fetch(`${API_BASE}/rules`, {')],
  ['backend POST /rules writes the rule to Firestore alert_rules', routes.includes("rawCollection('alert_rules').doc(ruleDocId(orgId, rule.id)).set(")],
  ['submitNewAlertRule guards backend fetch with isBackendAvailable', js.includes('if (isBackendAvailable !== false)')],
  ['toggleAlertRule persists through the backend PATCH /rules/:id/toggle', js.includes("`${API_BASE}/rules/${encodeURIComponent(ruleId)}/toggle`, { method: 'PATCH' }")],
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
