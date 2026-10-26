# Kylrx Enterprise Suite

HR, payroll and workforce-management web application for organizations (multi-tenant). One deployment serves many
organizations; each organization's data is separated by an `orgId`.

> Statements below were checked against the code unless marked **not verified**.

## What it is

Four portals, all static HTML/JS pages served by the same Express server:

| Portal | Pages | Who |
|---|---|---|
| Super admin / admin | `admin-*.html` (35 pages) | organization owner, HR/payroll admins |
| HR (HRMS) | `hrms-*.html` (7) | HR staff |
| Manager | `manager-*.html` (15) | line managers |
| Employee | `employee-*.html` (12) | employees (self-service) |

Entry pages: `index.html`, `login.html`, `employee-login.html`, `hrms-login.html`, `manager-login.html`, `signup.html`
(company signup, creates a new organization).

## Architecture

- **Backend**: Node.js + Express 5 (`server.js`, `routes/`, `controllers/`, `services/`, `middleware/`). It also
  serves the static pages and proxies `/__/auth` to Firebase so Google sign-in works on your own domain.
- **Browser**: plain HTML + ES modules; Firebase Web SDK (loaded from `gstatic.com`) through `firebase-config.js`.
  The Firebase project is configured in **one** file: `firebase-web-config.js`.
- **Firebase**: Authentication, Firestore (`firestore.rules`, `firestore.indexes.json`), Storage (`storage.rules`),
  Cloud Functions (`functions/`, Node 20 runtime in `firebase.json`).
