/**
 * Where a salary is paid is decided by the server, from the organisation's stored
 * employee_finance record - never by the request that creates the batch.
 *
 * POST /api/payroll/disburse/create-batch used to take each employee's account number
 * and IFSC from the request body, so the bank was told to pay whatever the browser sent.
 * Maker-checker does not catch that: the checker approves the batch the maker made.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveStoredBeneficiaries } = require('../controllers/payroll-controller.js');

/** A Firestore stand-in holding organizations/{org}/employee_finance/{emp}. */
function fakeDb(records) {
  const reads = [];
  return {
    reads,
    collection: (c1) => ({ doc: (org) => ({ collection: (c2) => ({ doc: (emp) => ({
      get: async () => {
        reads.push(`${c1}/${org}/${c2}/${emp}`);
        const data = records[`${org}/${emp}`];
        return { exists: Boolean(data), data: () => data };
      }
    }) }) }) })
  };
}

const STORED = { banking: { accountHolderName: 'Asha Rao', bankName: 'State Bank', accountNumber: '123456789012', ifsc: 'SBIN0000813', accountType: 'Savings' } };

describe('payout bank details come from the stored record', () => {
  it('replaces whatever account the request carried', async () => {
    const db = fakeDb({ 'org_a/EMP0001': STORED });
    const [p] = await resolveStoredBeneficiaries('org_a', [{
      employeeId: 'EMP0001', netPayable: 50000,
      financeDetails: { Account_Number: '999999999999', IFSC: 'EVIL0000001' },
      accountNumber: '888888888888', ifsc: 'EVIL0000002'
    }], db);
    assert.equal(p.financeDetails.Account_Number, '123456789012');
    assert.equal(p.financeDetails.IFSC, 'SBIN0000813');
    assert.equal(p.accountNumber, undefined, 'a request-supplied account must not ride along');
    assert.equal(p.ifsc, undefined);
    assert.equal(p.netPayable, 50000, 'who and how much are kept');
  });

  it('reads only the caller\'s organisation', async () => {
    const db = fakeDb({ 'org_b/EMP0001': STORED });
    const [p] = await resolveStoredBeneficiaries('org_a', [{ employeeId: 'EMP0001' }], db);
    assert.deepEqual(db.reads, ['organizations/org_a/employee_finance/EMP0001']);
    assert.deepEqual(p.financeDetails, {}, 'another organisation\'s account must never be used');
  });

  it('gives an employee with no stored account no account, so the row is rejected', async () => {
    const [p] = await resolveStoredBeneficiaries('org_a', [{ employeeId: 'EMP0009', financeDetails: { Account_Number: '111122223333', IFSC: 'HDFC0000053' } }], fakeDb({}));
    assert.deepEqual(p.financeDetails, {});
  });

  it('refuses without an organisation or a database rather than trusting the request', async () => {
    await assert.rejects(resolveStoredBeneficiaries(null, [], fakeDb({})), /no organization/);
    await assert.rejects(resolveStoredBeneficiaries('org_a', [], null), /could not be read/);
  });

  it('the batch is built from the resolved list', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../controllers/payroll-controller.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('async function createDisbursementBatch'), src.indexOf('async function approveDisbursementBatch'));
    assert.match(body, /resolveStoredBeneficiaries\(orgId/);
    assert.match(body, /employees: payees/);
    assert.ok(!/employees: employees \|\| \[\]/.test(body), 'the request body is passed straight through again');
  });
});
