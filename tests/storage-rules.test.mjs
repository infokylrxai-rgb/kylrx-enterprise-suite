/**
 * Storage security-rules tests (organization-scoped paths, roles, ownership, upload limits).
 *
 * Needs the Firestore AND Storage emulators (Java 11+); storage.rules reads users/{uid} from
 * Firestore for roles and ownership. Run with:   npm run test:storage-rules
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let env;
const ok = (p) => assertSucceeds(p);
const no = (p) => assertFails(p);

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const pdf = { contentType: 'application/pdf' };

// Identities: the organization and role come from the token claims
const as = {
  hrA:    () => env.authenticatedContext('hr_a',  { orgId: 'orgA', role: 'HRMS' }).storage(),
  saA:    () => env.authenticatedContext('sa_a',  { orgId: 'orgA', role: 'super_admin', super_admin: true }).storage(),
  empA:   () => env.authenticatedContext('emp_a', { orgId: 'orgA', role: 'Employee' }).storage(),
  empA2:  () => env.authenticatedContext('emp_a2', { orgId: 'orgA', role: 'Employee' }).storage(),
  hrB:    () => env.authenticatedContext('hr_b',  { orgId: 'orgB', role: 'HRMS' }).storage(),
  saB:    () => env.authenticatedContext('sa_b',  { orgId: 'orgB', role: 'super_admin', super_admin: true }).storage(),
  noOrgHr: () => env.authenticatedContext('hr_x', { role: 'HRMS' }).storage(),   // signed in, no orgId claim
  anon:   () => env.unauthenticatedContext().storage()
};

const payslipA = 'orgs/orgA/payroll/payslips/emp_a/2026-09.pdf';
const payslipA2 = 'orgs/orgA/payroll/payslips/emp_a2/2026-09.pdf';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-storage-rules',
    storage: { rules: readFileSync(path.join(root, 'storage.rules'), 'utf8') },
    firestore: { rules: readFileSync(path.join(root, 'firestore.rules'), 'utf8') }
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearStorage();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users/hr_a'), { orgId: 'orgA', role: 'HRMS' });
    await setDoc(doc(db, 'users/sa_a'), { orgId: 'orgA', role: 'super_admin' });
    await setDoc(doc(db, 'users/emp_a'), { orgId: 'orgA', role: 'Employee', linkedAuthUid: 'emp_a' });
    await setDoc(doc(db, 'users/emp_a2'), { orgId: 'orgA', role: 'Employee', linkedAuthUid: 'emp_a2' });
    await setDoc(doc(db, 'users/hr_b'), { orgId: 'orgB', role: 'HRMS' });
    await setDoc(doc(db, 'users/sa_b'), { orgId: 'orgB', role: 'super_admin' });
    await setDoc(doc(db, 'users/hr_x'), { role: 'HRMS' });
    const st = c.storage();
    for (const p of [payslipA, payslipA2, 'orgs/orgA/employees/emp_a/documents/d1.pdf']) await uploadBytes(ref(st, p), PDF, pdf);
    await uploadBytes(ref(st, 'orgs/orgA/recruitment/resumes/c1.pdf'), PDF, pdf);
    await uploadBytes(ref(st, 'payroll/payslips/emp_a/old.pdf'), PDF, pdf); // the old layout
  });
});

describe('payslips: orgs/{orgId}/payroll/payslips/{employeeId}/{file}', () => {
  it("org B staff cannot read or write org A's payslip", async () => {
    await no(getBytes(ref(as.hrB(), payslipA)));
    await no(getBytes(ref(as.saB(), payslipA)));
    await no(uploadBytes(ref(as.hrB(), payslipA), PDF, pdf));
    await no(uploadBytes(ref(as.hrB(), 'orgs/orgA/payroll/payslips/emp_a/planted.pdf'), PDF, pdf));
    await no(deleteObject(ref(as.saB(), payslipA)));
  });

  it('an employee reads only their own payslip, in their own organization', async () => {
    await ok(getBytes(ref(as.empA(), payslipA)));
    await no(getBytes(ref(as.empA(), payslipA2)));
    await no(getBytes(ref(as.empA2(), payslipA)));
    await no(uploadBytes(ref(as.empA(), payslipA), PDF, pdf));
  });

  it('staff of the organization read and upload payslips', async () => {
    await ok(getBytes(ref(as.hrA(), payslipA2)));
    await ok(uploadBytes(ref(as.hrA(), 'orgs/orgA/payroll/payslips/emp_a/2026-10.pdf'), PDF, pdf));
    await ok(uploadBytes(ref(as.saA(), 'orgs/orgA/payroll/payslips/emp_a/2026-11.pdf'), PDF, pdf));
  });

  it('only PDFs under 5 MB are accepted', async () => {
    await no(uploadBytes(ref(as.hrA(), 'orgs/orgA/payroll/payslips/emp_a/x.html'), PDF, { contentType: 'text/html' }));
    await no(uploadBytes(ref(as.hrA(), 'orgs/orgA/payroll/payslips/emp_a/big.pdf'), new Uint8Array(5 * 1024 * 1024 + 1), pdf));
  });
});

describe('no organization in the token means no access', () => {
  it('a signed-in user without an orgId claim gets nothing, even with a staff role', async () => {
    await no(getBytes(ref(as.noOrgHr(), payslipA)));
    await no(uploadBytes(ref(as.noOrgHr(), 'orgs/orgA/payroll/payslips/emp_a/x.pdf'), PDF, pdf));
    await no(getBytes(ref(as.noOrgHr(), 'orgs/orgA/recruitment/resumes/c1.pdf')));
  });
  it('an unauthenticated caller gets nothing', async () => {
    await no(getBytes(ref(as.anon(), payslipA)));
    await no(uploadBytes(ref(as.anon(), 'orgs/orgA/branding/logo.png'), PNG, { contentType: 'image/png' }));
  });
});

describe('resumes and employee documents', () => {
  it('resumes: staff of the organization only', async () => {
    await ok(getBytes(ref(as.hrA(), 'orgs/orgA/recruitment/resumes/c1.pdf')));
    await ok(uploadBytes(ref(as.hrA(), 'orgs/orgA/recruitment/resumes/c2.pdf'), PDF, pdf));
    await no(getBytes(ref(as.empA(), 'orgs/orgA/recruitment/resumes/c1.pdf')));
    await no(getBytes(ref(as.hrB(), 'orgs/orgA/recruitment/resumes/c1.pdf')));
    await no(uploadBytes(ref(as.hrA(), 'orgs/orgA/recruitment/resumes/c3.exe'), PDF, { contentType: 'application/x-msdownload' }));
  });
  it('employee documents: the employee reads their own; staff upload; other organizations nothing', async () => {
    await ok(getBytes(ref(as.empA(), 'orgs/orgA/employees/emp_a/documents/d1.pdf')));
    await no(getBytes(ref(as.empA2(), 'orgs/orgA/employees/emp_a/documents/d1.pdf')));
    await no(uploadBytes(ref(as.empA(), 'orgs/orgA/employees/emp_a/documents/mine.pdf'), PDF, pdf));
    await ok(uploadBytes(ref(as.hrA(), 'orgs/orgA/employees/emp_a/documents/offer.pdf'), PDF, pdf));
    await no(getBytes(ref(as.hrB(), 'orgs/orgA/employees/emp_a/documents/d1.pdf')));
    await no(uploadBytes(ref(as.hrA(), 'orgs/orgA/employees/emp_a/documents/big.pdf'), new Uint8Array(10 * 1024 * 1024 + 1), pdf));
  });
});

describe('organization logo', () => {
  it('only the organization\'s super admin uploads a raster image under 2 MB', async () => {
    await ok(uploadBytes(ref(as.saA(), 'orgs/orgA/branding/logo.png'), PNG, { contentType: 'image/png' }));
    await no(uploadBytes(ref(as.saA(), 'orgs/orgA/branding/logo.svg'), PNG, { contentType: 'image/svg+xml' }));
    await no(uploadBytes(ref(as.hrA(), 'orgs/orgA/branding/logo2.png'), PNG, { contentType: 'image/png' }));
    await no(uploadBytes(ref(as.saB(), 'orgs/orgA/branding/logo3.png'), PNG, { contentType: 'image/png' }));
  });
});

describe('everything else is denied', () => {
  it('the old, organization-less paths are closed', async () => {
    await no(getBytes(ref(as.hrA(), 'payroll/payslips/emp_a/old.pdf')));
    await no(uploadBytes(ref(as.saA(), 'payroll/payslips/emp_a/new.pdf'), PDF, pdf));
    await no(uploadBytes(ref(as.saA(), 'organization_logos/x.png'), PNG, { contentType: 'image/png' }));
    await no(getBytes(ref(as.saA(), 'orgs/orgA/anything-else/x.pdf')));
  });
});