- **Tenant model**: see [Organizations](#organizations-and-tenant-model).

## Prerequisites

- Node.js. Developed and tested on Node 24; `package.json` declares no `engines`, other versions are **not verified**.
  `functions/` declares Node >= 18 and runs on the `nodejs20` runtime.
- Firebase CLI (`npm i -g firebase-tools`; tested with 15.34.0) and a Google account that can create a Firebase project.
- Java 11+ for the emulator-based tests (`test:rules`, `test:storage-rules`, `test:tenant`, `test:emulator`). Not needed to run the app.
- `npm install` in this folder, and in `functions/` before deploying functions.

## Set up on a NEW Firebase project

1. **Create the project** in the Firebase console. Cloud Functions require the Blaze plan (Firebase requirement; **not verified** here).
2. **Authentication** > Sign-in method: enable **Email/Password** (login and signup use it) and **Google** (`login.js` offers Google
   sign-in). Add your domain under Authentication > Settings > Authorized domains. Whether any other provider is used is **not verified**.
3. **Firestore**: create a database (production mode). **Storage**: create the default bucket.
4. **Web app**: Project settings > Your apps > Add app > Web. Copy the config and **replace the `CHANGE_ME` values in
   `firebase-web-config.js`** (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId). These identify the project to the
   browser and are public by design; access is controlled by Authentication and the security rules. `firebase-config.js` logs an error until
   the placeholders are replaced.
5. **Service account** (server): Project settings > Service accounts > Generate new private key.
   Never commit it (`.gitignore` covers `*service-account*.json`, `*adminsdk*.json`, `.env*`).
6. **Environment**: `cp .env.example .env`, then set at least `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, the service account
   (`FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_SERVICE_ACCOUNT_PATH`), `JWT_SECRET`, `REFRESH_SECRET` (32+ random characters, different from
   each other). Every variable is documented in `.env.example`. Check with `npm run check:env` (development) or
   `npm run check:env -- --mode=production` (lists missing names, never values).
7. **Link the CLI**: `.firebaserc` holds a placeholder. Run `firebase use --add` and pick your project (or edit `.firebaserc`).
8. **Deploy rules and indexes**: `npm run deploy:firebase` (Firestore rules + indexes + Storage rules; it reads the project from
   `FIREBASE_PROJECT_ID` and refuses to run without it). Deploy functions with `npm run deploy:firebase -- --only functions`
   (run `npm install` in `functions/` first). The `onUserCreated` function derives an organization from the email domain, see Known limitations.
9. **Run**: `npm start`, then open `http://localhost:3000/signup.html` (or the host you set in `APP_URL`).

## First super admin

The normal way: **sign up** at `/signup.html`. The server creates the Auth user, the Super Admin profile, the organization (marked
configured) and the employee-ID counter, and sets the `role`, `super_admin` and `orgId` custom claims (`controllers/authController.js`,
`registerOrganization`). Organization names that equal a default or fallback tenant (for example "Kylrx AI") are refused.

`npm run provision:superadmin` is a separate script that creates a super admin directly. **Do not use it unchanged**: it defaults to the
email `superadmin@kylrx.ai`, the organization `org_kylrx` and a password that is written in the source (overridable with
`SUPERADMIN_PASSWORD` or `--password=`). See the handover checklist.

## Organizations and tenant model

- An `orgId` identifies one customer. Signup derives it as `org_` plus the company name lower-cased with non-alphanumerics replaced by `_`.
- The server puts `orgId` into the user's custom claims; the browser reads it from the verified token (`firebase-config.js` `tenantReady`).
- Firestore rules require the caller's `orgId` to match the document's `orgId`; Storage rules require `request.auth.token.orgId` to match the
  `orgs/{orgId}/...` path. Server routes use `req.user.orgId` (from the verified token) and `requireOrg`.
- Documents created before multi-tenancy have no `orgId`. They belong to `LEGACY_ORG_ID` (default `org_kylrx_ai`, override `DEV_DEFAULT_ORG_ID`)
  and are hidden from other organizations. `scripts/migrate-tenant-orgid.js` tags every untagged document with ONE default organization;
  it needs an explicit `--org-id <id>`, is a dry run unless `--write`, and refuses a project that does not look like a test or emulator project unless `--yes-really`. It does not work out whose a document is. A fresh project does not need it.
- Storage layout (new files): `orgs/{orgId}/payroll/payslips/{employeeId}/{period}.pdf`, `orgs/{orgId}/recruitment/resumes/{id}.{ext}`,
  `orgs/{orgId}/employees/{employeeId}/documents/{file}`, `orgs/{orgId}/branding/{file}`.

## Running locally

- `npm start` runs `node server.js` against the project in `.env`. Without a service account (and outside production) the server uses an
  in-memory store: nothing is persisted.
- `npm run start:local` runs the app against a local Firestore emulator seeded from your project (needs Java and `FIREBASE_PROJECT_ID`).
- `npm run start:static` runs the dev static server on 5500/5501/5502 (and starts the backend); it binds to `127.0.0.1` unless `STATIC_HOST` is set.

## Tests

| Command | What | Needs |
|---|---|---|
| `npm test` | the original 14-file suite (about 170 tests) | nothing |
| `npm run test:all` | every `tests/` and `services/` test except the emulator ones; Firebase credentials are blanked; `NODE_ENV=test` | nothing |
| `npm run test:rules` | `tests/firestore-rules.test.mjs` | Firestore emulator (Java) |
| `npm run test:storage-rules` | `tests/storage-rules.test.mjs` | Firestore + Storage emulators (Java) |
| `npm run test:tenant` | `tests/tenant-leak.test.mjs` | Firestore emulator (Java) |
| `npm run test:emulator` | all emulator suites, including `firestore-users-security` | Java |

`test:all` runs without `--test-force-exit` on purpose (it crashes libuv on Windows with Node 24). At the time of writing three tests in
`test:all` fail by design of the environment: two in `employee-quick-actions` and test 5 of `super-admin-attendance-controls` open real pages in
Chrome and need a running server. The emulator suites have **not been run** in this environment (Java was not installed), so the rules tests are
written but unexecuted.

## Demo videos

`demo.html` plays walkthrough videos from `assets/videos/` (about 102 MB; the folder is in `.gitignore` and the files are delivered separately). Copy them there with exactly these names; a missing file shows "Video not available":

- `add employee,manger and hrms in admin portal.mp4`
- `admin-policy-center.mp4`
- `admin(dashboardbuilder.html).mp4`
- `admin(Enterprise exit command).mp4`
- `admin(Enterprise leave).mp4`
- `admin(signup and login page).mp4`
- `apps.mp4`
- `Attendance Log.mp4`
- `AttendanceLog.mp4`
- `DepartmentalAnalytics.mp4`
- `Document EMployee.mp4`
- `HRMS.mp4`
- `Leave and TimeOff.mp4`
- `manger portal.mp4`
- `Manger-Document.mp4`
- `message and notification.mp4`
- `Onboarding(Flow Designer).mp4`
- `PolicyCenter.mp4`
- `RulesEmployees.mp4`
- `Security.mp4`
- `team management.mp4`
- `TVC.mp4`

## Security notes (rotate at handover)

- Rotate **everything that existed before handover**: `JWT_SECRET`, `REFRESH_SECRET`, `KYLRX_EXPORT_SIGNING_KEY`, the Decentro credentials, SMTP /
  Resend / OpenAI keys, and generate a new service account. Delete service-account keys of the original Kylrx project from this folder.
- The git history may contain earlier secrets or demo credentials (not audited in full): publish the code to the client from a fresh
  repository or run a history scan before sharing the history.
- `ALLOW_DEV_IDENTITY` must stay unset in production (it is ignored there). Production refuses to start without the variables listed by
  `npm run check:env -- --mode=production`.
- The default `SUPERADMIN_PASSWORD` in `scripts/provision-superadmin.js` is public in the source; never use it.
- Browser API keys in `firebase-web-config.js` are public by design; restrict the key in Google Cloud (HTTP referrers) as an extra layer.

## Known limitations

- **Unscoped browser reads**: about 130 whole-collection reads in 33 pages (`users`, `command_centers`, `attendance`, `department_teams`,
  `alertEvents`, ...) do not filter by `orgId` (9 do). `TENANT_READ_SCOPING` is `false` in `firebase-config.js`. Under the shipped Firestore rules
  such queries are refused rather than leaking, but those pages will show empty data until the reads are scoped. Already scoped:
  notifications, messages, Workforce Monitor, custom sidebar apps, and the pages listed in the git history.
- `employee-message.html` still has hard-coded demo employee ids and an unscoped chat query.
- `functions/index.js` `onUserCreated` assigns an organization from the email domain (`org_<domain>`) to any new Auth user without a role claim.
  Signup sets claims first, so it normally skips, but it can race. Decide whether to keep it before going live.
- Cloud Function behavior and the deployed rules of the original project were **not verified**.
- Browser-only tests (Puppeteer) need Chrome and a running server; Java-based tests have not been run (see Tests).
- Not verified: behavior on Node versions other than 24, and every email / payment integration against live providers.

## Handover checklist

- [ ] New Firebase project created; Auth providers, Firestore, Storage enabled; domain authorized
- [ ] `firebase-web-config.js` has the client's web app config (no `CHANGE_ME`)
- [ ] `.env` on the host has every production variable (`npm run check:env -- --mode=production` passes); secrets are in the host's secret store
- [ ] `.firebaserc` points to the client project; `npm run deploy:firebase` done (rules, indexes, storage rules); functions deployed or removed
- [ ] Java installed and `npm run test:emulator` green (rules and tenant tests have never run)
- [ ] First super admin created through `/signup.html`; `provision-superadmin.js` default password never used
- [ ] All original secrets rotated; original service-account keys deleted; git history scanned or a fresh repository used
- [ ] `assets/videos/` populated (optional)
- [ ] Decision taken on `onUserCreated`, on `scripts/migrate-tenant-orgid.js` (only if importing old data) and on the pending unscoped reads
