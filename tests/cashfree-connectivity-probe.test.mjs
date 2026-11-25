/**
 * verifyConnectivity answers one question: do these credentials authenticate from this
 * server's IP? Cashfree settles that before it validates parameters - a wrong key is 401,
 * a blocked IP is 403 - so any other 4xx means we got through both and were turned back
 * on the shape of the request.
 *
 * This matters because the v2 probe calls GET /transfers, which insists on a transfer_id
 * a connectivity check has no reason to have. Reading that as a failure told an operator
 * with working production keys that their gateway could not be reached, and sent them
 * hunting an IP allow-list problem that did not exist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);
const { CashfreePayoutProvider } = require('../services/payroll/cashfreePayoutProvider.js');

/** A provider whose single request fails the way Cashfree would. */
function providerThatFailsWith(statusCode, message) {
  const p = new CashfreePayoutProvider({
    clientId: 'test-client-id-not-real', clientSecret: 'test-client-secret-not-real-0001',
    environment: 'production', apiVersion: 'v2'
  });
  p._authHeaders = async () => ({});
  p._request = async () => {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.details = { response: { message } };
    throw err;
  };
  return p;
}

describe('cashfree connectivity probe', () => {
  it('treats a clean response as reachable', async () => {
    const p = new CashfreePayoutProvider({
      clientId: 'test-client-id-not-real', clientSecret: 'test-client-secret-not-real-0001',
      environment: 'production', apiVersion: 'v2'
    });
    p._authHeaders = async () => ({});
    p._request = async () => ({ data: [] });
    assert.deepEqual(await p.verifyConnectivity(), { ok: true, status: 200, message: null });
  });

  /** The real report from production that prompted this. */
  it('counts a missing-parameter rejection as reachable, because auth already passed', async () => {
    const p = providerThatFailsWith(400, 'cf_transfer_id or transfer_id : either of them should be present in the request');
    const r = await p.verifyConnectivity();
    assert.equal(r.ok, true, 'the credentials authenticated; only the parameters were wrong');
    assert.equal(r.message, null, 'nothing to report to the operator');
    assert.match(r.viaParameterError, /transfer_id/, 'the underlying detail is kept for diagnosis');
  });

  it('still reports a wrong key as unreachable', async () => {
    const r = await providerThatFailsWith(401, 'authentication Failed').verifyConnectivity();
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.match(r.message, /authentication Failed/);
  });

  it('still reports a blocked IP as unreachable', async () => {
    const r = await providerThatFailsWith(403, 'IP not whitelisted').verifyConnectivity();
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.match(r.message, /IP not whitelisted/);
  });

  it('still reports a gateway fault as unreachable', async () => {
    for (const code of [500, 502, 503]) {
      const r = await providerThatFailsWith(code, 'service unavailable').verifyConnectivity();
      assert.equal(r.ok, false, `HTTP ${code} must not be read as reachable`);
    }
  });

  it('reports a transport failure with no status as unreachable', async () => {
    const r = await providerThatFailsWith(null, 'ENOTFOUND api.cashfree.com').verifyConnectivity();
    assert.equal(r.ok, false);
    assert.match(r.message, /ENOTFOUND/);
  });

  it('treats 404 and 422 as reachable too - both are past authentication', async () => {
    for (const code of [404, 422]) {
      assert.equal((await providerThatFailsWith(code, 'not found').verifyConnectivity()).ok, true);
    }
  });
});
