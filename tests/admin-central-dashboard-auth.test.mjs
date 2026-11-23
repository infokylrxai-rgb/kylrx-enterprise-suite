// Page script is browser-only; check that it has no dev-token fallback and sends users to login on 401.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../admin-central-dashboard.js', import.meta.url), 'utf8');

describe('admin-central-dashboard.js authentication', () => {
  it('has no dev-token fallback and sends no client role', () => {
    assert.doesNotMatch(src, /super_admin_dev_token|dev_/);
    assert.doesNotMatch(src, /overview\?role=/);
  });
  it('redirects to login when there is no token or the API answers 401', () => {
    assert.match(src, /if \(!token\) return redirectToLogin\(\)/);
    assert.match(src, /res\.status === 401\) return redirectToLogin\(\)/);
    assert.match(src, /window\.location\.href = 'login\.html'/);
  });
});
