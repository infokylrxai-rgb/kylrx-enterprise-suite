/**
 * Cashfree refuses a hyphen in these ids - "beneficiary_id : should contain only letters,
 * numbers, underscore, pipe and dot. Value received: EMP-DRY001" - which failed every
 * payout at the very first call. The ids also used to DROP illegal characters, so "A-1"
 * and "A1" became the same id, and were truncated blindly at 40 characters. Both collapse
 * distinct employees onto one payout identifier, which decides who gets paid.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { PayrollDisbursementService } = require('../services/payroll/payrollDisbursementService.js');

const svc = new PayrollDisbursementService({ db: null, provider: {} });
const LEGAL = /^[A-Za-z0-9_.|]+$/;   // exactly what Cashfree documents

describe('provider ids use only Cashfree-legal characters', () => {
  for (const [batchId, employeeId] of [
    ['DISB-1795534662781', 'DRY001'],
    ['DISB-1795534662781', 'EMP-0001'],
    ['batch with spaces',  'emp/with/slashes'],
    ['DISB#2026',          'EMP@001'],
    ['DISB-2026',          'एमपी-001']
  ]) {
    it(`transfer id is legal for ${JSON.stringify(batchId)} + ${JSON.stringify(employeeId)}`, () => {
      const id = svc.buildTransferId(batchId, { employeeId });
      assert.match(id, LEGAL, `illegal characters in ${id}`);
      assert.ok(id.length <= 40, `too long: ${id.length}`);
    });
    it(`beneficiary id is legal for ${JSON.stringify(employeeId)}`, () => {
      const id = svc.buildBeneficiaryId({ employeeId });
      assert.match(id, LEGAL, `illegal characters in ${id}`);
      assert.ok(id.length <= 40, `too long: ${id.length}`);
    });
  }

  it('contains no hyphen - the character Cashfree actually rejected', () => {
    assert.ok(!svc.buildBeneficiaryId({ employeeId: 'DRY001' }).includes('-'));
    assert.ok(!svc.buildTransferId('DISB-123', { employeeId: 'DRY-001' }).includes('-'));
  });
});

describe('ids never collide across distinct employees', () => {
  it('distinguishes employees that differ only by an illegal character', () => {
    const a = svc.buildBeneficiaryId({ employeeId: 'A-1' });
    const b = svc.buildBeneficiaryId({ employeeId: 'A1' });
    assert.notEqual(a, b, 'A-1 and A1 collapsed onto the same beneficiary id');
  });

  it('distinguishes long employee ids that share a 40-char prefix', () => {
    const prefix = 'EMPLOYEE_WITH_A_VERY_LONG_IDENTIFIER_PREFIX';
    const a = svc.buildTransferId('DISB_2026', { employeeId: prefix + 'AAAA' });
    const b = svc.buildTransferId('DISB_2026', { employeeId: prefix + 'BBBB' });
    assert.notEqual(a, b, 'two employees truncated onto the same transfer id - one would be paid twice, the other not at all');
    assert.ok(a.length <= 40 && b.length <= 40);
  });

  it('distinguishes the same employee across different batches', () => {
    assert.notEqual(
      svc.buildTransferId('DISB_1', { employeeId: 'E1' }),
      svc.buildTransferId('DISB_2', { employeeId: 'E1' })
    );
  });

  it('is deterministic - a retry produces the same id, so it cannot double-pay', () => {
    const once = svc.buildTransferId('DISB-2026', { employeeId: 'EMP-001' });
    const twice = svc.buildTransferId('DISB-2026', { employeeId: 'EMP-001' });
    assert.equal(once, twice);
  });

  it('gives the same employee the same beneficiary id in every batch', () => {
    assert.equal(svc.buildBeneficiaryId({ employeeId: 'E1' }), svc.buildBeneficiaryId({ employeeId: 'E1' }));
  });
});
