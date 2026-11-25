/**
 * Cashfree posts every tenant's callbacks to one URL, and each tenant now pays from its
 * own gateway, so there is no single secret left to verify against. The organisation has
 * to be worked out from the transfer id before the signature can be checked - which means
 * reading a payload that has not yet been proven genuine.
 *
 * What must hold: the organisation comes from the index this server wrote at dispatch and
 * never from the body, an unknown transfer is refused rather than verified against the
 * platform's secret, a callback is verified with the secret of the tenant that actually
 * dispatched it, and a lookup failure is retryable rather than a flat rejection.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);

// --- Firestore stand-in holding the dispatch index -----------------------------------
const INDEX = new Map();      // transferId -> { orgId }
let dbThrows = false;
const mockDb = {
  collection(name) {
    return { doc: (id) => ({
      async get() {
        if (dbThrows) throw new Error('firestore unavailable');
        if (name !== 'cashfree_transfer_index') return { exists: false, data: () => null };
        const d = INDEX.get(id);
        return { exists: Boolean(d), data: () => d };
      }
    })};
  }
};
const fb = require.resolve('../config/firebase');
require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: { db: mockDb, admin: { apps: [{}] } } };

// --- the per-org gateway factory: records which org was asked for --------------------
const ASKED = [];
let factoryThrows = null;
const handled = [];
const factoryPath = require.resolve('../services/payroll/payoutServiceFactory');
require.cache[factoryPath] = { id: factoryPath, filename: factoryPath, loaded: true, exports: {
  async getServiceForOrg(orgId) {
    ASKED.push(orgId);
    if (factoryThrows) throw factoryThrows;
    return {
      async handleCashfreeWebhook(args) {
        handled.push({ orgId, ...args });
        return { success: true, matched: true, orgId };
      }
    };
  },
  invalidate() {},
  PayoutAccountNotConnectedError: class extends Error {}
}};

const ctrl = require('../controllers/payroll-controller.js');
const { extractTransferId, safeDocId } = require('../services/payroll/webhookOrgResolver.js');

function mockReq(body, headers = {}) {
  return { body, get: (h) => headers[h.toLowerCase()] || headers[h] || undefined };
}
function mockRes() {
  return { statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
const post = async (body, headers) => {
  const res = mockRes();
  await ctrl.handleCashfreeWebhook(mockReq(body, headers), res);
  return res;
};

const SIGNED = { 'x-webhook-signature': 'sig-abc', 'x-webhook-timestamp': '1700000000' };

beforeEach(() => {
  INDEX.clear(); ASKED.length = 0; handled.length = 0;
  dbThrows = false; factoryThrows = null;
  INDEX.set('KYLRX_BATCH1_EMP1', { orgId: 'org_kylrx' });
  INDEX.set('BOSCO_BATCH9_EMP4', { orgId: 'org_bosco' });
});

describe('webhook verification per organisation', () => {
  it('verifies against the organisation that actually dispatched the transfer', async () => {
    const res = await post({ data: { transfer: { transfer_id: 'BOSCO_BATCH9_EMP4', status: 'SUCCESS' } } }, SIGNED);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(ASKED, ['org_bosco']);
    assert.equal(handled[0].signature, 'sig-abc');
  });

  it('routes two tenants\' callbacks to their own gateways', async () => {
    await post({ data: { transfer: { transfer_id: 'KYLRX_BATCH1_EMP1' } } }, SIGNED);
    await post({ data: { transfer: { transfer_id: 'BOSCO_BATCH9_EMP4' } } }, SIGNED);
    assert.deepEqual(ASKED, ['org_kylrx', 'org_bosco']);
  });

  /** The attack this ordering could otherwise enable. */
  it('ignores an orgId planted in the body and uses the index', async () => {
    const res = await post({
      orgId: 'org_attacker', organizationId: 'org_attacker',
      data: { orgId: 'org_attacker', transfer: { transfer_id: 'BOSCO_BATCH9_EMP4' } }
    }, SIGNED);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(ASKED, ['org_bosco'], 'the index decides, never the payload');
  });

  it('refuses an unknown transfer instead of verifying it against the platform secret', async () => {
    const res = await post({ data: { transfer: { transfer_id: 'INVENTED_TRANSFER_1' } } }, SIGNED);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /unrecognised transfer/);
    assert.equal(ASKED.length, 0, 'no gateway may be consulted at all');
  });

  it('answers an unsigned registration ping with 200 so Cashfree accepts the URL', async () => {
    const res = await post({ event: 'WEBHOOK_VERIFICATION' }, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.probe, true);
    assert.equal(ASKED.length, 0);
  });

  /** A retryable failure must not look like a rejection, or Cashfree stops retrying. */
  it('returns a retryable 503 when the index cannot be read', async () => {
    dbThrows = true;
    const res = await post({ data: { transfer: { transfer_id: 'BOSCO_BATCH9_EMP4' } } }, SIGNED);
    assert.equal(res.statusCode, 503);
    assert.equal(ASKED.length, 0);
  });

  it('returns a retryable 503 when the tenant has since disconnected its gateway', async () => {
    const e = new Error('No payment account is connected for this organization.');
    e.code = 'payout_account_not_connected';
    factoryThrows = e;
    const res = await post({ data: { transfer: { transfer_id: 'BOSCO_BATCH9_EMP4' } } }, SIGNED);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'payout_account_not_connected');
  });

  it('refuses a signed callback that names no transfer', async () => {
    const res = await post({ data: { status: 'SUCCESS' } }, SIGNED);
    assert.equal(res.statusCode, 401);
    assert.equal(ASKED.length, 0);
  });
});

describe('reading an unverified payload safely', () => {
  it('accepts only ids that could be ones we minted', () => {
    assert.equal(safeDocId('BOSCO_BATCH9_EMP4'), 'BOSCO_BATCH9_EMP4');
    assert.equal(safeDocId('a.b|c-d_1'), 'a.b|c-d_1');
    for (const bad of ['../../etc/passwd', 'a/b', '.', '..', '', '   ', 'x'.repeat(201),
                       'has space', 'quote"', "tick'", 'semi;colon', null, undefined, {}, [1, 2]]) {
      assert.equal(safeDocId(bad), null, `must reject ${JSON.stringify(bad)}`);
    }
    // A numeric id is a plausible thing for a gateway to send and coerces to a safe
    // string, so it is accepted rather than rejected on its type.
    assert.equal(safeDocId(42), '42');
  });

  it('finds the transfer id in each shape Cashfree sends', () => {
    assert.equal(extractTransferId({ transfer_id: 'A1' }), 'A1');
    assert.equal(extractTransferId({ transferId: 'A2' }), 'A2');
    assert.equal(extractTransferId({ data: { transfer_id: 'A3' } }), 'A3');
    assert.equal(extractTransferId({ data: { transfer: { transferId: 'A4' } } }), 'A4');
  });

  it('reads nothing but the transfer id', () => {
    assert.equal(extractTransferId({ data: { amount: 999999, status: 'SUCCESS' } }), null);
    assert.equal(extractTransferId(null), null);
    assert.equal(extractTransferId('a string'), null);
    assert.equal(extractTransferId([]), null);
  });
});
