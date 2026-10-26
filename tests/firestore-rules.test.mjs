/**
 * Firestore security-rules tests (tenant isolation, maker-checker, approvals).
 *
 * Needs the Firestore emulator (Java 11+). Run with:   npm run test:rules
 * Each test states the behaviour the rules SHOULD have; a failing test names the broken rule.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where, arrayUnion, arrayRemove
} from 'firebase/firestore';

const rulesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'firestore.rules');
let env;

const ok = (p) => assertSucceeds(p);
const no = (p) => assertFails(p);

// Identities. "claims" ones carry orgId/role in the ID token; "profile" ones only have users/{uid}.
const ctx = {
  saA:      () => env.authenticatedContext('sa_a',  { orgId: 'orgA', role: 'super_admin' }).firestore(),
  saAProf:  () => env.authenticatedContext('sa_p').firestore(),                 // token has no claims
  saC:      () => env.authenticatedContext('sa_c',  { orgId: 'orgC', role: 'super_admin' }).firestore(), // orgConfigured=false
  saB:      () => env.authenticatedContext('sa_b',  { orgId: 'orgB', role: 'super_admin' }).firestore(),
  mgr:      () => env.authenticatedContext('mgr_a', { orgId: 'orgA', role: 'Manager' }).firestore(),
  hr:       () => env.authenticatedContext('hr_a',  { orgId: 'orgA', role: 'HRMS' }).firestore(),
  emp:      () => env.authenticatedContext('emp_a', { orgId: 'orgA', role: 'Employee' }).firestore(),
  empB:     () => env.authenticatedContext('emp_b', { orgId: 'orgB', role: 'Employee' }).firestore(),
  ghost:    () => env.authenticatedContext('ghost').firestore(),                // signed in, no claims, no users doc
  legacy:   () => env.authenticatedContext('legacy').firestore(),               // users doc has no orgId/role
};

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    const set = (p, d) => setDoc(doc(db, p), d);
    await set('organizations/orgA', { orgConfigured: true });
    await set('organizations/orgB', { orgConfigured: true });
    await set('organizations/orgC', { orgConfigured: false });
    await set('users/sa_a',  { orgId: 'orgA', role: 'super_admin', email: 'sa@a.test' });
    await set('users/sa_p',  { orgId: 'orgA', role: 'Super Admin', email: 'sap@a.test' });
    await set('users/sa_c',  { orgId: 'orgC', role: 'super_admin' });
    await set('users/sa_b',  { orgId: 'orgB', role: 'super_admin' });
    await set('users/mgr_a', { orgId: 'orgA', role: 'Manager' });
    await set('users/hr_a',  { orgId: 'orgA', role: 'HRMS' });
    await set('users/emp_a', { orgId: 'orgA', role: 'Employee', phone: '1', linkedAuthUid: 'emp_a', super_admin: false });
    await set('users/emp_b', { orgId: 'orgB', role: 'Employee' });
    await set('users/legacy', { role: 'Admin', email: 'old@a.test' });         // pre-migration doc
    await set('users/old_emp', { role: 'Employee' });                           // pre-migration doc, no orgId
    await set('payment_batches/b1',    { orgId: 'orgA', status: 'DRAFT', maker_checker: { maker_id: 'sa_a', checker_id: null } });
    await set('payment_batches/b_nomc', { orgId: 'orgA', status: 'DRAFT' });   // batch created without maker_checker
    await set('payment_batches/bB',    { orgId: 'orgB', status: 'DRAFT', maker_checker: { maker_id: 'sa_b', checker_id: null } });
    await set('organizations/orgA/workflow_instances/wi1', { initiatorId: 'emp_a', status: 'IN_PROGRESS' });
    await set('organizations/orgA/workflow_instances/wi_mgr', { initiatorId: 'mgr_a', status: 'IN_PROGRESS' });
    await set('organizations/orgA/approval_tasks/t1', { assignedApproverId: 'mgr_a', initiatorId: 'emp_a', status: 'PENDING' });
    await set('organizations/orgA/approval_tasks/t_mgr', { assignedApproverId: 'mgr_a', initiatorId: 'mgr_a', status: 'PENDING' });
    await set('organizations/orgA/business_units/bu1', { name: 'BU' });
    await set('payroll_profiles/pp1', { orgId: 'orgA', employeeId: 'emp_a', ctc: 100 });
    await set('organizations/orgA/config/admin_custom_apps', { customApps: [{ name: 'Datadog', url: 'https://app.datadoghq.com/' }] });
    await set('notifications/n1',        { orgId: 'orgA', title: 'Policy update', message: 'Read it', target: 'all', readBy: [], clearedBy: [] });
    await set('notifications/n_shared',  { orgId: 'orgA', title: 'Shared', target: 'all', readBy: ['mgr_a'], clearedBy: ['mgr_a'] });
    await set('notifications/n_legacy_read', { orgId: 'orgA', title: 'Old', target: 'all', read: true });
    await set('notifications/n_untagged', { title: 'Before orgId existed', target: 'all' }); // no orgId
    await set('notifications/nB',        { orgId: 'orgB', title: 'Other org', target: 'all', readBy: [] });
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'kylrx-rules-test',
    firestore: { rules: readFileSync(rulesPath, 'utf8') }
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(seed);

describe('users', () => {
  it('configured super admin (claims) creates a user stamped with own orgId', () =>
    ok(setDoc(doc(ctx.saA(), 'users/n1'), { orgId: 'orgA', role: 'Employee' })));
  it('configured super admin (profile only, no claims) creates a user', () =>
    ok(setDoc(doc(ctx.saAProf(), 'users/n1'), { orgId: 'orgA', role: 'Employee' })));
  it('create WITHOUT orgId is rejected (client must stamp orgId)', () =>
    no(setDoc(doc(ctx.saA(), 'users/n2'), { role: 'Employee' })));
  it('create for another org is rejected', () =>
    no(setDoc(doc(ctx.saA(), 'users/n3'), { orgId: 'orgB', role: 'Employee' })));
  it('super admin of an UNconfigured org cannot create users (orgConfigured gate, by design)', () =>
    no(setDoc(doc(ctx.saC(), 'users/n4'), { orgId: 'orgC', role: 'Employee' })));
  it('HR user can create an Employee-role user in own org (hrms-dashboard / recruitment flow)', () =>
    ok(setDoc(doc(ctx.hr(), 'users/n5'), { orgId: 'orgA', role: 'Employee' })));
  it('HR user cannot create a Super Admin', () =>
    no(setDoc(doc(ctx.hr(), 'users/n6'), { orgId: 'orgA', role: 'super_admin' })));
  it('HR user can edit an employee profile field', () =>
    ok(updateDoc(doc(ctx.hr(), 'users/emp_a'), { phone: '2' })));
  it('HR user cannot change an employee role', () =>
    no(updateDoc(doc(ctx.hr(), 'users/emp_a'), { role: 'super_admin' })));
  it('super admin updates same-org user', () =>
    ok(updateDoc(doc(ctx.saA(), 'users/emp_a'), { phone: '3' })));
  it('super admin cannot move a user to another org', () =>
    no(updateDoc(doc(ctx.saA(), 'users/emp_a'), { orgId: 'orgB' })));
  it('manager cannot update another user', () =>
    no(updateDoc(doc(ctx.mgr(), 'users/emp_a'), { phone: '4' })));
  it('employee updates own non-protected field', () =>
    ok(updateDoc(doc(ctx.emp(), 'users/emp_a'), { phone: '5' })));
  it('employee cannot raise own role', () =>
    no(updateDoc(doc(ctx.emp(), 'users/emp_a'), { role: 'super_admin' })));
  it('employee cannot change own orgId', () =>
    no(updateDoc(doc(ctx.emp(), 'users/emp_a'), { orgId: 'orgB' })));
  it('employee merge-write of own profile with unchanged protected fields succeeds (login.js google link)', () =>
    ok(setDoc(doc(ctx.emp(), 'users/emp_a'), { orgId: 'orgA', role: 'Employee', googleLinked: true }, { merge: true })));
  it('employee REPLACE-write (setDoc without merge, app.js settings) is rejected: it drops protected fields', () =>
    no(setDoc(doc(ctx.emp(), 'users/emp_a'), { orgId: 'orgA', name: 'x', role: 'Employee' })));
  it('other-org super admin cannot update or read this org\'s user', async () => {
    await no(updateDoc(doc(ctx.saB(), 'users/emp_a'), { phone: '6' }));
    await no(getDoc(doc(ctx.saB(), 'users/emp_a')));
  });
  it('employee reads own profile', () => ok(getDoc(doc(ctx.emp(), 'users/emp_a'))));
  it('employee lists users of own org when the query filters orgId', () =>
    ok(getDocs(query(collection(ctx.emp(), 'users'), where('orgId', '==', 'orgA')))));
  it('unfiltered list of users is rejected (rules are not filters)', () =>
    no(getDocs(collection(ctx.emp(), 'users'))));
  it('SELF-CREATE cannot claim an arbitrary orgId (tenant takeover)', () =>
    no(setDoc(doc(ctx.ghost(), 'users/ghost'), { orgId: 'orgB', role: 'Employee' })));
  it('self-create without orgId and with Employee role is allowed (signup)', () =>
    ok(setDoc(doc(ctx.ghost(), 'users/ghost'), { role: 'Employee', email: 'g@x.test' })));
  it('signed-in user with no profile reads nothing from a tenant', () =>
    no(getDoc(doc(ctx.ghost(), 'users/emp_a'))));
  it('legacy admin whose users doc has no orgId can still read own profile (no rule error)', () =>
    ok(getDoc(doc(ctx.legacy(), 'users/legacy'))));
  it('legacy user doc without orgId is unreachable by admins until migrated (expected deny)', () =>
    no(updateDoc(doc(ctx.saA(), 'users/old_emp'), { phone: '7' })));
});

describe('payment_batches (maker-checker)', () => {
  const batch = (extra = {}) => ({ orgId: 'orgA', status: 'DRAFT', maker_checker: { maker_id: 'sa_a', checker_id: null }, ...extra });

  it('configured super admin creates a batch with orgId', () =>
    ok(setDoc(doc(ctx.saA(), 'payment_batches/n1'), batch())));
  it('profile-only super admin creates a batch', () =>
    ok(setDoc(doc(ctx.saAProf(), 'payment_batches/n1'), batch())));
  it('create without orgId is rejected', () =>
    no(setDoc(doc(ctx.saA(), 'payment_batches/n2'), { status: 'DRAFT' })));
  it('super admin of unconfigured org cannot create (gate)', () =>
    no(setDoc(doc(ctx.saC(), 'payment_batches/n3'), batch({ orgId: 'orgC' }))));
  it('different checker approves', () =>
    ok(updateDoc(doc(ctx.saA(), 'payment_batches/b1'), { status: 'APPROVED', 'maker_checker.checker_id': 'sa_x' })));
  it('maker cannot be checker', () =>
    no(updateDoc(doc(ctx.saA(), 'payment_batches/b1'), { 'maker_checker.checker_id': 'sa_a' })));
  it('batch without maker_checker can still change status (missing field must not error the rule)', () =>
    ok(updateDoc(doc(ctx.saA(), 'payment_batches/b_nomc'), { status: 'PENDING_APPROVAL' })));
  it('orgId cannot be changed on update', () =>
    no(updateDoc(doc(ctx.saA(), 'payment_batches/b1'), { orgId: 'orgB' })));
  it('manager cannot update', () =>
    no(updateDoc(doc(ctx.mgr(), 'payment_batches/b1'), { status: 'APPROVED' })));
  it('employee cannot read or write', async () => {
    await no(getDoc(doc(ctx.emp(), 'payment_batches/b1')));
    await no(updateDoc(doc(ctx.emp(), 'payment_batches/b1'), { status: 'APPROVED' }));
  });
  it('manager can read a batch of own org', () => ok(getDoc(doc(ctx.mgr(), 'payment_batches/b1'))));
  it('manager list with orgId filter works (operational-dashboard)', () =>
    ok(getDocs(query(collection(ctx.mgr(), 'payment_batches'), where('orgId', '==', 'orgA')))));
  it('manager list WITHOUT orgId filter is rejected (what the client does while TENANT_READ_SCOPING=false)', () =>
    no(getDocs(collection(ctx.mgr(), 'payment_batches'))));
  it('other-org super admin cannot read or update', async () => {
    await no(getDoc(doc(ctx.saB(), 'payment_batches/b1')));
    await no(updateDoc(doc(ctx.saB(), 'payment_batches/b1'), { status: 'APPROVED' }));
  });
});

describe('workflow_instances / approval_tasks', () => {
  const wi = (c, id) => doc(c, `organizations/orgA/workflow_instances/${id}`);
  const tk = (c, id) => doc(c, `organizations/orgA/approval_tasks/${id}`);

  it('same-org employee can read their workflow instance', () => ok(getDoc(wi(ctx.emp(), 'wi1'))));
  it('employee cannot create a workflow instance', () =>
    no(setDoc(wi(ctx.emp(), 'x1'), { initiatorId: 'emp_a', status: 'IN_PROGRESS' })));
  it('employee cannot approve their own task', () =>
    no(updateDoc(tk(ctx.emp(), 't1'), { status: 'APPROVED' })));
  it('employee cannot create an approved task for themselves', () =>
    no(setDoc(tk(ctx.emp(), 'x2'), { initiatorId: 'emp_a', status: 'APPROVED' })));
  it('employee cannot delete a task or instance', async () => {
    await no(deleteDoc(tk(ctx.emp(), 't1')));
    await no(deleteDoc(wi(ctx.emp(), 'wi1')));
  });
  it('assigned manager approves a subordinate\'s task', () =>
    ok(updateDoc(tk(ctx.mgr(), 't1'), { status: 'APPROVED' })));
  it('manager cannot approve a task they initiated themselves', () =>
    no(updateDoc(tk(ctx.mgr(), 't_mgr'), { status: 'APPROVED' })));
  it('super admin can override', () =>
    ok(updateDoc(tk(ctx.saA(), 't_mgr'), { status: 'APPROVED' })));
  it('manager advances a workflow instance they did not initiate', () =>
    ok(updateDoc(wi(ctx.mgr(), 'wi1'), { status: 'APPROVED' })));
  it('manager cannot advance an instance they initiated', () =>
    no(updateDoc(wi(ctx.mgr(), 'wi_mgr'), { status: 'APPROVED' })));
  it('other-org user can neither read nor write', async () => {
    await no(getDoc(wi(ctx.empB(), 'wi1')));
    await no(updateDoc(tk(ctx.saB(), 't1'), { status: 'APPROVED' }));
  });
});

describe('organizations/{orgId}/{subCollection} catch-all', () => {
  const bu = (c) => doc(c, 'organizations/orgA/business_units/bu1');
  it('same-org employee can read org config', () => ok(getDoc(bu(ctx.emp()))));
  it('manager cannot write arbitrary org data', async () => {
    await no(setDoc(doc(ctx.mgr(), 'organizations/orgA/anything/x'), { evil: true }));
    await no(updateDoc(bu(ctx.mgr()), { name: 'hijack' }));
  });
  it('employee cannot write org data', () => no(updateDoc(bu(ctx.emp()), { name: 'hijack' })));
  it('HR/admin role can still write org config (business units, shifts, ...)', () =>
    ok(updateDoc(bu(ctx.hr()), { name: 'BU2' })));
  it('configured super admin can write org config', () => ok(updateDoc(bu(ctx.saA()), { name: 'BU3' })));
  it('super admin of an unconfigured org can write config (setup wizard needs it)', () =>
    ok(setDoc(doc(ctx.saC(), 'organizations/orgC/business_units/x'), { name: 'first' })));
  it('other-org super admin cannot', () => no(updateDoc(bu(ctx.saB()), { name: 'x' })));
});

// Custom sidebar apps: one document per organization; super admin / HR of that organization write it
describe('organizations/{orgId}/config/admin_custom_apps', () => {
  const apps = (db, org = 'orgA') => doc(db, 'organizations', org, 'config', 'admin_custom_apps');
  const add = (db, org) => setDoc(apps(db, org), { customApps: arrayUnion({ name: 'X', url: 'https://x.example/' }) }, { merge: true });

  it('every member of the organization can read it', async () => {
    await ok(getDoc(apps(ctx.emp())));
    await ok(getDoc(apps(ctx.mgr())));
  });
  it('a super admin or HR of the organization can write it', async () => {
    await ok(add(ctx.saA()));
    await ok(add(ctx.hr()));
  });
  it('employees and managers cannot write it', async () => {
    await no(add(ctx.emp()));
    await no(add(ctx.mgr()));
  });
  it("organization B cannot read or write organization A's apps", async () => {
    await no(getDoc(apps(ctx.empB())));
    await no(getDoc(apps(ctx.saB())));
    await no(add(ctx.saB()));
    await no(add(ctx.saB(), 'orgA'));
  });
  it('organization B writes only its own document', async () => {
    await ok(add(ctx.saB(), 'orgB'));
  });
});

// Notifications: same organization; a member may only add/remove their OWN uid in readBy/clearedBy
describe('notifications', () => {
  const n = (db, id = 'n1') => doc(db, 'notifications/' + id);

  it('same-org members read their organization\'s notifications; other orgs do not', async () => {
    await ok(getDoc(n(ctx.emp())));
    await ok(getDoc(n(ctx.saA())));
    await no(getDoc(n(ctx.empB())));
    await no(getDoc(n(ctx.saB())));
  });

  it('a query must be scoped to the organization; an unfiltered list is refused', async () => {
    await ok(getDocs(query(collection(ctx.emp(), 'notifications'), where('orgId', '==', 'orgA'))));
    await no(getDocs(collection(ctx.emp(), 'notifications')));
    await no(getDocs(query(collection(ctx.emp(), 'notifications'), where('orgId', '==', 'orgB'))));
  });

  it('notifications without an orgId are readable and changeable by nobody (not even a super admin)', async () => {
    await no(getDoc(n(ctx.emp(), 'n_untagged')));
    await no(getDoc(n(ctx.saA(), 'n_untagged')));
    await no(updateDoc(n(ctx.emp(), 'n_untagged'), { readBy: arrayUnion('emp_a') }));
    await no(updateDoc(n(ctx.saA(), 'n_untagged'), { readBy: arrayUnion('sa_a') }));
  });

  it('a member can mark a notification read and unread for themselves', async () => {
    await ok(updateDoc(n(ctx.emp()), { readBy: arrayUnion('emp_a') }));
    await ok(updateDoc(n(ctx.emp(), 'n_shared'), { readBy: arrayUnion('emp_a') }));
    await ok(updateDoc(n(ctx.mgr(), 'n_shared'), { readBy: arrayRemove('mgr_a') }));
  });

  it('a member cannot add or remove anyone else\'s uid in readBy', async () => {
    await no(updateDoc(n(ctx.emp()), { readBy: arrayUnion('mgr_a') }));
    await no(updateDoc(n(ctx.emp()), { readBy: arrayUnion('emp_a', 'mgr_a') }));
    await no(updateDoc(n(ctx.emp(), 'n_shared'), { readBy: arrayRemove('mgr_a') }));
    await no(updateDoc(n(ctx.emp()), { readBy: [] , clearedBy: arrayUnion('hr_a') }));
  });

  it('dismissing (clearedBy) follows the same rule', async () => {
    await ok(updateDoc(n(ctx.emp()), { clearedBy: arrayUnion('emp_a') }));
    await no(updateDoc(n(ctx.emp()), { clearedBy: arrayUnion('mgr_a') }));
    await no(updateDoc(n(ctx.emp(), 'n_shared'), { clearedBy: arrayRemove('mgr_a') }));
  });

  it('a member cannot change anything else on a notification', async () => {
    await no(updateDoc(n(ctx.emp()), { title: 'Hacked' }));
    await no(updateDoc(n(ctx.emp()), { target: 'employee' }));
    await no(updateDoc(n(ctx.emp()), { read: true }));              // the old shared flag
    await no(updateDoc(n(ctx.emp()), { orgId: 'orgB' }));
    await no(updateDoc(n(ctx.emp()), { readBy: arrayUnion('emp_a'), title: 'Hacked' }));
    await no(deleteDoc(n(ctx.emp())));
  });

  it('other organizations cannot touch it at all', async () => {
    await no(updateDoc(n(ctx.empB()), { readBy: arrayUnion('emp_b') }));
    await no(updateDoc(n(ctx.saB()), { title: 'x' }));
    await no(deleteDoc(n(ctx.saB())));
  });

  it('a configured super admin manages notifications of their organization', async () => {
    await ok(updateDoc(n(ctx.saA()), { title: 'Edited' }));
    await ok(updateDoc(n(ctx.saA()), { readBy: arrayUnion('sa_a') }));
    await ok(deleteDoc(n(ctx.saA(), 'n_shared')));
  });

  it('HR and managers may resolve requests (status) and still only touch their own readBy', async () => {
    await ok(updateDoc(n(ctx.hr()), { status: 'resolved', readBy: arrayUnion('hr_a') }));
    await ok(updateDoc(n(ctx.mgr()), { status: 'approved', read: true }));
    await no(updateDoc(n(ctx.hr()), { title: 'Hacked' }));
    await no(updateDoc(n(ctx.hr()), { status: 'resolved', readBy: arrayUnion('mgr_a') }));
    await no(updateDoc(n(ctx.emp()), { status: 'resolved' }));
  });

  it('when staff set resolvedBy it must be their own uid', async () => {
    await ok(updateDoc(n(ctx.hr()), { status: 'resolved', resolvedBy: 'hr_a', resolvedAt: '2026-10-26T10:00:00Z' }));
    await ok(updateDoc(n(ctx.mgr(), 'n_shared'), { status: 'approved', resolvedBy: 'mgr_a' }));
    await no(updateDoc(n(ctx.hr()), { status: 'resolved', resolvedBy: 'mgr_a' }));      // someone else
    await no(updateDoc(n(ctx.mgr()), { resolvedBy: 'sa_a' }));                          // even without a status change
    await no(updateDoc(n(ctx.hr()), { status: 'resolved', resolvedBy: null }));          // clearing it to hide who resolved
    await ok(updateDoc(n(ctx.hr()), { status: 'resolved', resolvedAt: '2026-10-26T10:00:00Z' })); // not setting it is fine
  });

  it('staff resolving still cannot touch anyone else\'s readBy or clearedBy', async () => {
    await no(updateDoc(n(ctx.hr(), 'n_shared'), { status: 'resolved', resolvedBy: 'hr_a', readBy: arrayRemove('mgr_a') }));
    await no(updateDoc(n(ctx.mgr()), { status: 'approved', clearedBy: arrayUnion('emp_a') }));
    await ok(updateDoc(n(ctx.mgr()), { status: 'approved', resolvedBy: 'mgr_a', readBy: arrayUnion('mgr_a'), clearedBy: arrayUnion('mgr_a') }));
  });

  it('a member can create a notification only in their own organization', async () => {
    await ok(setDoc(n(ctx.emp(), 'new_a'), { orgId: 'orgA', title: 'Leave request', target: 'manager', readBy: [] }));
    await no(setDoc(n(ctx.emp(), 'new_b'), { orgId: 'orgB', title: 'x', target: 'all' }));
    await no(setDoc(n(ctx.emp(), 'new_untagged'), { title: 'x', target: 'all' }));
  });
});

// Tenant isolation: another org's user must see nothing of org A in any collection family
describe('cross-tenant isolation', () => {
  it('org B user cannot read org A documents (top-level + org subtree)', async () => {
    await no(getDoc(doc(ctx.empB(), 'users/emp_a')));
    await no(getDoc(doc(ctx.empB(), 'payroll_profiles/pp1')));
    await no(getDoc(doc(ctx.empB(), 'organizations/orgA')));
    await no(getDoc(doc(ctx.empB(), 'organizations/orgA/business_units/bu1')));
  });
  it('org B super admin cannot write into org A, even stamping orgA', async () => {
    await no(setDoc(doc(ctx.saB(), 'payroll_profiles/evil'), { orgId: 'orgA' }));
    await no(updateDoc(doc(ctx.saB(), 'payroll_profiles/pp1'), { ctc: 1 }));
  });
});

// Business units (PRD §10): the app uses organizations/{orgId}/business_units only. The legacy
// bu_employee_type_rules collection is no longer read or written by the app; its rules are kept as they were.
describe('business units: primary and legacy paths', () => {
  const bu = (db, org = 'orgA', code = 'bu_new') => doc(db, `organizations/${org}/business_units/${code}`);
  const rule = (db, id = 'rule_x') => doc(db, `bu_employee_type_rules/${id}`);

  it('super admin and HR write a business unit in their own organization', async () => {
    await ok(setDoc(bu(ctx.saA()), { orgId: 'orgA', businessUnitCode: 'BU_NEW', isActive: true }));
    await ok(setDoc(bu(ctx.hr(), 'orgA', 'bu_hr'), { orgId: 'orgA', businessUnitCode: 'BU_HR', isActive: true }));
  });

  it('a manager or an employee cannot write a business unit, but members can read them', async () => {
    await no(setDoc(bu(ctx.mgr()), { orgId: 'orgA' }));
    await no(setDoc(bu(ctx.emp()), { orgId: 'orgA' }));
    await ok(getDoc(bu(ctx.emp(), 'orgA', 'bu1')));
  });

  it('the old bug: writing under another organization id (the localStorage default) is refused, as is reading it', async () => {
    await no(setDoc(bu(ctx.saA(), 'org_kylrx'), { orgId: 'org_kylrx', businessUnitCode: 'BU_NEW' }));
    await no(getDoc(bu(ctx.saA(), 'orgB', 'bu1')));
    await no(getDocs(collection(ctx.saA(), 'organizations/orgB/business_units')));
  });

  it('another organization cannot write into this one, even with orgId stamped orgA', async () => {
    await no(setDoc(bu(ctx.saB()), { orgId: 'orgA', businessUnitCode: 'BU_NEW' }));
    await no(setDoc(bu(ctx.empB()), { orgId: 'orgA', businessUnitCode: 'BU_NEW' }));
  });

  it('legacy collection: a staff create needs the own organization id on the record', async () => {
    await ok(setDoc(rule(ctx.hr()), { orgId: 'orgA', businessUnitCode: 'BU_X' }));
    await no(setDoc(rule(ctx.hr(), 'rule_noorg'), { businessUnitCode: 'BU_X' })); // what an unstamped write looked like
    await no(setDoc(rule(ctx.hr(), 'rule_other'), { orgId: 'orgB', businessUnitCode: 'BU_X' }));
    await no(setDoc(rule(ctx.emp(), 'rule_emp'), { orgId: 'orgA', businessUnitCode: 'BU_X' }));
  });

  it('legacy collection: reads are limited to the organization and orgId cannot be changed', async () => {
    await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'bu_employee_type_rules/rule_a'), { orgId: 'orgA', businessUnitCode: 'BU_A' }));
    await ok(getDoc(rule(ctx.emp(), 'rule_a')));
    await no(getDoc(rule(ctx.empB(), 'rule_a')));
    await no(updateDoc(rule(ctx.hr(), 'rule_a'), { orgId: 'orgB' }));
    await no(getDocs(collection(ctx.empB(), 'bu_employee_type_rules'))); // unfiltered list: the old unscoped read
    await ok(getDocs(query(collection(ctx.emp(), 'bu_employee_type_rules'), where('orgId', '==', 'orgA'))));
  });
});

// Gaps found by this suite that need a product decision before changing; flip to no() once fixed
describe('KNOWN GAPS (current behaviour, not yet restricted)', () => {
  it('any same-org employee can overwrite payroll_profiles via the top-level catch-all', () =>
    ok(updateDoc(doc(ctx.emp(), 'payroll_profiles/pp1'), { ctc: 999999 })));
});
