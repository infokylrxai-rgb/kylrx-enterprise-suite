/**
 * Cashfree refused to register the webhook URL ("The provided url could not be reached"):
 * it pings the endpoint and requires a 2xx, but GET/HEAD fell through to verifyToken and
 * POST demanded a signature the ping does not carry, so every method answered 401.
 *
 * A ping is now acknowledged. The security property is unchanged and asserted here: a
 * payload that NAMES A TRANSFER still requires a valid signature, so the probe path can
 * never be used to forge a payment.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.CASHFREE_WEBHOOK_SECRET = 'test-webhook-secret-for-signing';
const { app } = await import('../server.js');

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const PATH = '/api/payroll/disburse/webhook/cashfree';
const post = (body, headers = {}) =>
  fetch(base + PATH, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

describe('webhook URL registration probe', () => {
  it('GET returns 200 so the gateway can verify the URL', async () => {
    const res = await fetch(base + PATH);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).probe, true);
  });

  it('HEAD returns 200', async () => {
    assert.equal((await fetch(base + PATH, { method: 'HEAD' })).status, 200);
  });

  it('POST with an empty body is acknowledged, not refused', async () => {
    const res = await post('{}');
    assert.equal(res.status, 200, 'an unsigned ping with no transfer must not 401');
    assert.equal((await res.json()).probe, true);
  });
});

describe('the probe path cannot be used to forge a payment', () => {
  it('rejects an UNSIGNED payload that names a transfer', async () => {
    const res = await post(JSON.stringify({ type: 'TRANSFER_SUCCESS',
      data: { transfer: { transfer_id: 'FORGED-1', status: 'SUCCESS', utr: 'FAKE' } } }));
    assert.equal(res.status, 401, 'an unsigned transfer event must still be refused');
  });

  it('rejects a transfer event carrying a WRONG signature', async () => {
    const body = JSON.stringify({ type: 'TRANSFER_SUCCESS',
      data: { transfer: { transfer_id: 'FORGED-2', status: 'SUCCESS' } } });
    const res = await post(body, { 'x-webhook-signature': 'bm90LXRoZS1yaWdodC1zaWc=', 'x-webhook-timestamp': '123' });
    assert.equal(res.status, 401);
  });

  it('rejects an empty body that carries a bogus signature', async () => {
    const res = await post('{}', { 'x-webhook-signature': 'Ym9ndXM=', 'x-webhook-timestamp': '1' });
    assert.notEqual(res.status, 200, 'a signature was presented, so it must be verified');
  });

  /**
   * Each organisation now pays from its own gateway, so there is no server-wide secret a
   * callback could be checked against: the tenant is found from cashfree_transfer_index,
   * written when the transfer was dispatched, and the signature is verified with THAT
   * tenant's secret. A transfer this server never dispatched therefore has no secret to
   * verify against and cannot be accepted, however well-formed its signature looks -
   * accepting it would mean falling back to the platform's own secret, which is exactly
   * how a forged callback for an invented transfer would get in.
   *
   * The accepted path, where the transfer IS indexed, is covered in
   * tests/webhook-per-org-verification.test.mjs.
   */
  it('refuses a signed event for a transfer this server never dispatched', async () => {
    const ts = String(Date.now());
    const body = JSON.stringify({ type: 'TRANSFER_SUCCESS',
      data: { transfer: { transfer_id: 'REAL-1', status: 'SUCCESS', utr: 'UTR123', cf_transfer_id: 'CF1' } } });
    const sig = crypto.createHmac('sha256', process.env.CASHFREE_WEBHOOK_SECRET).update(ts + body).digest('base64');
    const res = await post(body, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts });
    assert.equal(res.status, 401, await res.clone().text());
    assert.match((await res.json()).error, /unrecognised transfer/);
  });
});
