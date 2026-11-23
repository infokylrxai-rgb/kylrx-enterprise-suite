# Staging checklist

Run this in a **staging Firebase project** after deploying the rules and indexes there. Expected results
come from `tests/firestore-rules.test.mjs` (`npm run test:rules`), so a mismatch is either a rules
regression or a gap in the test; fix the test or the rules, not the checklist.

## 0. Before you start

- [ ] Staging has two orgs (A and B), each with: a super admin, an HR user (`HRMS`), a manager, an employee.
      Org A is `orgConfigured: true`; add a third org C with `orgConfigured: false` and a super admin.
- [ ] `node scripts/migrate-tenant-orgid.js` (dry run) reports **0** documents/claims to update.
- [ ] Backend `NODE_ENV=production`, `TENANT_READ_SCOPING=on`; `firebase-config.js` has `TENANT_READ_SCOPING = true`.
- [ ] `npm test`, `npm run test:rules`, `npm run test:tenant` are green.
- [ ] Browser console open. A blocked read now logs `[Firestore] permission-denied reading "<path>"` and fires
      the `firestore-permission-denied` window event. **Any such line during a step marked OK is a bug.**

## 1. HR onboarding (hrms-dashboard, recruitment)

| Step | Super admin (A) | HR (A) | Manager (A) | Employee (A) | Super admin (B) |
|---|---|---|---|---|---|
| Open HRMS onboarding and invite a new employee (`users` doc, role Employee, orgId A) | OK | **OK** | denied | denied | denied (cannot target org A) |
| Invite a new employee with role Manager or HR | OK | **denied** (HR may only create Employee-role users) | denied | denied | denied |
| Invite/create without orgId (stale page, signed out) | denied | denied | denied | denied | denied |
| Recruitment: add a candidate, move stage, add an interview | OK | OK | OK | denied | denied |
| Edit the new employee's phone/department | OK | OK | denied | own profile only | denied |
| Change that employee's role, orgId or `super_admin` | OK (super admin only) | **denied** | denied | denied | denied |
| Edit another admin's profile | OK | **denied** | denied | denied | denied |

Decision to confirm: if HR must be able to onboard managers, the `users` create rule needs an explicit list.

## 2. User creation and profile rules per role

- [ ] Self sign-up: a brand-new account creates its own `users/{uid}` with role Employee and no orgId: **OK**.
- [ ] Same, but with `orgId` of another org, or role `super_admin`: **denied**.
- [ ] Employee edits own phone/name: **OK**. Employee edits own role, orgId, `linkedAuthUid`, `super_admin`: **denied**.
- [ ] Employee saves Settings (app.js profile form) with unchanged role: **OK** (merge write). No console error.
- [ ] Manager edits another user: **denied**.
- [ ] Super admin of org C (`orgConfigured: false`) creates a user: **denied** until org setup is completed;
      the setup wizard can still write org config and flip `orgConfigured`.
- [ ] A user whose `users` doc has no `orgId` (legacy) cannot read org data: expected until migrated.
- [ ] A role string the rules do not know (for example `manager Lead`) is treated as a non-staff user. Fix the data.

## 3. Payment batch maker-checker (payroll-disbursement)

| Step | Super admin A (maker) | Second super admin A (checker) | HR | Manager | Employee | Super admin B |
|---|---|---|---|---|---|---|
| Create batch (orgId A) | OK | OK | denied | denied | denied | denied |
| List batches with the org filter (operational-dashboard) | OK | OK | OK (read) | OK (read) | denied | only own org |
| Approve with a **different** checker | n/a | OK | denied | denied | denied | denied |
| Approve where checker = maker | **denied** | **denied** | n/a | n/a | n/a | n/a |
| Change status on an older batch that has no `maker_checker` map | OK | OK | denied | denied | denied | denied |
| Change `orgId` of a batch | denied | denied | denied | denied | denied | denied |
| Create/approve in org C (not configured) | denied | denied | | | | |
| Delete a `DRAFT` batch / delete an `APPROVED` batch | OK / denied | | | | | |

## 4. Approvals (workflow_instances, approval_tasks)

| Step | Employee | Manager (not the initiator) | Manager who started the request | Super admin | Other org |
|---|---|---|---|---|---|
| Read the workflow instance / task | OK (own org) | OK | OK | OK | denied |
| Create an instance or task | **denied** | OK | **denied** (cannot create a request they initiated) | OK | denied |
| Approve/reject a task | **denied** | OK | **denied** (no self-approval) | OK (override) | denied |
| Advance an instance | denied | OK | **denied** | OK | denied |
| Delete a task or instance | denied | denied | denied | OK (configured org) | denied |

End-to-end: employee submits a leave request, assigned manager approves it, employee cannot approve it,
the manager cannot approve their own request, a super admin can.

## 5. Org configuration (business units, shifts, cost centers, ...)

- [ ] Any org member can read: **OK**.
- [ ] Super admin and HR can write: **OK**. Manager and employee write: **denied**.
- [ ] Super admin of org C can still write config before `orgConfigured` is true (setup wizard): **OK**.

## 6. API and UI checks

- [ ] Org A user opens every dashboard: no data from org B anywhere (names, counts, notifications).
- [ ] `GET /api/...` with no token, with `Bearer super_admin_dev_token`, or with `?role=super_admin`: **401**.
- [ ] Admin Central Dashboard with no login: redirects to `login.html`; with an expired token: redirects.
- [ ] PF profiles page as `HRMS`: UAN and member id are **masked**. As `hr_payroll`/super admin: unmasked.
      Sending `x-user-role: PAYROLL_ADMIN` from the browser console changes nothing.
- [ ] Console shows no `[Firestore] permission-denied` lines during normal use of each role's pages.

## 7. Sign-off

Record tester, date, build/commit and any denied-when-it-should-be-OK finding (with the logged path) here.
