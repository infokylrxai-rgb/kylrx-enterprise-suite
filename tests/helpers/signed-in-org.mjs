// Import FIRST in a test that runs a browser service (costCenterService.js, ...) in Node.
// Those services take the organization from the signed-in session (window.getActiveOrgId, set by
// firebase-config.js) and refuse to run without one; this stands in for that session.
globalThis.getActiveOrgId = () => 'org_test';
