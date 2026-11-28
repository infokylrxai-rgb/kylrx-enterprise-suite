/**
 * Every organisation pays from its own gateway, so there is no server-wide Cashfree
 * credential any more. This file asserts that against the REAL provider - the factory
 * test cannot, because it replaces the provider with a stand-in.
 *
 * What must hold: a gateway built without explicit credentials comes out blank and
 * refuses to issue a request, even when CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET
 * are set in the environment. If it quietly inherited them, an organisation that had
 * connected nothing would have its payroll charged to the platform's balance - the
 * failure the whole per-tenant design exists to prevent.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
// Deliberately present and deliberately ignored.
process.env.CASHFREE_CLIENT_ID = 'PLATFORM_CLIENT_MUST_NOT_BE_USED';
process.env.CASHFREE_CLIENT_SECRET = 'platform-secret-must-not-be-used-01';
process.env.CASHFREE_WEBHOOK_SECRET = 'platform-webhook-must-not-be-used-01';

const require = createRequire(import.meta.url);
const { CashfreePayoutProvider } = require('../services/payroll/cashfreePayoutProvider.js');
const { PayrollDisbursementService } = require('../services/payroll/payrollDisbursementService.js');

describe('no server-wide payout credentials', () => {
  it('a gateway built with no credentials stays blank', () => {
    const p = new CashfreePayoutProvider({});
    assert.equal(p.clientId, '', 'must not inherit CASHFREE_CLIENT_ID');
    assert.equal(p.clientSecret, '', 'must not inherit CASHFREE_CLIENT_SECRET');
    assert.equal(p.isConfigured(), false);
  });

  it('the webhook secret does not come from the environment either', () => {
    const p = new CashfreePayoutProvider({});
    assert.notEqual(p.webhookSecret, process.env.CASHFREE_WEBHOOK_SECRET,
      'a platform webhook secret would validate another tenant\'s forged callback');
    assert.equal(p.webhookSecret, '', 'with no client secret there is nothing to sign with');
  });

  it('refuses to issue a request without credentials', () => {
    assert.throws(() => new CashfreePayoutProvider({}).assertConfigured(), /not configured/i);
  });

  it('uses the credentials it is given, and only those', () => {
    const p = new CashfreePayoutProvider({ clientId: 'ORG_OWN_ID', clientSecret: 'org-own-secret-0001' });
    assert.equal(p.clientId, 'ORG_OWN_ID');
    assert.equal(p.clientSecret, 'org-own-secret-0001');
    assert.equal(p.webhookSecret, 'org-own-secret-0001', 'falls back to the org\'s own client secret');
    assert.equal(p.isConfigured(), true);
  });

  /**
   * The service used to throw at startup in production unless the environment carried
   * credentials. With none to carry, that check had to go - but constructing a service
   * must still not become a way to pick up the platform's keys.
   */
  it('constructing a service without credentials no longer throws, and inherits nothing', () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const svc = new PayrollDisbursementService({ db: null });
      assert.equal(svc.provider.isConfigured(), false, 'blank, not the platform account');
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});
