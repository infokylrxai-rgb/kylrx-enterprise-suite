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
  doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where
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

// Gaps found by this suite that need a product decision before changing; flip to no() once fixed
describe('KNOWN GAPS (current behaviour, not yet restricted)', () => {
  it('any same-org employee can overwrite payroll_profiles via the top-level catch-all', () =>
    ok(updateDoc(doc(ctx.emp(), 'payroll_profiles/pp1'), { ctc: 999999 })));
});
