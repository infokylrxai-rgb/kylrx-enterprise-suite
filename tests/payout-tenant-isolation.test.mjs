/**
 * Approve, execute, status and reconcile all take a batchId straight from the URL and acted on
 * whatever they found. With more than one organisation an administrator of tenant B could approve,
 * run, read or reconcile tenant A's payroll - defeating four-eyes across tenants, exposing employee
 * names, amounts and bank details, and moving somebody else's money. It went unnoticed because
 * there was only ever one organisation.
 *
 * The service now refuses a batch from another organisation, and answers "not found" rather than
 * "forbidden" so batch ids cannot be probed.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);
const { PayrollDisbursementService } = require('../services/payroll/payrollDisbursementService.js');

const OWNER = 'org_alpha';
const OTHER = 'org_beta';

const provider = {
  apiVersion: 'v2', environment: 'sandbox',
  async getBalance() { return { availableBalance: 1e9 }; },
  async ensureBeneficiary(o) { return { beneficiaryId: o.beneficiaryId }; },
  async createTransfer() { return { status: 'PENDING', referenceId: 'R1', raw: {} }; },
  async getTransferStatus() { return { status: 'SUCCESS', utr: 'U1' }; }
};

let svc, batchId;
beforeEach(async () => {
  svc = new PayrollDisbursementService({ db: null, provider, concurrency: 2 });
  batchId = 'BATCH_ALPHA';
  await svc.createDisbursementBatch({
    batchId, makerId: 'maker-1', orgId: OWNER, payoutChannel: 'NEFT',
    employees: [{ id: 'E1', name: 'E One', netPayable: 100,
      financeDetails: { accountNumber: '500000000001', ifsc: 'HDFC0001234', bankName: 'HDFC', accountHolderName: 'E One' } }]
  });
});

const refused = async (fn) => {
  try { await fn(); return null; } catch (err) { return err; }
};

describe('another tenant cannot touch the batch', () => {
  it('cannot read it', async () => {
    const err = await refused(() => svc.getBatch(batchId, OTHER));
    assert.ok(err, 'a foreign org read the batch');
    assert.equal(err.statusCode, 404, 'must not reveal that the batch exists');
  });

  it('cannot approve it', async () => {
    const err = await refused(() => svc.approveDisbursementBatch(batchId, 'checker-2', 'ok', OTHER));
    assert.ok(err, 'a foreign org approved the batch - four-eyes defeated across tenants');
    assert.equal(err.statusCode, 404);
  });

  it('cannot execute it', async () => {
    await svc.approveDisbursementBatch(batchId, 'checker-1', 'ok', OWNER);
    const err = await refused(() => svc.executeCashfreePayoutBatch(batchId, { orgId: OTHER }));
    assert.ok(err, 'a foreign org moved another tenant\u2019s money');
    assert.equal(err.statusCode, 404);
  });

  it('cannot reconcile it', async () => {
    const err = await refused(() => svc.reconcilePendingTransfers(batchId, OTHER));
    assert.ok(err);
    assert.equal(err.statusCode, 404);
  });

  it('says "not found", never "forbidden"', async () => {
    const err = await refused(() => svc.getBatch(batchId, OTHER));
    assert.match(String(err.message), /not found/i);
    assert.notEqual(err.statusCode, 403);
  });
});

describe('the owning tenant is unaffected', () => {
  it('reads, approves, executes and reconciles normally', async () => {
    assert.ok(await svc.getBatch(batchId, OWNER));
    const appr = await svc.approveDisbursementBatch(batchId, 'checker-1', 'ok', OWNER);
    assert.equal(appr.status, 'APPROVED');
    const exec = await svc.executeCashfreePayoutBatch(batchId, { orgId: OWNER });
    assert.equal(exec.success, true);
    assert.equal(exec.totalDispatched, 1);
    const rec = await svc.reconcilePendingTransfers(batchId, OWNER);
    assert.equal(rec.batchId, batchId);
  });

  it('internal callers with no org are still allowed', async () => {
    // Scripts and the existing suites call without an org on purpose; the controller always passes one.
    assert.ok(await svc.getBatch(batchId));
    assert.equal((await svc.approveDisbursementBatch(batchId, 'checker-1', 'ok')).status, 'APPROVED');
  });

  it('a batch with no orgId is refused when an org is required', async () => {
    const legacy = 'BATCH_LEGACY';
    await svc.createDisbursementBatch({ batchId: legacy, makerId: 'm', payoutChannel: 'NEFT',
      employees: [{ id: 'E9', name: 'E Nine', netPayable: 1,
        financeDetails: { accountNumber: '500000000009', ifsc: 'HDFC0001234', bankName: 'HDFC', accountHolderName: 'E Nine' } }] });
    const err = await refused(() => svc.getBatch(legacy, OWNER));
    assert.ok(err, 'an untagged batch must not be readable by an arbitrary org');
  });
});
