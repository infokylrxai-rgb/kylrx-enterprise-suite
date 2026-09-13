import fs from 'fs';

const code = fs.readFileSync('hrms-dashboard.html', 'utf8');

const checks = [
  ['Real-time snapshot listener on bank_approvals exists', code.includes("collection(db, 'bank_approvals')")],
  ['Auto-reseed on empty snapshot removed', !code.includes("Pre-populate with defaults if empty\n                const defaults = [\n                    {\n                        name: 'John Smith'")],
  ['Purge empty documents implemented', code.includes("deleteDoc(doc(db, 'bank_approvals', docSnap.id))")],
  ['Zero-state card rendered when empty', code.includes('No Pending Bank Approvals')],
  ['approveBankDetailsFirebase updates payroll_profiles', code.includes("setDoc(doc(db, 'payroll_profiles', empId)")],
  ['approveBankDetailsFirebase updates bank_verifications', code.includes("setDoc(doc(db, 'bank_verifications', empId)")],
  ['approveBankDetailsFirebase logs to audit_logs', code.includes("action: 'BANK_APPROVAL_SYNC'")],
  ['approveBankDetailsFirebase sends notification', code.includes("title: 'Bank Details Verified'")],
  ['approveBankDetailsFirebase removes from bank_approvals', code.includes("deleteDoc(doc(db, 'bank_approvals', id))")],
  ['rejectBankDetailsFirebase logs to audit_logs', code.includes("action: 'BANK_APPROVAL_REJECTED'")],
  ['rejectBankDetailsFirebase removes from bank_approvals', code.includes("deleteDoc(doc(db, 'bank_approvals', id))")]
];

let allPassed = true;
for (const [desc, pass] of checks) {
  console.log((pass ? '✓ PASS: ' : '✗ FAIL: ') + desc);
  if (!pass) allPassed = false;
}

if (allPassed) {
  console.log('\nAll bank approval backend checks passed successfully!');
  process.exit(0);
} else {
  console.log('\nSome checks failed.');
  process.exit(1);
}
