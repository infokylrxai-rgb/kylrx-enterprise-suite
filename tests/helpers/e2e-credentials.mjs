/**
 * Shared login details for the suite1-8 portal E2E runs.
 *
 * These suites used to hardcode real user logins. That rotted the moment those
 * passwords changed: every suite then failed at the login step and reported dozens
 * of phantom "failures" that looked like product bugs but were not.
 *
 * PASSWORDS ARE NEVER STORED IN THIS REPO. They are read from the environment at
 * run time. Emails default to the demo organisation (org_demo) created by
 * `npm run seed:demo`, which prints a fresh random password for each role once.
 *
 * Usage:
 *   npm run seed:demo                       # prints the four passwords once
 *   KYLRX_E2E_EMPLOYEE_PASS=... \
 *   KYLRX_E2E_MANAGER_PASS=... \
 *   KYLRX_E2E_HRADMIN_PASS=... \
 *   KYLRX_E2E_SUPERADMIN_PASS=... \
 *     node tests/suite3_employee_portal.mjs
 *
 * Any email/name can also be overridden, e.g. KYLRX_E2E_EMPLOYEE_EMAIL=...
 */
const env = process.env;

/** Fail loudly and early rather than reporting a cascade of fake test failures. */
function requirePass(varName, role) {
  const value = env[varName];
  if (!value) {
    throw new Error(
      `Missing ${varName}. The ${role} E2E login password must be supplied via the environment ` +
      `(passwords are deliberately not stored in this repo). Run "npm run seed:demo" to mint ` +
      `fresh demo credentials, then re-run with ${varName}=<password>.`
    );
  }
  return value;
}

export const CREDS = {
  hrAdmin: {
    email: env.KYLRX_E2E_HRADMIN_EMAIL || 'demo-hrms@demo.example.org',
    get pass() { return requirePass('KYLRX_E2E_HRADMIN_PASS', 'HR admin'); },
    expectedDashboard: 'hrms-dashboard.html',
    name: env.KYLRX_E2E_HRADMIN_NAME || 'Demo HR Admin'
  },
  employee: {
    email: env.KYLRX_E2E_EMPLOYEE_EMAIL || 'demo-employee@demo.example.org',
    get pass() { return requirePass('KYLRX_E2E_EMPLOYEE_PASS', 'employee'); },
    expectedDashboard: 'employee-dashboard.html',
    name: env.KYLRX_E2E_EMPLOYEE_NAME || 'Demo Employee'
  },
  manager: {
    email: env.KYLRX_E2E_MANAGER_EMAIL || 'demo-manager@demo.example.org',
    get pass() { return requirePass('KYLRX_E2E_MANAGER_PASS', 'manager'); },
    expectedDashboard: 'manager-dashboard.html',
    name: env.KYLRX_E2E_MANAGER_NAME || 'Demo Manager'
  },
  superAdmin: {
    email: env.KYLRX_E2E_SUPERADMIN_EMAIL || 'demo-admin@demo.example.org',
    get pass() { return requirePass('KYLRX_E2E_SUPERADMIN_PASS', 'super admin'); },
    expectedDashboard: 'admin-dashboard.html',
    name: env.KYLRX_E2E_SUPERADMIN_NAME || 'Demo Admin'
  }
};

export const BASE_URL = env.KYLRX_E2E_BASE_URL || 'http://localhost:3000';
export default CREDS;
